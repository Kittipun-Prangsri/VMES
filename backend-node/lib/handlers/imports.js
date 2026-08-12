// ============== IMPORT / EXTERNAL DATA APIS ==============
// พอร์ตจาก รหัส.js L2612-3027 (fetchGoogleSheetData, importUsers, importEquipment,
// importVehicles, importDrivers)
//
// fetchGoogleSheetData เดิมใช้ SpreadsheetApp.openByUrl/openById (สิทธิ์ของบัญชี Apps
// Script ที่รัน) — ใน Node ไม่มี SpreadsheetApp จึงเรียก Google Sheets REST API v4
// ตรงๆ โดย auth ด้วย Service Account เดียวกับที่ใช้กับ Firestore (ต้องแชร์สิทธิ์อ่าน
// สเปรดชีตต้นทางให้กับอีเมล service account นั้นด้วยเอง)

const { JWT } = require('google-auth-library');
const { SHEETS, setDoc, getDoc } = require('../firestore');
const { newId, todayStr, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');
const { getUsers } = require('./users');
const { getEquipment } = require('./equipment');
const { getVehicles } = require('./vehicles');
const { getDrivers } = require('./drivers');
const { getSystemSettings } = require('./settings');

let _sheetsJwtClient = null;
function getSheetsJwtClient() {
  if (!_sheetsJwtClient) {
    _sheetsJwtClient = new JWT({
      email: process.env.FIREBASE_CLIENT_EMAIL,
      key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }
  return _sheetsJwtClient;
}

// รองรับทั้ง URL เต็มของ Google Sheets และ spreadsheet ID เปล่าๆ (เหมือนพฤติกรรมเดิม
// ที่แยกเป็น openByUrl เมื่อ url มี "docs.google.com/spreadsheets" กับ openById เมื่อไม่มี)
function extractSpreadsheetId(url) {
  const str = String(url || '').trim();
  if (str.indexOf('docs.google.com/spreadsheets') !== -1) {
    const m = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
  }
  return str;
}

async function fetchGoogleSheetData(url, sheetName, adminCode) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const spreadsheetId = extractSpreadsheetId(url);
    if (!spreadsheetId) return { success: false, message: 'ไม่พบ Spreadsheet ID จาก URL ที่ระบุ' };

    const client = getSheetsJwtClient();
    const { token } = await client.getAccessToken();

    // ถ้าไม่ระบุชื่อชีต ให้ดึงข้อมูล metadata มาหาชื่อชีตแรกก่อน (เทียบเท่า ss.getSheets()[0])
    let targetSheetName = sheetName;
    if (!targetSheetName) {
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      if (!metaRes.ok) {
        const errBody = await metaRes.text();
        return { success: false, message: 'ไม่สามารถอ่าน Google Sheet ได้: ' + errBody.substring(0, 300) };
      }
      const meta = await metaRes.json();
      const firstSheet = meta.sheets && meta.sheets[0] && meta.sheets[0].properties && meta.sheets[0].properties.title;
      if (!firstSheet) return { success: false, message: 'ไม่พบแผ่นงานตามที่ระบุ' };
      targetSheetName = firstSheet;
    }

    const valuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
        targetSheetName
      )}`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (!valuesRes.ok) {
      const errBody = await valuesRes.text();
      return { success: false, message: 'ไม่สามารถอ่าน Google Sheet ได้: ' + errBody.substring(0, 300) };
    }
    const valuesJson = await valuesRes.json();
    const rawData = valuesJson.values || [];

    if (rawData.length < 2) {
      return { success: false, message: 'ชีตนี้ไม่มีข้อมูลสำหรับนำเข้า' };
    }

    const headers = rawData[0].map((h) => String(h || '').trim());
    const dataObjects = rawData.slice(1).map((row) => {
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

async function importUsers(usersList, adminCode, duplicateHandling) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const settings = await getSystemSettings();
    let allowedRoles = ['admin', 'manager', 'user', 'ผู้ใช้งานเฉพาะตัวเอง', 'พนักงานขับรถ(เปิดเฉพาะตำแหน่งพนักงานขับรถ)'];
    try {
      if (settings && settings.SYSTEM_ROLES) {
        allowedRoles = JSON.parse(settings.SYSTEM_ROLES);
      }
    } catch (e) {}

    const existingUsers = await getUsers();
    const existingMap = {};
    existingUsers.forEach((u) => {
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
        'Telegram Token': String(data['Telegram Token'] || '').trim(),
      };

      // Match allowed roles case-insensitively for English, preserve Thai
      let matchedRole = rowData['บทบาท'];
      const matchedIdx = allowedRoles.map((r) => r.toLowerCase()).indexOf(matchedRole.toLowerCase());
      matchedRole = matchedIdx !== -1 ? allowedRoles[matchedIdx] : 'user';
      rowData['บทบาท'] = matchedRole;

      if (existing) {
        if (duplicateHandling === 'update') {
          const existingCred = await getDoc('userCredentials', existing['รหัส']);
          const mergedData = {
            'รหัส': existing['รหัส'],
            'ชื่อ-นามสกุล': rowData['ชื่อ-นามสกุล'] || existing['ชื่อ-นามสกุล'] || '',
            'ตำแหน่ง': rowData['ตำแหน่ง'] || existing['ตำแหน่ง'] || '',
            'หน่วยงาน': rowData['หน่วยงาน'] || existing['หน่วยงาน'] || '',
            'เบอร์ติดต่อ': rowData['เบอร์ติดต่อ'] || existing['เบอร์ติดต่อ'] || '',
            'อีเมล': rowData['อีเมล'] || existing['อีเมล'] || '',
            'บทบาท': rowData['บทบาท'] !== 'user' && rowData['บทบาท'] !== '' ? rowData['บทบาท'] : existing['บทบาท'] || 'user',
            'สถานะ': rowData['สถานะ'] !== 'ใช้งาน' && rowData['สถานะ'] !== '' ? rowData['สถานะ'] : existing['สถานะ'] || 'ใช้งาน',
            'LINE ID': rowData['LINE ID'] || existing['LINE ID'] || '',
            'LINE Token': rowData['LINE Token'] || existing['LINE Token'] || '',
            'Telegram ID': rowData['Telegram ID'] || existing['Telegram ID'] || '',
            'Telegram Token': rowData['Telegram Token'] || existing['Telegram Token'] || '',
            'วันที่บันทึก': existing['วันที่บันทึก'] || todayStr(),
          };

          let matchedMergedRole = mergedData['บทบาท'];
          const matchedMergedIdx = allowedRoles.map((r) => r.toLowerCase()).indexOf(matchedMergedRole.toLowerCase());
          mergedData['บทบาท'] = matchedMergedIdx !== -1 ? allowedRoles[matchedMergedIdx] : 'user';

          const mergedPassword =
            rowData['รหัสผ่าน'] !== '12345' && rowData['รหัสผ่าน'] !== ''
              ? rowData['รหัสผ่าน']
              : (existingCred && existingCred['รหัสผ่าน']) || '12345';

          await setDoc(SHEETS.USERS, mergedData['รหัส'], mergedData);
          await setDoc('userCredentials', mergedData['รหัส'], { 'รหัส': mergedData['รหัส'], 'รหัสผ่าน': mergedPassword });
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        rowData['รหัส'] = newId('UR');
        rowData['วันที่บันทึก'] = todayStr();
        const password = rowData['รหัสผ่าน'];
        const publicData = Object.assign({}, rowData);
        delete publicData['รหัสผ่าน'];
        await setDoc(SHEETS.USERS, rowData['รหัส'], publicData);
        await setDoc('userCredentials', rowData['รหัส'], { 'รหัส': rowData['รหัส'], 'รหัสผ่าน': password });
        importedCount++;
      }
    }
    await logAudit('นำเข้าผู้ใช้', 'admin', `นำเข้า ${importedCount}, อัปเดต ${updatedCount}, ข้าม ${skippedCount}`);
    return {
      success: true,
      message: `นำเข้าสำเร็จ: เพิ่มใหม่ ${importedCount} รายการ, อัปเดต ${updatedCount} รายการ, ข้าม ${skippedCount} รายการ`,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function importEquipment(equipList, adminCode, duplicateHandling) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const existingEquips = await getEquipment();

    const existingByAssetId = {};
    const existingByName = {};
    existingEquips.forEach((e) => {
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
        'หมายเหตุ': String(data['หมายเหตุ'] || '').trim(),
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
            'จำนวน': data['จำนวน'] !== undefined && data['จำนวน'] !== '' ? Number(data['จำนวน']) : Number(existing['จำนวน']) || 1,
            'หน่วยนับ': rowData['หน่วยนับ'] || existing['หน่วยนับ'] || 'เครื่อง',
            'สถานะ': rowData['สถานะ'] || existing['สถานะ'] || 'พร้อมยืม',
            'ที่เก็บ': rowData['ที่เก็บ'] || existing['ที่เก็บ'] || '',
            'มูลค่า': data['มูลค่า'] !== undefined && data['มูลค่า'] !== '' ? Number(data['มูลค่า']) : Number(existing['มูลค่า']) || 0,
            'วันที่จัดซื้อ': rowData['วันที่จัดซื้อ'] || existing['วันที่จัดซื้อ'] || '',
            'หมายเหตุ': rowData['หมายเหตุ'] || existing['หมายเหตุ'] || '',
            'วันที่บันทึก': existing['วันที่บันทึก'] || todayStr(),
          };
          await setDoc(SHEETS.EQUIPMENT, mergedData['รหัส'], mergedData);
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        rowData['รหัส'] = newId('EQ');
        rowData['วันที่บันทึก'] = todayStr();
        await setDoc(SHEETS.EQUIPMENT, rowData['รหัส'], rowData);
        importedCount++;
      }
    }
    await logAudit('นำเข้าอุปกรณ์', 'admin', `นำเข้า ${importedCount}, อัปเดต ${updatedCount}, ข้าม ${skippedCount}`);
    return {
      success: true,
      message: `นำเข้าสำเร็จ: เพิ่มใหม่ ${importedCount} รายการ, อัปเดต ${updatedCount} รายการ, ข้าม ${skippedCount} รายการ`,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function importVehicles(vehicleList, adminCode, duplicateHandling) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const existingVehicles = await getVehicles();
    const existingMap = {};
    existingVehicles.forEach((v) => {
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
        'อายุการใช้งาน(ปี)':
          data['อายุการใช้งาน(ปี)'] !== undefined && data['อายุการใช้งาน(ปี)'] !== '' ? Number(data['อายุการใช้งาน(ปี)']) : 0,
        'เลขไมล์ปัจจุบัน': Number(data['เลขไมล์ปัจจุบัน'] || 0) || 0,
        'สถานะ': String(data['สถานะ'] || '').trim() || 'พร้อมใช้งาน',
        'หน่วยงาน': String(data['หน่วยงาน'] || '').trim(),
        'หมายเหตุ': String(data['หมายเหตุ'] || '').trim(),
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
            'ปีที่ใช้งาน':
              data['ปีที่ใช้งาน'] !== undefined && data['ปีที่ใช้งาน'] !== ''
                ? Number(data['ปีที่ใช้งาน'])
                : Number(existing['ปีที่ใช้งาน']) || new Date().getFullYear(),
            'อายุการใช้งาน(ปี)':
              data['อายุการใช้งาน(ปี)'] !== undefined && data['อายุการใช้งาน(ปี)'] !== ''
                ? Number(data['อายุการใช้งาน(ปี)'])
                : Number(existing['อายุการใช้งาน(ปี)']) || 0,
            'เลขไมล์ปัจจุบัน':
              data['เลขไมล์ปัจจุบัน'] !== undefined && data['เลขไมล์ปัจจุบัน'] !== ''
                ? Number(data['เลขไมล์ปัจจุบัน'])
                : Number(existing['เลขไมล์ปัจจุบัน']) || 0,
            'สถานะ': rowData['สถานะ'] || existing['สถานะ'] || 'พร้อมใช้งาน',
            'หน่วยงาน': rowData['หน่วยงาน'] || existing['หน่วยงาน'] || '',
            'หมายเหตุ': rowData['หมายเหตุ'] || existing['หมายเหตุ'] || '',
            'วันที่บันทึก': existing['วันที่บันทึก'] || todayStr(),
          };
          await setDoc(SHEETS.VEHICLES, mergedData['รหัส'], mergedData);
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        rowData['รหัส'] = newId('VH');
        rowData['วันที่บันทึก'] = todayStr();
        await setDoc(SHEETS.VEHICLES, rowData['รหัส'], rowData);
        importedCount++;
      }
    }
    await logAudit('นำเข้ายานพาหนะ', 'admin', `นำเข้า ${importedCount}, อัปเดต ${updatedCount}, ข้าม ${skippedCount}`);
    return {
      success: true,
      message: `นำเข้ายานพาหนะสำเร็จ: เพิ่มใหม่ ${importedCount} คัน, อัปเดต ${updatedCount} คัน, ข้าม ${skippedCount} คัน`,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function importDrivers(driverList, adminCode, duplicateHandling) {
  if (!verifyAdmin(adminCode)) return { success: false, message: 'ต้องเป็น Admin เท่านั้น' };
  try {
    const existingDrivers = await getDrivers();
    const existingMap = {};
    existingDrivers.forEach((d) => {
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
        'สถานะ': String(data['สถานะ'] || '').trim() || 'ปฏิบัติงาน',
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
            'วันที่บันทึก': existing['วันที่บันทึก'] || todayStr(),
          };
          await setDoc(SHEETS.DRIVERS, mergedData['รหัส'], mergedData);
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        rowData['รหัส'] = newId('DR');
        rowData['วันที่บันทึก'] = todayStr();
        await setDoc(SHEETS.DRIVERS, rowData['รหัส'], rowData);
        importedCount++;
      }
    }
    await logAudit('นำเข้าพนักงานขับรถ', 'admin', `นำเข้า ${importedCount}, อัปเดต ${updatedCount}, ข้าม ${skippedCount}`);
    return {
      success: true,
      message: `นำเข้าพนักงานขับรถสำเร็จ: เพิ่มใหม่ ${importedCount} รายการ, อัปเดต ${updatedCount} รายการ, ข้าม ${skippedCount} รายการ`,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { fetchGoogleSheetData, importUsers, importEquipment, importVehicles, importDrivers };
