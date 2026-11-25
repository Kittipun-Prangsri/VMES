// ============== DEPARTMENTS ==============
// พอร์ตจาก รหัส.js L2013-2038

const { SHEETS, setDoc, deleteDoc, listDocs } = require('../firestore');
const { newId, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');
const DeptMaster = require('../departmentsMaster');

async function getDepartments() {
  return listDocs(SHEETS.DEPARTMENTS);
}

const normName = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const sameName = (a, b) => normName(a).toLowerCase() === normName(b).toLowerCase();
const NAME_MAX = 120;

async function saveDepartment(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    const d = { ...(data || {}) };
    const name = normName(d['ชื่อหน่วยงาน']);
    if (!name) return { success: false, message: 'กรุณาระบุชื่อหน่วยงาน' };
    if (name.length > NAME_MAX) return { success: false, message: 'ชื่อหน่วยงานยาวเกิน ' + NAME_MAX + ' ตัวอักษร' };
    d['ชื่อหน่วยงาน'] = name;

    const isNew = !d['รหัส'];
    const all = await listDocs(SHEETS.DEPARTMENTS);
    const clash = all.find((x) => sameName(x['ชื่อหน่วยงาน'], name) && String(x['รหัส'] || x.id || '') !== String(d['รหัส'] || ''));
    if (clash) {
      // เพิ่มซ้ำชื่อที่มีอยู่ = ไม่สร้างซ้ำ คืนของเดิมให้ (ฟอร์มอื่นเรียกซ้ำได้อย่างปลอดภัย); แก้ไขแล้วชื่อชนกับอีกหน่วยงาน = ปฏิเสธ
      if (isNew) return { success: true, existed: true, id: clash['รหัส'] || clash.id, name: normName(clash['ชื่อหน่วยงาน']) };
      return { success: false, message: 'มีหน่วยงานชื่อ "' + name + '" อยู่แล้ว' };
    }
    if (isNew) d['รหัส'] = newId('DP');
    delete d._row;
    await setDoc(SHEETS.DEPARTMENTS, d['รหัส'], d);
    await logAudit(isNew ? 'เพิ่มหน่วยงานใหม่' : 'แก้ไขข้อมูลหน่วยงาน', 'admin', name);
    return { success: true, id: d['รหัส'], name, existed: false };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// เติมหน่วยงานจริงที่ยังไม่มีในตารางเข้าไป (ไม่ลบ/ไม่แก้อะไรที่มีอยู่) — ชื่อทดสอบ/ชื่อเก่าที่ค้างในตารางแค่รายงานให้ผู้ดูแลลบเองทีละรายการ
// dryRun: นับอย่างเดียว ไม่แก้ข้อมูล
async function syncDepartmentsFromMaster(adminCode, dryRun) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    const all = await listDocs(SHEETS.DEPARTMENTS);
    const have = new Set(all.map((d) => DeptMaster.key(d['ชื่อหน่วยงาน'])));
    const missing = DeptMaster.REAL.filter((n) => !have.has(DeptMaster.key(n)));
    const legacyKeys = new Set(DeptMaster.LEGACY.map(DeptMaster.key));
    const legacyInDb = all.filter((d) => legacyKeys.has(DeptMaster.key(d['ชื่อหน่วยงาน']))).map((d) => normName(d['ชื่อหน่วยงาน']));
    if (dryRun) return { success: true, missing, legacyInDb, total: all.length };
    for (let i = 0; i < missing.length; i += 10) {
      await Promise.all(missing.slice(i, i + 10).map((n) => { const id = newId('DP'); return setDoc(SHEETS.DEPARTMENTS, id, { 'รหัส': id, 'ชื่อหน่วยงาน': n }); }));
    }
    if (missing.length) await logAudit('ซิงก์รายชื่อหน่วยงานจริง', 'admin', 'เพิ่ม ' + missing.length + ' หน่วยงาน');
    return { success: true, added: missing.length, legacyInDb };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// รายชื่อหน่วยงานสำหรับช่องเลือกบน LIFF (สาธารณะ — คืนเฉพาะชื่อ ไม่ส่งหัวหน้า/เบอร์โทร/จำนวนคน)
async function getDepartmentNames() {
  try {
    // รายชื่อจริงของโรงพยาบาล + หน่วยงานที่ผู้ดูแลเพิ่มเอง − ชื่อทดสอบ/ชื่อเก่า (ดู departmentsMaster.js)
    const dbNames = (await listDocs(SHEETS.DEPARTMENTS)).map((d) => d['ชื่อหน่วยงาน']);
    return { success: true, names: DeptMaster.merge(dbNames) };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteDepartment(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    const docId = String(code);
    await deleteDoc(SHEETS.DEPARTMENTS, docId);
    await logAudit('ลบหน่วยงาน', 'admin', docId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { getDepartments, syncDepartmentsFromMaster, getDepartmentNames, saveDepartment, deleteDepartment };
