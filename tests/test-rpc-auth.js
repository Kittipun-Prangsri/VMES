// ฟังก์ชันที่ดึงทะเบียนอุปกรณ์ทั้งหมด (มูลค่า/เลขครุภัณฑ์/ที่เก็บ) ต้องไม่เปิดสาธารณะ — LIFF ใช้ getBorrowCatalog ซึ่งคัดเฉพาะฟิลด์ที่จำเป็น
process.env.SESSION_SECRET = 'x'.repeat(40);
const assert = require('node:assert/strict');
const fsPath = require.resolve('../backend-node/lib/firestore');
const store = { equipment: [{ 'รหัส': 'E1', 'ชื่ออุปกรณ์': 'โน้ตบุ๊ก', 'มูลค่า': 23000, 'หน่วยงานที่รับผิดชอบ': 'งานสารสนเทศ', 'สถานะ': 'พร้อมยืม', 'จำนวน': 1 }] };
require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: {
  SHEETS: new Proxy({}, { get: (_, k) => String(k).toLowerCase() }),
  listDocs: async (c) => (store[c] || []).map((d) => ({ ...d })), getDoc: async () => null, setDoc: async (c, id, d) => { (store[c] = store[c] || []).push({ ...d }); return true; }, deleteDoc: async () => true,
} };
const handler = require('../backend-node/api/rpc');
const call = async (fn, args) => {
  let status = 0, json = null;
  await handler({ method: 'POST', headers: {}, body: JSON.stringify({ fn, args: args || [] }) },
    { setHeader() {}, status(c) { status = c; return this; }, json(j) { json = j; return this; }, end() { return this; } });
  return { status, json };
};
(async () => {
  for (const fn of ['getEquipment', 'getEquipmentCategories']) {
    const r = await call(fn);
    assert.equal(r.status, 401, fn + ' must require a session'); assert.ok(!JSON.stringify(r.json).includes('23000'), 'no data leaked');
  }
  const cat = await call('getBorrowCatalog');
  assert.equal(cat.status, 200); assert.equal(cat.json.success, true);
  assert.ok(!JSON.stringify(cat.json).includes('23000'), 'catalog exposes no asset value');
  store.departments = [{ 'รหัส': 'D1', 'ชื่อหน่วยงาน': 'งานสารสนเทศ', 'หัวหน้า': 'นายลับ', 'เบอร์โทร': '0899999999' }, { 'รหัส': 'D2', 'ชื่อหน่วยงาน': ' ห้องคลอด ' }, { 'รหัส': 'D3', 'ชื่อหน่วยงาน': 'ห้องคลอด' }];
  const dn = await call('getDepartmentNames');
  assert.equal(dn.status, 200); assert.deepEqual(dn.json.names, ['ห้องคลอด', 'งานสารสนเทศ'].sort((a, b) => a.localeCompare(b, 'th')), 'names only, deduped, sorted');
  assert.ok(!JSON.stringify(dn.json).includes('0899999999') && !JSON.stringify(dn.json).includes('นายลับ'), 'no head/phone leaked');
  const reg = await call('registerLiffUser', ['U-new', 'disp', 'สมหญิง', '0811111111', 'ห้อง  คลอด']);
  assert.equal(reg.json.success, true);
  assert.equal(store.users.find((u) => u['LINE ID'] === 'U-new')['หน่วยงาน'], 'ห้องคลอด', 'registered department uses the master spelling');
  const reg2 = await call('registerLiffUser', ['U-new2', 'disp', 'สมชาย', '0822222222', 'แผนกใหม่ที่ยังไม่มี']);
  assert.equal(store.users.find((u) => u['LINE ID'] === 'U-new2')['หน่วยงาน'], 'แผนกใหม่ที่ยังไม่มี', 'unknown department is kept as typed');
  const sug = await call('getBorrowSuggestions');
  assert.equal(sug.status, 200); assert.equal(sug.json.success, true);
  console.log('  ✅ department names public (names only); registration canonicalises spelling\n  ✅ getEquipment/getEquipmentCategories need login; borrow catalog stays public without asset values');
  console.log('\n🎉 ALL RPC AUTH TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
