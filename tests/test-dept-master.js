const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../backend-node/lib/departmentsMaster');

assert.equal(D.REAL.length, 31, 'real list has the 31 departments from the hospital');
assert.equal(new Set(D.REAL.map(D.key)).size, D.REAL.length, 'no duplicates in the real list');
assert.ok(D.REAL.every((n) => n === D.norm(n)), 'real names are stored space-normalised');
assert.ok(D.REAL.includes('งานสารสนเทศ') && D.REAL.includes('IC'));
assert.equal(D.LEGACY.filter((n) => D.REAL.some((r) => D.key(r) === D.key(n))).length, 0, 'a name cannot be both real and legacy');

// merge: ชื่อจริงเสมอ + ที่ผู้ดูแลเพิ่ม − ชื่อเก่า; ไม่ซ้ำแม้สะกดต่างช่องว่าง
const m = D.merge(['ห้องคลอด', 'อิทธิพล คนจริง', ' งานโภชนศาสตร์', 'งานสาร สนเทศ', 'ศูนย์ใหม่ที่ผู้ดูแลเพิ่ม', 'ศูนย์ใหม่ที่ผู้ดูแลเพิ่ม', '']);
assert.ok(!m.includes('ห้องคลอด') && !m.includes('อิทธิพล คนจริง'), 'legacy/test names are hidden');
assert.equal(m.filter((n) => D.key(n) === D.key('งานโภชนศาสตร์')).length, 1, 'spacing variants collapse');
assert.equal(m.filter((n) => D.key(n) === D.key('งานสารสนเทศ')).length, 1);
assert.ok(m.includes('ศูนย์ใหม่ที่ผู้ดูแลเพิ่ม'), 'admin-added departments are kept');
assert.equal(m.length, 32);
assert.deepEqual(D.merge(), D.merge([]), 'works without DB names');
assert.equal(D.find('ชันสุตร   (จุลทรรศนศาสตร์คลีนิก และโลหิตวิทยา)'), D.REAL[6], 'canonical spelling for messy input');
assert.equal(D.find('ห้องคลอด'), undefined);
console.log('  ✅ department master: real list, legacy hidden, admin additions kept, spacing-insensitive');

const pub = path.join(__dirname, '../public/departments-master.js');
assert.ok(fs.existsSync(pub), 'public/departments-master.js missing — run `npm run build`');
assert.equal(fs.readFileSync(pub, 'utf8'), fs.readFileSync(path.join(__dirname, '../backend-node/lib/departmentsMaster.js'), 'utf8'), 'browser copy is stale — run `npm run build`');
console.log('  ✅ browser copy identical to source');
console.log('\n🎉 ALL DEPARTMENT MASTER TESTS PASSED');
