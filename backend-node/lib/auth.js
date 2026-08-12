// ============== AUTH ==============
// พอร์ตจาก รหัส.js L1430-1486 (login, verifyAdmin) และ L58-60 (getAdminCode)
// หมายเหตุ: เรียก listDocs(SHEETS.USERS) ตรงๆ แทนที่จะ require handlers/users.js
// เพื่อเลี่ยง circular dependency (users.js ต้อง require verifyAdmin จากไฟล์นี้)

const { SHEETS, listDocs } = require('./firestore');
const { hashPassword, logAudit } = require('./util');

function getAdminCode() {
  return process.env.ADMIN_CODE || '11192';
}

function verifyAdmin(code) {
  return String(code || '').trim() === getAdminCode();
}

async function login(username, password) {
  try {
    const users = await listDocs(SHEETS.USERS);
    const credsList = await listDocs('userCredentials');
    const credMap = {};
    credsList.forEach((c) => {
      if (c['รหัส']) credMap[c['รหัส']] = c['รหัสผ่าน'];
    });

    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanPassword = String(password || '').trim();
    const hashedPass = hashPassword(cleanPassword);

    const user = users.find((u) => {
      const uCode = String(u['รหัส'] || u['User ID'] || u['รหัสพนักงาน'] || '').trim().toLowerCase();
      const uName = String(u['ชื่อ-นามสกุล'] || '').trim().toLowerCase();
      const uUsername = String(u['ชื่อผู้ใช้'] || '').trim().toLowerCase();
      const uEmail = String(u['อีเมล'] || '').trim().toLowerCase();
      const uPass = String((credMap[u['รหัส']] !== undefined ? credMap[u['รหัส']] : u['รหัสผ่าน']) || '').trim();
      const emailPrefix = uEmail.split('@')[0];

      const matchUser =
        uCode === cleanUsername ||
        uName === cleanUsername ||
        uUsername === cleanUsername ||
        uEmail === cleanUsername ||
        emailPrefix === cleanUsername;
      const matchPass = uPass === cleanPassword || uPass === hashedPass;

      return matchUser && matchPass;
    });

    if (!user) {
      if (verifyAdmin(cleanPassword)) {
        await logAudit('Login Admin', 'admin', 'เข้าระบบด้วยรหัส admin');
        return { success: true, user: { name: 'ผู้ดูแลระบบ', role: 'superadmin', dept: 'IT' } };
      }
      return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }

    const uStatus = String(user['สถานะ'] || '').trim();
    if (uStatus === 'ระงับ' || uStatus === 'ไม่ใช้งาน') {
      return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งานชั่วคราว' };
    }

    await logAudit('Login', user['ชื่อ-นามสกุล'], '');
    return {
      success: true,
      user: {
        name: user['ชื่อ-นามสกุล'],
        role: user['บทบาท'],
        dept: user['หน่วยงาน'],
        phone: user['เบอร์ติดต่อ'],
      },
    };
  } catch (err) {
    return { success: false, message: 'ข้อผิดพลาด: ' + err.message };
  }
}

module.exports = { login, verifyAdmin, getAdminCode };
