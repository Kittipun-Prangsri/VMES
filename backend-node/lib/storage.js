// ============== CLOUDINARY IMAGE STORAGE ==============
// อัปโหลดรูปครุภัณฑ์ผ่าน Cloudinary (free tier, ไม่ต้องผูกบัตรเครดิต) แทน Firebase
// Storage ซึ่งตั้งแต่ ก.ย. 2024 บังคับให้โปรเจกต์ต้องอยู่บน Blaze plan ถึงจะสร้าง
// default bucket ใหม่ได้ — ดู https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
// frontend ส่ง base64 มาทาง RPC แล้วให้ backend อัปโหลดแทน เหมือนเดิม

const crypto = require('crypto');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

// destPath เดิมมาจากรูปแบบ Firebase Storage เช่น "equipment-photos/EQ-123-169...jpg"
// แปลงเป็น folder + public_id ของ Cloudinary โดยตัดนามสกุลไฟล์ออก (Cloudinary จัดการเอง)
function toFolderAndPublicId(destPath) {
  const parts = destPath.split('/');
  const fileName = parts.pop().replace(/\.[^.]+$/, '');
  return { folder: parts.join('/'), publicId: fileName };
}

async function uploadBase64Image(base64Data, destPath, contentType) {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    throw new Error('ยังไม่ได้ตั้งค่า CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET');
  }

  const { folder, publicId } = toFolderAndPublicId(destPath);
  const timestamp = Math.floor(Date.now() / 1000);

  const paramsToSign = { folder, public_id: publicId, timestamp };
  const stringToSign = Object.keys(paramsToSign)
    .sort()
    .map((k) => `${k}=${paramsToSign[k]}`)
    .join('&');
  const signature = crypto.createHash('sha1').update(stringToSign + API_SECRET).digest('hex');

  const form = new FormData();
  form.append('file', `data:${contentType || 'image/jpeg'};base64,${base64Data}`);
  form.append('api_key', API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', publicId);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const result = await res.json();
  if (!res.ok) {
    throw new Error(result?.error?.message || 'อัปโหลดรูปไป Cloudinary ไม่สำเร็จ');
  }
  return result.secure_url;
}

module.exports = { uploadBase64Image };
