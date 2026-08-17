// ============== EQUIPMENT ==============
// พอร์ตจาก รหัส.js L1681-1707 (saveEquipment/deleteEquipment), L1502, L1511 (getEquipmentCategories)

const { SHEETS, setDoc, deleteDoc, listDocs, getDoc } = require('../firestore');
const { newId, nowStr, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');
const { uploadBase64Image } = require('../storage');

async function getEquipment() {
  return listDocs(SHEETS.EQUIPMENT);
}

async function getEquipmentCategories() {
  return listDocs(SHEETS.EQUIPMENT_CATEGORY);
}

async function saveEquipment(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId('EQ');
    data['วันที่บันทึก'] = nowStr();
    delete data._row;
    await setDoc(SHEETS.EQUIPMENT, data['รหัส'], data);
    await logAudit(isNew ? 'เพิ่มอุปกรณ์ใหม่' : 'แก้ไขข้อมูลอุปกรณ์', 'admin', data['ชื่ออุปกรณ์']);
    return { success: true, code: data['รหัส'] };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteEquipment(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const docId = String(code);
    await deleteDoc(SHEETS.EQUIPMENT, docId);
    await logAudit('ลบอุปกรณ์', 'admin', docId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// อัปโหลดรูปครุภัณฑ์: ดึงเอกสารเดิมมาก่อนแล้วเขียนกลับทั้งฉบับ เพราะ setDoc เป็น
// full replace ไม่ merge (ดู setDoc ใน ../firestore.js) ถ้าส่งแค่ฟิลด์รูปไปตรงๆ
// จะเผลอลบฟิลด์อื่นของอุปกรณ์ทิ้งหมด
async function uploadEquipmentPhoto(code, base64Data, contentType, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const docId = String(code || '').trim();
    if (!docId) return { success: false, message: 'ไม่พบรหัสอุปกรณ์' };
    const existing = await getDoc(SHEETS.EQUIPMENT, docId);
    if (!existing) return { success: false, message: 'ไม่พบข้อมูลอุปกรณ์นี้แล้ว' };

    const ext = (contentType || 'image/jpeg').split('/')[1] || 'jpg';
    const destPath = `equipment-photos/${docId}-${Date.now()}.${ext}`;
    const url = await uploadBase64Image(base64Data, destPath, contentType);

    const updated = { ...existing, 'รูปภาพ': url };
    delete updated._row;
    await setDoc(SHEETS.EQUIPMENT, docId, updated);
    return { success: true, url };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { getEquipment, getEquipmentCategories, saveEquipment, deleteEquipment, uploadEquipmentPhoto };
