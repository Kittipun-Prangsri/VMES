// ============== FIREBASE FIRESTORE ENGINE (firebase-admin SDK) ==============
// แทนที่ REST API + JWT/OAuth ของ Apps Script เดิม (firestoreSetDoc_/firestoreListDocs_ ฯลฯ)
// firebase-admin SDK จัดการ auth/pagination/serialize ให้หมด ไม่ต้องเขียนเอง

const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// กัน initializeApp ถูกเรียกซ้ำเมื่อ module ถูก require หลายครั้งข้าม warm invocation ของ Vercel
const app = getApps().length
  ? getApp()
  : process.env.FIREBASE_PROJECT_ID
  ? initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'phan-thong.firebasestorage.app',
    })
  : null;

const db = app ? getFirestore(app) : null;

// ชื่อ collection ภาษาอังกฤษตรงตามข้อมูลจริงที่มีอยู่แล้วใน Firestore (ยืนยันแล้ว) —
// ไม่มีการแปลชื่อไทย->อังกฤษอีกต่อไป (ต่างจาก SHEET_TO_FIRESTORE_COLLECTION เดิม) เพราะ
// handler ทุกตัวเรียกชื่อ collection ภาษาอังกฤษเหล่านี้ตรงๆ อยู่แล้ว
const SHEETS = {
  VEHICLES: 'vehicles',
  USAGE: 'usage',
  MAINTENANCE: 'maintenance',
  FUEL: 'fuel',
  FUEL_QUOTA: 'fuelQuota',
  EQUIPMENT: 'equipment',
  EQUIPMENT_CATEGORY: 'equipmentCategory',
  BORROWING: 'borrowing',
  USERS: 'users',
  DRIVERS: 'drivers',
  BOOKING: 'booking',
  INSPECTION: 'inspection',
  NOTIFICATIONS: 'notifications',
  AUDIT: 'audit',
  SETTINGS: 'settings',
  DEPARTMENTS: 'departments',
  USER_CREDENTIALS: 'userCredentials',
  SERVICE_REQUESTS: 'serviceRequests',
  WIFI_QR_LOGS: 'wifiQrLogs',
  SATISFACTION_RATINGS: 'satisfactionRatings',
  ATTENDANCE: 'attendance',
};

// alias เผื่อโค้ดอื่นอยากอ้างชื่อ "collection" แทน "sheet" (ความหมายเดียวกันในระบบใหม่)
const COLLECTION = SHEETS;

// In-memory cache to prevent hitting Firestore daily read quota (50,000 reads/day on Free Spark Plan)
const CACHE = {};
const CACHE_TTL_MS = 30 * 1000; // 30 seconds cache for read operations

async function setDoc(collection, docId, data) {
  delete CACHE[collection]; // Invalidate cache for this collection
  const clean = { ...data };
  delete clean._row;
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;
  await db.collection(collection).doc(cleanDocId).set(clean); // full replace โดยตั้งใจ (ไม่ merge)
  return true;
}

async function deleteDoc(collection, docId) {
  delete CACHE[collection]; // Invalidate cache for this collection
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;
  await db.collection(collection).doc(cleanDocId).delete();
  return true;
}

async function deleteField(collection, docId, fieldName) {
  delete CACHE[collection]; // Invalidate cache for this collection
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;
  await db.collection(collection).doc(cleanDocId).update({ [fieldName]: FieldValue.delete() });
  return true;
}

async function listDocs(collection) {
  const now = Date.now();
  if (CACHE[collection] && (now - CACHE[collection].timestamp < CACHE_TTL_MS)) {
    return CACHE[collection].data;
  }
  try {
    const snap = await db.collection(collection).get();
    const data = snap.docs.map((d) => d.data());
    CACHE[collection] = { timestamp: now, data };
    return data;
  } catch (err) {
    console.error(`listDocs error for ${collection}:`, err.message);
    if (CACHE[collection] && CACHE[collection].data) {
      return CACHE[collection].data; // Fallback to last cached data if quota exceeded
    }
    if (err.message && (err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('Quota exceeded') || err.message.includes('8'))) {
      throw new Error('โควต้าการอ่านข้อมูล Firestore รายวันเต็ม (Quota Exceeded) กรุณาอัปเกรดเป็น Firebase Blaze Plan หรือรอการรีเซ็ตโควต้ารายวัน');
    }
    throw err;
  }
}

async function getDoc(collection, docId) {
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return null;
  try {
    const doc = await db.collection(collection).doc(cleanDocId).get();
    return doc.exists ? doc.data() : null;
  } catch (err) {
    console.error(`getDoc error for ${collection}/${cleanDocId}:`, err.message);
    if (err.message && (err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('Quota exceeded'))) {
      // Return matching item from collection cache if available
      if (CACHE[collection] && Array.isArray(CACHE[collection].data)) {
        return CACHE[collection].data.find(x => String(x.id || x._id || x._row || x.docId || x['รหัส'] || '') === cleanDocId) || null;
      }
    }
    throw err;
  }
}

// รวมคอลเลกชันหลักที่ frontend ต้องใช้แสดงผลทุกหน้าไว้ในเรียกเดียว แทนที่การเปิด
// onSnapshot listener 16 ตัวตรงจาก client (อ่านเอกสารทั้งหมดซ้ำทุกครั้งที่เปิดแท็บ/
// มีการเขียนที่ไหนก็ตาม) ซึ่งเป็นสาเหตุหลักที่ทำให้ชนโควต้า 50,000 reads/วันของ Spark
// plan — ฝั่ง frontend เปลี่ยนมาเรียกฟังก์ชันนี้แบบ polling ทุก 30 วิแทน ร่วมกับ cache
// ด้านบนนี้ ทำให้อ่านจริงจาก Firestore สูงสุดแค่ 1 ครั้ง/collection ทุก 30 วิ ไม่ว่าจะมี
// กี่แท็บ/ผู้ใช้เปิดพร้อมกันก็ตาม
async function getAllData() {
  const keys = [
    'vehicles', 'usage', 'maintenance', 'fuel', 'fuelQuota',
    'equipment', 'equipmentCategory', 'borrowing', 'users', 'drivers',
    'booking', 'inspection', 'notifications', 'audit', 'departments', 'attendance',
  ];
  const results = await Promise.all(keys.map((k) => listDocs(k)));
  const out = {};
  keys.forEach((k, i) => { out[k] = results[i]; });
  return out;
}

module.exports = { db, app, SHEETS, COLLECTION, setDoc, deleteDoc, deleteField, listDocs, getDoc, getAllData };
