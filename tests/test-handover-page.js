const assert = require('node:assert/strict');
// ไฟล์หน้าเว็บอ้าง window/document ตอนโหลด — ใส่ shim เพื่อโหลดเข้า Node ทดสอบฟังก์ชันล้วนได้
global.window = {};
global.document = { addEventListener() {} };
global.DATA = { equipmentHandover: [] };
const H = require('../public/handover-page.js');

const eqs = { E1: { 'Serial': 'SN-777', 'ที่เก็บ': 'ห้อง IT' }, E2: { 'Serial': 'ZZ', 'ที่เก็บ': 'ห้องยา' } };
const equipOf = (id) => eqs[id];
const mk = (o) => Object.assign({ 'สถานะ': 'ส่งมอบแล้ว', giveCheck_scratch: true }, o);
const all = [
  mk({ 'รหัส': 'HO-1', equipId: 'E1', 'รายการ': 'เครื่องพิมพ์', 'เลขครุภัณฑ์': '7440-14-0001/31', 'ส่งมอบให้หน่วยงาน': 'OPD', 'ผู้รับผิดชอบ': 'สมชาย ใจดี', 'ส่งมอบ_วันที่ส่งมอบ': '2026-10-05' }),
  mk({ 'รหัส': 'HO-2', equipId: 'E2', 'รายการ': 'จอภาพ', 'เลขครุภัณฑ์': '7440-14-0002/31', 'ส่งมอบให้หน่วยงาน': 'IT', 'ผู้รับผิดชอบ': 'สมหญิง', 'ส่งมอบ_วันที่ส่งมอบ': '2026-10-20', 'สถานะ': 'รับคืนแล้ว' }),
  mk({ 'รหัส': 'HO-10', equipId: 'E1', 'รายการ': 'เครื่องพิมพ์', 'เลขครุภัณฑ์': '7440-14-0001/31', 'ส่งมอบให้หน่วยงาน': 'OPD', 'ผู้รับผิดชอบ': '', 'วันที่บันทึก': '2026-10-01 10:00:00' }),
];
const st = (o) => Object.assign({}, H.HO_STATE_DEFAULT, o);

// ค้นหา: เฉพาะฟิลด์ที่แสดง + Serial/ที่เก็บของครุภัณฑ์, หลายคำ, ไม่ติดค่า boolean ของเช็กลิสต์
assert.deepEqual(H.hoFilter(all, st({ text: 'sn-777 opd' }), equipOf).map((h) => h['รหัส']), ['HO-1', 'HO-10']);
assert.deepEqual(H.hoFilter(all, st({ text: 'ห้องยา' }), equipOf).map((h) => h['รหัส']), ['HO-2'], 'matches equipment location');
assert.equal(H.hoFilter(all, st({ text: 'true' }), equipOf).length, 0, 'does not match raw checklist booleans');
assert.equal(H.hoFilter(all, st({ text: 'giveCheck' }), equipOf).length, 0, 'does not match field names');
assert.deepEqual(H.hoFilter(all, st({ status: 'รับคืนแล้ว' }), equipOf).map((h) => h['รหัส']), ['HO-2']);
assert.deepEqual(H.hoFilter(all, st({ dept: 'IT' }), equipOf).map((h) => h['รหัส']), ['HO-2']);
console.log('  ✅ handover filter (fields, multi-word, status, dept)');

// เรียง: ตามวันที่, เลขเอกสารตามค่าตัวเลข (HO-2 ก่อน HO-10), ค่าว่างท้ายเสมอ
assert.deepEqual(H.hoSort(all, 'date', 'desc').map((h) => h['รหัส']), ['HO-2', 'HO-1', 'HO-10']);
assert.deepEqual(H.hoSort(all, 'id', 'asc').map((h) => h['รหัส']), ['HO-1', 'HO-2', 'HO-10']);
assert.equal(H.hoSort(all, 'person', 'asc').slice(-1)[0]['รหัส'], 'HO-10');
assert.equal(H.hoSort(all, 'person', 'desc').slice(-1)[0]['รหัส'], 'HO-10', 'empty last in both directions');
assert.equal(H.hoSort(all, 'nope', 'asc'), all);
console.log('  ✅ handover sort (date, natural id, empties last)');
console.log('\n🎉 ALL HANDOVER PAGE TESTS PASSED');
