// ============== DEPARTMENTS ==============
// พอร์ตจาก รหัส.js L2013-2038

const { SHEETS, setDoc, deleteDoc, listDocs } = require('../firestore');
const { newId, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');

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

module.exports = { getDepartments, saveDepartment, deleteDepartment };
