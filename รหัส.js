/**
 * ============================================================
 * ระบบยืม-คืนอุปกรณ์ งานสารสนเทศ
 * Government Vehicle & Equipment Management System
 * Version: 2.0 Professional (Firestore-only JSON API + LINE Bot)
 * ------------------------------------------------------------
 * สถาปัตยกรรม: Apps Script เป็น backend แบบ JSON API ล้วนๆ
 * คุยกับ Firebase Cloud Firestore ผ่าน REST API + OAuth (ScriptApp
 * .getOAuthToken()) ไม่มี Google Sheets เป็นฐานข้อมูลอีกต่อไป
 * ไม่มีการเสิร์ฟหน้าเว็บเอง (ใช้ Firebase Hosting แทน)
 * ============================================================
 */

// ============== CONFIG ==============
const DEFAULT_LINE_TOKEN = "sDV+5aVTzTUSzTH/jsiir1M5CPe6YZ0Na0M92iaOB2YIUN2JzAUX1mnFRjKb7W6aKzZJFUx9lvKZtio0HftzpEGYSAQxI1bpk6Ap2VJlRc5VxD7XMMEpz3eKqG/AFDoNmsCfgZGg7AWJMjrEph5IYQdB04t89/1O/w1cDnyilFU=";
const DEFAULT_LINE_GROUP_ID = "Ud205ebdc3e0c160f6e1e6c396c32f7f9";
const DEFAULT_ADMIN_CODE = "11192";
const DEFAULT_FIREBASE_PROJECT_ID = "phan-thong";
const DEFAULT_FIREBASE_API_KEY = "AIzaSyBzhr85eBAXSnbvNZpsFeGXV2ZpN8Iqhfg";
const SYSTEM_NAME = "ระบบยืม-คืน อุปกรณ์ งานสารสนเทศ";

// แผนที่ชื่อ (เดิมชื่อชีต ปัจจุบันใช้เป็นชื่อ collection ของ Firestore เท่านั้น)
const SHEET_TO_FIRESTORE_COLLECTION = {
  'รถทั้งหมด': 'vehicles',
  'การใช้รถ': 'usage',
  'บำรุงรักษา': 'maintenance',
  'น้ำมัน': 'fuel',
  'โควต้าน้ำมัน': 'fuelQuota',
  'อุปกรณ์': 'equipment',
  'หมวดอุปกรณ์': 'equipmentCategory',
  'ยืม-คืน': 'borrowing',
  'ผู้ใช้งาน': 'users',
  'พนักงานขับรถ': 'drivers',
  'จองรถล่วงหน้า': 'booking',
  'ตรวจสภาพรถ': 'inspection',
  'ประวัติแจ้งเตือน': 'notifications',
  'ประวัติระบบ': 'audit',
  'ตั้งค่าระบบ': 'settings',
  'หน่วยงาน': 'departments'
};

function getScriptProp_(key, defaultValue) {
  try {
    const val = PropertiesService.getScriptProperties().getProperty(key);
    if (val !== null && val !== undefined && String(val).trim() !== '') return String(val).trim();
  } catch (e) {}
  return defaultValue;
}

function getLineToken() {
  return getScriptProp_('LINE_TOKEN', DEFAULT_LINE_TOKEN);
}

function getLineGroupId() {
  return getScriptProp_('LINE_GROUP_ID', DEFAULT_LINE_GROUP_ID);
}

function getAdminCode() {
  return getScriptProp_('ADMIN_CODE', DEFAULT_ADMIN_CODE);
}

function getFirebaseProjectId() {
  return getScriptProp_('FIREBASE_PROJECT_ID', DEFAULT_FIREBASE_PROJECT_ID);
}

function getFirebaseApiKey() {
  return getScriptProp_('FIREBASE_API_KEY', DEFAULT_FIREBASE_API_KEY);
}

function hashPassword_(pass) {
  if (!pass) return '';
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pass, Utilities.Charset.UTF_8);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

// หมายเหตุ: ฟังก์ชันนี้แก้ไข Script Properties ของระบบ (LINE Token, Admin Code,
// Firebase config ฯลฯ) — ไม่เปิดผ่าน API สาธารณะ ต้องรันจาก Apps Script editor เท่านั้น
// TEMPORARY: ตั้งค่า Service Account credentials ครั้งเดียว — ลบฟังก์ชันนี้ทิ้งได้ทันทีหลังใช้งาน
function setServiceAccountCreds_(adminCode, clientEmail, privateKey) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SA_CLIENT_EMAIL', clientEmail.trim());
  props.setProperty('SA_PRIVATE_KEY', privateKey);
  CacheService.getScriptCache().remove('sa_token');
  return { success: true, message: 'บันทึก Service Account credentials แล้ว' };
}

function setSystemSecurityProperties(lineToken, lineGroupId, adminCode, ssId, firebaseProjectId, firebaseApiKey) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (lineToken) props.setProperty('LINE_TOKEN', lineToken.trim());
    if (lineGroupId) props.setProperty('LINE_GROUP_ID', lineGroupId.trim());
    if (adminCode) props.setProperty('ADMIN_CODE', adminCode.trim());
    if (firebaseProjectId) props.setProperty('FIREBASE_PROJECT_ID', firebaseProjectId.trim());
    if (firebaseApiKey) props.setProperty('FIREBASE_API_KEY', firebaseApiKey.trim());
    logAudit_('บันทึก Script Properties', 'admin', 'อัปเดตการตั้งค่าระบบความปลอดภัยเรียบร้อย');
    return { success: true, message: 'บันทึก Script Properties เรียบร้อยแล้ว' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

const SHEETS = {
  VEHICLES: 'รถทั้งหมด',
  USAGE: 'การใช้รถ',
  MAINTENANCE: 'บำรุงรักษา',
  FUEL: 'น้ำมัน',
  FUEL_QUOTA: 'โควต้าน้ำมัน',
  EQUIPMENT: 'อุปกรณ์',
  EQUIPMENT_CATEGORY: 'หมวดอุปกรณ์',
  BORROWING: 'ยืม-คืน',
  USERS: 'ผู้ใช้งาน',
  DRIVERS: 'พนักงานขับรถ',
  BOOKING: 'จองรถล่วงหน้า',
  INSPECTION: 'ตรวจสภาพรถ',
  NOTIFICATIONS: 'ประวัติแจ้งเตือน',
  AUDIT: 'ประวัติระบบ',
  SETTINGS: 'ตั้งค่าระบบ',
  DEPARTMENTS: 'หน่วยงาน'
};

// ============== ENTRY POINTS ==============
// LINE Reply Flex webhook revision: valid solid header colors (no gradient objects).

// doGet: เหลือแค่ health-check ง่ายๆ (ไม่เสิร์ฟหน้าเว็บอีกต่อไป — ใช้ Firebase Hosting แทน)
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    system: SYSTEM_NAME,
    time: nowStr_()
  })).setMimeType(ContentService.MimeType.JSON);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// รายชื่อฟังก์ชันที่อนุญาตให้เรียกจากภายนอกผ่าน doPost({fn, args}) เท่านั้น
// (whitelist ชัดเจน ไม่ใช่เปิดหมด) — ฟังก์ชันดูแลระบบ/อันตรายที่ไม่ควรเปิดจากเน็ต
// (setupSystem, setSystemSecurityProperties, saveFirebaseConfig, setupDailyTrigger,
// verifyAdmin, migrateExistingSheetToFirestoreOnce_) จะไม่อยู่ในลิสต์นี้
const API_WHITELIST = {
  // Auth / Bootstrap
  login: login,
  getBootstrapInfo: getBootstrapInfo,

  // Vehicles
  saveVehicle: saveVehicle,
  deleteVehicle: deleteVehicle,

  // Usage
  saveUsage: saveUsage,
  returnVehicle: returnVehicle,

  // Maintenance
  saveMaintenance: saveMaintenance,
  deleteMaintenance: deleteMaintenance,

  // Fuel
  saveFuel: saveFuel,
  deleteFuel: deleteFuel,

  // Equipment
  saveEquipment: saveEquipment,
  deleteEquipment: deleteEquipment,

  // Borrowing
  saveBorrowing: saveBorrowing,
  updateBorrowingStatus: updateBorrowingStatus,
  requestBorrowExtension: requestBorrowExtension,
  approveBorrowExtension: approveBorrowExtension,
  getBorrowingByCode: getBorrowingByCode,
  deleteBorrowing: deleteBorrowing,

  // Users
  saveUser: saveUser,
  deleteUser: deleteUser,

  // Drivers
  saveDriver: saveDriver,
  deleteDriver: deleteDriver,

  // Booking
  saveBooking: saveBooking,
  approveBooking: approveBooking,
  deleteBooking: deleteBooking,

  // Inspection
  saveInspection: saveInspection,
  deleteInspection: deleteInspection,

  // Departments
  saveDepartment: saveDepartment,
  deleteDepartment: deleteDepartment,

  // Import
  importUsers: importUsers,
  importEquipment: importEquipment,
  importVehicles: importVehicles,
  importDrivers: importDrivers,
  fetchGoogleSheetData: fetchGoogleSheetData,

  // Reports / Dashboard / Alerts
  exportToCSV: exportToCSV,
  getDashboard: getDashboard,
  checkOverdue: checkOverdue,

  // Settings
  saveSystemSettings: saveSystemSettings,

  // Notifications / Testing
  testLineNotify: testLineNotify,
  testUserLine: testUserLine,
  testTelegramNotification: testTelegramNotification,

  // Password
  requestPasswordResetNotification: requestPasswordResetNotification
};

// doPost: แยกเป็น 2 กรณี — LINE webhook เดิม ({events:[...]}) กับ JSON API ใหม่ ({fn, args})
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return ContentService.createTextOutput('OK');
    const contents = JSON.parse(e.postData.contents);

    // ---------- LINE WEBHOOK (Auto-Reply via Free ReplyToken) — โค้ดเดิมไม่แตะ ----------
    if (contents.events) {
      if (contents.events.length === 0) return ContentService.createTextOutput('OK');

      const event = contents.events[0];
      const replyToken = event.replyToken;
      const userId = event.source ? event.source.userId : '';
      const userMessage = (event.message && event.message.text) ? String(event.message.text).trim() : '';

      if (!replyToken) return ContentService.createTextOutput('OK');

      const msgLower = userMessage.toLowerCase();

      // 1. ขอไอดี
      if (msgLower === "ขอไอดี" || msgLower === "id" || msgLower === "user id") {
        const truncatedUserId = safeTruncate_(userId, 50);
        const flexContent = {
          type: "bubble",
          size: "mega",
          header: {
            type: "box",
            layout: "vertical",
            backgroundColor: "#4f46e5",
            paddingAll: "20px",
            contents: [
              { type: "text", text: "🆔 LINE User ID", color: "#ffffff", size: "lg", weight: "bold" },
              { type: "text", text: "รหัสประจำตัวของคุณในระบบ LINE", color: "#bfdbfe", size: "xs", margin: "xs" }
            ]
          },
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            paddingAll: "20px",
            contents: [
              {
                type: "box",
                layout: "vertical",
                backgroundColor: "#f8fafc",
                cornerRadius: "8px",
                paddingAll: "16px",
                borderWidth: "1px",
                borderColor: "#e2e8f0",
                contents: [
                  { type: "text", text: "LINE User ID", size: "xs", color: "#64748b", weight: "bold" },
                  { type: "text", text: truncatedUserId, size: "sm", color: "#0f172a", margin: "xs", weight: "bold", wrap: true }
                ]
              },
              {
                type: "text",
                text: "💡 นำ ID นี้ระบุในโปรไฟล์ผู้ใช้งานของระบบ เพื่อรับการแจ้งเตือนและติดตามสถานะการยืม-คืนอุปกรณ์",
                size: "xs",
                color: "#64748b",
                wrap: true,
                margin: "md"
              }
            ]
          },
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "12px",
            backgroundColor: "#f1f5f9",
            contents: [
              { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
            ]
          }
        };
        replyLineFlex_(replyToken, "🆔 LINE User ID ของคุณ", flexContent);
      }
      // 2. เช็ครถยนต์
      else if (msgLower.indexOf("เช็ครถ") !== -1 || msgLower === "รถ" || msgLower === "รถยนต์") {
        const vehicles = safeGet_(getVehicles);
        if (vehicles.length === 0) {
          const flexContent = {
            type: "bubble",
            size: "mega",
            header: {
              type: "box",
              layout: "vertical",
              backgroundColor: "#ef4444",
              paddingAll: "20px",
              contents: [
                { type: "text", text: "🚗 สถานะรถยนต์", color: "#ffffff", size: "lg", weight: "bold" }
              ]
            },
            body: {
              type: "box",
              layout: "vertical",
              paddingAll: "20px",
              contents: [
                { type: "text", text: "❌ ไม่พบข้อมูลรถยนต์ในระบบในขณะนี้", size: "sm", color: "#64748b", wrap: true }
              ]
            },
            footer: {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              backgroundColor: "#f1f5f9",
              contents: [
                { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
              ]
            }
          };
          replyLineFlex_(replyToken, "🚗 ไม่พบข้อมูลรถยนต์ในระบบ", flexContent);
        } else {
          const rows = vehicles.slice(0, 10).map((v, idx) => {
            const status = safeTruncate_(v['สถานะ'] || '', 20);
            const statusIcon = status === 'พร้อมใช้งาน' ? '🟢' : '🟡';
            const plate = safeTruncate_(v['ทะเบียน'] || v['รหัส'] || '-', 15);
            const name = safeTruncate_((v['ยี่ห้อ'] || '') + ' ' + (v['รุ่น'] || ''), 25);
            return {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              margin: idx === 0 ? "none" : "sm",
              alignItems: "center",
              contents: [
                { type: "text", text: statusIcon, width: "18px", size: "sm" },
                { type: "text", text: plate, size: "sm", weight: "bold", color: "#0f172a", flex: 3 },
                { type: "text", text: name, size: "sm", color: "#475569", flex: 5 },
                { type: "text", text: status, size: "xs", color: status === 'พร้อมใช้งาน' ? "#10b981" : "#d97706", align: "end", flex: 3, weight: "bold" }
              ]
            };
          });

          const flexContent = {
            type: "bubble",
            size: "mega",
            header: {
              type: "box",
              layout: "vertical",
              backgroundColor: "#0284c7",
              paddingAll: "20px",
              contents: [
                { type: "text", text: "🚗 สถานะยานพาหนะ", color: "#ffffff", size: "lg", weight: "bold" },
                { type: "text", text: "รายการรถยนต์ทั้งหมดในระบบ", color: "#e0f2fe", size: "xs", margin: "xs" }
              ]
            },
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              paddingAll: "20px",
              contents: [
                {
                  type: "box",
                  layout: "vertical",
                  spacing: "sm",
                  contents: rows
                },
                vehicles.length > 10 ? {
                  type: "text",
                  text: `* แสดง 10 คันแรก จากทั้งหมด ${vehicles.length} คัน`,
                  size: "xxs",
                  color: "#64748b",
                  margin: "md",
                  style: "italic"
                } : { type: "spacer", size: "xs" }
              ]
            },
            footer: {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              backgroundColor: "#f1f5f9",
              contents: [
                { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
              ]
            }
          };
          replyLineFlex_(replyToken, "🚗 สรุปสถานะรถยนต์", flexContent);
        }
      }
      // 3. เช็คอุปกรณ์คงเหลือ
      else if (msgLower.indexOf("เช็คอุปกรณ์") !== -1 || msgLower === "อุปกรณ์" || msgLower.indexOf("คลัง") !== -1) {
        const equipment = safeGet_(getEquipment);
        if (equipment.length === 0) {
          const flexContent = {
            type: "bubble",
            size: "mega",
            header: {
              type: "box",
              layout: "vertical",
              backgroundColor: "#ef4444",
              paddingAll: "20px",
              contents: [
                { type: "text", text: "💻 คลังอุปกรณ์", color: "#ffffff", size: "lg", weight: "bold" }
              ]
            },
            body: {
              type: "box",
              layout: "vertical",
              paddingAll: "20px",
              contents: [
                { type: "text", text: "❌ ไม่พบข้อมูลอุปกรณ์ในคลัง", size: "sm", color: "#64748b", wrap: true }
              ]
            },
            footer: {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              backgroundColor: "#f1f5f9",
              contents: [
                { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
              ]
            }
          };
          replyLineFlex_(replyToken, "💻 ไม่พบข้อมูลอุปกรณ์ในคลัง", flexContent);
        } else {
          const rows = equipment.slice(0, 10).map((eq, idx) => {
            const name = safeTruncate_(eq['ชื่ออุปกรณ์'] || '', 25);
            const category = safeTruncate_(eq['หมวดหมู่'] || '', 15);
            const qty = parseFloat(eq['จำนวน']) || 0;
            const unit = safeTruncate_(eq['หน่วยนับ'] || 'รายการ', 8);
            return {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              margin: idx === 0 ? "none" : "sm",
              alignItems: "center",
              contents: [
                { type: "text", text: "📦", width: "18px", size: "sm" },
                {
                  type: "box",
                  layout: "vertical",
                  flex: 6,
                  contents: [
                    { type: "text", text: name, size: "sm", weight: "bold", color: "#0f172a" },
                    { type: "text", text: category, size: "xxs", color: "#64748b" }
                  ]
                },
                { type: "text", text: qty + ' ' + unit, size: "sm", color: qty > 0 ? "#0f172a" : "#ef4444", align: "end", flex: 4, weight: "bold" }
              ]
            };
          });

          const flexContent = {
            type: "bubble",
            size: "mega",
            header: {
              type: "box",
              layout: "vertical",
              backgroundColor: "#0d9488",
              paddingAll: "20px",
              contents: [
                { type: "text", text: "💻 คลังอุปกรณ์คงเหลือ", color: "#ffffff", size: "lg", weight: "bold" },
                { type: "text", text: "รายการพัสดุและอุปกรณ์ที่พร้อมให้ยืม", color: "#ccfbf1", size: "xs", margin: "xs" }
              ]
            },
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              paddingAll: "20px",
              contents: [
                {
                  type: "box",
                  layout: "vertical",
                  spacing: "sm",
                  contents: rows
                },
                equipment.length > 10 ? {
                  type: "text",
                  text: `* แสดง 10 รายการแรก จากทั้งหมด ${equipment.length} รายการ`,
                  size: "xxs",
                  color: "#64748b",
                  margin: "md",
                  style: "italic"
                } : { type: "spacer", size: "xs" }
              ]
            },
            footer: {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              backgroundColor: "#f1f5f9",
              contents: [
                { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
              ]
            }
          };
          replyLineFlex_(replyToken, "💻 สรุปคลังอุปกรณ์คงเหลือ", flexContent);
        }
      }
      // 4. เช็คคำขอยืม
      else if (msgLower.indexOf("คำขอ") !== -1 || msgLower.indexOf("ยืม") !== -1) {
        const borrowing = safeGet_(getBorrowing);
        if (borrowing.length === 0) {
          const flexContent = {
            type: "bubble",
            size: "mega",
            header: {
              type: "box",
              layout: "vertical",
              backgroundColor: "#ef4444",
              paddingAll: "20px",
              contents: [
                { type: "text", text: "📋 รายการคำขอยืม", color: "#ffffff", size: "lg", weight: "bold" }
              ]
            },
            body: {
              type: "box",
              layout: "vertical",
              paddingAll: "20px",
              contents: [
                { type: "text", text: "📋 ไม่พบข้อมูลคำขอยืมในระบบ", size: "sm", color: "#64748b", wrap: true }
              ]
            },
            footer: {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              backgroundColor: "#f1f5f9",
              contents: [
                { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
              ]
            }
          };
          replyLineFlex_(replyToken, "📋 ไม่พบข้อมูลคำขอยืมในระบบ", flexContent);
        } else {
          const rows = borrowing.slice(0, 5).map((b, idx) => {
            const id = safeTruncate_(b['รหัส'] || '-', 12);
            const eqName = safeTruncate_(b['ชื่ออุปกรณ์'] || '-', 25);
            const borrower = safeTruncate_(b['ผู้ขอยืม'] || '-', 15);
            const status = b['สถานะ'] || '-';
            const qty = b['จำนวน'] || 1;

            const statusColors = {
              'รอรับเรื่อง': "#f59e0b",
              'รับเรื่องแล้ว': "#3b82f6",
              'อยู่ในระหว่างการยืม': "#8b5cf6",
              'คืนเสร็จสิ้น': "#10b981",
              'ยกเลิก': "#6b7280"
            };
            const color = statusColors[status] || "#3b82f6";

            return {
              type: "box",
              layout: "vertical",
              backgroundColor: "#f8fafc",
              cornerRadius: "8px",
              paddingAll: "12px",
              margin: idx === 0 ? "none" : "sm",
              borderWidth: "1px",
              borderColor: "#e2e8f0",
              contents: [
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "text", text: id, size: "xs", weight: "bold", color: "#1e40af" },
                    { type: "text", text: status, size: "xs", color: color, align: "end", weight: "bold" }
                  ]
                },
                { type: "text", text: eqName + ' × ' + qty, size: "sm", weight: "bold", color: "#0f172a", margin: "xs" },
                { type: "text", text: "👤 ผู้ยืม: " + borrower, size: "xs", color: "#64748b", margin: "xs" }
              ]
            };
          });

          const flexContent = {
            type: "bubble",
            size: "mega",
            header: {
              type: "box",
              layout: "vertical",
              backgroundColor: "#4f46e5",
              paddingAll: "20px",
              contents: [
                { type: "text", text: "📋 คำขอยืมล่าสุด", color: "#ffffff", size: "lg", weight: "bold" },
                { type: "text", text: "รายการที่มีความเคลื่อนไหวล่าสุดในระบบ", color: "#e0e7ff", size: "xs", margin: "xs" }
              ]
            },
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              paddingAll: "20px",
              contents: rows
            },
            footer: {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              backgroundColor: "#f1f5f9",
              contents: [
                { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
              ]
            }
          };
          replyLineFlex_(replyToken, "📋 คำขอยืมล่าสุด", flexContent);
        }
      }
      // 5. ค้นหารหัส BR- / EQ-
      else if (userMessage.toUpperCase().indexOf("BR-") === 0 || userMessage.toUpperCase().indexOf("EQ-") === 0) {
        const q = userMessage.toUpperCase();
        if (q.indexOf("BR-") === 0) {
          const borrowing = safeGet_(getBorrowing);
          const found = borrowing.find(b => String(b['รหัส'] || '').toUpperCase() === q);
          if (found) {
            const id = safeTruncate_(found['รหัส'] || '-', 12);
            const eqName = safeTruncate_(found['ชื่ออุปกรณ์'] || '-', 40);
            const qty = found['จำนวน'] || 1;
            const borrower = safeTruncate_(found['ผู้ขอยืม'] || '-', 30);
            const dept = safeTruncate_(found['หน่วยงาน'] || '-', 30);
            const dateBorrow = safeTruncate_(found['วันที่ขอยืม'] || '-', 20);
            const dateReturn = safeTruncate_(found['วันที่ครบกำหนด'] || '-', 20);
            const status = found['สถานะ'] || '-';
            const purpose = safeTruncate_(found['วัตถุประสงค์'] || '-', 50);

            const statusMap = {
              'รอรับเรื่อง':       { color: '#f59e0b', icon: '📥', desc: 'มีคำขอยืมใหม่' },
              'รับเรื่องแล้ว':      { color: '#3b82f6', icon: '✅', desc: 'รับเรื่องเรียบร้อย' },
              'อยู่ในระหว่างการยืม':  { color: '#8b5cf6', icon: '📦', desc: 'ส่งมอบอุปกรณ์แล้ว' },
              'ถึงวันครบกำหนดคืน': { color: '#ef4444', icon: '⏰', desc: 'ครบกำหนดคืนวันนี้ / เกินกำหนด' },
              'ขอขยายเวลา':        { color: '#d97706', icon: '⏳', desc: 'ผู้ยืมขอขยายเวลาส่งคืน' },
              'อนุมัติขยายเวลา':    { color: '#10b981', icon: '👍', desc: 'อนุมัติขยายเวลาเรียบร้อย' },
              'อยู่ในระหว่างการคืน':  { color: '#06b6d4', icon: '🔄', desc: 'อยู่ระหว่างตรวจรับ' },
              'คืนเสร็จสิ้น':        { color: '#10b981', icon: '✔️', desc: 'คืนสำเร็จ' },
              'ยกเลิก':            { color: '#6b7280', icon: '❌', desc: 'รายการถูกยกเลิก' }
            };
            const meta = statusMap[status] || { color: '#3b82f6', icon: '📦', desc: status };

            const footerButtons = [
              {
                type: 'button', style: 'primary', color: '#1e40af', height: 'sm',
                action: { type: 'uri', label: '🌐 เปิดดูในระบบ', uri: 'https://vmes.web.app/#borrowing' }
              }
            ];

            if (status === 'รอรับเรื่อง') {
              footerButtons.unshift({
                type: 'button', style: 'secondary', height: 'sm',
                action: { type: 'message', label: '✅ ตอบรับคำขอยืมนี้', text: 'เช็คคำขอ ' + id }
              });
            } else if (status === 'อยู่ในระหว่างการยืม' || status === 'ถึงวันครบกำหนดคืน') {
              footerButtons.unshift({
                type: 'button', style: 'secondary', height: 'sm',
                action: { type: 'message', label: '⏳ ขอขยายเวลาคืน', text: 'ขอขยายเวลา ' + id }
              });
            }

            const flexContent = {
              type: 'bubble', size: 'mega',
              header: {
                type: 'box', layout: 'vertical',
                backgroundColor: meta.color, paddingAll: '20px',
                contents: [
                  { type: 'text', text: meta.icon + ' รายละเอียดคำขอยืม', color: '#ffffff', size: 'lg', weight: 'bold' },
                  { type: 'text', text: meta.desc, color: '#ffffff', size: 'sm', margin: 'sm' }
                ]
              },
              body: {
                type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
                contents: [
                  {
                    type: 'box', layout: 'vertical',
                    backgroundColor: '#f8fafc', cornerRadius: '12px', paddingAll: '16px',
                    contents: [
                      { type: 'text', text: 'อุปกรณ์ที่ยืม', size: 'xs', color: '#64748b' },
                      { type: 'text', text: eqName, size: 'md', weight: 'bold', color: '#0f172a', wrap: true },
                      { type: 'text', text: 'จำนวน ' + qty + ' รายการ', size: 'sm', color: '#64748b', margin: 'xs' }
                    ]
                  },
                  { type: 'separator', margin: 'md' },
                  {
                    type: 'box', layout: 'vertical', spacing: 'sm',
                    contents: [
                      flexRow_('🆔 เลขคำขอ', id),
                      flexRow_('👤 ผู้ขอยืม', borrower),
                      flexRow_('🏢 หน่วยงาน', dept),
                      flexRow_('📅 วันที่ยืม', dateBorrow),
                      flexRow_('📅 ครบกำหนดคืน', dateReturn),
                      flexRow_('🎯 วัตถุประสงค์', purpose),
                      flexRow_('📌 สถานะ', status)
                    ]
                  }
                ]
              },
              footer: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', backgroundColor: '#f1f5f9',
                contents: [
                  ...footerButtons,
                  { type: 'text', text: '⏱ ' + nowStr_() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' }
                ]
              }
            };
            replyLineFlex_(replyToken, "📋 รายละเอียดคำขอยืม " + id, flexContent);
          } else {
            const flexContent = {
              type: "bubble",
              size: "mega",
              header: {
                type: "box",
                layout: "vertical",
                backgroundColor: "#ef4444",
                paddingAll: "20px",
                contents: [
                  { type: "text", text: "❌ ไม่พบข้อมูลคำขอ", color: "#ffffff", size: "lg", weight: "bold" }
                ]
              },
              body: {
                type: "box",
                layout: "vertical",
                paddingAll: "20px",
                contents: [
                  { type: "text", text: "ไม่พบข้อมูลคำขอยืมรหัส " + safeTruncate_(q, 20) + " ในระบบ", size: "sm", color: "#64748b", wrap: true }
                ]
              },
              footer: {
                type: "box",
                layout: "vertical",
                paddingAll: "12px",
                backgroundColor: "#f1f5f9",
                contents: [
                  { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
                ]
              }
            };
            replyLineFlex_(replyToken, "❌ ไม่พบคำขอยืมรหัส " + safeTruncate_(q, 20), flexContent);
          }
        } else {
          const equipment = safeGet_(getEquipment);
          const found = equipment.find(e => String(e['รหัส'] || '').toUpperCase() === q);
          if (found) {
            const id = safeTruncate_(found['รหัส'] || '-', 12);
            const eqName = safeTruncate_(found['ชื่ออุปกรณ์'] || '-', 40);
            const category = safeTruncate_(found['หมวดหมู่'] || '-', 30);
            const brand = safeTruncate_(found['ยี่ห้อ'] || '-', 30);
            const model = safeTruncate_(found['รุ่น'] || '-', 30);
            const status = safeTruncate_(found['สถานะ'] || '-', 30);
            const storage = safeTruncate_(found['ที่เก็บ'] || '-', 30);

            const flexContent = {
              type: "bubble",
              size: "mega",
              header: {
                type: "box",
                layout: "vertical",
                backgroundColor: "#0ea5e9",
                paddingAll: "20px",
                contents: [
                  { type: "text", text: "💻 รายละเอียดอุปกรณ์", color: "#ffffff", size: "lg", weight: "bold" },
                  { type: "text", text: "ข้อมูลรายละเอียดของพัสดุ/อุปกรณ์ในคลัง", color: "#dbeafe", size: "xs", margin: "xs" }
                ]
              },
              body: {
                type: "box",
                layout: "vertical",
                spacing: "md",
                paddingAll: "20px",
                contents: [
                  {
                    type: "box",
                    layout: "vertical",
                    backgroundColor: "#f8fafc",
                    cornerRadius: "12px",
                    paddingAll: "16px",
                    contents: [
                      { type: "text", text: "ชื่ออุปกรณ์", size: "xs", color: "#64748b" },
                      { type: "text", text: eqName, size: "md", weight: "bold", color: "#0f172a", wrap: true }
                    ]
                  },
                  { type: "separator", margin: "md" },
                  {
                    type: "box",
                    layout: "vertical",
                    spacing: "sm",
                    contents: [
                      flexRow_('🆔 รหัสอุปกรณ์', id),
                      flexRow_('📦 หมวดหมู่', category),
                      flexRow_('🏷️ ยี่ห้อ/รุ่น', brand + " " + model),
                      flexRow_('📍 ที่เก็บ', storage),
                      flexRow_('📌 สถานะ', status)
                    ]
                  }
                ]
              },
              footer: {
                type: "box",
                layout: "vertical",
                paddingAll: "12px",
                backgroundColor: "#f1f5f9",
                contents: [
                  { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
                ]
              }
            };
            replyLineFlex_(replyToken, "💻 รายละเอียดอุปกรณ์ " + id, flexContent);
          } else {
            const flexContent = {
              type: "bubble",
              size: "mega",
              header: {
                type: "box",
                layout: "vertical",
                backgroundColor: "#ef4444",
                paddingAll: "20px",
                contents: [
                  { type: "text", text: "❌ ไม่พบข้อมูลอุปกรณ์", color: "#ffffff", size: "lg", weight: "bold" }
                ]
              },
              body: {
                type: "box",
                layout: "vertical",
                paddingAll: "20px",
                contents: [
                  { type: "text", text: "ไม่พบอุปกรณ์รหัส " + safeTruncate_(q, 20) + " ในระบบ", size: "sm", color: "#64748b", wrap: true }
                ]
              },
              footer: {
                type: "box",
                layout: "vertical",
                paddingAll: "12px",
                backgroundColor: "#f1f5f9",
                contents: [
                  { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
                ]
              }
            };
            replyLineFlex_(replyToken, "❌ ไม่พบอุปกรณ์รหัส " + safeTruncate_(q, 20), flexContent);
          }
        }
      }
      // 6. เมนูช่วยเหลือ
      else {
        const flexContent = {
          type: "bubble",
          size: "mega",
          header: {
            type: "box",
            layout: "vertical",
            backgroundColor: "#334155",
            paddingAll: "20px",
            contents: [
              { type: "text", text: "🤖 เมนูช่วยเหลือ (Help Menu)", color: "#ffffff", size: "lg", weight: "bold" },
              { type: "text", text: "ระบบบริหารยานพาหนะและยืม-คืนอุปกรณ์", color: "#cbd5e1", size: "xs", margin: "xs" }
            ]
          },
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            paddingAll: "20px",
            contents: [
              {
                type: "text",
                text: "ยินดีต้อนรับสู่ระบบช่วยอำนวยความสะดวกผ่าน LINE Bot คุณสามารถพิมพ์ข้อความ หรือกดปุ่มด้านล่างเพื่อทำรายการได้ทันที:",
                size: "sm",
                color: "#475569",
                wrap: true
              },
              {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                contents: [
                  {
                    type: "button",
                    style: "secondary",
                    height: "sm",
                    action: { type: "message", label: "🚗 เช็คสถานะรถยนต์", text: "เช็คสถานะรถยนต์" }
                  },
                  {
                    type: "button",
                    style: "secondary",
                    height: "sm",
                    action: { type: "message", label: "💻 เช็คอุปกรณ์ในคลัง", text: "เช็คคลังอุปกรณ์" }
                  },
                  {
                    type: "button",
                    style: "secondary",
                    height: "sm",
                    action: { type: "message", label: "📋 เช็ครายการคำขอยืม", text: "เช็คคำขอยืม" }
                  },
                  {
                    type: "button",
                    style: "secondary",
                    height: "sm",
                    action: { type: "message", label: "🆔 ขอ LINE User ID", text: "ขอไอดี" }
                  }
                ]
              },
              {
                type: "text",
                text: "💡 หรือระบุรหัสรายการ เช่น BR-xxx หรือ EQ-xxx เพื่อดูรายละเอียดสินค้าหรือรายการยืมได้โดยตรง",
                size: "xs",
                color: "#64748b",
                wrap: true,
                margin: "sm",
                style: "italic"
              }
            ]
          },
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "12px",
            backgroundColor: "#f1f5f9",
            contents: [
              { type: "text", text: SYSTEM_NAME, size: "xxs", color: "#94a3b8", align: "center" }
            ]
          }
        };
        replyLineFlex_(replyToken, "🤖 เมนูช่วยเหลือระบบ VMES", flexContent);
      }

      return ContentService.createTextOutput('OK');
    }

    // ---------- JSON API (fetch แบบ text/plain จาก frontend) ----------
    if (contents.fn) {
      const handler = API_WHITELIST[contents.fn];
      if (!handler) return jsonOutput_({ success: false, message: 'Unknown function' });
      try {
        const result = handler.apply(null, contents.args || []);
        return jsonOutput_(result);
      } catch (err) {
        return jsonOutput_({ success: false, message: err.message });
      }
    }

    return ContentService.createTextOutput('OK');
  } catch (err) {
    return ContentService.createTextOutput('Error');
  }
}

// ============== FIREBASE FIRESTORE ENGINE (REST API, OAuth Bearer) ==============
function getFirestoreCollectionName_(sheetOrColName) {
  return SHEET_TO_FIRESTORE_COLLECTION[sheetOrColName] || sheetOrColName;
}

function jsToFirestoreValue_(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(jsToFirestoreValue_) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (let k in val) {
      if (val[k] !== undefined) fields[k] = jsToFirestoreValue_(val[k]);
    }
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(val) };
}

// ตัวกลับของ jsToFirestoreValue_: แปลงค่า Firestore field เดี่ยวๆ กลับเป็นค่า JS ธรรมดา
function firestoreFieldValueToJs_(fv) {
  if (!fv) return null;
  if ('stringValue' in fv) return fv.stringValue;
  if ('integerValue' in fv) return parseInt(fv.integerValue, 10);
  if ('doubleValue' in fv) return fv.doubleValue;
  if ('booleanValue' in fv) return fv.booleanValue;
  // เก็บเป็นสตริง ISO ให้ตรงกับรูปแบบวันที่แบบสตริงที่โค้ดส่วนอื่นเทียบกันอยู่แล้ว
  // (nowStr_/todayStr_ สร้างเป็นสตริงอยู่แล้ว แทบไม่มีการเขียน Date object จริงลง Firestore)
  if ('timestampValue' in fv) return fv.timestampValue;
  if ('nullValue' in fv) return null;
  if ('arrayValue' in fv) {
    const vals = (fv.arrayValue && fv.arrayValue.values) || [];
    return vals.map(firestoreFieldValueToJs_);
  }
  if ('mapValue' in fv) {
    return firestoreValueToJs_((fv.mapValue && fv.mapValue.fields) || {});
  }
  return null;
}

// แปลง Firestore "fields" map (ของเอกสารหนึ่งชิ้น) กลับเป็น plain object ธรรมดา
function firestoreValueToJs_(fields) {
  const obj = {};
  for (let k in fields) {
    obj[k] = firestoreFieldValueToJs_(fields[k]);
  }
  return obj;
}

// Service Account (JWT bearer, RFC 7523) — ทางเลือกที่เชื่อถือได้กว่า ScriptApp.getOAuthToken()
// สำหรับ Web App แบบ "Execute as: Me, Anyone/Anonymous" ซึ่งพบว่าสิทธิ์ scope ที่เจ้าของ
// สคริปต์อนุมัติเองผ่านหน้า editor ไม่ถูกส่งต่อไปยัง request ที่ไม่ได้ login เข้ามาอย่างสม่ำเสมอ
// (ยืนยันแล้วว่า ScriptApp.getOAuthToken() คืน token ที่ไม่มี scope 'datastore' ในบริบทนี้
// แม้เจ้าของสคริปต์จะกดอนุมัติสิทธิ์ผ่าน editor แล้วก็ตาม) ตั้งค่า Script Properties
// SA_CLIENT_EMAIL / SA_PRIVATE_KEY จาก JSON key ของ Service Account เพื่อใช้เส้นทางนี้แทน —
// ถ้าไม่ได้ตั้งค่าไว้ จะ fallback ไปใช้ ScriptApp.getOAuthToken() แบบเดิม
function getServiceAccountToken_() {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('sa_token');
    if (cached) return cached;

    const props = PropertiesService.getScriptProperties();
    const clientEmail = props.getProperty('SA_CLIENT_EMAIL');
    let privateKey = props.getProperty('SA_PRIVATE_KEY');
    if (!clientEmail || !privateKey) return null;
    privateKey = privateKey.replace(/\\n/g, '\n');

    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claimSet = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };
    const b64 = (obj) => Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
    const toSign = b64(header) + '.' + b64(claimSet);
    const signatureBytes = Utilities.computeRsaSha256Signature(toSign, privateKey);
    const signature = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, '');
    const jwt = toSign + '.' + signature;

    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      Logger.log('getServiceAccountToken_ error: ' + res.getContentText());
      return null;
    }
    const body = JSON.parse(res.getContentText());
    const token = body.access_token;
    if (token) cache.put('sa_token', token, Math.max(60, (body.expires_in || 3600) - 60));
    return token;
  } catch (err) {
    Logger.log('getServiceAccountToken_ error: ' + err.message);
    return null;
  }
}

function firestoreAuthHeaders_() {
  const saToken = getServiceAccountToken_();
  return { 'Authorization': 'Bearer ' + (saToken || ScriptApp.getOAuthToken()) };
}

// escape ชื่อฟิลด์ให้เป็น Firestore field path ที่ถูกต้อง — field name แบบไทย/มีช่องว่าง/วงเล็บ
// ไม่ตรงกับ regex [_a-zA-Z][_a-zA-Z0-9]* (ชื่อฟิลด์แบบ "ธรรมดา") จึงต้อง quote ด้วย backtick เสมอ
function firestoreFieldPathEscape_(name) {
  const escaped = String(name).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return '`' + escaped + '`';
}

// เขียนทับทั้งเอกสาร (upsert) — ใช้แทนทั้งกรณีสร้างใหม่และแก้ไข
// สำคัญ: Firestore PATCH โดยไม่ระบุ updateMask คือ "merge" (เติม/แก้เฉพาะฟิลด์ที่ส่งมา)
// ไม่ใช่ "แทนที่ทั้งเอกสาร" ตามที่อาจเข้าใจผิดได้ — ถ้าไม่ระบุ updateMask ฟิลด์เก่าที่ไม่ได้
// ส่งมาใหม่ (เช่นค่าที่ผู้ใช้ลบออกจากฟอร์ม หรือฟิลด์ที่ตั้งใจไม่ sync อย่าง "รหัสผ่าน")
// จะค้างอยู่ในเอกสารตลอดไป จึงต้องอ่านฟิลด์เดิมมาก่อน แล้วระบุ updateMask ให้ครบทั้ง
// ฟิลด์เก่า+ใหม่ เพื่อบังคับให้เป็นการ "แทนที่ทั้งเอกสาร" อย่างแท้จริง
function firestoreSetDoc_(collection, docId, dataObj) {
  try {
    const projectId = getFirebaseProjectId();
    if (!projectId) return false;
    const colName = getFirestoreCollectionName_(collection);
    const cleanDocId = String(docId || '').trim();
    if (!cleanDocId) return false;

    const cleanData = Object.assign({}, dataObj);
    delete cleanData._row;

    const fields = {};
    for (let k in cleanData) {
      if (cleanData[k] !== undefined) {
        fields[k] = jsToFirestoreValue_(cleanData[k]);
      }
    }

    const existing = firestoreGetDoc_(collection, cleanDocId) || {};
    const allFieldNames = {};
    for (let k in fields) allFieldNames[k] = true;
    for (let k in existing) allFieldNames[k] = true;

    const maskParams = Object.keys(allFieldNames)
      .map(name => 'updateMask.fieldPaths=' + encodeURIComponent(firestoreFieldPathEscape_(name)))
      .join('&');

    const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(colName)}/${encodeURIComponent(cleanDocId)}`;
    const url = maskParams ? `${baseUrl}?${maskParams}` : baseUrl;

    const options = {
      method: 'patch',
      contentType: 'application/json',
      headers: firestoreAuthHeaders_(),
      payload: JSON.stringify({ fields: fields }),
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log(`firestoreSetDoc_ error [${collection}/${docId}]: ${code} ${res.getContentText()}`);
    }
    return code >= 200 && code < 300;
  } catch (err) {
    Logger.log(`firestoreSetDoc_ error [${collection}/${docId}]: ` + err.message);
    return false;
  }
}

// ลบฟิลด์เดียวออกจากเอกสารแบบเร็ว ไม่ต้องอ่านเอกสารทั้งใบก่อน (updateMask ระบุแค่ฟิลด์เดียว
// + ไม่ส่งค่านั้นมาใน body = Firestore ลบฟิลด์นั้นทิ้งให้ ฟิลด์อื่นไม่ถูกแตะต้อง)
function firestoreDeleteField_(collection, docId, fieldName) {
  try {
    const projectId = getFirebaseProjectId();
    if (!projectId) return false;
    const colName = getFirestoreCollectionName_(collection);
    const cleanDocId = String(docId || '').trim();
    if (!cleanDocId) return false;

    const mask = 'updateMask.fieldPaths=' + encodeURIComponent(firestoreFieldPathEscape_(fieldName));
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(colName)}/${encodeURIComponent(cleanDocId)}?${mask}`;

    const res = UrlFetchApp.fetch(url, {
      method: 'patch',
      contentType: 'application/json',
      headers: firestoreAuthHeaders_(),
      payload: JSON.stringify({ fields: {} }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    return code >= 200 && code < 300;
  } catch (err) {
    Logger.log(`firestoreDeleteField_ error [${collection}/${docId}]: ` + err.message);
    return false;
  }
}

function firestoreDeleteDoc_(collection, docId) {
  try {
    const projectId = getFirebaseProjectId();
    if (!projectId) return false;
    const colName = getFirestoreCollectionName_(collection);
    const cleanDocId = String(docId || '').trim();
    if (!cleanDocId) return false;

    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(colName)}/${encodeURIComponent(cleanDocId)}`;

    const options = {
      method: 'delete',
      headers: firestoreAuthHeaders_(),
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    return code >= 200 && code < 300;
  } catch (err) {
    Logger.log(`firestoreDeleteDoc_ error [${collection}/${docId}]: ` + err.message);
    return false;
  }
}

// ดึงเอกสารทั้งหมดใน collection พร้อม paginate ด้วย pageToken จนครบ
function firestoreListDocs_(collection) {
  try {
    const projectId = getFirebaseProjectId();
    if (!projectId) return [];
    const colName = getFirestoreCollectionName_(collection);
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(colName)}`;

    const results = [];
    let pageToken = '';
    do {
      let url = baseUrl + '?pageSize=300';
      if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
      const res = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: firestoreAuthHeaders_(),
        muteHttpExceptions: true
      });
      const code = res.getResponseCode();
      if (code < 200 || code >= 300) {
        Logger.log(`firestoreListDocs_ error [${collection}]: ${code} ${res.getContentText()}`);
        break;
      }
      const body = JSON.parse(res.getContentText());
      const docs = body.documents || [];
      docs.forEach(doc => {
        results.push(firestoreValueToJs_(doc.fields || {}));
      });
      pageToken = body.nextPageToken || '';
    } while (pageToken);

    return results;
  } catch (err) {
    Logger.log(`firestoreListDocs_ error [${collection}]: ` + err.message);
    return [];
  }
}

function firestoreGetDoc_(collection, docId) {
  try {
    const projectId = getFirebaseProjectId();
    if (!projectId) return null;
    const colName = getFirestoreCollectionName_(collection);
    const cleanDocId = String(docId || '').trim();
    if (!cleanDocId) return null;

    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(colName)}/${encodeURIComponent(cleanDocId)}`;
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: firestoreAuthHeaders_(),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) return null;
    const body = JSON.parse(res.getContentText());
    return firestoreValueToJs_(body.fields || {});
  } catch (err) {
    Logger.log(`firestoreGetDoc_ error [${collection}/${docId}]: ` + err.message);
    return null;
  }
}

// อ่านหลาย collection พร้อมกันด้วย UrlFetchApp.fetchAll (ใช้เมื่อต้องอ่าน 3+ collection
// ในจุดเดียว เช่น getDashboard / checkOverdue) — ดึงเฉพาะหน้าแรกแบบขนาน แล้วค่อยไล่หน้า
// ถัดไปทีละ collection ถ้ามี (ระบบขนาดเล็ก มักไม่เกิน 1 หน้าอยู่แล้ว)
function firestoreListDocsMulti_(collections) {
  const projectId = getFirebaseProjectId();
  const out = {};
  if (!projectId) {
    collections.forEach(c => out[c] = []);
    return out;
  }
  try {
    const headers = firestoreAuthHeaders_();
    const requests = collections.map(c => {
      const colName = getFirestoreCollectionName_(c);
      return {
        url: `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(colName)}?pageSize=300`,
        method: 'get',
        headers: headers,
        muteHttpExceptions: true
      };
    });
    const responses = UrlFetchApp.fetchAll(requests);
    collections.forEach((c, idx) => {
      const res = responses[idx];
      const code = res.getResponseCode();
      let list = [];
      let nextPageToken = '';
      if (code >= 200 && code < 300) {
        const body = JSON.parse(res.getContentText());
        list = (body.documents || []).map(doc => firestoreValueToJs_(doc.fields || {}));
        nextPageToken = body.nextPageToken || '';
      } else {
        Logger.log(`firestoreListDocsMulti_ error [${c}]: ${code} ${res.getContentText()}`);
      }
      while (nextPageToken) {
        const more = firestoreListDocsPage_(c, nextPageToken);
        list = list.concat(more.docs);
        nextPageToken = more.nextPageToken;
      }
      out[c] = list;
    });
    return out;
  } catch (err) {
    Logger.log('firestoreListDocsMulti_ error: ' + err.message);
    collections.forEach(c => out[c] = out[c] || []);
    return out;
  }
}

function firestoreListDocsPage_(collection, pageToken) {
  const projectId = getFirebaseProjectId();
  const colName = getFirestoreCollectionName_(collection);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(colName)}?pageSize=300&pageToken=${encodeURIComponent(pageToken)}`;
  const res = UrlFetchApp.fetch(url, { method: 'get', headers: firestoreAuthHeaders_(), muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) return { docs: [], nextPageToken: '' };
  const body = JSON.parse(res.getContentText());
  return {
    docs: (body.documents || []).map(doc => firestoreValueToJs_(doc.fields || {})),
    nextPageToken: body.nextPageToken || ''
  };
}

function getFirebaseConfig() {
  return {
    projectId: getFirebaseProjectId(),
    apiKey: getFirebaseApiKey(),
    authDomain: `${getFirebaseProjectId()}.firebaseapp.com`,
    storageBucket: `${getFirebaseProjectId()}.firebasestorage.app`
  };
}

// หมายเหตุ: แก้ไข Firebase Project ID / API Key ของ Script Properties — ไม่เปิดผ่าน API สาธารณะ
function saveFirebaseConfig(projectId, apiKey, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const props = PropertiesService.getScriptProperties();
    if (projectId) props.setProperty('FIREBASE_PROJECT_ID', projectId.trim());
    if (apiKey) props.setProperty('FIREBASE_API_KEY', apiKey.trim());
    logAudit_('บันทึกการตั้งค่า Firebase', 'admin', 'อัปเดต Project ID / API Key');
    return { success: true, message: 'บันทึกการตั้งค่า Firebase เรียบร้อยแล้ว' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============== HELPERS ==============
function newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 1000);
}

function nowStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
}

function todayStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

function logAudit_(action, user, detail) {
  try {
    const logObj = {
      'รหัส': newId_('LOG'),
      'วันเวลา': nowStr_(),
      'ผู้ใช้': user || 'system',
      'การดำเนินการ': action,
      'รายละเอียด': detail || ''
    };
    firestoreSetDoc_(SHEETS.AUDIT, logObj['รหัส'], logObj);
  } catch (err) {
    Logger.log('logAudit error: ' + err);
  }
}

// ฟังก์ชันสำหรับค้นหา LINE User ID ของผู้ใช้งาน
function getUserLineId_(userName) {
  try {
    const users = getUsers();
    const user = users.find(u => u['ชื่อ-นามสกุล'] === userName);
    return user && user['LINE ID'] ? user['LINE ID'] : null;
  } catch (e) {
    return null;
  }
}

function safeGet_(fn) {
  try { return fn() || []; } catch (e) { return []; }
}

// ============== SETUP SYSTEM (seed ค่าเริ่มต้นลง Firestore) ==============
// รันเองจาก Apps Script editor หรือหน้าตั้งค่าระบบ (ต้องมี adminCode) — ไม่ต้อง
// สร้าง Sheet อีกต่อไป เพียง seed ตั้งค่าระบบ/หมวดอุปกรณ์/หน่วยงานเริ่มต้นลง Firestore
function setupSystem(adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const created = [];

    // ตั้งค่าระบบเริ่มต้น
    const defaultSettings = {
      'SYSTEM_NAME': SYSTEM_NAME,
      'ORG_NAME': 'องค์การบริหารส่วนตำบล',
      'LINE_NOTIFY_ON': 'true',
      'BORROW_DAYS_DEFAULT': '7',
      'FUEL_ALERT_PERCENT': '80'
    };
    for (let key in defaultSettings) {
      firestoreSetDoc_(SHEETS.SETTINGS, key, { Key: key, Value: defaultSettings[key] });
    }
    created.push(SHEETS.SETTINGS);

    // หมวดอุปกรณ์เริ่มต้น
    const defaultCategories = [
      { code: 'CT001', name: 'คอมพิวเตอร์', desc: 'คอมพิวเตอร์ตั้งโต๊ะ-โน้ตบุ๊ค' },
      { code: 'CT002', name: 'อุปกรณ์นำเสนอ', desc: 'โปรเจคเตอร์ จอภาพ' },
      { code: 'CT003', name: 'อุปกรณ์ถ่ายภาพ', desc: 'กล้องและอุปกรณ์เสริม' },
      { code: 'CT004', name: 'อุปกรณ์เสียง', desc: 'ไมค์ ลำโพง' },
      { code: 'CT005', name: 'อุปกรณ์สำนักงาน', desc: 'เครื่องพิมพ์ สแกน' },
      { code: 'CT006', name: 'แท็บเล็ต', desc: 'iPad และแท็บเล็ตอื่นๆ' },
      { code: 'CT007', name: 'อุปกรณ์ไอที', desc: 'อุปกรณ์เครือข่ายและไอที' }
    ];
    defaultCategories.forEach(c => {
      firestoreSetDoc_(SHEETS.EQUIPMENT_CATEGORY, c.code, {
        'รหัส': c.code, 'ชื่อหมวด': c.name, 'คำอธิบาย': c.desc, 'จำนวนรายการ': 0
      });
    });
    created.push(SHEETS.EQUIPMENT_CATEGORY);

    // หน่วยงานเริ่มต้น (ตัวอย่างโครงสร้างเริ่มต้น 1 หน่วยงาน ปรับแก้/เพิ่มได้ภายหลังผ่านหน้าเว็บ)
    firestoreSetDoc_(SHEETS.DEPARTMENTS, 'DP001', {
      'รหัส': 'DP001', 'ชื่อหน่วยงาน': 'สำนักปลัด', 'หัวหน้า': '', 'เบอร์โทร': '', 'จำนวนเจ้าหน้าที่': 0
    });
    created.push(SHEETS.DEPARTMENTS);

    logAudit_('ตั้งค่าระบบเริ่มต้น', 'admin', 'seed ค่าเริ่มต้นลง Firestore: ' + created.join(', '));
    return { success: true, message: 'ตั้งค่าระบบเริ่มต้นเรียบร้อย: ' + created.join(', ') };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============== AUTH ==============
function login(username, password) {
  try {
    const users = getUsers();
    const credsList = firestoreListDocs_('userCredentials');
    const credMap = {};
    credsList.forEach(c => { if (c['รหัส']) credMap[c['รหัส']] = c['รหัสผ่าน']; });

    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanPassword = String(password || '').trim();
    const hashedPass = hashPassword_(cleanPassword);

    const user = users.find(u => {
      const uCode = String(u['รหัส'] || u['User ID'] || u['รหัสพนักงาน'] || '').trim().toLowerCase();
      const uName = String(u['ชื่อ-นามสกุล'] || '').trim().toLowerCase();
      const uUsername = String(u['ชื่อผู้ใช้'] || '').trim().toLowerCase();
      const uEmail = String(u['อีเมล'] || '').trim().toLowerCase();
      const uPass = String((credMap[u['รหัส']] !== undefined ? credMap[u['รหัส']] : u['รหัสผ่าน']) || '').trim();
      const emailPrefix = uEmail.split('@')[0];

      const matchUser = (uCode === cleanUsername || uName === cleanUsername || uUsername === cleanUsername || uEmail === cleanUsername || emailPrefix === cleanUsername);
      const matchPass = (uPass === cleanPassword || uPass === hashedPass);

      return matchUser && matchPass;
    });

    if (!user) {
      if (verifyAdmin(cleanPassword)) {
        logAudit_('Login Admin', 'admin', 'เข้าระบบด้วยรหัส admin');
        return { success: true, user: { name: 'ผู้ดูแลระบบ', role: 'superadmin', dept: 'IT' } };
      }
      return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }

    const uStatus = String(user['สถานะ'] || '').trim();
    if (uStatus === 'ระงับ' || uStatus === 'ไม่ใช้งาน') {
      return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งานชั่วคราว' };
    }

    logAudit_('Login', user['ชื่อ-นามสกุล'], '');
    return {
      success: true,
      user: {
        name: user['ชื่อ-นามสกุล'],
        role: user['บทบาท'],
        dept: user['หน่วยงาน'],
        phone: user['เบอร์ติดต่อ']
      }
    };
  } catch (err) {
    return { success: false, message: 'ข้อผิดพลาด: ' + err.message };
  }
}

function verifyAdmin(code) {
  return String(code || '').trim() === getAdminCode();
}

// ============== DATA APIs ==============
function getAllData(collectionName) {
  try {
    return { success: true, data: firestoreListDocs_(collectionName) };
  } catch (err) {
    return { success: false, message: err.message, data: [] };
  }
}

function getVehicles() { return firestoreListDocs_(SHEETS.VEHICLES); }
function getUsage() { return firestoreListDocs_(SHEETS.USAGE); }
function getMaintenance() { return firestoreListDocs_(SHEETS.MAINTENANCE); }
function getFuel() { return firestoreListDocs_(SHEETS.FUEL); }
function getFuelQuota() { return firestoreListDocs_(SHEETS.FUEL_QUOTA); }
function getEquipment() { return firestoreListDocs_(SHEETS.EQUIPMENT); }
function getBorrowing() { return firestoreListDocs_(SHEETS.BORROWING); }
function getUsers() { return firestoreListDocs_(SHEETS.USERS); }
function getDrivers() { return firestoreListDocs_(SHEETS.DRIVERS); }
function getBooking() { return firestoreListDocs_(SHEETS.BOOKING); }
function getInspection() { return firestoreListDocs_(SHEETS.INSPECTION); }
function getNotifications() { return firestoreListDocs_(SHEETS.NOTIFICATIONS); }
function getAudit() { return firestoreListDocs_(SHEETS.AUDIT); }
function getDepartments() { return firestoreListDocs_(SHEETS.DEPARTMENTS); }
function getEquipmentCategories() { return firestoreListDocs_(SHEETS.EQUIPMENT_CATEGORY); }

// แทนที่ getAllInitData เดิม — คืนเฉพาะสิ่งที่ยังไม่มีใน real-time listener ของ frontend
// (frontend อ่านข้อมูลหลักแบบ real-time จาก Firestore SDK ตรงๆ อยู่แล้ว)
function getBootstrapInfo() {
  // ไม่มีแนวคิด "สร้างชีตหรือยัง" อีกต่อไปเมื่อใช้ Firestore ล้วนๆ ถือว่าระบบพร้อมใช้งานเสมอ
  const setup = {
    complete: true,
    found: Object.keys(SHEETS).length,
    total: Object.keys(SHEETS).length,
    missing: []
  };

  const cache = CacheService.getScriptCache();
  let logo = cache.get('MOPH_LOGO_BASE64');
  if (!logo) {
    logo = getMOPHLogoBase64();
    if (logo) {
      try { cache.put('MOPH_LOGO_BASE64', logo, 21600); } catch (e) {}
    }
  }

  return {
    setup: setup,
    logo: logo || '',
    settings: getSystemSettings()
  };
}

function getMOPHLogoBase64() {
  try {
    const url = "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Ministry_of_Public_Health_Thailand_Logo.png/120px-Ministry_of_Public_Health_Thailand_Logo.png";
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      return "data:image/png;base64," + Utilities.base64Encode(res.getContent());
    }
  } catch (err) {
    Logger.log("Error fetching MOPH logo: " + err.message);
  }
  return "";
}

// ============== VEHICLES ==============
function saveVehicle(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId_('VH');
    data['วันที่บันทึก'] = nowStr_();
    delete data._row;
    firestoreSetDoc_(SHEETS.VEHICLES, data['รหัส'], data);
    logAudit_(isNew ? 'เพิ่มรถใหม่' : 'แก้ไขข้อมูลรถ', 'admin', data['ทะเบียน']);
    return { success: true, message: 'บันทึกสำเร็จ' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteVehicle(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const docId = String(code);
    firestoreDeleteDoc_(SHEETS.VEHICLES, docId);
    logAudit_('ลบรถ', 'admin', docId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============== USAGE ==============
function saveUsage(data, user) {
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId_('US');
    data['วันที่บันทึก'] = nowStr_();
    if (!data['สถานะ']) data['สถานะ'] = 'อยู่ระหว่างใช้งาน';
    delete data._row;
    firestoreSetDoc_(SHEETS.USAGE, data['รหัส'], data);
    if (isNew) {
      sendVehicleUsageFlex_(data);
      const userLineId = getUserLineId_(data['ผู้ขอใช้']);
      if (userLineId) {
        sendVehicleUsageFlex_(data, userLineId);
      }
    }
    logAudit_('บันทึกการใช้รถ', user || 'system', data['ทะเบียน'] + ' -> ' + data['สถานที่ไป']);
    return { success: true, message: 'บันทึกสำเร็จ' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function returnVehicle(code, returnData, user) {
  try {
    const item = firestoreGetDoc_(SHEETS.USAGE, code);
    if (!item) throw new Error('ไม่พบข้อมูล');
    item['วันที่กลับ'] = returnData.dateReturn;
    item['เวลากลับ'] = returnData.timeReturn;
    item['ไมล์กลับ'] = returnData.mileReturn;
    item['ระยะทาง(กม.)'] = (returnData.mileReturn || 0) - (item['ไมล์ออก'] || 0);
    item['สถานะ'] = 'เสร็จสิ้น';
    firestoreSetDoc_(SHEETS.USAGE, item['รหัส'], item);
    logAudit_('คืนรถ', user || 'system', item['ทะเบียน']);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============== MAINTENANCE ==============
function saveMaintenance(data, user) {
  try {
    if (!data['รหัส']) data['รหัส'] = newId_('MT');
    data['วันที่บันทึก'] = nowStr_();
    delete data._row;
    firestoreSetDoc_(SHEETS.MAINTENANCE, data['รหัส'], data);
    logAudit_('บันทึกบำรุงรักษา', user || 'system', data['ทะเบียน']);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteMaintenance(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  firestoreDeleteDoc_(SHEETS.MAINTENANCE, String(code));
  return { success: true };
}

// ============== FUEL ==============
function saveFuel(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId_('FL');
    data['วันที่บันทึก'] = nowStr_();
    data['จำนวนเงิน'] = (parseFloat(data['จำนวนลิตร']) || 0) * (parseFloat(data['ราคา/ลิตร']) || 0);
    delete data._row;
    firestoreSetDoc_(SHEETS.FUEL, data['รหัส'], data);
    if (isNew) {
      updateFuelQuota_(data['ทะเบียน'], parseFloat(data['จำนวนลิตร']), data['จำนวนเงิน']);
    }
    logAudit_('บันทึกน้ำมัน', 'admin', data['ทะเบียน'] + ' ' + data['จำนวนลิตร'] + 'ลิตร');
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function updateFuelQuota_(plate, liters, money) {
  const all = getFuelQuota();
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  const item = all.find(x => x['ทะเบียน'] === plate && Number(x['เดือน']) === m && Number(x['ปี']) === y);
  if (item) {
    item['ใช้ไป(ลิตร)'] = (parseFloat(item['ใช้ไป(ลิตร)']) || 0) + liters;
    item['คงเหลือ(ลิตร)'] = (parseFloat(item['โควต้า(ลิตร)']) || 0) - item['ใช้ไป(ลิตร)'];
    item['ใช้จ่าย(บาท)'] = (parseFloat(item['ใช้จ่าย(บาท)']) || 0) + money;
    firestoreSetDoc_(SHEETS.FUEL_QUOTA, item['รหัส'], item);
  }
}

function deleteFuel(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  firestoreDeleteDoc_(SHEETS.FUEL, String(code));
  return { success: true };
}

// ============== EQUIPMENT ==============
function saveEquipment(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId_('EQ');
    data['วันที่บันทึก'] = nowStr_();
    delete data._row;
    firestoreSetDoc_(SHEETS.EQUIPMENT, data['รหัส'], data);
    logAudit_(isNew ? 'เพิ่มอุปกรณ์ใหม่' : 'แก้ไขข้อมูลอุปกรณ์', 'admin', data['ชื่ออุปกรณ์']);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteEquipment(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const docId = String(code);
    firestoreDeleteDoc_(SHEETS.EQUIPMENT, docId);
    logAudit_('ลบอุปกรณ์', 'admin', docId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============== BORROWING (with status workflow) ==============
function saveBorrowing(data, user) {
  try {
    if (!data['รหัส']) {
      // Stock Validation
      const equipId = data['รหัสอุปกรณ์'];
      const reqQty = parseFloat(data['จำนวน']) || 1;

      const equipments = getEquipment();
      const equip = equipments.find(e => e['รหัส'] === equipId);
      if (!equip) throw new Error('ไม่พบข้อมูลอุปกรณ์ในระบบ');

      const totalStock = parseFloat(equip['จำนวน']) || 0;

      const borrowings = getBorrowing();
      const activeBorrowings = borrowings.filter(b =>
        b['รหัสอุปกรณ์'] === equipId &&
        ['รอรับเรื่อง', 'รับเรื่องแล้ว', 'อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน', 'อยู่ในระหว่างการคืน'].includes(b['สถานะ'])
      );

      const borrowedQty = activeBorrowings.reduce((sum, b) => sum + (parseFloat(b['จำนวน']) || 0), 0);
      const available = totalStock - borrowedQty;

      if (reqQty > available) {
        return {
          success: false,
          message: `ไม่สามารถยืมได้: อุปกรณ์นี้เหลือในคลัง ${available} ${equip['หน่วยนับ'] || ''} (คุณขอ ${reqQty})`
        };
      }

      data['รหัส'] = newId_('BR');
      data['สถานะ'] = 'รอรับเรื่อง';
      data['วันที่บันทึก'] = nowStr_();
      delete data._row;
      firestoreSetDoc_(SHEETS.BORROWING, data['รหัส'], data);

      // 1. ส่งแจ้งเตือนเข้ากลุ่ม Admin
      sendBorrowingFlex_(data, 'รอรับเรื่อง');

      // 2. ตรวจสอบ LINE ID และส่งแจ้งเตือนหาส่วนตัว
      const userLineId = getUserLineId_(data['ผู้ขอยืม']);
      if (userLineId) {
        sendBorrowingFlex_(data, 'รอรับเรื่อง', userLineId);
      }
    } else {
      delete data._row;
      firestoreSetDoc_(SHEETS.BORROWING, data['รหัส'], data);
    }
    logAudit_('สร้างคำขอยืม', user || 'system', data['ชื่ออุปกรณ์']);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function updateBorrowingStatus(code, newStatus, receiver, user, condition, conditionNote) {
  try {
    const usersList = getUsers();
    const foundUser = usersList.find(u => String(u['ชื่อ-นามสกุล']).trim().toLowerCase() === String(user || '').trim().toLowerCase());
    const role = foundUser ? String(foundUser['บทบาท']).trim().toLowerCase() : '';
    const isStaff = ['superadmin', 'admin', 'manager'].includes(role) || user === 'system';

    if (!isStaff) {
      throw new Error('คุณไม่มีสิทธิ์ดำเนินการในส่วนนี้');
    }

    const item = firestoreGetDoc_(SHEETS.BORROWING, code);
    if (!item) throw new Error('ไม่พบข้อมูล');

    item['สถานะ'] = newStatus;
    if (receiver) item['ผู้รับเรื่อง'] = receiver;
    if (newStatus === 'คืนเสร็จสิ้น') {
      item['วันที่คืนจริง'] = todayStr_();
      if (condition) item['สภาพอุปกรณ์ตอนคืน'] = condition;
      if (conditionNote) {
        item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'สภาพ: ' + conditionNote;
      }

      // ถ้าสภาพอุปกรณ์ตอนคืนคือ 'ชำรุดบางส่วน' หรือ 'ชำรุดเสียหาย' ให้ปรับสถานะอุปกรณ์เป็น 'ชำรุด'
      if (condition === 'ชำรุดบางส่วน' || condition === 'ชำรุดเสียหาย') {
        markEquipmentDamaged_(item['รหัสอุปกรณ์'], item['ชื่ออุปกรณ์'], conditionNote || condition);
      }
    }
    firestoreSetDoc_(SHEETS.BORROWING, item['รหัส'], item);

    // 1. แจ้งเตือนสถานะล่าสุดไปยังกลุ่ม Admin
    sendBorrowingFlex_(item, newStatus);

    // 2. แจ้งเตือนสถานะล่าสุดไปยังผู้ยืมแบบส่วนตัว
    const userLineId = getUserLineId_(item['ผู้ขอยืม']);
    if (userLineId) {
      sendBorrowingFlex_(item, newStatus, userLineId);
    }

    logAudit_('เปลี่ยนสถานะยืม', user || 'system', item['รหัส'] + ' -> ' + newStatus + (condition ? ' (' + condition + ')' : ''));
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function markEquipmentDamaged_(equipId, equipName, note) {
  try {
    const all = getEquipment();
    const item = all.find(x => x['รหัส'] === equipId || x['ชื่ออุปกรณ์'] === equipName);
    if (item) {
      item['สถานะ'] = 'ชำรุด';
      if (note) item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'ชำรุดจากการยืม: ' + note;
      firestoreSetDoc_(SHEETS.EQUIPMENT, item['รหัส'], item);
      logAudit_('อัปเดตสถานะอุปกรณ์', 'system', (item['ชื่ออุปกรณ์'] || equipId) + ' -> ชำรุด');
    }
  } catch (e) {
    Logger.log('markEquipmentDamaged_ error: ' + e.message);
  }
}

function requestBorrowExtension(code, newDueDate, reason, user) {
  try {
    const item = firestoreGetDoc_(SHEETS.BORROWING, code);
    if (!item) throw new Error('ไม่พบข้อมูลคำขอยืม');

    item['สถานะ'] = 'ขอขยายเวลา';
    item['เหตุผลขอขยายเวลา'] = reason;
    item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'ขอขยายคืนเป็น ' + newDueDate + ': ' + reason;
    firestoreSetDoc_(SHEETS.BORROWING, item['รหัส'], item);

    sendBorrowingFlex_(item, 'ขอขยายเวลา');
    const userLineId = getUserLineId_(item['ผู้ขอยืม']);
    if (userLineId) {
      sendBorrowingFlex_(item, 'ขอขยายเวลา', userLineId);
    }

    logAudit_('ขอขยายเวลาการยืม', user || 'system', item['รหัส'] + ' -> คืนวันที่ ' + newDueDate);
    return { success: true, message: 'ส่งคำขอขยายเวลาเรียบร้อยแล้ว' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function approveBorrowExtension(code, newDueDate, approver) {
  try {
    const item = firestoreGetDoc_(SHEETS.BORROWING, code);
    if (!item) throw new Error('ไม่พบข้อมูลคำขอยืม');

    item['วันที่ครบกำหนด'] = newDueDate;
    item['สถานะ'] = 'อยู่ในระหว่างการยืม';
    item['ผู้รับเรื่อง'] = approver;
    item['หมายเหตุ'] = (item['หมายเหตุ'] ? item['หมายเหตุ'] + ' | ' : '') + 'อนุมัติขยายเวลาถึง ' + newDueDate;

    firestoreSetDoc_(SHEETS.BORROWING, item['รหัส'], item);

    sendBorrowingFlex_(item, 'อนุมัติขยายเวลา');
    const userLineId = getUserLineId_(item['ผู้ขอยืม']);
    if (userLineId) {
      sendBorrowingFlex_(item, 'อนุมัติขยายเวลา', userLineId);
    }

    logAudit_('อนุมัติขยายเวลายืม', approver || 'system', item['รหัส'] + ' -> ' + newDueDate);
    return { success: true, message: 'อนุมัติขยายเวลาการยืมสำเร็จ' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getBorrowingByCode(code) {
  try {
    const cleanCode = String(code || '').trim().toUpperCase();
    const borrowings = getBorrowing();
    let match = borrowings.find(b => String(b['รหัส']).trim().toUpperCase() === cleanCode);
    if (!match) {
      match = borrowings.find(b =>
        String(b['รหัสอุปกรณ์']).trim().toUpperCase() === cleanCode &&
        ['รอรับเรื่อง', 'รับเรื่องแล้ว', 'อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน', 'อยู่ในระหว่างการคืน', 'ขอขยายเวลา'].includes(b['สถานะ'])
      );
    }
    if (!match) {
      match = borrowings.find(b => String(b['รหัส']).toUpperCase().includes(cleanCode));
    }
    if (match) {
      return { success: true, item: match };
    } else {
      return { success: false, message: 'ไม่พบข้อมูลคำขอยืมสำหรับรหัส: ' + code };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteBorrowing(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  firestoreDeleteDoc_(SHEETS.BORROWING, String(code));
  return { success: true };
}

// ============== USERS ==============
// หมายเหตุความปลอดภัย: รหัสผ่านผู้ใช้จะไม่ถูกเขียนลง collection "ผู้ใช้งาน" (users)
// ที่ frontend ฟัง real-time อีกต่อไป — แยกเก็บใน collection "userCredentials"
// (อ่าน/เขียนเฉพาะทาง backend ที่ auth ด้วย OAuth เท่านั้น, ปิด read/write จาก
// client ทั้งหมดใน firestore.rules) เพื่อไม่ให้รหัสผ่าน/hash รั่วผ่าน real-time listener
function saveUser(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId_('UR');

    // Clean and trim text inputs to prevent trailing space errors
    if (data['ชื่อ-นามสกุล']) data['ชื่อ-นามสกุล'] = String(data['ชื่อ-นามสกุล']).trim();
    if (data['อีเมล']) data['อีเมล'] = String(data['อีเมล']).trim();
    if (data['รหัสผ่าน']) data['รหัสผ่าน'] = String(data['รหัสผ่าน']).trim();
    if (data['LINE ID']) data['LINE ID'] = String(data['LINE ID']).trim();
    if (data['LINE Token']) data['LINE Token'] = String(data['LINE Token']).trim();
    if (data['Telegram ID']) data['Telegram ID'] = String(data['Telegram ID']).trim();
    if (data['Telegram Token']) data['Telegram Token'] = String(data['Telegram Token']).trim();
    delete data._row;

    const existingCred = isNew ? null : firestoreGetDoc_('userCredentials', data['รหัส']);
    const existingUser = isNew ? null : firestoreGetDoc_(SHEETS.USERS, data['รหัส']);

    // คงวันที่บันทึกเดิมไว้เมื่อแก้ไข (เทียบเท่าพฤติกรรมเดิมที่อ่านค่าจากแถวเดิมในชีต)
    data['วันที่บันทึก'] = isNew ? todayStr_() : ((existingUser && existingUser['วันที่บันทึก']) || todayStr_());

    // ถ้าไม่ได้กรอกรหัสผ่านใหม่ตอนแก้ไข ให้คงรหัสผ่านเดิมไว้
    const newPassword = data['รหัสผ่าน'];
    const passwordToStore = newPassword ? newPassword : ((existingCred && existingCred['รหัสผ่าน']) || '');

    const publicData = Object.assign({}, data);
    delete publicData['รหัสผ่าน'];

    firestoreSetDoc_(SHEETS.USERS, data['รหัส'], publicData);
    firestoreSetDoc_('userCredentials', data['รหัส'], { 'รหัส': data['รหัส'], 'รหัสผ่าน': passwordToStore });

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteUser(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  const docId = String(code);
  firestoreDeleteDoc_(SHEETS.USERS, docId);
  firestoreDeleteDoc_('userCredentials', docId);
  return { success: true };
}

// ============== DRIVERS ==============
function saveDriver(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  if (!data['รหัส']) data['รหัส'] = newId_('DR');
  data['วันที่บันทึก'] = todayStr_();
  delete data._row;
  firestoreSetDoc_(SHEETS.DRIVERS, data['รหัส'], data);
  return { success: true };
}

function deleteDriver(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  firestoreDeleteDoc_(SHEETS.DRIVERS, String(code));
  return { success: true };
}

// ============== BOOKING ==============
function saveBooking(data, user) {
  if (!data['รหัส']) data['รหัส'] = newId_('BK');
  if (!data['สถานะ']) data['สถานะ'] = 'รออนุมัติ';
  data['วันที่บันทึก'] = nowStr_();
  delete data._row;
  firestoreSetDoc_(SHEETS.BOOKING, data['รหัส'], data);
  logAudit_('จองรถล่วงหน้า', user || 'system', data['ทะเบียน']);
  sendBookingFlex_(data, data['สถานะ']);
  return { success: true };
}

function approveBooking(code, approver) {
  const item = firestoreGetDoc_(SHEETS.BOOKING, code);
  if (!item) return { success: false };
  item['สถานะ'] = 'อนุมัติแล้ว';
  item['ผู้อนุมัติ'] = approver;
  firestoreSetDoc_(SHEETS.BOOKING, item['รหัส'], item);
  sendBookingFlex_(item, item['สถานะ']);
  return { success: true };
}

function deleteBooking(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  firestoreDeleteDoc_(SHEETS.BOOKING, String(code));
  return { success: true };
}

// ============== INSPECTION ==============
function saveInspection(data, user) {
  if (!data['รหัส']) data['รหัส'] = newId_('IN');
  data['วันที่บันทึก'] = nowStr_();
  delete data._row;
  firestoreSetDoc_(SHEETS.INSPECTION, data['รหัส'], data);
  return { success: true };
}

function deleteInspection(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  firestoreDeleteDoc_(SHEETS.INSPECTION, String(code));
  return { success: true };
}

// ============== DEPARTMENTS ==============
function saveDepartment(data, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    const isNew = !data['รหัส'];
    if (isNew) data['รหัส'] = newId_('DP');
    delete data._row;
    firestoreSetDoc_(SHEETS.DEPARTMENTS, data['รหัส'], data);
    logAudit_(isNew ? 'เพิ่มหน่วยงานใหม่' : 'แก้ไขข้อมูลหน่วยงาน', 'admin', data['ชื่อหน่วยงาน']);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteDepartment(code, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    const docId = String(code);
    firestoreDeleteDoc_(SHEETS.DEPARTMENTS, docId);
    logAudit_('ลบหน่วยงาน', 'admin', docId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============== LINE NOTIFICATION (Flex Card) ==============
function sendLineFlex_(altText, flexContent, targetId) {
  try {
    const token = getLineToken();
    const defaultGroup = getLineGroupId();
    const sendTo = targetId || defaultGroup;

    if (!token) return false;

    const payload = {
      to: sendTo,
      messages: [{
        type: 'flex',
        altText: altText,
        contents: flexContent
      }]
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token.trim() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', options);
    const code = res.getResponseCode();
    const body = res.getContentText().substring(0, 500);
    Logger.log(`sendLineFlex_ status: ${code}, response: ${body}`);

    // บันทึกประวัติเฉพาะกรณีส่งเข้ากลุ่ม เพื่อลดความซ้ำซ้อน
    if (sendTo === defaultGroup) {
      const notifObj = {
        'รหัส': newId_('NT'),
        'วันเวลา': nowStr_(),
        'ประเภท': 'Flex Message',
        'หัวข้อ': altText,
        'ข้อความ': altText,
        'ผู้รับ': 'LINE Group',
        'สถานะการส่ง': code === 200 ? 'สำเร็จ' : 'ผิดพลาด ' + code,
        'หมายเหตุ': body.substring(0, 200)
      };
      firestoreSetDoc_(SHEETS.NOTIFICATIONS, notifObj['รหัส'], notifObj);
    }
    return code === 200;
  } catch (err) {
    Logger.log('LINE error: ' + err);
    return false;
  }
}

function sendBorrowingFlex_(data, status, targetId) {
  const statusMap = {
    'รอรับเรื่อง':       { color: '#f59e0b', icon: '📥', desc: 'มีคำขอยืมใหม่' },
    'รับเรื่องแล้ว':      { color: '#3b82f6', icon: '✅', desc: 'รับเรื่องเรียบร้อย' },
    'อยู่ในระหว่างการยืม':  { color: '#8b5cf6', icon: '📦', desc: 'ส่งมอบอุปกรณ์แล้ว' },
    'ถึงวันครบกำหนดคืน': { color: '#ef4444', icon: '⏰', desc: 'ครบกำหนดคืนวันนี้ / เกินกำหนด' },
    'ขอขยายเวลา':        { color: '#d97706', icon: '⏳', desc: 'ผู้ยืมขอขยายเวลาส่งคืน' },
    'อนุมัติขยายเวลา':    { color: '#10b981', icon: '👍', desc: 'อนุมัติขยายเวลาเรียบร้อย' },
    'อยู่ในระหว่างการคืน':  { color: '#06b6d4', icon: '🔄', desc: 'อยู่ระหว่างตรวจรับ' },
    'คืนเสร็จสิ้น':        { color: '#10b981', icon: '✔️', desc: 'คืนสำเร็จ' },
    'ยกเลิก':            { color: '#6b7280', icon: '❌', desc: 'รายการถูกยกเลิก' }
  };
  const meta = statusMap[status] || { color: '#3b82f6', icon: '📦', desc: status };

  const footerButtons = [
    {
      type: 'button', style: 'primary', color: '#1e40af', height: 'sm',
      action: { type: 'uri', label: '🌐 เปิดดูในระบบ (vmes.web.app)', uri: 'https://vmes.web.app/#borrowing' }
    }
  ];

  if (status === 'รอรับเรื่อง') {
    footerButtons.unshift({
      type: 'button', style: 'secondary', height: 'sm',
      action: { type: 'message', label: '✅ ตอบรับคำขอยืมนี้', text: 'เช็คคำขอ ' + String(data['รหัส'] || '') }
    });
  } else if (status === 'อยู่ในระหว่างการยืม' || status === 'ถึงวันครบกำหนดคืน') {
    footerButtons.unshift({
      type: 'button', style: 'secondary', height: 'sm',
      action: { type: 'message', label: '⏳ ขอขยายเวลาคืน', text: 'ขอขยายเวลา ' + String(data['รหัส'] || '') }
    });
  }

  const flex = {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical',
      backgroundColor: meta.color, paddingAll: '20px',
      contents: [
        { type: 'text', text: meta.icon + ' ' + status, color: '#ffffff', size: 'xl', weight: 'bold' },
        { type: 'text', text: meta.desc, color: '#ffffff', size: 'sm', margin: 'sm' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
      contents: [
        {
          type: 'box', layout: 'vertical',
          backgroundColor: '#f8fafc', cornerRadius: '12px', paddingAll: '16px',
          contents: [
            { type: 'text', text: 'อุปกรณ์ที่ยืม', size: 'xs', color: '#64748b' },
            { type: 'text', text: String(data['ชื่ออุปกรณ์'] || '-'), size: 'xl', weight: 'bold', color: '#0f172a', wrap: true },
            { type: 'text', text: 'จำนวน ' + (data['จำนวน'] || 1) + ' รายการ', size: 'sm', color: '#64748b', margin: 'xs' }
          ]
        },
        { type: 'separator', margin: 'md' },
        {
          type: 'box', layout: 'vertical', spacing: 'sm',
          contents: [
            flexRow_('🆔 เลขคำขอ', String(data['รหัส'] || '-')),
            flexRow_('👤 ผู้ขอยืม', String(data['ผู้ขอยืม'] || '-')),
            flexRow_('🏢 หน่วยงาน', String(data['หน่วยงาน'] || '-')),
            flexRow_('📞 ติดต่อ', String(data['เบอร์ติดต่อ'] || '-')),
            flexRow_('🎯 วัตถุประสงค์', String(data['วัตถุประสงค์'] || '-')),
            flexRow_('📍 สถานที่ใช้งาน', String(data['สถานที่ใช้งาน'] || data['สถานที่'] || '-')),
            flexRow_('📅 ครบกำหนดคืน', String(data['วันที่ครบกำหนด'] || '-'))
          ]
        }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', backgroundColor: '#f1f5f9',
      contents: [
        ...footerButtons,
        { type: 'text', text: '⏱ ' + nowStr_() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' }
      ]
    }
  };

  return sendLineFlex_(meta.icon + ' ' + status + ': ' + (data['ชื่ออุปกรณ์'] || ''), flex, targetId);
}

function sendVehicleUsageFlex_(data, targetId) {
  const flex = {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#1e40af', paddingAll: '20px',
      contents: [
        { type: 'text', text: '🚗 แจ้งเตือนการใช้รถ', color: '#ffffff', size: 'xl', weight: 'bold' },
        { type: 'text', text: 'Vehicle Departure Notification', color: '#bfdbfe', size: 'sm', margin: 'sm' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
      contents: [
        {
          type: 'box', layout: 'vertical', backgroundColor: '#dbeafe', cornerRadius: '12px', paddingAll: '16px',
          contents: [
            { type: 'text', text: 'ทะเบียนรถ', size: 'xs', color: '#1e40af' },
            { type: 'text', text: String(data['ทะเบียน'] || '-'), size: 'xxl', weight: 'bold', color: '#1e3a8a' }
          ]
        },
        { type: 'separator', margin: 'md' },
        {
          type: 'box', layout: 'vertical', spacing: 'sm',
          contents: [
            flexRow_('📍 สถานที่', String(data['สถานที่ไป'] || '-')),
            flexRow_('🎯 วัตถุประสงค์', String(data['วัตถุประสงค์'] || '-')),
            flexRow_('👨‍✈️ พนักงานขับรถ', String(data['พนักงานขับรถ'] || '-')),
            flexRow_('👤 ผู้ขอใช้', String(data['ผู้ขอใช้'] || '-')),
            flexRow_('📅 วันที่', String(data['วันที่ออก'] || '-')),
            flexRow_('🕐 เวลาออก', String(data['เวลาออก'] || '-'))
          ]
        }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', backgroundColor: '#f1f5f9',
      contents: [
        {
          type: 'button', style: 'primary', color: '#1e40af', height: 'sm',
          action: { type: 'uri', label: '📋 บันทึกการใช้รถ (vmes.web.app)', uri: 'https://vmes.web.app/#vehicle' }
        },
        { type: 'text', text: '⏱ ' + nowStr_() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' }
      ]
    }
  };
  return sendLineFlex_('🚗 แจ้งเตือนการใช้รถ ' + data['ทะเบียน'], flex, targetId);
}

function sendBookingFlex_(data, status, targetId) {
  const statusColor = status === 'อนุมัติแล้ว' ? '#10b981' : '#f59e0b';
  const flex = {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: statusColor, paddingAll: '20px',
      contents: [
        { type: 'text', text: '📅 แจ้งเตือนการจองรถ: ' + status, color: '#ffffff', size: 'xl', weight: 'bold' },
        { type: 'text', text: 'Vehicle Booking Notification', color: '#ffffff', size: 'sm', margin: 'sm' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
      contents: [
        {
          type: 'box', layout: 'vertical', backgroundColor: '#f8fafc', cornerRadius: '12px', paddingAll: '16px',
          contents: [
            { type: 'text', text: 'ทะเบียนรถที่จอง', size: 'xs', color: '#64748b' },
            { type: 'text', text: String(data['ทะเบียน'] || '-'), size: 'xl', weight: 'bold', color: '#0f172a' }
          ]
        },
        { type: 'separator', margin: 'md' },
        {
          type: 'box', layout: 'vertical', spacing: 'sm',
          contents: [
            flexRow_('👤 ผู้ขอจอง', String(data['ผู้ขอจอง'] || '-')),
            flexRow_('📍 สถานที่ไป', String(data['สถานที่ไป'] || '-')),
            flexRow_('🎯 วัตถุประสงค์', String(data['วัตถุประสงค์'] || '-')),
            flexRow_('📅 วันที่ใช้', String(data['วันที่ใช้'] || '-')),
            flexRow_('🕐 เวลา', String(data['เวลาเริ่ม'] || '-') + ' - ' + String(data['เวลาสิ้นสุด'] || '-')),
            flexRow_('👨‍✈️ พนักงานขับรถ', String(data['พนักงานขับรถ'] || '-'))
          ]
        }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', backgroundColor: '#f1f5f9',
      contents: [
        {
          type: 'button', style: 'primary', color: '#1e40af', height: 'sm',
          action: { type: 'uri', label: '🚗 ตรวจสอบการจอง (vmes.web.app)', uri: 'https://vmes.web.app/#vehicle' }
        },
        { type: 'text', text: '⏱ ' + nowStr_() + ' | ' + SYSTEM_NAME, size: 'xxs', color: '#94a3b8', align: 'center', margin: 'sm' }
      ]
    }
  };
  return sendLineFlex_('📅 แจ้งเตือนการจองรถ: ' + status, flex, targetId);
}

function flexRow_(label, value) {
  return {
    type: 'box', layout: 'baseline', spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#64748b', flex: 4 },
      { type: 'text', text: value, size: 'sm', color: '#0f172a', flex: 6, weight: 'bold', wrap: true }
    ]
  };
}

function testLineNotify() {
  const flex = {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', paddingAll: '20px',
      contents: [
        { type: 'text', text: '🎉 ทดสอบระบบแจ้งเตือน', size: 'xl', weight: 'bold', color: '#1e40af' },
        { type: 'text', text: SYSTEM_NAME, size: 'sm', color: '#64748b', margin: 'md' },
        { type: 'text', text: 'เชื่อมต่อสำเร็จ ' + nowStr_(), size: 'xs', color: '#94a3b8', margin: 'md' }
      ]
    }
  };
  return sendLineFlex_('🎉 ทดสอบระบบแจ้งเตือน', flex) ? 'ส่งสำเร็จ' : 'ส่งไม่สำเร็จ';
}

function testUserLine(lineId) {
  if (!lineId) return 'กรุณาระบุ LINE ID';
  const flex = {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', paddingAll: '20px',
      contents: [
        { type: 'text', text: '📲 ทดสอบแจ้งเตือนส่วนตัว', size: 'xl', weight: 'bold', color: '#059669' },
        { type: 'text', text: 'ระบบสามารถส่งข้อความหาคุณได้แล้ว', size: 'sm', color: '#4b5563', margin: 'md' },
        { type: 'text', text: 'ID: ' + lineId, size: 'xxs', color: '#9ca3af', margin: 'lg' },
        { type: 'text', text: 'ทดสอบเมื่อ: ' + nowStr_(), size: 'xxs', color: '#9ca3af' }
      ]
    }
  };
  return sendLineFlex_('📲 ทดสอบแจ้งเตือนส่วนตัว', flex, lineId) ? 'ส่งทดสอบสำเร็จ' : 'ส่งทดสอบไม่สำเร็จ (ตรวจสอบ LINE ID หรือ Token)';
}

// ============== DASHBOARD ==============
function getDashboard(period) {
  // period: 'day' | 'month' | 'year'
  const today = new Date();
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();

  // อ่านหลาย collection พร้อมกันด้วย fetchAll เพื่อความเร็ว
  const multi = firestoreListDocsMulti_([SHEETS.USAGE, SHEETS.MAINTENANCE, SHEETS.FUEL, SHEETS.BORROWING, SHEETS.VEHICLES, SHEETS.EQUIPMENT]);
  const usage = multi[SHEETS.USAGE];
  const maintenance = multi[SHEETS.MAINTENANCE];
  const fuel = multi[SHEETS.FUEL];
  const borrowing = multi[SHEETS.BORROWING];
  const vehicles = multi[SHEETS.VEHICLES];
  const equipment = multi[SHEETS.EQUIPMENT];

  const matchPeriod = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d)) return false;
    if (period === 'day') return d.getFullYear() === ty && d.getMonth() + 1 === tm && d.getDate() === td;
    if (period === 'month') return d.getFullYear() === ty && d.getMonth() + 1 === tm;
    return d.getFullYear() === ty;
  };

  const fUsage = usage.filter(u => matchPeriod(u['วันที่ออก']));
  const fMaint = maintenance.filter(m => matchPeriod(m['วันที่']));
  const fFuel = fuel.filter(f => matchPeriod(f['วันที่']));
  const fBorrow = borrowing.filter(b => matchPeriod(b['วันที่ขอยืม']));

  const totalMaintCost = fMaint.reduce((s, m) => s + (parseFloat(m['จำนวนเงิน']) || 0), 0);
  const totalFuelCost = fFuel.reduce((s, f) => s + (parseFloat(f['จำนวนเงิน']) || 0), 0);
  const totalFuelLiters = fFuel.reduce((s, f) => s + (parseFloat(f['จำนวนลิตร']) || 0), 0);
  const totalDistance = fUsage.reduce((s, u) => s + (parseFloat(u['ระยะทาง(กม.)']) || 0), 0);

  // by vehicle
  const byVehicle = {};
  vehicles.forEach(v => {
    byVehicle[v['ทะเบียน']] = { plate: v['ทะเบียน'], usage: 0, fuel: 0, maint: 0, distance: 0 };
  });
  fUsage.forEach(u => {
    if (byVehicle[u['ทะเบียน']]) {
      byVehicle[u['ทะเบียน']].usage++;
      byVehicle[u['ทะเบียน']].distance += parseFloat(u['ระยะทาง(กม.)']) || 0;
    }
  });
  fFuel.forEach(f => {
    if (byVehicle[f['ทะเบียน']]) byVehicle[f['ทะเบียน']].fuel += parseFloat(f['จำนวนเงิน']) || 0;
  });
  fMaint.forEach(m => {
    if (byVehicle[m['ทะเบียน']]) byVehicle[m['ทะเบียน']].maint += parseFloat(m['จำนวนเงิน']) || 0;
  });

  return {
    period: period,
    summary: {
      totalVehicles: vehicles.length,
      availableVehicles: vehicles.filter(v => v['สถานะ'] === 'พร้อมใช้งาน').length,
      totalEquipment: equipment.length,
      activeBorrowing: borrowing.filter(b =>
        ['รอรับเรื่อง','รับเรื่องแล้ว','อยู่ในระหว่างการยืม','ถึงวันครบกำหนดคืน','อยู่ในระหว่างการคืน'].includes(b['สถานะ'])
      ).length,
      usageCount: fUsage.length,
      maintCost: totalMaintCost,
      fuelCost: totalFuelCost,
      fuelLiters: totalFuelLiters,
      totalDistance: totalDistance,
      borrowCount: fBorrow.length
    },
    byVehicle: Object.values(byVehicle),
    recentUsage: fUsage.slice(-10).reverse(),
    recentBorrow: fBorrow.slice(-10).reverse()
  };
}

// ============== EXPORT ==============
// หมายเหตุ: Sheets เดิมมีลำดับคอลัมน์คงที่จากแถวหัวตาราง แต่ Firestore ไม่มีแนวคิด
// ลำดับคอลัมน์ตายตัว จึงสร้างหัวตาราง CSV จากการรวมกุญแจ (key) ทั้งหมดที่พบในทุก
// เอกสาร โดยรักษาลำดับที่พบครั้งแรกไว้ ให้ผลลัพธ์ใกล้เคียงของเดิมมากที่สุด
function exportToCSV(sheetName) {
  try {
    const rows = firestoreListDocs_(sheetName);
    const esc = (v) => {
      const c = String(v === null || v === undefined ? '' : v);
      return c.includes(',') || c.includes('"') || c.includes('\n')
        ? '"' + c.replace(/"/g, '""') + '"'
        : c;
    };

    if (!rows.length) {
      return { success: true, csv: '﻿', filename: sheetName + '_' + todayStr_() + '.csv' };
    }

    const headers = [];
    const seen = {};
    rows.forEach(r => {
      Object.keys(r).forEach(k => {
        if (!seen[k]) { seen[k] = true; headers.push(k); }
      });
    });

    let csv = '﻿'; // BOM for UTF-8
    csv += headers.map(esc).join(',') + '\n';
    csv += rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');

    return { success: true, csv: csv, filename: sheetName + '_' + todayStr_() + '.csv' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============== ALERTS ==============
function checkOverdue() {
  const multi = firestoreListDocsMulti_([SHEETS.BORROWING, SHEETS.VEHICLES, SHEETS.MAINTENANCE, SHEETS.DRIVERS]);
  const borrowing = multi[SHEETS.BORROWING];
  const vehicles = multi[SHEETS.VEHICLES];
  const maintenance = multi[SHEETS.MAINTENANCE];
  const drivers = multi[SHEETS.DRIVERS];

  const today = new Date(); today.setHours(0,0,0,0);
  let countOverdue = 0;

  // 1. Check Overdue Equipment Borrowing
  borrowing.forEach(b => {
    if (['อยู่ในระหว่างการยืม','รับเรื่องแล้ว','ขอขยายเวลา'].includes(b['สถานะ'])) {
      if (b['วันที่ครบกำหนด']) {
        const due = new Date(b['วันที่ครบกำหนด']);
        if (!isNaN(due.getTime())) {
          due.setHours(0,0,0,0);
          if (due.getTime() <= today.getTime()) {
            updateBorrowingStatus(b['รหัส'], 'ถึงวันครบกำหนดคืน', b['ผู้รับเรื่อง'] || 'ระบบอัตโนมัติ', 'system');
            countOverdue++;
          }
        }
      }
    }
  });

  // 2. Check Vehicles Maintenance (within 500 km)
  let maintAlerts = [];
  try {
    vehicles.forEach(v => {
      const plate = v['ทะเบียน'];
      const currentKm = parseFloat(v['เลขไมล์ปัจจุบัน']) || 0;
      const vMaints = maintenance.filter(m => m['ทะเบียน'] === plate && (parseFloat(m['ครั้งถัดไป(ไมล์)']) || 0) > 0);
      if (vMaints.length > 0) {
        vMaints.sort((a,b) => new Date(b['วันที่']) - new Date(a['วันที่']));
        const nextKm = parseFloat(vMaints[0]['ครั้งถัดไป(ไมล์)']);
        if (nextKm > 0 && (nextKm - currentKm) <= 500) {
          maintAlerts.push(`🚘 รถ ${plate}: ไมล์ปัจจุบัน ${currentKm} กม. ใกล้ถึงกำหนดเปลี่ยนน้ำมัน/เช็คระยะ (${nextKm} กม.)`);
        }
      }
    });
  } catch(e){}

  // 3. Check Driver License Expiration (within 30 days)
  let driverAlerts = [];
  try {
    const future30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    drivers.forEach(d => {
      if (d['วันหมดอายุ']) {
        const expDate = new Date(d['วันหมดอายุ']);
        if (!isNaN(expDate.getTime()) && expDate <= future30) {
          driverAlerts.push(`👨‍✈️ ${d['ชื่อ-นามสกุล']}: ใบขับขี่หมดอายุวันที่ ${d['วันหมดอายุ']}`);
        }
      }
    });
  } catch(e){}

  if (maintAlerts.length > 0 || driverAlerts.length > 0) {
    sendSmartSystemAlertFlex_(maintAlerts, driverAlerts);
  }

  return `ตรวจสอบแล้ว: ยืมอุปกรณ์เกินกำหนด ${countOverdue} รายการ, เตือนบำรุงรักษารถ ${maintAlerts.length} คัน, ใบขับขี่ใกล้หมดอายุ ${driverAlerts.length} คน`;
}

function sendSmartSystemAlertFlex_(maintAlerts, driverAlerts) {
  const contents = [];
  if (maintAlerts && maintAlerts.length > 0) {
    contents.push({ type: 'text', text: '🔧 แจ้งเตือนบำรุงรักษารถยนต์ใกล้ถึงระยะ:', weight: 'bold', size: 'sm', color: '#d97706', margin: 'md' });
    maintAlerts.forEach(msg => {
      contents.push({ type: 'text', text: '• ' + msg, size: 'xs', color: '#334155', wrap: true });
    });
  }
  if (driverAlerts && driverAlerts.length > 0) {
    contents.push({ type: 'text', text: '🪪 แจ้งเตือนใบขับขี่พนักงานใกล้หมดอายุ:', weight: 'bold', size: 'sm', color: '#ef4444', margin: 'md' });
    driverAlerts.forEach(msg => {
      contents.push({ type: 'text', text: '• ' + msg, size: 'xs', color: '#334155', wrap: true });
    });
  }

  const flex = {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#f59e0b', paddingAll: '16px',
      contents: [
        { type: 'text', text: '⚠️ แจ้งเตือนระบบการดูแลรักษา & ใบขับขี่', color: '#ffffff', size: 'lg', weight: 'bold' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', paddingAll: '16px',
      contents: contents
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '10px', backgroundColor: '#f1f5f9',
      contents: [{ type: 'text', text: SYSTEM_NAME, size: 'xs', color: '#64748b', align: 'center' }]
    }
  };

  sendLineFlex_('⚠️ แจ้งเตือนบำรุงรักษารถและใบขับขี่ใกล้หมดอายุ', flex);
}

// หมายเหตุ: ตั้ง trigger รายวัน — ไม่เปิดผ่าน API สาธารณะ ต้องรันจาก Apps Script editor เท่านั้น
function setupDailyTrigger() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => {
      if (t.getHandlerFunction() === 'checkOverdue') {
        ScriptApp.deleteTrigger(t);
      }
    });
    ScriptApp.newTrigger('checkOverdue')
      .timeBased()
      .atHour(8)
      .everyDays(1)
      .create();
    logAudit_('ตั้งค่า Trigger แจ้งเตือน', 'admin', 'ตั้งเวลาเช็คคืนอุปกรณ์ประจำวัน (08:00-09:00 น.)');
    return { success: true, message: 'ตั้งเวลาแจ้งเตือนรายวันอัตโนมัติ (08:30 น.) เรียบร้อยแล้ว' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function replyMessage_(replyToken, messages) {
  try {
    const token = getLineToken();
    if (!token) return;
    const url = 'https://api.line.me/v2/bot/message/reply';
    const msgPayload = Array.isArray(messages) ? messages : [{ type: 'text', text: String(messages) }];
    const payload = {
      replyToken: replyToken,
      messages: msgPayload
    };
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + String(token).trim() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    const body = res.getContentText().substring(0, 500);
    Logger.log(`replyMessage_ status: ${code}, response: ${body}`);
  } catch (e) {
    Logger.log('replyMessage_ error: ' + e.message);
  }
}

function replyLineFlex_(replyToken, altText, flexContent) {
  try {
    const token = getLineToken();
    if (!token) return;
    const url = 'https://api.line.me/v2/bot/message/reply';
    const payload = {
      replyToken: replyToken,
      messages: [{
        type: 'flex',
        altText: altText,
        contents: flexContent
      }]
    };
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + String(token).trim() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    const body = res.getContentText().substring(0, 500);
    Logger.log(`replyLineFlex_ status: ${code}, response: ${body}`);
    return { success: code >= 200 && code < 300, status: code, body: body };
  } catch (e) {
    Logger.log('replyLineFlex_ error: ' + e.message);
    return { success: false, status: 0, body: String(e.message || e) };
  }
}

function safeTruncate_(str, maxLength) {
  if (!str) return '';
  str = String(str).replace(/[\r\n\t\s]+/g, ' ').trim();
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

// ============== IMPORT / EXTERNAL DATA APIS ==============
function fetchGoogleSheetData(url, sheetName, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    let ss;
    if (url.indexOf('docs.google.com/spreadsheets') !== -1) {
      ss = SpreadsheetApp.openByUrl(url);
    } else {
      ss = SpreadsheetApp.openById(url);
    }

    let sheet;
    if (sheetName) {
      sheet = ss.getSheetByName(sheetName);
    } else {
      sheet = ss.getSheets()[0];
    }

    if (!sheet) {
      return { success: false, message: 'ไม่พบแผ่นงานตามที่ระบุ' };
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) {
      return { success: false, message: 'ชีตนี้ไม่มีข้อมูลสำหรับนำเข้า' };
    }

    const rawData = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = rawData[0].map(h => String(h || '').trim());
    const dataObjects = rawData.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, idx) => {
        if (h) {
          obj[h] = row[idx] !== null && row[idx] !== undefined ? String(row[idx]).trim() : '';
        }
      });
      return obj;
    });

    return { success: true, data: dataObjects, headers: headers };
  } catch (err) {
    return { success: false, message: 'ไม่สามารถอ่าน Google Sheet ได้: ' + err.message };
  }
}

function importUsers(usersList, adminCode, duplicateHandling) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const settings = getSystemSettings();
    let allowedRoles = ['admin', 'manager', 'user', 'ผู้ใช้งานเฉพาะตัวเอง', 'พนักงานขับรถ(เปิดเฉพาะตำแหน่งพนักงานขับรถ)'];
    try {
      if (settings && settings.SYSTEM_ROLES) {
        allowedRoles = JSON.parse(settings.SYSTEM_ROLES);
      }
    } catch(e){}

    const existingUsers = getUsers();
    const existingMap = {};
    existingUsers.forEach(u => {
      existingMap[String(u['ชื่อ-นามสกุล'] || '').trim().toLowerCase()] = u;
    });

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < usersList.length; i++) {
      let data = usersList[i];
      if (!data['ชื่อ-นามสกุล'] || !String(data['ชื่อ-นามสกุล']).trim()) {
        skippedCount++;
        continue;
      }

      const nameKey = String(data['ชื่อ-นามสกุล']).trim().toLowerCase();
      const existing = existingMap[nameKey];

      // Trim data fields and mapping headers
      const rowData = {
        'ชื่อ-นามสกุล': String(data['ชื่อ-นามสกุล'] || '').trim(),
        'ตำแหน่ง': String(data['ตำแหน่ง'] || '').trim(),
        'หน่วยงาน': String(data['หน่วยงาน'] || '').trim(),
        'เบอร์ติดต่อ': String(data['เบอร์ติดต่อ'] || '').trim(),
        'อีเมล': String(data['อีเมล'] || '').trim(),
        'รหัสผ่าน': String(data['รหัสผ่าน'] || '').trim() || '12345',
        'บทบาท': String(data['บทบาท'] || '').trim() || 'user',
        'สถานะ': String(data['สถานะ'] || '').trim() || 'ใช้งาน',
        'LINE ID': String(data['LINE ID'] || '').trim(),
        'LINE Token': String(data['LINE Token'] || data['Line Token'] || '').trim(),
        'Telegram ID': String(data['Telegram ID'] || '').trim(),
        'Telegram Token': String(data['Telegram Token'] || '').trim()
      };

      // Match allowed roles case-insensitively for English, preserve Thai
      let matchedRole = rowData['บทบาท'];
      const matchedIdx = allowedRoles.map(r => r.toLowerCase()).indexOf(matchedRole.toLowerCase());
      matchedRole = matchedIdx !== -1 ? allowedRoles[matchedIdx] : 'user';
      rowData['บทบาท'] = matchedRole;

      if (existing) {
        if (duplicateHandling === 'update') {
          const existingCred = firestoreGetDoc_('userCredentials', existing['รหัส']);
          const mergedData = {
            'รหัส': existing['รหัส'],
            'ชื่อ-นามสกุล': rowData['ชื่อ-นามสกุล'] || existing['ชื่อ-นามสกุล'] || '',
            'ตำแหน่ง': rowData['ตำแหน่ง'] || existing['ตำแหน่ง'] || '',
            'หน่วยงาน': rowData['หน่วยงาน'] || existing['หน่วยงาน'] || '',
            'เบอร์ติดต่อ': rowData['เบอร์ติดต่อ'] || existing['เบอร์ติดต่อ'] || '',
            'อีเมล': rowData['อีเมล'] || existing['อีเมล'] || '',
            'บทบาท': (rowData['บทบาท'] !== 'user' && rowData['บทบาท'] !== '') ? rowData['บทบาท'] : (existing['บทบาท'] || 'user'),
            'สถานะ': (rowData['สถานะ'] !== 'ใช้งาน' && rowData['สถานะ'] !== '') ? rowData['สถานะ'] : (existing['สถานะ'] || 'ใช้งาน'),
            'LINE ID': rowData['LINE ID'] || existing['LINE ID'] || '',
            'LINE Token': rowData['LINE Token'] || existing['LINE Token'] || '',
            'Telegram ID': rowData['Telegram ID'] || existing['Telegram ID'] || '',
            'Telegram Token': rowData['Telegram Token'] || existing['Telegram Token'] || '',
            'วันที่บันทึก': existing['วันที่บันทึก'] || todayStr_()
          };

          let matchedMergedRole = mergedData['บทบาท'];
          const matchedMergedIdx = allowedRoles.map(r => r.toLowerCase()).indexOf(matchedMergedRole.toLowerCase());
          mergedData['บทบาท'] = matchedMergedIdx !== -1 ? allowedRoles[matchedMergedIdx] : 'user';

          const mergedPassword = (rowData['รหัสผ่าน'] !== '12345' && rowData['รหัสผ่าน'] !== '') ? rowData['รหัสผ่าน'] : ((existingCred && existingCred['รหัสผ่าน']) || '12345');

          firestoreSetDoc_(SHEETS.USERS, mergedData['รหัส'], mergedData);
          firestoreSetDoc_('userCredentials', mergedData['รหัส'], { 'รหัส': mergedData['รหัส'], 'รหัสผ่าน': mergedPassword });
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        rowData['รหัส'] = newId_('UR');
        rowData['วันที่บันทึก'] = todayStr_();
        const password = rowData['รหัสผ่าน'];
        const publicData = Object.assign({}, rowData);
        delete publicData['รหัสผ่าน'];
        firestoreSetDoc_(SHEETS.USERS, rowData['รหัส'], publicData);
        firestoreSetDoc_('userCredentials', rowData['รหัส'], { 'รหัส': rowData['รหัส'], 'รหัสผ่าน': password });
        importedCount++;
      }
    }
    logAudit_('นำเข้าผู้ใช้', 'admin', `นำเข้า ${importedCount}, อัปเดต ${updatedCount}, ข้าม ${skippedCount}`);
    return {
      success: true,
      message: `นำเข้าสำเร็จ: เพิ่มใหม่ ${importedCount} รายการ, อัปเดต ${updatedCount} รายการ, ข้าม ${skippedCount} รายการ`
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function testTelegramNotification(botToken, chatId) {
  if (!botToken || !chatId) return 'กรุณาระบุ Bot Token และ Chat ID';
  try {
    const url = 'https://api.telegram.org/bot' + botToken.trim() + '/sendMessage';
    const payload = {
      chat_id: chatId.trim(),
      text: '📲 ทดสอบแจ้งเตือนจากระบบ ' + SYSTEM_NAME + '\nเชื่อมต่อสำเร็จเวลา: ' + nowStr_()
    };
    const options = {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify(payload)
    };
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    const body = JSON.parse(res.getContentText());
    if (code === 200 && body.ok) {
      return 'ส่งสำเร็จ';
    } else {
      return 'ส่งไม่สำเร็จ: ' + (body.description || 'รหัสตอบกลับ ' + code);
    }
  } catch (err) {
    return 'ผิดพลาด: ' + err.message;
  }
}

function importEquipment(equipList, adminCode, duplicateHandling) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const existingEquips = getEquipment();

    const existingByAssetId = {};
    const existingByName = {};
    existingEquips.forEach(e => {
      const assetId = String(e['รหัสครุภัณฑ์'] || '').trim().toLowerCase();
      if (assetId) existingByAssetId[assetId] = e;

      const name = String(e['ชื่ออุปกรณ์'] || '').trim().toLowerCase();
      if (name) existingByName[name] = e;
    });

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < equipList.length; i++) {
      let data = equipList[i];
      if (!data['ชื่ออุปกรณ์'] || !String(data['ชื่ออุปกรณ์']).trim()) {
        skippedCount++;
        continue;
      }

      const importedName = String(data['ชื่ออุปกรณ์'] || '').trim();
      const importedAssetId = String(data['รหัสครุภัณฑ์'] || '').trim();

      let existing = null;
      if (importedAssetId) {
        existing = existingByAssetId[importedAssetId.toLowerCase()];
      }
      if (!existing) {
        existing = existingByName[importedName.toLowerCase()];
      }

      const rowData = {
        'รหัสครุภัณฑ์': importedAssetId,
        'ชื่ออุปกรณ์': importedName,
        'หมวดหมู่': String(data['หมวดหมู่'] || '').trim(),
        'ยี่ห้อ': String(data['ยี่ห้อ'] || '').trim(),
        'รุ่น': String(data['รุ่น'] || '').trim(),
        'Serial': String(data['Serial'] || '').trim(),
        'จำนวน': Number(data['จำนวน']) || 1,
        'หน่วยนับ': String(data['หน่วยนับ'] || '').trim() || 'เครื่อง',
        'สถานะ': String(data['สถานะ'] || '').trim() || 'พร้อมยืม',
        'ที่เก็บ': String(data['ที่เก็บ'] || '').trim(),
        'มูลค่า': Number(data['มูลค่า']) || 0,
        'วันที่จัดซื้อ': String(data['วันที่จัดซื้อ'] || '').trim(),
        'หมายเหตุ': String(data['หมายเหตุ'] || '').trim()
      };

      if (existing) {
        if (duplicateHandling === 'update') {
          const mergedData = {
            'รหัส': existing['รหัส'],
            'รหัสครุภัณฑ์': rowData['รหัสครุภัณฑ์'] || existing['รหัสครุภัณฑ์'] || '',
            'ชื่ออุปกรณ์': rowData['ชื่ออุปกรณ์'] || existing['ชื่ออุปกรณ์'] || '',
            'หมวดหมู่': rowData['หมวดหมู่'] || existing['หมวดหมู่'] || '',
            'ยี่ห้อ': rowData['ยี่ห้อ'] || existing['ยี่ห้อ'] || '',
            'รุ่น': rowData['รุ่น'] || existing['รุ่น'] || '',
            'Serial': rowData['Serial'] || existing['Serial'] || '',
            'จำนวน': data['จำนวน'] !== undefined && data['จำนวน'] !== '' ? Number(data['จำนวน']) : (Number(existing['จำนวน']) || 1),
            'หน่วยนับ': rowData['หน่วยนับ'] || existing['หน่วยนับ'] || 'เครื่อง',
            'สถานะ': rowData['สถานะ'] || existing['สถานะ'] || 'พร้อมยืม',
            'ที่เก็บ': rowData['ที่เก็บ'] || existing['ที่เก็บ'] || '',
            'มูลค่า': data['มูลค่า'] !== undefined && data['มูลค่า'] !== '' ? Number(data['มูลค่า']) : (Number(existing['มูลค่า']) || 0),
            'วันที่จัดซื้อ': rowData['วันที่จัดซื้อ'] || existing['วันที่จัดซื้อ'] || '',
            'หมายเหตุ': rowData['หมายเหตุ'] || existing['หมายเหตุ'] || '',
            'วันที่บันทึก': existing['วันที่บันทึก'] || todayStr_()
          };
          firestoreSetDoc_(SHEETS.EQUIPMENT, mergedData['รหัส'], mergedData);
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        rowData['รหัส'] = newId_('EQ');
        rowData['วันที่บันทึก'] = todayStr_();
        firestoreSetDoc_(SHEETS.EQUIPMENT, rowData['รหัส'], rowData);
        importedCount++;
      }
    }
    logAudit_('นำเข้าอุปกรณ์', 'admin', `นำเข้า ${importedCount}, อัปเดต ${updatedCount}, ข้าม ${skippedCount}`);
    return {
      success: true,
      message: `นำเข้าสำเร็จ: เพิ่มใหม่ ${importedCount} รายการ, อัปเดต ${updatedCount} รายการ, ข้าม ${skippedCount} รายการ`
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function importVehicles(vehicleList, adminCode, duplicateHandling) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const existingVehicles = getVehicles();
    const existingMap = {};
    existingVehicles.forEach(v => {
      const plate = String(v['ทะเบียน'] || '').trim().toLowerCase();
      if (plate) existingMap[plate] = v;
    });

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < vehicleList.length; i++) {
      let data = vehicleList[i];
      if (!data['ทะเบียน'] || !String(data['ทะเบียน']).trim()) {
        skippedCount++;
        continue;
      }

      const plateKey = String(data['ทะเบียน']).trim().toLowerCase();
      const existing = existingMap[plateKey];

      const rowData = {
        'ทะเบียน': String(data['ทะเบียน'] || '').trim(),
        'ยี่ห้อ': String(data['ยี่ห้อ'] || '').trim(),
        'รุ่น': String(data['รุ่น'] || '').trim(),
        'สี': String(data['สี'] || '').trim(),
        'ประเภท': String(data['ประเภท'] || data['ประเภทรถ'] || '').trim() || 'รถเก๋ง',
        'ปีที่ใช้งาน': data['ปีที่ใช้งาน'] !== undefined && data['ปีที่ใช้งาน'] !== '' ? Number(data['ปีที่ใช้งาน']) : new Date().getFullYear(),
        'อายุการใช้งาน(ปี)': data['อายุการใช้งาน(ปี)'] !== undefined && data['อายุการใช้งาน(ปี)'] !== '' ? Number(data['อายุการใช้งาน(ปี)']) : 0,
        'เลขไมล์ปัจจุบัน': Number(data['เลขไมล์ปัจจุบัน'] || 0) || 0,
        'สถานะ': String(data['สถานะ'] || '').trim() || 'พร้อมใช้งาน',
        'หน่วยงาน': String(data['หน่วยงาน'] || '').trim(),
        'หมายเหตุ': String(data['หมายเหตุ'] || '').trim()
      };

      if (existing) {
        if (duplicateHandling === 'update') {
          const mergedData = {
            'รหัส': existing['รหัส'],
            'ทะเบียน': rowData['ทะเบียน'] || existing['ทะเบียน'] || '',
            'ยี่ห้อ': rowData['ยี่ห้อ'] || existing['ยี่ห้อ'] || '',
            'รุ่น': rowData['รุ่น'] || existing['รุ่น'] || '',
            'สี': rowData['สี'] || existing['สี'] || '',
            'ประเภท': rowData['ประเภท'] || existing['ประเภท'] || 'รถเก๋ง',
            'ปีที่ใช้งาน': data['ปีที่ใช้งาน'] !== undefined && data['ปีที่ใช้งาน'] !== '' ? Number(data['ปีที่ใช้งาน']) : (Number(existing['ปีที่ใช้งาน']) || new Date().getFullYear()),
            'อายุการใช้งาน(ปี)': data['อายุการใช้งาน(ปี)'] !== undefined && data['อายุการใช้งาน(ปี)'] !== '' ? Number(data['อายุการใช้งาน(ปี)']) : (Number(existing['อายุการใช้งาน(ปี)']) || 0),
            'เลขไมล์ปัจจุบัน': data['เลขไมล์ปัจจุบัน'] !== undefined && data['เลขไมล์ปัจจุบัน'] !== '' ? Number(data['เลขไมล์ปัจจุบัน']) : (Number(existing['เลขไมล์ปัจจุบัน']) || 0),
            'สถานะ': rowData['สถานะ'] || existing['สถานะ'] || 'พร้อมใช้งาน',
            'หน่วยงาน': rowData['หน่วยงาน'] || existing['หน่วยงาน'] || '',
            'หมายเหตุ': rowData['หมายเหตุ'] || existing['หมายเหตุ'] || '',
            'วันที่บันทึก': existing['วันที่บันทึก'] || todayStr_()
          };
          firestoreSetDoc_(SHEETS.VEHICLES, mergedData['รหัส'], mergedData);
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        rowData['รหัส'] = newId_('VH');
        rowData['วันที่บันทึก'] = todayStr_();
        firestoreSetDoc_(SHEETS.VEHICLES, rowData['รหัส'], rowData);
        importedCount++;
      }
    }
    logAudit_('นำเข้ายานพาหนะ', 'admin', `นำเข้า ${importedCount}, อัปเดต ${updatedCount}, ข้าม ${skippedCount}`);
    return {
      success: true,
      message: `นำเข้ายานพาหนะสำเร็จ: เพิ่มใหม่ ${importedCount} คัน, อัปเดต ${updatedCount} คัน, ข้าม ${skippedCount} คัน`
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function importDrivers(driverList, adminCode, duplicateHandling) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const existingDrivers = getDrivers();
    const existingMap = {};
    existingDrivers.forEach(d => {
      const name = String(d['ชื่อ-นามสกุล'] || '').trim().toLowerCase();
      if (name) existingMap[name] = d;
    });

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < driverList.length; i++) {
      let data = driverList[i];
      if (!data['ชื่อ-นามสกุล'] || !String(data['ชื่อ-นามสกุล']).trim()) {
        skippedCount++;
        continue;
      }

      const nameKey = String(data['ชื่อ-นามสกุล']).trim().toLowerCase();
      const existing = existingMap[nameKey];

      const rowData = {
        'ชื่อ-นามสกุล': String(data['ชื่อ-นามสกุล'] || '').trim(),
        'ใบขับขี่': String(data['ใบขับขี่'] || '').trim(),
        'ประเภทใบขับขี่': String(data['ประเภทใบขับขี่'] || '').trim(),
        'วันหมดอายุ': String(data['วันหมดอายุ'] || '').trim(),
        'เบอร์ติดต่อ': String(data['เบอร์ติดต่อ'] || '').trim(),
        'วันเริ่มงาน': String(data['วันเริ่มงาน'] || '').trim(),
        'สถานะ': String(data['สถานะ'] || '').trim() || 'ปฏิบัติงาน'
      };

      if (existing) {
        if (duplicateHandling === 'update') {
          const mergedData = {
            'รหัส': existing['รหัส'],
            'ชื่อ-นามสกุล': rowData['ชื่อ-นามสกุล'] || existing['ชื่อ-นามสกุล'] || '',
            'ใบขับขี่': rowData['ใบขับขี่'] || existing['ใบขับขี่'] || '',
            'ประเภทใบขับขี่': rowData['ประเภทใบขับขี่'] || existing['ประเภทใบขับขี่'] || '',
            'วันหมดอายุ': rowData['วันหมดอายุ'] || existing['วันหมดอายุ'] || '',
            'เบอร์ติดต่อ': rowData['เบอร์ติดต่อ'] || existing['เบอร์ติดต่อ'] || '',
            'วันเริ่มงาน': rowData['วันเริ่มงาน'] || existing['วันเริ่มงาน'] || '',
            'สถานะ': rowData['สถานะ'] || existing['สถานะ'] || 'ปฏิบัติงาน',
            'วันที่บันทึก': existing['วันที่บันทึก'] || todayStr_()
          };
          firestoreSetDoc_(SHEETS.DRIVERS, mergedData['รหัส'], mergedData);
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        rowData['รหัส'] = newId_('DR');
        rowData['วันที่บันทึก'] = todayStr_();
        firestoreSetDoc_(SHEETS.DRIVERS, rowData['รหัส'], rowData);
        importedCount++;
      }
    }
    logAudit_('นำเข้าพนักงานขับรถ', 'admin', `นำเข้า ${importedCount}, อัปเดต ${updatedCount}, ข้าม ${skippedCount}`);
    return {
      success: true,
      message: `นำเข้าพนักงานขับรถสำเร็จ: เพิ่มใหม่ ${importedCount} รายการ, อัปเดต ${updatedCount} รายการ, ข้าม ${skippedCount} รายการ`
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function requestPasswordResetNotification(contactInfo) {
  try {
    logAudit_('ลืมรหัสผ่าน', 'system', 'แจ้งติดต่อกลับ: ' + contactInfo);

    const altText = '🔑 แจ้งลืมรหัสผ่าน: ' + contactInfo;
    const flex = {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: '🔑 แจ้งเตือนลืมรหัสผ่าน', size: 'lg', weight: 'bold', color: '#ef4444' },
          { type: 'text', text: SYSTEM_NAME, size: 'xs', color: '#64748b', margin: 'sm' },
          { type: 'separator', margin: 'md', color: '#e2e8f0' },
          { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm',
            contents: [
              { type: 'text', text: 'ข้อมูลติดต่อกลับ/ผู้ใช้งาน:', size: 'sm', color: '#64748b' },
              { type: 'text', text: contactInfo, size: 'md', weight: 'bold', color: '#0f172a', wrap: true }
            ]
          },
          { type: 'text', text: 'วันที่แจ้ง: ' + nowStr_(), size: 'xs', color: '#94a3b8', margin: 'lg' }
        ]
      }
    };

    sendLineFlex_(altText, flex);

    return { success: true, message: 'ส่งข้อมูลแจ้งลืมรหัสผ่านเรียบร้อยแล้ว ทีมผู้ดูแลระบบได้รับข้อความแล้ว' };
  } catch (err) {
    return { success: false, message: 'ผิดพลาด: ' + err.message };
  }
}

// ============== SYSTEM SETTINGS ==============
function getSystemSettings() {
  try {
    const rows = firestoreListDocs_(SHEETS.SETTINGS);
    const settings = {};
    rows.forEach(r => {
      const key = String(r['Key'] || '').trim();
      if (key) settings[key] = String(r['Value'] || '').trim();
    });
    return settings;
  } catch (err) {
    return {};
  }
}

function saveSystemSettings(settings, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin' };
  try {
    for (let key in settings) {
      const val = String(settings[key]).trim();
      firestoreSetDoc_(SHEETS.SETTINGS, key, { Key: key, Value: val });
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ------------------------------------------------------------------
// TEMPORARY, ONE-TIME: ล้าง "รหัสผ่าน" ที่หลุดค้างอยู่ใน collection "users"
// สาธารณะ (เกิดจากบั๊ก firestoreSetDoc_ เดิมที่ merge แทนที่จะ replace) โดยไม่ต้อง
// อ่านทั้งเอกสารก่อนต่อแถว (เร็วกว่า migrateExistingSheetToFirestoreOnce_ มาก
// เพราะไม่ผ่าน Google Sheets เลย ใช้ข้อมูลที่มีอยู่ใน Firestore ตรงๆ)
// ลบฟังก์ชันนี้ทิ้งได้ทันทีหลังยืนยันว่าไม่มี users doc ไหนมีฟิลด์ "รหัสผ่าน" ค้างแล้ว
// ------------------------------------------------------------------
function purgeUserPasswordLeak_(adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const users = firestoreListDocs_('users');
    let fixed = 0, failed = 0, alreadyClean = 0;
    users.forEach(u => {
      const docId = u['รหัส'];
      if (!docId) { failed++; return; }
      if (u['รหัสผ่าน'] === undefined) { alreadyClean++; return; }

      const projectId = getFirebaseProjectId();
      const credUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/userCredentials/${encodeURIComponent(docId)}` +
        `?updateMask.fieldPaths=${encodeURIComponent(firestoreFieldPathEscape_('รหัส'))}&updateMask.fieldPaths=${encodeURIComponent(firestoreFieldPathEscape_('รหัสผ่าน'))}`;
      const credRes = UrlFetchApp.fetch(credUrl, {
        method: 'patch',
        contentType: 'application/json',
        headers: firestoreAuthHeaders_(),
        payload: JSON.stringify({ fields: {
          'รหัส': jsToFirestoreValue_(docId),
          'รหัสผ่าน': jsToFirestoreValue_(u['รหัสผ่าน'] || '')
        } }),
        muteHttpExceptions: true
      });
      const credOk = credRes.getResponseCode() >= 200 && credRes.getResponseCode() < 300;
      const delOk = firestoreDeleteField_('users', docId, 'รหัสผ่าน');

      if (credOk && delOk) fixed++; else failed++;
    });

    logAudit_('ล้างรหัสผ่านที่หลุดใน users', 'admin', `แก้ไข ${fixed} ราย, สะอาดอยู่แล้ว ${alreadyClean} ราย, ล้มเหลว ${failed} ราย`);
    return { success: true, message: `ล้างรหัสผ่านออกจาก users สำเร็จ: แก้ไข ${fixed}, สะอาดอยู่แล้ว ${alreadyClean}${failed > 0 ? `, ล้มเหลว ${failed}` : ''}`, fixed: fixed, alreadyClean: alreadyClean, failed: failed };
  } catch (err) {
    return { success: false, message: 'ผิดพลาด: ' + err.message };
  }
}

// ============== ONE-TIME MIGRATION (Phase 1.6) ==============
// ------------------------------------------------------------------
// รันเองจาก Apps Script editor เพียง "ครั้งเดียว" หลัง deploy เวอร์ชันนี้
// เพื่อดึงข้อมูลชุดสุดท้ายที่เคยอยู่ใน Google Sheets เข้าสู่ Firestore ให้ครบ
// ก่อน cutover — ไม่อยู่ใน API_WHITELIST (เรียกจากภายนอกไม่ได้) และไม่มี
// Sheets helper ทั่วไป (getSheet_/sheetToObjects_ ฯลฯ) เหลืออยู่ในไฟล์นี้แล้ว
// จึงต้องมีโค้ดอ่านชีตแบบเฉพาะกิจ (inline) อยู่ในฟังก์ชันนี้เพียงจุดเดียว
// ลบฟังก์ชันนี้ทิ้งได้ทันทีหลังยืนยันว่าย้ายข้อมูลครบถ้วนแล้ว
// ------------------------------------------------------------------
function migrateExistingSheetToFirestoreOnce_(adminCode, onlySheets) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const LEGACY_SS_ID = '1vq12omIAsg-s0N3iTNaeagnVhO3c-ICltzu7csLUFEY';
    const ss = SpreadsheetApp.openById(LEGACY_SS_ID);

    const legacySafeValue = (v) => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) {
        const h = v.getHours(), m = v.getMinutes(), s = v.getSeconds();
        if (h === 0 && m === 0 && s === 0) return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd');
        return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
      }
      if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
      return v;
    };

    const legacySheetToObjects = (sheet) => {
      if (!sheet) return [];
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow < 2 || lastCol < 1) return [];
      const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      const headers = data[0].map(h => String(h));
      return data.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = legacySafeValue(row[i]); });
        return obj;
      });
    };

    let sheetNames = [
      SHEETS.VEHICLES, SHEETS.USAGE, SHEETS.MAINTENANCE, SHEETS.FUEL, SHEETS.FUEL_QUOTA,
      SHEETS.EQUIPMENT, SHEETS.EQUIPMENT_CATEGORY, SHEETS.BORROWING, SHEETS.USERS,
      SHEETS.DRIVERS, SHEETS.BOOKING, SHEETS.INSPECTION, SHEETS.NOTIFICATIONS,
      SHEETS.AUDIT, SHEETS.DEPARTMENTS
    ];
    // รองรับการรันแบบแบ่งชุดย่อย (onlySheets) เพื่อเลี่ยง execution timeout ของ Apps Script
    // เมื่อข้อมูลมีจำนวนมาก — ไม่ระบุ = รันครบทุกชีตเหมือนเดิม
    if (Array.isArray(onlySheets) && onlySheets.length) {
      sheetNames = sheetNames.filter(s => onlySheets.indexOf(s) !== -1);
    }

    let totalSynced = 0, totalFailed = 0;
    sheetNames.forEach(sheetName => {
      const sheet = ss.getSheetByName(sheetName);
      const rows = legacySheetToObjects(sheet);
      rows.forEach(doc => {
        const docId = String(doc['รหัส'] || doc['User ID'] || doc['อีเมล'] || doc['ชื่อผู้ใช้'] || doc['ชื่อ-นามสกุล'] || doc['รหัสครุภัณฑ์'] || doc['ทะเบียน'] || doc['Key'] || Date.now());

        if (sheetName === SHEETS.USERS) {
          // แยกรหัสผ่านออกไป collection userCredentials ตั้งแต่ตอน migrate เลย
          const password = doc['รหัสผ่าน'];
          const publicDoc = Object.assign({}, doc);
          delete publicDoc['รหัสผ่าน'];
          const ok1 = firestoreSetDoc_(sheetName, docId, publicDoc);
          const ok2 = firestoreSetDoc_('userCredentials', docId, { 'รหัส': docId, 'รหัสผ่าน': password || '' });
          if (ok1 && ok2) totalSynced++; else totalFailed++;
        } else {
          const ok = firestoreSetDoc_(sheetName, docId, doc);
          if (ok) totalSynced++; else totalFailed++;
        }
      });
    });

    logAudit_('ย้ายข้อมูลครั้งเดียวจาก Sheets เข้า Firestore', 'admin', `สำเร็จ ${totalSynced} รายการ, ล้มเหลว ${totalFailed} รายการ`);
    return {
      success: true,
      message: `ย้ายข้อมูลจาก Google Sheets เข้าสู่ Firebase Cloud Firestore สำเร็จ: ${totalSynced} รายการ${totalFailed > 0 ? `, ล้มเหลว ${totalFailed} รายการ` : ''}`,
      synced: totalSynced,
      failed: totalFailed
    };
  } catch (err) {
    return { success: false, message: 'ผิดพลาด: ' + err.message };
  }
}

/**
 * ฟังก์ชันสร้าง LINE Rich Menu บริหารความเสี่ยง (Risk Management)
 */
function createRiskRichMenuAPI() {
  const token = getScriptProp_('LINE_TOKEN', DEFAULT_LINE_TOKEN);
  if (!token) return { success: false, message: 'กรุณาตั้งค่า LINE Channel Access Token ก่อน' };

  const richMenuPayload = {
    "size": { "width": 2500, "height": 1686 },
    "selected": true,
    "name": "VMES_Risk_Management_Menu",
    "chatBarText": "📊 เมนูบริหารความเสี่ยง (Risk Menu)",
    "areas": [
      {
        "bounds": { "x": 0, "y": 0, "width": 833, "height": 843 },
        "action": { "type": "uri", "label": "ภาพรวมความเสี่ยง", "uri": "https://vmes.web.app/#risk-dashboard" }
      },
      {
        "bounds": { "x": 833, "y": 0, "width": 834, "height": 843 },
        "action": { "type": "uri", "label": "ทะเบียนความเสี่ยง", "uri": "https://vmes.web.app/#risk-register" }
      },
      {
        "bounds": { "x": 1667, "y": 0, "width": 833, "height": 843 },
        "action": { "type": "uri", "label": "รายงานความเสี่ยงใหม่", "uri": "https://vmes.web.app/#risk-report" }
      },
      {
        "bounds": { "x": 0, "y": 843, "width": 833, "height": 843 },
        "action": { "type": "uri", "label": "ประเมินความเสี่ยง", "uri": "https://vmes.web.app/#risk-assessment" }
      },
      {
        "bounds": { "x": 833, "y": 843, "width": 834, "height": 843 },
        "action": { "type": "uri", "label": "มาตรการควบคุม", "uri": "https://vmes.web.app/#risk-treatment" }
      },
      {
        "bounds": { "x": 1667, "y": 843, "width": 833, "height": 843 },
        "action": { "type": "uri", "label": "คู่มือและช่วยเหลือ", "uri": "https://vmes.web.app/#help" }
      }
    ]
  };

  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(richMenuPayload),
      muteHttpExceptions: true
    });
    const result = JSON.parse(res.getContentText());
    if (result.richMenuId) {
      logAudit_('สร้าง LINE Rich Menu ความเสี่ยง', 'admin', 'RichMenuID: ' + result.richMenuId);
      return { success: true, richMenuId: result.richMenuId, message: 'สร้าง Rich Menu สำเร็จ: ' + result.richMenuId };
    } else {
      return { success: false, message: 'ไม่สามารถสร้างได้: ' + (result.message || JSON.stringify(result)) };
    }
  } catch (err) {
    return { success: false, message: 'Error: ' + err.message };
  }
}

/**
 * ฟังก์ชันสร้าง LINE Rich Menu ด่วนสำหรับ VMES System V2.0
 */
function createVMESV2RichMenuAPI() {
  const token = getScriptProp_('LINE_TOKEN', DEFAULT_LINE_TOKEN);
  if (!token) return { success: false, message: 'กรุณาตั้งค่า LINE Channel Access Token ก่อน' };

  const webUrl = "https://script.google.com/macros/s/AKfycby9soLTEQ9DM6zloBzZ0v4CdFGAm_8xoc1Gk7MFelTet89Y0ggbMwk3rTE5fWTa3VQ4fQ/exec";

  const richMenuPayload = {
    "size": { "width": 2500, "height": 1686 },
    "selected": true,
    "name": "VMES_V2_RichMenu",
    "chatBarText": "📦 เมนูด่วน VMES System",
    "areas": [
      {
        "bounds": { "x": 0, "y": 0, "width": 833, "height": 843 },
        "action": { "type": "uri", "label": "ยืมอุปกรณ์", "uri": webUrl }
      },
      {
        "bounds": { "x": 833, "y": 0, "width": 834, "height": 843 },
        "action": { "type": "uri", "label": "คืนอุปกรณ์", "uri": webUrl }
      },
      {
        "bounds": { "x": 1667, "y": 0, "width": 833, "height": 843 },
        "action": { "type": "uri", "label": "สแกน QR", "uri": webUrl }
      },
      {
        "bounds": { "x": 0, "y": 843, "width": 833, "height": 843 },
        "action": { "type": "uri", "label": "จองรถ", "uri": webUrl }
      },
      {
        "bounds": { "x": 833, "y": 843, "width": 834, "height": 843 },
        "action": { "type": "uri", "label": "รายการของฉัน", "uri": webUrl }
      },
      {
        "bounds": { "x": 1667, "y": 843, "width": 833, "height": 843 },
        "action": { "type": "uri", "label": "แจ้งปัญหา/ติดต่อ", "uri": webUrl }
      }
    ]
  };

  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(richMenuPayload),
      muteHttpExceptions: true
    });
    const result = JSON.parse(res.getContentText());
    if (result.richMenuId) {
      logAudit_('สร้าง LINE Rich Menu VMES V2', 'admin', 'RichMenuID: ' + result.richMenuId);
      return { success: true, richMenuId: result.richMenuId, message: 'สร้าง Rich Menu VMES V2 สำเร็จ: ' + result.richMenuId };
    } else {
      return { success: false, message: 'ไม่สามารถสร้างได้: ' + (result.message || JSON.stringify(result)) };
    }
  } catch (err) {
    return { success: false, message: 'Error: ' + err.message };
  }
}
