// ============== FIREBASE STORAGE ENGINE (firebase-admin SDK) ==============
// อัปโหลดรูปครุภัณฑ์จากฝั่ง backend เท่านั้น (เหมือน Firestore write) — frontend
// ไม่เชื่อม Storage SDK ตรงๆ ส่ง base64 มาทาง RPC แล้วให้ backend อัปโหลดแทน

const { getStorage } = require('firebase-admin/storage');
const { app } = require('./firestore');

const bucket = getStorage(app).bucket();

async function uploadBase64Image(base64Data, destPath, contentType) {
  const buffer = Buffer.from(base64Data, 'base64');
  const file = bucket.file(destPath);
  await file.save(buffer, {
    metadata: { contentType: contentType || 'image/jpeg' },
    public: true,
  });
  return `https://storage.googleapis.com/${bucket.name}/${destPath}`;
}

module.exports = { uploadBase64Image };
