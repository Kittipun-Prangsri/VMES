const assert = require('node:assert/strict');
process.env.ADMIN_CODE = 'test-admin';
const fsPath = require.resolve('../backend-node/lib/firestore');
const store = { equipment: {}, equipmentCategory: {}, audit: {}, settings: {} };
const fake = {
  SHEETS: { EQUIPMENT: 'equipment', EQUIPMENT_CATEGORY: 'equipmentCategory', AUDIT: 'audit', SETTINGS: 'settings', USERS: 'users' },
  listDocs: async (c) => Object.values(store[c] || (store[c] = {})).map((d) => ({ ...d })),
  getDoc: async (c, id) => (store[c] && store[c][id] ? { ...store[c][id] } : null),
  setDoc: async (c, id, d) => { (store[c] || (store[c] = {}))[id] = { ...d }; return true; },
  deleteDoc: async (c, id) => { delete store[c][id]; return true; },
};
require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: fake };
const H = require('../backend-node/lib/handlers/categories');
const A = 'test-admin';
const eq = (id, tag, cat) => { store.equipment[id] = { 'รหัส': id, 'รหัสครุภัณฑ์': tag, 'ชื่ออุปกรณ์': id, 'หมวดหมู่': cat, 'รูปภาพ': 'p.png' }; };

(async () => {
  // tagPrefix
  assert.equal(H.tagPrefix('7440-14-0001/31'), '7440');
  assert.equal(H.tagPrefix('  7440-14'), '7440');
  assert.equal(H.tagPrefix('1234/56'), '1234');
  assert.equal(H.tagPrefix('74401-1'), '', 'more than 4 digits is not a prefix');
  assert.equal(H.tagPrefix('ABC-7440'), '');
  assert.equal(H.tagPrefix(''), ''); assert.equal(H.tagPrefix(null), '');
  console.log('  ✅ tagPrefix');

  // create / validation
  assert.equal((await H.saveEquipmentCategory({ name: 'x', code: '7440' }, 'wrong')).success, false, 'needs admin');
  assert.equal((await H.saveEquipmentCategory({ name: '  ', code: '7440' }, A)).success, false);
  assert.equal((await H.saveEquipmentCategory({ name: 'ก', code: '744' }, A)).success, false, 'code must be 4 digits');
  assert.equal((await H.saveEquipmentCategory({ name: 'ก', code: '74a0' }, A)).success, false);
  let r = await H.saveEquipmentCategory({ name: '  อุปกรณ์คอมพิวเตอร์และ   เครื่องพิมพ์ ', code: '7440' }, A);
  assert.equal(r.success, true); assert.equal(r.name, 'อุปกรณ์คอมพิวเตอร์และ เครื่องพิมพ์');
  const compId = r.id;
  assert.equal(store.equipmentCategory[compId]['รหัสหมวด'], '7440');
  assert.equal((await H.saveEquipmentCategory({ name: 'อุปกรณ์คอมพิวเตอร์และ เครื่องพิมพ์', code: '1111' }, A)).success, false, 'dup name');
  r = await H.saveEquipmentCategory({ name: 'อื่น', code: '7440' }, A);
  assert.equal(r.success, false); assert.match(r.message, /7440/);
  r = await H.saveEquipmentCategory({ name: 'ไม่มีรหัส' }, A);
  assert.equal(r.success, true); assert.equal('รหัสหมวด' in store.equipmentCategory[r.id], false);
  const noCodeId = r.id;
  console.log('  ✅ create (auth, validation, duplicate name/code)');

  // rename -> อัปเดตอุปกรณ์ที่ใช้ชื่อเดิม คงฟิลด์อื่น
  eq('e1', '7440-14-0001/31', 'อุปกรณ์คอมพิวเตอร์และ เครื่องพิมพ์');
  eq('e2', '7440-14-0002/31', 'อุปกรณ์คอมพิวเตอร์และ เครื่องพิมพ์');
  eq('e3', '4110-1-1', 'อื่นๆ');
  r = await H.saveEquipmentCategory({ id: compId, name: 'คอมพิวเตอร์และเครื่องพิมพ์', code: '7440' }, A);
  assert.equal(r.success, true); assert.equal(r.updated, 2);
  assert.equal(store.equipment.e1['หมวดหมู่'], 'คอมพิวเตอร์และเครื่องพิมพ์');
  assert.equal(store.equipment.e3['หมวดหมู่'], 'อื่นๆ');
  assert.equal(store.equipment.e1['รูปภาพ'], 'p.png');
  assert.equal((await H.saveEquipmentCategory({ id: 'nope', name: 'z' }, A)).success, false);
  console.log('  ✅ rename cascades to equipment');

  // auto assign: preview ไม่แก้ข้อมูล, apply แก้เฉพาะที่ตรงรหัส
  eq('e4', '7440-14-0003/31', 'อื่นๆ');
  eq('e5', '7440-14-0004/31', '');
  eq('e6', '9999-1-1', 'อื่นๆ');
  eq('e7', '', 'อื่นๆ');
  const before = JSON.stringify(store.equipment);
  r = await H.assignEquipmentCategoriesByCode(false, A);
  assert.equal(r.preview, true); assert.equal(r.count, 2);
  assert.deepEqual(r.items.map((x) => x.id).sort(), ['e4', 'e5']);
  assert.equal(JSON.stringify(store.equipment), before, 'preview must not modify');
  assert.equal((await H.assignEquipmentCategoriesByCode('true', A)).preview, true, 'only boolean true applies');
  r = await H.assignEquipmentCategoriesByCode(true, A);
  assert.equal(r.updated, 2);
  assert.equal(store.equipment.e4['หมวดหมู่'], 'คอมพิวเตอร์และเครื่องพิมพ์');
  assert.equal(store.equipment.e5['หมวดหมู่'], 'คอมพิวเตอร์และเครื่องพิมพ์');
  assert.equal(store.equipment.e6['หมวดหมู่'], 'อื่นๆ', 'unmatched prefix untouched');
  assert.equal(store.equipment.e7['หมวดหมู่'], 'อื่นๆ', 'no tag untouched');
  assert.equal((await H.assignEquipmentCategoriesByCode(true, A)).updated, 0, 'idempotent');
  console.log('  ✅ auto-assign by code (preview, apply, idempotent)');

  // delete
  r = await H.deleteEquipmentCategory(compId, A);
  assert.equal(r.success, false); assert.match(r.message, /4 รายการ/);
  assert.equal((await H.deleteEquipmentCategory(noCodeId, A)).success, true);
  assert.equal(store.equipmentCategory[noCodeId], undefined);
  assert.equal((await H.deleteEquipmentCategory(noCodeId, A)).success, false);
  console.log('  ✅ delete (blocked while in use)');
  console.log('\n🎉 ALL EQUIPMENT CATEGORY TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
