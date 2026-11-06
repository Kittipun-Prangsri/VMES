// ============== ยืนยันตัวตน LINE จาก LIFF access token ==============
// หน้า LIFF ส่ง liff.getAccessToken() มา เราถามกลับ LINE โดยตรงว่าเป็นของใคร (ไม่เชื่อ userId ที่ client บอก)
//   1) /oauth2/v2.1/verify  -> ตรวจว่า token ออกให้ LINE Login channel ของเรา และยังไม่หมดอายุ
//   2) /v2/profile          -> ได้ userId/ชื่อจริงของเจ้าของ token
// ใช้กับฟังก์ชันที่ "เขียนข้อมูล" เช่น สำรวจภาคสนามผ่าน LIFF (ฟังก์ชันอ่านอย่างเดียวของ LIFF เดิมยังใช้ userId ตรงๆ)

const crypto = require('crypto');

const CHANNEL_ID = () => String(process.env.LINE_LOGIN_CHANNEL_ID || '').trim() || '2011083425'; // ส่วนหน้าของ LIFF ID
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

function clearCache() { cache.clear(); }

// คืน { ok:true, profile } หรือ { ok:false, reason, ... } — reason ไว้ให้ผู้ดูแลไล่สาเหตุ (ไม่มีข้อมูลลับ: channel ID ไม่ใช่ความลับ
// และปรากฏใน LIFF URL อยู่แล้ว)
async function verifyLineAccessTokenDetailed(token, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const t = String(token || '').trim();
  if (!doFetch) return { ok: false, reason: 'no_fetch' };
  if (t.length < 20 || t.length > 2000) return { ok: false, reason: 'bad_token_format' };

  const key = crypto.createHash('sha256').update(t).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return { ok: true, profile: hit.profile };

  try {
    const vr = await doFetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(t));
    if (!vr.ok) return { ok: false, reason: 'line_verify_rejected', status: vr.status };
    const v = await vr.json();
    const want = String(CHANNEL_ID()).trim();
    const got = String(v.client_id);
    if (got !== want) return { ok: false, reason: 'client_id_mismatch', got, want };
    if (!(Number(v.expires_in) > 0)) return { ok: false, reason: 'token_expired' };

    const pr = await doFetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + t } });
    if (!pr.ok) return { ok: false, reason: 'line_profile_rejected', status: pr.status };
    const p = await pr.json();
    if (!p || !p.userId) return { ok: false, reason: 'no_user_id' };
    const profile = { userId: String(p.userId), displayName: String(p.displayName || '') };
    cache.set(key, { exp: Date.now() + Math.min(CACHE_MS, Number(v.expires_in) * 1000), profile });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return { ok: true, profile };
  } catch (e) {
    return { ok: false, reason: 'network_error' };
  }
}

async function verifyLineAccessToken(token, fetchImpl) {
  const r = await verifyLineAccessTokenDetailed(token, fetchImpl);
  return r.ok ? r.profile : null;
}

module.exports = { verifyLineAccessToken, verifyLineAccessTokenDetailed, clearCache };
