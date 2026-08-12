// ============== EQUIPMENT ==============
// พอร์ตจาก รหัส.js L1681-1707 (saveEquipment/deleteEquipment), L1502, L1511 (getEquipmentCategories)

const { SHEETS, setDoc, deleteDoc, listDocs } = require('../firestore');
const { newId, nowStr, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');

async function getEquipment() {
  return listDocs(SHEETS.EQUIPMENT);
}

async function getEquipmentCategories() {
  return listDocs(SHEETS.EQUIPMENT_CATEGORY);
}

async function saveEquipment(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId('EQ');
    data['วันที่บันทึก'] = nowStr();
    delete data._row;
    await setDoc(SHEETS.EQUIPMENT, data['รหัส'], data);
    await logAudit(isNew ? 'เพิ่มอุปกรณ์ใหม่' : 'แก้ไขข้อมูลอุปกรณ์', 'admin', data['ชื่ออุปกรณ์']);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteEquipment(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const docId = String(code);
    await deleteDoc(SHEETS.EQUIPMENT, docId);
    await logAudit('ลบอุปกรณ์', 'admin', docId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { getEquipment, getEquipmentCategories, saveEquipment, deleteEquipment };
