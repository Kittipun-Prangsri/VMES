// ============== INSPECTION ==============
// พอร์ตจาก รหัส.js L1998-2011

const { SHEETS, setDoc, deleteDoc, listDocs } = require('../firestore');
const { newId, nowStr } = require('../util');
const { verifyAdmin } = require('../auth');

async function getInspection() {
  return listDocs(SHEETS.INSPECTION);
}

async function saveInspection(data, user) {
  if (!data['รหัส']) data['รหัส'] = newId('IN');
  data['วันที่บันทึก'] = nowStr();
  delete data._row;
  await setDoc(SHEETS.INSPECTION, data['รหัส'], data);
  return { success: true };
}

async function deleteInspection(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  await deleteDoc(SHEETS.INSPECTION, String(code));
  return { success: true };
}

module.exports = { getInspection, saveInspection, deleteInspection };
