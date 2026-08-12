// ============== LINE WEBHOOK ==============
// เทียบเท่า doPost's LINE branch เดิม (รหัส.js L221-953) — พอร์ต 6 กิ่งคำสั่งแบบ 1:1
// (Flex JSON สี/ข้อความ/ปุ่ม/เงื่อนไขตรงต้นฉบับทุกจุด) ยกเว้นบั๊กปุ่มเมนูช่วยเหลือ 4 ปุ่ม
// ที่แก้ตามที่ยืนยันแล้ว (ดูกิ่งที่ 6 ด้านล่าง)

const { SYSTEM_NAME, safeTruncate, safeGet, nowStr } = require('../lib/util');
const { replyLineFlex, flexRow } = require('../lib/line');
const { getVehicles } = require('../lib/handlers/vehicles');
const { getEquipment } = require('../lib/handlers/equipment');
const { getBorrowing, updateBorrowingStatus } = require('../lib/handlers/borrowing');

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
        { type: 'text', text: '🆔 LINE User ID', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: 'รหัสประจำตัวของคุณในระบบ LINE', color: '#bfdbfe', size: 'xs', margin: 'xs' },
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
          cornerRadius: '8px',
          paddingAll: '16px',
          borderWidth: '1px',
          borderColor: '#e2e8f0',
          contents: [
            { type: 'text', text: 'LINE User ID', size: 'xs', color: '#64748b', weight: 'bold' },
            { type: 'text', text: truncatedUserId, size: 'sm', color: '#0f172a', margin: 'xs', weight: 'bold', wrap: true },
          ],
        },
        {
          type: 'text',
          text: '💡 นำ ID นี้ระบุในโปรไฟล์ผู้ใช้งานของระบบ เพื่อรับการแจ้งเตือนและติดตามสถานะการยืม-คืนอุปกรณ์',
          size: 'xs',
          color: '#64748b',
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
      contents: [{ type: 'text', text: SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center' }],
    },
  };
  await replyLineFlex(replyToken, '🆔 LINE User ID ของคุณ', flexContent);
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
          action: { type: 'message', label: '✅ ตอบรับคำขอยืมนี้', text: 'เช็คคำขอ ' + id },
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

      // 1. ขอไอดี
      if (msgLower === 'ขอไอดี' || msgLower === 'id' || msgLower === 'user id') {
        await handleAskId(replyToken, userId);
      }
      // 2. แจ้งคืนอุปกรณ์
      else if (msgLower.indexOf('คืน br-') !== -1 || msgLower.indexOf('แจ้งคืน br-') !== -1) {
        await handleReturnBorrowing(replyToken, userMessage);
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
