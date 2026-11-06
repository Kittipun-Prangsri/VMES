const assert = require('node:assert/strict');
const path = require('node:path');
process.env.ADMIN_CODE = 'test-admin';

// แทน firestore.js ด้วย store ในหน่วยความจำ (ไม่แตะ Supabase/Firebase จริง)
const fsPath = require.resolve('../backend-node/lib/firestore');
const store = { equipment: {}, settings: {}, audit: {} };
const fake = {
  SHEETS: { EQUIPMENT: 'equipment', SETTINGS: 'settings', AUDIT: 'audit', USERS: 'users', EQUIPMENT_CATEGORY: 'equipmentCategory' },
  listDocs: async (c) => Object.values(store[c] || (store[c] = {})).map((d) => ({ ...d })),
  getDoc: async (c, id) => (store[c] && store[c][id] ? { ...store[c][id] } : null),
  setDoc: async (c, id, d) => { (store[c] || (store[c] = {}))[id] = { ...d }; return true; },
  deleteDoc: async (c, id) => { delete store[c][id]; return true; },
};
require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: fake };
const storagePath = path.resolve(__dirname, '../backend-node/lib/storage.js');
require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: { uploadBase64Image: async () => '' } };

const H = require('../backend-node/lib/handlers/equipment');
const A = 'test-admin';
const eq = (id, loc) => { store.equipment[id] = { 'รหัส': id, 'ชื่ออุปกรณ์': id, 'ที่เก็บ': loc, 'รูปภาพ': 'x.png' }; };
const master = () => JSON.parse(store.settings.EQUIPMENT_LOCATIONS.Value);

(async () => {
  const NAME = 'ห้องธุรการ&การเงิน ชั้น2';

  assert.equal((await H.addEquipmentLocation(NAME, 'wrong')).success, false, 'needs admin');
  assert.equal((await H.addEquipmentLocation('   ', A)).success, false, 'empty rejected');
  assert.equal((await H.addEquipmentLocation('x'.repeat(101), A)).success, false, 'too long rejected');

  let r = await H.addEquipmentLocation('  ห้องธุรการ&การเงิน   ชั้น2 ', A);
  assert.equal(r.success, true); assert.equal(r.name, NAME, 'whitespace normalized'); assert.equal(r.existed, false);
  assert.deepEqual(master(), [NAME]);
  r = await H.addEquipmentLocation(NAME.toUpperCase(), A);
  assert.equal(r.existed, true); assert.equal(r.name, NAME, 'case-insensitive dup returns existing spelling');
  assert.equal(master().length, 1);
  console.log('  ✅ add (auth, validation, normalize, duplicate)');

  // rename: อัปเดตอุปกรณ์ทุกชิ้นที่ใช้ชื่อเดิม (รวมแบบสะกดต่างช่องว่าง) และคงฟิลด์อื่นไว้
  eq('e1', 'ห้อง IT'); eq('e2', 'ห้อง  IT '); eq('e3', 'ห้องยา');
  await H.addEquipmentLocation('ห้อง IT', A);
  r = await H.renameEquipmentLocation('ห้อง IT', 'ห้องไอที ชั้น1', A);
  assert.equal(r.success, true); assert.equal(r.updated, 2);
  assert.equal(store.equipment.e1['ที่เก็บ'], 'ห้องไอที ชั้น1');
  assert.equal(store.equipment.e2['ที่เก็บ'], 'ห้องไอที ชั้น1');
  assert.equal(store.equipment.e3['ที่เก็บ'], 'ห้องยา', 'others untouched');
  assert.equal(store.equipment.e1['รูปภาพ'], 'x.png', 'other fields preserved');
  assert.ok(master().includes('ห้องไอที ชั้น1') && !master().includes('ห้อง IT'));
  console.log('  ✅ rename (bulk update, fields preserved, master updated)');

  // rename ชนชื่อที่มีอยู่ = ควบรวม
  // ชื่อซ้ำกับห้องอื่น: ห้ามรวมเงียบๆ — ต้องยืนยัน (allowMerge) และไม่มีอะไรเปลี่ยนก่อนยืนยัน
  const snapshot = JSON.stringify(store);
  r = await H.renameEquipmentLocation('ห้องยา', 'ห้องไอที ชั้น1', A);
  assert.equal(r.success, false); assert.equal(r.needsMerge, true);
  assert.equal(r.from, 'ห้องยา'); assert.equal(r.fromCount, 1);
  assert.equal(r.target, 'ห้องไอที ชั้น1'); assert.equal(r.targetCount, 2);
  assert.equal(JSON.stringify(store), snapshot, 'nothing changes without allowMerge');
  assert.equal((await H.renameEquipmentLocation('ห้องยา', 'ห้องไอที ชั้น1', A, 'true')).needsMerge, true, 'only boolean true counts');
  r = await H.renameEquipmentLocation('ห้องยา', 'ห้องไอที ชั้น1', A, true);
  assert.equal(r.merged, true); assert.equal(store.equipment.e3['ที่เก็บ'], 'ห้องไอที ชั้น1');
  assert.equal(master().filter((x) => x === 'ห้องไอที ชั้น1').length, 1);
  assert.equal((await H.renameEquipmentLocation('ไม่มีจริง', 'ใหม่', A)).success, false, 'unknown rejected');
  assert.equal((await H.renameEquipmentLocation('ห้องไอที ชั้น1', '', A)).success, false, 'empty new name rejected');
  console.log('  ✅ rename onto existing name needs explicit merge confirmation + error cases');

  // delete: ลบได้เฉพาะที่ไม่มีอุปกรณ์ใช้
  r = await H.deleteEquipmentLocation('ห้องไอที ชั้น1', A);
  assert.equal(r.success, false); assert.match(r.message, /3 รายการ/);
  r = await H.deleteEquipmentLocation(NAME, A);
  assert.equal(r.success, true); assert.ok(!master().includes(NAME));
  assert.equal((await H.deleteEquipmentLocation(NAME, A)).success, false, 'already gone');
  console.log('  ✅ delete (blocked when in use)');

  console.log('\n🎉 ALL EQUIPMENT LOCATION TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
