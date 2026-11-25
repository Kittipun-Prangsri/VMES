const assert = require('node:assert/strict');
process.env.ADMIN_CODE = 'test-admin';
const fsPath = require.resolve('../backend-node/lib/firestore');
const store = { departments: {}, audit: {} };
const fake = {
  SHEETS: { DEPARTMENTS: 'departments', AUDIT: 'audit' },
  listDocs: async (c) => Object.values(store[c] || (store[c] = {})).map((d) => ({ ...d })),
  getDoc: async (c, id) => (store[c] && store[c][id] ? { ...store[c][id] } : null),
  setDoc: async (c, id, d) => { (store[c] || (store[c] = {}))[id] = { ...d }; return true; },
  deleteDoc: async (c, id) => { delete store[c][id]; return true; },
};
require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: fake };
const D = require('../backend-node/lib/handlers/departments');
const A = 'test-admin';
(async () => {
  assert.equal((await D.saveDepartment({ 'ชื่อหน่วยงาน': 'ห้องคลอด' }, 'wrong')).success, false, 'needs admin');
  assert.equal((await D.saveDepartment({ 'ชื่อหน่วยงาน': '   ' }, A)).success, false);
  assert.equal((await D.saveDepartment({ 'ชื่อหน่วยงาน': 'x'.repeat(121) }, A)).success, false);
  let r = await D.saveDepartment({ 'ชื่อหน่วยงาน': '  ห้องคลอด  ' }, A);
  assert.equal(r.success, true); assert.equal(r.existed, false); assert.equal(r.name, 'ห้องคลอด');
  assert.equal(store.departments[r.id]['ชื่อหน่วยงาน'], 'ห้องคลอด');
  console.log('  ✅ add (auth, validation, trim)');

  const id = r.id;
  r = await D.saveDepartment({ 'ชื่อหน่วยงาน': 'ห้อง  คลอด' }, A); // ช่องว่างต่าง = คนละชื่อ
  assert.equal(r.existed, false);
  r = await D.saveDepartment({ 'ชื่อหน่วยงาน': ' ห้องคลอด ' }, A);
  assert.equal(r.success, true); assert.equal(r.existed, true); assert.equal(r.id, id, 'duplicate returns the existing one');
  assert.equal(Object.keys(store.departments).length, 2, 'no duplicate created');
  console.log('  ✅ duplicate name returns existing instead of creating another');

  // แก้ไข: ชื่อชนกับอีกหน่วยงานต้องปฏิเสธ, แก้ชื่อตัวเองได้
  r = await D.saveDepartment({ 'รหัส': id, 'ชื่อหน่วยงาน': 'ห้อง คลอด' }, A);
  assert.equal(r.success, false); assert.match(r.message, /อยู่แล้ว/);
  r = await D.saveDepartment({ 'รหัส': id, 'ชื่อหน่วยงาน': 'ห้องคลอด (ชั้น 2)' }, A);
  assert.equal(r.success, true); assert.equal(store.departments[id]['ชื่อหน่วยงาน'], 'ห้องคลอด (ชั้น 2)');
  console.log('  ✅ edit (clash rejected, rename ok)');

  // ซิงก์รายชื่อจริง: เติมเฉพาะที่ขาด ไม่ลบ/ไม่แก้ของเดิม
  const DM = require('../backend-node/lib/departmentsMaster');
  store.departments = {};
  await D.saveDepartment({ 'ชื่อหน่วยงาน': 'งานสารสนเทศ' }, A); await D.saveDepartment({ 'ชื่อหน่วยงาน': 'ห้องคลอด' }, A); await D.saveDepartment({ 'ชื่อหน่วยงาน': 'ศูนย์ที่ผู้ดูแลเพิ่ม' }, A);
  assert.equal((await D.syncDepartmentsFromMaster('wrong')).success, false, 'needs admin');
  let sy = await D.syncDepartmentsFromMaster(A, true);
  assert.equal(sy.missing.length, DM.REAL.length - 1, 'only งานสารสนเทศ already present'); assert.deepEqual(sy.legacyInDb, ['ห้องคลอด']);
  assert.equal(Object.keys(store.departments).length, 3, 'dry run changes nothing');
  sy = await D.syncDepartmentsFromMaster(A);
  assert.equal(sy.added, DM.REAL.length - 1);
  const names = Object.values(store.departments).map((d) => d['ชื่อหน่วยงาน']);
  assert.ok(DM.REAL.every((n) => names.some((x) => DM.key(x) === DM.key(n))), 'every real department present');
  assert.ok(names.includes('ห้องคลอด') && names.includes('ศูนย์ที่ผู้ดูแลเพิ่ม'), 'nothing existing is removed');
  assert.ok(Object.entries(store.departments).every(([id, d]) => d['รหัส'] === id), 'doc id matches รหัส');
  assert.equal((await D.syncDepartmentsFromMaster(A)).added, 0, 'idempotent');
  console.log('  ✅ sync real departments (adds missing only, keeps existing, idempotent)');
  console.log('\n🎉 ALL DEPARTMENT TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
