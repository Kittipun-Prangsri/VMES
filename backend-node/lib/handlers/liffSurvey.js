// ============== LIFF: โหมดสำรวจภาคสนามบน LINE ==============
// ใช้ได้เฉพาะเจ้าหน้าที่ (admin/manager) ที่ผูก LINE กับตาราง users แล้ว
// ตัวตนมาจาก LIFF access token ที่ตรวจกับ LINE โดยตรง (lib/lineAuth.js) — ไม่เชื่อ userId ที่ client ส่งมา
// ฟังก์ชันทั้งหมดเป็น "public" ใน rpc.js (ไม่มี session เว็บ) จึงตรวจสิทธิ์เองทุกครั้งใน resolveStaff()
// รับเฉพาะฟิลด์ที่กำหนด (whitelist) — client ส่งฟิลด์อื่นมาก็ไม่ถูกบันทึก

const { SHEETS, setDoc, getDoc, listDocs } = require('../firestore');
const { newId, nowStr, todayStr, logAudit } = require('../util');
const { isStaffRole } = require('../auth');
const { verifyLineAccessToken } = require('../lineAuth');
const { addPhotoToEquipment, readLocations, normLoc, MAX_PHOTOS } = require('./equipment');

const CODE_RE = /^\d{4}$/;
const norm = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200);
const same = (a, b) => !!norm(a) && norm(a).toLowerCase() === norm(b).toLowerCase();
const MAX_B64 = 3_500_000; // ~2.6MB ต่อรูป (ฝั่งหน้าเว็บย่อรูปให้เล็กกว่านี้มากอยู่แล้ว)
const SUSPENDED = ['ระงับ', 'ไม่ใช้งาน', 'รออนุมัติ'];
const PERIPHERAL_TYPES = ['จอภาพ', 'คีย์บอร์ด', 'เมาส์', 'เครื่องสำรองไฟ (UPS)', 'ลำโพง', 'เครื่องพิมพ์', 'อื่นๆ'];

function tagPrefix(tag) {
  const m = /^\s*(\d{4})(?!\d)/.exec(String(tag == null ? '' : tag));
  return m ? m[1] : '';
}

// -> { staff:{name,role,dept,code} } หรือ { error, message }
async function resolveStaff(token) {
  const prof = await verifyLineAccessToken(token);
  if (!prof) return { error: 'unauthorized', message: 'ยืนยันตัวตน LINE ไม่สำเร็จ — กรุณาเปิดหน้านี้ผ่านแอป LINE อีกครั้ง' };
  const users = await listDocs(SHEETS.USERS);
  const u = users.find((x) => String(x['LINE ID'] || '').trim() === prof.userId);
  if (!u) return { error: 'not_registered', message: 'ยังไม่ได้ผูกบัญชี LINE กับระบบ — ส่งเลขบัตรประชาชน 13 หลักในแชท LINE ของโรงพยาบาลเพื่อผูกบัญชี', profile: prof };
  if (SUSPENDED.includes(String(u['สถานะ'] || '').trim())) return { error: 'suspended', message: 'บัญชีนี้ยังไม่ได้รับอนุมัติหรือถูกระงับ' };
  if (!isStaffRole(u['บทบาท'])) return { error: 'not_staff', message: 'โหมดสำรวจภาคสนามใช้ได้เฉพาะผู้ดูแลระบบ/ผู้จัดการ' };
  return { staff: { name: u['ชื่อ-นามสกุล'] || prof.displayName || 'เจ้าหน้าที่', role: u['บทบาท'] || '', dept: u['หน่วยงาน'] || '', code: u['รหัส'] || '' } };
}

const denied = (r) => ({ success: true, allowed: false, reason: r.error, message: r.message });

function compactItem(e) {
  return { id: e['รหัส'], tag: e['รหัสครุภัณฑ์'] || '', name: e['ชื่ออุปกรณ์'] || '', room: normLoc(e['ที่เก็บ']), noTag: e['สถานะป้ายครุภัณฑ์'] === 'ไม่มีป้าย', by: e['ผู้สำรวจ'] || '', parent: e['เชื่อมกับ'] || '', cat: e['หมวดหมู่'] || '' };
}

// ข้อมูลตั้งต้นของฟอร์ม: หมวด (พร้อมรหัส), สถานที่, หน่วยงาน, รายชื่อเจ้าหน้าที่, รายการอุปกรณ์แบบย่อ (ไว้เช็กซ้ำ/ดูของในห้อง)
async function getLiffSurveyInfo(token) {
  try {
    const r = await resolveStaff(token);
    if (r.error) return denied(r);
    const [cats, items, depts, users, master] = await Promise.all([
      listDocs(SHEETS.EQUIPMENT_CATEGORY), listDocs(SHEETS.EQUIPMENT), listDocs(SHEETS.DEPARTMENTS), listDocs(SHEETS.USERS), readLocations(),
    ]);
    const locs = new Map();
    master.concat(items.map((e) => normLoc(e['ที่เก็บ']))).forEach((n) => { if (n && !locs.has(n.toLowerCase())) locs.set(n.toLowerCase(), n); });
    const today = todayStr();
    const compact = items.map(compactItem);
    return {
      success: true,
      allowed: true,
      staff: r.staff,
      categories: cats.map((c) => ({ name: norm(c['ชื่อหมวด']), code: String(c['รหัสหมวด'] || '').trim() })).filter((c) => c.name)
        .sort((a, b) => (a.code && b.code ? a.code.localeCompare(b.code) : a.code ? -1 : b.code ? 1 : a.name.localeCompare(b.name, 'th'))),
      locations: Array.from(locs.values()).sort((a, b) => a.localeCompare(b, 'th', { numeric: true })),
      departments: depts.map((d) => norm(d['ชื่อหน่วยงาน'])).filter(Boolean).sort((a, b) => a.localeCompare(b, 'th')),
      staffList: users.filter((u) => !SUSPENDED.includes(String(u['สถานะ'] || '').trim()) && u['ชื่อ-นามสกุล'])
        .map((u) => ({ name: norm(u['ชื่อ-นามสกุล']), dept: norm(u['หน่วยงาน']) })),
      brands: Array.from(new Set(items.map((e) => norm(e['ยี่ห้อ'])).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'th')),
      items: compact,
      mine: compact.filter((c, i) => c.by === r.staff.name && String(items[i]['วันที่บันทึก'] || '').slice(0, 10) === today && items[i]['บันทึกจากการสำรวจภาคสนาม']),
      pending: compact.filter((c) => c.noTag).slice(0, 300),
      maxPhotos: MAX_PHOTOS,
      peripheralTypes: PERIPHERAL_TYPES,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// สร้างเอกสารอุปกรณ์จากฟอร์ม (ผ่านการตรวจแล้ว) หรือคืน error
async function buildSurveyDoc(d, staff, opts) {
  const o = opts || {};
  const items = await listDocs(SHEETS.EQUIPMENT);
  const cats = await listDocs(SHEETS.EQUIPMENT_CATEGORY);

  const name = norm(d.name, 200);
  if (!name) return { error: 'กรุณากรอกชื่ออุปกรณ์' };

  // ห้อง: ใช้ชื่อที่มีอยู่แล้วถ้าต่างแค่ตัวพิมพ์/ช่องว่าง (กันข้อมูลแตกเป็นหลายแบบ)
  const roomIn = o.parent ? normLoc(o.parent['ที่เก็บ']) || normLoc(d.room) : normLoc(d.room);
  if (!roomIn) return { error: 'กรุณากรอกห้อง/จุดติดตั้ง' };
  if (roomIn.length > 100) return { error: 'ชื่อห้องยาวเกิน 100 ตัวอักษร' };
  const known = (await readLocations()).concat(items.map((e) => normLoc(e['ที่เก็บ'])));
  const room = known.find((k) => k && same(k, roomIn)) || roomIn;

  let category = norm(o.parent ? (d.category || o.parent['หมวดหมู่']) : d.category, 100);
  if (category) {
    const hit = cats.find((c) => same(c['ชื่อหมวด'], category));
    if (!hit && cats.length) return { error: 'ไม่พบหมวดหมู่ "' + category + '" ในระบบ' };
    if (hit) category = norm(hit['ชื่อหมวด']);
  }

  const hasTag = d.hasTag === true;
  const tag = hasTag ? norm(d.tag, 60) : '';
  if (hasTag && !tag) return { error: 'กรอกเลขครุภัณฑ์ที่เห็นบนป้าย' };
  if (tag) {
    const dup = items.find((e) => same(e['รหัสครุภัณฑ์'], tag));
    if (dup) return { error: 'เลขครุภัณฑ์ ' + tag + ' มีในระบบแล้ว (' + (dup['ชื่ออุปกรณ์'] || dup['รหัส']) + ')' };
  }

  const dept = norm(d.dept, 120);
  if (dept && !(await listDocs(SHEETS.DEPARTMENTS)).some((x) => same(x['ชื่อหน่วยงาน'], dept))) return { error: 'ไม่พบหน่วยงาน "' + dept + '" ในระบบ' };

  const doc = {
    'รหัส': newId('EQ'),
    'รหัสครุภัณฑ์': tag, 'ชื่ออุปกรณ์': name, 'หมวดหมู่': category,
    'ยี่ห้อ': norm(d.brand, 100), 'รุ่น': norm(d.model, 100), 'Serial': norm(d.serial, 100),
    'จำนวน': 1, 'หน่วยนับ': 'เครื่อง', 'ที่เก็บ': room, 'มูลค่า': 0,
    'สถานะ': d.cond === 'bad' ? 'ชำรุด' : 'ประจำจุด',
    'หมายเหตุ': String(d.note == null ? '' : d.note).trim().slice(0, 500),
    'สถานะป้ายครุภัณฑ์': hasTag ? 'มีป้าย' : 'ไม่มีป้าย',
    'บันทึกจากการสำรวจภาคสนาม': true, 'ผู้สำรวจ': staff.name, 'แหล่งที่มา': 'LIFF',
    'รูปภาพทั้งหมด': [], 'รูปภาพ': '', 'ป้ายกำกับรูป': {},
    'วันที่บันทึก': nowStr(),
  };
  if (dept) doc['หน่วยงานที่รับผิดชอบ'] = dept;
  const resp = norm(d.resp, 120);
  if (resp) doc['ผู้รับผิดชอบ'] = resp;
  if (o.parent) {
    doc['เชื่อมกับ'] = o.parent['รหัส'];
    if (!dept && o.parent['หน่วยงานที่รับผิดชอบ']) doc['หน่วยงานที่รับผิดชอบ'] = o.parent['หน่วยงานที่รับผิดชอบ'];
    if (!resp && o.parent['ผู้รับผิดชอบ']) doc['ผู้รับผิดชอบ'] = o.parent['ผู้รับผิดชอบ'];
    doc['สถานะ'] = 'ประจำจุด';
  }
  return { doc };
}

async function saveLiffSurveyItem(token, data) {
  try {
    const r = await resolveStaff(token);
    if (r.error) return { success: false, error: r.error, message: r.message };
    const built = await buildSurveyDoc(data || {}, r.staff);
    if (built.error) return { success: false, message: built.error };
    await setDoc(SHEETS.EQUIPMENT, built.doc['รหัส'], built.doc);
    await logAudit('สำรวจภาคสนาม (LIFF) เพิ่มอุปกรณ์', r.staff.name, built.doc['ชื่ออุปกรณ์'] + ' @ ' + built.doc['ที่เก็บ']);
    return { success: true, code: built.doc['รหัส'], item: compactItem(built.doc) };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// อุปกรณ์เชื่อมต่อ (จอ/คีย์บอร์ด/เมาส์ ฯลฯ) ผูกกับเครื่องหลัก — ห้อง/หมวด/ผู้รับผิดชอบสืบทอดจากเครื่องหลัก
async function saveLiffSurveyPeripheral(token, parentId, data) {
  try {
    const r = await resolveStaff(token);
    if (r.error) return { success: false, error: r.error, message: r.message };
    const parent = await getDoc(SHEETS.EQUIPMENT, String(parentId || '').trim());
    if (!parent) return { success: false, message: 'ไม่พบเครื่องหลักที่จะเชื่อมต่อ' };
    const d = data || {};
    const type = norm(d.type, 60);
    if (!PERIPHERAL_TYPES.includes(type)) return { success: false, message: 'ชนิดอุปกรณ์ไม่ถูกต้อง' };
    const built = await buildSurveyDoc({ name: type, brand: d.brand, model: d.model, serial: d.serial, hasTag: d.hasTag, tag: d.tag, note: '' }, r.staff, { parent });
    if (built.error) return { success: false, message: built.error };
    await setDoc(SHEETS.EQUIPMENT, built.doc['รหัส'], built.doc);
    await logAudit('สำรวจภาคสนาม (LIFF) เพิ่มอุปกรณ์เชื่อมต่อ', r.staff.name, type + ' → ' + (parent['ชื่ออุปกรณ์'] || parent['รหัส']));
    return { success: true, code: built.doc['รหัส'], item: compactItem(built.doc) };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// รูปของอุปกรณ์ที่ตัวเองเพิ่งสำรวจผ่าน LIFF เท่านั้น (กันเขียนรูปทับอุปกรณ์อื่นด้วย token ที่ได้มา)
async function uploadLiffSurveyPhoto(token, code, base64Data, contentType, label) {
  try {
    const r = await resolveStaff(token);
    if (r.error) return { success: false, error: r.error, message: r.message };
    const b64 = String(base64Data || '');
    if (!b64 || b64.length > MAX_B64) return { success: false, message: 'ขนาดรูปไม่ถูกต้องหรือใหญ่เกินไป' };
    if (!/^image\/(jpeg|png|webp)$/i.test(String(contentType || ''))) return { success: false, message: 'รองรับเฉพาะรูป JPEG/PNG/WebP' };
    const item = await getDoc(SHEETS.EQUIPMENT, String(code || '').trim());
    if (!item) return { success: false, message: 'ไม่พบอุปกรณ์' };
    if (!(item['บันทึกจากการสำรวจภาคสนาม'] && item['ผู้สำรวจ'] === r.staff.name)) return { success: false, message: 'เพิ่มรูปได้เฉพาะอุปกรณ์ที่คุณสำรวจเอง' };
    return await addPhotoToEquipment(code, b64, contentType, label);
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ผูกเลขครุภัณฑ์ทีหลัง (รายการที่สำรวจแล้วไม่มีป้าย)
async function resolveLiffSurveyTag(token, id, newTag) {
  try {
    const r = await resolveStaff(token);
    if (r.error) return { success: false, error: r.error, message: r.message };
    const item = await getDoc(SHEETS.EQUIPMENT, String(id || '').trim());
    if (!item) return { success: false, message: 'ไม่พบอุปกรณ์' };
    if (item['สถานะป้ายครุภัณฑ์'] !== 'ไม่มีป้าย') return { success: false, message: 'อุปกรณ์นี้ไม่ได้อยู่ในรายการรอผูกเลข' };
    const tag = norm(newTag, 60);
    if (!tag) return { success: false, message: 'กรอกเลขครุภัณฑ์' };
    const items = await listDocs(SHEETS.EQUIPMENT);
    const dup = items.find((e) => same(e['รหัสครุภัณฑ์'], tag) && String(e['รหัส']) !== String(item['รหัส']));
    if (dup) return { success: false, message: 'เลขครุภัณฑ์ ' + tag + ' มีในระบบแล้ว (' + (dup['ชื่ออุปกรณ์'] || dup['รหัส']) + ')' };
    const updated = { ...item, 'รหัสครุภัณฑ์': tag, 'สถานะป้ายครุภัณฑ์': 'มีป้าย' };
    const prefix = tagPrefix(tag);
    const cat = prefix && CODE_RE.test(prefix) ? (await listDocs(SHEETS.EQUIPMENT_CATEGORY)).find((c) => String(c['รหัสหมวด'] || '').trim() === prefix) : null;
    if (cat) updated['หมวดหมู่'] = norm(cat['ชื่อหมวด']);
    delete updated._row;
    await setDoc(SHEETS.EQUIPMENT, item['รหัส'], updated);
    await logAudit('สำรวจภาคสนาม (LIFF) ผูกเลขครุภัณฑ์', r.staff.name, tag + ' → ' + (item['ชื่ออุปกรณ์'] || item['รหัส']));
    return { success: true, item: compactItem(updated), movedCategory: cat ? updated['หมวดหมู่'] : '' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { getLiffSurveyInfo, saveLiffSurveyItem, saveLiffSurveyPeripheral, uploadLiffSurveyPhoto, resolveLiffSurveyTag, buildSurveyDoc };
