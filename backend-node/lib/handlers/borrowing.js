// ============== BORROWING (with status workflow) ==============
// พอร์ตจาก รหัส.js L1709-1901 (saveBorrowing, updateBorrowingStatus, markEquipmentDamaged_,
// requestBorrowExtension, approveBorrowExtension, getBorrowingByCode, deleteBorrowing)

const { SHEETS, setDoc, deleteDoc, getDoc, listDocs } = require('../firestore');
const { newId, nowStr, todayStr, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');
const { sendBorrowingFlex } = require('../line');
const { getEquipment } = require('./equipment');
const { getUsers } = require('./users');
const { getUserLineId } = require('./users');

async function getBorrowing() {
  return listDocs(SHEETS.BORROWING);
}

// แบบฟอร์มยืมผ่าน LIFF (liff.html) แนบ LINE_USER_ID จาก liff.getProfile() มาด้วยอยู่แล้วตอนยืม
// (ผู้ขอยืมพิมพ์ชื่อเองในช่องฟอร์ม อาจสะกด/เว้นวรรคไม่ตรงกับชื่อที่ลงทะเบียนไว้ใน users)
// ใช้ค่านี้ก่อนเสมอถ้ามี แทนที่จะพึ่ง getUserLineId() ซึ่ง match ชื่อแบบ exact string เทียบกับ
// collection users เพียงอย่างเดียว — ไม่งั้นผู้ยืมผ่าน LIFF จะไม่ได้รับแจ้งเตือนส่วนตัวเลย
// ทั้งที่ระบบรู้ LINE ID ของเขาอยู่แล้วตั้งแต่ตอนส่งคำขอ
async function resolveBorrowerLineId(record) {
  if (record['LINE_USER_ID']) return record['LINE_USER_ID'];
  return await getUserLineId(record['ผู้ขอยืม']);
}

const ACTIVE_BORROW_STATUSES = ['รอรับเรื่อง', 'รับเรื่องแล้ว', 'อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน', 'อยู่ในระหว่างการคืน'];

async function saveBorrowing(data, user) {
  try {
    if (!data['รหัส']) {
      // Stock Validation
      const equipments = await getEquipment();
      const borrowings = await getBorrowing();

      if (Array.isArray(data['รายการอุปกรณ์']) && data['รายการอุปกรณ์'].length > 0) {
        // Multi-item validation & summary
        const itemNames = [];
        let totalQtySum = 0;

        for (const item of data['รายการอุปกรณ์']) {
          const equipId = item['รหัสอุปกรณ์'];
          const reqQty = parseFloat(item['จำนวน']) || 1;

          const equip = equipments.find((e) => e['รหัส'] === equipId);
          if (!equip) throw new Error(`ไม่พบข้อมูลอุปกรณ์รหัส ${equipId} ในระบบ`);

          const totalStock = parseFloat(equip['จำนวน']) || 0;
          const activeBorrowings = borrowings.filter((b) => {
            if (!ACTIVE_BORROW_STATUSES.includes(b['สถานะ'])) return false;
            if (b['รหัสอุปกรณ์'] === equipId) return true;
            if (Array.isArray(b['รายการอุปกรณ์']) && b['รายการอุปกรณ์'].some((i) => i['รหัสอุปกรณ์'] === equipId)) return true;
            return false;
          });

          const borrowedQty = activeBorrowings.reduce((sum, b) => {
            if (Array.isArray(b['รายการอุปกรณ์'])) {
              const match = b['รายการอุปกรณ์'].find((i) => i['รหัสอุปกรณ์'] === equipId);
              return sum + (match ? (parseFloat(match['จำนวน']) || 0) : 0);
            }
            return sum + (parseFloat(b['จำนวน']) || 0);
          }, 0);

          const available = totalStock - borrowedQty;

          if (reqQty > available) {
            let errorDetail = '';
            if (activeBorrowings.length > 0) {
              const sorted = [...activeBorrowings].sort((a, b) => String(b['วันที่ครบกำหนด'] || '').localeCompare(String(a['วันที่ครบกำหนด'] || '')));
              const lastB = sorted[0];
              const lastBorrower = lastB['ผู้ขอยืม'] || 'ท่านอื่น';
              const lastDate = lastB['วันที่ครบกำหนด'] || '-';
              errorDetail = ` (ถูกยืม/จองล่วงหน้าอยู่โดย ${lastBorrower} กำหนดคืน ${lastDate})`;
            }
            return {
              success: false,
              message: `ไม่สามารถยืมได้: อุปกรณ์ "${equip['ชื่ออุปกรณ์']}"${errorDetail} เหลือยืมได้ ${available < 0 ? 0 : available} ${equip['หน่วยนับ'] || ''} (คุณระบุ ${reqQty})`,
            };
          }

          itemNames.push(`${equip['ชื่ออุปกรณ์']} (x${reqQty})`);
          totalQtySum += reqQty;
        }

        data['ชื่ออุปกรณ์'] = itemNames.join(', ');
        data['จำนวน'] = totalQtySum;
      } else {
        // Single item validation
        const equipId = data['รหัสอุปกรณ์'];
        const reqQty = parseFloat(data['จำนวน']) || 1;

        const equip = equipments.find((e) => e['รหัส'] === equipId);
        if (!equip) throw new Error('ไม่พบข้อมูลอุปกรณ์ในระบบ');

        const totalStock = parseFloat(equip['จำนวน']) || 0;
        const activeBorrowings = borrowings.filter((b) => {
          if (!ACTIVE_BORROW_STATUSES.includes(b['สถานะ'])) return false;
          if (b['รหัสอุปกรณ์'] === equipId) return true;
          if (Array.isArray(b['รายการอุปกรณ์']) && b['รายการอุปกรณ์'].some((i) => i['รหัสอุปกรณ์'] === equipId)) return true;
          return false;
        });

        const borrowedQty = activeBorrowings.reduce((sum, b) => {
          if (Array.isArray(b['รายการอุปกรณ์'])) {
            const match = b['รายการอุปกรณ์'].find((i) => i['รหัสอุปกรณ์'] === equipId);
            return sum + (match ? (parseFloat(match['จำนวน']) || 0) : 0);
          }
          return sum + (parseFloat(b['จำนวน']) || 0);
        }, 0);

        const available = totalStock - borrowedQty;

        if (reqQty > available) {
          let errorDetail = '';
          if (activeBorrowings.length > 0) {
            const sorted = [...activeBorrowings].sort((a, b) => String(b['วันที่ครบกำหนด'] || '').localeCompare(String(a['วันที่ครบกำหนด'] || '')));
            const lastB = sorted[0];
            const lastBorrower = lastB['ผู้ขอยืม'] || 'ท่านอื่น';
            const lastDate = lastB['วันที่ครบกำหนด'] || '-';
            errorDetail = ` (ถูกยืม/จองล่วงหน้าอยู่โดย ${lastBorrower} กำหนดคืน ${lastDate})`;
          }
          return {
            success: false,
            message: `ไม่สามารถยืมได้: อุปกรณ์ "${equip['ชื่ออุปกรณ์']}"${errorDetail} เหลือยืมได้ ${available < 0 ? 0 : available} ${equip['หน่วยนับ'] || ''} (คุณระบุ ${reqQty})`,
          };
        }
      }

      data['รหัส'] = newId('BR');
      data['สถานะ'] = 'รอรับเรื่อง';
      data['วันที่บันทึก'] = nowStr();
      delete data._row;
      await setDoc(SHEETS.BORROWING, data['รหัส'], data);

      // 1. ส่งแจ้งเตือนเข้ากลุ่ม Admin
      await sendBorrowingFlex(data, 'รอรับเรื่อง');

      // 2. ตรวจสอบ LINE ID และส่งแจ้งเตือนหาส่วนตัว
      const userLineId = await resolveBorrowerLineId(data);
      if (userLineId) {
        await sendBorrowingFlex(data, 'รอรับเรื่อง', userLineId);
      }
    } else {
      delete data._row;
      await setDoc(SHEETS.BORROWING, data['รหัส'], data);
    }
    await logAudit('สร้างคำขอยืม', user || 'system', data['ชื่ออุปกรณ์']);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function markEquipmentDamaged(equipId, equipName, note) {
  try {
    const all = await getEquipment();
    const item = all.find((x) => x['รหัส'] === equipId || x['ชื่ออุปกรณ์'] === equipName);
    if (item) {
      item['สถานะ'] = 'ชำรุด';
      if (note) item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'ชำรุดจากการยืม: ' + note;
      await setDoc(SHEETS.EQUIPMENT, item['รหัส'], item);
      await logAudit('อัปเดตสถานะอุปกรณ์', 'system', (item['ชื่ออุปกรณ์'] || equipId) + ' -> ชำรุด');
    }
  } catch (e) {
    console.log('markEquipmentDamaged error: ' + e.message);
  }
}

async function updateBorrowingStatus(code, newStatus, receiver, user, condition, conditionNote, reason) {
  try {
    const usersList = await getUsers();
    const foundUser = usersList.find(
      (u) => String(u['ชื่อ-นามสกุล']).trim().toLowerCase() === String(user || '').trim().toLowerCase()
    );
    const roleRaw = foundUser ? String(foundUser['บทบาท'] || foundUser.role || '').trim().toLowerCase() : '';
    const isStaff = ['superadmin', 'admin', 'manager', 'ผู้ดูแลระบบ', 'ผู้ดูแลระบบสูงสุด', 'ผู้ดูแล', 'ผู้จัดการ'].includes(roleRaw)
      || roleRaw.includes('admin') || roleRaw.includes('superadmin') || roleRaw.includes('manager') || user === 'system';

    if (!isStaff) {
      throw new Error('คุณไม่มีสิทธิ์ดำเนินการในส่วนนี้');
    }

    const item = await getDoc(SHEETS.BORROWING, code);
    if (!item) throw new Error('ไม่พบข้อมูล');

    item['สถานะ'] = newStatus;
    if (receiver) item['ผู้รับเรื่อง'] = receiver;
    if (reason) {
      item['เหตุผลยกเลิก'] = reason;
      item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'เหตุผล: ' + reason;
    }
    if (newStatus === 'คืนเสร็จสิ้น') {
      item['วันที่คืนจริง'] = todayStr();
      if (condition) item['สภาพอุปกรณ์ตอนคืน'] = condition;
      if (conditionNote) {
        item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'สภาพ: ' + conditionNote;
      }

      // ถ้าสภาพอุปกรณ์ตอนคืนคือ 'ชำรุดบางส่วน' หรือ 'ชำรุดเสียหาย' ให้ปรับสถานะอุปกรณ์เป็น 'ชำรุด'
      if (condition === 'ชำรุดบางส่วน' || condition === 'ชำรุดเสียหาย') {
        await markEquipmentDamaged(item['รหัสอุปกรณ์'], item['ชื่ออุปกรณ์'], conditionNote || condition);
      }
    }
    await setDoc(SHEETS.BORROWING, item['รหัส'], item);

    // 1. แจ้งเตือนสถานะล่าสุดไปยังกลุ่ม Admin
    await sendBorrowingFlex(item, newStatus);

    // 2. แจ้งเตือนสถานะล่าสุดไปยังผู้ยืมแบบส่วนตัว
    const userLineId = await resolveBorrowerLineId(item);
    if (userLineId) {
      await sendBorrowingFlex(item, newStatus, userLineId);
    }

    await logAudit(
      'เปลี่ยนสถานะยืม',
      user || 'system',
      item['รหัส'] + ' -> ' + newStatus + (condition ? ' (' + condition + ')' : '')
    );
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function requestBorrowExtension(code, newDueDate, reason, user) {
  try {
    const item = await getDoc(SHEETS.BORROWING, code);
    if (!item) throw new Error('ไม่พบข้อมูลคำขอยืม');

    item['สถานะ'] = 'ขอขยายเวลา';
    item['เหตุผลขอขยายเวลา'] = reason;
    item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'ขอขยายคืนเป็น ' + newDueDate + ': ' + reason;
    await setDoc(SHEETS.BORROWING, item['รหัส'], item);

    await sendBorrowingFlex(item, 'ขอขยายเวลา');
    const userLineId = await resolveBorrowerLineId(item);
    if (userLineId) {
      await sendBorrowingFlex(item, 'ขอขยายเวลา', userLineId);
    }

    await logAudit('ขอขยายเวลาการยืม', user || 'system', item['รหัส'] + ' -> คืนวันที่ ' + newDueDate);
    return { success: true, message: 'ส่งคำขอขยายเวลาเรียบร้อยแล้ว' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function approveBorrowExtension(code, newDueDate, approver) {
  try {
    const item = await getDoc(SHEETS.BORROWING, code);
    if (!item) throw new Error('ไม่พบข้อมูลคำขอยืม');

    item['วันที่ครบกำหนด'] = newDueDate;
    item['สถานะ'] = 'อยู่ในระหว่างการยืม';
    item['ผู้รับเรื่อง'] = approver;
    item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'อนุมัติขยายเวลาถึง ' + newDueDate;

    await setDoc(SHEETS.BORROWING, item['รหัส'], item);

    await sendBorrowingFlex(item, 'อนุมัติขยายเวลา');
    const userLineId = await resolveBorrowerLineId(item);
    if (userLineId) {
      await sendBorrowingFlex(item, 'อนุมัติขยายเวลา', userLineId);
    }

    await logAudit('อนุมัติขยายเวลายืม', approver || 'system', item['รหัส'] + ' -> ' + newDueDate);
    return { success: true, message: 'อนุมัติขยายเวลาการยืมสำเร็จ' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function getBorrowingByCode(code) {
  try {
    const cleanCode = String(code || '').trim().toUpperCase();
    const borrowings = await getBorrowing();
    let match = borrowings.find((b) => String(b['รหัส']).trim().toUpperCase() === cleanCode);
    if (!match) {
      match = borrowings.find(
        (b) =>
          String(b['รหัสอุปกรณ์']).trim().toUpperCase() === cleanCode &&
          ['รอรับเรื่อง', 'รับเรื่องแล้ว', 'อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน', 'อยู่ในระหว่างการคืน', 'ขอขยายเวลา'].includes(
            b['สถานะ']
          )
      );
    }
    if (!match) {
      match = borrowings.find((b) => String(b['รหัส']).toUpperCase().includes(cleanCode));
    }
    if (match) {
      return { success: true, item: match };
    } else {
      return { success: false, message: 'ไม่พบข้อมูลคำขอยืมสำหรับรหัส: ' + code };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============== RETURN VIA LIFF ==============
// เดิมการ "คืน" ผ่านไลน์ทำได้แค่พิมพ์แชทคำสั่ง "คืน BR-xxxxx" ซึ่งผู้ใช้ทั่วไปแทบไม่มีทางรู้
// รหัสคำขอยืมของตัวเองมาพิมพ์เอง (ไม่มีปุ่ม/เมนูให้กดโดยตรง) ฟังก์ชันคู่นี้เปิดให้ LIFF
// แสดงรายการที่ผู้ใช้คนนั้นยืมอยู่ (จับคู่ด้วย LINE_USER_ID ที่บันทึกไว้ตอนยืม — ไม่ต้องรู้
// รหัสคำขอเลย) แล้วกดปุ่มแจ้งคืนได้ตรงๆ — เช็คความเป็นเจ้าของด้วย LINE_USER_ID ก่อนเสมอ
// กันไม่ให้คนอื่นกดแจ้งคืนแทนเจ้าของจริงได้

async function getMyActiveBorrowings(lineUserId) {
  try {
    const cleanLineId = String(lineUserId || '').trim();
    if (!cleanLineId) return [];
    const all = await getBorrowing();
    return all.filter(
      (b) => String(b['LINE_USER_ID'] || '') === cleanLineId && ACTIVE_BORROW_STATUSES.includes(b['สถานะ'])
    );
  } catch (err) {
    return [];
  }
}

async function requestReturnViaLiff(code, lineUserId) {
  try {
    const cleanCode = String(code || '').trim();
    const cleanLineId = String(lineUserId || '').trim();
    if (!cleanCode) return { success: false, message: 'ไม่พบรหัสคำขอยืม' };
    if (!cleanLineId) return { success: false, message: 'ไม่พบข้อมูล LINE ผู้ใช้ กรุณาเปิดผ่านแอป LINE' };

    const item = await getDoc(SHEETS.BORROWING, cleanCode);
    if (!item) return { success: false, message: 'ไม่พบข้อมูลคำขอยืม' };

    if (String(item['LINE_USER_ID'] || '') !== cleanLineId) {
      return { success: false, message: 'คุณไม่มีสิทธิ์แจ้งคืนรายการนี้' };
    }

    if (item['สถานะ'] === 'อยู่ในระหว่างการคืน') {
      return { success: false, message: 'รายการนี้แจ้งคืนไปแล้ว กำลังรอเจ้าหน้าที่ตรวจรับ' };
    }
    if (!ACTIVE_BORROW_STATUSES.includes(item['สถานะ'])) {
      return { success: false, message: 'รายการนี้ไม่อยู่ในสถานะที่แจ้งคืนได้ (สถานะปัจจุบัน: ' + item['สถานะ'] + ')' };
    }

    item['สถานะ'] = 'อยู่ในระหว่างการคืน';
    await setDoc(SHEETS.BORROWING, item['รหัส'], item);

    await sendBorrowingFlex(item, 'อยู่ในระหว่างการคืน');
    const userLineId = await resolveBorrowerLineId(item);
    if (userLineId) {
      await sendBorrowingFlex(item, 'อยู่ในระหว่างการคืน', userLineId);
    }

    await logAudit('แจ้งคืนอุปกรณ์ผ่าน LIFF', item['ผู้ขอยืม'] || 'LINE User', item['รหัส']);
    return { success: true, message: 'แจ้งคืนอุปกรณ์สำเร็จ รอเจ้าหน้าที่ตรวจรับอุปกรณ์' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteBorrowing(code, adminCode, reason) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  const item = await getDoc(SHEETS.BORROWING, String(code));
  await deleteDoc(SHEETS.BORROWING, String(code));
  await logAudit('ลบรายการยืมอุปกรณ์', adminCode, 'รหัส: ' + code + (reason ? ' | เหตุผล: ' + reason : '') + (item ? ' (' + item['ผู้ขอยืม'] + ')' : ''));
  return { success: true };
}

module.exports = {
  getBorrowing,
  saveBorrowing,
  updateBorrowingStatus,
  markEquipmentDamaged,
  requestBorrowExtension,
  approveBorrowExtension,
  getBorrowingByCode,
  deleteBorrowing,
  getMyActiveBorrowings,
  requestReturnViaLiff,
};
