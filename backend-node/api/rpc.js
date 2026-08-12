// ============== JSON RPC ENDPOINT ==============
// เทียบเท่า doPost's JSON API branch เดิม ({fn, args}) — frontend เรียกผ่าน
// callApi() ที่ตั้งใจส่ง Content-Type: text/plain (trick เดิมสำหรับเลี่ยง CORS
// preflight ของ Apps Script) จึงต้อง parse body เป็น JSON เองเสมอ ไม่พึ่ง req.body
// อัตโนมัติของ Vercel ที่อ้างอิงจาก Content-Type

const { API_WHITELIST } = require('../lib/whitelist');

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
  // req.body ถูก parse เป็น object แล้ว (Vercel ทำให้เมื่อ Content-Type เป็น
  // application/json) ใช้ตรงๆ ได้เลย
  return req.body;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const body = await parseBody(req);

    if (!body || !body.fn) {
      res.status(200).json({ success: false, message: 'Unknown function' });
      return;
    }

    const fn = API_WHITELIST[body.fn];
    if (!fn) {
      res.status(200).json({ success: false, message: 'Unknown function' });
      return;
    }

    try {
      const result = await fn.apply(null, body.args || []);
      res.status(200).json(result);
    } catch (err) {
      res.status(200).json({ success: false, message: err.message });
    }
  } catch (err) {
    res.status(200).json({ success: false, message: err.message });
  }
};
