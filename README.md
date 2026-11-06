# 🚀 VMES System V2.0 — ระบบบริหารยานพาหนะและยืม-คืนอุปกรณ์ ออนไลน์

![VMES System Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Firebase Hosting](https://img.shields.io/badge/Firebase-Hosting-FFCA28?logo=firebase&logoColor=black)
![Node.js API](https://img.shields.io/badge/Node.js-Vercel%20API-000000?logo=nodedotjs&logoColor=white)
![LINE Messaging API](https://img.shields.io/badge/LINE-Messaging%20API-00C300?logo=line&logoColor=white)
![Status](https://img.shields.io/badge/Status-Active%20Production-success)

เว็บแอปพลิเคชันบริหารจัดการยานพาหนะและยืม-คืนอุปกรณ์/ครุภัณฑ์ระดับองค์กร พัฒนาขึ้นสำหรับ **หน่วยงานสารสนเทศและสุขภาพดิจิทัล** เพื่อเพิ่มประสิทธิภาพในการบริหารทรัพยากรองค์กร ติดตามสถานะอุปกรณ์แบบเรียลไทม์ และแจ้งเตือนผ่าน LINE Flex Message และ LINE LIFF App

🌐 **Live Web Application**: [https://vmes.web.app](https://vmes.web.app)

---

## 📌 คุณสมบัติเด่นของระบบ (Key Features)

### 1. ⭐ ระบบบริหารอุปกรณ์และครุภัณฑ์ (Equipment Management System)
- **📦 ระบบยืม-คืนอุปกรณ์ (Borrowing Transactions Log)**:
  - ฟอร์มขอยืมอุปกรณ์ผ่าน **LINE LIFF App** เปิดในแชท LINE ได้ทันทีไม่ต้องสลับแอป
  - ระบบขยายเวลาการยืม และบันทึกสภาพอุปกรณ์เมื่อส่งคืน (ปกติ/ชำรุด)
  - พิมพ์ **ใบยืมครุภัณฑ์ดิจิทัล (PDF Receipt)** พร้อม QR Code สำหรับสแกนตรวจสอบ
  - ระบบค้นหาและกรองสถานะคำขอแบบเรียลไทม์ (รอรับเรื่อง, อยู่ระหว่างยืม, เกินกำหนด, คืนสำเร็จ)
- **🏬 คลังทะเบียนอุปกรณ์ทั้งหมด (Equipment Master Catalog)**:
  - ทะเบียนครุภัณฑ์ในระบบ พร้อมเลข Serial Number, ยี่ห้อ/รุ่น, ที่เก็บประจำห้อง และมูลค่าทรัพย์สิน
  - เช็กยอดคงเหลือพร้อมใช้งานเรียลไทม์ (`🟢 พร้อมยืม`, `📦 อยู่ระหว่างยืม`, `🔴 ชำรุด`)
  - เครื่องมือสร้างและสแกน **QR Code** ประจำตัวเครื่องอุปกรณ์
  - ปุ่ม **`📦 ยืมอุปกรณ์`** สั่งขอยืมได้ในคลิกเดียวจากหน้ารายการคลัง

### 2. 🚗 ระบบบริหารจัดการยานพาหนะ (Vehicle Management System)
- **ข้อมูลรถและสถานะการใช้งาน**: ติดตามทะเบียนรถ ยี่ห้อ รูปถ่าย และสถานะความพร้อม
- **บันทึกการใช้รถ & เลขไมล์**: บันทึกจุดเริ่มต้น-ปลายทาง เลขไมล์ก่อนและหลังเดินทาง
- **จองรถล่วงหน้า (Vehicle Booking)**: ป้องกันการจองรถซ้ำซ้อนด้วยปฏิทินตรวจสอบเวลา
- **การบำรุงรักษา & สภาพรถ (Maintenance & Inspection)**: บันทึกประวัติการซ่อมบำรุง ตรวจเช็กสภาพประจำวัน
- **การใช้น้ำมัน & โควต้า (Fuel Consumption)**: บันทึกค่าน้ำมันและติดตามโควต้าการเติมน้ำมัน
- **จัดการพนักงานขับรถ**: ทะเบียนและตารางปฏิบัติงานของพนักงานขับรถ

### 3. 👥 ระบบผู้ใช้งานและแดชบอร์ด (User & Analytics Dashboard)
- **ภาพรวมสถิติบริหารงาน (Executive Dashboard)**: กราฟสรุปผล Chart.js แสดงแนวโน้มการยืมและการใช้รถ
- **ระบบสิทธิ์ผู้ใช้งาน (Multi-role Authorization)**: แบ่งสิทธิ์ตามบทบาท (`Superadmin`, `Admin`, `User`, `Driver`, `Manager`)
- **LINE & Telegram Notifications**: แจ้งเตือนสถานะผ่าน LINE Flex Message และ LINE LIFF App
- **ประวัติการบันทึก (Audit Log)**: ตรวจสอบการทำรายการย้อนหลังทุกขั้นตอนเพื่อความโปร่งใส

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

- **Frontend**:
  - HTML5 & Vanilla CSS3 (Custom Glassmorphism UI Token, CSS Grid/Flexbox)
  - JavaScript (ES6+ Modern Web Standards)
  - LINE LIFF SDK (`@line/liff`)
  - [Chart.js 4.4](https://www.chartjs.org/) (Interactive Data Visualizations)
  - [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) (PDF Document Generation)
  - [SheetJS XLSX](https://sheetjs.com/) (Excel Exporting)
  - [Html5-QRCode](https://github.com/mebjas/html5-qrcode) & QRCode.js (Camera QR Scanning)
- **Backend & Database**:
  - **Supabase (Postgres)**: ตาราง JSONB แบบเอกสาร (`id`, `data`) ต่อ collection — สร้างด้วย `backend-node/supabase-schema.sql` (เปิด RLS ไม่มี policy เข้าถึงได้เฉพาะ service key ฝั่ง server)
  - **Firebase**: ใช้เฉพาะ Hosting และ Storage (รูปครุภัณฑ์) — ข้อมูลหลักย้ายมา Supabase แล้ว
  - **Node.js / Vercel API**: JSON-RPC (`/api/rpc`), LINE webhook (`/api/line-webhook`), MOPH ID login, cron ตรวจเกินกำหนด
- **Hosting & Deployment**:
  - **Firebase Hosting**: [https://vmes.web.app](https://vmes.web.app)
  - **Vercel**: [https://vmes-backend.vercel.app](https://vmes-backend.vercel.app)

---

## 🧭 โครงสร้างโปรเจกต์

```
index.html                  หน้าเว็บหลัก (แหล่งจริง — `npm run build` คัดลอกไป public/)
public/equipment-page.js    หน้าคลังอุปกรณ์: ค้นหา/เรียง/จัดกลุ่ม/แบ่งหน้า, ฟอร์ม, จัดการสถานที่และหมวดหมู่
public/equipment-labels.js  หน้าต่างพิมพ์ป้ายสติกเกอร์
public/ptouch-label.js      วาดป้าย + ส่งคำสั่ง raster ไป Brother PT-P710BT (Web Serial/Bluetooth)
public/handover-page.js     ใบส่งมอบ-รับคืนครุภัณฑ์
backend-node/api/           endpoint ของ Vercel
backend-node/lib/handlers/  ตรรกะต่อโมดูล (equipment, categories, equipmentHandover, data, ...)
backend-node/lib/whitelist.js  รายชื่อฟังก์ชันที่ /api/rpc เรียกได้
tests/                      เทสต์ (รันด้วย `npm test`)
```

## 🏷️ หมวดหมู่ครุภัณฑ์และสถานที่จัดเก็บ
- **หมวดหมู่ผูกกับ 4 หลักแรกของเลขครุภัณฑ์** เช่น `7440-14-0001/31` → `7440` = อุปกรณ์คอมพิวเตอร์และเครื่องพิมพ์ จัดการที่ปุ่ม 🗂️ จัดการหมวดหมู่ (มีปุ่มจัดหมวดอัตโนมัติจากรหัส พร้อมดูตัวอย่างก่อนบันทึก)
- **สถานที่จัดเก็บ**: จัดการที่ปุ่ม 📍 จัดการสถานที่ (เปลี่ยนชื่อ = อัปเดตอุปกรณ์ทุกชิ้น, ชื่อซ้ำต้องยืนยันก่อนควบรวม)
- **พิมพ์ป้าย Brother PT-P710BT**: ปุ่ม 🏷️ ในคลัง/หน้าพิมพ์ QR — พิมพ์ผ่านบลูทูธตรง (Chrome/Edge บนคอมพิวเตอร์), ผ่านไดรเวอร์ หรือดาวน์โหลด PNG

## 📷 ถ่ายภาพหลายมุมและอ่านป้ายด้วยกล้อง (OCR)
- **ถ่ายหลายมุม**: ในฟอร์มอุปกรณ์/โหมดสำรวจ กดปุ่มมุม (ด้านหน้า/ด้านหลัง/ด้านข้าง/ป้ายครุภัณฑ์/ซีเรียล-รุ่น) เพื่อเปิดกล้อง ระบบติดป้ายชื่อมุมให้ แก้ภายหลังได้ แนบสูงสุด 6 รูป เก็บป้ายชื่อมุมในฟิลด์ `ป้ายกำกับรูป` (map ตาม URL)
- **อ่านป้ายด้วยกล้อง**: ปุ่ม 📷 ถ่ายป้ายเพื่อเติมข้อมูล → อ่านเลขครุภัณฑ์/Serial/รุ่น/ยี่ห้อ แล้วเติมเฉพาะช่องที่ยังว่าง (ไฮไลต์สีเหลืองให้ตรวจ ไม่ทับที่พิมพ์ไว้) ใช้ [Tesseract.js](https://github.com/naptha/tesseract.js) ประมวลผลในเบราว์เซอร์ ภาพไม่ถูกส่งออก แต่ใช้ครั้งแรกต้องมีอินเทอร์เน็ตเพื่อโหลดตัวอ่าน/ข้อมูลภาษาจาก CDN
- โค้ด: `public/ocr-capture.js` (แปลงข้อความเป็นฟิลด์ + เอนจิน), `public/ocr-scanner-ui.js` (หน้าต่างอ่านป้าย)

## 🔎 สำรวจภาคสนามผ่าน LINE (LIFF)
- เปิดจากแชท LINE พิมพ์ "สำรวจ" หรือกดปุ่มในเมนูช่วยเหลือ → LIFF `?tab=survey` → `liff.html` ส่งต่อไป `liff-survey.html` (ใช้ LIFF ID เดิม ไม่ต้องตั้งค่าเพิ่มใน LINE Developers)
- ใช้ได้เฉพาะ admin/manager ที่ผูก LINE แล้ว: backend ตรวจ LIFF access token กับ LINE โดยตรง (`lib/lineAuth.js`) ไม่เชื่อ userId ที่หน้าเว็บส่งมา; ตั้ง `LINE_LOGIN_CHANNEL_ID` ถ้า channel ไม่ใช่ตัวเลขหน้า LIFF ID
- ฟอร์มเหมือนโหมดสำรวจบนเว็บ: ร่างอัตโนมัติ, เช็กเลขซ้ำ/เลือกหมวดจากรหัส, ถ่ายหลายมุม, อ่านป้ายด้วยกล้อง (OCR), อุปกรณ์เชื่อมต่อ, ผูกเลขทีหลัง
- ฟังก์ชัน backend: `getLiffSurveyInfo`, `saveLiffSurveyItem`, `saveLiffSurveyPeripheral`, `uploadLiffSurveyPhoto`, `resolveLiffSurveyTag` (`handlers/liffSurvey.js`)

## 🔐 มาตรฐานความปลอดภัย
- สิทธิ์ admin/manager ตัดสินจากบทบาทใน DB ของ session (ไม่มีรหัส admin ฝังในหน้าเว็บ) — ฟังก์ชันฝั่งเขียนทุกตัวตรวจสิทธิ์ที่ server
- LINE webhook ตรวจ `X-Line-Signature` (ต้องตั้ง `LINE_CHANNEL_SECRET`)
- `getAllData` ไม่ส่งเลขบัตรประชาชน/LINE/Telegram token ของผู้อื่นและ audit log ให้ผู้ใช้ทั่วไป
- ใบส่งมอบ: server ตรวจครุภัณฑ์/หน่วยงาน/ลำดับวันที่ และคำนวณสถานะเอง ผู้บันทึกมาจาก session

## 🛠️ พัฒนา ทดสอบ และ deploy
```bash
npm test                 # เทสต์ทั้งหมด (backend + ฟังก์ชันล้วนของหน้าเว็บ)
npm run build            # คัดลอก index.html/liff*.html ไป public/
npm run deploy           # Firebase Hosting (frontend)
cd backend-node && vercel deploy --prod   # backend
```
ตัวแปร env ของ backend ดู `backend-node/.env.example` (สำคัญ: `SESSION_SECRET`, `LINE_CHANNEL_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`)
ลำดับ deploy: backend ก่อน frontend เสมอเมื่อมีฟังก์ชัน backend ใหม่

## 📄 ใบอนุญาตและการดูแลรักษา (License & Maintenance)

พัฒนาและสงวนลิขสิทธิ์โดย **หน่วยงานสารสนเทศและสุขภาพดิจิทัล**  
ระบบรันบน Firebase Hosting, Vercel และ Supabase
