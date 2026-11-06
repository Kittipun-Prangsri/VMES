const assert = require('node:assert/strict');
const S = require('../public/field-survey-page.js');

const eqs = [
  { 'รหัส': 'A', 'รหัสครุภัณฑ์': '7440-14-0001/31', 'ชื่ออุปกรณ์': 'PC', 'ที่เก็บ': 'ห้องการเงิน ชั้น 2', 'ยี่ห้อ': 'Dell', 'ผู้สำรวจ': 'สมชาย' },
  { 'รหัส': 'B', 'รหัสครุภัณฑ์': '', 'ชื่ออุปกรณ์': 'จอภาพ', 'ที่เก็บ': 'ห้องการเงิน  ชั้น 2 ', 'สถานะป้ายครุภัณฑ์': 'ไม่มีป้าย', 'ผู้สำรวจ': 'สมหญิง' },
  { 'รหัส': 'C', 'รหัสครุภัณฑ์': '1234/56', 'ชื่ออุปกรณ์': 'พัดลม', 'ที่เก็บ': 'ห้องยา', 'สถานะป้ายครุภัณฑ์': 'ไม่มีป้าย' },
];

// เลขครุภัณฑ์ซ้ำ: ไม่สนตัวพิมพ์/ช่องว่างเกิน, ไม่นับตัวเอง, ว่าง = ไม่ซ้ำ
assert.equal(S.fsFindDuplicate(eqs, ' 7440-14-0001/31 ', '').รหัส, 'A');
assert.equal(S.fsFindDuplicate(eqs, '7440-14-0001/31', 'A'), null, 'excludes itself');
assert.equal(S.fsFindDuplicate(eqs, '', ''), null);
assert.equal(S.fsFindDuplicate(eqs, '9999', ''), null);
console.log('  ✅ duplicate asset-tag detection');

// ของในห้อง: ชื่อห้องต่างช่องว่างถือเป็นห้องเดียวกัน
assert.deepEqual(S.fsRoomItems(eqs, 'ห้องการเงิน ชั้น 2').map((e) => e['รหัส']), ['A', 'B']);
assert.deepEqual(S.fsRoomItems(eqs, '  '), []);
assert.deepEqual(S.fsRoomItems(eqs, 'ไม่มี'), []);
console.log('  ✅ items in room (whitespace-insensitive)');

// กรองรายการรอผูกเลข
const pending = eqs.filter((e) => e['สถานะป้ายครุภัณฑ์'] === 'ไม่มีป้าย');
assert.equal(S.fsFilterPending(pending, '', '').length, 2);
assert.deepEqual(S.fsFilterPending(pending, 'สมหญิง', '').map((e) => e['รหัส']), ['B']);
assert.deepEqual(S.fsFilterPending(pending, '', 'ห้องยา').map((e) => e['รหัส']), ['C']);
assert.deepEqual(S.fsFilterPending(pending, 'จอ การเงิน', '').map((e) => e['รหัส']), ['B'], 'multi-word');
assert.equal(S.fsFilterPending(pending, 'ไม่มี', '').length, 0);
console.log('  ✅ pending list filter (text, room, multi-word)');
console.log('\n🎉 ALL FIELD SURVEY TESTS PASSED');
