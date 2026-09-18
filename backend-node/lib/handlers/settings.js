// ============== SYSTEM SETTINGS + BOOTSTRAP ==============
// พอร์ตจาก รหัส.js L3062-3087 (getSystemSettings/saveSystemSettings) และ
// L1515-1551 (getBootstrapInfo/getMOPHLogoBase64)

const { SHEETS, setDoc, listDocs } = require('../firestore');
const { verifyAdmin } = require('../auth');

async function getSystemSettings() {
  try {
    const rows = await listDocs(SHEETS.SETTINGS);
    const settings = {};
    rows.forEach((r) => {
      const key = String(r['Key'] || '').trim();
      if (key) settings[key] = String(r['Value'] || '').trim();
    });
    return settings;
  } catch (err) {
    return {};
  }
}

async function saveSystemSettings(settings, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    for (let key in settings) {
      const val = String(settings[key]).trim();
      await setDoc(SHEETS.SETTINGS, key, { Key: key, Value: val });
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// เดิมใน Apps Script ใช้ CacheService.getScriptCache() (21600 วินาที = 6 ชม.) — ใน
// serverless ไม่มี cache ข้าม invocation ที่รับประกันได้ ใช้ตัวแปรระดับ module แทน
// (จะช่วยได้เมื่อ Vercel รียูส warm instance เดิม ไม่ช่วยเมื่อ cold start ใหม่ ซึ่งไม่เป็นไร)
let _logoCache = { value: '', expiresAt: 0 };
const LOGO_CACHE_TTL_MS = 21600 * 1000;

async function getMOPHLogoBase64() {
  try {
    const url =
      'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Ministry_of_Public_Health_Thailand_Logo.png/120px-Ministry_of_Public_Health_Thailand_Logo.png';
    const res = await fetch(url);
    if (res.status === 200) {
      const buf = Buffer.from(await res.arrayBuffer());
      return 'data:image/png;base64,' + buf.toString('base64');
    }
  } catch (err) {
    console.log('Error fetching MOPH logo: ' + err.message);
  }
  return '';
}

// แทนที่ getAllInitData เดิม — คืนเฉพาะสิ่งที่ยังไม่มีใน real-time listener ของ frontend
// (frontend อ่านข้อมูลหลักแบบ real-time จาก Firestore SDK ตรงๆ อยู่แล้ว)
async function getBootstrapInfo() {
  // ไม่มีแนวคิด "สร้างชีตหรือยัง" อีกต่อไปเมื่อใช้ Firestore ล้วนๆ ถือว่าระบบพร้อมใช้งานเสมอ
  const setup = {
    complete: true,
    found: Object.keys(SHEETS).length,
    total: Object.keys(SHEETS).length,
    missing: [],
  };

  let logo = _logoCache.expiresAt > Date.now() ? _logoCache.value : '';
  if (!logo) {
    logo = await getMOPHLogoBase64();
    if (logo) {
      _logoCache = { value: logo, expiresAt: Date.now() + LOGO_CACHE_TTL_MS };
    }
  }

  return {
    setup: setup,
    logo: logo || '',
    settings: await getSystemSettings(),
  };
}

async function setupSystem() {
  try {
    // 1. Departments
    const depts = [
      { id: 'DEP001', 'ชื่อหน่วยงาน': 'งานเทคโนโลยีสารสนเทศ' },
      { id: 'DEP002', 'ชื่อหน่วยงาน': 'ผู้ป่วยนอก (OPD)' },
      { id: 'DEP003', 'ชื่อหน่วยงาน': 'ผู้ป่วยใน (IPD)' },
      { id: 'DEP004', 'ชื่อหน่วยงาน': 'อุบัติเหตุและฉุกเฉิน (ER)' },
      { id: 'DEP005', 'ชื่อหน่วยงาน': 'งานเภสัชกรรม (ห้องยา)' },
      { id: 'DEP006', 'ชื่อหน่วยงาน': 'ฝ่ายบริหาร / สำนักงาน' },
    ];
    for (const d of depts) { await setDoc(SHEETS.DEPARTMENTS, d.id, d); }

    // 2. Equipment Categories
    const cats = [
      { id: 'CAT001', 'ชื่อหมวด': 'คอมพิวเตอร์และอุปกรณ์' },
      { id: 'CAT002', 'ชื่อหมวด': 'เครื่องพิมพ์และสแกนเนอร์' },
      { id: 'CAT003', 'ชื่อหมวด': 'อุปกรณ์เครือข่าย (Network)' },
      { id: 'CAT004', 'ชื่อหมวด': 'เครื่องมือแพทย์และอุปกรณ์ทางการแพทย์' },
    ];
    for (const c of cats) { await setDoc(SHEETS.EQUIPMENT_CATEGORY, c.id, c); }

    // 3. Equipment Items
    const equips = [
      {
        id: 'EQ001',
        'รหัส': 'EQ001',
        'รหัสครุภัณฑ์': '4110-001-0001/66',
        'ชื่ออุปกรณ์': 'คอมพิวเตอร์ตั้งโต๊ะ Dell OptiPlex 7090',
        'หมวดหมู่': 'คอมพิวเตอร์และอุปกรณ์',
        'ยี่ห้อ': 'Dell',
        'รุ่น': 'OptiPlex 7090',
        'Serial': 'SN-DELL-99812',
        'จำนวน': 1,
        'หน่วยนับ': 'เครื่อง',
        'ที่เก็บ': 'ผู้ป่วยนอก (OPD)',
        'มูลค่า': 24500,
        'สถานะ': 'ประจำจุด',
        'วันที่จัดซื้อ': '2023-05-15',
        'หมายเหตุ': 'สำหรับจุดซักประวัติ OPD'
      },
      {
        id: 'EQ002',
        'รหัส': 'EQ002',
        'รหัสครุภัณฑ์': '4110-001-0002/66',
        'ชื่ออุปกรณ์': 'คอมพิวเตอร์โน้ตบุ๊ก Lenovo ThinkPad L14',
        'หมวดหมู่': 'คอมพิวเตอร์และอุปกรณ์',
        'ยี่ห้อ': 'Lenovo',
        'รุ่น': 'ThinkPad L14 Gen 3',
        'Serial': 'SN-LNV-33211',
        'จำนวน': 1,
        'หน่วยนับ': 'เครื่อง',
        'ที่เก็บ': 'งานเทคโนโลยีสารสนเทศ',
        'มูลค่า': 28900,
        'สถานะ': 'พร้อมยืม',
        'วันที่จัดซื้อ': '2023-06-20',
        'หมายเหตุ': 'พร้อมกระเป๋า + สายชาร์จ'
      },
      {
        id: 'EQ003',
        'รหัส': 'EQ003',
        'รหัสครุภัณฑ์': '4120-002-0001/66',
        'ชื่ออุปกรณ์': 'เครื่องพิมพ์พกพา Brother PocketJet PJ-773',
        'หมวดหมู่': 'เครื่องพิมพ์และสแกนเนอร์',
        'ยี่ห้อ': 'Brother',
        'รุ่น': 'PJ-773',
        'Serial': 'SN-BRT-55412',
        'จำนวน': 1,
        'หน่วยนับ': 'เครื่อง',
        'ที่เก็บ': 'งานเทคโนโลยีสารสนเทศ',
        'มูลค่า': 15500,
        'สถานะ': 'พร้อมยืม',
        'วันที่จัดซื้อ': '2023-08-10',
        'หมายเหตุ': 'พิมพ์สติกเกอร์ยา/ป้ายชื่อ'
      },
      {
        id: 'EQ004',
        'รหัส': 'EQ004',
        'รหัสครุภัณฑ์': '6515-004-0001/66',
        'ชื่ออุปกรณ์': 'เครื่องวัดความดันโลหิตอัตโนมัติ Omron HBP-1320',
        'หมวดหมู่': 'เครื่องมือแพทย์และอุปกรณ์ทางการแพทย์',
        'ยี่ห้อ': 'Omron',
        'รุ่น': 'HBP-1320',
        'Serial': 'SN-OMR-77812',
        'จำนวน': 1,
        'หน่วยนับ': 'เครื่อง',
        'ที่เก็บ': 'ผู้ป่วยนอก (OPD)',
        'มูลค่า': 12000,
        'สถานะ': 'พร้อมยืม',
        'วันที่จัดซื้อ': '2023-04-12',
        'หมายเหตุ': 'ผ่านการสอบเทียบมาตรฐาน'
      }
    ];
    for (const e of equips) { await setDoc(SHEETS.EQUIPMENT, e.id, e); }

    // 4. Vehicles
    const vehicles = [
      {
        id: 'V001',
        'รหัส': 'V001',
        'ทะเบียน': 'กข-1234 สระแก้ว',
        'ยี่ห้อ': 'Toyota',
        'รุ่น': 'Commuter 2.8',
        'สี': 'ขาว',
        'ประเภท': 'รถตู้พยาบาล',
        'อายุการใช้งาน(ปี)': 3,
        'เลขไมล์ปัจจุบัน': 45200,
        'สถานะ': 'พร้อมใช้งาน',
        'หน่วยงาน': 'อุบัติเหตุและฉุกเฉิน (ER)',
        'หมายเหตุ': 'อุปกรณ์กู้ชีพครบครัน'
      },
      {
        id: 'V002',
        'รหัส': 'V002',
        'ทะเบียน': 'กง-5678 สระแก้ว',
        'ยี่ห้อ': 'Isuzu',
        'รุ่น': 'D-Max Cab4',
        'สี': 'บรอนซ์เงิน',
        'ประเภท': 'รถกระบะปฏิบัติการ',
        'อายุการใช้งาน(ปี)': 2,
        'เลขไมล์ปัจจุบัน': 28400,
        'สถานะ': 'พร้อมใช้งาน',
        'หน่วยงาน': 'ฝ่ายบริหาร / สำนักงาน',
        'หมายเหตุ': 'สำหรับออกสำรวจภาคสนาม'
      }
    ];
    for (const v of vehicles) { await setDoc(SHEETS.VEHICLES, v.id, v); }

    // 5. Drivers
    const drivers = [
      {
        id: 'DRV001',
        'รหัส': 'DRV001',
        'ชื่อ-นามสกุล': 'นายสมชาย ใจดี',
        'ตำแหน่ง': 'พนักงานขับรถยนต์',
        'หน่วยงาน': 'งานยานพาหนะ',
        'เบอร์โทรติดต่อ': '081-234-5678',
        'สถานะ': 'พร้อมปฏิบัติงาน'
      },
      {
        id: 'DRV002',
        'รหัส': 'DRV002',
        'ชื่อ-นามสกุล': 'นายวิชัย มั่นคง',
        'ตำแหน่ง': 'พนักงานขับรถยนต์',
        'หน่วยงาน': 'งานยานพาหนะ',
        'เบอร์โทรติดต่อ': '089-876-5432',
        'สถานะ': 'พร้อมปฏิบัติงาน'
      }
    ];
    for (const dr of drivers) { await setDoc(SHEETS.DRIVERS, dr.id, dr); }

    return { success: true, message: 'ติดตั้งข้อมูลสาธิตตัวอย่างระบบ VMES สำเร็จเรียบร้อย!' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { getSystemSettings, saveSystemSettings, getBootstrapInfo, getMOPHLogoBase64, setupSystem };
