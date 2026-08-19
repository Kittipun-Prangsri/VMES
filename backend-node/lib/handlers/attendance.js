// ============== ATTENDANCE CHECK-IN & GEOFENCE HANDLER ==============
const { SHEETS, setDoc, listDocs, getDoc } = require('../firestore');
const { verifyAdmin } = require('../auth');

async function saveAttendanceRecord(record) {
  try {
    if (!record || !record.userId) {
      return { success: false, message: 'ข้อมูลพนักงานไม่สมบูรณ์' };
    }
    const id = record.id || `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowStr = record.timestamp || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace('T', ' ');

    const docData = {
      id: id,
      userId: String(record.userId || ''),
      userName: String(record.userName || ''),
      userRole: String(record.userRole || ''),
      department: String(record.department || ''),
      type: String(record.type || 'checkin'), // checkin or checkout
      timestamp: nowStr,
      lat: Number(record.lat || 0),
      lng: Number(record.lng || 0),
      distanceMeters: Math.round(Number(record.distanceMeters || 0)),
      withinFence: Boolean(record.withinFence),
      photoUrl: String(record.photoUrl || ''),
      locationName: String(record.locationName || 'โรงพยาบาลคลองหาด'),
      accuracyMeters: Math.round(Number(record.accuracyMeters || 0)),
      deviceInfo: String(record.deviceInfo || ''),
      note: String(record.note || '')
    };

    await setDoc(SHEETS.ATTENDANCE, id, docData);
    return { success: true, id: id, data: docData };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function getAttendanceLogs() {
  try {
    const logs = await listDocs(SHEETS.ATTENDANCE);
    return { success: true, logs: logs };
  } catch (err) {
    return { success: false, logs: [], message: err.message };
  }
}

async function saveAttendanceConfig(config, adminCode) {
  if (!verifyAdmin(adminCode)) {
    return { success: false, message: 'ต้องเป็น Admin จึงจะสามารถแก้ไขพิกัดและรัศมีได้' };
  }
  try {
    const configData = {
      lat: Number(config.lat || 13.5187),
      lng: Number(config.lng || 102.0468),
      radiusMeters: Math.max(10, Number(config.radiusMeters || 200)),
      locationName: String(config.locationName || 'โรงพยาบาลคลองหาด').trim(),
      requireFaceScan: config.requireFaceScan !== false,
      maxAccuracyMeters: Number(config.maxAccuracyMeters || 50),
      updatedAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace('T', ' ')
    };
    await setDoc(SHEETS.SETTINGS, 'ATTENDANCE_CONFIG', {
      Key: 'ATTENDANCE_CONFIG',
      Value: JSON.stringify(configData)
    });
    return { success: true, config: configData };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  saveAttendanceRecord,
  getAttendanceLogs,
  saveAttendanceConfig
};
