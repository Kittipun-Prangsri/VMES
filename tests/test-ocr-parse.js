const assert = require('node:assert/strict');
const OCR = require('../public/ocr-capture.js');

// --- เลขครุภัณฑ์ ---
assert.equal(OCR.parse('ครุภัณฑ์เลขที่\n7440-14-0001/31\nงานสารสนเทศ').tag, '7440-14-0001/31');
assert.equal(OCR.parse('7440-001-0006/191').tag, '7440-001-0006/191', '3-digit middle group, 3-digit year suffix');
assert.equal(OCR.parse('7440 - 14 - 0001 / 31').tag, '7440-14-0001/31', 'spaces around separators');
assert.equal(OCR.parse('7440–14–0001/31').tag, '7440-14-0001/31', 'en-dashes');
assert.equal(OCR.parse('7440-14-0001').tag, '7440-14-0001', 'no suffix');
assert.equal(OCR.parse('74AO-14-OOO1/31').tag, '', 'letters in the first group are not repaired (not enough real digits context)');
assert.equal(OCR.parse('7440-I4-OOO1/3l').tag, '7440-14-0001/31', 'O/I/l misreads repaired inside the tag pattern');
assert.equal(OCR.parse('7440-14-0001/31 และ 7440-14-0002/31').tags.length, 2);
assert.equal(OCR.parse('โทร 02-123-4567').tag, '', 'phone numbers are not asset tags');
assert.equal(OCR.parse('ABCD-EF-GHIJ').tag, '', 'plain words with dashes are ignored');
assert.equal(OCR.parse('').tag, '');
console.log('  ✅ asset tag parsing (formats, OCR misreads, false positives)');

// --- Serial ---
let p = OCR.parse('Dell Inc.\nService Tag: 7XK2M93\nModel: OptiPlex 7090');
assert.equal(p.serial, '7XK2M93'); assert.equal(p.brand, 'Dell'); assert.equal(p.model, 'OptiPlex 7090');
assert.equal(OCR.parse('S/N: PF2ABC123').serial, 'PF2ABC123');
assert.equal(OCR.parse('SN 1234-ABCD-99').serial, '1234-ABCD-99');
assert.equal(OCR.parse('Serial No: x9y8z7w6').serial, 'X9Y8Z7W6', 'upper-cased');
assert.equal(OCR.parse('S/N: AB1').serial, '', 'too short ignored');
assert.deepEqual(OCR.parse('S/N: AAAA11 \nSN: BBBB22').serials, ['AAAA11', 'BBBB22']);
console.log('  ✅ serial parsing (labels, casing, length, multiple)');

// ไม่มีคำนำหน้า: เสนอเป็น "คาดว่า" เท่านั้น ไม่ใส่เป็น serial อัตโนมัติ
p = OCR.parse('Made in China\nCNF8K12345X\n220V 50Hz');
assert.equal(p.serial, ''); assert.deepEqual(p.serialGuesses, ['CNF8K12345X']);
console.log('  ✅ unlabeled barcode-like tokens are only guesses');

// --- ยี่ห้อ / รุ่น ---
assert.equal(OCR.parse('HP LaserJet Pro M404dn').brand, 'HP');
assert.equal(OCR.parse('Hewlett-Packard Company').brand, 'HP');
assert.equal(OCR.parse('EPSON L3150').brand, 'Epson');
assert.equal(OCR.parse('TP-Link Archer C6').brand, 'TP-Link');
assert.equal(OCR.parse('Shipping information').brand, '', 'HP must not match inside other words');
assert.equal(OCR.parse('Model No.: M404dn').model, 'M404dn');
assert.equal(OCR.parse('M/N: ABC-123').model, 'ABC-123');
assert.equal(OCR.parse('Model:').model, '');
console.log('  ✅ brand / model parsing');

// --- บรรทัดดิบ ---
p = OCR.parse('  \n!\nบริษัท เอ จำกัด\n\nS/N: ABCDE12345\n');
assert.deepEqual(p.lines, ['บริษัท เอ จำกัด', 'S/N: ABCDE12345']);
console.log('  ✅ raw lines cleaned');
console.log('\n🎉 ALL OCR PARSE TESTS PASSED');
