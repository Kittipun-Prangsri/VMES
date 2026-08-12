// ============== USAGE ==============
// พอร์ตจาก รหัส.js L1581-1619

const { SHEETS, setDoc, getDoc, listDocs } = require('../firestore');
const { newId, nowStr, logAudit } = require('../util');
const { sendVehicleUsageFlex } = require('../line');
const { getUserLineId } = require('./users');

async function getUsage() {
  return listDocs(SHEETS.USAGE);
}

async function saveUsage(data, user) {
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId('US');
    data['วันที่บันทึก'] = nowStr();
    if (!data['สถานะ']) data['สถานะ'] = 'อยู่ระหว่างใช้งาน';
    delete data._row;
    await setDoc(SHEETS.USAGE, data['รหัส'], data);
    if (isNew) {
      await sendVehicleUsageFlex(data);
      const userLineId = await getUserLineId(data['ผู้ขอใช้']);
      if (userLineId) {
        await sendVehicleUsageFlex(data, userLineId);
      }
    }
    await logAudit('บันทึกการใช้รถ', user || 'system', data['ทะเบียน'] + ' -> ' + data['สถานที่ไป']);
    return { success: true, message: 'บันทึกสำเร็จ' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function returnVehicle(code, returnData, user) {
  try {
    const item = await getDoc(SHEETS.USAGE, code);
    if (!item) throw new Error('ไม่พบข้อมูล');
    item['วันที่กลับ'] = returnData.dateReturn;
    item['เวลากลับ'] = returnData.timeReturn;
    item['ไมล์กลับ'] = returnData.mileReturn;
    item['ระยะทาง(กม.)'] = (returnData.mileReturn || 0) - (item['ไมล์ออก'] || 0);
    item['สถานะ'] = 'เสร็จสิ้น';
    await setDoc(SHEETS.USAGE, item['รหัส'], item);
    await logAudit('คืนรถ', user || 'system', item['ทะเบียน']);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { getUsage, saveUsage, returnVehicle };
