// One-off migration endpoint: copies every document from the old Firestore
// project into the new Supabase JSONB tables (see supabase-schema.sql).
// Protected by the same admin code used elsewhere in this app. Delete this
// file (and redeploy) once the migration has run successfully — it has no
// reason to exist in production afterwards.

const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createClient } = require('@supabase/supabase-js');
const { verifyAdmin } = require('../lib/auth');

const COLLECTIONS = [
  'vehicles', 'usage', 'maintenance', 'fuel', 'fuelQuota',
  'equipment', 'equipmentCategory', 'borrowing', 'users', 'drivers',
  'booking', 'inspection', 'notifications', 'audit', 'settings',
  'departments', 'userCredentials', 'serviceRequests', 'wifiQrLogs',
  'satisfactionRatings', 'attendance',
];

function getFirebaseApp() {
  if (getApps().length) return getApp();
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

module.exports = async function handler(req, res) {
  const key = (req.query && req.query.key) || (req.body && req.body.key);
  if (!verifyAdmin(key)) {
    res.status(403).json({ success: false, message: 'forbidden' });
    return;
  }

  try {
    const fsDb = getFirestore(getFirebaseApp());
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const summary = {};
    for (const col of COLLECTIONS) {
      const snap = await fsDb.collection(col).get();
      const rows = snap.docs.map((d) => ({
        id: d.id,
        data: d.data(),
        updated_at: new Date().toISOString(),
      }));
      summary[col] = { firestoreDocs: rows.length };
      if (rows.length > 0) {
        // batch upsert in chunks of 500 to stay under request size limits
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const { error } = await supabase.from(col).upsert(chunk);
          if (error) {
            summary[col].error = error.message;
            break;
          }
        }
      }
    }

    res.status(200).json({ success: true, summary });
  } catch (err) {
    res.status(200).json({ success: false, message: err.message });
  }
};
