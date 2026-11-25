const assert = require('node:assert/strict');

// Mock environmental variables
process.env.LINE_TOKEN = 'test-token-12345';
process.env.LINE_GROUP_ID = 'test-group-67890';
process.env.LINE_CHANNEL_SECRET = 'test-channel-secret';
process.env.FIREBASE_PROJECT_ID = 'dummy-project-id';

// Mock firebase-admin modules in require.cache before firestore.js loading
require('firebase-admin/app');
require.cache[require.resolve('firebase-admin/app')] = {
  exports: {
    initializeApp: () => ({}),
    cert: () => ({}),
    getApps: () => [{}],
    getApp: () => ({}),
  },
};

require('firebase-admin/firestore');
require.cache[require.resolve('firebase-admin/firestore')] = {
  exports: {
    getFirestore: () => ({
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false, data: () => ({}) }),
          set: async () => {},
          delete: async () => {},
          update: async () => {},
        }),
        get: async () => ({ docs: [] }),
      }),
    }),
    FieldValue: { delete: () => {} },
  },
};

// Mock firestore listDocs so tests run offline without network
const firestore = require('../backend-node/lib/firestore');
firestore.listDocs = async (sheetName) => {
  if (sheetName === 'vehicles') {
    return [
      { รหัส: 'VH-001', ทะเบียน: 'กข 1234', ยี่ห้อ: 'Toyota', รุ่น: 'Hilux', สถานะ: 'พร้อมใช้งาน' },
      { รหัส: 'VH-002', ทะเบียน: 'คง 5678', ยี่ห้อ: 'Isuzu', รุ่น: 'D-Max', สถานะ: 'อยู่ระหว่างซ่อมบำรุง' },
    ];
  }
  if (sheetName === 'equipment') {
    return [
      { รหัส: 'EQ-001', ชื่ออุปกรณ์: 'Notebook Dell Latitude', หมวดหมู่: 'คอมพิวเตอร์', จำนวน: 5, หน่วยนับ: 'เครื่อง', สถานะ: 'พร้อมใช้งาน', ยี่ห้อ: 'Dell', รุ่น: 'Latitude 5420', ที่เก็บ: 'งานสารสนเทศ' },
      { รหัส: 'EQ-002', ชื่ออุปกรณ์: 'Projector Epson', หมวดหมู่: 'โสตทัศนูปกรณ์', จำนวน: 2, หน่วยนับ: 'เครื่อง', สถานะ: 'พร้อมใช้งาน', ยี่ห้อ: 'Epson', รุ่น: 'EB-X06', ที่เก็บ: 'งานสารสนเทศ' },
    ];
  }
  if (sheetName === 'borrowing') {
    return [
      { รหัส: 'BR-20260812-001', ชื่ออุปกรณ์: 'Notebook Dell Latitude', จำนวน: 1, ผู้ขอยืม: 'นายทดสอบ ระบบ', หน่วยงาน: 'งานสารสนเทศ', เบอร์ติดต่อ: '0812345678', วันที่ขอยืม: '12/08/2026', วันที่ครบกำหนด: '15/08/2026', วัตถุประสงค์: 'ออกซ่อมบำรุงนอกสถานที่', สถานะ: 'รอรับเรื่อง' },
      { รหัส: 'BR-20260812-002', ชื่ออุปกรณ์: 'Projector Epson', จำนวน: 1, ผู้ขอยืม: 'นางสาวสมศรี ใจดี', หน่วยงาน: 'งานประชาสัมพันธ์', เบอร์ติดต่อ: '0898765432', วันที่ขอยืม: '10/08/2026', วันที่ครบกำหนด: '12/08/2026', วัตถุประสงค์: 'ประชุมวิชาการ', สถานะ: 'อยู่ในระหว่างการยืม' },
    ];
  }
  return [];
};
firestore.setDoc = async () => true;
firestore.getDoc = async (sheetName, docId) => {
  if (sheetName === 'borrowing' && docId === 'BR-20260812-001') {
    return {
      รหัส: 'BR-20260812-001',
      ชื่ออุปกรณ์: 'Notebook Dell Latitude',
      รหัสอุปกรณ์: 'EQ-001',
      จำนวน: 1,
      ผู้ขอยืม: 'นายทดสอบ ระบบ',
      หน่วยงาน: 'งานสารสนเทศ',
      วันที่ครบกำหนด: '15/08/2026',
      สถานะ: 'อยู่ในระหว่างการยืม',
    };
  }
  return null;
};

// Intercept fetch calls to capture LINE Reply & Push Flex payloads
let capturedReplies = [];
let capturedPushes = [];

global.fetch = async (url, options) => {
  const body = JSON.parse(options.body || '{}');
  if (url.includes('/message/reply')) {
    capturedReplies.push({ url, options, body });
  } else if (url.includes('/message/push')) {
    capturedPushes.push({ url, options, body });
  }
  return {
    status: 200,
    text: async () => '{"message":"ok"}',
    json: async () => ({ ok: true }),
  };
};

const webhookHandler = require('../backend-node/api/line-webhook');
const {
  sendBorrowingFlex,
  sendVehicleUsageFlex,
  sendBookingFlex,
  sendSmartSystemAlertFlex,
} = require('../backend-node/lib/line');

async function runTests() {
  console.log('🚀 Starting LINE Flex Reply & Push payload validation tests...');

  // Signature gate: ไม่มี/ผิด signature ต้องโดน 401 และไม่มีการตอบกลับ LINE
  {
    let code = 0;
    const res = { status(c) { code = c; return this; }, send() { return this; } };
    await webhookHandler({ body: '{"events":[]}', headers: {} }, res);
    assert.equal(code, 401, 'missing signature must be rejected');
    code = 0;
    await webhookHandler({ body: '{"events":[]}', headers: { 'x-line-signature': 'AAAA' } }, res);
    assert.equal(code, 401, 'bad signature must be rejected');
  }

  // ความทนทานของการตรวจลายเซ็น (เคสจริงบน Vercel)
  {
    const crypto = require('crypto');
    const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64');
    let code = 0;
    const res = { status(c) { code = c; return this; }, send() { return this; } };
    const raw = '{"events":[],"destination":"Uทดสอบ"}';

    // ค่า env ติดขึ้นบรรทัดใหม่/ช่องว่างตอนวาง -> ต้องยังผ่านถ้า secret จริงตรงกัน
    const saved = process.env.LINE_CHANNEL_SECRET;
    process.env.LINE_CHANNEL_SECRET = '  test-channel-secret\n';
    code = 0; await webhookHandler({ body: raw, headers: { 'x-line-signature': sign('test-channel-secret', raw) } }, res);
    assert.equal(code, 200, 'trimmed secret accepted');

    // Vercel แปลง body เป็น object ไปแล้ว: ไม่มี byte เดิม -> ตรวจจากการ serialize ซ้ำ (ผ่านเมื่อรู้ secret จริงเท่านั้น)
    process.env.LINE_CHANNEL_SECRET = 'test-channel-secret';
    const obj = { events: [], destination: 'Uทดสอบ' };
    code = 0; await webhookHandler({ body: obj, headers: { 'x-line-signature': sign('test-channel-secret', JSON.stringify(obj)) } }, res);
    assert.equal(code, 200, 'parsed body verified via re-serialisation');
    code = 0; await webhookHandler({ body: obj, headers: { 'x-line-signature': sign('wrong-secret', JSON.stringify(obj)) } }, res);
    assert.equal(code, 401, 'wrong secret still rejected');
    code = 0; await webhookHandler({ body: raw, headers: { 'x-line-signature': sign('test-channel-secret', raw + ' ') } }, res);
    assert.equal(code, 401, 'tampered body rejected');
    process.env.LINE_CHANNEL_SECRET = saved;
  }


  const createReq = (text, userId = 'U1234567890abcdef') => {
    const raw = JSON.stringify({
      events: [
        {
          replyToken: 'dummy-reply-token-999',
          source: { userId },
          message: { type: 'text', text },
        },
      ],
    });
    const sig = require('crypto').createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(raw).digest('base64');
    return { body: raw, headers: { 'x-line-signature': sig } };
  };

  const createRes = () => {
    let statusCode = 0;
    let sentBody = '';
    return {
      status(code) {
        statusCode = code;
        return this;
      },
      send(body) {
        sentBody = body;
        return this;
      },
      get statusCode() {
        return statusCode;
      },
      get sentBody() {
        return sentBody;
      },
    };
  };

  // Test 1: Ask ID Command
  capturedReplies = [];
  let res = createRes();
  await webhookHandler(createReq('ขอไอดี'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(capturedReplies.length, 1);
  assert.equal(capturedReplies[0].body.messages[0].type, 'flex');
  assert.match(capturedReplies[0].body.messages[0].altText, /ผูกบัญชี LINE/);
  assert.equal(capturedReplies[0].body.messages[0].contents.type, 'bubble');
  console.log('  ✅ Test 1: Command "ขอไอดี" -> Valid Flex Reply');

  // Test 2: Vehicle Status Command
  capturedReplies = [];
  res = createRes();
  await webhookHandler(createReq('เช็ครถ'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(capturedReplies.length, 1);
  assert.match(capturedReplies[0].body.messages[0].altText, /สถานะรถยนต์/);
  assert.equal(capturedReplies[0].body.messages[0].contents.type, 'bubble');
  console.log('  ✅ Test 2: Command "เช็ครถ" -> Valid Flex Reply');

  // Test 3: Equipment Stock Command
  capturedReplies = [];
  res = createRes();
  await webhookHandler(createReq('เช็คอุปกรณ์'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(capturedReplies.length, 1);
  assert.match(capturedReplies[0].body.messages[0].altText, /คลังอุปกรณ์คงเหลือ/);
  assert.equal(capturedReplies[0].body.messages[0].contents.type, 'bubble');
  console.log('  ✅ Test 3: Command "เช็คอุปกรณ์" -> Valid Flex Reply');

  // Test 4: Borrowing List Command
  capturedReplies = [];
  res = createRes();
  await webhookHandler(createReq('เช็คคำขอ'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(capturedReplies.length, 1);
  assert.match(capturedReplies[0].body.messages[0].altText, /คำขอยืมล่าสุด/);
  assert.equal(capturedReplies[0].body.messages[0].contents.type, 'bubble');
  console.log('  ✅ Test 4: Command "เช็คคำขอ" -> Valid Flex Reply');

  // Test 5a: Code Lookup BR-xxx
  capturedReplies = [];
  res = createRes();
  await webhookHandler(createReq('BR-20260812-001'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(capturedReplies.length, 1);
  assert.match(capturedReplies[0].body.messages[0].altText, /รายละเอียดคำขอยืม BR-20260812-001/);
  assert.equal(capturedReplies[0].body.messages[0].contents.type, 'bubble');
  console.log('  ✅ Test 5a: Code Lookup "BR-20260812-001" -> Valid Flex Reply');

  // Test 5b: Code Lookup EQ-xxx
  capturedReplies = [];
  res = createRes();
  await webhookHandler(createReq('EQ-001'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(capturedReplies.length, 1);
  assert.match(capturedReplies[0].body.messages[0].altText, /รายละเอียดอุปกรณ์ EQ-001/);
  assert.equal(capturedReplies[0].body.messages[0].contents.type, 'bubble');
  console.log('  ✅ Test 5b: Code Lookup "EQ-001" -> Valid Flex Reply');

  // Test 6: Unknown Command -> Help Menu
  capturedReplies = [];
  res = createRes();
  await webhookHandler(createReq('สวัสดีครับ'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(capturedReplies.length, 1);
  assert.match(capturedReplies[0].body.messages[0].altText, /เมนูช่วยเหลือ/);
  assert.equal(capturedReplies[0].body.messages[0].contents.type, 'bubble');
  console.log('  ✅ Test 6: Unknown command -> Fallback to Help Menu Flex Reply');

  // Test 7: Push Notifications (Borrowing Flex, Vehicle Usage Flex, Booking Flex, Smart Alert Flex)
  capturedPushes = [];
  await sendBorrowingFlex(
    { รหัส: 'BR-001', ชื่ออุปกรณ์: 'Notebook', จำนวน: 1, ผู้ขอยืม: 'ทดสอบ', หน่วยงาน: 'IT', เบอร์ติดต่อ: '08123', วัตถุประสงค์: 'งานด่วน', วันที่ครบกำหนด: '15/08/2026' },
    'รอรับเรื่อง'
  );
  assert.equal(capturedPushes.length, 1);
  assert.equal(capturedPushes[0].body.messages[0].type, 'flex');

  await sendVehicleUsageFlex(
    { ทะเบียน: 'กข 1234', สถานที่ไป: 'โรงพยาบาล', วัตถุประสงค์: 'ส่งเอกสาร', พนักงานขับรถ: 'นายก', ผู้ขอใช้: 'นายข', วันที่ออก: '12/08/2026', เวลาออก: '09:00' }
  );
  assert.equal(capturedPushes.length, 2);

  await sendBookingFlex(
    { ทะเบียน: 'กข 1234', ผู้ขอจอง: 'นายก', สถานที่ไป: 'เชียงใหม่', วัตถุประสงค์: 'อบรม', วันที่ใช้: '15/08/2026', เวลาเริ่ม: '08:00', เวลาสิ้นสุด: '17:00', พนักงานขับรถ: 'นายข' },
    'อนุมัติแล้ว'
  );
  assert.equal(capturedPushes.length, 3);

  await sendSmartSystemAlertFlex(['รถ กข 1234 ครบกำหนดถ่ายน้ำมันเครื่อง'], ['ใบขับขี่ นายก ใกล้หมดอายุ']);
  assert.equal(capturedPushes.length, 4);

  console.log('  ✅ Test 7: Event Push Notifications -> All Push Flex Messages Valid');

  // Test 8: Return Equipment Command
  capturedReplies = [];
  res = createRes();
  await webhookHandler(createReq('คืน BR-20260812-001'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(capturedReplies.length, 1);
  assert.match(capturedReplies[0].body.messages[0].altText, /แจ้งคืนอุปกรณ์ BR-20260812-001 เรียบร้อย/);
  assert.equal(capturedReplies[0].body.messages[0].contents.type, 'bubble');
  console.log('  ✅ Test 8: Return Command "คืน BR-20260812-001" -> Valid Return Flex Reply');

  // Test 9: Field survey menu -> Flex with LIFF survey link
  for (const cmd of ['สำรวจ', 'สำรวจภาคสนาม', 'สำรวจครุภัณฑ์']) {
    capturedReplies = [];
    res = createRes();
    await webhookHandler(createReq(cmd), res);
    assert.equal(res.statusCode, 200);
    assert.equal(capturedReplies.length, 1, cmd);
    assert.match(capturedReplies[0].body.messages[0].altText, /สำรวจภาคสนาม/);
    const uri = JSON.stringify(capturedReplies[0].body.messages[0].contents);
    assert.ok(uri.includes('https://liff.line.me/2011083425-G0pup6PQ?tab=survey'), 'survey LIFF link present');
  }
  console.log('  ✅ Test 9: Survey command -> Flex with LIFF survey link');

  // Test 10: การ์ดการยืมแยกตามบทบาท — กลุ่มแอดมิน/เจ้าหน้าที่ (ผู้ส่งมอบ) กับ ผู้ยืม (ผู้รับ) ต้องไม่ใช่การ์ดใบเดียวกัน
  {
    const { buildBorrowingBubble } = require('../backend-node/lib/line');
    const STAFF_ONLY = ['รับเรื่องคำขอนี้', 'ส่งมอบอุปกรณ์แล้ว', 'ยืนยันรับคืน', 'รับคืน (ชำรุด)', 'เปิดดูในระบบ'];
    const REQUESTER_ONLY = ['แจ้งคืนอุปกรณ์', 'ขอขยายเวลาคืน', 'ประเมินความพึงพอใจ', 'ยืมอุปกรณ์อีกครั้ง', 'รายการยืมของฉัน'];
    const sample = { 'รหัส': 'BR-20261125-001', 'ชื่ออุปกรณ์': 'Notebook', 'จำนวน': 1, 'ผู้ขอยืม': 'สมชาย ใจดี', 'หน่วยงาน': 'OPD', 'เบอร์ติดต่อ': '0812345678', 'วัตถุประสงค์': 'ประชุม', 'วันที่ครบกำหนด': '28/11/2026', 'ผู้รับเรื่อง': 'สมหญิง เจ้าหน้าที่' };
    const walk = (n, f) => { if (Array.isArray(n)) n.forEach((x) => walk(x, f)); else if (n && typeof n === 'object') { f(n); Object.values(n).forEach((x) => walk(x, f)); } };
    const textsOf = (bubble) => { const out = []; walk(bubble, (n) => { if (n.type === 'text') out.push(n.text); if (n.action && n.action.label) out.push(n.action.label); }); return out.join('\n'); };
    // เฉพาะป้ายปุ่ม (ข้อความบรรยายสถานะอาจมีคำว่า "ส่งมอบอุปกรณ์แล้ว" ได้ ไม่ใช่ปุ่ม)
    const labelsOf = (bubble) => { const out = []; walk(bubble, (n) => { if (n.action && n.action.label) out.push(n.action.label); }); return out.join('\n'); };

    for (const st of ['รอรับเรื่อง', 'รับเรื่องแล้ว', 'อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน', 'ขอขยายเวลา', 'อนุมัติขยายเวลา', 'อยู่ในระหว่างการคืน', 'คืนเสร็จสิ้น', 'ยกเลิก']) {
      const staff = buildBorrowingBubble(sample, st, 'staff'), req = buildBorrowingBubble(sample, st, 'requester'), view = buildBorrowingBubble(sample, st, 'viewer');
      for (const b of [staff, req, view]) {
        assert.equal(b.type, 'bubble');
        walk(b, (n) => { if (n.type === 'text') assert.ok(String(n.text).length > 0, 'empty text node in ' + st); });
        assert.ok(JSON.stringify(b).length < 9000, 'bubble too large');
      }
      const st_ = textsOf(staff), rq = textsOf(req), vw = textsOf(view);
      REQUESTER_ONLY.forEach((t) => assert.ok(!labelsOf(staff).includes(t), `staff card (${st}) must not have requester button "${t}"`));
      STAFF_ONLY.forEach((t) => assert.ok(!labelsOf(req).includes(t), `requester card (${st}) must not have staff button "${t}"`));
      assert.equal(labelsOf(view), '', `viewer card (${st}) has no buttons at all`);
      assert.ok(st_.includes('สำหรับ: เจ้าหน้าที่ (ผู้ส่งมอบ)') && st_.includes('ผู้รับ (ผู้ยืม)'), 'staff card names both roles');
      assert.ok(rq.includes('สำหรับ: ผู้ยืม (ผู้รับ)') && rq.includes('ผู้ส่งมอบ'), 'requester card names both roles');
      assert.ok(st_.includes('0812345678') && !rq.includes('0812345678') && !vw.includes('0812345678'), 'phone only on the staff card');
      assert.ok(vw.includes(st) && !vw.includes('QR Code'), 'viewer: status only, no QR');
    }
    // ปุ่มตามสถานะ
    assert.ok(textsOf(buildBorrowingBubble(sample, 'รอรับเรื่อง', 'staff')).includes('รับเรื่องคำขอนี้'));
    assert.ok(textsOf(buildBorrowingBubble(sample, 'รับเรื่องแล้ว', 'staff')).includes('ส่งมอบอุปกรณ์แล้ว'));
    const ret = textsOf(buildBorrowingBubble(sample, 'อยู่ในระหว่างการคืน', 'staff'));
    assert.ok(ret.includes('ยืนยันรับคืนอุปกรณ์') && ret.includes('รับคืน (ชำรุด)'));
    assert.ok(textsOf(buildBorrowingBubble(sample, 'อยู่ในระหว่างการยืม', 'requester')).includes('แจ้งคืนอุปกรณ์'));
    assert.ok(!textsOf(buildBorrowingBubble(sample, 'ขอขยายเวลา', 'requester')).includes('ขอขยายเวลาคืน'), 'no second extension request while one is pending');
    assert.ok(textsOf(buildBorrowingBubble(sample, 'คืนเสร็จสิ้น', 'requester')).includes('ประเมินความพึงพอใจ'));
    assert.ok(textsOf(buildBorrowingBubble({ ...sample, 'ผู้รับเรื่อง': '' }, 'รอรับเรื่อง', 'requester')).includes('รอเจ้าหน้าที่รับเรื่อง'), 'no deliverer yet');
    // หลายรายการ
    const multi = { ...sample, 'รายการอุปกรณ์': [{ 'ชื่ออุปกรณ์': 'A', 'จำนวน': 1 }, { 'ชื่ออุปกรณ์': 'B', 'จำนวน': 2 }] };
    assert.ok(textsOf(buildBorrowingBubble(multi, 'รอรับเรื่อง', 'requester')).includes('• B (x2)'));

    // ส่งจริง: กลุ่ม (ไม่ระบุ targetId) = การ์ดเจ้าหน้าที่, ส่วนตัว (ระบุ targetId) = การ์ดผู้ยืม — แยกเป็น 2 ข้อความ
    capturedPushes = [];
    await sendBorrowingFlex(sample, 'รอรับเรื่อง');
    await sendBorrowingFlex(sample, 'รอรับเรื่อง', 'U-borrower-1');
    assert.equal(capturedPushes.length, 2);
    const [toGroup, toUser] = capturedPushes;
    assert.equal(toGroup.body.to, 'test-group-67890'); assert.equal(toUser.body.to, 'U-borrower-1');
    const gTxt = textsOf(toGroup.body.messages[0].contents), uTxt = textsOf(toUser.body.messages[0].contents);
    assert.ok(gTxt.includes('รับเรื่องคำขอนี้') && !uTxt.includes('รับเรื่องคำขอนี้'));
    assert.ok(uTxt.includes('รายการยืมของฉัน') && !gTxt.includes('รายการยืมของฉัน'));
    assert.notEqual(toGroup.body.messages[0].altText, toUser.body.messages[0].altText, 'different alt text per role');
    assert.match(toUser.body.messages[0].altText, /คำขอยืมของคุณ/);
    console.log('  ✅ Test 10: Borrow cards split by role (staff/deliverer vs borrower/receiver) for all statuses');
  }

  console.log('\n🎉 ALL LINE FLEX TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
