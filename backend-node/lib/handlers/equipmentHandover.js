// ============== EQUIPMENT HANDOVER (ใบส่งมอบ/รับคืนครุภัณฑ์) ==============
// บันทึกหลักฐานการส่งมอบครุภัณฑ์ให้หน่วยงาน/ผู้รับผิดชอบ และการรับคืนภายหลัง —
// แยกจากระบบยืม-คืนอุปกรณ์ (borrowing) ซึ่งใช้สำหรับยืมระยะสั้น เอกสารชุดนี้ใช้เมื่อ
// มอบครุภัณฑ์ให้ประจำอยู่กับหน่วยงาน/บุคคล เป็นหลักฐานทางราชการที่ต้องมีลายเซ็นยืนยัน

const { SHEETS, setDoc, deleteDoc } = require('../firestore');
const { newId, nowStr } = require('../util');
const { verifyAdmin } = require('../auth');

async function saveEquipmentHandover(data, user) {
  if (!data['รหัส']) data['รหัส'] = newId('HO');
  data['วันที่บันทึก'] = nowStr();
  data['บันทึกโดย'] = user || 'system';
  delete data._row;
  await setDoc(SHEETS.EQUIPMENT_HANDOVER, data['รหัส'], data);
  return { success: true, id: data['รหัส'] };
}

async function deleteEquipmentHandover(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  await deleteDoc(SHEETS.EQUIPMENT_HANDOVER, String(code));
  return { success: true };
}

module.exports = { saveEquipmentHandover, deleteEquipmentHandover };
