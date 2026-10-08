// ============== MOPH ID: เริ่มเข้าสู่ระบบ ==============
// ปุ่ม "เข้าสู่ระบบด้วย MOPH ID" ลิงก์มาที่นี่ แล้ว redirect ไปหน้า login ของ moph.id.th
// (เก็บ client_id / redirect_uri ไว้ใน env ของ backend ที่เดียว)

const { healthIdLoginUrl } = require('../../../lib/mophLogin');

module.exports = function handler(req, res) {
  res.writeHead(302, { Location: healthIdLoginUrl(), 'Cache-Control': 'no-store' });
  res.end();
};
