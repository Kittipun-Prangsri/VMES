// ============== BOOKING ==============
// พอร์ตจาก รหัส.js L1971-1996 (saveBooking, approveBooking, deleteBooking)
// เพิ่ม: ตรวจเวลาจองชนกัน, ตรวจสิทธิ์ผู้อนุมัติจาก session, ไม่อนุมัติ/ยกเลิก (updateBookingStatus)

const { SHEETS, setDoc, deleteDoc, getDoc, listDocs } = require('../firestore');
const { newId, nowStr, todayStr, logAudit } = require('../util');
const { verifyAdmin, getSessionUser, isStaffRole } = require('../auth');
const { sendBookingFlex } = require('../line');

// สถานะที่ยังกันรถ/คนขับไว้ — ไม่อนุมัติ/ยกเลิกแล้วไม่นับว่าชน
const ACTIVE_STATUSES = ['รออนุมัติ', 'อนุมัติแล้ว'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function getBooking() {
  return listDocs(SHEETS.BOOKING);
}

// หา booking ที่ใช้รถคันเดียวกันหรือคนขับคนเดียวกัน ในวันเดียวกันและช่วงเวลาทับกัน
// (ชนกันเมื่อ start < otherEnd && otherStart < end — ต่อเวลากันพอดี เช่น 12:00 กับ 12:00 ไม่นับว่าชน)
function findConflicts(data, all, statuses) {
  const plate = String(data['ทะเบียน'] || '').trim();
  const driver = String(data['พนักงานขับรถ'] || '').trim();
  return all.filter((b) => {
    if (String(b['รหัส']) === String(data['รหัส'] || '')) return false;
    if (!statuses.includes(b['สถานะ'])) return false;
    if (String(b['วันที่ใช้'] || '') !== data['วันที่ใช้']) return false;
    const sameCar = plate && String(b['ทะเบียน'] || '').trim() === plate;
    const sameDriver = driver && String(b['พนักงานขับรถ'] || '').trim() === driver;
    if (!sameCar && !sameDriver) return false;
    const bStart = String(b['เวลาเริ่ม'] || '00:00');
    const bEnd = String(b['เวลาสิ้นสุด'] || '23:59');
    return data['เวลาเริ่ม'] < bEnd && bStart < data['เวลาสิ้นสุด'];
  });
}

function conflictMessage(data, conflicts) {
  const plate = String(data['ทะเบียน'] || '').trim();
  const lines = conflicts.map((b) => {
    const what = String(b['ทะเบียน'] || '').trim() === plate ? 'รถ ' + b['ทะเบียน'] : 'คนขับ ' + b['พนักงานขับรถ'];
    return `• ${what} ถูกจองแล้ว ${b['เวลาเริ่ม']}-${b['เวลาสิ้นสุด']} โดย ${b['ผู้ขอจอง'] || '-'} (${b['สถานะ']})`;
  });
  return 'ช่วงเวลานี้ถูกจองไปแล้ว:\n' + lines.join('\n');
}

function validateBooking(data) {
  if (!String(data['ผู้ขอจอง'] || '').trim()) return 'กรุณาระบุผู้ขอจอง';
  if (!String(data['ทะเบียน'] || '').trim()) return 'กรุณาเลือกรถ';
  if (!String(data['สถานที่ไป'] || '').trim()) return 'กรุณาระบุสถานที่ไป';
  if (!DATE_RE.test(String(data['วันที่ใช้'] || ''))) return 'กรุณาระบุวันที่ใช้ให้ถูกต้อง';
  if (data['วันที่ใช้'] < todayStr()) return 'ไม่สามารถจองย้อนหลังได้';
  if (!TIME_RE.test(String(data['เวลาเริ่ม'] || '')) || !TIME_RE.test(String(data['เวลาสิ้นสุด'] || ''))) return 'กรุณาระบุเวลาให้ถูกต้อง';
  if (data['เวลาเริ่ม'] >= data['เวลาสิ้นสุด']) return 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม';
  return null;
}

async function saveBooking(data, user) {
  data = { ...(data || {}) };
  delete data._row;
  const existing = data['รหัส'] ? await getDoc(SHEETS.BOOKING, String(data['รหัส'])) : null;

  const err = validateBooking(data);
  if (err) return { success: false, message: err };

  const conflicts = findConflicts(data, await getBooking(), ACTIVE_STATUSES);
  if (conflicts.length) return { success: false, message: conflictMessage(data, conflicts), conflict: true };

  if (!data['รหัส']) data['รหัส'] = newId('BK');
  // สถานะเปลี่ยนได้ผ่าน approve/updateBookingStatus เท่านั้น — ไม่เชื่อค่าที่ client ส่งมา
  data['สถานะ'] = existing ? existing['สถานะ'] : 'รออนุมัติ';
  data['วันที่บันทึก'] = nowStr();
  await setDoc(SHEETS.BOOKING, data['รหัส'], data);
  await logAudit('จองรถล่วงหน้า', user || 'system', data['ทะเบียน']);
  await sendBookingFlex(data, data['สถานะ']);
  return { success: true, code: data['รหัส'] };
}

// อนุมัติ / ไม่อนุมัติ: เฉพาะ admin/manager
// ยกเลิก: เจ้าของคำขอ (ชื่อตรงกับผู้ขอจอง) หรือ admin/manager
async function updateBookingStatus(code, newStatus, reason) {
  const me = await getSessionUser(this && this.session);
  if (!me) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  const staff = isStaffRole(me.role);

  const item = await getDoc(SHEETS.BOOKING, String(code));
  if (!item) return { success: false, message: 'ไม่พบคำขอจอง' };

  const isOwner = String(item['ผู้ขอจอง'] || '').trim() === String(me.name || '').trim();
  if (newStatus === 'อนุมัติแล้ว' || newStatus === 'ไม่อนุมัติ') {
    if (!staff) return { success: false, message: 'เฉพาะผู้ดูแลระบบหรือผู้จัดการเท่านั้นที่อนุมัติได้' };
    if (item['สถานะ'] !== 'รออนุมัติ') return { success: false, message: 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ' };
  } else if (newStatus === 'ยกเลิก') {
    if (!staff && !isOwner) return { success: false, message: 'ยกเลิกได้เฉพาะผู้ขอจองหรือผู้ดูแลระบบ' };
    if (!ACTIVE_STATUSES.includes(item['สถานะ'])) return { success: false, message: 'คำขอนี้ปิดไปแล้ว' };
  } else {
    return { success: false, message: 'สถานะไม่ถูกต้อง' };
  }

  if (newStatus === 'ไม่อนุมัติ' && !String(reason || '').trim()) {
    return { success: false, message: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' };
  }

  // ข้อมูลเก่าอาจมีคำขอรออนุมัติที่ชนกันอยู่แล้ว — ห้ามอนุมัติทับคันที่อนุมัติไปแล้ว
  if (newStatus === 'อนุมัติแล้ว') {
    const conflicts = findConflicts(item, await getBooking(), ['อนุมัติแล้ว']);
    if (conflicts.length) return { success: false, message: conflictMessage(item, conflicts), conflict: true };
  }

  item['สถานะ'] = newStatus;
  if (newStatus === 'ยกเลิก') {
    item['ผู้ยกเลิก'] = me.name;
  } else {
    item['ผู้อนุมัติ'] = me.name;
  }
  item['วันที่ดำเนินการ'] = nowStr();
  if (reason) item['เหตุผล'] = String(reason).trim();
  await setDoc(SHEETS.BOOKING, item['รหัส'], item);
  await logAudit('การจองรถ: ' + newStatus, me.name, item['ทะเบียน'] + ' ' + item['วันที่ใช้'] + (reason ? ' | เหตุผล: ' + reason : ''));
  await sendBookingFlex(item, newStatus);
  return { success: true };
}

// คงชื่อเดิมไว้ให้ frontend รุ่นเก่าที่ยังเปิดค้างอยู่เรียกได้ (approver จาก client ไม่ใช้แล้ว)
async function approveBooking(code) {
  return updateBookingStatus.call(this, code, 'อนุมัติแล้ว');
}

async function deleteBooking(code, adminCode, reason) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  const item = await getDoc(SHEETS.BOOKING, String(code));
  await deleteDoc(SHEETS.BOOKING, String(code));
  await logAudit('ลบการจองรถ', adminCode, 'รหัส: ' + code + (reason ? ' | เหตุผล: ' + reason : '') + (item ? ' (' + item['ทะเบียน'] + ')' : ''));
  return { success: true };
}

module.exports = { getBooking, saveBooking, approveBooking, updateBookingStatus, deleteBooking, findConflicts };
