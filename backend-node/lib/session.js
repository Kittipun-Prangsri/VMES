// ============== SESSION TOKEN (MOPH ID) ==============
// Token แบบ stateless: "<base64url payload>.<HMAC-SHA256>" — payload มีแค่รหัสผู้ใช้ + เวลาหมดอายุ
// ไม่มี token ของ MOPH / เลขบัตร / โปรไฟล์อยู่ในนี้ ข้อมูลผู้ใช้อ่านใหม่จาก Firestore ทุกครั้ง
// (getMophSession) การระงับบัญชีหรือเปลี่ยนบทบาทจึงมีผลทันทีที่โหลดหน้าใหม่
//
// ใช้ token แทน cookie เพราะ frontend (vmes.web.app) กับ backend (vmes-backend.vercel.app)
// อยู่คนละ origin — cookie ของ backend จะเป็น third-party cookie ที่เบราว์เซอร์บล็อก

const crypto = require('crypto');

const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (at least 32 characters)');
  return s;
}

function sign(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

function createSessionToken(userCode) {
  const payload = Buffer.from(JSON.stringify({
    uid: userCode,
    exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch (e) {
    return null;
  }
}

module.exports = { createSessionToken, verifySessionToken };
