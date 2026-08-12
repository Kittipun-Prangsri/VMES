// ============== HELPERS ==============
// พอร์ตจาก รหัส.js: newId_ (L1337), nowStr_ (L1341), todayStr_ (L1345),
// hashPassword_ (L70), safeTruncate_ (L2604), logAudit_ (L1349), safeGet_ (L1375)

const crypto = require('crypto');
const { SHEETS, setDoc } = require('./firestore');

const SYSTEM_NAME = 'ระบบยืม-คืน อุปกรณ์ งานสารสนเทศ';

function bangkokParts(fmt) {
  const parts = fmt.formatToParts(new Date());
  const map = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') map[p.type] = p.value;
  });
  return map;
}

const dtfDateTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function newId(prefix) {
  const m = bangkokParts(dtfDateTime);
  const digits = `${m.year}${m.month}${m.day}${m.hour}${m.minute}${m.second}`;
  return prefix + '-' + digits + '-' + Math.floor(Math.random() * 1000);
}

function nowStr() {
  const m = bangkokParts(dtfDateTime);
  return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second}`;
}

function todayStr() {
  const m = bangkokParts(dtfDateTime);
  return `${m.year}-${m.month}-${m.day}`;
}

// ต้องได้ hex เดียวกับ Utilities.computeDigest(SHA_256, pass, UTF_8) เดิมทุกตัวอักษร
// เพราะ hash รหัสผ่านเดิมใน userCredentials ต้องยัง validate ผ่านได้
function hashPassword(pass) {
  if (!pass) return '';
  return crypto.createHash('sha256').update(String(pass || ''), 'utf8').digest('hex');
}

function safeTruncate(str, maxLength) {
  if (!str) return '';
  str = String(str).replace(/[\r\n\t\s]+/g, ' ').trim();
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

async function logAudit(action, user, detail) {
  try {
    const logObj = {
      'รหัส': newId('LOG'),
      'วันเวลา': nowStr(),
      'ผู้ใช้': user || 'system',
      'การดำเนินการ': action,
      'รายละเอียด': detail || '',
    };
    await setDoc(SHEETS.AUDIT, logObj['รหัส'], logObj);
  } catch (err) {
    console.log('logAudit error: ' + err);
  }
}

// เทียบเท่า safeGet_ เดิม แต่รองรับ async fn (การเรียก Firestore ใน Node เป็น async เสมอ)
async function safeGet(fn) {
  try {
    const result = await fn();
    return result || [];
  } catch (e) {
    return [];
  }
}

module.exports = { SYSTEM_NAME, newId, nowStr, todayStr, hashPassword, safeTruncate, logAudit, safeGet };
