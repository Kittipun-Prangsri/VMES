// ============== DATA ENGINE (Supabase/Postgres, JSONB document tables) ==============
// เดิมไฟล์นี้ใช้ firebase-admin คุย Firestore ตรงๆ — ย้ายมาใช้ Supabase (Postgres) แทน
// เพราะ Firestore Spark plan (free) ชนโควต้าอ่าน 50,000 reads/วันซ้ำๆ และ Blaze plan
// ต้องผูกบัตรเครดิต ส่วน Supabase free tier ไม่มี daily read quota แบบนี้ ข้อมูลทั้งหมด
// ถูก migrate มาแล้วเมื่อ 2026-09-16 (ดู backend-node/api/migrate-to-supabase.js ที่ถูก
// ลบทิ้งหลังใช้งานครั้งเดียวเสร็จ — ตรวจนับแถวยืนยันครบทุก collection แล้ว)
//
// ยังคงชื่อไฟล์ "firestore.js" และ export signature เดิมทุกตัว (SHEETS, COLLECTION,
// setDoc, deleteDoc, deleteField, listDocs, getDoc, getAllData) โดยตั้งใจ — ไฟล์อื่น
// ทั้งหมด (handlers/*, whitelist.js, auth.js, line.js, util.js) เรียกผ่านฟังก์ชันกลุ่มนี้
// เท่านั้น ไม่แตะ Firestore SDK ตรงๆ เลย จึงสลับ engine ด้านในได้โดยไม่ต้องแก้ไฟล์อื่นเลย
//
// แต่ละ collection แมปเป็น Postgres table เดียวกันชื่อเดียวกัน โครงสร้างแบบ JSONB
// document store (id text primary key, data jsonb) แทนการออกแบบ relational schema ใหม่
// ทั้งหมด — เพราะ field เดิมเป็นภาษาไทยไม่คงที่ (schemaless แบบ Firestore) การยึดโครงสร้าง
// นี้ทำให้ handler เดิมทำงานได้ทันทีโดยไม่ต้องแก้โค้ดที่ query field ภาษาไทยตรงๆ เลย

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// service_role key bypass RLS ได้เหมือน Firebase Admin SDK bypass Firestore rules เดิม
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    : null;

// ชื่อ collection/table เดิมทุกตัว (สร้างไว้แล้วใน Supabase ด้วย supabase-schema.sql)
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

const COLLECTION = SHEETS;

// in-memory cache ต่อ warm instance ของ Vercel — ลดจำนวน query ซ้ำๆ เมื่อมีหลาย request
// เข้ามาถี่ๆ ภายใน 30 วิ (ไม่มีผลต่อ correctness เพราะ setDoc/deleteDoc ล้าง cache ทันที)
const CACHE = {};
const CACHE_TTL_MS = 30 * 1000;

const admin = require('firebase-admin');

let _firebaseDb = null;
function getFirebaseDb() {
  if (!_firebaseDb) {
    if (!admin.apps.length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
          const sa = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
            ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
            : process.env.FIREBASE_SERVICE_ACCOUNT;
          admin.initializeApp({ credential: admin.credential.cert(sa) });
        } catch (e) {
          admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'phan-thong' });
        }
      } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        // ค่าจริงบน Vercel ถูกตั้งเป็น 3 ตัวแยก (ไม่ใช่ FIREBASE_SERVICE_ACCOUNT JSON ก้อนเดียว)
        // private key ที่ paste ผ่าน Vercel dashboard มักเก็บ newline เป็น "\n" ตัวอักษรจริง
        // ต้องแทนกลับเป็น newline จริงก่อน ไม่งั้น admin.credential.cert() parse คีย์ไม่ผ่าน
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
        });
      } else {
        admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'phan-thong' });
      }
    }
    _firebaseDb = admin.firestore();
  }
  return _firebaseDb;
}

function requireClient() {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_KEY');
  return supabase;
}

async function setDoc(collection, docId, data) {
  delete CACHE[collection];
  const clean = { ...data };
  delete clean._row;
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;

  let sbSuccess = false;
  if (supabase) {
    try {
      const { error } = await supabase
        .from(collection)
        .upsert({ id: cleanDocId, data: clean, updated_at: new Date().toISOString() });
      if (!error) sbSuccess = true;
    } catch (e) {}
  }

  try {
    const db = getFirebaseDb();
    await db.collection(collection).doc(cleanDocId).set(clean, { merge: true });
    return true;
  } catch (fbErr) {
    if (sbSuccess) return true;
    throw fbErr;
  }
}

async function deleteDoc(collection, docId) {
  delete CACHE[collection];
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;

  if (supabase) {
    try { await supabase.from(collection).delete().eq('id', cleanDocId); } catch (e) {}
  }

  try {
    const db = getFirebaseDb();
    await db.collection(collection).doc(cleanDocId).delete();
    return true;
  } catch (e) {
    return true;
  }
}

async function deleteField(collection, docId, fieldName) {
  delete CACHE[collection];
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;
  const existing = await getDoc(collection, cleanDocId);
  if (!existing) return false;
  const updated = { ...existing };
  delete updated[fieldName];
  return await setDoc(collection, cleanDocId, updated);
}

async function listDocs(collection) {
  const now = Date.now();
  if (CACHE[collection] && now - CACHE[collection].timestamp < CACHE_TTL_MS) {
    return CACHE[collection].data;
  }

  // 1. Try Supabase first
  if (supabase) {
    try {
      const { data: rows, error } = await supabase.from(collection).select('data');
      if (!error && Array.isArray(rows) && rows.length > 0) {
        const result = rows.map((r) => r.data);
        CACHE[collection] = { timestamp: now, data: result };
        return result;
      }
    } catch (err) {
      console.log(`Supabase query for ${collection} returned error: ${err.message}`);
    }
  }

  // 2. Fallback to Firebase Firestore directly!
  try {
    const db = getFirebaseDb();
    const snapshot = await db.collection(collection).get();
    const result = [];
    snapshot.forEach((doc) => {
      const d = doc.data();
      if (d) {
        if (!d.id && !d._id && !d['รหัส']) d.id = doc.id;
        result.push(d);
      }
    });
    if (result.length > 0) {
      CACHE[collection] = { timestamp: now, data: result };
      console.log(`Pulled ${result.length} items from Firebase Firestore for collection ${collection}`);
      return result;
    }
  } catch (fbErr) {
    console.log(`Firebase Firestore query error for ${collection}:`, fbErr.message);
  }

  return (CACHE[collection] && CACHE[collection].data) || [];
}

async function getDoc(collection, docId) {
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return null;

  if (supabase) {
    try {
      const { data: row, error } = await supabase
        .from(collection)
        .select('data')
        .eq('id', cleanDocId)
        .maybeSingle();
      if (!error && row) return row.data;
    } catch (err) {}
  }

  try {
    const db = getFirebaseDb();
    const docSnap = await db.collection(collection).doc(cleanDocId).get();
    if (docSnap.exists) return docSnap.data();
  } catch (e) {}

  if (CACHE[collection] && Array.isArray(CACHE[collection].data)) {
    return (
      CACHE[collection].data.find(
        (x) => String(x.id || x._id || x._row || x.docId || x['รหัส'] || '') === cleanDocId
      ) || null
    );
  }
  return null;
}

async function syncFromFirebase() {
  const collections = Object.values(SHEETS);
  const summary = {};
  let totalPulled = 0;

  for (const col of collections) {
    try {
      delete CACHE[col];
      const db = getFirebaseDb();
      const snapshot = await db.collection(col).get();
      const docs = [];
      snapshot.forEach((doc) => {
        const d = doc.data();
        if (d) {
          const docId = String(d.id || d._id || d['รหัส'] || doc.id).trim();
          docs.push({ docId, data: d });
        }
      });

      if (docs.length > 0) {
        summary[col] = docs.length;
        totalPulled += docs.length;

        if (supabase) {
          for (const item of docs) {
            try {
              await supabase.from(col).upsert({ id: item.docId, data: item.data, updated_at: new Date().toISOString() });
            } catch (e) {}
          }
        }
        CACHE[col] = { timestamp: Date.now(), data: docs.map((x) => x.data) };
      } else {
        summary[col] = 0;
      }
    } catch (err) {
      summary[col] = `Error: ${err.message}`;
    }
  }

  return {
    success: true,
    totalPulled,
    summary,
    message: `ดึงข้อมูลจาก Firebase Firestore เรียบร้อยแล้ว (รวมทั้งหมด ${totalPulled} รายการ)`
  };
}

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

module.exports = { SHEETS, COLLECTION, setDoc, deleteDoc, deleteField, listDocs, getDoc, getAllData, syncFromFirebase };
