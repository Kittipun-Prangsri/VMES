// ============== getAllData (ตัดข้อมูลอ่อนไหวตามสิทธิ์) ==============
// เดิม getAllData คืนทุกคอลัมน์ของทุกตารางให้ผู้ล็อกอินทุกบทบาท — รวม LINE/Telegram token และ
// เลขบัตรประชาชนของผู้ใช้ทุกคน และ audit log ตอนนี้:
//   - ทุกคน: ไม่ได้รับ 'รหัสผ่าน' (เก็บแยกใน userCredentials อยู่แล้ว)
//   - ผู้ใช้ทั่วไป: ไม่ได้รับ เลขบัตรประชาชน / LINE / Telegram ของ "คนอื่น" และไม่ได้รับ audit log
//   - admin/manager: ได้ครบเหมือนเดิม (หน้าจัดการผู้ใช้/audit ต้องใช้)

const { getAllData: rawGetAllData } = require('../firestore');
const { adminCtx } = require('../auth');

const ALWAYS_HIDDEN = ['รหัสผ่าน'];
const HIDDEN_FROM_NON_STAFF = ['เลขบัตรประชาชน', 'idCard', 'LINE Token', 'Telegram Token', 'Telegram ID', 'LINE ID', 'LINE Display Name'];

function redactUser(u, canSeeAll) {
  const out = { ...u };
  ALWAYS_HIDDEN.forEach((k) => delete out[k]);
  if (!canSeeAll) HIDDEN_FROM_NON_STAFF.forEach((k) => delete out[k]);
  return out;
}

function redactAllData(data, { isStaff, uid }) {
  const out = { ...data };
  out.users = (data.users || []).map((u) => redactUser(u, isStaff || (uid && String(u['รหัส'] || '') === String(uid))));
  if (!isStaff) out.audit = [];
  return out;
}

async function getAllData() {
  const data = await rawGetAllData();
  const ctx = adminCtx.getStore();
  return redactAllData(data, { isStaff: !!(ctx && ctx.isStaff), uid: this && this.session && this.session.uid });
}

module.exports = { getAllData, redactAllData };
