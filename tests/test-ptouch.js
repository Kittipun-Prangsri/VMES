const assert = require('node:assert/strict');
const P = require('../public/ptouch-label.js');

// PackBits: encode -> decode ต้องได้ข้อมูลเดิมทุกกรณี
function unpack(packed) {
  const out = [];
  for (let i = 0; i < packed.length;) {
    const h = packed[i++];
    if (h < 128) { for (let k = 0; k <= h; k++) out.push(packed[i++]); }
    else { const n = 257 - h; const v = packed[i++]; for (let k = 0; k < n; k++) out.push(v); }
  }
  return out;
}
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let t = 0; t < 500; t++) {
  const src = Array.from({ length: 16 }, () => (rnd() < 0.5 ? 0 : Math.floor(rnd() * 4)));
  assert.deepEqual(unpack(P.packBits(src)), src, 'packbits roundtrip');
}
assert.deepEqual(unpack(P.packBits(new Array(16).fill(0xff))), new Array(16).fill(0xff));
console.log('  ✅ PackBits round-trip (500 random + edge)');

// ตาราง margin: margin*2 + pins = 128
for (const [mm, t] of Object.entries(P.TAPES)) assert.equal(t.margin * 2 + t.pins, 128, 'tape ' + mm);
console.log('  ✅ Tape geometry sums to 128 pins');

// bitmap 12 มม. กว้าง 5 คอลัมน์: คอลัมน์ 0 มีจุดล่างสุด (y = 69), คอลัมน์ 4 มีจุดบนสุด (y = 0)
const H = P.TAPES[12].pins, W = 5;
const data = new Uint8Array(W * H);
data[(H - 1) * W + 0] = 1;
data[0 * W + 4] = 1;
const lines = P.bitmapToRasterLines({ width: W, height: H, data }, 12);
assert.equal(lines.length, W);
const pinOf = (line) => { for (let p = 0; p < 128; p++) if (line[p >> 3] & (0x80 >> (p & 7))) return p; return -1; };
assert.equal(pinOf(lines[0]), 29, 'bottom pixel -> first printable pin (margin 29)');
assert.equal(pinOf(lines[4]), 29 + 69, 'top pixel -> last printable pin');
const flipped = P.bitmapToRasterLines({ width: W, height: H, data }, 12, { flipH: true, flipV: true });
assert.equal(pinOf(flipped[4]), 98, 'flipH+flipV: column 4 <- column 0, bottom pixel -> last pin');
assert.equal(pinOf(flipped[0]), 29, 'flipH+flipV: column 0 <- column 4, top pixel -> first pin');
assert.throws(() => P.bitmapToRasterLines({ width: 3, height: 10, data: new Uint8Array(30) }, 12), /ไม่ตรงกับเทป/);
console.log('  ✅ Raster orientation + margin mapping + height guard');

// โครงสร้างงานพิมพ์
const job = P.buildPrintJob({ width: W, height: H, data }, 12, { autoCut: true });
assert.deepEqual([...job.slice(0, 100)], new Array(100).fill(0), 'invalidate');
assert.deepEqual([...job.slice(100, 102)], [0x1b, 0x40], 'ESC @');
assert.deepEqual([...job.slice(102, 106)], [0x1b, 0x69, 0x61, 0x01], 'raster mode');
assert.deepEqual([...job.slice(106, 109)], [0x1b, 0x69, 0x7a], 'print info');
assert.equal(job[109], 0x84, 'valid flags'); assert.equal(job[111], 12, 'tape width byte');
assert.equal(job[113], W, 'raster line count LE');
assert.equal(job[job.length - 1], 0x1a, 'ends with print+feed');
// เดินอ่าน raster ทั้งงาน ต้องได้จำนวนเส้น = W และข้อมูลหลังคลายบีบอัดยาว 16 ไบต์ทุกเส้น
let i = job.indexOf(0x4d, 130);
while (!(job[i] === 0x4d && job[i + 1] === 0x02)) i = job.indexOf(0x4d, i + 1);
i += 2;
let count = 0;
while (i < job.length - 1) {
  if (job[i] === 0x5a) { count++; i++; continue; }
  assert.equal(job[i], 0x47, 'raster line marker at ' + i);
  const len = job[i + 1] | (job[i + 2] << 8);
  assert.equal(unpack([...job.slice(i + 3, i + 3 + len)]).length, 16);
  i += 3 + len; count++;
}
assert.equal(count, W);
console.log('  ✅ Print job structure (header, line count, 16-byte lines, terminator)');

// สถานะ
const st = new Uint8Array(32);
st[0] = 0x80; st[1] = 0x20; st[2] = 0x42; st[10] = 12; st[18] = 0x01; st[9] = 0x01;
const ps = P.parseStatus(st);
assert.equal(ps.tapeMm, 12); assert.equal(ps.statusType, 1);
assert.deepEqual(ps.errors, ['เทปที่ใส่ไม่ตรงกับความกว้างที่เลือก']);
assert.equal(P.parseStatus(new Uint8Array(32)), null);
const f = P.findStatus([1, 2, 3, ...st]);
assert.equal(f.index, 3);
console.log('  ✅ Status parsing');
assert.equal(P.thaiDate('2026-10-26'), '๒๖ ตุลาคม ๒๕๖๙');
assert.equal(P.thaiDate('2569-01-05'), '๕ มกราคม ๒๕๖๙');
assert.equal(P.thaiDate(''), '');
assert.equal(P.thaiDate('xx'), '');
console.log('  ✅ Thai date (ตัวอย่าง: ๒๖ ตุลาคม ๒๕๖๙)');
console.log('\n🎉 ALL PT-P710BT ENCODER TESTS PASSED');
