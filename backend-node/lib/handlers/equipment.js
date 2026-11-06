// ============== EQUIPMENT ==============
// พอร์ตจาก รหัส.js L1681-1707 (saveEquipment/deleteEquipment), L1502, L1511 (getEquipmentCategories)

const { SHEETS, setDoc, deleteDoc, listDocs, getDoc } = require('../firestore');
const { newId, nowStr, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');
const { uploadBase64Image } = require('../storage');

async function getEquipment() {
  return listDocs(SHEETS.EQUIPMENT);
}

async function getEquipmentCategories() {
  return listDocs(SHEETS.EQUIPMENT_CATEGORY);
}

// ---- ฟิลด์เพิ่มเติมของทะเบียนครุภัณฑ์ ----
const DEPRECIATION_TYPES = ['ไม่คิดค่าเสื่อม', 'เส้นตรง (Straight-line)', 'ยอดลดลง (Declining balance)', 'ผลผลิตหน่วย (Units of production)'];
const MAX_PHOTOS = 6;
const SHORT_TEXT_MAX = 200;
const normText = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || SHORT_TEXT_MAX);
const isUrl = (u) => /^https?:\/\/\S+$/i.test(String(u || ''));

// รูปทั้งหมดของอุปกรณ์ (เรียงตามลำดับ รูปแรก = รูปหลัก) — รองรับข้อมูลเก่าที่มีแค่ 'รูปภาพ' เดียว
function photoListOf(doc) {
  const arr = Array.isArray(doc && doc['รูปภาพทั้งหมด']) ? doc['รูปภาพทั้งหมด'].filter(isUrl) : [];
  if (arr.length) return arr;
  return doc && isUrl(doc['รูปภาพ']) ? [doc['รูปภาพ']] : [];
}

// ตรวจ/ทำความสะอาดเฉพาะฟิลด์ใหม่ที่ client ส่งมา (ไม่แตะฟิลด์เดิม เพื่อไม่กระทบการนำเข้า/ฟอร์มอื่น)
function sanitizeExtraFields(d) {
  ['ประเภทครุภัณฑ์', 'ผู้จำหน่าย', 'หน่วยงานที่รับผิดชอบ', 'ผู้รับผิดชอบ'].forEach((k) => {
    if (k in d) d[k] = normText(d[k]);
  });
  if ('ประเภทค่าเสื่อม' in d) {
    const v = normText(d['ประเภทค่าเสื่อม']);
    if (v && !DEPRECIATION_TYPES.includes(v)) return 'ประเภทค่าเสื่อมไม่ถูกต้อง';
    d['ประเภทค่าเสื่อม'] = v;
  }
  if ('อายุการใช้งานปี' in d) {
    const raw = d['อายุการใช้งานปี'];
    if (raw === '' || raw == null) d['อายุการใช้งานปี'] = '';
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100) return 'อายุการใช้งานต้องอยู่ระหว่าง 0–100 ปี';
      d['อายุการใช้งานปี'] = n;
    }
  }
  if ('รูปภาพทั้งหมด' in d) {
    const list = Array.isArray(d['รูปภาพทั้งหมด']) ? d['รูปภาพทั้งหมด'] : [];
    const clean = [];
    for (const u of list) {
      if (!isUrl(u)) return 'ลิงก์รูปภาพไม่ถูกต้อง';
      if (!clean.includes(u)) clean.push(u);
    }
    if (clean.length > MAX_PHOTOS) return 'แนบรูปได้ไม่เกิน ' + MAX_PHOTOS + ' รูปต่ออุปกรณ์';
    d['รูปภาพทั้งหมด'] = clean;
    d['รูปภาพ'] = clean[0] || ''; // รูปหลัก = รูปแรกเสมอ (ตารางคลัง/ป้าย/หน้าอื่นอ่านจากฟิลด์นี้)
  }
  return '';
}

async function saveEquipment(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId('EQ');
    // ตอนแก้ไข: รวมกับเอกสารเดิมก่อน เพราะ setDoc ฝั่ง Supabase เป็น full replace — ฟอร์มแก้ไขส่งมาแค่บางฟิลด์
    // ถ้าไม่รวม รูปภาพ/เชื่อมกับ/สถานะป้ายครุภัณฑ์/ข้อมูลสำรวจภาคสนาม จะหายทุกครั้งที่กดบันทึก
    if (!isNew) {
      const existing = await getDoc(SHEETS.EQUIPMENT, String(data['รหัส']));
      if (existing) data = { ...existing, ...data };
    }
    const bad = sanitizeExtraFields(data);
    if (bad) return { success: false, message: bad };
    data['วันที่บันทึก'] = nowStr();
    delete data._row;
    await setDoc(SHEETS.EQUIPMENT, data['รหัส'], data);
    await logAudit(isNew ? 'เพิ่มอุปกรณ์ใหม่' : 'แก้ไขข้อมูลอุปกรณ์', 'admin', data['ชื่ออุปกรณ์']);
    return { success: true, code: data['รหัส'] };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteEquipment(code, adminCode, reason) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const docId = String(code);
    const item = await getDoc(SHEETS.EQUIPMENT, docId);
    await deleteDoc(SHEETS.EQUIPMENT, docId);
    await logAudit('ลบอุปกรณ์', 'admin', docId + (item ? ' (' + (item['ชื่ออุปกรณ์'] || '') + ')' : '') + (reason ? ' | เหตุผล: ' + reason : ''));
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// อัปโหลดรูปครุภัณฑ์ "เพิ่มต่อท้าย" รายการรูปของอุปกรณ์ (สูงสุด MAX_PHOTOS รูป; รูปแรกคือรูปหลัก)
// ดึงเอกสารเดิมมาก่อนแล้วเขียนกลับทั้งฉบับ เพราะ setDoc เป็น full replace ไม่ merge (ดู setDoc ใน
// ../firestore.js) ถ้าส่งแค่ฟิลด์รูปไปตรงๆ จะเผลอลบฟิลด์อื่นของอุปกรณ์ทิ้งหมด
async function uploadEquipmentPhoto(code, base64Data, contentType, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const docId = String(code || '').trim();
    if (!docId) return { success: false, message: 'ไม่พบรหัสอุปกรณ์' };
    const existing = await getDoc(SHEETS.EQUIPMENT, docId);
    if (!existing) return { success: false, message: 'ไม่พบข้อมูลอุปกรณ์นี้แล้ว' };
    const list = photoListOf(existing);
    if (list.length >= MAX_PHOTOS) return { success: false, message: 'แนบรูปได้ไม่เกิน ' + MAX_PHOTOS + ' รูปต่ออุปกรณ์' };

    const ext = (contentType || 'image/jpeg').split('/')[1] || 'jpg';
    const destPath = `equipment-photos/${docId}-${Date.now()}.${ext}`;
    const url = await uploadBase64Image(base64Data, destPath, contentType);

    const photos = list.concat(url);
    const updated = { ...existing, 'รูปภาพทั้งหมด': photos, 'รูปภาพ': photos[0] };
    delete updated._row;
    await setDoc(SHEETS.EQUIPMENT, docId, updated);
    return { success: true, url, count: photos.length };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============== สถานที่จัดเก็บ (ที่เก็บ) ==============
// "ที่เก็บ" ของอุปกรณ์เป็นข้อความอิสระ ไม่มีตาราง master — เก็บรายการสถานที่ที่ตั้งไว้ล่วงหน้า
// (ยังไม่มีอุปกรณ์ใช้) เป็น JSON array ใน settings คีย์ EQUIPMENT_LOCATIONS (แบบเดียวกับ SYSTEM_ROLES)
// การเปลี่ยนชื่อจะอัปเดตอุปกรณ์ทุกชิ้นที่ใช้ชื่อเดิมให้ด้วย
const LOC_KEY = 'EQUIPMENT_LOCATIONS';
const LOC_MAX_LEN = 100;

function normLoc(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}
const sameLoc = (a, b) => normLoc(a).toLowerCase() === normLoc(b).toLowerCase();

async function readLocations() {
  const rows = await listDocs(SHEETS.SETTINGS);
  const row = rows.find((r) => String(r['Key'] || '').trim() === LOC_KEY);
  try {
    const arr = JSON.parse((row && row['Value']) || '[]');
    return Array.isArray(arr) ? arr.map(normLoc).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

async function writeLocations(list) {
  const seen = new Set();
  const clean = list
    .map(normLoc)
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  await setDoc(SHEETS.SETTINGS, LOC_KEY, { Key: LOC_KEY, Value: JSON.stringify(clean) });
  return clean;
}

function validateLocName(n) {
  if (!n) return 'กรุณาระบุชื่อสถานที่จัดเก็บ';
  if (n.length > LOC_MAX_LEN) return 'ชื่อสถานที่ยาวเกิน ' + LOC_MAX_LEN + ' ตัวอักษร';
  return '';
}

async function addEquipmentLocation(name, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const n = normLoc(name);
    const bad = validateLocName(n);
    if (bad) return { success: false, message: bad };
    const list = await readLocations();
    const items = await listDocs(SHEETS.EQUIPMENT);
    const inUse = items.find((e) => sameLoc(e['ที่เก็บ'], n));
    const existing = list.find((x) => sameLoc(x, n)) || (inUse && normLoc(inUse['ที่เก็บ']));
    if (existing) {
      // มีใช้อยู่แล้วในอุปกรณ์แต่ยังไม่อยู่ใน master -> เพิ่มเข้า master ด้วยชื่อที่ใช้จริง
      if (!list.some((x) => sameLoc(x, existing))) await writeLocations(list.concat(existing));
      return { success: true, name: existing, existed: true };
    }
    await writeLocations(list.concat(n));
    await logAudit('เพิ่มสถานที่จัดเก็บ', 'admin', n);
    return { success: true, name: n, existed: false };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// allowMerge: ชื่อใหม่ซ้ำกับสถานที่อื่นที่มีอยู่ = ควบรวมสองห้องเป็นห้องเดียว ย้อนกลับไม่ได้ จึงต้องยืนยันชัดเจน
// (ไม่ส่ง allowMerge จะไม่ทำอะไรและคืน needsMerge พร้อมจำนวนอุปกรณ์ให้ฝั่งหน้าเว็บถามผู้ใช้)
async function renameEquipmentLocation(oldName, newName, adminCode, allowMerge) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const o = normLoc(oldName);
    const n = normLoc(newName);
    const bad = validateLocName(n);
    if (bad) return { success: false, message: bad };
    if (!o) return { success: false, message: 'ไม่พบชื่อสถานที่เดิม' };

    const list = await readLocations();
    const items = await listDocs(SHEETS.EQUIPMENT);
    const affected = items.filter((e) => sameLoc(e['ที่เก็บ'], o));
    if (!affected.length && !list.some((x) => sameLoc(x, o))) {
      return { success: false, message: 'ไม่พบสถานที่ "' + o + '" ในระบบ' };
    }
    // ชื่อใหม่ชนกับสถานที่อื่นที่มีอยู่ = ควบรวม (ยกเว้นเป็นชื่อเดียวกันกับของเดิมที่แค่แก้ตัวพิมพ์/ช่องว่าง)
    const merged = !sameLoc(o, n) && (list.some((x) => sameLoc(x, n)) || items.some((e) => sameLoc(e['ที่เก็บ'], n)));
    const finalName = merged ? (list.find((x) => sameLoc(x, n)) || normLoc((items.find((e) => sameLoc(e['ที่เก็บ'], n)) || {})['ที่เก็บ']) || n) : n;

    if (merged && allowMerge !== true) {
      return {
        success: false,
        needsMerge: true,
        from: o,
        fromCount: affected.length,
        target: finalName,
        targetCount: items.filter((e) => sameLoc(e['ที่เก็บ'], finalName)).length,
        message: 'ชื่อ "' + finalName + '" มีอยู่แล้ว — ต้องยืนยันการควบรวม',
      };
    }

    let updated = 0;
    for (let i = 0; i < affected.length; i += 10) {
      await Promise.all(
        affected.slice(i, i + 10).map(async (item) => {
          const id = String(item['รหัส'] || item.id || item._id || '').trim();
          if (!id) return;
          const doc = { ...item, 'ที่เก็บ': finalName };
          delete doc._row;
          await setDoc(SHEETS.EQUIPMENT, id, doc);
          updated++;
        })
      );
    }
    await writeLocations(list.filter((x) => !sameLoc(x, o)).concat(finalName));
    await logAudit('แก้ไขสถานที่จัดเก็บ', 'admin', o + ' -> ' + finalName + ' (อัปเดตอุปกรณ์ ' + updated + ' รายการ' + (merged ? ', ควบรวม' : '') + ')');
    return { success: true, name: finalName, updated, merged };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ลบได้เฉพาะสถานที่ที่ไม่มีอุปกรณ์ใช้อยู่ (กันอุปกรณ์กลายเป็นไม่มีที่เก็บโดยไม่ตั้งใจ)
async function deleteEquipmentLocation(name, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const n = normLoc(name);
    if (!n) return { success: false, message: 'ไม่พบชื่อสถานที่' };
    const items = await listDocs(SHEETS.EQUIPMENT);
    const using = items.filter((e) => sameLoc(e['ที่เก็บ'], n)).length;
    if (using) return { success: false, message: 'ลบไม่ได้: ยังมีอุปกรณ์ ' + using + ' รายการใช้สถานที่นี้อยู่ (ย้ายหรือเปลี่ยนชื่อก่อน)' };
    const list = await readLocations();
    if (!list.some((x) => sameLoc(x, n))) return { success: false, message: 'ไม่พบสถานที่ "' + n + '" ในรายการ' };
    await writeLocations(list.filter((x) => !sameLoc(x, n)));
    await logAudit('ลบสถานที่จัดเก็บ', 'admin', n);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  getEquipment, getEquipmentCategories, saveEquipment, deleteEquipment, uploadEquipmentPhoto,
  addEquipmentLocation, renameEquipmentLocation, deleteEquipmentLocation,
  sanitizeExtraFields, photoListOf, DEPRECIATION_TYPES, MAX_PHOTOS,
};
