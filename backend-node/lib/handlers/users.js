// ============== USERS ==============
// พอร์ตจาก รหัส.js L1903-1968 (saveUser/deleteUser), L1497-1511 (getUsers),
// L1364-1373 (getUserLineId_), L3029-3059 (requestPasswordResetNotification)

const { SHEETS, setDoc, deleteDoc, getDoc, listDocs } = require('../firestore');
const { newId, todayStr, nowStr, logAudit, SYSTEM_NAME } = require('../util');
const { verifyAdmin } = require('../auth');
const { sendLineFlex } = require('../line');

async function getUsers() {
  return listDocs(SHEETS.USERS);
}

// ฟังก์ชันสำหรับค้นหา LINE User ID ของผู้ใช้งาน
async function getUserLineId(userName) {
  try {
    const users = await getUsers();
    const user = users.find((u) => u['ชื่อ-นามสกุล'] === userName);
    return user && user['LINE ID'] ? user['LINE ID'] : null;
  } catch (e) {
    return null;
  }
}

// หมายเหตุความปลอดภัย: รหัสผ่านผู้ใช้จะไม่ถูกเขียนลง collection "users" ที่ frontend
// ฟัง real-time อีกต่อไป — แยกเก็บใน collection "userCredentials"
async function saveUser(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId('UR');

    if (data['ชื่อ-นามสกุล']) data['ชื่อ-นามสกุล'] = String(data['ชื่อ-นามสกุล']).trim();
    if (data['อีเมล']) data['อีเมล'] = String(data['อีเมล']).trim();
    if (data['รหัสผ่าน']) data['รหัสผ่าน'] = String(data['รหัสผ่าน']).trim();
    if (data['LINE ID']) data['LINE ID'] = String(data['LINE ID']).trim();
    if (data['LINE Token']) data['LINE Token'] = String(data['LINE Token']).trim();
    if (data['Telegram ID']) data['Telegram ID'] = String(data['Telegram ID']).trim();
    if (data['Telegram Token']) data['Telegram Token'] = String(data['Telegram Token']).trim();
    delete data._row;

    const existingCred = isNew ? null : await getDoc('userCredentials', data['รหัส']);
    const existingUser = isNew ? null : await getDoc(SHEETS.USERS, data['รหัส']);

    // คงวันที่บันทึกเดิมไว้เมื่อแก้ไข
    data['วันที่บันทึก'] = isNew ? todayStr() : (existingUser && existingUser['วันที่บันทึก']) || todayStr();

    // ถ้าไม่ได้กรอกรหัสผ่านใหม่ตอนแก้ไข ให้คงรหัสผ่านเดิมไว้
    const newPassword = data['รหัสผ่าน'];
    const passwordToStore = newPassword ? newPassword : (existingCred && existingCred['รหัสผ่าน']) || '';

    const publicData = Object.assign({}, data);
    delete publicData['รหัสผ่าน'];

    await setDoc(SHEETS.USERS, data['รหัส'], publicData);
    await setDoc('userCredentials', data['รหัส'], { 'รหัส': data['รหัส'], 'รหัสผ่าน': passwordToStore });

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteUser(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  const docId = String(code);
  await deleteDoc(SHEETS.USERS, docId);
  await deleteDoc('userCredentials', docId);
  return { success: true };
}

async function requestPasswordResetNotification(contactInfo) {
  try {
    await logAudit('ลืมรหัสผ่าน', 'system', 'แจ้งติดต่อกลับ: ' + contactInfo);

    const altText = '🔑 แจ้งลืมรหัสผ่าน: ' + contactInfo;
    const flex = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '🔑 แจ้งเตือนลืมรหัสผ่าน', size: 'lg', weight: 'bold', color: '#ef4444' },
          { type: 'text', text: SYSTEM_NAME, size: 'xs', color: '#64748b', margin: 'sm' },
          { type: 'separator', margin: 'md', color: '#e2e8f0' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'sm',
            contents: [
              { type: 'text', text: 'ข้อมูลติดต่อกลับ/ผู้ใช้งาน:', size: 'sm', color: '#64748b' },
              { type: 'text', text: contactInfo, size: 'md', weight: 'bold', color: '#0f172a', wrap: true },
            ],
          },
          { type: 'text', text: 'วันที่แจ้ง: ' + nowStr(), size: 'xs', color: '#94a3b8', margin: 'lg' },
        ],
      },
    };

    await sendLineFlex(altText, flex);

    return { success: true, message: 'ส่งข้อมูลแจ้งลืมรหัสผ่านเรียบร้อยแล้ว ทีมผู้ดูแลระบบได้รับข้อความแล้ว' };
  } catch (err) {
    return { success: false, message: 'ผิดพลาด: ' + err.message };
  }
}

async function autoLinkLineUser(lineUserId, displayName, userCodeOrName) {
  try {
    const cleanLineId = String(lineUserId || '').trim();
    if (!cleanLineId) return { success: false, message: 'ไม่มี LINE User ID' };

    const users = await getUsers();
    const cleanKey = String(userCodeOrName || '').trim().toLowerCase();

    const user = users.find((u) => {
      const uCode = String(u['รหัส'] || '').trim().toLowerCase();
      const uName = String(u['ชื่อ-นามสกุล'] || '').trim().toLowerCase();
      const uUsername = String(u['ชื่อผู้ใช้'] || '').trim().toLowerCase();
      const uEmail = String(u['อีเมล'] || '').trim().toLowerCase();
      return uCode === cleanKey || uName === cleanKey || uUsername === cleanKey || uEmail === cleanKey;
    });

    if (user && user['รหัส']) {
      const updated = { ...user, 'LINE ID': cleanLineId };
      if (displayName) updated['LINE Display Name'] = displayName;
      await setDoc(SHEETS.USERS, user['รหัส'], updated);
      await logAudit('ผูกบัญชี LINE อัตโนมัติ', user['ชื่อ-นามสกุล'], `LINE ID: ${cleanLineId}`);
      return { success: true, message: `ผูกบัญชี LINE อัตโนมัติสำเร็จ (${user['ชื่อ-นามสกุล']})` };
    }

    return { success: false, message: 'ไม่พบบัญชีผู้ใช้งานที่ต้องการผูก' };
  } catch (err) {
    return { success: false, message: 'ข้อผิดพลาด: ' + err.message };
  }
}

module.exports = { getUsers, getUserLineId, saveUser, deleteUser, requestPasswordResetNotification, autoLinkLineUser };
