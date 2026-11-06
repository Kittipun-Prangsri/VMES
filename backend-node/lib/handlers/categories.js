// ============== EQUIPMENT CATEGORIES (หมวดหมู่ครุภัณฑ์) ==============
// หมวดหมู่ผูกกับ "รหัสหมวด 4 หลักแรกของเลขครุภัณฑ์" เช่น 7440-14-0001/31 -> 7440 = อุปกรณ์คอมพิวเตอร์และเครื่องพิมพ์
// เอกสารหมวด: { id, 'ชื่อหมวด', 'รหัสหมวด'? } ส่วนอุปกรณ์เก็บหมวดเป็น "ชื่อ" ใน 'หมวดหมู่'
// จึงต้องอัปเดตอุปกรณ์ตามเมื่อเปลี่ยนชื่อหมวด และลบหมวดที่ยังมีอุปกรณ์ใช้อยู่ไม่ได้

const { SHEETS, setDoc, deleteDoc, listDocs } = require('../firestore');
const { newId, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');

const CODE_RE = /^\d{4}$/;
const NAME_MAX = 100;

const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const sameName = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
const catId = (c) => String((c && (c.id || c._id || c['รหัส'])) || '').trim();

// 4 หลักแรกของเลขครุภัณฑ์ (ต้องเป็นตัวเลข 4 หลักพอดี แล้วตามด้วยตัวอักษรอื่น/จบข้อความ)
function tagPrefix(tag) {
  const m = /^\s*(\d{4})(?!\d)/.exec(String(tag == null ? '' : tag));
  return m ? m[1] : '';
}

const eqId = (e) => String((e && (e['รหัส'] || e.id || e._id)) || '').trim();

async function updateEquipmentDocs(items, patchFn) {
  let updated = 0;
  for (let i = 0; i < items.length; i += 10) {
    await Promise.all(
      items.slice(i, i + 10).map(async (item) => {
        const id = eqId(item);
        if (!id) return;
        const doc = { ...item, ...patchFn(item) };
        delete doc._row;
        await setDoc(SHEETS.EQUIPMENT, id, doc);
        updated++;
      })
    );
  }
  return updated;
}

// data: { id?, name, code? } — ไม่มี id = สร้างใหม่
async function saveEquipmentCategory(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const d = data || {};
    const name = norm(d.name);
    const code = String(d.code == null ? '' : d.code).trim();
    if (!name) return { success: false, message: 'กรุณาระบุชื่อหมวดหมู่' };
    if (name.length > NAME_MAX) return { success: false, message: 'ชื่อหมวดยาวเกิน ' + NAME_MAX + ' ตัวอักษร' };
    if (code && !CODE_RE.test(code)) return { success: false, message: 'รหัสหมวดต้องเป็นตัวเลข 4 หลัก เช่น 7440' };

    const cats = await listDocs(SHEETS.EQUIPMENT_CATEGORY);
    const id = String(d.id || '').trim();
    const self = id ? cats.find((c) => catId(c) === id) : null;
    if (id && !self) return { success: false, message: 'ไม่พบหมวดหมู่ที่จะแก้ไข' };
    const others = cats.filter((c) => c !== self);
    if (others.some((c) => sameName(c['ชื่อหมวด'], name))) return { success: false, message: 'มีหมวดชื่อ "' + name + '" อยู่แล้ว' };
    if (code) {
      const clash = others.find((c) => String(c['รหัสหมวด'] || '').trim() === code);
      if (clash) return { success: false, message: 'รหัสหมวด ' + code + ' ถูกใช้โดย "' + clash['ชื่อหมวด'] + '" แล้ว' };
    }

    const doc = { ...(self || {}), id: id || newId('CAT'), 'ชื่อหมวด': name };
    if (code) doc['รหัสหมวด'] = code; else delete doc['รหัสหมวด'];
    await setDoc(SHEETS.EQUIPMENT_CATEGORY, doc.id, doc);

    let updated = 0;
    const oldName = self ? norm(self['ชื่อหมวด']) : '';
    if (self && oldName !== name) {
      const items = (await listDocs(SHEETS.EQUIPMENT)).filter((e) => sameName(e['หมวดหมู่'], oldName));
      updated = await updateEquipmentDocs(items, () => ({ 'หมวดหมู่': name }));
    }
    await logAudit(self ? 'แก้ไขหมวดหมู่ครุภัณฑ์' : 'เพิ่มหมวดหมู่ครุภัณฑ์', 'admin', (code ? code + ' ' : '') + name + (updated ? ' (อัปเดตอุปกรณ์ ' + updated + ' รายการ)' : ''));
    return { success: true, id: doc.id, name, code, updated };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteEquipmentCategory(id, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const cats = await listDocs(SHEETS.EQUIPMENT_CATEGORY);
    const cat = cats.find((c) => catId(c) === String(id || '').trim());
    if (!cat) return { success: false, message: 'ไม่พบหมวดหมู่' };
    const using = (await listDocs(SHEETS.EQUIPMENT)).filter((e) => sameName(e['หมวดหมู่'], cat['ชื่อหมวด'])).length;
    if (using) return { success: false, message: 'ลบไม่ได้: ยังมีอุปกรณ์ ' + using + ' รายการอยู่ในหมวดนี้ (ย้ายหรือเปลี่ยนชื่อก่อน)' };
    await deleteDoc(SHEETS.EQUIPMENT_CATEGORY, catId(cat));
    await logAudit('ลบหมวดหมู่ครุภัณฑ์', 'admin', norm(cat['ชื่อหมวด']));
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// จัดหมวดอัตโนมัติจาก 4 หลักแรกของเลขครุภัณฑ์ — apply !== true = แค่แสดงตัวอย่าง (ไม่แก้ข้อมูล)
async function assignEquipmentCategoriesByCode(apply, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const cats = await listDocs(SHEETS.EQUIPMENT_CATEGORY);
    const byCode = {};
    cats.forEach((c) => {
      const code = String(c['รหัสหมวด'] || '').trim();
      if (CODE_RE.test(code)) byCode[code] = norm(c['ชื่อหมวด']);
    });
    const items = await listDocs(SHEETS.EQUIPMENT);
    const changes = [];
    items.forEach((e) => {
      const to = byCode[tagPrefix(e['รหัสครุภัณฑ์'])];
      if (to && norm(e['หมวดหมู่']) !== to) changes.push({ e, to });
    });
    if (apply !== true) {
      return {
        success: true,
        preview: true,
        count: changes.length,
        items: changes.slice(0, 200).map(({ e, to }) => ({ id: eqId(e), tag: e['รหัสครุภัณฑ์'], name: e['ชื่ออุปกรณ์'], from: norm(e['หมวดหมู่']), to })),
      };
    }
    const target = new Map(changes.map(({ e, to }) => [e, to]));
    const updated = await updateEquipmentDocs(changes.map((c) => c.e), (e) => ({ 'หมวดหมู่': target.get(e) }));
    await logAudit('จัดหมวดครุภัณฑ์อัตโนมัติจากรหัส', 'admin', 'อัปเดต ' + updated + ' รายการ');
    return { success: true, updated };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { saveEquipmentCategory, deleteEquipmentCategory, assignEquipmentCategoriesByCode, tagPrefix };
