const assert = require('node:assert/strict');
const path = require('node:path');
process.env.SESSION_SECRET = 'x'.repeat(40);
const fsPath = require.resolve('../backend-node/lib/firestore');
const store = { equipment: {}, borrowing: {}, equipmentCategory: {}, users: {}, audit: {}, settings: {} };
const fake = {
  SHEETS: { EQUIPMENT: 'equipment', BORROWING: 'borrowing', EQUIPMENT_CATEGORY: 'equipmentCategory', USERS: 'users', AUDIT: 'audit', SETTINGS: 'settings' },
  listDocs: async (c) => Object.values(store[c] || (store[c] = {})).map((d) => ({ ...d })),
  getDoc: async (c, id) => (store[c] && store[c][id] ? { ...store[c][id] } : null),
  setDoc: async (c, id, d) => { (store[c] || (store[c] = {}))[id] = { ...d }; return true; },
  deleteDoc: async (c, id) => { delete store[c][id]; return true; },
};
require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: fake };
const linePath = path.resolve(__dirname, '../backend-node/lib/line.js');
const sent = [];
require.cache[linePath] = { id: linePath, filename: linePath, loaded: true, exports: { sendBorrowingFlex: async (d, s, to) => { sent.push([d['รหัส'], s, to || 'group']); }, LIFF_BOOKING_URL: '', LIFF_SURVEY_URL: '' } };
const B = require('../backend-node/lib/handlers/borrowing');
const { todayStr } = require('../backend-node/lib/util');

const today = todayStr();
const plus = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dmy = (iso) => iso.split('-').reverse().join('/'); // รูปแบบที่ฟอร์ม LIFF ส่งมา
const eq = (id, o) => { store.equipment[id] = Object.assign({ 'รหัส': id, 'ชื่ออุปกรณ์': 'โน้ตบุ๊ก ' + id, 'จำนวน': 1, 'หน่วยนับ': 'เครื่อง', 'สถานะ': 'พร้อมยืม', 'หน่วยงานที่รับผิดชอบ': 'งานสารสนเทศ' }, o); };
const req = (items, from, to, o) => Object.assign({
  'รายการอุปกรณ์': items.map(([id, q]) => ({ 'รหัสอุปกรณ์': id, 'จำนวน': q })), 'รหัสอุปกรณ์': items[0][0], 'จำนวน': items[0][1],
  'ผู้ขอยืม': 'สมชาย', 'หน่วยงาน': 'OPD', 'LINE_USER_ID': 'U1', 'วันที่ต้องการรับ': dmy(from), 'วันที่ครบกำหนด': dmy(to),
}, o);
const reset = () => { store.borrowing = {}; sent.length = 0; };

(async () => {
  eq('L1'); eq('L2'); eq('M', { 'จำนวน': 5 }); eq('BAD', { 'สถานะ': 'ชำรุด' }); eq('FIX', { 'สถานะ': 'ประจำจุด' });

  // ยืมได้ปกติ + แจ้งเตือน
  let r = await B.saveBorrowing(req([['L1', 1]], plus(0), plus(3)), 'LINE User');
  assert.equal(r.success, true, r.message);
  assert.equal(Object.keys(store.borrowing).length, 1); assert.ok(sent.length >= 1);
  console.log('  ✅ basic borrow');

  // ยืมซ้ำช่วงที่ทับกัน = ปฏิเสธ พร้อมบอกวันที่ว่าง, ไม่เปิดเผยชื่อผู้ยืมคนอื่น
  r = await B.saveBorrowing(req([['L1', 1]], plus(1), plus(2), { 'ผู้ขอยืม': 'คนอื่น' }), 'x');
  assert.equal(r.success, false); assert.match(r.message, /เหลือยืมได้ 0/); assert.match(r.message, /ว่างอีกครั้งตั้งแต่/);
  assert.ok(r.message.includes(dmy(plus(4))), 'tells the next free date (day after due)');
  assert.ok(!r.message.includes('สมชาย'), 'does not leak the other borrower name');
  console.log('  ✅ overlapping re-borrow rejected with next free date (no name leak)');

  // ยืมซ้ำช่วงหลังวันครบกำหนด = ได้ (จองล่วงหน้า)
  r = await B.saveBorrowing(req([['L1', 1]], plus(5), plus(7), { 'ผู้ขอยืม': 'คนอื่น' }), 'x');
  assert.equal(r.success, true, r.message);
  r = await B.saveBorrowing(req([['L1', 1]], plus(6), plus(8)), 'x');
  assert.equal(r.success, false, 'but not when it overlaps the new reservation');
  console.log('  ✅ re-borrow for later dates allowed');

  // คำขอหลายรายการ: ทุกชิ้นถูกนับ (เดิมนับแค่ชิ้นแรก ด้วยจำนวนรวม) และกดเพิ่มชิ้นเดิมซ้ำถูกรวม
  reset();
  r = await B.saveBorrowing(req([['L1', 1], ['L2', 1], ['M', 2], ['M', 1]], plus(0), plus(2)), 'x');
  assert.equal(r.success, true, r.message);
  const rec = Object.values(store.borrowing)[0];
  assert.equal(rec['จำนวน'], 5, 'merged duplicate M (2+1) -> total 1+1+3'); assert.match(rec['ชื่ออุปกรณ์'], /M \(x3\)/);
  r = await B.saveBorrowing(req([['L2', 1]], plus(1), plus(1)), 'x');
  assert.equal(r.success, false, 'L2 (second item of a multi request) is correctly treated as taken');
  r = await B.saveBorrowing(req([['M', 3]], plus(1), plus(1)), 'x');
  assert.equal(r.success, false); assert.match(r.message, /เหลือยืมได้ 2/);
  r = await B.saveBorrowing(req([['M', 2]], plus(1), plus(1)), 'x');
  assert.equal(r.success, true, 'M has 5, 3 taken -> 2 left');
  console.log('  ✅ multi-item requests counted per item, duplicates merged');

  // ขอขยายเวลา ยังกันของไว้
  reset();
  await B.saveBorrowing(req([['L1', 1]], plus(0), plus(1)), 'x');
  const id = Object.keys(store.borrowing)[0];
  store.borrowing[id]['สถานะ'] = 'ขอขยายเวลา';
  r = await B.saveBorrowing(req([['L1', 1]], plus(0), plus(1)), 'x');
  assert.equal(r.success, false, 'item with a pending extension is still out');
  const mine = await B.getMyActiveBorrowings('U1');
  assert.equal(mine.length, 1, 'borrower still sees it (can return it)');
  store.borrowing[id]['สถานะ'] = 'คืนเสร็จสิ้น';
  r = await B.saveBorrowing(req([['L1', 1]], plus(0), plus(1)), 'x');
  assert.equal(r.success, true, 'returned -> can be borrowed again right away');
  console.log('  ✅ extension requests hold the item; returned items can be borrowed again');

  // เลยกำหนดแต่ยังไม่คืน = ยังไม่ว่างวันนี้
  reset();
  store.borrowing.OLD = { 'รหัส': 'OLD', 'สถานะ': 'ถึงวันครบกำหนดคืน', 'รหัสอุปกรณ์': 'L1', 'จำนวน': 1, 'วันที่ต้องการรับ': dmy(plus(-10)), 'วันที่ครบกำหนด': dmy(plus(-5)) };
  assert.equal((await B.saveBorrowing(req([['L1', 1]], plus(0), plus(1)), 'x')).success, false, 'overdue & not returned');
  assert.equal((await B.saveBorrowing(req([['L1', 1]], plus(1), plus(2)), 'x')).success, true, 'free from tomorrow');
  console.log('  ✅ overdue-not-returned blocks only until today');

  // ตรวจอื่นๆ
  reset();
  const bad = async (items, from, to, re) => { const x = await B.saveBorrowing(req(items, from, to), 'x'); assert.equal(x.success, false); assert.match(x.message, re); };
  await bad([['BAD', 1]], plus(0), plus(1), /สถานะ ชำรุด/);
  await bad([['NOPE', 1]], plus(0), plus(1), /ไม่พบข้อมูลอุปกรณ์/);
  await bad([['L1', 0]], plus(0), plus(1), /มากกว่า 0/);
  await bad([['L1', 1]], plus(3), plus(1), /ไม่ก่อนวันที่ต้องการรับ/);
  assert.equal(Object.keys(store.borrowing).length, 0, 'nothing saved on rejection');
  // ไม่ใส่วันที่ (ข้อมูลเก่า) -> ถือเป็นวันนี้
  r = await B.saveBorrowing({ 'รหัสอุปกรณ์': 'L2', 'จำนวน': 1, 'ผู้ขอยืม': 'x' }, 'x');
  assert.equal(r.success, true, r.message);
  console.log('  ✅ validation (unborrowable status, unknown item, qty, date order, missing dates)');

  // catalog สำหรับ LIFF: ไม่มีข้อมูลบุคคล แต่มีช่วงที่ถูกกันไว้
  reset();
  store.equipmentCategory.C1 = { id: 'C1', 'ชื่อหมวด': 'คอมพิวเตอร์', 'รหัสหมวด': '7440' };
  await B.saveBorrowing(req([['L1', 1], ['M', 2]], plus(1), plus(3), { 'เบอร์ติดต่อ': '0812345678' }), 'x');
  const cat = await B.getBorrowCatalog();
  assert.equal(cat.success, true); assert.equal(cat.today, today);
  const l1 = cat.items.find((i) => i['รหัส'] === 'L1'), m = cat.items.find((i) => i['รหัส'] === 'M');
  assert.deepEqual(l1.busy, [{ s: plus(1), e: plus(3), q: 1 }]); assert.deepEqual(m.busy, [{ s: plus(1), e: plus(3), q: 2 }]);
  assert.equal(cat.items.find((i) => i['รหัส'] === 'L2').busy.length, 0);
  const dump = JSON.stringify(cat);
  for (const secret of ['สมชาย', '0812345678', 'U1', 'OPD']) assert.ok(!dump.includes(secret), 'catalog must not contain ' + secret);
  assert.deepEqual(cat.categories, [{ name: 'คอมพิวเตอร์', code: '7440' }]);
  console.log('  ✅ catalog: busy windows only, no personal data');

  // เฉพาะอุปกรณ์งานสารสนเทศเท่านั้นที่ยืมผ่านระบบได้ — ของหน่วยงานอื่นเป็นครุภัณฑ์ประจำหน่วยงานที่ใช้งานอยู่แล้ว
  reset();
  eq('IT1', { 'หน่วยงานที่รับผิดชอบ': 'งานสารสนเทศ' }); eq('IT2', { 'หน่วยงานที่รับผิดชอบ': 'ศูนย์คอมพิวเตอร์ (IT)' });
  eq('OPD1', { 'หน่วยงานที่รับผิดชอบ': 'ผู้ป่วยนอก', 'ที่เก็บ': 'ห้องไอที ชั้น2' }); eq('OLD1', { 'หน่วยงานที่รับผิดชอบ': '' });
  eq('LOC1', { 'หน่วยงานที่รับผิดชอบ': '', 'ที่เก็บ': 'งานสารสนเทศ' }); eq('LOC2', { 'หน่วยงานที่รับผิดชอบ': '', 'ที่เก็บ': 'งานอุบัติเหตุ' }); eq('FIX1', { 'สถานะ': 'ประจำจุด', 'หน่วยงานที่รับผิดชอบ': '', 'ที่เก็บ': 'งานสารสนเทศ' }); // ยังไม่ระบุหน่วยงาน -> ยังไม่เปิดให้ยืม
  const cat2 = await B.getBorrowCatalog();
  const ids = cat2.items.map((i) => i['รหัส']).sort();
  assert.ok(ids.includes('IT1') && ids.includes('IT2') && !ids.includes('OLD1') && !ids.includes('OPD1') && ids.includes('LOC1') && !ids.includes('LOC2') && !ids.includes('FIX1'), 'catalog lists only IT equipment: ' + ids);
  const badOpd = await B.saveBorrowing(req([['OPD1', 1]], plus(1), plus(2)), 'x');
  assert.equal(badOpd.success, false); assert.match(badOpd.message, /ประจำหน่วยงาน ผู้ป่วยนอก.*งานสารสนเทศ/);
  const badLoc = await B.saveBorrowing(req([['LOC2', 1]], plus(1), plus(2)), 'x'); assert.equal(badLoc.success, false); assert.match(badLoc.message, /อยู่ที่ งานอุบัติเหตุ/);
  const badFix = await B.saveBorrowing(req([['FIX1', 1]], plus(1), plus(2)), 'x'); assert.equal(badFix.success, false); assert.match(badFix.message, /ประจำจุด/);
  assert.equal((await B.saveBorrowing(req([['LOC1', 1]], plus(1), plus(2)), 'x')).success, true, 'IT stock w/o unit is borrowable');
  assert.equal((await B.saveBorrowing(req([['IT1', 1]], plus(1), plus(2)), 'x')).success, true);
  console.log('  ✅ only IT-unit equipment is borrowable (catalog + save)');

  // คำแนะนำสถานที่/วัตถุประสงค์: รวมสะกดต่างช่องว่าง/ตัวพิมพ์, เอาเฉพาะที่ซ้ำ, ไม่หลุดข้อมูลบุคคล
  reset();
  const mkB = (i, loc, purpose, o) => { store.borrowing['S' + i] = Object.assign({ 'รหัส': 'S' + i, 'สถานะ': 'คืนเสร็จสิ้น', 'ผู้ขอยืม': 'สมชาย', 'เบอร์ติดต่อ': '0812345678', 'สถานที่ใช้งาน': loc, 'วัตถุประสงค์': purpose, 'วันที่บันทึก': '2026-11-0' + (i % 9 + 1) }, o); };
  mkB(1, 'ห้องประชุมทับทิมจันทร์', 'ประชุม'); mkB(2, 'ห้องประชุม  ทับทิมจันทร์ ', 'ประชุม'); mkB(3, 'ห้องประชุมทับทิมจันทร์', 'ประชุม');
  mkB(4, 'ห้องยา', 'อบรม'); mkB(5, 'ห้องยา', 'อบรม');
  mkB(6, 'บ้านสมชาย 0812345678', 'ส่วนตัว'); mkB(7, 'บ้านสมชาย 0812345678', 'ส่วนตัว'); // มีเบอร์ -> ไม่แนะนำ
  mkB(8, 'ที่ลับเฉพาะคนเดียว', 'x'); mkB(9, 'ห้องยา', 'อบรม', { 'สถานะ': 'ยกเลิก' });
  const sg = await B.getBorrowSuggestions();
  assert.equal(sg.success, true);
  assert.deepEqual(sg.locations.map((x) => x.name + ':' + x.count), ['ห้องประชุมทับทิมจันทร์:3', 'ห้องยา:2'], 'merged spellings, repeated only, cancelled ignored, phone-like text dropped');
  assert.deepEqual(sg.purposes.map((x) => x.name), ['ประชุม'], 'purposes need 3+ uses');
  const sgDump = JSON.stringify(sg);
  for (const secret of ['สมชาย', '0812345678', 'S1', 'ที่ลับ']) assert.ok(!sgDump.includes(secret), 'suggestions must not contain ' + secret);
  console.log('  ✅ suggestions: popular locations/purposes only, anonymous');
  console.log('\n🎉 ALL BORROWING TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
