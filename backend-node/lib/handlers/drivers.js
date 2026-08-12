// ============== DRIVERS ==============
// พอร์ตจาก รหัส.js L1954-1968

const { SHEETS, setDoc, deleteDoc, listDocs } = require('../firestore');
const { newId, todayStr } = require('../util');
const { verifyAdmin } = require('../auth');

async function getDrivers() {
  return listDocs(SHEETS.DRIVERS);
}

async function saveDriver(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  if (!data['รหัส']) data['รหัส'] = newId('DR');
  data['วันที่บันทึก'] = todayStr();
  delete data._row;
  await setDoc(SHEETS.DRIVERS, data['รหัส'], data);
  return { success: true };
}

async function deleteDriver(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  await deleteDoc(SHEETS.DRIVERS, String(code));
  return { success: true };
}

module.exports = { getDrivers, saveDriver, deleteDriver };
