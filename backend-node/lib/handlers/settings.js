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

module.exports = { getSystemSettings, saveSystemSettings, getBootstrapInfo, getMOPHLogoBase64 };
