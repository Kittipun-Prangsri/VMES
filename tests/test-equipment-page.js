const assert = require('node:assert/strict');
const E = require('../public/equipment-page.js');

const mk = (o) => Object.assign({ 'จำนวน': 1, 'มูลค่า': 0 }, o);
const items = [
  mk({ 'รหัส': 'a', 'รหัสครุภัณฑ์': '7440-14-0010', 'ชื่ออุปกรณ์': 'เครื่องพิมพ์', 'หมวดหมู่': 'คอมพิวเตอร์', 'ที่เก็บ': 'ห้อง 2', 'มูลค่า': 5000, Serial: 12345 }),
  mk({ 'รหัส': 'b', 'รหัสครุภัณฑ์': '7440-14-0002', 'ชื่ออุปกรณ์': 'จอภาพ Dell', 'หมวดหมู่': 'คอมพิวเตอร์', 'ที่เก็บ': 'ห้อง 10', 'มูลค่า': 3000, 'จำนวน': 3 }),
  mk({ 'รหัส': 'c', 'รหัสครุภัณฑ์': '', 'ชื่ออุปกรณ์': 'โต๊ะ', 'หมวดหมู่': 'เฟอร์นิเจอร์', 'ที่เก็บ': '', 'มูลค่า': 1200 }),
  mk({ 'รหัส': 'd', 'รหัสครุภัณฑ์': '1234/56', 'ชื่ออุปกรณ์': 'พัดลม', 'หมวดหมู่': '', 'ที่เก็บ': 'ห้อง 2', 'มูลค่า': 800, 'จำนวน': 2 }),
];
const st = (o) => Object.assign({}, E.EQ_STATE_DEFAULT, { collapsed: {} }, o);

// filter: หลายคำ, ตัวเลข Serial, ช่องว่างหน้าหลัง
assert.deepEqual(E.eqFilter(items, st({ text: '  dell  จอ ' })).map(e => e['รหัส']), ['b']);
assert.deepEqual(E.eqFilter(items, st({ text: '12345' })).map(e => e['รหัส']), ['a'], 'numeric serial must not throw');
assert.deepEqual(E.eqFilter(items, st({ cat: 'คอมพิวเตอร์', loc: 'ห้อง 2' })).map(e => e['รหัส']), ['a']);
console.log('  ✅ filter (multi-word, numeric serial, cat+loc)');

// sort: ตัวเลขในข้อความเรียงตามค่า (0002 < 0010), ค่าว่างท้ายสุดทั้ง asc/desc, ตัวเลขเทียบเป็น number
const ids = (arr) => arr.map(e => e['รหัส']).join('');
assert.equal(E.eqSort(items, 'tag', 'asc').slice(-1)[0]['รหัส'], 'c');
assert.equal(E.eqSort(items, 'tag', 'desc').slice(-1)[0]['รหัส'], 'c', 'empty last even when desc');
const tagAsc = E.eqSort(items, 'tag', 'asc').map(e => e['รหัสครุภัณฑ์']);
assert.ok(tagAsc.indexOf('7440-14-0002') < tagAsc.indexOf('7440-14-0010'));
assert.equal(ids(E.eqSort(items, 'price', 'desc')), 'abcd');
assert.equal(ids(E.eqSort(items, 'qty', 'desc'))[0], 'b');
assert.equal(E.eqSort(items, '', 'asc'), items, 'no key = unchanged');
console.log('  ✅ sort (natural order, empties last, numeric)');

// group: ไม่ระบุอยู่ท้าย, ย่อกลุ่มแล้วไม่มีแถว, ผลรวมคำนวณจำนวน×มูลค่า
let en = E.eqBuildEntries(items, st({ group: 'cat' }));
const heads = en.filter(x => x.type === 'group');
assert.deepEqual(heads.map(g => g.name), ['คอมพิวเตอร์', 'เฟอร์นิเจอร์', '(ไม่ระบุ)']);
assert.equal(heads[0].sum, 5000 + 3000 * 3);
assert.equal(heads[0].count, 2);
en = E.eqBuildEntries(items, st({ group: 'cat', collapsed: { 'cat:คอมพิวเตอร์': true } }));
assert.equal(en.filter(x => x.type === 'row').length, 2);
assert.equal(en.find(x => x.type === 'group' && x.name === 'คอมพิวเตอร์').collapsed, true);
assert.equal(E.eqBuildEntries(items, st({ group: 'loc' })).filter(x => x.type === 'group').slice(-1)[0].name, '(ไม่ระบุ)');
console.log('  ✅ group (ordering, totals, collapse)');

// paginate
const many = Array.from({ length: 123 }, (_, i) => ({ type: 'row', e: { i } }));
let pg = E.eqPaginate(many, 1, 50);
assert.equal(pg.slice.length, 50); assert.equal(pg.pages, 3);
pg = E.eqPaginate(many, 99, 50);
assert.equal(pg.page, 3); assert.equal(pg.slice.length, 23, 'page clamped');
assert.equal(E.eqPaginate(many, 1, 0).slice.length, 123, 'size 0 = all');
assert.equal(E.eqPaginate([], 5, 50).page, 1);
console.log('  ✅ pagination (clamp, all, empty)');

assert.equal(E.eqNorm('  a   b \n c '), 'a b c');
console.log('\n🎉 ALL EQUIPMENT PAGE TESTS PASSED');
