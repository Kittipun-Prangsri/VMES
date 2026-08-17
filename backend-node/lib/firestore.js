// ============== FIREBASE FIRESTORE ENGINE (firebase-admin SDK) ==============
// แทนที่ REST API + JWT/OAuth ของ Apps Script เดิม (firestoreSetDoc_/firestoreListDocs_ ฯลฯ)
// firebase-admin SDK จัดการ auth/pagination/serialize ให้หมด ไม่ต้องเขียนเอง

const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// กัน initializeApp ถูกเรียกซ้ำเมื่อ module ถูก require หลายครั้งข้าม warm invocation ของ Vercel
const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'phan-thong.firebasestorage.app',
    });

const db = getFirestore(app);

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
};

// alias เผื่อโค้ดอื่นอยากอ้างชื่อ "collection" แทน "sheet" (ความหมายเดียวกันในระบบใหม่)
const COLLECTION = SHEETS;

async function setDoc(collection, docId, data) {
  const clean = { ...data };
  delete clean._row;
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;
  await db.collection(collection).doc(cleanDocId).set(clean); // full replace โดยตั้งใจ (ไม่ merge)
  return true;
}

async function deleteDoc(collection, docId) {
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;
  await db.collection(collection).doc(cleanDocId).delete();
  return true;
}

async function deleteField(collection, docId, fieldName) {
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;
  await db.collection(collection).doc(cleanDocId).update({ [fieldName]: FieldValue.delete() });
  return true;
}

async function listDocs(collection) {
  const snap = await db.collection(collection).get();
  return snap.docs.map((d) => d.data());
}

async function getDoc(collection, docId) {
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return null;
  const doc = await db.collection(collection).doc(cleanDocId).get();
  return doc.exists ? doc.data() : null;
}

module.exports = { db, app, SHEETS, COLLECTION, setDoc, deleteDoc, deleteField, listDocs, getDoc };
