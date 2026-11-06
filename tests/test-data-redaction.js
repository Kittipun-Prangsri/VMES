const assert = require('node:assert/strict');
process.env.SESSION_SECRET = 'x'.repeat(40);
const fsPath = require.resolve('../backend-node/lib/firestore');
const raw = {
  users: [
    { 'รหัส': 'U1', 'ชื่อ-นามสกุล': 'ผู้ใช้หนึ่ง', 'เลขบัตรประชาชน': '1111111111111', 'LINE Token': 'tok1', 'LINE ID': 'Uaaa', 'รหัสผ่าน': 'plain1', 'บทบาท': 'user' },
    { 'รหัส': 'U2', 'ชื่อ-นามสกุล': 'ผู้ใช้สอง', 'เลขบัตรประชาชน': '2222222222222', 'Telegram Token': 'tok2', 'idCard': '2222222222222', 'เบอร์ติดต่อ': '081' },
  ],
  audit: [{ 'การดำเนินการ': 'x' }],
  vehicles: [{ 'ทะเบียน': 'กข 1234' }],
};
const fake = { SHEETS: {}, getAllData: async () => raw, listDocs: async () => [], getDoc: async () => null, setDoc: async () => true, deleteDoc: async () => true };
require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: fake };
const { adminCtx } = require('../backend-node/lib/auth');
const { getAllData } = require('../backend-node/lib/handlers/data');
const call = (isStaff, uid) => adminCtx.run({ isStaff }, () => getAllData.call({ session: { uid } }));

(async () => {
  let d = await call(false, 'U1');
  const u1 = d.users.find((u) => u['รหัส'] === 'U1'), u2 = d.users.find((u) => u['รหัส'] === 'U2');
  assert.equal(u1['เลขบัตรประชาชน'], '1111111111111', 'own record keeps own id card');
  assert.equal(u1['LINE Token'], 'tok1', 'own record keeps own token');
  assert.equal('รหัสผ่าน' in u1, false, 'password never returned');
  for (const k of ['เลขบัตรประชาชน', 'idCard', 'Telegram Token']) assert.equal(k in u2, false, 'other user ' + k + ' hidden');
  assert.equal(u2['เบอร์ติดต่อ'], '081', 'non-sensitive fields kept');
  assert.deepEqual(d.audit, [], 'audit hidden from non-staff');
  assert.equal(d.vehicles.length, 1, 'other collections untouched');
  console.log('  ✅ non-staff: others redacted, own kept, audit hidden');

  d = await call(true, 'ADMIN');
  assert.equal(d.users[1]['เลขบัตรประชาชน'], '2222222222222'); assert.equal(d.audit.length, 1);
  assert.equal('รหัสผ่าน' in d.users[0], false);
  console.log('  ✅ staff: full data (except password)');

  assert.equal(raw.users[0]['เลขบัตรประชาชน'], '1111111111111');
  assert.equal(raw.users[0]['รหัสผ่าน'], 'plain1', 'cached source objects not mutated');
  d = await getAllData.call({}); // ไม่มี ctx/session = ถือเป็น non-staff
  assert.deepEqual(d.audit, []);
  console.log('  ✅ source not mutated; no context = least privilege');
  console.log('\n🎉 ALL DATA REDACTION TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
