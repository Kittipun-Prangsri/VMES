// ============== MOPH ID LOGIN (Health ID -> Provider ID) ==============
// ลำดับ API ตรวจสอบกับ response จริงแล้ว (IRON RISK, ต.ค. 2026):
//   token ทุกตัวอยู่ใต้ data (res.data.access_token) ไม่ใช่ top-level
//   ไม่มี /userinfo — ชื่อ/ตำแหน่ง/หน่วยบริการได้จาก Provider ID profile เท่านั้น
//   organization เป็น array (เจ้าหน้าที่ 1 คนสังกัดได้หลายหน่วยบริการ)

const { db, SHEETS } = require('./firestore');
const { newId, todayStr, nowStr } = require('./util');
const { verifySessionToken } = require('./session');

// collection เก็บ provider_id -> รหัสผู้ใช้ แยกจาก "users" เพราะ users เปิดให้ frontend อ่านได้
// (ดู firestore.rules — ปิดอ่าน/เขียนจาก client)
const MOPH_LINKS = 'mophLinks';

const STATUS_PENDING = 'รออนุมัติ';
const SUSPENDED_STATUSES = ['ระงับ', 'ไม่ใช้งาน'];

function mophUrls() {
  const isPrd = process.env.MOPH_ENV === 'prd';
  return {
    healthId: isPrd ? 'https://moph.id.th' : 'https://uat-moph.id.th',
    providerId: isPrd ? 'https://provider.id.th' : 'https://uat-provider.id.th',
  };
}

function redirectUri() {
  return process.env.HEALTHID_REDIRECT_URI || `${process.env.BACKEND_BASE_URL}/api/auth/healthid/callback`;
}

function healthIdLoginUrl() {
  const params = new URLSearchParams({
    client_id: process.env.HEALTHID_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri: redirectUri(),
  });
  return `${mophUrls().healthId}/oauth/redirect?${params}`;
}

async function fetchJson(url, init, label) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* HTML error page */ }
  if (!res.ok) {
    throw new Error(`${label} ${res.status}: ${body ? JSON.stringify(body).slice(0, 300) : text.slice(0, 120)}`);
  }
  return body || {};
}

// แลก authorization code -> Health ID token -> Provider ID token -> โปรไฟล์เจ้าหน้าที่
async function fetchProviderProfile(code) {
  const urls = mophUrls();

  const healthToken = await fetchJson(`${urls.healthId}/api/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: process.env.HEALTHID_CLIENT_ID,
      client_secret: process.env.HEALTHID_CLIENT_SECRET,
    }),
  }, 'moph.id.th/api/v1/token');
  const healthAccessToken = healthToken.data && healthToken.data.access_token;
  if (!healthAccessToken) {
    throw new Error(`Health ID token missing in response (keys: ${Object.keys(healthToken).join(',')})`);
  }

  const providerToken = await fetchJson(`${urls.providerId}/api/v1/services/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PROVIDERID_CLIENT_ID,
      secret_key: process.env.PROVIDERID_SECRET_KEY,
      token_by: 'Health ID',
      token: healthAccessToken,
    }),
  }, 'provider.id.th/api/v1/services/token');
  const providerAccessToken = providerToken.data && providerToken.data.access_token;
  if (!providerAccessToken) {
    throw new Error(`Provider ID token missing in response (keys: ${Object.keys(providerToken).join(',')})`);
  }

  const profileRes = await fetchJson(`${urls.providerId}/api/v1/services/profile?position_type=1`, {
    headers: {
      Authorization: `Bearer ${providerAccessToken}`,
      'client-id': process.env.PROVIDERID_CLIENT_ID,
      'secret-key': process.env.PROVIDERID_SECRET_KEY,
    },
  }, 'provider.id.th/api/v1/services/profile');
  const p = profileRes.data;
  if (!p) {
    throw new Error(`Provider ID profile missing in response (keys: ${Object.keys(profileRes).join(',')})`);
  }

  const orgs = Array.isArray(p.organization) ? p.organization : p.organization ? [p.organization] : [];
  // ถ้ากำหนด MOPH_ALLOWED_HCODES ให้เลือกสังกัดที่อยู่ในรายการก่อน
  const allowed = allowedHcodes();
  const org = (allowed.length && orgs.find((o) => allowed.includes(String(o.hcode)))) || orgs[0] || null;
  const prefix = p.special_title_th || p.title_th || '';
  const name = p.name_th || `${prefix}${p.firstname_th || ''} ${p.lastname_th || ''}`.trim();
  if (!p.provider_id || !name) {
    throw new Error(`Provider ID profile incomplete (keys: ${Object.keys(p).join(',')})`);
  }
  return {
    provider_id: String(p.provider_id),
    name,
    position: (org && org.position) || '',
    hospital: (org && org.hname_th) || '',
    hcode: org && org.hcode ? String(org.hcode) : '',
    hcodes: orgs.map((o) => String(o.hcode || '')).filter(Boolean),
  };
}

function allowedHcodes() {
  return String(process.env.MOPH_ALLOWED_HCODES || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function isHospitalAllowed(profile) {
  const allowed = allowedHcodes();
  return !allowed.length || profile.hcodes.some((h) => allowed.includes(h));
}

// ตัดคำนำหน้าชื่อออกเพื่อจับคู่กับผู้ใช้เดิมที่บันทึกชื่อไว้โดยไม่มีคำนำหน้า
const TITLE_RE = /^(นางสาว|น\.ส\.|นาง|นาย|ดร\.|นพ\.|พญ\.|ทพ\.|ทพญ\.|ภก\.|ภญ\.|ว่าที่ร้อยตรี|ว่าที่ ร\.ต\.)\s*/;
function normalizeName(name) {
  let s = String(name || '').replace(/\s+/g, ' ').trim();
  let prev;
  do { prev = s; s = s.replace(TITLE_RE, ''); } while (s !== prev);
  return s.toLowerCase();
}

function userStatus(user) {
  const st = String(user['สถานะ'] || '').trim();
  if (SUSPENDED_STATUSES.includes(st)) return 'suspended';
  if (st === STATUS_PENDING) return 'pending';
  return 'active';
}

// หา/สร้างผู้ใช้จากโปรไฟล์ Provider ID:
//   1. เคยผูก provider_id แล้ว -> ใช้ผู้ใช้เดิม
//   2. ยังไม่เคยผูก แต่มีผู้ใช้เดิมชื่อตรงกัน "คนเดียว" -> ผูกกับบัญชีนั้น (คงบทบาท/สถานะเดิม)
//   3. ไม่พบ -> สร้างผู้ใช้ใหม่สถานะ "รออนุมัติ" ให้ admin อนุมัติในหน้าจัดการผู้ใช้งาน
async function upsertUser(profile) {
  const linkRef = db.collection(MOPH_LINKS).doc(profile.provider_id);
  return db.runTransaction(async (tx) => {
    const linkSnap = await tx.get(linkRef);
    let userRef = null;
    let user = null;
    if (linkSnap.exists) {
      userRef = db.collection(SHEETS.USERS).doc(String(linkSnap.data()['รหัส']));
      const snap = await tx.get(userRef);
      user = snap.exists ? snap.data() : null; // ผู้ใช้ถูกลบไปแล้ว -> สร้างใหม่ด้านล่าง
    }

    let linked = false;
    if (!user) {
      const allUsers = await tx.get(db.collection(SHEETS.USERS));
      const linkedCodes = new Set((await tx.get(db.collection(MOPH_LINKS))).docs.map((d) => String(d.data()['รหัส'])));
      const target = normalizeName(profile.name);
      const matches = allUsers.docs.filter((d) => {
        const u = d.data();
        return !linkedCodes.has(String(u['รหัส'])) && normalizeName(u['ชื่อ-นามสกุล']) === target;
      });
      if (matches.length === 1) {
        userRef = matches[0].ref;
        user = matches[0].data();
        linked = true;
      }
    }

    const mophFields = {
      'ชื่อ (MOPH ID)': profile.name,
      'หน่วยบริการ': profile.hospital,
      'รหัสหน่วยบริการ': profile.hcode,
      'เข้าสู่ระบบล่าสุด': nowStr(),
    };

    let inserted = false;
    if (user) {
      // ไม่เขียนทับ "ชื่อ-นามสกุล" ของผู้ใช้เดิม เพราะประวัติยืม/ใช้รถอ้างอิงด้วยชื่อนี้
      user = { ...user, ...mophFields };
      if (!user['ตำแหน่ง'] && profile.position) user['ตำแหน่ง'] = profile.position;
    } else {
      const code = newId('UR');
      userRef = db.collection(SHEETS.USERS).doc(code);
      user = {
        'รหัส': code,
        'ชื่อ-นามสกุล': profile.name,
        'ตำแหน่ง': profile.position,
        'หน่วยงาน': '',
        'บทบาท': 'user',
        'สถานะ': STATUS_PENDING,
        'วันที่บันทึก': todayStr(),
        ...mophFields,
      };
      inserted = true;
    }

    tx.set(userRef, user);
    tx.set(linkRef, { 'รหัส': user['รหัส'], 'วันที่ผูก': (linkSnap.exists && linkSnap.data()['วันที่ผูก']) || nowStr() });
    return { user, inserted, linked };
  });
}

// รูปแบบเดียวกับผลลัพธ์ของ login() ใน auth.js เพื่อให้ frontend ใช้ต่อได้ทันที
function publicUser(user) {
  return {
    code: user['รหัส'],
    username: user['ชื่อผู้ใช้'] || user['รหัส'],
    name: user['ชื่อ-นามสกุล'],
    role: user['บทบาท'],
    dept: user['หน่วยงาน'],
    position: user['ตำแหน่ง'],
    hospital: user['หน่วยบริการ'],
    phone: user['เบอร์ติดต่อ'],
    email: user['อีเมล'],
    authBy: 'moph',
  };
}

// RPC: ตรวจ session token ที่ได้จาก callback แล้วคืนข้อมูลผู้ใช้ล่าสุดจาก Firestore
async function getMophSession(token) {
  try {
    const session = verifySessionToken(token);
    if (!session) return { success: false, error: 'session', message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
    const snap = await db.collection(SHEETS.USERS).doc(String(session.uid)).get();
    if (!snap.exists) return { success: false, error: 'session', message: 'ไม่พบบัญชีผู้ใช้' };
    const user = snap.data();
    const status = userStatus(user);
    if (status === 'pending') return { success: false, error: 'pending', message: 'บัญชีของคุณรอผู้ดูแลระบบอนุมัติ' };
    if (status === 'suspended') return { success: false, error: 'suspended', message: 'บัญชีนี้ถูกระงับการใช้งาน' };
    return { success: true, user: publicUser(user) };
  } catch (err) {
    return { success: false, message: 'ข้อผิดพลาด: ' + err.message };
  }
}

module.exports = { healthIdLoginUrl, fetchProviderProfile, isHospitalAllowed, upsertUser, userStatus, getMophSession };
