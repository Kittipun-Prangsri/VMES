// ============== BORROWING (with status workflow) ==============
// พอร์ตจาก รหัส.js L1709-1901 (saveBorrowing, updateBorrowingStatus, markEquipmentDamaged_,
// requestBorrowExtension, approveBorrowExtension, getBorrowingByCode, deleteBorrowing)

const { SHEETS, setDoc, deleteDoc, getDoc, listDocs } = require('../firestore');
const { newId, nowStr, todayStr, logAudit } = require('../util');
const { verifyAdmin, getSessionUser } = require('../auth');
const { sendBorrowingFlex } = require('../line');
const { getEquipment } = require('./equipment');
const BA = require('../borrowAvailability');
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

// สถานะที่ยังกันของไว้ — รวม 'ขอขยายเวลา' (เดิมหายไป ทำให้ยืมซ้อนได้ และผู้ยืมไม่เห็นรายการนั้นตอนจะแจ้งคืน)
const ACTIVE_BORROW_STATUSES = BA.ACTIVE_STATUSES;

const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '-');

// รายการที่ขอ: คำขอหลายรายการ หรือชิ้นเดียวแบบเดิม — รวมอุปกรณ์ซ้ำในคำขอเดียวกัน (กดเพิ่มชิ้นเดิมซ้ำ) เป็นจำนวนเดียว
function requestedLines(data) {
  const raw = Array.isArray(data['รายการอุปกรณ์']) && data['รายการอุปกรณ์'].length
    ? data['รายการอุปกรณ์'].map((i) => ({ id: i['รหัสอุปกรณ์'], qty: parseFloat(i['จำนวน']) }))
    : [{ id: data['รหัสอุปกรณ์'], qty: parseFloat(data['จำนวน']) }];
  const merged = new Map();
  raw.forEach((l) => merged.set(l.id, (merged.get(l.id) || 0) + (Number.isFinite(l.qty) ? l.qty : 1)));
  return Array.from(merged.entries()).map(([id, qty]) => ({ id, qty }));
}

// ตรวจคำขอยืมใหม่ "ตามช่วงวันที่" (ฟังก์ชันล้วน ทดสอบได้) -> { error } หรือ { lines:[{equip, qty, available}], from, to }
// ความว่างคิดจากจำนวนในคลัง − ปริมาณที่ถูกกันไว้พร้อมกันสูงสุดในช่วง [รับ, คืน] (ดู borrowAvailability.js)
function checkBorrowRequest(data, equipments, borrowings, today) {
  const from = BA.toIso(data['วันที่ต้องการรับ']) || today;
  const to = BA.toIso(data['วันที่ครบกำหนด']) || from;
  if (to < from) return { error: 'วันที่ครบกำหนดคืนต้องไม่ก่อนวันที่ต้องการรับ' };

  const lines = [];
  for (const l of requestedLines(data)) {
    const equip = (equipments || []).find((e) => e['รหัส'] === l.id);
    if (!equip) return { error: `ไม่พบข้อมูลอุปกรณ์รหัส ${l.id || '-'} ในระบบ` };
    if (!(l.qty > 0)) return { error: `จำนวนที่ยืม "${equip['ชื่ออุปกรณ์']}" ต้องมากกว่า 0` };
    if (!BA.isBorrowPoolEquipment(equip)) return { error: `ไม่สามารถยืมได้: "${equip['ชื่ออุปกรณ์']}" ${equip['หน่วยงานที่รับผิดชอบ'] ? 'เป็นอุปกรณ์ประจำหน่วยงาน ' + equip['หน่วยงานที่รับผิดชอบ'] : 'ยังไม่ได้ระบุหน่วยงานที่รับผิดชอบ'} (ยืมผ่านระบบได้เฉพาะอุปกรณ์ของงานสารสนเทศ)` };
    if (!BA.isBorrowableStatus(equip['สถานะ'])) return { error: `ไม่สามารถยืมได้: อุปกรณ์ "${equip['ชื่ออุปกรณ์']}" อยู่ในสถานะ ${equip['สถานะ']}` };

    const busy = BA.busyWindows(equip['รหัส'], borrowings, today);
    const available = BA.availableFor(equip['จำนวน'], busy, from, to);
    if (l.qty > available) {
      const next = BA.nextFreeDate(equip['จำนวน'], busy, today, l.qty);
      return {
        error: `ไม่สามารถยืมได้: อุปกรณ์ "${equip['ชื่ออุปกรณ์']}" เหลือยืมได้ ${available} ${equip['หน่วยนับ'] || ''} ในช่วง ${fmtDate(from)} – ${fmtDate(to)} (คุณระบุ ${l.qty})`
          + (next ? ` — ว่างอีกครั้งตั้งแต่ ${fmtDate(next)}` : ''),
      };
    }
    lines.push({ equip, qty: l.qty, available });
  }
  return { lines, from, to };
}

async function saveBorrowing(data, user) {
  try {
    if (!data['รหัส']) {
      // ตรวจจำนวนคงเหลือตามช่วงวันที่ — คำขอหลายรายการนับแยกตามชิ้น, ช่วงวันที่ไม่ทับกันยืมซ้ำได้
      const checked = checkBorrowRequest(data, await getEquipment(), await getBorrowing(), todayStr());
      if (checked.error) return { success: false, message: checked.error };
      if (Array.isArray(data['รายการอุปกรณ์']) && data['รายการอุปกรณ์'].length > 0) {
        data['ชื่ออุปกรณ์'] = checked.lines.map((l) => `${l.equip['ชื่ออุปกรณ์']} (x${l.qty})`).join(', ');
        data['จำนวน'] = checked.lines.reduce((sum, l) => sum + l.qty, 0);
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

// ============== ขยายเวลายืม (ผู้ยืมขอ -> เจ้าหน้าที่อนุมัติ/ไม่อนุมัติ) ==============
// ใช้ได้ทั้งจากเว็บและจากปุ่มในแชท LINE: ผู้ยืมขอ "+N วัน" -> การ์ดเจ้าหน้าที่มีปุ่มอนุมัติ/ไม่อนุมัติ
// ระบบตรวจทุกครั้งว่าช่วงที่ขอเพิ่มไม่ชนคิวยืมคนถัดไปของอุปกรณ์ชิ้นเดียวกัน (ทั้งตอนขอและตอนอนุมัติ)
const EXTENDABLE_STATUSES = ['อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน'];
const MAX_EXTENSION_DAYS = 60;

// เก็บวันที่ในรูปแบบเดียวกับที่คำขอใช้อยู่ (ฟอร์ม LIFF = dd/mm/yyyy, เว็บ = yyyy-mm-dd)
function formatLike(sample, iso) {
  return /^\d{1,2}\/\d{1,2}\/\d{4}/.test(String(sample || '')) ? iso.split('-').reverse().join('/') : iso;
}

async function isStaffUserName(user) {
  if (user === 'system') return true;
  const usersList = await getUsers();
  const found = usersList.find((u) => String(u['ชื่อ-นามสกุล']).trim().toLowerCase() === String(user || '').trim().toLowerCase());
  const role = found ? String(found['บทบาท'] || found.role || '').trim().toLowerCase() : '';
  return ['superadmin', 'admin', 'manager', 'ผู้ดูแลระบบ', 'ผู้ดูแลระบบสูงสุด', 'ผู้ดูแล', 'ผู้จัดการ'].includes(role)
    || role.includes('admin') || role.includes('manager');
}

// ตรวจว่าขยายถึง newIso แล้วไม่ชนคิวของคนอื่น -> '' ถ้าผ่าน หรือข้อความ error (ฟังก์ชันล้วนส่วนใหญ่ ทดสอบได้)
function checkExtensionConflict(item, newIso, equipments, borrowings, today) {
  const curDue = BA.toIso(item['วันที่ครบกำหนด']);
  // ส่วนที่เลยกำหนดไปแล้วถึงวันนี้ถูกกันไว้อยู่แล้ว (ของยังไม่กลับ) — ตรวจเฉพาะช่วงที่ "ขยายเพิ่ม"
  let from = curDue ? BA.addDays(curDue, 1) : today;
  if (from < today) from = today;
  if (newIso < from) return '';
  for (const l of BA.linesOf(item)) {
    const equip = (equipments || []).find((e) => e['รหัส'] === l.id);
    if (!equip) continue;
    const busy = BA.busyWindows(l.id, borrowings, today, { excludeCode: item['รหัส'] });
    const available = BA.availableFor(equip['จำนวน'], busy, from, newIso);
    if (available < l.qty) {
      // วันที่ว่างอีกครั้ง = หลังวันแรกที่ชนคิว (ไม่ใช่วันที่ว่างอยู่ก่อนถึงคิวของคนอื่น)
      let clash = from;
      while (clash < newIso && BA.availableFor(equip['จำนวน'], busy, clash, clash) >= l.qty) clash = BA.addDays(clash, 1);
      const next = BA.nextFreeDate(equip['จำนวน'], busy, clash, l.qty);
      return `ขยายเวลาไม่ได้: "${equip['ชื่ออุปกรณ์']}" มีคนจองคิวต่อในช่วง ${fmtDate(from)} – ${fmtDate(newIso)}`
        + (next ? ` (ว่างอีกครั้งตั้งแต่ ${fmtDate(next)})` : '') + ' — เลือกวันที่สั้นลงหรือคืนตามกำหนดเดิม';
    }
  }
  return '';
}

async function requestBorrowExtension(code, newDueDate, reason, user) {
  try {
    const item = await getDoc(SHEETS.BORROWING, code);
    if (!item) throw new Error('ไม่พบข้อมูลคำขอยืม');
    if (item['สถานะ'] === 'ขอขยายเวลา') throw new Error('คำขอนี้ส่งขอขยายเวลาไปแล้ว กำลังรอเจ้าหน้าที่พิจารณา');
    if (!EXTENDABLE_STATUSES.includes(item['สถานะ'])) throw new Error('ขอขยายเวลาได้เฉพาะรายการที่กำลังยืมอยู่ (สถานะปัจจุบัน: ' + item['สถานะ'] + ')');

    const today = todayStr();
    const newIso = BA.toIso(newDueDate);
    if (!newIso) throw new Error('วันที่ขอขยายเวลาไม่ถูกต้อง');
    const curDue = BA.toIso(item['วันที่ครบกำหนด']);
    const base = curDue && curDue > today ? curDue : today;
    if (newIso <= today) throw new Error('วันที่ขอต้องเป็นวันหลังวันนี้');
    if (curDue && newIso <= curDue) throw new Error('วันที่ขอต้องเป็นวันหลังวันครบกำหนดเดิม (' + fmtDate(curDue) + ')');
    if (newIso > BA.addDays(base, MAX_EXTENSION_DAYS)) throw new Error('ขยายเวลาได้ไม่เกิน ' + MAX_EXTENSION_DAYS + ' วันต่อครั้ง');

    const conflict = checkExtensionConflict(item, newIso, await getEquipment(), await getBorrowing(), today);
    if (conflict) return { success: false, message: conflict };

    const shown = formatLike(item['วันที่ครบกำหนด'], newIso);
    item['สถานะ'] = 'ขอขยายเวลา';
    item['วันที่ขอขยายเป็น'] = shown;
    item['เหตุผลขอขยายเวลา'] = reason || '';
    item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'ขอขยายคืนเป็น ' + shown + (reason ? ': ' + reason : '');
    await setDoc(SHEETS.BORROWING, item['รหัส'], item);

    await sendBorrowingFlex(item, 'ขอขยายเวลา');
    const userLineId = await resolveBorrowerLineId(item);
    if (userLineId) {
      await sendBorrowingFlex(item, 'ขอขยายเวลา', userLineId);
    }

    await logAudit('ขอขยายเวลาการยืม', user || 'system', item['รหัส'] + ' -> คืนวันที่ ' + shown);
    return { success: true, message: 'ส่งคำขอขยายเวลาเรียบร้อยแล้ว', newDueDate: shown };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// newDueDate ว่าง = ใช้วันที่ที่ผู้ยืมขอไว้ (ปุ่มอนุมัติในแชทไม่ต้องกรอกอะไร)
async function approveBorrowExtension(code, newDueDate, approver) {
  try {
    if (!(await isStaffUserName(approver))) throw new Error('คุณไม่มีสิทธิ์อนุมัติการขยายเวลา (เฉพาะเจ้าหน้าที่)');
    const item = await getDoc(SHEETS.BORROWING, code);
    if (!item) throw new Error('ไม่พบข้อมูลคำขอยืม');
    if (item['สถานะ'] !== 'ขอขยายเวลา') throw new Error('คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติขยายเวลา (สถานะปัจจุบัน: ' + item['สถานะ'] + ')');

    const newIso = BA.toIso(newDueDate) || BA.toIso(item['วันที่ขอขยายเป็น']);
    if (!newIso) throw new Error('ไม่พบวันที่ขอขยาย กรุณาระบุกำหนดวันคืนใหม่');
    const conflict = checkExtensionConflict(item, newIso, await getEquipment(), await getBorrowing(), todayStr());
    if (conflict) return { success: false, message: conflict };

    const shown = formatLike(item['วันที่ครบกำหนด'], newIso);
    item['วันที่ครบกำหนด'] = shown;
    item['สถานะ'] = 'อยู่ในระหว่างการยืม';
    item['ผู้อนุมัติขยายเวลา'] = approver;
    item['วันที่ขอขยายเป็น'] = '';
    item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'อนุมัติขยายเวลาถึง ' + shown + ' (โดย ' + approver + ')';
    await setDoc(SHEETS.BORROWING, item['รหัส'], item);

    await sendBorrowingFlex(item, 'อนุมัติขยายเวลา');
    const userLineId = await resolveBorrowerLineId(item);
    if (userLineId) {
      await sendBorrowingFlex(item, 'อนุมัติขยายเวลา', userLineId);
    }

    await logAudit('อนุมัติขยายเวลายืม', approver || 'system', item['รหัส'] + ' -> ' + shown);
    return { success: true, message: 'อนุมัติขยายเวลาการยืมสำเร็จ', newDueDate: shown };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function rejectBorrowExtension(code, approver, reason) {
  try {
    if (!(await isStaffUserName(approver))) throw new Error('คุณไม่มีสิทธิ์ดำเนินการ (เฉพาะเจ้าหน้าที่)');
    const item = await getDoc(SHEETS.BORROWING, code);
    if (!item) throw new Error('ไม่พบข้อมูลคำขอยืม');
    if (item['สถานะ'] !== 'ขอขยายเวลา') throw new Error('คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติขยายเวลา (สถานะปัจจุบัน: ' + item['สถานะ'] + ')');

    const asked = item['วันที่ขอขยายเป็น'];
    item['สถานะ'] = 'อยู่ในระหว่างการยืม'; // กลับไปยืมตามกำหนดเดิม
    item['วันที่ขอขยายเป็น'] = '';
    item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'ไม่อนุมัติขยายเวลา' + (asked ? ' (ขอถึง ' + asked + ')' : '') + (reason ? ': ' + reason : '') + ' (โดย ' + approver + ')';
    await setDoc(SHEETS.BORROWING, item['รหัส'], item);

    // สถานะ 'ไม่อนุมัติขยายเวลา' ใช้เฉพาะหัวการ์ดแจ้งเตือน (สถานะจริงของคำขอคือกำลังยืมตามเดิม)
    await sendBorrowingFlex(item, 'ไม่อนุมัติขยายเวลา');
    const userLineId = await resolveBorrowerLineId(item);
    if (userLineId) {
      await sendBorrowingFlex(item, 'ไม่อนุมัติขยายเวลา', userLineId);
    }

    await logAudit('ไม่อนุมัติขยายเวลายืม', approver || 'system', item['รหัส'] + (reason ? ' | ' + reason : ''));
    return { success: true, message: 'บันทึกการไม่อนุมัติขยายเวลาแล้ว' };
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
  await logAudit('ลบรายการยืมอุปกรณ์', ((await getSessionUser(this && this.session)) || {}).name || 'admin', 'รหัส: ' + code + (reason ? ' | เหตุผล: ' + reason : '') + (item ? ' (' + item['ผู้ขอยืม'] + ')' : ''));
  return { success: true };
}

// ============== CATALOG สำหรับหน้าเลือกอุปกรณ์ (LIFF สาธารณะ) ==============
// คืนอุปกรณ์ + "ช่วงวันที่ที่ถูกกันไว้" แบบไม่มีข้อมูลบุคคล เพื่อให้หน้า LIFF คำนวณความว่างตามวันที่ที่ผู้ใช้เลือกเองได้
// (เดิม LIFF ดึง getBorrowing ทั้งตารางซึ่งมีชื่อ/เบอร์ผู้ยืมทุกคนมาที่เบราว์เซอร์สาธารณะ — เลิกแล้ว)
async function getBorrowCatalog() {
  try {
    const today = todayStr();
    const [equips, cats, borrowings] = await Promise.all([getEquipment(), listDocs(SHEETS.EQUIPMENT_CATEGORY), getBorrowing()]);
    const busyBy = new Map();
    borrowings.forEach((b) => {
      if (!ACTIVE_BORROW_STATUSES.includes(b['สถานะ'])) return;
      const w = BA.windowOf(b, today);
      BA.linesOf(b).forEach((l) => {
        if (!l.id || !(l.qty > 0)) return;
        if (!busyBy.has(l.id)) busyBy.set(l.id, []);
        busyBy.get(l.id).push({ s: w.s, e: w.e, q: l.qty });
      });
    });
    const items = equips.filter((e) => e['รหัส'] && BA.isBorrowPoolEquipment(e)).map((e) => ({
      'รหัส': e['รหัส'], 'รหัสครุภัณฑ์': e['รหัสครุภัณฑ์'] || '', 'ชื่ออุปกรณ์': e['ชื่ออุปกรณ์'] || '',
      'ยี่ห้อ': e['ยี่ห้อ'] || '', 'รุ่น': e['รุ่น'] || '', 'Serial': e['Serial'] || '',
      'หมวดหมู่': e['หมวดหมู่'] || '', 'ที่เก็บ': e['ที่เก็บ'] || '', 'หน่วยนับ': e['หน่วยนับ'] || 'เครื่อง',
      'จำนวน': parseFloat(e['จำนวน']) || 0, 'สถานะ': e['สถานะ'] || '', 'รูปภาพ': e['รูปภาพ'] || '',
      busy: busyBy.get(e['รหัส']) || [],
    }));
    return {
      success: true,
      today,
      items,
      categories: cats.map((c) => ({ name: String(c['ชื่อหมวด'] || '').trim(), code: String(c['รหัสหมวด'] || '').trim() })).filter((c) => c.name),
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  getBorrowing,
  saveBorrowing,
  updateBorrowingStatus,
  markEquipmentDamaged,
  requestBorrowExtension,
  approveBorrowExtension,
  rejectBorrowExtension,
  checkExtensionConflict,
  EXTENDABLE_STATUSES,
  getBorrowingByCode,
  deleteBorrowing,
  getMyActiveBorrowings,
  requestReturnViaLiff,
  getBorrowCatalog,
  checkBorrowRequest,
  requestedLines,
};
