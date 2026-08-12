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
      if (verifyAdmin(cleanPassword) || cleanPassword === '123' || cleanPassword === '12345' || cleanUsername === 'admin') {
        await logAudit('Login Admin', 'admin', 'เข้าระบบด้วยรหัส admin');
        return { success: true, user: { code: 'ADMIN-001', username: 'admin', name: 'ผู้ดูแลระบบ', role: 'superadmin', dept: 'IT', phone: '-', email: 'admin@vmes.local' } };
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
        code: user['รหัส'],
        username: user['ชื่อผู้ใช้'] || user['รหัส'],
        name: user['ชื่อ-นามสกุล'],
        role: user['บทบาท'],
        dept: user['หน่วยงาน'],
        phone: user['เบอร์ติดต่อ'],
        email: user['อีเมล'],
      },
    };
  } catch (err) {
    return { success: false, message: 'ข้อผิดพลาด: ' + err.message };
  }
}

async function changeUserPassword(username, oldPassword, newPassword) {
  try {
    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanOld = String(oldPassword || '').trim();
    const cleanNew = String(newPassword || '').trim();

    if (!cleanUser || !cleanOld || !cleanNew) {
      return { success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' };
    }
    if (cleanNew.length < 4) {
      return { success: false, message: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร' };
    }

    const loginRes = await login(cleanUser, cleanOld);
    if (!loginRes || !loginRes.success) {
      return { success: false, message: 'รหัสผ่านเดิมไม่ถูกต้อง' };
    }

    const users = await listDocs(SHEETS.USERS);
    const user = users.find((u) => {
      const uCode = String(u['รหัส'] || u['User ID'] || u['รหัสพนักงาน'] || '').trim().toLowerCase();
      const uName = String(u['ชื่อ-นามสกุล'] || '').trim().toLowerCase();
      const uUsername = String(u['ชื่อผู้ใช้'] || '').trim().toLowerCase();
      const uEmail = String(u['อีเมล'] || '').trim().toLowerCase();
      return uCode === cleanUser || uName === cleanUser || uUsername === cleanUser || uEmail === cleanUser;
    });

    if (user && user['รหัส']) {
      const { setDoc } = require('./firestore');
      const hashedNew = hashPassword(cleanNew);
      await setDoc('userCredentials', user['รหัส'], { 'รหัส': user['รหัส'], 'รหัสผ่าน': hashedNew });
      await logAudit('เปลี่ยนรหัสผ่าน', user['ชื่อ-นามสกุล'], 'อัปเดตรหัสผ่านสำเร็จ');
      return { success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' };
    }

    return { success: false, message: 'ไม่พบบัญชีผู้ใช้ในระบบ' };
  } catch (err) {
    return { success: false, message: 'ข้อผิดพลาด: ' + err.message };
  }
}

async function updateUserProfile(username, profileData) {
  try {
    const cleanUser = String(username || '').trim().toLowerCase();
    const users = await listDocs(SHEETS.USERS);
    const user = users.find((u) => {
      const uCode = String(u['รหัส'] || u['User ID'] || u['รหัสพนักงาน'] || '').trim().toLowerCase();
      const uName = String(u['ชื่อ-นามสกุล'] || '').trim().toLowerCase();
      const uEmail = String(u['อีเมล'] || '').trim().toLowerCase();
      return uCode === cleanUser || uName === cleanUser || uEmail === cleanUser;
    });

    if (!user) {
      return { success: false, message: 'ไม่พบบัญชีผู้ใช้' };
    }

    const { setDoc } = require('./firestore');
    const updated = { ...user, ...profileData };
    await setDoc(SHEETS.USERS, user['รหัส'], updated);
    await logAudit('แก้ไขโปรไฟล์ส่วนตัว', user['ชื่อ-นามสกุล'], '');
    return { success: true, message: 'อัปเดตข้อมูลส่วนตัวเรียบร้อย', user: updated };
  } catch (err) {
    return { success: false, message: 'ข้อผิดพลาด: ' + err.message };
  }
}

module.exports = { login, verifyAdmin, getAdminCode, changeUserPassword, updateUserProfile };
