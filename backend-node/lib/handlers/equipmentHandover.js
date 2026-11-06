// ============== EQUIPMENT HANDOVER (ใบส่งมอบ/รับคืนครุภัณฑ์) ==============
// บันทึกหลักฐานการส่งมอบครุภัณฑ์ให้หน่วยงาน/ผู้รับผิดชอบ และการรับคืนภายหลัง —
// แยกจากระบบยืม-คืนอุปกรณ์ (borrowing) ซึ่งใช้สำหรับยืมระยะสั้น เอกสารชุดนี้ใช้เมื่อ
// มอบครุภัณฑ์ให้ประจำอยู่กับหน่วยงาน/บุคคล เป็นหลักฐานทางราชการที่ต้องมีลายเซ็นยืนยัน
//
// มาตรฐานฝั่ง server (ไม่เชื่อค่าจาก client): ต้องเป็น admin/manager, ผู้บันทึกมาจาก session,
// ตรวจครุภัณฑ์/หน่วยงาน/วันที่ ก่อนบันทึก และคำนวณ 'สถานะ' เองจากวันที่รับคืน

const { SHEETS, setDoc, deleteDoc, getDoc, listDocs } = require('../firestore');
const { newId, nowStr, logAudit } = require('../util');
const { verifyAdmin, getSessionUser } = require('../auth');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_MAX = 300;

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || TEXT_MAX);
const validDate = (s) => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
};

// ฟิลด์ข้อความที่รับจากฟอร์ม (ฟิลด์เช็กลิสต์ *Check_* เป็น boolean แยกต่างหาก)
const TEXT_FIELDS = [
  'เลขครุภัณฑ์', 'รุ่น', 'สเปค', 'ผู้รับผิดชอบ',
  'ส่งมอบ_ผู้รับ', 'ส่งมอบ_ผู้ส่งมอบ', 'รับคืน_ผู้ส่งคืน', 'รับคืน_ผู้รับคืน',
  'giveItem1Label', 'giveOtherNote', 'returnItem1Label', 'returnOtherNote',
];
const DATE_FIELDS = ['วันที่ใช้งานครั้งแรก', 'ส่งมอบ_วันที่รับ', 'ส่งมอบ_วันที่ส่งมอบ', 'รับคืน_วันที่ส่งคืน', 'รับคืน_วันที่รับคืน'];
const CHECK_FIELDS = ['give', 'return'].flatMap((p) => ['item1', 'scratch', 'crack', 'notReady'].map((k) => p + 'Check_' + k));

// สร้างเอกสารที่ผ่านการตรวจแล้ว หรือคืนข้อความ error — แยกเป็นฟังก์ชันล้วนเพื่อทดสอบง่าย
function buildHandoverDoc(input, equipment, existing) {
  const d = input || {};
  if (!equipment) return { error: 'ไม่พบข้อมูลครุภัณฑ์ที่เลือก' };
  const dept = clean(d['ส่งมอบให้หน่วยงาน'], 120);
  if (!dept) return { error: 'กรุณาเลือกหน่วยงานที่ส่งมอบให้' };

  const doc = { ...(existing || {}) };
  doc.equipId = String(equipment['รหัส'] || equipment.id || '').trim();
  doc['รายการ'] = clean(equipment['ชื่ออุปกรณ์'], 200); // ชื่อรายการอ้างจากทะเบียนครุภัณฑ์ ไม่ใช่ค่าจาก client
  doc['ส่งมอบให้หน่วยงาน'] = dept;
  TEXT_FIELDS.forEach((k) => { doc[k] = clean(d[k]); });
  for (const k of DATE_FIELDS) {
    const v = clean(d[k], 10);
    if (v && !validDate(v)) return { error: 'รูปแบบวันที่ไม่ถูกต้อง (' + k + ') ต้องเป็น ปปปป-ดด-วว' };
    doc[k] = v;
  }
  CHECK_FIELDS.forEach((k) => { doc[k] = d[k] === true; });
  const price = Number(d['ราคา']);
  doc['ราคา'] = Number.isFinite(price) && price >= 0 ? price : 0;
  const useNo = Math.floor(Number(d['ใช้งานครั้งที่']));
  doc['ใช้งานครั้งที่'] = Number.isFinite(useNo) && useNo >= 1 ? useNo : 1;

  const give = doc['ส่งมอบ_วันที่ส่งมอบ'];
  const back = doc['รับคืน_วันที่ส่งคืน'];
  const recv = doc['รับคืน_วันที่รับคืน'];
  if (give && back && back < give) return { error: 'วันที่ส่งคืนต้องไม่ก่อนวันที่ส่งมอบ' };
  if (back && recv && recv < back) return { error: 'วันที่รับคืนต้องไม่ก่อนวันที่ส่งคืน' };
  doc['สถานะ'] = back && recv ? 'รับคืนแล้ว' : 'ส่งมอบแล้ว'; // คำนวณเอง ไม่เชื่อค่าจาก client
  return { doc };
}

async function saveEquipmentHandover(data) {
  try {
    if (!verifyAdmin('')) return { success: false, message: 'ต้องเป็นผู้ดูแลระบบหรือผู้จัดการ' };
    const input = data || {};
    const me = await getSessionUser(this && this.session);
    const who = (me && me.name) || 'system';

    const id = String(input['รหัส'] || '').trim();
    let existing = null;
    if (id) {
      existing = await getDoc(SHEETS.EQUIPMENT_HANDOVER, id);
      if (!existing) return { success: false, message: 'ไม่พบใบส่งมอบที่จะแก้ไข' };
    }
    const equipId = String(input.equipId || (existing && existing.equipId) || '').trim();
    const equipment = equipId ? await getDoc(SHEETS.EQUIPMENT, equipId) : null;

    const built = buildHandoverDoc(input, equipment, existing);
    if (built.error) return { success: false, message: built.error };
    const doc = built.doc;
    doc['รหัส'] = id || newId('HO');
    doc['วันที่บันทึก'] = nowStr();
    doc['บันทึกโดย'] = who;
    if (!existing) doc['สร้างโดย'] = who;
    delete doc._row;

    await setDoc(SHEETS.EQUIPMENT_HANDOVER, doc['รหัส'], doc);
    await logAudit(existing ? 'แก้ไขใบส่งมอบครุภัณฑ์' : 'สร้างใบส่งมอบครุภัณฑ์', who, doc['รหัส'] + ' ' + doc['รายการ'] + ' → ' + doc['ส่งมอบให้หน่วยงาน'] + ' (' + doc['สถานะ'] + ')');
    return { success: true, id: doc['รหัส'], status: doc['สถานะ'] };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteEquipmentHandover(code, adminCode) {
  try {
    if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
    const id = String(code || '').trim();
    const existing = id ? await getDoc(SHEETS.EQUIPMENT_HANDOVER, id) : null;
    if (!existing) return { success: false, message: 'ไม่พบใบส่งมอบ' };
    const me = await getSessionUser(this && this.session);
    await deleteDoc(SHEETS.EQUIPMENT_HANDOVER, id);
    await logAudit('ลบใบส่งมอบครุภัณฑ์', (me && me.name) || 'admin', id + ' ' + (existing['รายการ'] || ''));
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { saveEquipmentHandover, deleteEquipmentHandover, buildHandoverDoc };
