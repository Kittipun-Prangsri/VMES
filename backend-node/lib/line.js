// ============== LINE NOTIFICATION (Flex Card) ==============
// พอร์ตจาก รหัส.js L2041-2610 แบบ 1:1 — ใช้ fetch built-in ของ Node แทน UrlFetchApp

const { SHEETS, setDoc } = require('./firestore');
const { newId, nowStr, SYSTEM_NAME } = require('./util');

function getLineToken() {
  return process.env.LINE_TOKEN;
}

function getLineGroupId() {
  return process.env.LINE_GROUP_ID;
}

// ============== push message (ผลักข้อความ ไม่ผูก replyToken) ==============
async function sendLineFlex(altText, flexContent, targetId) {
  try {
    const token = getLineToken();
    const defaultGroup = getLineGroupId();
    const sendTo = targetId || defaultGroup;

    if (!token) return false;

    const payload = {
      to: sendTo,
      messages: [
        {
          type: 'flex',
          altText: altText,
          contents: flexContent,
        },
      ],
    };

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token.trim(),
      },
      body: JSON.stringify(payload),
    });
    const code = res.status;
    const bodyText = (await res.text()).substring(0, 500);
    console.log(`sendLineFlex status: ${code}, response: ${bodyText}`);

    // บันทึกประวัติเฉพาะกรณีส่งเข้ากลุ่ม เพื่อลดความซ้ำซ้อน
    if (sendTo === defaultGroup) {
      const notifObj = {
        'รหัส': newId('NT'),
        'วันเวลา': nowStr(),
        'ประเภท': 'Flex Message',
        'หัวข้อ': altText,
        'ข้อความ': altText,
        'ผู้รับ': 'LINE Group',
        'สถานะการส่ง': code === 200 ? 'สำเร็จ' : 'ผิดพลาด ' + code,
        'หมายเหตุ': bodyText.substring(0, 200),
      };
      await setDoc(SHEETS.NOTIFICATIONS, notifObj['รหัส'], notifObj);
    }
    return code === 200;
  } catch (err) {
    console.log('LINE error: ' + err);
    return false;
  }
}

function flexRow(label, value) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#64748b', flex: 4 },
      { type: 'text', text: value, size: 'sm', color: '#0f172a', flex: 6, weight: 'bold', wrap: true },
    ],
  };
}

async function sendBorrowingFlex(data, status, targetId) {
  const statusMap = {
    'รอรับเรื่อง': { color: '#f59e0b', icon: '📥', desc: 'มีคำขอยืมใหม่' },
    'รับเรื่องแล้ว': { color: '#3b82f6', icon: '✅', desc: 'รับเรื่องเรียบร้อย' },
    'อยู่ในระหว่างการยืม': { color: '#8b5cf6', icon: '📦', desc: 'ส่งมอบอุปกรณ์แล้ว' },
    'ถึงวันครบกำหนดคืน': { color: '#ef4444', icon: '⏰', desc: 'ครบกำหนดคืนวันนี้ / เกินกำหนด' },
    'ขอขยายเวลา': { color: '#d97706', icon: '⏳', desc: 'ผู้ยืมขอขยายเวลาส่งคืน' },
    'อนุมัติขยายเวลา': { color: '#10b981', icon: '👍', desc: 'อนุมัติขยายเวลาเรียบร้อย' },
    'อยู่ในระหว่างการคืน': { color: '#06b6d4', icon: '🔄', desc: 'อยู่ระหว่างตรวจรับ' },
    'คืนเสร็จสิ้น': { color: '#10b981', icon: '✔️', desc: 'คืนสำเร็จ' },
    'ยกเลิก': { color: '#6b7280', icon: '❌', desc: 'รายการถูกยกเลิก' },
  };
  const meta = statusMap[status] || { color: '#3b82f6', icon: '📦', desc: status };

  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: '#1e40af',
      height: 'sm',
      action: { type: 'uri', label: '🌐 เปิดดูในระบบ (vmes.web.app)', uri: 'https://vmes.web.app/#borrowing' },
    },
  ];

  if (status === 'รอรับเรื่อง') {
    footerButtons.unshift({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: { type: 'message', label: '✅ ตอบรับคำขอยืมนี้', text: 'เช็คคำขอ ' + String(data['รหัส'] || '') },
    });
  } else if (status === 'อยู่ในระหว่างการยืม' || status === 'ถึงวันครบกำหนดคืน') {
    footerButtons.unshift({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: { type: 'message', label: '⏳ ขอขยายเวลาคืน', text: 'ขอขยายเวลา ' + String(data['รหัส'] || '') },
    });
  }

  const flex = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: meta.color,
      paddingAll: '20px',
      contents: [
        { type: 'text', text: meta.icon + ' ' + status, color: '#ffffff', size: 'xl', weight: 'bold' },
        { type: 'text', text: meta.desc, color: '#ffffff', size: 'sm', margin: 'sm' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '20px',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#f8fafc',
          cornerRadius: '12px',
          paddingAll: '16px',
          contents: [
            { type: 'text', text: 'อุปกรณ์ที่ยืม', size: 'xs', color: '#64748b' },
            { type: 'text', text: String(data['ชื่ออุปกรณ์'] || '-'), size: 'xl', weight: 'bold', color: '#0f172a', wrap: true },
            { type: 'text', text: 'จำนวน ' + (data['จำนวน'] || 1) + ' รายการ', size: 'sm', color: '#64748b', margin: 'xs' },
          ],
        },
        { type: 'separator', margin: 'md' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            flexRow('🆔 เลขคำขอ', String(data['รหัส'] || '-')),
            flexRow('👤 ผู้ขอยืม', String(data['ผู้ขอยืม'] || '-')),
            flexRow('🏢 หน่วยงาน', String(data['หน่วยงาน'] || '-')),
            flexRow('📞 ติดต่อ', String(data['เบอร์ติดต่อ'] || '-')),
            flexRow('🎯 วัตถุประสงค์', String(data['วัตถุประสงค์'] || '-')),
            flexRow('📍 สถานที่ใช้งาน', String(data['สถานที่ใช้งาน'] || data['สถานที่'] || '-')),
            flexRow('📅 ครบกำหนดคืน', String(data['วันที่ครบกำหนด'] || '-')),
          ],
        },
        { type: 'separator', margin: 'md' },
        {
          type: 'box',
          layout: 'vertical',
          alignItems: 'center',
          margin: 'md',
          contents: [
            {
              type: 'image',
              url: 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(String(data['รหัส'] || '')),
              size: 'md',
              aspectRatio: '1:1',
            },
            { type: 'text', text: 'QR Code คำขอยืม: ' + String(data['รหัส'] || ''), size: 'xxs', color: '#94a3b8', margin: 'xs', align: 'center' },
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      backgroundColor: '#f1f5f9',
      contents: [...footerButtons, { type: 'text', text: '⏱ ' + nowStr() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' }],
    },
  };

  return sendLineFlex(meta.icon + ' ' + status + ': ' + (data['ชื่ออุปกรณ์'] || ''), flex, targetId);
}

async function sendVehicleUsageFlex(data, targetId) {
  const flex = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1e40af',
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '🚗 แจ้งเตือนการใช้รถ', color: '#ffffff', size: 'xl', weight: 'bold' },
        { type: 'text', text: 'Vehicle Departure Notification', color: '#bfdbfe', size: 'sm', margin: 'sm' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '20px',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#dbeafe',
          cornerRadius: '12px',
          paddingAll: '16px',
          contents: [
            { type: 'text', text: 'ทะเบียนรถ', size: 'xs', color: '#1e40af' },
            { type: 'text', text: String(data['ทะเบียน'] || '-'), size: 'xxl', weight: 'bold', color: '#1e3a8a' },
          ],
        },
        { type: 'separator', margin: 'md' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            flexRow('📍 สถานที่', String(data['สถานที่ไป'] || '-')),
            flexRow('🎯 วัตถุประสงค์', String(data['วัตถุประสงค์'] || '-')),
            flexRow('👨‍✈️ พนักงานขับรถ', String(data['พนักงานขับรถ'] || '-')),
            flexRow('👤 ผู้ขอใช้', String(data['ผู้ขอใช้'] || '-')),
            flexRow('📅 วันที่', String(data['วันที่ออก'] || '-')),
            flexRow('🕐 เวลาออก', String(data['เวลาออก'] || '-')),
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      backgroundColor: '#f1f5f9',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#1e40af',
          height: 'sm',
          action: { type: 'uri', label: '📋 บันทึกการใช้รถ (vmes.web.app)', uri: 'https://vmes.web.app/#vehicle' },
        },
        { type: 'text', text: '⏱ ' + nowStr() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' },
      ],
    },
  };
  return sendLineFlex('🚗 แจ้งเตือนการใช้รถ ' + data['ทะเบียน'], flex, targetId);
}

async function sendBookingFlex(data, status, targetId) {
  const statusColor = status === 'อนุมัติแล้ว' ? '#10b981' : '#f59e0b';
  const flex = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: statusColor,
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '📅 แจ้งเตือนการจองรถ: ' + status, color: '#ffffff', size: 'xl', weight: 'bold' },
        { type: 'text', text: 'Vehicle Booking Notification', color: '#ffffff', size: 'sm', margin: 'sm' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '20px',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#f8fafc',
          cornerRadius: '12px',
          paddingAll: '16px',
          contents: [
            { type: 'text', text: 'ทะเบียนรถที่จอง', size: 'xs', color: '#64748b' },
            { type: 'text', text: String(data['ทะเบียน'] || '-'), size: 'xl', weight: 'bold', color: '#0f172a' },
          ],
        },
        { type: 'separator', margin: 'md' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            flexRow('👤 ผู้ขอจอง', String(data['ผู้ขอจอง'] || '-')),
            flexRow('📍 สถานที่ไป', String(data['สถานที่ไป'] || '-')),
            flexRow('🎯 วัตถุประสงค์', String(data['วัตถุประสงค์'] || '-')),
            flexRow('📅 วันที่ใช้', String(data['วันที่ใช้'] || '-')),
            flexRow('🕐 เวลา', String(data['เวลาเริ่ม'] || '-') + ' - ' + String(data['เวลาสิ้นสุด'] || '-')),
            flexRow('👨‍✈️ พนักงานขับรถ', String(data['พนักงานขับรถ'] || '-')),
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      backgroundColor: '#f1f5f9',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#1e40af',
          height: 'sm',
          action: { type: 'uri', label: '🚗 ตรวจสอบการจอง (vmes.web.app)', uri: 'https://vmes.web.app/#vehicle' },
        },
        { type: 'text', text: '⏱ ' + nowStr() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' },
      ],
    },
  };
  return sendLineFlex('📅 แจ้งเตือนการจองรถ: ' + status, flex, targetId);
}

async function sendSmartSystemAlertFlex(maintAlerts, driverAlerts) {
  const contents = [];
  if (maintAlerts && maintAlerts.length > 0) {
    contents.push({ type: 'text', text: '🔧 แจ้งเตือนบำรุงรักษารถยนต์ใกล้ถึงระยะ:', weight: 'bold', size: 'sm', color: '#d97706', margin: 'md' });
    maintAlerts.forEach((msg) => {
      contents.push({ type: 'text', text: '• ' + msg, size: 'xs', color: '#334155', wrap: true });
    });
  }
  if (driverAlerts && driverAlerts.length > 0) {
    contents.push({ type: 'text', text: '🪪 แจ้งเตือนใบขับขี่พนักงานใกล้หมดอายุ:', weight: 'bold', size: 'sm', color: '#ef4444', margin: 'md' });
    driverAlerts.forEach((msg) => {
      contents.push({ type: 'text', text: '• ' + msg, size: 'xs', color: '#334155', wrap: true });
    });
  }

  const flex = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#f59e0b',
      paddingAll: '16px',
      contents: [{ type: 'text', text: '⚠️ แจ้งเตือนระบบการดูแลรักษา & ใบขับขี่', color: '#ffffff', size: 'lg', weight: 'bold' }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: contents,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '10px',
      backgroundColor: '#f1f5f9',
      contents: [{ type: 'text', text: SYSTEM_NAME, size: 'xs', color: '#64748b', align: 'center' }],
    },
  };

  return sendLineFlex('⚠️ แจ้งเตือนบำรุงรักษารถและใบขับขี่ใกล้หมดอายุ', flex);
}

// ============== reply message (ผูกกับ replyToken จาก webhook event) ==============
async function replyMessage(replyToken, messages) {
  try {
    const token = getLineToken();
    if (!token) return;
    const url = 'https://api.line.me/v2/bot/message/reply';
    const msgPayload = Array.isArray(messages) ? messages : [{ type: 'text', text: String(messages) }];
    const payload = { replyToken: replyToken, messages: msgPayload };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(token).trim() },
      body: JSON.stringify(payload),
    });
    const code = res.status;
    const bodyText = (await res.text()).substring(0, 500);
    console.log(`replyMessage status: ${code}, response: ${bodyText}`);
  } catch (e) {
    console.log('replyMessage error: ' + e.message);
  }
}

async function replyLineFlex(replyToken, altText, flexContent) {
  try {
    const token = getLineToken();
    if (!token) return;
    const url = 'https://api.line.me/v2/bot/message/reply';
    const payload = {
      replyToken: replyToken,
      messages: [
        {
          type: 'flex',
          altText: altText,
          contents: flexContent,
        },
      ],
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(token).trim() },
      body: JSON.stringify(payload),
    });
    const code = res.status;
    const bodyText = (await res.text()).substring(0, 500);
    console.log(`replyLineFlex status: ${code}, response: ${bodyText}`);
    return { success: code >= 200 && code < 300, status: code, body: bodyText };
  } catch (e) {
    console.log('replyLineFlex error: ' + e.message);
    return { success: false, status: 0, body: String(e.message || e) };
  }
}

// ============== test / diagnostic ==============
async function testLineNotify() {
  const flex = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '🎉 ทดสอบระบบแจ้งเตือน', size: 'xl', weight: 'bold', color: '#1e40af' },
        { type: 'text', text: SYSTEM_NAME, size: 'sm', color: '#64748b', margin: 'md' },
        { type: 'text', text: 'เชื่อมต่อสำเร็จ ' + nowStr(), size: 'xs', color: '#94a3b8', margin: 'md' },
      ],
    },
  };
  return (await sendLineFlex('🎉 ทดสอบระบบแจ้งเตือน', flex)) ? 'ส่งสำเร็จ' : 'ส่งไม่สำเร็จ';
}

async function testUserLine(lineId) {
  if (!lineId) return 'กรุณาระบุ LINE ID';
  const flex = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '📲 ทดสอบแจ้งเตือนส่วนตัว', size: 'xl', weight: 'bold', color: '#059669' },
        { type: 'text', text: 'ระบบสามารถส่งข้อความหาคุณได้แล้ว', size: 'sm', color: '#4b5563', margin: 'md' },
        { type: 'text', text: 'ID: ' + lineId, size: 'xxs', color: '#9ca3af', margin: 'lg' },
        { type: 'text', text: 'ทดสอบเมื่อ: ' + nowStr(), size: 'xxs', color: '#9ca3af' },
      ],
    },
  };
  return (await sendLineFlex('📲 ทดสอบแจ้งเตือนส่วนตัว', flex, lineId))
    ? 'ส่งทดสอบสำเร็จ'
    : 'ส่งทดสอบไม่สำเร็จ (ตรวจสอบ LINE ID หรือ Token)';
}

async function testTelegramNotification(botToken, chatId) {
  if (!botToken || !chatId) return 'กรุณาระบุ Bot Token และ Chat ID';
  try {
    const url = 'https://api.telegram.org/bot' + botToken.trim() + '/sendMessage';
    const payload = {
      chat_id: chatId.trim(),
      text: '📲 ทดสอบแจ้งเตือนจากระบบ ' + SYSTEM_NAME + '\nเชื่อมต่อสำเร็จเวลา: ' + nowStr(),
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const code = res.status;
    const body = await res.json();
    if (code === 200 && body.ok) {
      return 'ส่งสำเร็จ';
    } else {
      return 'ส่งไม่สำเร็จ: ' + (body.description || 'รหัสตอบกลับ ' + code);
    }
  } catch (err) {
    return 'ผิดพลาด: ' + err.message;
  }
}

module.exports = {
  getLineToken,
  getLineGroupId,
  sendLineFlex,
  sendBorrowingFlex,
  sendVehicleUsageFlex,
  sendBookingFlex,
  sendSmartSystemAlertFlex,
  flexRow,
  replyMessage,
  replyLineFlex,
  testLineNotify,
  testUserLine,
  testTelegramNotification,
};
