const assert = require('node:assert/strict');

// Mock environmental variables
process.env.LINE_TOKEN = 'test-token-12345';
process.env.LINE_GROUP_ID = 'test-group-67890';
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
      { รหัส: 'EQ-001', ชื่ออุปกรณ์: 'Notebook Dell Latitude', หมวดหมู่: 'คอมพิวเตอร์', จำนวน: 5, หน่วยนับ: 'เครื่อง', สถานะ: 'พร้อมใช้งาน', ยี่ห้อ: 'Dell', รุ่น: 'Latitude 5420', ที่เก็บ: 'ตู้ A1' },
      { รหัส: 'EQ-002', ชื่ออุปกรณ์: 'Projector Epson', หมวดหมู่: 'โสตทัศนูปกรณ์', จำนวน: 2, หน่วยนับ: 'เครื่อง', สถานะ: 'พร้อมใช้งาน', ยี่ห้อ: 'Epson', รุ่น: 'EB-X06', ที่เก็บ: 'ตู้ B2' },
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

  const createReq = (text, userId = 'U1234567890abcdef') => ({
    body: {
      events: [
        {
          replyToken: 'dummy-reply-token-999',
          source: { userId },
          message: { type: 'text', text },
        },
      ],
    },
  });

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
  assert.match(capturedReplies[0].body.messages[0].altText, /LINE User ID/);
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

  console.log('\n🎉 ALL LINE FLEX TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
