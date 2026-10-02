// ============== MOPH ID: CALLBACK ==============
// URL นี้ต้องตรงกับ callback ที่ลงทะเบียนไว้กับ MOPH ทุกตัวอักษร:
//   https://vmes-backend.vercel.app/api/auth/healthid/callback
// สำเร็จ -> redirect กลับ frontend พร้อม session token ใน hash (#moph=...) ซึ่งไม่ถูกส่งไป server/log
// ไม่สำเร็จ -> redirect กลับ frontend พร้อม ?error=pending|suspended|not_allowed|login_failed

const { fetchProviderProfile, isHospitalAllowed, upsertUser, userStatus } = require('../../../lib/mophLogin');
const { createSessionToken } = require('../../../lib/session');
const { logAudit } = require('../../../lib/util');

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'https://vmes.web.app').replace(/\/+$/, '');
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end();
}

module.exports = async function handler(req, res) {
  const base = frontendUrl();
  const { code, error } = req.query || {};
  if (error || !code) {
    console.error('HealthID authorization error:', error || 'missing code');
    return redirect(res, `${base}/?error=login_failed`);
  }

  try {
    const profile = await fetchProviderProfile(String(code));
    if (!isHospitalAllowed(profile)) {
      console.warn(`HealthID login rejected: hcodes=${profile.hcodes.join(',')} not in MOPH_ALLOWED_HCODES`);
      return redirect(res, `${base}/?error=not_allowed`);
    }

    const { user, inserted, linked } = await upsertUser(profile);
    const status = userStatus(user);
    console.log(`HealthID login: user=${user['รหัส']} hcode=${profile.hcode} status=${status}${inserted ? ' (new)' : ''}${linked ? ' (linked)' : ''}`);

    if (status !== 'active') {
      if (inserted) await logAudit('ขอสิทธิ์เข้าใช้งาน (MOPH ID)', user['ชื่อ-นามสกุล'], `${profile.position || '-'} / ${profile.hospital || '-'} รออนุมัติ`);
      return redirect(res, `${base}/?error=${status}`);
    }

    await logAudit('Login (MOPH ID)', user['ชื่อ-นามสกุล'], linked ? 'ผูกบัญชีเดิมกับ MOPH ID' : '');
    redirect(res, `${base}/#moph=${encodeURIComponent(createSessionToken(user['รหัส']))}`);
  } catch (err) {
    console.error('HealthID/ProviderID login failed:', err.message);
    redirect(res, `${base}/?error=login_failed`);
  }
};
