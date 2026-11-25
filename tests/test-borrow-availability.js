const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../backend-node/lib/borrowAvailability.js');

const TODAY = '2026-11-25';

// --- แปลงวันที่ ---
assert.equal(A.toIso('2026-12-03'), '2026-12-03');
assert.equal(A.toIso('03/12/2026'), '2026-12-03', 'dd/mm/yyyy from the LIFF form');
assert.equal(A.toIso('3/1/2026'), '2026-01-03');
assert.equal(A.toIso('2026-12-03 10:00:00'), '2026-12-03');
assert.equal(A.toIso('03/12/2569'), '2026-12-03', 'Buddhist year');
assert.equal(A.toIso('31/02/2026'), '', 'impossible date');
assert.equal(A.toIso(''), ''); assert.equal(A.toIso(null), ''); assert.equal(A.toIso('abc'), '');
assert.equal(A.addDays('2026-12-31', 1), '2027-01-01'); assert.equal(A.addDays('2026-03-01', -1), '2026-02-28');
console.log('  ✅ date parsing / arithmetic');

// --- รายการในคำขอ: หลายรายการนับแยกตามชิ้น (เดิมนับเฉพาะรายการแรกด้วยจำนวนรวมทั้งใบ) ---
const multi = { 'รหัส': 'BR-1', 'สถานะ': 'รอรับเรื่อง', 'รหัสอุปกรณ์': 'A', 'จำนวน': 3, 'รายการอุปกรณ์': [{ 'รหัสอุปกรณ์': 'A', 'จำนวน': 1 }, { 'รหัสอุปกรณ์': 'B', 'จำนวน': 2 }], 'วันที่ต้องการรับ': '26/11/2026', 'วันที่ครบกำหนด': '28/11/2026' };
const legacy = { 'รหัส': 'BR-0', 'สถานะ': 'อยู่ในระหว่างการยืม', 'รหัสอุปกรณ์': 'A', 'จำนวน': 2, 'วันที่ขอยืม': '2026-11-20', 'วันที่ครบกำหนด': '2026-11-24' };
assert.deepEqual(A.linesOf(multi), [{ id: 'A', qty: 1 }, { id: 'B', qty: 2 }]);
assert.deepEqual(A.linesOf(legacy), [{ id: 'A', qty: 2 }]);
const busyA = A.busyWindows('A', [multi, legacy], TODAY);
const busyB = A.busyWindows('B', [multi, legacy], TODAY);
assert.deepEqual(busyA.map((b) => b.q).sort(), [1, 2], 'A: 1 from the multi request + 2 from legacy (not 3)');
assert.deepEqual(busyB, [{ s: '2026-11-26', e: '2026-11-28', q: 2 }], 'B is counted too (it was ignored before)');
console.log('  ✅ multi-item requests counted per item');

// --- สถานะ: ขอขยายเวลา ต้องกันของ, คืนแล้ว/ยกเลิกไม่กัน ---
const mk = (status) => ({ 'รหัส': 'X', 'สถานะ': status, 'รหัสอุปกรณ์': 'A', 'จำนวน': 1, 'วันที่ต้องการรับ': '2026-11-25', 'วันที่ครบกำหนด': '2026-11-30' });
assert.equal(A.busyWindows('A', [mk('ขอขยายเวลา')], TODAY).length, 1, 'extension requested still holds the item');
for (const s of ['คืนเสร็จสิ้น', 'ยกเลิก']) assert.equal(A.busyWindows('A', [mk(s)], TODAY).length, 0, s);
assert.equal(A.busyWindows('A', [mk('รอรับเรื่อง')], TODAY, { excludeCode: 'X' }).length, 0, 'excludeCode');
console.log('  ✅ statuses (extension counts, returned/cancelled do not)');

// --- เลยกำหนดแต่ยังไม่คืน = ยังไม่ว่างถึงวันนี้ ---
const overdue = { 'รหัส': 'O', 'สถานะ': 'ถึงวันครบกำหนดคืน', 'รหัสอุปกรณ์': 'A', 'จำนวน': 1, 'วันที่ต้องการรับ': '2026-11-10', 'วันที่ครบกำหนด': '2026-11-15' };
assert.deepEqual(A.busyWindows('A', [overdue], TODAY), [{ s: '2026-11-10', e: TODAY, q: 1 }]);
assert.equal(A.availableFor(1, A.busyWindows('A', [overdue], TODAY), TODAY, TODAY), 0, 'not free today');
assert.equal(A.availableFor(1, A.busyWindows('A', [overdue], TODAY), '2026-11-26', '2026-11-27'), 1, 'free tomorrow (assumes it comes back)');
console.log('  ✅ overdue-but-not-returned keeps the item out until today');

// --- ยืมซ้ำคนละช่วงวัน: จองหลังวันที่ติดยืมได้ ---
const b1 = { 'รหัส': 'B1', 'สถานะ': 'อยู่ในระหว่างการยืม', 'รหัสอุปกรณ์': 'L', 'จำนวน': 1, 'วันที่ต้องการรับ': '2026-11-25', 'วันที่ครบกำหนด': '2026-11-28' };
const busy = A.busyWindows('L', [b1], TODAY);
assert.equal(A.availableFor(1, busy, '2026-11-26', '2026-11-27'), 0, 'overlaps -> 0');
assert.equal(A.availableFor(1, busy, '2026-11-28', '2026-11-30'), 0, 'due date itself is still busy');
assert.equal(A.availableFor(1, busy, '2026-11-29', '2026-12-02'), 1, 'after it is due -> free (re-borrow later)');
assert.equal(A.availableFor(1, busy, '2026-11-20', '2026-11-24'), 1, 'before it starts -> free');
assert.equal(A.availableFor(1, busy, '2026-11-24', '2026-11-26'), 0, 'window touching the start -> busy');
console.log('  ✅ re-borrow for non-overlapping dates is allowed');

// --- ปริมาณมากกว่า 1: ใช้ค่าพร้อมกันสูงสุด ไม่ใช่ผลรวมทุกคำขอ ---
const q1 = { 'สถานะ': 'รับเรื่องแล้ว', 'รหัสอุปกรณ์': 'M', 'จำนวน': 2, 'วันที่ต้องการรับ': '2026-12-01', 'วันที่ครบกำหนด': '2026-12-03' };
const q2 = { 'สถานะ': 'รับเรื่องแล้ว', 'รหัสอุปกรณ์': 'M', 'จำนวน': 2, 'วันที่ต้องการรับ': '2026-12-05', 'วันที่ครบกำหนด': '2026-12-07' };
const q3 = { 'สถานะ': 'รับเรื่องแล้ว', 'รหัสอุปกรณ์': 'M', 'จำนวน': 1, 'วันที่ต้องการรับ': '2026-12-02', 'วันที่ครบกำหนด': '2026-12-06' };
const bm = A.busyWindows('M', [q1, q2, q3], TODAY);
assert.equal(A.peakUsage(bm, '2026-12-01', '2026-12-07'), 3, 'q1(2)+q3(1) overlap on 12-02..12-03; q2(2)+q3(1) on 12-05..12-06 -> peak 3, not 5');
assert.equal(A.availableFor(5, bm, '2026-12-01', '2026-12-07'), 2);
assert.equal(A.availableFor(3, bm, '2026-12-01', '2026-12-07'), 0);
assert.equal(A.availableFor(5, [], '2026-12-01', '2026-12-07'), 5);
console.log('  ✅ peak concurrent usage (not the sum of all requests)');

// --- วันที่ว่างอีกครั้ง ---
assert.equal(A.nextFreeDate(1, busy, TODAY), '2026-11-29');
assert.equal(A.nextFreeDate(1, [], TODAY), TODAY);
assert.equal(A.nextFreeDate(0, [], TODAY), '', 'no stock');
assert.equal(A.nextFreeDate(2, busy, TODAY, 3), '', 'need more than stock');
assert.equal(A.nextFreeDate(2, A.busyWindows('M', [q1], TODAY), TODAY), TODAY, 'one of two units is free today');
console.log('  ✅ next free date');

// --- สถานะอุปกรณ์ ---
for (const s of ['ชำรุด', 'ส่งซ่อม', 'จำหน่าย', 'สูญหาย', 'ยืมอยู่']) assert.equal(A.isBorrowableStatus(s), false, s);
for (const s of ['พร้อมยืม', 'ประจำจุด', '', undefined]) assert.equal(A.isBorrowableStatus(s), true, String(s));
console.log('  ✅ equipment status');

// --- สำเนาในเบราว์เซอร์ต้องตรงกับต้นฉบับเสมอ (npm run build คัดลอกให้) ---
const pub = path.join(__dirname, '../public/borrow-availability.js');
assert.ok(fs.existsSync(pub), 'public/borrow-availability.js missing — run `npm run build`');
assert.equal(fs.readFileSync(pub, 'utf8'), fs.readFileSync(path.join(__dirname, '../backend-node/lib/borrowAvailability.js'), 'utf8'), 'browser copy is stale — run `npm run build`');
console.log('  ✅ browser copy identical to source');
console.log('\n🎉 ALL BORROW AVAILABILITY TESTS PASSED');
