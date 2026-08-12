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

const ACTIVE_BORROW_STATUSES = ['รอรับเรื่อง', 'รับเรื่องแล้ว', 'อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน', 'อยู่ในระหว่างการคืน'];

async function saveBorrowing(data, user) {
  try {
    if (!data['รหัส']) {
      // Stock Validation
      const equipId = data['รหัสอุปกรณ์'];
      const reqQty = parseFloat(data['จำนวน']) || 1;

      const equipments = await getEquipment();
      const equip = equipments.find((e) => e['รหัส'] === equipId);
      if (!equip) throw new Error('ไม่พบข้อมูลอุปกรณ์ในระบบ');

      const totalStock = parseFloat(equip['จำนวน']) || 0;

      const borrowings = await getBorrowing();
      const activeBorrowings = borrowings.filter(
        (b) => b['รหัสอุปกรณ์'] === equipId && ACTIVE_BORROW_STATUSES.includes(b['สถานะ'])
      );

      const borrowedQty = activeBorrowings.reduce((sum, b) => sum + (parseFloat(b['จำนวน']) || 0), 0);
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

      data['รหัส'] = newId('BR');
      data['สถานะ'] = 'รอรับเรื่อง';
      data['วันที่บันทึก'] = nowStr();
      delete data._row;
      await setDoc(SHEETS.BORROWING, data['รหัส'], data);

      // 1. ส่งแจ้งเตือนเข้ากลุ่ม Admin
      await sendBorrowingFlex(data, 'รอรับเรื่อง');

      // 2. ตรวจสอบ LINE ID และส่งแจ้งเตือนหาส่วนตัว
      const userLineId = await getUserLineId(data['ผู้ขอยืม']);
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

async function updateBorrowingStatus(code, newStatus, receiver, user, condition, conditionNote) {
  try {
    const usersList = await getUsers();
    const foundUser = usersList.find(
      (u) => String(u['ชื่อ-นามสกุล']).trim().toLowerCase() === String(user || '').trim().toLowerCase()
    );
    const role = foundUser ? String(foundUser['บทบาท']).trim().toLowerCase() : '';
    const isStaff = ['superadmin', 'admin', 'manager'].includes(role) || user === 'system';

    if (!isStaff) {
      throw new Error('คุณไม่มีสิทธิ์ดำเนินการในส่วนนี้');
    }

    const item = await getDoc(SHEETS.BORROWING, code);
    if (!item) throw new Error('ไม่พบข้อมูล');

    item['สถานะ'] = newStatus;
    if (receiver) item['ผู้รับเรื่อง'] = receiver;
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
    const userLineId = await getUserLineId(item['ผู้ขอยืม']);
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
    const userLineId = await getUserLineId(item['ผู้ขอยืม']);
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
    const userLineId = await getUserLineId(item['ผู้ขอยืม']);
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

async function deleteBorrowing(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  await deleteDoc(SHEETS.BORROWING, String(code));
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
};
