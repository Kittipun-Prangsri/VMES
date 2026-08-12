// ============== FUEL ==============
// พอร์ตจาก รหัส.js L1641-1679 (saveFuel/deleteFuel), L1661-1673 (updateFuelQuota_), L1500-1501

const { SHEETS, setDoc, deleteDoc, listDocs } = require('../firestore');
const { newId, nowStr, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');

async function getFuel() {
  return listDocs(SHEETS.FUEL);
}

async function getFuelQuota() {
  return listDocs(SHEETS.FUEL_QUOTA);
}

async function updateFuelQuota(plate, liters, money) {
  const all = await getFuelQuota();
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  const item = all.find((x) => x['ทะเบียน'] === plate && Number(x['เดือน']) === m && Number(x['ปี']) === y);
  if (item) {
    item['ใช้ไป(ลิตร)'] = (parseFloat(item['ใช้ไป(ลิตร)']) || 0) + liters;
    item['คงเหลือ(ลิตร)'] = (parseFloat(item['โควต้า(ลิตร)']) || 0) - item['ใช้ไป(ลิตร)'];
    item['ใช้จ่าย(บาท)'] = (parseFloat(item['ใช้จ่าย(บาท)']) || 0) + money;
    await setDoc(SHEETS.FUEL_QUOTA, item['รหัส'], item);
  }
}

async function saveFuel(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId('FL');
    data['วันที่บันทึก'] = nowStr();
    data['จำนวนเงิน'] = (parseFloat(data['จำนวนลิตร']) || 0) * (parseFloat(data['ราคา/ลิตร']) || 0);
    delete data._row;
    await setDoc(SHEETS.FUEL, data['รหัส'], data);
    if (isNew) {
      await updateFuelQuota(data['ทะเบียน'], parseFloat(data['จำนวนลิตร']), data['จำนวนเงิน']);
    }
    await logAudit('บันทึกน้ำมัน', 'admin', data['ทะเบียน'] + ' ' + data['จำนวนลิตร'] + 'ลิตร');
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteFuel(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  await deleteDoc(SHEETS.FUEL, String(code));
  return { success: true };
}

module.exports = { getFuel, getFuelQuota, updateFuelQuota, saveFuel, deleteFuel };
