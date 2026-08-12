// ============== API WHITELIST ==============
// พอร์ตจาก รหัส.js L142-218 (API_WHITELIST) แบบ 1:1 — รายชื่อฟังก์ชันนี้ตรงกับต้นฉบับ
// เป๊ะ 42 รายการ (นับจากซอร์สจริง ไม่ใช่ 45 ตามที่แผนงานประมาณไว้ตอนสำรวจครั้งแรก)
// ฟังก์ชันดูแลระบบ/อันตราย (setupSystem, setSystemSecurityProperties,
// setServiceAccountCreds_, saveFirebaseConfig, setupDailyTrigger, verifyAdmin,
// migrateExistingSheetToFirestoreOnce_, purgeUserPasswordLeak_) และตัวสร้าง LINE
// Rich Menu (createRiskRichMenuAPI, createVMESV2RichMenuAPI) ไม่รวมอยู่ในนี้โดยตั้งใจ

const { login } = require('./auth');
const { getBootstrapInfo, saveSystemSettings } = require('./handlers/settings');
const { saveVehicle, deleteVehicle } = require('./handlers/vehicles');
const { saveUsage, returnVehicle } = require('./handlers/usage');
const { saveMaintenance, deleteMaintenance } = require('./handlers/maintenance');
const { saveFuel, deleteFuel } = require('./handlers/fuel');
const { getEquipment, getEquipmentCategories, saveEquipment, deleteEquipment } = require('./handlers/equipment');
const {
  getBorrowing,
  saveBorrowing,
  updateBorrowingStatus,
  requestBorrowExtension,
  approveBorrowExtension,
  getBorrowingByCode,
  deleteBorrowing,
} = require('./handlers/borrowing');
const { saveUser, deleteUser, requestPasswordResetNotification } = require('./handlers/users');
const { saveDriver, deleteDriver } = require('./handlers/drivers');
const { saveBooking, approveBooking, deleteBooking } = require('./handlers/booking');
const { saveInspection, deleteInspection } = require('./handlers/inspection');
const { saveDepartment, deleteDepartment } = require('./handlers/departments');
const { importUsers, importEquipment, importVehicles, importDrivers, fetchGoogleSheetData } = require('./handlers/imports');
const { exportToCSV, getDashboard, checkOverdue } = require('./handlers/dashboard');
const { testLineNotify, testUserLine, testTelegramNotification } = require('./line');

const API_WHITELIST = {
  // Auth / Bootstrap
  login,
  getBootstrapInfo,

  // Vehicles
  saveVehicle,
  deleteVehicle,

  // Usage
  saveUsage,
  returnVehicle,

  // Maintenance
  saveMaintenance,
  deleteMaintenance,

  // Fuel
  saveFuel,
  deleteFuel,

  // Equipment
  getEquipment,
  getEquipmentCategories,
  saveEquipment,
  deleteEquipment,

  // Borrowing
  getBorrowing,
  saveBorrowing,
  updateBorrowingStatus,
  requestBorrowExtension,
  approveBorrowExtension,
  getBorrowingByCode,
  deleteBorrowing,

  // Users
  saveUser,
  deleteUser,

  // Drivers
  saveDriver,
  deleteDriver,

  // Booking
  saveBooking,
  approveBooking,
  deleteBooking,

  // Inspection
  saveInspection,
  deleteInspection,

  // Departments
  saveDepartment,
  deleteDepartment,

  // Import
  importUsers,
  importEquipment,
  importVehicles,
  importDrivers,
  fetchGoogleSheetData,

  // Reports / Dashboard / Alerts
  exportToCSV,
  getDashboard,
  checkOverdue,

  // Settings
  saveSystemSettings,

  // Notifications / Testing
  testLineNotify,
  testUserLine,
  testTelegramNotification,

  // Password
  requestPasswordResetNotification,
};

module.exports = { API_WHITELIST };
