// ============== MAINTENANCE ==============
// พอร์ตจาก รหัส.js L1621-1639

const { SHEETS, setDoc, deleteDoc, listDocs } = require('../firestore');
const { newId, nowStr, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');

async function getMaintenance() {
  return listDocs(SHEETS.MAINTENANCE);
}

async function saveMaintenance(data, user) {
  try {
    if (!data['รหัส']) data['รหัส'] = newId('MT');
    data['วันที่บันทึก'] = nowStr();
    delete data._row;
    await setDoc(SHEETS.MAINTENANCE, data['รหัส'], data);
    await logAudit('บันทึกบำรุงรักษา', user || 'system', data['ทะเบียน']);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteMaintenance(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  await deleteDoc(SHEETS.MAINTENANCE, String(code));
  return { success: true };
}

module.exports = { getMaintenance, saveMaintenance, deleteMaintenance };
