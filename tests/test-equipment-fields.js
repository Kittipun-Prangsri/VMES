const assert = require('node:assert/strict');
const path = require('node:path');
process.env.ADMIN_CODE = 'test-admin';
const fsPath = require.resolve('../backend-node/lib/firestore');
const store = { equipment: {}, audit: {}, settings: {} };
const fake = {
  SHEETS: { EQUIPMENT: 'equipment', SETTINGS: 'settings', AUDIT: 'audit', USERS: 'users', EQUIPMENT_CATEGORY: 'equipmentCategory' },
  listDocs: async (c) => Object.values(store[c] || (store[c] = {})).map((d) => ({ ...d })),
  getDoc: async (c, id) => (store[c] && store[c][id] ? { ...store[c][id] } : null),
  setDoc: async (c, id, d) => { (store[c] || (store[c] = {}))[id] = { ...d }; return true; },
  deleteDoc: async (c, id) => { delete store[c][id]; return true; },
};
require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: fake };
let n = 0;
const sp = path.resolve(__dirname, '../backend-node/lib/storage.js');
require.cache[sp] = { id: sp, filename: sp, loaded: true, exports: { uploadBase64Image: async () => 'https://img.example/p' + (++n) + '.jpg' } };
const H = require('../backend-node/lib/handlers/equipment');
const A = 'test-admin';
const base = (o) => Object.assign({ 'ชื่ออุปกรณ์': 'เครื่องพิมพ์', 'รหัสครุภัณฑ์': '7440-14-0001/31' }, o);

(async () => {
  // ฟิลด์ใหม่: ทำความสะอาดและตรวจค่า
  let r = await H.saveEquipment(base({ 'ประเภทครุภัณฑ์': '  ครุภัณฑ์  คอมพิวเตอร์ ', 'ผู้จำหน่าย': ' บริษัท   เอ จำกัด ', 'ประเภทค่าเสื่อม': 'เส้นตรง (Straight-line)', 'อายุการใช้งานปี': '5', 'ผู้รับผิดชอบ': ' สมชาย ', 'หน่วยงานที่รับผิดชอบ': 'IT' }), A);
  assert.equal(r.success, true);
  const doc = store.equipment[r.code];
  assert.equal(doc['ประเภทครุภัณฑ์'], 'ครุภัณฑ์ คอมพิวเตอร์'); assert.equal(doc['ผู้จำหน่าย'], 'บริษัท เอ จำกัด');
  assert.equal(doc['อายุการใช้งานปี'], 5); assert.equal(doc['ผู้รับผิดชอบ'], 'สมชาย');
  const bad = async (o, re) => { const x = await H.saveEquipment(base(o), A); assert.equal(x.success, false); assert.match(x.message, re); };
  await bad({ 'ประเภทค่าเสื่อม': 'อะไรก็ได้' }, /ประเภทค่าเสื่อม/);
  await bad({ 'อายุการใช้งานปี': -1 }, /0–100/);
  await bad({ 'อายุการใช้งานปี': 'abc' }, /0–100/);
  await bad({ 'รูปภาพทั้งหมด': ['javascript:alert(1)'] }, /ลิงก์รูปภาพ/);
  await bad({ 'รูปภาพทั้งหมด': Array.from({ length: 7 }, (_, i) => 'https://x/' + i) }, /ไม่เกิน 6/);
  console.log('  ✅ new fields sanitised/validated');

  // รูปหลัก = รูปแรก, ลบ/จัดลำดับผ่านรายการที่ส่งมา, ไม่ส่งคีย์ = ไม่แตะรูป
  r = await H.saveEquipment(base({ 'รูปภาพทั้งหมด': ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/a.jpg'] }), A);
  let d = store.equipment[r.code];
  assert.deepEqual(d['รูปภาพทั้งหมด'], ['https://x/a.jpg', 'https://x/b.jpg'], 'dedupe'); assert.equal(d['รูปภาพ'], 'https://x/a.jpg');
  await H.saveEquipment(base({ 'รหัส': r.code, 'รูปภาพทั้งหมด': ['https://x/b.jpg', 'https://x/a.jpg'] }), A);
  assert.equal(store.equipment[r.code]['รูปภาพ'], 'https://x/b.jpg', 'reorder changes cover');
  await H.saveEquipment(base({ 'รหัส': r.code, 'ชื่ออุปกรณ์': 'เปลี่ยนชื่อ' }), A);
  assert.deepEqual(store.equipment[r.code]['รูปภาพทั้งหมด'], ['https://x/b.jpg', 'https://x/a.jpg'], 'photos untouched when key omitted');
  await H.saveEquipment(base({ 'รหัส': r.code, 'รูปภาพทั้งหมด': [] }), A);
  assert.equal(store.equipment[r.code]['รูปภาพ'], '', 'empty list clears cover');
  console.log('  ✅ photo list: dedupe, cover = first, reorder, clear, untouched when omitted');

  // อัปโหลดต่อท้าย + รองรับข้อมูลเก่าที่มีแค่ รูปภาพ เดียว + จำกัด 6 รูป
  store.equipment.OLD = { 'รหัส': 'OLD', 'ชื่ออุปกรณ์': 'เก่า', 'รูปภาพ': 'https://old/1.jpg' };
  let u = await H.uploadEquipmentPhoto('OLD', 'AAAA', 'image/jpeg', A);
  assert.equal(u.success, true); assert.equal(u.count, 2);
  assert.deepEqual(store.equipment.OLD['รูปภาพทั้งหมด'], ['https://old/1.jpg', u.url]);
  assert.equal(store.equipment.OLD['รูปภาพ'], 'https://old/1.jpg', 'legacy cover stays first');
  store.equipment.NEW = { 'รหัส': 'NEW', 'ชื่ออุปกรณ์': 'ใหม่' };
  u = await H.uploadEquipmentPhoto('NEW', 'AAAA', 'image/png', A);
  assert.equal(store.equipment.NEW['รูปภาพ'], u.url, 'first upload becomes cover');
  for (let i = 0; i < 5; i++) assert.equal((await H.uploadEquipmentPhoto('NEW', 'AAAA', 'image/jpeg', A)).success, true);
  u = await H.uploadEquipmentPhoto('NEW', 'AAAA', 'image/jpeg', A);
  assert.equal(u.success, false); assert.match(u.message, /ไม่เกิน 6/);
  assert.equal(store.equipment.NEW['รูปภาพทั้งหมด'].length, 6);
  assert.equal((await H.uploadEquipmentPhoto('NEW', 'AAAA', 'image/jpeg', 'wrong')).success, false);
  assert.equal(store.equipment.NEW['ชื่ออุปกรณ์'], 'ใหม่', 'other fields preserved');
  console.log('  ✅ upload appends (legacy single photo, limit 6, auth)');

  // ป้ายชื่อมุมภาพ: เก็บเป็น map ตาม URL, ตัดของรูปที่ถูกลบ, อัปโหลดพร้อมป้ายชื่อ
  r = await H.saveEquipment(base({ 'รูปภาพทั้งหมด': ['https://x/a.jpg', 'https://x/b.jpg'], 'ป้ายกำกับรูป': { 'https://x/a.jpg': ' ด้านหน้า ', 'https://x/b.jpg': 'ป้ายครุภัณฑ์', 'https://x/gone.jpg': 'ลบแล้ว', 'https://x/x.jpg': '   ' } }), A);
  assert.deepEqual(store.equipment[r.code]['ป้ายกำกับรูป'], { 'https://x/a.jpg': 'ด้านหน้า', 'https://x/b.jpg': 'ป้ายครุภัณฑ์' }, 'normalised, orphan labels dropped');
  await H.saveEquipment(base({ 'รหัส': r.code, 'รูปภาพทั้งหมด': ['https://x/b.jpg', 'https://x/a.jpg'] }), A);
  assert.deepEqual(store.equipment[r.code]['ป้ายกำกับรูป'], { 'https://x/a.jpg': 'ด้านหน้า', 'https://x/b.jpg': 'ป้ายครุภัณฑ์' }, 'labels survive reorder when client omits the map');
  await H.saveEquipment(base({ 'รหัส': r.code, 'รูปภาพทั้งหมด': ['https://x/b.jpg'] }), A);
  assert.deepEqual(store.equipment[r.code]['ป้ายกำกับรูป'], { 'https://x/b.jpg': 'ป้ายครุภัณฑ์' }, 'removing a photo drops its label');
  const up2 = await H.uploadEquipmentPhoto(r.code, 'AAAA', 'image/jpeg', A, '  ด้านข้าง  ');
  assert.equal(store.equipment[r.code]['ป้ายกำกับรูป'][up2.url], 'ด้านข้าง'); assert.equal(store.equipment[r.code]['ป้ายกำกับรูป']['https://x/b.jpg'], 'ป้ายครุภัณฑ์');
  const up3 = await H.uploadEquipmentPhoto(r.code, 'AAAA', 'image/jpeg', A);
  assert.equal(up3.success, true); assert.equal(store.equipment[r.code]['ป้ายกำกับรูป'][up3.url], undefined, 'no label = no entry');
  const longLbl = await H.uploadEquipmentPhoto(r.code, 'AAAA', 'image/jpeg', A, 'ก'.repeat(80));
  assert.equal(store.equipment[r.code]['ป้ายกำกับรูป'][longLbl.url].length, 30, 'label capped');
  console.log('  ✅ photo angle labels (map by url, survives reorder/removal, upload with label)');
  console.log('\n🎉 ALL EQUIPMENT FIELD TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
