const assert = require('node:assert/strict');
process.env.ADMIN_CODE = 'test-admin';
process.env.SESSION_SECRET = 'x'.repeat(40);
const fsPath = require.resolve('../backend-node/lib/firestore');
const store = { equipment: {}, equipmentHandover: {}, audit: {}, users: {}, settings: {} };
const fake = {
  SHEETS: { EQUIPMENT: 'equipment', EQUIPMENT_HANDOVER: 'equipmentHandover', AUDIT: 'audit', USERS: 'users', SETTINGS: 'settings' },
  listDocs: async (c) => Object.values(store[c] || (store[c] = {})).map((d) => ({ ...d })),
  getDoc: async (c, id) => (store[c] && store[c][id] ? { ...store[c][id] } : null),
  setDoc: async (c, id, d) => { (store[c] || (store[c] = {}))[id] = { ...d }; return true; },
  deleteDoc: async (c, id) => { delete store[c][id]; return true; },
};
require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: fake };
const { adminCtx } = require('../backend-node/lib/auth');
const H = require('../backend-node/lib/handlers/equipmentHandover');

store.equipment.EQ1 = { 'รหัส': 'EQ1', 'ชื่ออุปกรณ์': 'เครื่องพิมพ์ HP', 'รหัสครุภัณฑ์': '7440-14-0001/31' };
store.users.U1 = { 'รหัส': 'U1', 'ชื่อ-นามสกุล': 'สมหญิง ผู้จัดการ', 'บทบาท': 'manager' };
const asStaff = (fn, ...a) => adminCtx.run({ isStaff: true }, () => fn.apply({ session: { uid: 'U1' } }, a));
const asUser = (fn, ...a) => adminCtx.run({ isStaff: false }, () => fn.apply({ session: { uid: 'U1' } }, a));
const form = (o) => Object.assign({ equipId: 'EQ1', 'ส่งมอบให้หน่วยงาน': 'OPD', 'ส่งมอบ_วันที่ส่งมอบ': '2026-11-05' }, o);

(async () => {
  // สิทธิ์
  let r = await asUser(H.saveEquipmentHandover, form());
  assert.equal(r.success, false); assert.match(r.message, /ผู้ดูแลระบบ/);
  assert.equal(Object.keys(store.equipmentHandover).length, 0, 'non-staff cannot write');
  console.log('  ✅ non-staff rejected');

  // สร้าง: ชื่อรายการมาจากทะเบียน, ผู้บันทึกมาจาก session (ไม่เชื่อ client), สถานะคำนวณเอง
  r = await asStaff(H.saveEquipmentHandover, form({ 'รายการ': 'ชื่อปลอม', 'บันทึกโดย': 'คนอื่น', 'สถานะ': 'รับคืนแล้ว', 'ผู้รับผิดชอบ': '  สมชาย   ใจดี ', 'ราคา': -5, giveCheck_scratch: true, giveCheck_crack: 'yes' }));
  assert.equal(r.success, true); assert.equal(r.status, 'ส่งมอบแล้ว');
  const doc = store.equipmentHandover[r.id];
  assert.equal(doc['รายการ'], 'เครื่องพิมพ์ HP'); assert.equal(doc['บันทึกโดย'], 'สมหญิง ผู้จัดการ'); assert.equal(doc['สร้างโดย'], 'สมหญิง ผู้จัดการ');
  assert.equal(doc['ผู้รับผิดชอบ'], 'สมชาย ใจดี'); assert.equal(doc['ราคา'], 0, 'negative price -> 0');
  assert.equal(doc.giveCheck_scratch, true); assert.equal(doc.giveCheck_crack, false, 'only boolean true counts');
  console.log('  ✅ create: server-side name/user/status, sanitising');

  // ตรวจสอบข้อมูล
  const bad = async (o, re) => { const x = await asStaff(H.saveEquipmentHandover, form(o)); assert.equal(x.success, false); assert.match(x.message, re); };
  await bad({ equipId: 'NOPE' }, /ไม่พบข้อมูลครุภัณฑ์/);
  await bad({ 'ส่งมอบให้หน่วยงาน': '  ' }, /หน่วยงาน/);
  await bad({ 'ส่งมอบ_วันที่ส่งมอบ': '05/11/2026' }, /รูปแบบวันที่/);
  await bad({ 'ส่งมอบ_วันที่ส่งมอบ': '2026-02-30' }, /รูปแบบวันที่/);
  await bad({ 'รับคืน_วันที่ส่งคืน': '2026-11-01' }, /ก่อนวันที่ส่งมอบ/);
  await bad({ 'รับคืน_วันที่ส่งคืน': '2026-11-10', 'รับคืน_วันที่รับคืน': '2026-11-09' }, /ก่อนวันที่ส่งคืน/);
  r = await asStaff(H.saveEquipmentHandover, form({ 'รหัส': 'HO-NOT-EXIST' }));
  assert.equal(r.success, false); assert.match(r.message, /ไม่พบใบส่งมอบ/); assert.equal(store.equipmentHandover['HO-NOT-EXIST'], undefined, 'client cannot choose new id');
  console.log('  ✅ validation (equipment, dept, dates, ordering, unknown id)');

  // แก้ไข/บันทึกรับคืน: สถานะเปลี่ยนเป็นรับคืนแล้ว, คง สร้างโดย เดิม
  const id = Object.keys(store.equipmentHandover)[0];
  store.users.U1['ชื่อ-นามสกุล'] = 'ผู้แก้ไข';
  r = await asStaff(H.saveEquipmentHandover, form({ 'รหัส': id, 'รับคืน_วันที่ส่งคืน': '2026-11-10', 'รับคืน_วันที่รับคืน': '2026-11-10' }));
  assert.equal(r.status, 'รับคืนแล้ว');
  assert.equal(store.equipmentHandover[id]['สร้างโดย'], 'สมหญิง ผู้จัดการ'); assert.equal(store.equipmentHandover[id]['บันทึกโดย'], 'ผู้แก้ไข');
  assert.equal(Object.keys(store.equipmentHandover).length, 1, 'edit does not create new doc');
  console.log('  ✅ edit/return: status derived, creator preserved');

  // ลบ
  assert.equal((await asUser(H.deleteEquipmentHandover, id, '')).success, false);
  assert.equal((await asStaff(H.deleteEquipmentHandover, 'nope', '')).success, false);
  assert.equal((await asStaff(H.deleteEquipmentHandover, id, '')).success, true);
  assert.equal(Object.keys(store.equipmentHandover).length, 0);
  console.log('  ✅ delete (auth, unknown id)');
  console.log('\n🎉 ALL HANDOVER TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
