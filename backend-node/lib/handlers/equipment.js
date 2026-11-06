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
    // ตอนแก้ไข: รวมกับเอกสารเดิมก่อน เพราะ setDoc ฝั่ง Supabase เป็น full replace — ฟอร์มแก้ไขส่งมาแค่บางฟิลด์
    // ถ้าไม่รวม รูปภาพ/เชื่อมกับ/สถานะป้ายครุภัณฑ์/ข้อมูลสำรวจภาคสนาม จะหายทุกครั้งที่กดบันทึก
    if (!isNew) {
      const existing = await getDoc(SHEETS.EQUIPMENT, String(data['รหัส']));
      if (existing) data = { ...existing, ...data };
    }
    data['วันที่บันทึก'] = nowStr();
    delete data._row;
    await setDoc(SHEETS.EQUIPMENT, data['รหัส'], data);
    await logAudit(isNew ? 'เพิ่มอุปกรณ์ใหม่' : 'แก้ไขข้อมูลอุปกรณ์', 'admin', data['ชื่ออุปกรณ์']);
    return { success: true, code: data['รหัส'] };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteEquipment(code, adminCode, reason) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const docId = String(code);
    const item = await getDoc(SHEETS.EQUIPMENT, docId);
    await deleteDoc(SHEETS.EQUIPMENT, docId);
    await logAudit('ลบอุปกรณ์', 'admin', docId + (item ? ' (' + (item['ชื่ออุปกรณ์'] || '') + ')' : '') + (reason ? ' | เหตุผล: ' + reason : ''));
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

// ============== สถานที่จัดเก็บ (ที่เก็บ) ==============
// "ที่เก็บ" ของอุปกรณ์เป็นข้อความอิสระ ไม่มีตาราง master — เก็บรายการสถานที่ที่ตั้งไว้ล่วงหน้า
// (ยังไม่มีอุปกรณ์ใช้) เป็น JSON array ใน settings คีย์ EQUIPMENT_LOCATIONS (แบบเดียวกับ SYSTEM_ROLES)
// การเปลี่ยนชื่อจะอัปเดตอุปกรณ์ทุกชิ้นที่ใช้ชื่อเดิมให้ด้วย
const LOC_KEY = 'EQUIPMENT_LOCATIONS';
const LOC_MAX_LEN = 100;

function normLoc(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}
const sameLoc = (a, b) => normLoc(a).toLowerCase() === normLoc(b).toLowerCase();

async function readLocations() {
  const rows = await listDocs(SHEETS.SETTINGS);
  const row = rows.find((r) => String(r['Key'] || '').trim() === LOC_KEY);
  try {
    const arr = JSON.parse((row && row['Value']) || '[]');
    return Array.isArray(arr) ? arr.map(normLoc).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

async function writeLocations(list) {
  const seen = new Set();
  const clean = list
    .map(normLoc)
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  await setDoc(SHEETS.SETTINGS, LOC_KEY, { Key: LOC_KEY, Value: JSON.stringify(clean) });
  return clean;
}

function validateLocName(n) {
  if (!n) return 'กรุณาระบุชื่อสถานที่จัดเก็บ';
  if (n.length > LOC_MAX_LEN) return 'ชื่อสถานที่ยาวเกิน ' + LOC_MAX_LEN + ' ตัวอักษร';
  return '';
}

async function addEquipmentLocation(name, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const n = normLoc(name);
    const bad = validateLocName(n);
    if (bad) return { success: false, message: bad };
    const list = await readLocations();
    const items = await listDocs(SHEETS.EQUIPMENT);
    const inUse = items.find((e) => sameLoc(e['ที่เก็บ'], n));
    const existing = list.find((x) => sameLoc(x, n)) || (inUse && normLoc(inUse['ที่เก็บ']));
    if (existing) {
      // มีใช้อยู่แล้วในอุปกรณ์แต่ยังไม่อยู่ใน master -> เพิ่มเข้า master ด้วยชื่อที่ใช้จริง
      if (!list.some((x) => sameLoc(x, existing))) await writeLocations(list.concat(existing));
      return { success: true, name: existing, existed: true };
    }
    await writeLocations(list.concat(n));
    await logAudit('เพิ่มสถานที่จัดเก็บ', 'admin', n);
    return { success: true, name: n, existed: false };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// allowMerge: ชื่อใหม่ซ้ำกับสถานที่อื่นที่มีอยู่ = ควบรวมสองห้องเป็นห้องเดียว ย้อนกลับไม่ได้ จึงต้องยืนยันชัดเจน
// (ไม่ส่ง allowMerge จะไม่ทำอะไรและคืน needsMerge พร้อมจำนวนอุปกรณ์ให้ฝั่งหน้าเว็บถามผู้ใช้)
async function renameEquipmentLocation(oldName, newName, adminCode, allowMerge) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const o = normLoc(oldName);
    const n = normLoc(newName);
    const bad = validateLocName(n);
    if (bad) return { success: false, message: bad };
    if (!o) return { success: false, message: 'ไม่พบชื่อสถานที่เดิม' };

    const list = await readLocations();
    const items = await listDocs(SHEETS.EQUIPMENT);
    const affected = items.filter((e) => sameLoc(e['ที่เก็บ'], o));
    if (!affected.length && !list.some((x) => sameLoc(x, o))) {
      return { success: false, message: 'ไม่พบสถานที่ "' + o + '" ในระบบ' };
    }
    // ชื่อใหม่ชนกับสถานที่อื่นที่มีอยู่ = ควบรวม (ยกเว้นเป็นชื่อเดียวกันกับของเดิมที่แค่แก้ตัวพิมพ์/ช่องว่าง)
    const merged = !sameLoc(o, n) && (list.some((x) => sameLoc(x, n)) || items.some((e) => sameLoc(e['ที่เก็บ'], n)));
    const finalName = merged ? (list.find((x) => sameLoc(x, n)) || normLoc((items.find((e) => sameLoc(e['ที่เก็บ'], n)) || {})['ที่เก็บ']) || n) : n;

    if (merged && allowMerge !== true) {
      return {
        success: false,
        needsMerge: true,
        from: o,
        fromCount: affected.length,
        target: finalName,
        targetCount: items.filter((e) => sameLoc(e['ที่เก็บ'], finalName)).length,
        message: 'ชื่อ "' + finalName + '" มีอยู่แล้ว — ต้องยืนยันการควบรวม',
      };
    }

    let updated = 0;
    for (let i = 0; i < affected.length; i += 10) {
      await Promise.all(
        affected.slice(i, i + 10).map(async (item) => {
          const id = String(item['รหัส'] || item.id || item._id || '').trim();
          if (!id) return;
          const doc = { ...item, 'ที่เก็บ': finalName };
          delete doc._row;
          await setDoc(SHEETS.EQUIPMENT, id, doc);
          updated++;
        })
      );
    }
    await writeLocations(list.filter((x) => !sameLoc(x, o)).concat(finalName));
    await logAudit('แก้ไขสถานที่จัดเก็บ', 'admin', o + ' -> ' + finalName + ' (อัปเดตอุปกรณ์ ' + updated + ' รายการ' + (merged ? ', ควบรวม' : '') + ')');
    return { success: true, name: finalName, updated, merged };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ลบได้เฉพาะสถานที่ที่ไม่มีอุปกรณ์ใช้อยู่ (กันอุปกรณ์กลายเป็นไม่มีที่เก็บโดยไม่ตั้งใจ)
async function deleteEquipmentLocation(name, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const n = normLoc(name);
    if (!n) return { success: false, message: 'ไม่พบชื่อสถานที่' };
    const items = await listDocs(SHEETS.EQUIPMENT);
    const using = items.filter((e) => sameLoc(e['ที่เก็บ'], n)).length;
    if (using) return { success: false, message: 'ลบไม่ได้: ยังมีอุปกรณ์ ' + using + ' รายการใช้สถานที่นี้อยู่ (ย้ายหรือเปลี่ยนชื่อก่อน)' };
    const list = await readLocations();
    if (!list.some((x) => sameLoc(x, n))) return { success: false, message: 'ไม่พบสถานที่ "' + n + '" ในรายการ' };
    await writeLocations(list.filter((x) => !sameLoc(x, n)));
    await logAudit('ลบสถานที่จัดเก็บ', 'admin', n);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  getEquipment, getEquipmentCategories, saveEquipment, deleteEquipment, uploadEquipmentPhoto,
  addEquipmentLocation, renameEquipmentLocation, deleteEquipmentLocation,
};
