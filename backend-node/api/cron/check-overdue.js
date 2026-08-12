// ============== DAILY CRON: CHECK OVERDUE ==============
// แทนที่ ScriptApp trigger เดิม (setupDailyTrigger, รันทุกวัน 08:00 เวลาไทย) — ตั้งเวลา
// ผ่าน vercel.json crons (0 1 * * * UTC = 08:00 Asia/Bangkok) เรียก endpoint นี้
// Vercel Cron จะแนบ header Authorization: Bearer ${CRON_SECRET} มาโดยอัตโนมัติ
// (ตั้งค่า CRON_SECRET เป็น env var เดียวกันใน Vercel project settings)

const { checkOverdue } = require('../../lib/handlers/dashboard');

module.exports = async function handler(req, res) {
  const expected = 'Bearer ' + (process.env.CRON_SECRET || '');
  if (!process.env.CRON_SECRET || req.headers.authorization !== expected) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  try {
    const result = await checkOverdue();
    res.status(200).json({ success: true, result });
  } catch (err) {
    res.status(200).json({ success: false, message: err.message });
  }
};
