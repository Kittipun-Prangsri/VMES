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

// ============== การ์ดแจ้งเตือนการยืม แยกตามบทบาท ==============
// บทบาทในการยืม: "ผู้ส่งมอบ" = เจ้าหน้าที่/แอดมิน (รับเรื่อง ส่งมอบ ตรวจรับคืน) กับ "ผู้รับ" = ผู้ยืม
// เดิมส่งการ์ดใบเดียวกันให้ทั้งกลุ่มแอดมินและผู้ยืม (ปุ่มเจ้าหน้าที่กับปุ่มผู้ยืมปนกันอยู่ในใบเดียว)
// ตอนนี้แยกเป็น 2 ใบ: audience 'staff' (กลุ่มแอดมิน/เจ้าหน้าที่) และ 'requester' (ผู้ยืม, ส่งส่วนตัว)
// 'viewer' = ผู้ที่ไม่ใช่ทั้งสองบทบาท (ถามรหัสคำขอของคนอื่น) เห็นสถานะอย่างเดียว ไม่มีปุ่ม ไม่มีเบอร์ติดต่อ
const BORROW_STAGE = {
  'รอรับเรื่อง': { color: '#f59e0b', icon: '📥',
    staff: 'มีคำขอยืมใหม่ — รอเจ้าหน้าที่รับเรื่อง', user: 'ส่งคำขอยืมเรียบร้อย — รอเจ้าหน้าที่รับเรื่อง',
    staffNext: 'กด “รับเรื่อง” เพื่อยืนยันว่าจะดำเนินการ', userNext: 'รอเจ้าหน้าที่ติดต่อกลับ เมื่อรับเรื่องแล้วจะแจ้งให้ทราบอีกครั้ง' },
  'รับเรื่องแล้ว': { color: '#3b82f6', icon: '✅',
    staff: 'รับเรื่องแล้ว — เตรียมอุปกรณ์เพื่อส่งมอบ', user: 'เจ้าหน้าที่รับเรื่องแล้ว — มารับอุปกรณ์ตามวันเวลาที่ต้องการ',
    staffNext: 'เมื่อส่งมอบอุปกรณ์ให้ผู้ยืมแล้ว กด “ส่งมอบอุปกรณ์แล้ว”', userNext: 'ตอนรับอุปกรณ์ แสดง QR Code ด้านล่างให้เจ้าหน้าที่สแกน' },
  'อยู่ในระหว่างการยืม': { color: '#8b5cf6', icon: '📦',
    staff: 'ส่งมอบอุปกรณ์แล้ว — อยู่ระหว่างการยืม', user: 'คุณได้รับอุปกรณ์แล้ว — โปรดคืนภายในวันที่กำหนด',
    staffNext: '', userNext: 'ต้องใช้นานกว่ากำหนด? กด “ขอขยายเวลาคืน” ก่อนครบกำหนด' },
  'ถึงวันครบกำหนดคืน': { color: '#ef4444', icon: '⏰',
    staff: 'ครบกำหนดคืนวันนี้ / เกินกำหนด — ติดตามผู้ยืม', user: 'ครบกำหนดคืนแล้ว — กรุณานำอุปกรณ์มาคืน หรือขอขยายเวลา',
    staffNext: 'ผู้ยืมยังไม่ได้คืนตามกำหนด', userNext: 'คืนแล้วกด “แจ้งคืนอุปกรณ์” เพื่อให้เจ้าหน้าที่ตรวจรับ' },
  'ขอขยายเวลา': { color: '#d97706', icon: '⏳',
    staff: 'ผู้ยืมขอขยายเวลาส่งคืน — พิจารณาอนุมัติได้ในระบบ', user: 'ส่งคำขอขยายเวลาแล้ว — รอเจ้าหน้าที่พิจารณา',
    staffNext: 'อนุมัติหรือปฏิเสธได้ที่หน้ายืม-คืนในระบบ', userNext: 'ระหว่างรอ ยังต้องถืออุปกรณ์ไว้ตามเดิม' },
  'อนุมัติขยายเวลา': { color: '#10b981', icon: '👍',
    staff: 'อนุมัติขยายเวลาเรียบร้อย', user: 'เจ้าหน้าที่อนุมัติขยายเวลาแล้ว — ครบกำหนดใหม่ตามด้านล่าง', staffNext: '', userNext: '' },
  'อยู่ในระหว่างการคืน': { color: '#06b6d4', icon: '🔄',
    staff: 'ผู้ยืมแจ้งคืนแล้ว — ตรวจรับอุปกรณ์', user: 'แจ้งคืนแล้ว — นำอุปกรณ์ไปส่งเจ้าหน้าที่เพื่อตรวจรับ',
    staffNext: 'ตรวจสภาพแล้วกด “ยืนยันรับคืน” (ถ้าชำรุดกด “รับคืน (ชำรุด)”)', userNext: 'รอเจ้าหน้าที่ตรวจรับ เสร็จแล้วจะแจ้งให้ทราบ' },
  'คืนเสร็จสิ้น': { color: '#10b981', icon: '✔️',
    staff: 'รับคืนเรียบร้อย', user: 'คืนอุปกรณ์เรียบร้อย ขอบคุณที่ใช้บริการ', staffNext: '', userNext: 'ช่วยประเมินความพึงพอใจได้ที่ปุ่มด้านล่าง' },
  'ยกเลิก': { color: '#6b7280', icon: '❌', staff: 'รายการถูกยกเลิก', user: 'คำขอยืมนี้ถูกยกเลิก', staffNext: '', userNext: '' },
};

// ปุ่มของ "ผู้ส่งมอบ" (เจ้าหน้าที่) ตามสถานะ — ใช้คำสั่งข้อความที่ webhook ตรวจสิทธิ์จาก LINE userId อีกชั้น
function borrowStaffButtons(code, status) {
  const btn = (style, color, label, text) => ({ type: 'button', style, ...(color ? { color } : {}), height: 'sm', action: { type: 'message', label, text } });
  const out = [];
  if (status === 'รอรับเรื่อง') out.push(btn('primary', '#3b82f6', '✅ รับเรื่องคำขอนี้', 'รับเรื่อง ' + code));
  else if (status === 'รับเรื่องแล้ว') out.push(btn('primary', '#8b5cf6', '📦 ส่งมอบอุปกรณ์แล้ว', 'ส่งมอบ ' + code));
  else if (status === 'อยู่ในระหว่างการคืน') {
    out.push(btn('primary', '#10b981', '✅ ยืนยันรับคืนอุปกรณ์', 'ยืนยันคืน ' + code));
    out.push(btn('secondary', null, '⚠️ รับคืน (ชำรุด)', 'ยืนยันคืนชำรุด ' + code));
  }
  out.push({ type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '🌐 เปิดดูในระบบ (vmes.web.app)', uri: 'https://vmes.web.app/#borrowing' } });
  return out;
}

// ปุ่มของ "ผู้รับ" (ผู้ยืม) ตามสถานะ
function borrowRequesterButtons(code, status) {
  const out = [];
  if (['อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน', 'ขอขยายเวลา', 'อนุมัติขยายเวลา'].includes(status)) {
    out.push({ type: 'button', style: 'primary', color: '#06b6d4', height: 'sm', action: { type: 'uri', label: '🔄 แจ้งคืนอุปกรณ์', uri: LIFF_URL + '?tab=return' } });
    if (status !== 'ขอขยายเวลา') {
      out.push({ type: 'button', style: 'secondary', height: 'sm', action: { type: 'message', label: '⏳ ขอขยายเวลาคืน', text: 'ขอขยายเวลา ' + code } });
    }
  } else if (status === 'คืนเสร็จสิ้น') {
    out.push({ type: 'button', style: 'primary', color: '#f59e0b', height: 'sm', action: { type: 'uri', label: '⭐ ประเมินความพึงพอใจการยืม', uri: 'https://vmes.web.app/#borrowing' } });
    out.push({ type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: '📦 ยืมอุปกรณ์อีกครั้ง', uri: LIFF_URL } });
  }
  out.push({ type: 'button', style: 'link', height: 'sm', action: { type: 'message', label: '📋 รายการยืมของฉัน', text: 'รายการของฉัน' } });
  return out;
}

function buildBorrowingBubble(data, status, audience) {
  const st = status || data['สถานะ'] || 'รอรับเรื่อง';
  const stage = BORROW_STAGE[st] || { color: '#3b82f6', icon: '📦', staff: st, user: st, staffNext: '', userNext: '' };
  const isStaff = audience === 'staff';
  const isRequester = audience === 'requester';
  const code = String(data['รหัส'] || '');
  // viewer (คนที่ไม่ใช่ทั้งผู้ส่งมอบและผู้รับ) ใช้คำบรรยายแบบกลาง ไม่พูดกับผู้ยืม และไม่มีขั้นตอนถัดไป
  const desc = isRequester ? stage.user : stage.staff;
  const next = isStaff ? stage.staffNext : isRequester ? stage.userNext : '';

  const multi = Array.isArray(data['รายการอุปกรณ์']) && data['รายการอุปกรณ์'].length > 0;
  const itemsBox = multi
    ? {
        type: 'box', layout: 'vertical', backgroundColor: '#f8fafc', cornerRadius: '12px', paddingAll: '16px',
        contents: [
          { type: 'text', text: `อุปกรณ์ที่ยืม (${data['รายการอุปกรณ์'].length} รายการ)`, size: 'xs', color: '#64748b' },
          ...data['รายการอุปกรณ์'].map((item) => ({ type: 'text', text: `• ${item['ชื่ออุปกรณ์']} (x${item['จำนวน']})`, size: 'sm', weight: 'bold', color: '#0f172a', wrap: true, margin: 'xs' })),
        ],
      }
    : {
        type: 'box', layout: 'vertical', backgroundColor: '#f8fafc', cornerRadius: '12px', paddingAll: '16px',
        contents: [
          { type: 'text', text: 'อุปกรณ์ที่ยืม', size: 'xs', color: '#64748b' },
          { type: 'text', text: String(data['ชื่ออุปกรณ์'] || '-'), size: 'xl', weight: 'bold', color: '#0f172a', wrap: true },
          { type: 'text', text: 'จำนวน ' + (data['จำนวน'] || 1) + ' รายการ', size: 'sm', color: '#64748b', margin: 'xs' },
        ],
      };

  const deliverer = String(data['ผู้รับเรื่อง'] || '').trim();
  const when = data['วันที่ต้องการรับ'] ? String(data['วันที่ต้องการรับ']) + (data['เวลาที่ต้องการรับ'] ? ' เวลา ' + data['เวลาที่ต้องการรับ'] + ' น.' : '') : '';
  const rows = isStaff
    ? [
        flexRow('🆔 เลขคำขอ', code || '-'),
        flexRow('🙋 ผู้รับ (ผู้ยืม)', String(data['ผู้ขอยืม'] || '-')),
        flexRow('🏢 หน่วยงาน', String(data['หน่วยงาน'] || '-')),
        flexRow('📞 ติดต่อ', String(data['เบอร์ติดต่อ'] || '-')),
        flexRow('🎯 วัตถุประสงค์', String(data['วัตถุประสงค์'] || '-')),
        flexRow('📍 สถานที่ใช้งาน', String(data['สถานที่ใช้งาน'] || data['สถานที่'] || '-')),
        ...(when ? [flexRow('🕐 วันที่/เวลารับ', when)] : []),
        flexRow('📅 ครบกำหนดคืน', String(data['วันที่ครบกำหนด'] || '-')),
        flexRow('🚚 ผู้ส่งมอบ', deliverer || 'ยังไม่มี (รอรับเรื่อง)'),
      ]
    : [
        flexRow('🆔 เลขคำขอ', code || '-'),
        flexRow('🚚 ผู้ส่งมอบ', deliverer || 'รอเจ้าหน้าที่รับเรื่อง'),
        flexRow('🎯 วัตถุประสงค์', String(data['วัตถุประสงค์'] || '-')),
        flexRow('📍 สถานที่ใช้งาน', String(data['สถานที่ใช้งาน'] || data['สถานที่'] || '-')),
        ...(when ? [flexRow('🕐 วันที่/เวลารับ', when)] : []),
        flexRow('📅 ครบกำหนดคืน', String(data['วันที่ครบกำหนด'] || '-')),
        ...(audience === 'viewer' ? [flexRow('📌 สถานะ', st)] : []),
      ];

  const bodyContents = [itemsBox, { type: 'separator', margin: 'md' }, { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows }];
  if (next) {
    bodyContents.push({ type: 'box', layout: 'vertical', backgroundColor: isStaff ? '#fffbeb' : '#eff6ff', cornerRadius: '10px', paddingAll: '12px', margin: 'md',
      contents: [{ type: 'text', text: (isStaff ? '👉 ขั้นตอนของคุณ: ' : '👉 ขั้นตอนถัดไป: ') + next, size: 'xs', color: isStaff ? '#92400e' : '#1e40af', wrap: true }] });
  }
  if (audience !== 'viewer') {
    bodyContents.push({ type: 'separator', margin: 'md' });
    bodyContents.push({
      type: 'box', layout: 'vertical', alignItems: 'center', margin: 'md',
      contents: [
        { type: 'image', url: 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(code), size: 'md', aspectRatio: '1:1' },
        { type: 'text', text: 'QR Code คำขอยืม: ' + code, size: 'xxs', color: '#94a3b8', margin: 'xs', align: 'center' },
      ],
    });
  }

  const buttons = isStaff ? borrowStaffButtons(code, st) : isRequester ? borrowRequesterButtons(code, st) : [];
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: stage.color, paddingAll: '20px',
      contents: [
        { type: 'text', text: stage.icon + ' ' + st, color: '#ffffff', size: 'xl', weight: 'bold' },
        { type: 'text', text: desc, color: '#ffffff', size: 'sm', margin: 'sm', wrap: true },
        ...(audience === 'viewer' ? [] : [{ type: 'text', text: isStaff ? 'สำหรับ: เจ้าหน้าที่ (ผู้ส่งมอบ)' : 'สำหรับ: ผู้ยืม (ผู้รับ)', color: '#ffffff', size: 'xxs', margin: 'md', weight: 'bold' }]),
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px', contents: bodyContents },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', backgroundColor: '#f1f5f9',
      contents: [...buttons, { type: 'text', text: '⏱ ' + nowStr() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' }],
    },
  };
}

// ส่งการ์ดแจ้งเตือนการยืม — ไม่ระบุ targetId = กลุ่มแอดมิน (การ์ดของเจ้าหน้าที่), ระบุ targetId = ผู้ยืมส่วนตัว (การ์ดของผู้รับ)
// ระบุ audience เองได้ เช่น ส่งการ์ดเจ้าหน้าที่ให้แอดมินรายบุคคล
async function sendBorrowingFlex(data, status, targetId, audience) {
  const aud = audience || (targetId ? 'requester' : 'staff');
  const flex = buildBorrowingBubble(data, status, aud);
  const stage = BORROW_STAGE[status] || { icon: '📦' };
  const label = aud === 'staff' ? stage.icon + ' ' + status + ': ' + (data['ชื่ออุปกรณ์'] || '') : stage.icon + ' คำขอยืมของคุณ: ' + status;
  return sendLineFlex(label, flex, targetId);
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

const LIFF_URL = 'https://liff.line.me/2011083425-G0pup6PQ';
const LIFF_BOOKING_URL = LIFF_URL + '?tab=booking';
const LIFF_SURVEY_URL = LIFF_URL + '?tab=survey'; // liff.html redirect ต่อไป liff-survey.html

const BOOKING_STATUS_META = {
  'รออนุมัติ': { color: '#f59e0b', icon: '📥', title: 'คำขอจองรถใหม่', desc: 'รอผู้มีสิทธิ์อนุมัติ' },
  'อนุมัติแล้ว': { color: '#10b981', icon: '✅', title: 'อนุมัติการจองรถแล้ว', desc: 'พร้อมใช้รถตามวันเวลาที่จอง' },
  'ไม่อนุมัติ': { color: '#ef4444', icon: '❌', title: 'ไม่อนุมัติการจองรถ', desc: 'คำขอนี้ไม่ได้รับการอนุมัติ' },
  'ยกเลิก': { color: '#64748b', icon: '↩️', title: 'ยกเลิกการจองรถ', desc: 'คำขอนี้ถูกยกเลิกแล้ว' },
};

// bubble เดียวใช้ทั้งแจ้งเตือน push, ตอบกลับใน webhook และ carousel "การจองของฉัน"
// audience: 'staff' = กลุ่มเจ้าหน้าที่ (ปุ่มอนุมัติ/ไม่อนุมัติ), 'requester' = ผู้ขอจอง (ปุ่มยกเลิก/จองใหม่)
function buildBookingBubble(data, status, audience) {
  const st = status || data['สถานะ'] || 'รออนุมัติ';
  const meta = BOOKING_STATUS_META[st] || { color: '#3b82f6', icon: '📅', title: 'การจองรถ: ' + st, desc: '' };
  const code = String(data['รหัส'] || '');
  const active = st === 'รออนุมัติ' || st === 'อนุมัติแล้ว';

  const buttons = [];
  if (audience === 'staff' && st === 'รออนุมัติ') {
    buttons.push(
      { type: 'button', style: 'primary', color: '#10b981', height: 'sm', action: { type: 'message', label: '✅ อนุมัติ (เจ้าหน้าที่)', text: 'อนุมัติจอง ' + code } },
      { type: 'button', style: 'secondary', height: 'sm', action: { type: 'message', label: '✖ ไม่อนุมัติ (เจ้าหน้าที่)', text: 'ไม่อนุมัติจอง ' + code } }
    );
  }
  if (audience === 'requester') {
    if (active) {
      buttons.push({ type: 'button', style: 'secondary', height: 'sm', action: { type: 'message', label: '↩️ ยกเลิกการจองนี้', text: 'ยกเลิกจอง ' + code } });
    }
    buttons.push({ type: 'button', style: 'primary', color: '#1e40af', height: 'sm', action: { type: 'uri', label: '📋 การจองของฉัน / จองใหม่', uri: LIFF_BOOKING_URL } });
  } else {
    buttons.push({ type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '🌐 เปิดดูในระบบ (vmes.web.app)', uri: 'https://vmes.web.app/' } });
  }

  const rows = [
    flexRow('👤 ผู้ขอจอง', String(data['ผู้ขอจอง'] || '-')),
    flexRow('🏢 หน่วยงาน', String(data['หน่วยงาน'] || '-')),
    flexRow('📅 วันที่ใช้', String(data['วันที่ใช้'] || '-')),
    flexRow('🕐 เวลา', String(data['เวลาเริ่ม'] || '-') + ' - ' + String(data['เวลาสิ้นสุด'] || '-')),
    flexRow('📍 สถานที่ไป', String(data['สถานที่ไป'] || '-')),
  ];
  if (data['วัตถุประสงค์']) rows.push(flexRow('🎯 วัตถุประสงค์', String(data['วัตถุประสงค์'])));
  rows.push(flexRow('👥 ผู้โดยสาร', String(data['จำนวนผู้โดยสาร'] || 1) + ' คน'));
  rows.push(flexRow('👨‍✈️ พนักงานขับรถ', String(data['พนักงานขับรถ'] || 'ไม่ระบุ')));
  if (data['ผู้อนุมัติ'] && (st === 'อนุมัติแล้ว' || st === 'ไม่อนุมัติ')) rows.push(flexRow('🖊 ผู้พิจารณา', String(data['ผู้อนุมัติ'])));
  if (data['ผู้ยกเลิก'] && st === 'ยกเลิก') rows.push(flexRow('🖊 ผู้ยกเลิก', String(data['ผู้ยกเลิก'])));
  if (data['เหตุผล']) rows.push(flexRow('📝 เหตุผล', String(data['เหตุผล'])));

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: meta.color,
      paddingAll: '20px',
      contents: [
        { type: 'text', text: meta.icon + ' ' + meta.title, color: '#ffffff', size: 'lg', weight: 'bold', wrap: true },
        { type: 'text', text: (code ? 'รหัส ' + code + ' · ' : '') + (meta.desc || st), color: '#ffffff', size: 'xs', margin: 'sm', wrap: true },
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
        { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      backgroundColor: '#f1f5f9',
      contents: [
        ...buttons,
        { type: 'text', text: '⏱ ' + nowStr() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' },
      ],
    },
  };
}

async function sendBookingFlex(data, status, targetId, audience) {
  const meta = BOOKING_STATUS_META[status] || { title: 'แจ้งเตือนการจองรถ: ' + status };
  const flex = buildBookingBubble(data, status, audience || 'staff');
  return sendLineFlex('📅 ' + meta.title + ' ' + String(data['ทะเบียน'] || ''), flex, targetId);
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

    if (code >= 400) {
      console.error(`replyLineFlex failed (${code}): ${bodyText}. Attempting fallback text message.`);
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(token).trim() },
          body: JSON.stringify({
            replyToken: replyToken,
            messages: [{ type: 'text', text: `${altText}\n(ไม่สามารถแสดงการ์ดได้)` }],
          }),
        });
      } catch (err) {
        console.error('replyLineFlex fallback failed:', err);
      }
    }

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

async function sendServiceRequestFlex(data, status, targetId) {
  const isApproved = status === 'อนุมัติ';
  const isRejected = status === 'ไม่อนุมัติ';
  const color = isApproved ? '#10b981' : (isRejected ? '#ef4444' : '#0284c7');
  const icon = isApproved ? '✅' : (isRejected ? '❌' : '📩');
  
  const flex = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: color,
      paddingAll: '20px',
      contents: [
        { type: 'text', text: `${icon} คำขอใช้บริการ IT: ${status}`, color: '#ffffff', size: 'xl', weight: 'bold' },
        { type: 'text', text: `ประเภท: ${data.requestType || 'HOSxP/VPN'}`, color: '#ffffff', size: 'sm', margin: 'sm' },
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
          spacing: 'sm',
          contents: [
            flexRow('👤 ผู้ขอใช้บริการ', String(data.nameTh || '-')),
            flexRow('💼 ตำแหน่ง', String(data.position || '-')),
            flexRow('🪪 เลขบัตรประชาชน', String(data.idCard || '-')),
            flexRow('📞 ติดต่อ', String(data.email || data.lineId || '-')),
            data.requestType === 'VPN' ? flexRow('🎯 วัตถุประสงค์', String(data.vpnPurpose || '-')) : null,
          ].filter(Boolean),
        },
        data.remark && data.remark !== '-' ? { type: 'text', text: '📝 หมายเหตุ: ' + data.remark, size: 'xs', color: '#ef4444', margin: 'md' } : null,
      ].filter(Boolean),
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      backgroundColor: '#f1f5f9',
      contents: [
        isApproved
          ? {
              type: 'button',
              style: 'primary',
              color: '#f59e0b',
              height: 'sm',
              action: { type: 'uri', label: '⭐ ประเมินความพึงพอใจการบริการ', uri: 'https://vmes.web.app/#serviceRequests' },
            }
          : null,
        {
          type: 'button',
          style: 'primary',
          color: '#0284c7',
          height: 'sm',
          action: { type: 'uri', label: '🔍 ติดตามคำขอในระบบ (vmes.web.app)', uri: 'https://vmes.web.app/#serviceRequests' },
        },
        { type: 'text', text: '⏱ ' + nowStr() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' },
      ].filter(Boolean),
    },
  };

  return sendLineFlex(`${icon} คำขอใช้บริการ IT: ${data.nameTh || ''}`, flex, targetId);
}

async function sendTelegramServiceNotify(htmlMessage) {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '7931324702:AAGVf1TZ808MWdiVq3uVoNU3DKJ0Z8ppt00').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '7857036135').trim();
  if (!botToken || !chatId) return;
  try {
    const url = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: htmlMessage, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('Telegram notification error:', e);
  }
}

module.exports = {
  getLineToken,
  getLineGroupId,
  sendLineFlex,
  sendBorrowingFlex,
  buildBorrowingBubble,
  sendVehicleUsageFlex,
  sendBookingFlex,
  buildBookingBubble,
  LIFF_URL,
  LIFF_BOOKING_URL,
  LIFF_SURVEY_URL,
  sendSmartSystemAlertFlex,
  sendServiceRequestFlex,
  sendTelegramServiceNotify,
  flexRow,
  replyMessage,
  replyLineFlex,
  testLineNotify,
  testUserLine,
  testTelegramNotification,
};
