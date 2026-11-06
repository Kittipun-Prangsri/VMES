const assert = require('node:assert/strict');
const path = require('node:path');
process.env.SESSION_SECRET = 'x'.repeat(40);
const fsPath = require.resolve('../backend-node/lib/firestore');
const store = { equipment: {}, equipmentCategory: {}, departments: {}, users: {}, settings: {}, audit: {} };
const fake = {
  SHEETS: { EQUIPMENT: 'equipment', EQUIPMENT_CATEGORY: 'equipmentCategory', DEPARTMENTS: 'departments', USERS: 'users', SETTINGS: 'settings', AUDIT: 'audit' },
  listDocs: async (c) => Object.values(store[c] || (store[c] = {})).map((d) => ({ ...d })),
  getDoc: async (c, id) => (store[c] && store[c][id] ? { ...store[c][id] } : null),
  setDoc: async (c, id, d) => { (store[c] || (store[c] = {}))[id] = { ...d }; return true; },
  deleteDoc: async (c, id) => { delete store[c][id]; return true; },
};
require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: fake };
let up = 0;
const sp = path.resolve(__dirname, '../backend-node/lib/storage.js');
require.cache[sp] = { id: sp, filename: sp, loaded: true, exports: { uploadBase64Image: async () => 'https://img.example/s' + (++up) + '.jpg' } };

// --- ยืนยันตัวตน LINE (ใช้ fetch ปลอมแทน api.line.me) ---
const LA = require('../backend-node/lib/lineAuth');
const tokens = { T_STAFF: { id: 'U-staff', name: 'LINE สมชาย' }, T_USER: { id: 'U-user' }, T_NOREG: { id: 'U-nobody' }, T_SUSP: { id: 'U-susp' }, T_OTHERCH: { id: 'U-staff', client: '9999' } };
let calls = 0;
const mkFetch = () => async (url, init) => {
  calls++;
  const u = new URL(url);
  const tok = u.pathname.endsWith('/verify') ? u.searchParams.get('access_token') : String(init.headers.Authorization).replace('Bearer ', '');
  const t = tokens[tok.replace(/x+$/, '')];
  if (!t) return { ok: false, json: async () => ({}) };
  if (u.pathname.endsWith('/verify')) return { ok: true, json: async () => ({ client_id: t.client || '2011083425', expires_in: 3000 }) };
  return { ok: true, json: async () => ({ userId: t.id, displayName: t.name || 'x' }) };
};
const tk = (n) => n + 'x'.repeat(24); // ความยาวพอให้ผ่านการตรวจเบื้องต้น

(async () => {
  assert.equal(await LA.verifyLineAccessToken('short', mkFetch()), null, 'too short');
  assert.equal(await LA.verifyLineAccessToken(tk('T_NOPE'), mkFetch()), null, 'unknown token');
  assert.equal(await LA.verifyLineAccessToken(tk('T_OTHERCH'), mkFetch()), null, 'token of another channel rejected');
  const f = mkFetch(); calls = 0;
  assert.equal((await LA.verifyLineAccessToken(tk('T_STAFF'), f)).userId, 'U-staff');
  await LA.verifyLineAccessToken(tk('T_STAFF'), f);
  assert.equal(calls, 2, 'second call served from cache (verify + profile only once)');
  console.log('  ✅ LINE token verification (channel check, cache)');

  // ใช้ fetch ปลอมเป็น global เพื่อให้ handler เรียกผ่าน lineAuth ตามปกติ
  LA.clearCache(); global.fetch = mkFetch();
  const S = require('../backend-node/lib/handlers/liffSurvey');
  store.users.U1 = { 'รหัส': 'U1', 'ชื่อ-นามสกุล': 'สมชาย เจ้าหน้าที่', 'LINE ID': 'U-staff', 'บทบาท': 'manager', 'หน่วยงาน': 'IT', 'สถานะ': 'ใช้งาน' };
  store.users.U2 = { 'รหัส': 'U2', 'ชื่อ-นามสกุล': 'ผู้ใช้ทั่วไป', 'LINE ID': 'U-user', 'บทบาท': 'user', 'สถานะ': 'ใช้งาน' };
  store.users.U3 = { 'รหัส': 'U3', 'ชื่อ-นามสกุล': 'ถูกระงับ', 'LINE ID': 'U-susp', 'บทบาท': 'admin', 'สถานะ': 'ระงับ' };
  store.equipmentCategory.C1 = { id: 'C1', 'ชื่อหมวด': 'คอมพิวเตอร์', 'รหัสหมวด': '7440' };
  store.equipmentCategory.C2 = { id: 'C2', 'ชื่อหมวด': 'เฟอร์นิเจอร์' };
  store.departments.D1 = { 'รหัส': 'D1', 'ชื่อหน่วยงาน': 'OPD' };
  store.equipment.E0 = { 'รหัส': 'E0', 'รหัสครุภัณฑ์': '7440-14-0001/31', 'ชื่ออุปกรณ์': 'PC เดิม', 'ที่เก็บ': 'ห้องการเงิน ชั้น 2', 'หมวดหมู่': 'คอมพิวเตอร์' };
  store.settings.EQUIPMENT_LOCATIONS = { Key: 'EQUIPMENT_LOCATIONS', Value: JSON.stringify(['ห้องว่าง']) };

  // สิทธิ์
  const deny = async (name, reason) => { const r = await S.getLiffSurveyInfo(tk(name)); assert.equal(r.allowed, false, name); assert.equal(r.reason, reason, name); };
  await deny('T_BAD', 'unauthorized'); await deny('T_NOREG', 'not_registered'); await deny('T_USER', 'not_staff'); await deny('T_SUSP', 'suspended');
  for (const fn of [() => S.saveLiffSurveyItem(tk('T_USER'), { name: 'x', room: 'y' }), () => S.saveLiffSurveyItem(tk('T_BAD'), { name: 'x', room: 'y' }), () => S.uploadLiffSurveyPhoto(tk('T_USER'), 'E0', 'AAAA', 'image/jpeg')]) {
    const r = await fn(); assert.equal(r.success, false);
  }
  assert.equal(Object.keys(store.equipment).length, 1, 'no writes for unauthorized callers');
  console.log('  ✅ access control (bad token, unregistered, non-staff, suspended)');

  // ข้อมูลตั้งต้น
  const info = await S.getLiffSurveyInfo(tk('T_STAFF'));
  assert.equal(info.allowed, true); assert.equal(info.staff.name, 'สมชาย เจ้าหน้าที่');
  assert.deepEqual(info.categories.map((c) => c.name), ['คอมพิวเตอร์', 'เฟอร์นิเจอร์'], 'coded categories first');
  assert.ok(info.locations.includes('ห้องว่าง') && info.locations.includes('ห้องการเงิน ชั้น 2'), 'master + used locations');
  assert.deepEqual(info.departments, ['OPD']); assert.equal(info.items.length, 1);
  console.log('  ✅ form bootstrap data');

  // บันทึกเครื่อง
  let r = await S.saveLiffSurveyItem(tk('T_STAFF'), { name: '  คอมพิวเตอร์   ตั้งโต๊ะ ', category: 'คอมพิวเตอร์', room: 'ห้องการเงิน  ชั้น 2', brand: 'Dell', model: 'OptiPlex', serial: 'ABC123', hasTag: true, tag: '7440-14-0099/31', cond: 'bad', dept: 'OPD', resp: 'สมหญิง', note: 'มุมห้อง', 'ราคา': 99999, 'สถานะ': 'พร้อมยืม', 'ผู้สำรวจ': 'ปลอม' });
  assert.equal(r.success, true);
  const doc = store.equipment[r.code];
  assert.equal(doc['ชื่ออุปกรณ์'], 'คอมพิวเตอร์ ตั้งโต๊ะ'); assert.equal(doc['ที่เก็บ'], 'ห้องการเงิน ชั้น 2', 'canonical room spelling');
  assert.equal(doc['สถานะ'], 'ชำรุด'); assert.equal(doc['สถานะป้ายครุภัณฑ์'], 'มีป้าย'); assert.equal(doc['ผู้สำรวจ'], 'สมชาย เจ้าหน้าที่', 'surveyor from LINE identity, not client');
  assert.equal(doc['มูลค่า'], 0, 'unknown fields ignored'); assert.equal(doc['แหล่งที่มา'], 'LIFF'); assert.equal(doc['บันทึกจากการสำรวจภาคสนาม'], true);
  assert.equal(doc['หน่วยงานที่รับผิดชอบ'], 'OPD');
  const bad = async (o, re) => { const x = await S.saveLiffSurveyItem(tk('T_STAFF'), Object.assign({ name: 'x', room: 'ห้อง' }, o)); assert.equal(x.success, false); assert.match(x.message, re); };
  await bad({ name: '  ' }, /ชื่ออุปกรณ์/); await bad({ room: ' ' }, /ห้อง/);
  await bad({ hasTag: true, tag: '7440-14-0001/31' }, /มีในระบบแล้ว/); await bad({ hasTag: true, tag: ' 7440-14-0001/31 ' }, /มีในระบบแล้ว/);
  await bad({ hasTag: true, tag: '' }, /เลขครุภัณฑ์/); await bad({ category: 'ไม่มีหมวดนี้' }, /ไม่พบหมวดหมู่/); await bad({ dept: 'ห้องที่ไม่มี' }, /ไม่พบหน่วยงาน/);
  r = await S.saveLiffSurveyItem(tk('T_STAFF'), { name: 'โต๊ะ', room: 'ห้องใหม่ล่าสุด', category: 'เฟอร์นิเจอร์', hasTag: false, tag: '1111' });
  assert.equal(store.equipment[r.code]['รหัสครุภัณฑ์'], '', 'tag ignored when "no tag"'); assert.equal(store.equipment[r.code]['สถานะป้ายครุภัณฑ์'], 'ไม่มีป้าย');
  console.log('  ✅ save item (whitelist, canonical room, duplicate tag, validation, identity)');
  const noTagId = r.code, mineId = Object.keys(store.equipment).find((k) => store.equipment[k]['ชื่ออุปกรณ์'] === 'คอมพิวเตอร์ ตั้งโต๊ะ');

  // อุปกรณ์เชื่อมต่อ
  r = await S.saveLiffSurveyPeripheral(tk('T_STAFF'), mineId, { type: 'จอภาพ', brand: 'LG', hasTag: false });
  assert.equal(r.success, true); const per = store.equipment[r.code];
  assert.equal(per['เชื่อมกับ'], mineId); assert.equal(per['ที่เก็บ'], 'ห้องการเงิน ชั้น 2'); assert.equal(per['หมวดหมู่'], 'คอมพิวเตอร์'); assert.equal(per['ผู้รับผิดชอบ'], 'สมหญิง');
  assert.equal((await S.saveLiffSurveyPeripheral(tk('T_STAFF'), mineId, { type: 'ของแปลก' })).success, false);
  assert.equal((await S.saveLiffSurveyPeripheral(tk('T_STAFF'), 'nope', { type: 'จอภาพ' })).success, false);
  console.log('  ✅ peripheral (inherits room/category/responsible, type validated)');

  // รูป
  r = await S.uploadLiffSurveyPhoto(tk('T_STAFF'), mineId, 'AAAA', 'image/jpeg', 'ด้านหน้า');
  assert.equal(r.success, true); assert.equal(store.equipment[mineId]['รูปภาพ'], r.url); assert.equal(store.equipment[mineId]['ป้ายกำกับรูป'][r.url], 'ด้านหน้า');
  assert.equal((await S.uploadLiffSurveyPhoto(tk('T_STAFF'), 'E0', 'AAAA', 'image/jpeg')).success, false, 'cannot add photos to items you did not survey');
  assert.equal((await S.uploadLiffSurveyPhoto(tk('T_STAFF'), mineId, 'AAAA', 'text/html')).success, false, 'non-image rejected');
  assert.equal((await S.uploadLiffSurveyPhoto(tk('T_STAFF'), mineId, 'A'.repeat(3_600_000), 'image/jpeg')).success, false, 'oversized rejected');
  console.log('  ✅ photo upload (own items only, type/size limits, angle label)');

  // ผูกเลขทีหลัง
  r = await S.resolveLiffSurveyTag(tk('T_STAFF'), noTagId, '7440-14-0001/31');
  assert.equal(r.success, false); assert.match(r.message, /มีในระบบแล้ว/);
  r = await S.resolveLiffSurveyTag(tk('T_STAFF'), noTagId, '7440-14-0500/31');
  assert.equal(r.success, true); assert.equal(store.equipment[noTagId]['สถานะป้ายครุภัณฑ์'], 'มีป้าย'); assert.equal(store.equipment[noTagId]['หมวดหมู่'], 'คอมพิวเตอร์', 'category moved by code'); assert.equal(r.movedCategory, 'คอมพิวเตอร์');
  assert.equal((await S.resolveLiffSurveyTag(tk('T_STAFF'), noTagId, '7440-14-0501/31')).success, false, 'already tagged');
  assert.equal((await S.resolveLiffSurveyTag(tk('T_USER'), noTagId, 'x')).success, false);
  console.log('  ✅ resolve tag (duplicate, category by code, access)');
  console.log('\n🎉 ALL LIFF SURVEY BACKEND TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
