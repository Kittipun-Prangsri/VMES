// ============== JSON RPC ENDPOINT ==============
// เทียบเท่า doPost's JSON API branch เดิม ({fn, args}) — frontend เรียกผ่าน
// callApi() ที่ตั้งใจส่ง Content-Type: text/plain (trick เดิมสำหรับเลี่ยง CORS
// preflight ของ Apps Script) จึงต้อง parse body เป็น JSON เองเสมอ ไม่พึ่ง req.body
// อัตโนมัติของ Vercel ที่อ้างอิงจาก Content-Type

const { API_WHITELIST } = require('../lib/whitelist');
const { verifySessionToken } = require('../lib/session');

const PUBLIC_FUNCTIONS = new Set([
  'login',
  'getMophSession',
  'getBootstrapInfo',
  'requestPasswordResetNotification',
  'createServiceRequest',
  'trackServiceRequest',
  'saveSatisfactionRating',
  'createWifiQrLog',
  'testMikrotikConnection',
  'setupSystem',
]);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  if (req.body === undefined || req.body === null || req.body === '') {
    const raw = await readRawBody(req);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return {};
    }
  }
  return req.body;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const body = await parseBody(req);

    if (!body || !body.fn) {
      res.status(400).json({ success: false, message: 'Unknown function' });
      return;
    }

    const fnName = String(body.fn).trim();
    const fn = API_WHITELIST[fnName];
    if (!fn) {
      res.status(400).json({ success: false, message: 'Unknown function' });
      return;
    }

    // Checking authentication for protected API functions
    if (!PUBLIC_FUNCTIONS.has(fnName)) {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
      const tokenHeader = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
      const token = body.token || tokenHeader;

      const session = verifySessionToken(token);
      if (!session) {
        res.status(401).json({ success: false, error: 'unauthorized', message: 'กรุณาเข้าสู่ระบบก่อนทำรายการ (Session expired or invalid)' });
        return;
      }
    }

    try {
      const result = await fn.apply(null, body.args || []);
      res.status(200).json(result);
    } catch (err) {
      console.error(`Error executing RPC function ${fnName}:`, err);
      res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ: ' + (err.message || 'Server error') });
    }
  } catch (err) {
    console.error('Error parsing RPC request:', err);
    res.status(400).json({ success: false, message: 'คำขอไม่ถูกต้อง: ' + err.message });
  }
};
