// ============== DATA ENGINE (Supabase/Postgres, JSONB document tables) ==============
// เดิมไฟล์นี้ใช้ firebase-admin คุย Firestore ตรงๆ — ย้ายมาใช้ Supabase (Postgres) แทน
// เพราะ Firestore Spark plan (free) ชนโควต้าอ่าน 50,000 reads/วันซ้ำๆ และ Blaze plan
// ต้องผูกบัตรเครดิต ส่วน Supabase free tier ไม่มี daily read quota แบบนี้
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

// ชื่อ collection/table เดิมทุกตัว (ต้องสร้าง table เหล่านี้ใน Supabase ไว้ล่วงหน้าด้วย SQL
// setup script — ดู backend-node/supabase-schema.sql)
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

// in-memory cache ต่อ warm instance ของ Vercel — เดิมทำไว้กันโควต้า Firestore แต่ยังมี
// ประโยชน์เหมือนเดิมฝั่ง Supabase คือลดจำนวน query ซ้ำๆ เมื่อมีหลาย request เข้ามาถี่ๆ
const CACHE = {};
const CACHE_TTL_MS = 30 * 1000;

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
  const { error } = await requireClient()
    .from(collection)
    .upsert({ id: cleanDocId, data: clean, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return true;
}

async function deleteDoc(collection, docId) {
  delete CACHE[collection];
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;
  const { error } = await requireClient().from(collection).delete().eq('id', cleanDocId);
  if (error) throw new Error(error.message);
  return true;
}

async function deleteField(collection, docId, fieldName) {
  delete CACHE[collection];
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return false;
  const existing = await getDoc(collection, cleanDocId);
  if (!existing) return false;
  const updated = { ...existing };
  delete updated[fieldName];
  const { error } = await requireClient()
    .from(collection)
    .update({ data: updated, updated_at: new Date().toISOString() })
    .eq('id', cleanDocId);
  if (error) throw new Error(error.message);
  return true;
}

async function listDocs(collection) {
  const now = Date.now();
  if (CACHE[collection] && now - CACHE[collection].timestamp < CACHE_TTL_MS) {
    return CACHE[collection].data;
  }
  try {
    const { data: rows, error } = await requireClient().from(collection).select('data');
    if (error) throw new Error(error.message);
    const result = rows.map((r) => r.data);
    CACHE[collection] = { timestamp: now, data: result };
    return result;
  } catch (err) {
    console.error(`listDocs error for ${collection}:`, err.message);
    if (CACHE[collection] && CACHE[collection].data) {
      return CACHE[collection].data; // fallback ไปใช้ cache รอบก่อนถ้ามี
    }
    throw err;
  }
}

async function getDoc(collection, docId) {
  const cleanDocId = String(docId || '').trim();
  if (!cleanDocId) return null;
  try {
    const { data: row, error } = await requireClient()
      .from(collection)
      .select('data')
      .eq('id', cleanDocId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ? row.data : null;
  } catch (err) {
    console.error(`getDoc error for ${collection}/${cleanDocId}:`, err.message);
    if (CACHE[collection] && Array.isArray(CACHE[collection].data)) {
      return (
        CACHE[collection].data.find(
          (x) => String(x.id || x._id || x._row || x.docId || x['รหัส'] || '') === cleanDocId
        ) || null
      );
    }
    throw err;
  }
}

// รวมคอลเลกชันหลักที่ frontend ต้องใช้แสดงผลทุกหน้าไว้ในเรียกเดียว — frontend เรียกแบบ
// polling ทุก 30 วิ (ดู public/index.html silentRefresh/loadAll) แทนการเปิด Firestore
// listener ตรงจาก client แบบเดิม ร่วมกับ cache ด้านบนนี้ทำให้อ่านจริงจาก DB สูงสุดแค่
// 1 ครั้ง/collection ทุก 30 วิ ไม่ว่าจะมีกี่แท็บ/ผู้ใช้เปิดพร้อมกันก็ตาม
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

module.exports = { SHEETS, COLLECTION, setDoc, deleteDoc, deleteField, listDocs, getDoc, getAllData };
