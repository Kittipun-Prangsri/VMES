// ============== ยืนยันตัวตน LINE จาก LIFF access token ==============
// หน้า LIFF ส่ง liff.getAccessToken() มา เราถามกลับ LINE โดยตรงว่าเป็นของใคร (ไม่เชื่อ userId ที่ client บอก)
//   1) /oauth2/v2.1/verify  -> ตรวจว่า token ออกให้ LINE Login channel ของเรา และยังไม่หมดอายุ
//   2) /v2/profile          -> ได้ userId/ชื่อจริงของเจ้าของ token
// ใช้กับฟังก์ชันที่ "เขียนข้อมูล" เช่น สำรวจภาคสนามผ่าน LIFF (ฟังก์ชันอ่านอย่างเดียวของ LIFF เดิมยังใช้ userId ตรงๆ)

const crypto = require('crypto');

const CHANNEL_ID = () => process.env.LINE_LOGIN_CHANNEL_ID || '2011083425'; // ส่วนหน้าของ LIFF ID
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

function clearCache() { cache.clear(); }

async function verifyLineAccessToken(token, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const t = String(token || '').trim();
  if (!doFetch || t.length < 20 || t.length > 2000) return null;

  const key = crypto.createHash('sha256').update(t).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.profile;

  try {
    const vr = await doFetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(t));
    if (!vr.ok) return null;
    const v = await vr.json();
    if (String(v.client_id) !== String(CHANNEL_ID()) || !(Number(v.expires_in) > 0)) return null;

    const pr = await doFetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + t } });
    if (!pr.ok) return null;
    const p = await pr.json();
    if (!p || !p.userId) return null;
    const profile = { userId: String(p.userId), displayName: String(p.displayName || '') };
    cache.set(key, { exp: Date.now() + Math.min(CACHE_MS, Number(v.expires_in) * 1000), profile });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return profile;
  } catch (e) {
    return null;
  }
}

module.exports = { verifyLineAccessToken, clearCache };
