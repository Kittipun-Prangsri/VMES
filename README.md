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
  - **Firebase Cloud Firestore**: Real-time Database Listener (`onSnapshot`)
  - **Node.js / Vercel API**: Serverless Web API & Webhook Controller (`backend-node/api/line-webhook.js`)
- **Hosting & Deployment**:
  - **Firebase Hosting**: [https://vmes.web.app](https://vmes.web.app)
  - **Vercel**: [https://vmes-backend.vercel.app](https://vmes-backend.vercel.app)

---

## 📄 ใบอนุญาตและการดูแลรักษา (License & Maintenance)

พัฒนาและสงวนลิขสิทธิ์โดย **หน่วยงานสารสนเทศและสุขภาพดิจิทัล**  
ระบบได้รับการออกแบบให้ทำงานแบบ High-Availability (HA) บน Cloud Infrastructure ของ Firebase และ Vercel
