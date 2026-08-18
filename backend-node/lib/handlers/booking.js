// ============== BOOKING ==============
// พอร์ตจาก รหัส.js L1971-1996 (saveBooking, approveBooking, deleteBooking)

const { SHEETS, setDoc, deleteDoc, getDoc, listDocs } = require('../firestore');
const { newId, nowStr, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');
const { sendBookingFlex } = require('../line');

async function getBooking() {
  return listDocs(SHEETS.BOOKING);
}

async function saveBooking(data, user) {
  if (!data['รหัส']) data['รหัส'] = newId('BK');
  if (!data['สถานะ']) data['สถานะ'] = 'รออนุมัติ';
  data['วันที่บันทึก'] = nowStr();
  delete data._row;
  await setDoc(SHEETS.BOOKING, data['รหัส'], data);
  await logAudit('จองรถล่วงหน้า', user || 'system', data['ทะเบียน']);
  await sendBookingFlex(data, data['สถานะ']);
  return { success: true };
}

async function approveBooking(code, approver) {
  const item = await getDoc(SHEETS.BOOKING, code);
  if (!item) return { success: false };
  item['สถานะ'] = 'อนุมัติแล้ว';
  item['ผู้อนุมัติ'] = approver;
  await setDoc(SHEETS.BOOKING, item['รหัส'], item);
  await sendBookingFlex(item, item['สถานะ']);
  return { success: true };
}

async function deleteBooking(code, adminCode, reason) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  const item = await getDoc(SHEETS.BOOKING, String(code));
  await deleteDoc(SHEETS.BOOKING, String(code));
  await logAudit('ลบการจองรถ', adminCode, 'รหัส: ' + code + (reason ? ' | เหตุผล: ' + reason : '') + (item ? ' (' + item['ทะเบียน'] + ')' : ''));
  return { success: true };
}

module.exports = { getBooking, saveBooking, approveBooking, deleteBooking };
