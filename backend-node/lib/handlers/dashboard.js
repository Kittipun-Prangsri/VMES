// ============== DASHBOARD / EXPORT / ALERTS ==============
// พอร์ตจาก รหัส.js L2313-2524 (getDashboard, exportToCSV, checkOverdue, sendSmartSystemAlertFlex_)

const { SHEETS, listDocs } = require('../firestore');
const { todayStr } = require('../util');
const { sendSmartSystemAlertFlex } = require('../line');
const { updateBorrowingStatus } = require('./borrowing');

// เดิมใน รหัส.js: SHEET_TO_FIRESTORE_COLLECTION (L23-40) — frontend (public/index.html)
// ยังเรียก exportSheet() ด้วยชื่อชีตภาษาไทยเดิมอยู่ (ไม่ได้แก้ไข ตามแผน) จึงต้องคง
// mapping นี้ไว้เฉพาะจุดนี้เพื่อแปลงเป็นชื่อ collection ภาษาอังกฤษก่อนอ่าน Firestore
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
  'หน่วยงาน': 'departments',
};

function resolveCollectionName(sheetOrColName) {
  return SHEET_TO_FIRESTORE_COLLECTION[sheetOrColName] || sheetOrColName;
}

async function getDashboard(period) {
  // period: 'day' | 'month' | 'year'
  const today = new Date();
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();

  const [usage, maintenance, fuel, borrowing, vehicles, equipment] = await Promise.all([
    listDocs(SHEETS.USAGE),
    listDocs(SHEETS.MAINTENANCE),
    listDocs(SHEETS.FUEL),
    listDocs(SHEETS.BORROWING),
    listDocs(SHEETS.VEHICLES),
    listDocs(SHEETS.EQUIPMENT),
  ]);

  const matchPeriod = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d)) return false;
    if (period === 'day') return d.getFullYear() === ty && d.getMonth() + 1 === tm && d.getDate() === td;
    if (period === 'month') return d.getFullYear() === ty && d.getMonth() + 1 === tm;
    return d.getFullYear() === ty;
  };

  const fUsage = usage.filter((u) => matchPeriod(u['วันที่ออก']));
  const fMaint = maintenance.filter((m) => matchPeriod(m['วันที่']));
  const fFuel = fuel.filter((f) => matchPeriod(f['วันที่']));
  const fBorrow = borrowing.filter((b) => matchPeriod(b['วันที่ขอยืม']));

  const totalMaintCost = fMaint.reduce((s, m) => s + (parseFloat(m['จำนวนเงิน']) || 0), 0);
  const totalFuelCost = fFuel.reduce((s, f) => s + (parseFloat(f['จำนวนเงิน']) || 0), 0);
  const totalFuelLiters = fFuel.reduce((s, f) => s + (parseFloat(f['จำนวนลิตร']) || 0), 0);
  const totalDistance = fUsage.reduce((s, u) => s + (parseFloat(u['ระยะทาง(กม.)']) || 0), 0);

  // by vehicle
  const byVehicle = {};
  vehicles.forEach((v) => {
    byVehicle[v['ทะเบียน']] = { plate: v['ทะเบียน'], usage: 0, fuel: 0, maint: 0, distance: 0 };
  });
  fUsage.forEach((u) => {
    if (byVehicle[u['ทะเบียน']]) {
      byVehicle[u['ทะเบียน']].usage++;
      byVehicle[u['ทะเบียน']].distance += parseFloat(u['ระยะทาง(กม.)']) || 0;
    }
  });
  fFuel.forEach((f) => {
    if (byVehicle[f['ทะเบียน']]) byVehicle[f['ทะเบียน']].fuel += parseFloat(f['จำนวนเงิน']) || 0;
  });
  fMaint.forEach((m) => {
    if (byVehicle[m['ทะเบียน']]) byVehicle[m['ทะเบียน']].maint += parseFloat(m['จำนวนเงิน']) || 0;
  });

  return {
    period: period,
    summary: {
      totalVehicles: vehicles.length,
      availableVehicles: vehicles.filter((v) => v['สถานะ'] === 'พร้อมใช้งาน').length,
      totalEquipment: equipment.length,
      activeBorrowing: borrowing.filter((b) =>
        ['รอรับเรื่อง', 'รับเรื่องแล้ว', 'อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน', 'อยู่ในระหว่างการคืน'].includes(b['สถานะ'])
      ).length,
      usageCount: fUsage.length,
      maintCost: totalMaintCost,
      fuelCost: totalFuelCost,
      fuelLiters: totalFuelLiters,
      totalDistance: totalDistance,
      borrowCount: fBorrow.length,
    },
    byVehicle: Object.values(byVehicle),
    recentUsage: fUsage.slice(-10).reverse(),
    recentBorrow: fBorrow.slice(-10).reverse(),
  };
}

// หมายเหตุ: Sheets เดิมมีลำดับคอลัมน์คงที่จากแถวหัวตาราง แต่ Firestore ไม่มีแนวคิด
// ลำดับคอลัมน์ตายตัว จึงสร้างหัวตาราง CSV จากการรวมกุญแจ (key) ทั้งหมดที่พบในทุก
// เอกสาร โดยรักษาลำดับที่พบครั้งแรกไว้ ให้ผลลัพธ์ใกล้เคียงของเดิมมากที่สุด
async function exportToCSV(sheetName) {
  try {
    const rows = await listDocs(resolveCollectionName(sheetName));
    const esc = (v) => {
      const c = String(v === null || v === undefined ? '' : v);
      return c.includes(',') || c.includes('"') || c.includes('\n') ? '"' + c.replace(/"/g, '""') + '"' : c;
    };

    if (!rows.length) {
      return { success: true, csv: '﻿', filename: sheetName + '_' + todayStr() + '.csv' };
    }

    const headers = [];
    const seen = {};
    rows.forEach((r) => {
      Object.keys(r).forEach((k) => {
        if (!seen[k]) {
          seen[k] = true;
          headers.push(k);
        }
      });
    });

    let csv = '﻿'; // BOM for UTF-8
    csv += headers.map(esc).join(',') + '\n';
    csv += rows.map((r) => headers.map((h) => esc(r[h])).join(',')).join('\n');

    return { success: true, csv: csv, filename: sheetName + '_' + todayStr() + '.csv' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function checkOverdue() {
  const [borrowing, vehicles, maintenance, drivers] = await Promise.all([
    listDocs(SHEETS.BORROWING),
    listDocs(SHEETS.VEHICLES),
    listDocs(SHEETS.MAINTENANCE),
    listDocs(SHEETS.DRIVERS),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let countOverdue = 0;

  // 1. Check Overdue Equipment Borrowing
  for (const b of borrowing) {
    if (['อยู่ในระหว่างการยืม', 'รับเรื่องแล้ว', 'ขอขยายเวลา'].includes(b['สถานะ'])) {
      if (b['วันที่ครบกำหนด']) {
        const due = new Date(b['วันที่ครบกำหนด']);
        if (!isNaN(due.getTime())) {
          due.setHours(0, 0, 0, 0);
          if (due.getTime() <= today.getTime()) {
            await updateBorrowingStatus(b['รหัส'], 'ถึงวันครบกำหนดคืน', b['ผู้รับเรื่อง'] || 'ระบบอัตโนมัติ', 'system');
            countOverdue++;
          }
        }
      }
    }
  }

  // 2. Check Vehicles Maintenance (within 500 km)
  let maintAlerts = [];
  try {
    vehicles.forEach((v) => {
      const plate = v['ทะเบียน'];
      const currentKm = parseFloat(v['เลขไมล์ปัจจุบัน']) || 0;
      const vMaints = maintenance.filter((m) => m['ทะเบียน'] === plate && (parseFloat(m['ครั้งถัดไป(ไมล์)']) || 0) > 0);
      if (vMaints.length > 0) {
        vMaints.sort((a, b) => new Date(b['วันที่']) - new Date(a['วันที่']));
        const nextKm = parseFloat(vMaints[0]['ครั้งถัดไป(ไมล์)']);
        if (nextKm > 0 && nextKm - currentKm <= 500) {
          maintAlerts.push(`🚘 รถ ${plate}: ไมล์ปัจจุบัน ${currentKm} กม. ใกล้ถึงกำหนดเปลี่ยนน้ำมัน/เช็คระยะ (${nextKm} กม.)`);
        }
      }
    });
  } catch (e) {}

  // 3. Check Driver License Expiration (within 30 days)
  let driverAlerts = [];
  try {
    const future30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    drivers.forEach((d) => {
      if (d['วันหมดอายุ']) {
        const expDate = new Date(d['วันหมดอายุ']);
        if (!isNaN(expDate.getTime()) && expDate <= future30) {
          driverAlerts.push(`👨‍✈️ ${d['ชื่อ-นามสกุล']}: ใบขับขี่หมดอายุวันที่ ${d['วันหมดอายุ']}`);
        }
      }
    });
  } catch (e) {}

  if (maintAlerts.length > 0 || driverAlerts.length > 0) {
    await sendSmartSystemAlertFlex(maintAlerts, driverAlerts);
  }

  return `ตรวจสอบแล้ว: ยืมอุปกรณ์เกินกำหนด ${countOverdue} รายการ, เตือนบำรุงรักษารถ ${maintAlerts.length} คัน, ใบขับขี่ใกล้หมดอายุ ${driverAlerts.length} คน`;
}

module.exports = { getDashboard, exportToCSV, checkOverdue };
