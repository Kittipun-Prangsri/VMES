// ============== DEPARTMENTS ==============
// พอร์ตจาก รหัส.js L2013-2038

const { SHEETS, setDoc, deleteDoc, listDocs } = require('../firestore');
const { newId, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');

async function getDepartments() {
  return listDocs(SHEETS.DEPARTMENTS);
}

async function saveDepartment(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId('DP');
    delete data._row;
    await setDoc(SHEETS.DEPARTMENTS, data['รหัส'], data);
    await logAudit(isNew ? 'เพิ่มหน่วยงานใหม่' : 'แก้ไขข้อมูลหน่วยงาน', 'admin', data['ชื่อหน่วยงาน']);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteDepartment(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    const docId = String(code);
    await deleteDoc(SHEETS.DEPARTMENTS, docId);
    await logAudit('ลบหน่วยงาน', 'admin', docId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { getDepartments, saveDepartment, deleteDepartment };
