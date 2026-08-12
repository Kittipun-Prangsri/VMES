// ============== VEHICLES ==============
// พอร์ตจาก รหัส.js L1553-1579 (saveVehicle/deleteVehicle), L1497 (getVehicles)

const { SHEETS, setDoc, deleteDoc, listDocs } = require('../firestore');
const { newId, nowStr, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');

async function getVehicles() {
  return listDocs(SHEETS.VEHICLES);
}

async function saveVehicle(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId('VH');
    data['วันที่บันทึก'] = nowStr();
    delete data._row;
    await setDoc(SHEETS.VEHICLES, data['รหัส'], data);
    await logAudit(isNew ? 'เพิ่มรถใหม่' : 'แก้ไขข้อมูลรถ', 'admin', data['ทะเบียน']);
    return { success: true, message: 'บันทึกสำเร็จ' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteVehicle(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const docId = String(code);
    await deleteDoc(SHEETS.VEHICLES, docId);
    await logAudit('ลบรถ', 'admin', docId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { getVehicles, saveVehicle, deleteVehicle };
