// ============== LINE WEBHOOK ==============
// เทียบเท่า doPost's LINE branch เดิม (รหัส.js L221-953) — พอร์ต 6 กิ่งคำสั่งแบบ 1:1
// (Flex JSON สี/ข้อความ/ปุ่ม/เงื่อนไขตรงต้นฉบับทุกจุด) ยกเว้นบั๊กปุ่มเมนูช่วยเหลือ 4 ปุ่ม
// ที่แก้ตามที่ยืนยันแล้ว (ดูกิ่งที่ 6 ด้านล่าง)

const { SYSTEM_NAME, safeTruncate, safeGet, nowStr } = require('../lib/util');
const { replyLineFlex, flexRow } = require('../lib/line');
const { getVehicles } = require('../lib/handlers/vehicles');
const { getEquipment } = require('../lib/handlers/equipment');
const { getBorrowing, updateBorrowingStatus, getMyActiveBorrowings } = require('../lib/handlers/borrowing');

const { bindLineByCitizenId, getUserNameByLineId } = require('../lib/handlers/users');

async function handleAutoBind13Digit(replyToken, userId, userMessage) {
  try {
    const match = userMessage.match(/\d{13}/);
    if (!match) return false;
    const citizenId = match[0];

    const result = await bindLineByCitizenId(citizenId, userId, 'LINE User');
    const isSuccess = result.success;
    const headerColor = isSuccess ? '#10b981' : '#ef4444';
    const headerText = isSuccess ? '🎉 ผูกบัญชี LINE อัตโนมัติสำเร็จ!' : '❌ ผูกบัญชี LINE ไม่สำเร็จ';

    const flexContent = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerColor,
        paddingAll: '20px',
        contents: [
          { type: 'text', text: headerText, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'ระบบผูก LINE ID อัตโนมัติแบบไม่ต้องคัดลอก', color: '#ffffff', size: 'xs', margin: 'xs', opacity: 0.9 },
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
              { type: 'text', text: '👤 ชื่อผู้ใช้งานระบบ:', size: 'xs', color: '#64748b' },
              { type: 'text', text: result.userName || 'ผู้ใช้งานระบบ', size: 'md', weight: 'bold', color: '#0f172a' },
              { type: 'text', text: '🪪 เลขบัตรประชาชน: ' + citizenId, size: 'xs', color: '#475569', margin: 'xs' },
            ],
          },
          {
            type: 'text',
            text: result.message || 'ระบบนำ LINE User ID ไปลงในตารางผู้ใช้ให้อัตโนมัติแล้วเรียบร้อยครับ!',
            size: 'sm',
            color: '#334155',
            wrap: true,
            margin: 'md',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        backgroundColor: '#f1f5f9',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#10b981',
            height: 'sm',
            action: { type: 'uri', label: '🌐 เข้าสู่ระบบ VMES (vmes.web.app)', uri: 'https://vmes.web.app' },
          },
          { type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' },
        ],
      },
    };

    await replyLineFlex(replyToken, isSuccess ? '🎉 ผูกบัญชี LINE สำเร็จ' : '❌ ผูกบัญชีไม่สำเร็จ', flexContent);
    return true;
  } catch (err) {
    console.error('handleAutoBind13Digit error:', err);
    return false;
  }
}

async function handleAskId(replyToken, userId) {
  const truncatedUserId = safeTruncate(userId, 50);
  const flexContent = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#4f46e5',
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '🆔 LINE User ID & ผูกบัญชี', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: 'ระบบผูก LINE ID อัตโนมัติ ไม่ต้องพิมพ์/คัดลอก!', color: '#bfdbfe', size: 'xs', margin: 'xs' },
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
          backgroundColor: '#eff6ff',
          cornerRadius: '12px',
          paddingAll: '16px',
          borderWidth: '1px',
          borderColor: '#bfdbfe',
          contents: [
            { type: 'text', text: '✨ ผูกบัญชีอัตโนมัติง่ายๆ ใน 1 วินาที:', size: 'xs', color: '#1d4ed8', weight: 'bold' },
            { type: 'text', text: 'เพียงพิมพ์ "เลขบัตรประชาชน 13 หลัก" ส่งเข้ามาในแชทนี้ได้เลยครับ!', size: 'sm', color: '#1e40af', margin: 'xs', weight: 'bold', wrap: true },
            { type: 'text', text: '(เช่น พิมพ์ 1270400015079 ส่งมาในแชท)', size: 'xs', color: '#4b5563', margin: 'xs' },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#f8fafc',
          cornerRadius: '8px',
          paddingAll: '12px',
          margin: 'sm',
          contents: [
            { type: 'text', text: 'LINE User ID ประจำตัวของคุณ:', size: 'xxs', color: '#64748b' },
            { type: 'text', text: truncatedUserId, size: 'xs', color: '#0f172a', weight: 'bold', wrap: true },
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      backgroundColor: '#f1f5f9',
      contents: [{ type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center' }],
    },
  };
  await replyLineFlex(replyToken, '🆔 ผูกบัญชี LINE อัตโนมัติ', flexContent);
}

function simpleErrorBubble(headerColor, headerText, bodyText) {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: headerColor,
      paddingAll: '20px',
      contents: [{ type: 'text', text: headerText, color: '#ffffff', size: 'lg', weight: 'bold' }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '20px',
      contents: [{ type: 'text', text: bodyText, size: 'sm', color: '#64748b', wrap: true }],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      backgroundColor: '#f1f5f9',
      contents: [{ type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center' }],
    },
  };
}

async function handleVehicleStatus(replyToken) {
  const vehicles = await safeGet(getVehicles);
  if (vehicles.length === 0) {
    const flexContent = simpleErrorBubble('#ef4444', '🚗 สถานะรถยนต์', '❌ ไม่พบข้อมูลรถยนต์ในระบบในขณะนี้');
    await replyLineFlex(replyToken, '🚗 ไม่พบข้อมูลรถยนต์ในระบบ', flexContent);
    return;
  }

  const rows = vehicles.slice(0, 10).map((v, idx) => {
    const status = safeTruncate(v['สถานะ'] || '', 20);
    const statusIcon = status === 'พร้อมใช้งาน' ? '🟢' : '🟡';
    const plate = safeTruncate(v['ทะเบียน'] || v['รหัส'] || '-', 15);
    const name = safeTruncate((v['ยี่ห้อ'] || '') + ' ' + (v['รุ่น'] || ''), 25);
    return {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: idx === 0 ? 'none' : 'sm',
      alignItems: 'center',
      contents: [
        { type: 'text', text: statusIcon, flex: 1, size: 'sm' },
        { type: 'text', text: plate, size: 'sm', weight: 'bold', color: '#0f172a', flex: 3 },
        { type: 'text', text: name, size: 'sm', color: '#475569', flex: 5 },
        {
          type: 'text',
          text: status,
          size: 'xs',
          color: status === 'พร้อมใช้งาน' ? '#10b981' : '#d97706',
          align: 'end',
          flex: 3,
          weight: 'bold',
        },
      ],
    };
  });

  const flexContent = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0284c7',
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '🚗 สถานะยานพาหนะ', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: 'รายการรถยนต์ทั้งหมดในระบบ', color: '#e0f2fe', size: 'xs', margin: 'xs' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '20px',
      contents: [
        { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows },
        ...(vehicles.length > 10
          ? [
              {
                type: 'text',
                text: `* แสดง 10 คันแรก จากทั้งหมด ${vehicles.length} คัน`,
                size: 'xxs',
                color: '#64748b',
                margin: 'md',
                style: 'italic',
              },
            ]
          : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      backgroundColor: '#f1f5f9',
      contents: [{ type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center' }],
    },
  };
  await replyLineFlex(replyToken, '🚗 สรุปสถานะรถยนต์', flexContent);
}

async function handleEquipmentStock(replyToken) {
  try {
    const equipment = await safeGet(getEquipment);
    if (equipment.length === 0) {
      const flexContent = simpleErrorBubble('#ef4444', '💻 คลังอุปกรณ์', '❌ ไม่พบข้อมูลอุปกรณ์ในคลัง');
      await replyLineFlex(replyToken, '💻 ไม่พบข้อมูลอุปกรณ์ในคลัง', flexContent);
      return;
    }

    const rows = equipment.slice(0, 10).map((eq, idx) => {
      const name = safeTruncate(eq['ชื่ออุปกรณ์'] || eq['รหัส'], 25, 'อุปกรณ์');
      const category = safeTruncate(eq['หมวดหมู่'], 15, 'ทั่วไป');
      const qty = parseFloat(eq['จำนวน']) || 0;
      const unit = safeTruncate(eq['หน่วยนับ'], 8, 'รายการ');
      return {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        margin: idx === 0 ? 'none' : 'sm',
        alignItems: 'center',
        contents: [
          { type: 'text', text: '📦', flex: 1, size: 'sm' },
          {
            type: 'box',
            layout: 'vertical',
            flex: 6,
            contents: [
              { type: 'text', text: name, size: 'sm', weight: 'bold', color: '#0f172a' },
              { type: 'text', text: category, size: 'xxs', color: '#64748b' },
            ],
          },
          { type: 'text', text: String(qty) + ' ' + String(unit), size: 'sm', color: qty > 0 ? '#0f172a' : '#ef4444', align: 'end', flex: 4, weight: 'bold' },
        ],
      };
    });

    const flexContent = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0d9488',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '💻 คลังอุปกรณ์คงเหลือ', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'รายการพัสดุและอุปกรณ์ที่พร้อมให้ยืม', color: '#ccfbf1', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
        contents: [
          { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows },
          ...(equipment.length > 10
            ? [
                {
                  type: 'text',
                  text: `* แสดง 10 รายการแรก จากทั้งหมด ${equipment.length} รายการ`,
                  size: 'xxs',
                  color: '#64748b',
                  margin: 'md',
                  style: 'italic',
                },
              ]
            : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        backgroundColor: '#f1f5f9',
        contents: [{ type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center' }],
      },
    };
    await replyLineFlex(replyToken, '💻 สรุปคลังอุปกรณ์คงเหลือ', flexContent);
  } catch (err) {
    console.error('handleEquipmentStock error:', err);
    const flexContent = simpleErrorBubble('#ef4444', '💻 คลังอุปกรณ์', 'เกิดข้อผิดพลาดในการดึงข้อมูลอุปกรณ์: ' + (err.message || err));
    await replyLineFlex(replyToken, '❌ เกิดข้อผิดพลาด', flexContent);
  }
}

async function handleBorrowingList(replyToken) {
  const borrowing = await safeGet(getBorrowing);
  if (borrowing.length === 0) {
    const flexContent = simpleErrorBubble('#ef4444', '📋 รายการคำขอยืม', '📋 ไม่พบข้อมูลคำขอยืมในระบบ');
    await replyLineFlex(replyToken, '📋 ไม่พบข้อมูลคำขอยืมในระบบ', flexContent);
    return;
  }

  const statusColors = {
    'รอรับเรื่อง': '#f59e0b',
    'รับเรื่องแล้ว': '#3b82f6',
    'อยู่ในระหว่างการยืม': '#8b5cf6',
    'คืนเสร็จสิ้น': '#10b981',
    'ยกเลิก': '#6b7280',
  };

  const rows = borrowing.slice(0, 5).map((b, idx) => {
    const id = safeTruncate(b['รหัส'] || '-', 25);
    const eqName = safeTruncate(b['ชื่ออุปกรณ์'] || '-', 25);
    const borrower = safeTruncate(b['ผู้ขอยืม'] || '-', 15);
    const status = b['สถานะ'] || '-';
    const qty = b['จำนวน'] || 1;
    const color = statusColors[status] || '#3b82f6';

    return {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#f8fafc',
      cornerRadius: '8px',
      paddingAll: '12px',
      margin: idx === 0 ? 'none' : 'sm',
      borderWidth: '1px',
      borderColor: '#e2e8f0',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: id, size: 'xs', weight: 'bold', color: '#1e40af' },
            { type: 'text', text: status, size: 'xs', color: color, align: 'end', weight: 'bold' },
          ],
        },
        { type: 'text', text: eqName + ' × ' + qty, size: 'sm', weight: 'bold', color: '#0f172a', margin: 'xs' },
        { type: 'text', text: '👤 ผู้ยืม: ' + borrower, size: 'xs', color: '#64748b', margin: 'xs' },
      ],
    };
  });

  const flexContent = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#4f46e5',
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '📋 คำขอยืมล่าสุด', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: 'รายการที่มีความเคลื่อนไหวล่าสุดในระบบ', color: '#e0e7ff', size: 'xs', margin: 'xs' },
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px', contents: rows },
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
          color: '#4f46e5',
          height: 'sm',
          action: { type: 'uri', label: '📦 ทำรายการยืมอุปกรณ์ (LIFF)', uri: 'https://liff.line.me/2011083425-G0pup6PQ' },
        },
        {
          type: 'button',
          style: 'primary',
          color: '#06b6d4',
          height: 'sm',
          action: { type: 'uri', label: '🔄 แจ้งคืนอุปกรณ์ (LIFF)', uri: 'https://liff.line.me/2011083425-G0pup6PQ?tab=return' },
        },
        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: { type: 'message', label: '💻 ดูรายการอุปกรณ์ที่ยืมได้', text: 'เช็คอุปกรณ์' },
        },
        { type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' },
      ],
    },
  };
  await replyLineFlex(replyToken, '📋 คำขอยืมล่าสุด', flexContent);
}

const BORROWING_STATUS_MAP = {
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

async function handleCodeLookup(replyToken, userMessage) {
  const q = userMessage.toUpperCase();
  if (q.indexOf('BR-') === 0) {
    const borrowing = await safeGet(getBorrowing);
    const found = borrowing.find((b) => String(b['รหัส'] || '').toUpperCase() === q);
    if (found) {
      const id = safeTruncate(found['รหัส'] || '-', 25);
      const eqName = safeTruncate(found['ชื่ออุปกรณ์'] || '-', 40);
      const qty = found['จำนวน'] || 1;
      const borrower = safeTruncate(found['ผู้ขอยืม'] || '-', 30);
      const dept = safeTruncate(found['หน่วยงาน'] || '-', 30);
      const dateBorrow = safeTruncate(found['วันที่ขอยืม'] || '-', 20);
      const dateReturn = safeTruncate(found['วันที่ครบกำหนด'] || '-', 20);
      const status = found['สถานะ'] || '-';
      const purpose = safeTruncate(found['วัตถุประสงค์'] || '-', 50);

      const meta = BORROWING_STATUS_MAP[status] || { color: '#3b82f6', icon: '📦', desc: status };

      const footerButtons = [
        {
          type: 'button',
          style: 'primary',
          color: '#1e40af',
          height: 'sm',
          action: { type: 'uri', label: '🌐 เปิดดูในระบบ', uri: 'https://vmes.web.app/#borrowing' },
        },
      ];

      if (status === 'รอรับเรื่อง') {
        footerButtons.unshift({
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: { type: 'message', label: '✅ รับเรื่องคำขอนี้ (เจ้าหน้าที่)', text: 'รับเรื่อง ' + id },
        });
      } else if (status === 'รับเรื่องแล้ว') {
        footerButtons.unshift({
          type: 'button',
          style: 'primary',
          color: '#8b5cf6',
          height: 'sm',
          action: { type: 'message', label: '📦 ส่งมอบอุปกรณ์แล้ว (เจ้าหน้าที่)', text: 'ส่งมอบ ' + id },
        });
      } else if (status === 'อยู่ในระหว่างการยืม' || status === 'ถึงวันครบกำหนดคืน') {
        footerButtons.unshift({
          type: 'button',
          style: 'primary',
          color: '#06b6d4',
          height: 'sm',
          action: { type: 'message', label: '🔄 แจ้งคืนอุปกรณ์นี้', text: 'คืน ' + id },
        });
        footerButtons.unshift({
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: { type: 'message', label: '⏳ ขอขยายเวลาคืน', text: 'ขอขยายเวลา ' + id },
        });
      } else if (status === 'อยู่ในระหว่างการคืน') {
        footerButtons.unshift({
          type: 'button',
          style: 'primary',
          color: '#10b981',
          height: 'sm',
          action: { type: 'message', label: '✅ ยืนยันรับคืนอุปกรณ์ (เจ้าหน้าที่)', text: 'ยืนยันคืน ' + id },
        });
      }

      const flexContent = {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: meta.color,
          paddingAll: '20px',
          contents: [
            { type: 'text', text: meta.icon + ' รายละเอียดคำขอยืม', color: '#ffffff', size: 'lg', weight: 'bold' },
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
                { type: 'text', text: eqName, size: 'md', weight: 'bold', color: '#0f172a', wrap: true },
                { type: 'text', text: 'จำนวน ' + qty + ' รายการ', size: 'sm', color: '#64748b', margin: 'xs' },
              ],
            },
            { type: 'separator', margin: 'md' },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                flexRow('🆔 เลขคำขอ', id),
                flexRow('👤 ผู้ขอยืม', borrower),
                flexRow('🏢 หน่วยงาน', dept),
                flexRow('📅 วันที่ยืม', dateBorrow),
                flexRow('📅 ครบกำหนดคืน', dateReturn),
                flexRow('🎯 วัตถุประสงค์', purpose),
                flexRow('📌 สถานะ', status),
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
                  url: 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(id),
                  size: 'md',
                  aspectRatio: '1:1',
                },
                { type: 'text', text: 'QR Code คำขอยืม: ' + id, size: 'xxs', color: '#94a3b8', margin: 'xs', align: 'center' },
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
      await replyLineFlex(replyToken, '📋 รายละเอียดคำขอยืม ' + id, flexContent);
    } else {
      const flexContent = simpleErrorBubble('#ef4444', '❌ ไม่พบข้อมูลคำขอ', 'ไม่พบข้อมูลคำขอยืมรหัส ' + safeTruncate(q, 20) + ' ในระบบ');
      await replyLineFlex(replyToken, '❌ ไม่พบคำขอยืมรหัส ' + safeTruncate(q, 20), flexContent);
    }
  } else {
    const equipment = await safeGet(getEquipment);
    const found = equipment.find((e) => String(e['รหัส'] || '').toUpperCase() === q);
    if (found) {
      const id = safeTruncate(found['รหัส'] || '-', 25);
      const eqName = safeTruncate(found['ชื่ออุปกรณ์'] || '-', 40);
      const category = safeTruncate(found['หมวดหมู่'] || '-', 30);
      const brand = safeTruncate(found['ยี่ห้อ'] || '-', 30);
      const model = safeTruncate(found['รุ่น'] || '-', 30);
      const status = safeTruncate(found['สถานะ'] || '-', 30);
      const storage = safeTruncate(found['ที่เก็บ'] || '-', 30);

      const flexContent = {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#0ea5e9',
          paddingAll: '20px',
          contents: [
            { type: 'text', text: '💻 รายละเอียดอุปกรณ์', color: '#ffffff', size: 'lg', weight: 'bold' },
            { type: 'text', text: 'ข้อมูลรายละเอียดของพัสดุ/อุปกรณ์ในคลัง', color: '#dbeafe', size: 'xs', margin: 'xs' },
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
                { type: 'text', text: 'ชื่ออุปกรณ์', size: 'xs', color: '#64748b' },
                { type: 'text', text: eqName, size: 'md', weight: 'bold', color: '#0f172a', wrap: true },
              ],
            },
            { type: 'separator', margin: 'md' },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                flexRow('🆔 รหัสอุปกรณ์', id),
                flexRow('📦 หมวดหมู่', category),
                flexRow('🏷️ ยี่ห้อ/รุ่น', brand + ' ' + model),
                flexRow('📍 ที่เก็บ', storage),
                flexRow('📌 สถานะ', status),
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
                  url: 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent('https://liff.line.me/2011083425-G0pup6PQ?code=' + id),
                  size: 'md',
                  aspectRatio: '1:1',
                },
                { type: 'text', text: 'สแกน QR Code เพื่อยืมอุปกรณ์ ' + id, size: 'xxs', color: '#94a3b8', margin: 'xs', align: 'center' },
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
              color: '#4f46e5',
              height: 'sm',
              action: { type: 'uri', label: '📦 ทำรายการยืมอุปกรณ์นี้ (LIFF)', uri: 'https://liff.line.me/2011083425-G0pup6PQ?code=' + id },
            },
            { type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' },
          ],
        },
      };
      await replyLineFlex(replyToken, '💻 รายละเอียดอุปกรณ์ ' + id, flexContent);
    } else {
      const flexContent = simpleErrorBubble('#ef4444', '❌ ไม่พบข้อมูลอุปกรณ์', 'ไม่พบอุปกรณ์รหัส ' + safeTruncate(q, 20) + ' ในระบบ');
      await replyLineFlex(replyToken, '❌ ไม่พบอุปกรณ์รหัส ' + safeTruncate(q, 20), flexContent);
    }
  }
}

// กิ่งที่ 6: เมนูช่วยเหลือ — แก้บั๊กปุ่ม 4 ปุ่ม (ยืนยันแล้วตามแผน): ข้อความที่ส่งจริง
// เมื่อกดปุ่ม (action.text) เดิมไม่ตรงกับ trigger substring ของแต่ละกิ่ง (เช่นปุ่มแรกส่ง
// "เช็คสถานะรถยนต์" ซึ่งไม่มีคำว่า "เช็ครถ" อยู่เป็น substring ต่อเนื่อง จึงตกไปเข้ากิ่ง
// เมนูช่วยเหลือซ้ำแทนที่จะเข้ากิ่งเช็คสถานะรถ) — แก้เป็นข้อความที่ตรง trigger แน่นอน
// คงป้ายกำกับ (label) ที่มองเห็นให้ใกล้เคียงข้อความเดิมไว้ เปลี่ยนเฉพาะ text ที่ส่งจริง
async function handleHelpMenu(replyToken) {
  const flexContent = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#334155',
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '🤖 เมนูช่วยเหลือ (Help Menu)', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: 'ระบบบริหารยานพาหนะและยืม-คืนอุปกรณ์', color: '#cbd5e1', size: 'xs', margin: 'xs' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '20px',
      contents: [
        {
          type: 'text',
          text: 'ยินดีต้อนรับสู่ระบบช่วยอำนวยความสะดวกผ่าน LINE Bot คุณสามารถพิมพ์ข้อความ หรือกดปุ่มด้านล่างเพื่อทำรายการได้ทันที:',
          size: 'sm',
          color: '#475569',
          wrap: true,
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#4f46e5',
              height: 'sm',
              action: { type: 'uri', label: '📦 ทำรายการยืมอุปกรณ์ (LIFF)', uri: 'https://liff.line.me/2011083425-G0pup6PQ' },
            },
            {
              type: 'button',
              style: 'primary',
              color: '#06b6d4',
              height: 'sm',
              action: { type: 'uri', label: '🔄 แจ้งคืนอุปกรณ์ (LIFF)', uri: 'https://liff.line.me/2011083425-G0pup6PQ?tab=return' },
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: { type: 'message', label: '🚗 เช็คสถานะรถยนต์', text: 'เช็ครถ' },
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: { type: 'message', label: '💻 เช็คอุปกรณ์ในคลัง', text: 'เช็คอุปกรณ์' },
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: { type: 'message', label: '📋 เช็ครายการคำขอยืม', text: 'เช็คคำขอ' },
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: { type: 'message', label: '🆔 ขอ LINE User ID', text: 'ขอไอดี' },
            },
          ],
        },
        {
          type: 'text',
          text: '💡 หรือระบุรหัสรายการ เช่น BR-xxx หรือ EQ-xxx เพื่อดูรายละเอียดสินค้าหรือรายการยืมได้โดยตรง',
          size: 'xs',
          color: '#64748b',
          wrap: true,
          margin: 'sm',
          style: 'italic',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      backgroundColor: '#f1f5f9',
      contents: [{ type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center' }],
    },
  };
  await replyLineFlex(replyToken, '🤖 เมนูช่วยเหลือระบบ VMES', flexContent);
}

// ============== รายการของฉัน ==============
// แสดงรายการยืมที่ผูกกับ LINE User ID ของผู้ส่งข้อความโดยตรง — ดึงจาก field LINE_USER_ID
// ที่บันทึกไว้ตอนยืมผ่าน LIFF ใช้ getMyActiveBorrowings() ที่มีอยู่แล้ว
async function handleMyBorrowings(replyToken, userId) {
  const myList = await getMyActiveBorrowings(userId);

  if (!myList || myList.length === 0) {
    // ตรวจว่าผู้ใช้เคยผูกบัญชีหรือยัง
    const flexContent = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#4f46e5',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '📋 รายการของฉัน', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'รายการอุปกรณ์ที่คุณกำลังยืมอยู่', color: '#e0e7ff', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#f8fafc',
            cornerRadius: '12px',
            paddingAll: '16px',
            contents: [
              { type: 'text', text: '✅ ไม่มีรายการยืมที่ค้างอยู่', size: 'md', weight: 'bold', color: '#10b981', align: 'center' },
              { type: 'text', text: 'คุณไม่มีรายการอุปกรณ์ที่กำลังยืมอยู่ในขณะนี้', size: 'sm', color: '#64748b', align: 'center', margin: 'sm', wrap: true },
            ],
          },
          {
            type: 'text',
            text: '💡 หากคุณเพิ่งยืมและไม่เห็นรายการ อาจเป็นเพราะบัญชี LINE ยังไม่ได้ผูกกับระบบ กรุณาผูกบัญชีก่อน',
            size: 'xs',
            color: '#94a3b8',
            wrap: true,
            margin: 'sm',
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
            color: '#4f46e5',
            height: 'sm',
            action: { type: 'uri', label: '📦 ยืมอุปกรณ์ใหม่ (LIFF)', uri: 'https://liff.line.me/2011083425-G0pup6PQ' },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: { type: 'message', label: '🆔 ผูกบัญชี LINE', text: 'ขอไอดี' },
          },
          { type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' },
        ],
      },
    };
    await replyLineFlex(replyToken, '📋 ไม่มีรายการยืมค้างอยู่', flexContent);
    return;
  }

  const statusColors = {
    'รอรับเรื่อง': '#f59e0b',
    'รับเรื่องแล้ว': '#3b82f6',
    'อยู่ในระหว่างการยืม': '#8b5cf6',
    'ถึงวันครบกำหนดคืน': '#ef4444',
    'อยู่ในระหว่างการคืน': '#06b6d4',
    'ขอขยายเวลา': '#d97706',
  };

  const statusIcons = {
    'รอรับเรื่อง': '📥',
    'รับเรื่องแล้ว': '✅',
    'อยู่ในระหว่างการยืม': '📦',
    'ถึงวันครบกำหนดคืน': '⏰',
    'อยู่ในระหว่างการคืน': '🔄',
    'ขอขยายเวลา': '⏳',
  };

  // แสดงสูงสุด 5 รายการ (LINE Flex มีขีดจำกัดความสูง)
  const displayList = myList.slice(0, 5);

  const rows = displayList.map((b, idx) => {
    const id = safeTruncate(b['รหัส'] || '-', 25);
    const eqName = safeTruncate(
      Array.isArray(b['รายการอุปกรณ์']) && b['รายการอุปกรณ์'].length > 0
        ? b['รายการอุปกรณ์'].map(i => i['ชื่ออุปกรณ์']).join(', ')
        : (b['ชื่ออุปกรณ์'] || '-'),
      40
    );
    const status = b['สถานะ'] || '-';
    const dueDate = safeTruncate(b['วันที่ครบกำหนด'] || '-', 20);
    const qty = b['จำนวน'] || 1;
    const color = statusColors[status] || '#3b82f6';
    const icon = statusIcons[status] || '📋';
    const canReturn = ['อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน', 'ขอขยายเวลา'].includes(status);

    const cardContents = [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: id, size: 'xs', weight: 'bold', color: '#1e40af', flex: 7 },
          {
            type: 'box',
            layout: 'horizontal',
            backgroundColor: color,
            cornerRadius: '8px',
            paddingStart: '6px',
            paddingEnd: '6px',
            paddingTop: '3px',
            paddingBottom: '3px',
            flex: 5,
            justifyContent: 'flex-end',
            contents: [
              { type: 'text', text: icon + ' ' + status, size: 'xxs', color: '#ffffff', align: 'end', weight: 'bold', wrap: false },
            ],
          },
        ],
      },
      { type: 'text', text: eqName, size: 'sm', weight: 'bold', color: '#0f172a', margin: 'xs', wrap: true },
      { type: 'text', text: '📦 จำนวน: ' + qty + ' รายการ  |  📅 ครบกำหนด: ' + dueDate, size: 'xxs', color: '#64748b', margin: 'xs', wrap: true },
    ];

    if (canReturn) {
      cardContents.push({
        type: 'button',
        style: 'primary',
        color: '#06b6d4',
        height: 'sm',
        margin: 'sm',
        action: { type: 'message', label: '🔄 แจ้งคืน ' + id, text: 'คืน ' + id },
      });
    } else if (status === 'รอรับเรื่อง' || status === 'รับเรื่องแล้ว') {
      cardContents.push({
        type: 'text',
        text: '⏳ กำลังรอเจ้าหน้าที่ดำเนินการ',
        size: 'xs',
        color: '#94a3b8',
        margin: 'sm',
        align: 'center',
      });
    } else if (status === 'อยู่ในระหว่างการคืน') {
      cardContents.push({
        type: 'text',
        text: '✅ แจ้งคืนแล้ว รอเจ้าหน้าที่ตรวจรับ',
        size: 'xs',
        color: '#06b6d4',
        margin: 'sm',
        align: 'center',
      });
    }

    return {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#f8fafc',
      cornerRadius: '10px',
      paddingAll: '14px',
      margin: idx === 0 ? 'none' : 'md',
      borderWidth: '1px',
      borderColor: color,
      contents: cardContents,
    };
  });

  const summaryText = myList.length > 5
    ? `* แสดง 5 รายการแรก จากทั้งหมด ${myList.length} รายการ`
    : `รวม ${myList.length} รายการที่กำลังยืมอยู่`;

  const flexContent = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#4f46e5',
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '📋 รายการของฉัน', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: summaryText, color: '#e0e7ff', size: 'xs', margin: 'xs' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'none',
      paddingAll: '16px',
      contents: rows,
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
          color: '#4f46e5',
          height: 'sm',
          action: { type: 'uri', label: '📦 ยืมอุปกรณ์เพิ่มเติม (LIFF)', uri: 'https://liff.line.me/2011083425-G0pup6PQ' },
        },
        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: { type: 'uri', label: '🌐 ดูในระบบ (vmes.web.app)', uri: 'https://vmes.web.app/#borrowing' },
        },
        { type: 'text', text: '⏱ ' + nowStr() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' },
      ],
    },
  };
  await replyLineFlex(replyToken, '📋 รายการของฉัน (' + myList.length + ' รายการ)', flexContent);
}

// การ์ดปุ่มเดียวสำหรับคนพิมพ์ "คืนอุปกรณ์"/"คืน"/"แจ้งคืน" มาเฉยๆ โดยไม่มีรหัสคำขอ — ต่างจาก
// handleHelpMenu ที่มีหลายปุ่มรวมกัน การ์ดนี้โฟกัสแค่การคืนอย่างเดียวตามที่ user ขอ กดแล้ว
// ไปเปิดแท็บคืนใน LIFF ตรงๆ ซึ่งจะแสดงรายการที่ยืมอยู่ให้เลือกแจ้งคืน ไม่ต้องรู้รหัสเอง
async function handleReturnMenu(replyToken) {
  const flexContent = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#06b6d4',
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '🔄 แจ้งคืนอุปกรณ์', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: 'ดูรายการที่กำลังยืมอยู่และแจ้งคืนได้ทันที', color: '#ecfeff', size: 'xs', margin: 'xs' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '20px',
      contents: [
        {
          type: 'text',
          text: 'กดปุ่มด้านล่างเพื่อเปิดหน้าคืนอุปกรณ์ ระบบจะแสดงรายการที่คุณกำลังยืมอยู่ทั้งหมดให้เลือกแจ้งคืนได้เลย ไม่ต้องจำรหัสคำขอ',
          size: 'sm',
          color: '#475569',
          wrap: true,
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      backgroundColor: '#f1f5f9',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#06b6d4',
          height: 'sm',
          action: { type: 'uri', label: '🔄 คืนอุปกรณ์', uri: 'https://liff.line.me/2011083425-G0pup6PQ?tab=return' },
        },
      ],
    },
  };
  await replyLineFlex(replyToken, '🔄 แจ้งคืนอุปกรณ์', flexContent);
}

// ============== STAFF ACTIONS: รับเรื่อง / ส่งมอบ ==============
// ต่างจากการคืน (ที่ผู้ยืมเองกดแจ้งคืนของตัวเองได้) สองแอ็กชันนี้เป็นสิทธิ์เฉพาะเจ้าหน้าที่
// เท่านั้น — เช็คจาก LINE userId ของคนที่กดปุ่มจริง (ปลอมไม่ได้ เพราะ LINE ส่ง source.userId
// มาเองในทุก event) ว่าผูกกับบัญชีผู้ใช้ในระบบหรือไม่ ถ้าไม่เคยผูกบัญชีเลยก็ปฏิเสธทันที ถ้าผูก
// แล้วส่งชื่อจริงต่อให้ updateBorrowingStatus() เช็คบทบาทเจ้าหน้าที่ซ้ำอีกชั้นหนึ่งตามปกติ
async function handleBorrowingStaffAction(replyToken, userId, userMessage, targetStatus, actionLabel, noCodeHint, condition) {
  const match = userMessage.match(/BR-[A-Z0-9-]+/i);
  if (!match) {
    const flexContent = simpleErrorBubble('#ef4444', '❌ ไม่ระบุรหัสคำขอ', noCodeHint);
    await replyLineFlex(replyToken, '❌ ไม่ระบุรหัสคำขอ', flexContent);
    return;
  }
  const code = match[0].toUpperCase();

  const staffName = await getUserNameByLineId(userId);
  if (!staffName) {
    const flexContent = simpleErrorBubble(
      '#ef4444',
      '🚫 ไม่มีสิทธิ์ดำเนินการ',
      `บัญชี LINE นี้ยังไม่ได้ผูกกับบัญชีผู้ใช้ในระบบ เฉพาะเจ้าหน้าที่ที่ผูกบัญชีแล้วเท่านั้นจึงจะ${actionLabel}ได้ กรุณาติดต่อผู้ดูแลระบบ`
    );
    await replyLineFlex(replyToken, '🚫 ไม่มีสิทธิ์', flexContent);
    return;
  }

  const res = await updateBorrowingStatus(code, targetStatus, staffName, staffName, condition);
  if (res.success) {
    const meta = BORROWING_STATUS_MAP[targetStatus] || { color: '#3b82f6', icon: '✅', desc: targetStatus };
    const flexContent = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: meta.color,
        paddingAll: '20px',
        contents: [
          { type: 'text', text: meta.icon + ' ' + actionLabel + 'สำเร็จ', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'รหัสคำขอ: ' + code, color: '#ffffff', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: `${actionLabel}คำขอ ${code} เรียบร้อยแล้ว โดย ${staffName}`, size: 'sm', color: '#0f172a', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        backgroundColor: '#f1f5f9',
        contents: [{ type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center' }],
      },
    };
    await replyLineFlex(replyToken, actionLabel + 'สำเร็จ ' + code, flexContent);
  } else {
    const flexContent = simpleErrorBubble('#ef4444', '❌ ไม่สามารถ' + actionLabel + 'ได้', res.message || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
    await replyLineFlex(replyToken, '❌ ไม่สามารถ' + actionLabel + 'ได้', flexContent);
  }
}

async function handleAcceptBorrowing(replyToken, userId, userMessage) {
  await handleBorrowingStaffAction(
    replyToken, userId, userMessage, 'รับเรื่องแล้ว', 'รับเรื่อง',
    'กรุณาระบุรหัสคำขอที่ต้องการรับเรื่อง เช่น "รับเรื่อง BR-20260812-001"'
  );
}

async function handleHandoverBorrowing(replyToken, userId, userMessage) {
  await handleBorrowingStaffAction(
    replyToken, userId, userMessage, 'อยู่ในระหว่างการยืม', 'ส่งมอบ',
    'กรุณาระบุรหัสคำขอที่ต้องการส่งมอบ เช่น "ส่งมอบ BR-20260812-001"'
  );
}

// ขั้นสุดท้ายของวงจร: ผู้ยืมกดแจ้งคืนผ่าน LIFF/แชทแล้ว (สถานะ "อยู่ในระหว่างการคืน")
// เจ้าหน้าที่ต้องตรวจรับของจริงก่อนปิดงานเป็น "คืนเสร็จสิ้น" — ค่าเริ่มต้นถือว่าสภาพปกติ
// ถ้าของชำรุดให้ใช้คำสั่ง "ยืนยันคืนชำรุด BR-xxx" แทน ระบบจะปรับสถานะอุปกรณ์ชิ้นนั้นเป็น
// ชำรุดให้อัตโนมัติ (ดู markEquipmentDamaged ใน updateBorrowingStatus)
async function handleConfirmReturn(replyToken, userId, userMessage) {
  await handleBorrowingStaffAction(
    replyToken, userId, userMessage, 'คืนเสร็จสิ้น', 'ยืนยันรับคืน',
    'กรุณาระบุรหัสคำขอที่ต้องการยืนยันรับคืน เช่น "ยืนยันคืน BR-20260812-001"',
    'ปกติ'
  );
}

async function handleConfirmReturnDamaged(replyToken, userId, userMessage) {
  await handleBorrowingStaffAction(
    replyToken, userId, userMessage, 'คืนเสร็จสิ้น', 'ยืนยันรับคืน (ชำรุด)',
    'กรุณาระบุรหัสคำขอที่ต้องการยืนยันรับคืนแบบชำรุด เช่น "ยืนยันคืนชำรุด BR-20260812-001"',
    'ชำรุดบางส่วน'
  );
}

async function handleReturnBorrowing(replyToken, userMessage) {
  const match = userMessage.match(/BR-[A-Z0-9-]+/i);
  if (!match) {
    const flexContent = simpleErrorBubble('#ef4444', '❌ ไม่ระบุรหัสคำขอ', 'กรุณาระบุรหัสคำขอที่ต้องการคืน เช่น "คืน BR-20260812-001"');
    await replyLineFlex(replyToken, '❌ ไม่ระบุรหัสคำขอ', flexContent);
    return;
  }
  const code = match[0].toUpperCase();
  const res = await updateBorrowingStatus(code, 'อยู่ในระหว่างการคืน', null, 'system');
  if (res.success) {
    const flexContent = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#06b6d4',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '🔄 แจ้งคืนอุปกรณ์เรียบร้อย', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'รหัสคำขอ: ' + code, color: '#ecfeff', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '✅ ระบบได้บันทึกการแจ้งคืนอุปกรณ์คำขอ ' + code + ' เรียบร้อยแล้ว', size: 'sm', color: '#0f172a', wrap: true },
          { type: 'text', text: 'เจ้าหน้าที่จะทำการตรวจรับอุปกรณ์และอัปเดตสถานะเป็น "คืนเสร็จสิ้น" ต่อไปครับ', size: 'xs', color: '#64748b', margin: 'md', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        backgroundColor: '#f1f5f9',
        contents: [{ type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center' }],
      },
    };
    await replyLineFlex(replyToken, '🔄 แจ้งคืนอุปกรณ์ ' + code + ' เรียบร้อย', flexContent);
  } else {
    const flexContent = simpleErrorBubble('#ef4444', '❌ ไม่สามารถคืนอุปกรณ์ได้', res.message || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
    await replyLineFlex(replyToken, '❌ ไม่สามารถคืนอุปกรณ์ได้', flexContent);
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (req.body === undefined || req.body === null || req.body === '') {
    const raw = await readRawBody(req);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return {};
    }
  }
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8'));
    } catch (e) {
      return {};
    }
  }
  return req.body;
}

module.exports = async function handler(req, res) {
  try {
    const body = await parseBody(req);
    const events = body.events;

    if (!events || !Array.isArray(events) || events.length === 0) {
      res.status(200).send('OK');
      return;
    }

    for (const event of events) {
      if (!event.message || event.message.type !== 'text') {
        continue;
      }

      const replyToken = event.replyToken;
      const userId = event.source ? event.source.userId : '';
      const userMessage = String(event.message.text || '').trim();

      if (!replyToken) continue;

      const msgLower = userMessage.toLowerCase();

      // 0. รายการของฉัน — ต้องอยู่ก่อน กิ่งที่มีคำว่า "ยืม" เพราะ trigger นี้ไม่มีคำนั้น
      if (msgLower === 'รายการของฉัน' || msgLower.indexOf('รายการของฉัน') !== -1) {
        await handleMyBorrowings(replyToken, userId);
      }
      // 1. ขอไอดี
      else if (msgLower === 'ขอไอดี' || msgLower === 'id' || msgLower === 'user id') {
        await handleAskId(replyToken, userId);
      }
      // 1.5 ผูกบัญชีอัตโนมัติด้วยเลขบัตรประชาชน 13 หลัก (ไม่ต้องคัดลอก LINE User ID)
      // รหัส BR-/EQ- มีไทม์สแตมป์ 14 หลักฝังอยู่เสมอ (เช่น BR-20261014220308-458) ซึ่งมี
      // เลข 13 หลักติดกันอยู่ในนั้นพอดี — ถ้าไม่กันไว้ ทุกข้อความที่มีรหัส BR-/EQ- (รวมถึง
      // "รับเรื่อง BR-...", "ส่งมอบ BR-...", "คืน BR-..." ด้านล่างทั้งหมด) จะโดนกิ่งนี้ตัดหน้า
      // ไปตีความเป็นเลขบัตรประชาชนผิดๆ ก่อนเสมอ ไม่มีทางไปถึงกิ่งที่ตั้งใจจะเข้าเลย
      else if (/\d{13}/.test(userMessage) && msgLower.indexOf('br-') === -1 && msgLower.indexOf('eq-') === -1) {
        await handleAutoBind13Digit(replyToken, userId, userMessage);
      }
      // 1.6 รับเรื่องคำขอยืม (เฉพาะเจ้าหน้าที่ — เช็คสิทธิ์จาก LINE userId ข้างใน handler)
      else if (msgLower.indexOf('รับเรื่อง br-') !== -1) {
        await handleAcceptBorrowing(replyToken, userId, userMessage);
      }
      // 1.7 ส่งมอบอุปกรณ์ (เฉพาะเจ้าหน้าที่ — เช็คสิทธิ์จาก LINE userId ข้างใน handler)
      else if (msgLower.indexOf('ส่งมอบ br-') !== -1) {
        await handleHandoverBorrowing(replyToken, userId, userMessage);
      }
      // 1.8/1.9 ยืนยันรับคืน (เฉพาะเจ้าหน้าที่) — ต้องเช็คก่อนกิ่ง "คืน br-" ด้านล่างเสมอ เพราะ
      // "ยืนยันคืน br-..." เองก็มีคำว่า "คืน br-" เป็น substring อยู่ในตัว ถ้าสลับลำดับจะถูก
      // กิ่งแจ้งคืน (ของผู้ยืม) ตัดหน้าไปก่อน ไม่มีทางมาถึงกิ่งนี้เลย
      else if (msgLower.indexOf('ยืนยันคืนชำรุด br-') !== -1) {
        await handleConfirmReturnDamaged(replyToken, userId, userMessage);
      }
      else if (msgLower.indexOf('ยืนยันคืน br-') !== -1) {
        await handleConfirmReturn(replyToken, userId, userMessage);
      }
      // 2. แจ้งคืนอุปกรณ์ (ระบุรหัสคำขอมาด้วย)
      else if (msgLower.indexOf('คืน br-') !== -1 || msgLower.indexOf('แจ้งคืน br-') !== -1) {
        await handleReturnBorrowing(replyToken, userMessage);
      }
      // 2.5 เมนูคืนอุปกรณ์ (ไม่ได้ระบุรหัสมาด้วย) — การ์ดปุ่มเดียวลิงก์ตรงไปแท็บคืนใน LIFF
      // ไม่ต้องให้ผู้ใช้จำ/พิมพ์รหัสคำขอเอง
      else if (msgLower.indexOf('คืนอุปกรณ์') !== -1 || msgLower === 'คืน' || msgLower.indexOf('แจ้งคืน') !== -1) {
        await handleReturnMenu(replyToken);
      }
      // 3. เช็ครถยนต์
      else if (msgLower.indexOf('เช็ครถ') !== -1 || msgLower === 'รถ' || msgLower === 'รถยนต์') {
        await handleVehicleStatus(replyToken);
      }
      // 4. เช็คอุปกรณ์คงเหลือ
      else if (msgLower.indexOf('เช็คอุปกรณ์') !== -1 || msgLower === 'อุปกรณ์' || msgLower.indexOf('คลัง') !== -1) {
        await handleEquipmentStock(replyToken);
      }
      // 5. เช็คคำขอยืม
      else if (msgLower.indexOf('คำขอ') !== -1 || msgLower.indexOf('ยืม') !== -1) {
        await handleBorrowingList(replyToken);
      }
      // 6. ค้นหารหัส BR- / EQ-
      else if (userMessage.toUpperCase().indexOf('BR-') === 0 || userMessage.toUpperCase().indexOf('EQ-') === 0) {
        await handleCodeLookup(replyToken, userMessage);
      }
      // 7. เมนูช่วยเหลือ
      else {
        await handleHelpMenu(replyToken);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('line-webhook handler error:', err);
    res.status(200).send('OK');
  }
};
