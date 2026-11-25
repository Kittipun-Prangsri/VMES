const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.LINE_TOKEN = 'test-token';
process.env.LINE_GROUP_ID = 'GROUP';
process.env.LINE_CHANNEL_SECRET = 'test-channel-secret';

// ฐานข้อมูลในหน่วยความจำแทน firestore.js
const fsPath = require.resolve('../backend-node/lib/firestore');
const store = { equipment: {}, borrowing: {}, users: {}, audit: {}, notifications: {}, equipmentCategory: {}, settings: {}, booking: {}, vehicles: {}, drivers: {} };
require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: {
  SHEETS: { EQUIPMENT: 'equipment', BORROWING: 'borrowing', USERS: 'users', AUDIT: 'audit', NOTIFICATIONS: 'notifications', EQUIPMENT_CATEGORY: 'equipmentCategory', SETTINGS: 'settings', BOOKING: 'booking', VEHICLES: 'vehicles', DRIVERS: 'drivers' },
  listDocs: async (c) => Object.values(store[c] || (store[c] = {})).map((d) => ({ ...d })),
  getDoc: async (c, id) => (store[c] && store[c][id] ? { ...store[c][id] } : null),
  setDoc: async (c, id, d) => { (store[c] || (store[c] = {}))[id] = { ...d }; return true; },
  deleteDoc: async (c, id) => { delete store[c][id]; return true; },
} };

// จับข้อความที่ส่งออก LINE
let pushes = [], replies = [];
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body || '{}');
  if (url.includes('/message/reply')) replies.push(body); else if (url.includes('/message/push')) pushes.push(body);
  return { status: 200, text: async () => '{}', json: async () => ({}) };
};

const B = require('../backend-node/lib/handlers/borrowing');
const webhook = require('../backend-node/api/line-webhook');
const { todayStr } = require('../backend-node/lib/util');

const today = todayStr();
const plus = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dmy = (iso) => iso.split('-').reverse().join('/');
const walk = (n, f) => { if (Array.isArray(n)) n.forEach((x) => walk(x, f)); else if (n && typeof n === 'object') { f(n); Object.values(n).forEach((x) => walk(x, f)); } };
const labels = (flex) => { const out = []; walk(flex, (n) => { if (n.action && n.action.label) out.push(n.action.label); }); return out.join('\n'); };
const texts = (flex) => { const out = []; walk(flex, (n) => { if (n.type === 'text') out.push(n.text); }); return out.join('\n'); };

const send = async (text, userId) => {
  const raw = JSON.stringify({ events: [{ replyToken: 'rt', source: { userId }, message: { type: 'text', text } }] });
  const sig = crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(raw).digest('base64');
  let code = 0;
  await webhook({ body: raw, headers: { 'x-line-signature': sig } }, { status(c) { code = c; return this; }, send() { return this; } });
  assert.equal(code, 200);
  return replies[replies.length - 1];
};

const setup = () => {
  for (const k of Object.keys(store)) store[k] = {};
  pushes = []; replies = [];
  store.equipment.L1 = { 'รหัส': 'L1', 'ชื่ออุปกรณ์': 'โน้ตบุ๊ก', 'จำนวน': 1, 'หน่วยนับ': 'เครื่อง', 'สถานะ': 'พร้อมยืม', 'หน่วยงานที่รับผิดชอบ': 'งานสารสนเทศ' };
  store.users.S1 = { 'รหัส': 'S1', 'ชื่อ-นามสกุล': 'สมหญิง เจ้าหน้าที่', 'LINE ID': 'U-staff', 'บทบาท': 'manager', 'สถานะ': 'ใช้งาน' };
  store.users.S2 = { 'รหัส': 'S2', 'ชื่อ-นามสกุล': 'สมชาย ผู้ยืม', 'LINE ID': 'U-borrower', 'บทบาท': 'user', 'สถานะ': 'ใช้งาน' };
  store.borrowing['BR-X'] = { 'รหัส': 'BR-X', 'สถานะ': 'อยู่ในระหว่างการยืม', 'รหัสอุปกรณ์': 'L1', 'ชื่ออุปกรณ์': 'โน้ตบุ๊ก', 'จำนวน': 1, 'ผู้ขอยืม': 'สมชาย ผู้ยืม', 'LINE_USER_ID': 'U-borrower', 'ผู้รับเรื่อง': 'สมหญิง เจ้าหน้าที่',
    'วันที่ต้องการรับ': dmy(plus(-1)), 'วันที่ครบกำหนด': dmy(plus(2)), 'วันที่ขอยืม': dmy(plus(-1)) };
};
const reserve = (from, to) => { store.borrowing['BR-NEXT'] = { 'รหัส': 'BR-NEXT', 'สถานะ': 'รอรับเรื่อง', 'รหัสอุปกรณ์': 'L1', 'จำนวน': 1, 'ผู้ขอยืม': 'คนอื่น', 'วันที่ต้องการรับ': dmy(from), 'วันที่ครบกำหนด': dmy(to) }; };

(async () => {
  // ---------- ขอขยาย (backend) ----------
  setup();
  let r = await B.requestBorrowExtension('BR-X', plus(5), 'ต้องใช้ต่อ', 'สมชาย ผู้ยืม');
  assert.equal(r.success, true, r.message);
  let it = store.borrowing['BR-X'];
  assert.equal(it['สถานะ'], 'ขอขยายเวลา'); assert.equal(it['วันที่ขอขยายเป็น'], dmy(plus(5)), 'stored in the same dd/mm/yyyy format as the request');
  assert.equal(r.newDueDate, dmy(plus(5)));
  assert.equal(pushes.length, 2);
  const g = pushes.find((p) => p.to === 'GROUP').messages[0].contents, u = pushes.find((p) => p.to === 'U-borrower').messages[0].contents;
  assert.ok(labels(g).includes('อนุมัติขยายเวลา') && labels(g).includes('ไม่อนุมัติ'), 'staff card has approve + reject');
  assert.ok(!labels(u).includes('อนุมัติขยายเวลา') && !labels(u).includes('ไม่อนุมัติ'), 'borrower card has no approval buttons');
  assert.ok(texts(g).includes(dmy(plus(5))) && texts(u).includes(dmy(plus(5))), 'both cards show the requested date');
  console.log('  ✅ request: status/date stored, staff card has approve+reject, borrower card has none');

  // ---------- ตรวจข้อผิดพลาดตอนขอ ----------
  const badReq = async (arg, re) => { setup(); const x = await B.requestBorrowExtension('BR-X', arg, 'x', 'u'); assert.equal(x.success, false, String(arg)); assert.match(x.message, re); assert.equal(store.borrowing['BR-X']['สถานะ'], 'อยู่ในระหว่างการยืม', 'unchanged on rejection'); };
  await badReq('abc', /วันที่ขอขยายเวลาไม่ถูกต้อง/);
  await badReq(plus(2), /หลังวันครบกำหนดเดิม/);
  await badReq(plus(1), /หลังวันครบกำหนดเดิม/);
  await badReq(plus(2 + 61), /ไม่เกิน 60 วัน/);
  setup(); store.borrowing['BR-X']['สถานะ'] = 'คืนเสร็จสิ้น';
  r = await B.requestBorrowExtension('BR-X', plus(5), 'x', 'u'); assert.equal(r.success, false); assert.match(r.message, /กำลังยืมอยู่/);
  setup(); store.borrowing['BR-X']['สถานะ'] = 'ขอขยายเวลา';
  r = await B.requestBorrowExtension('BR-X', plus(5), 'x', 'u'); assert.equal(r.success, false); assert.match(r.message, /ส่งขอขยายเวลาไปแล้ว/);
  console.log('  ✅ request validation (format, not after current due, cap, status, duplicate request)');

  // ---------- ชนคิวของคนถัดไป ----------
  setup(); reserve(plus(4), plus(6)); // มีคนจองคิวต่อวันที่ due+2
  r = await B.requestBorrowExtension('BR-X', plus(5), 'x', 'u');
  assert.equal(r.success, false); assert.match(r.message, /จองคิวต่อ/); assert.ok(r.message.includes(dmy(plus(7))), 'tells when it is free again');
  r = await B.requestBorrowExtension('BR-X', plus(3), 'x', 'u');
  assert.equal(r.success, true, 'extending only up to the day before the next reservation is fine');
  console.log('  ✅ extension blocked when it would collide with the next reservation');

  // ---------- อนุมัติ ----------
  setup(); await B.requestBorrowExtension('BR-X', plus(5), 'ต้องใช้ต่อ', 'สมชาย ผู้ยืม'); pushes = [];
  r = await B.approveBorrowExtension('BR-X', '', 'สมชาย ผู้ยืม');
  assert.equal(r.success, false); assert.match(r.message, /ไม่มีสิทธิ์/); assert.equal(store.borrowing['BR-X']['สถานะ'], 'ขอขยายเวลา', 'a normal user cannot approve');
  r = await B.approveBorrowExtension('BR-X', '', 'สมหญิง เจ้าหน้าที่');
  assert.equal(r.success, true, r.message);
  it = store.borrowing['BR-X'];
  assert.equal(it['สถานะ'], 'อยู่ในระหว่างการยืม'); assert.equal(it['วันที่ครบกำหนด'], dmy(plus(5))); assert.equal(it['วันที่ขอขยายเป็น'], '');
  assert.equal(it['ผู้อนุมัติขยายเวลา'], 'สมหญิง เจ้าหน้าที่'); assert.equal(it['ผู้รับเรื่อง'], 'สมหญิง เจ้าหน้าที่', 'deliverer name is not overwritten');
  assert.equal(pushes.length, 2); assert.ok(pushes.every((p) => /อนุมัติขยายเวลา/.test(JSON.stringify(p.messages[0].contents))));
  r = await B.approveBorrowExtension('BR-X', '', 'สมหญิง เจ้าหน้าที่');
  assert.equal(r.success, false); assert.match(r.message, /ไม่ได้อยู่ในสถานะรออนุมัติ/);
  console.log('  ✅ approve: staff only, due date updated, requested date cleared, deliverer kept, notifications sent');

  // ระหว่างรออนุมัติมีคนจองคิวต่อ -> อนุมัติต้องไม่ผ่าน (ตรวจซ้ำตอนอนุมัติ)
  setup(); await B.requestBorrowExtension('BR-X', plus(5), 'x', 'u'); reserve(plus(4), plus(6));
  r = await B.approveBorrowExtension('BR-X', '', 'สมหญิง เจ้าหน้าที่');
  assert.equal(r.success, false); assert.match(r.message, /จองคิวต่อ/); assert.equal(store.borrowing['BR-X']['สถานะ'], 'ขอขยายเวลา', 'stays pending');
  console.log('  ✅ approve re-checks collisions with reservations made while waiting');

  // ---------- ไม่อนุมัติ ----------
  setup(); await B.requestBorrowExtension('BR-X', plus(5), 'x', 'u'); pushes = [];
  assert.equal((await B.rejectBorrowExtension('BR-X', 'สมชาย ผู้ยืม', 'x')).success, false, 'normal user cannot reject');
  r = await B.rejectBorrowExtension('BR-X', 'สมหญิง เจ้าหน้าที่', 'มีคนจองต่อ');
  assert.equal(r.success, true, r.message);
  it = store.borrowing['BR-X'];
  assert.equal(it['สถานะ'], 'อยู่ในระหว่างการยืม'); assert.equal(it['วันที่ครบกำหนด'], dmy(plus(2)), 'due date unchanged'); assert.equal(it['วันที่ขอขยายเป็น'], '');
  assert.match(it['หมายเหตุ'], /ไม่อนุมัติขยายเวลา.*มีคนจองต่อ/);
  const ru = pushes.find((p) => p.to === 'U-borrower').messages[0].contents;
  assert.match(texts(ru), /ไม่อนุมัติขยายเวลา/); assert.ok(labels(ru).includes('แจ้งคืนอุปกรณ์'), 'borrower is told to return on time and gets the return button');
  console.log('  ✅ reject: back to borrowing with original due date, reason noted, borrower notified');

  // ---------- ผ่านแชท: ผู้ยืม ----------
  setup();
  let rep = await send('ขอขยายเวลา BR-X', 'U-borrower');
  assert.equal(store.borrowing['BR-X']['สถานะ'], 'อยู่ในระหว่างการยืม', 'no days given -> only shows options');
  const opts = rep.messages[0].contents, optLabels = labels(opts);
  for (const n of [1, 3, 7]) assert.ok(optLabels.includes(`+${n} วัน (คืนถึง ${dmy(plus(2 + n))})`), `option +${n} shows the resulting date`);
  let sentTexts = []; walk(opts, (n) => { if (n.action && n.action.type === 'message') sentTexts.push(n.action.text); });
  assert.deepEqual(sentTexts, ['ขอขยายเวลา BR-X 1 วัน', 'ขอขยายเวลา BR-X 3 วัน', 'ขอขยายเวลา BR-X 7 วัน']);
  console.log('  ✅ chat: borrower gets quick options with the resulting dates');

  setup(); pushes = [];
  rep = await send('ขอขยายเวลา BR-X 3 วัน', 'U-borrower');
  assert.equal(store.borrowing['BR-X']['สถานะ'], 'ขอขยายเวลา'); assert.equal(store.borrowing['BR-X']['วันที่ขอขยายเป็น'], dmy(plus(5)));
  assert.match(texts(rep.messages[0].contents), /ส่งคำขอขยายเวลาแล้ว/); assert.ok(pushes.some((p) => p.to === 'GROUP'), 'staff group notified');
  setup(); await send('ขอขยายเวลาคืน BR-X ' + dmy(plus(4)), 'U-borrower');
  assert.equal(store.borrowing['BR-X']['วันที่ขอขยายเป็น'], dmy(plus(4)), 'typed date + "ขอขยายเวลาคืน" is not mistaken for a return');
  assert.equal(store.borrowing['BR-X']['สถานะ'], 'ขอขยายเวลา');
  setup(); rep = await send('ขอขยายเวลา BR-X 3 วัน', 'U-staff');
  assert.equal(store.borrowing['BR-X']['สถานะ'], 'อยู่ในระหว่างการยืม'); assert.match(texts(rep.messages[0].contents), /ไม่ใช่คำขอของคุณ/);
  setup(); rep = await send('ขอขยายเวลา BR-X 99 วัน', 'U-borrower'); assert.match(texts(rep.messages[0].contents), /1–30 วัน/); assert.equal(store.borrowing['BR-X']['สถานะ'], 'อยู่ในระหว่างการยืม');
  setup(); reserve(plus(4), plus(6)); rep = await send('ขอขยายเวลา BR-X 3 วัน', 'U-borrower'); assert.match(texts(rep.messages[0].contents), /จองคิวต่อ/);
  setup(); store.borrowing['BR-X']['สถานะ'] = 'รอรับเรื่อง'; rep = await send('ขอขยายเวลา BR-X 3 วัน', 'U-borrower'); assert.match(texts(rep.messages[0].contents), /กำลังยืมอยู่/);
  setup(); rep = await send('ขอขยายเวลา BR-NOPE 3 วัน', 'U-borrower'); assert.match(texts(rep.messages[0].contents), /ไม่พบคำขอ/);
  console.log('  ✅ chat: request by days/date, ownership, limits, collision, status, unknown code');

  // ---------- ผ่านแชท: เจ้าหน้าที่ ----------
  setup(); await B.requestBorrowExtension('BR-X', plus(5), 'x', 'u');
  rep = await send('อนุมัติขยาย BR-X', 'U-borrower');
  assert.match(texts(rep.messages[0].contents), /ไม่มีสิทธิ์|ไม่ได้ผูก|อนุมัติ.*ได้/); assert.equal(store.borrowing['BR-X']['สถานะ'], 'ขอขยายเวลา', 'borrower (non-staff) cannot approve from chat');
  rep = await send('อนุมัติขยาย BR-X', 'U-nobody');
  assert.match(texts(rep.messages[0].contents), /ไม่ได้ผูกกับบัญชี/); assert.equal(store.borrowing['BR-X']['สถานะ'], 'ขอขยายเวลา');
  rep = await send('ไม่อนุมัติขยาย BR-X ของถูกจองต่อ', 'U-staff');
  assert.equal(store.borrowing['BR-X']['สถานะ'], 'อยู่ในระหว่างการยืม', '"ไม่อนุมัติขยาย" must not be handled as an approval'); assert.equal(store.borrowing['BR-X']['วันที่ครบกำหนด'], dmy(plus(2)));
  assert.match(store.borrowing['BR-X']['หมายเหตุ'], /ของถูกจองต่อ/);
  setup(); await B.requestBorrowExtension('BR-X', plus(5), 'x', 'u');
  rep = await send('อนุมัติขยาย BR-X', 'U-staff');
  assert.equal(store.borrowing['BR-X']['วันที่ครบกำหนด'], dmy(plus(5))); assert.match(texts(rep.messages[0].contents), new RegExp(dmy(plus(5))));
  rep = await send('อนุมัติขยาย BR-X', 'U-staff'); assert.match(texts(rep.messages[0].contents), /ไม่ได้อยู่ในสถานะรออนุมัติ/);
  console.log('  ✅ chat: staff approve/reject buttons work, non-staff and unbound accounts refused');

  console.log('\n🎉 ALL EXTENSION TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
