// ============== SERVICE REQUESTS & WIFI QR HANDLERS ==============
// ระบบขอใช้บริการ HOSxP, Internet และ VPN - โรงพยาบาลคลองหาด + WiFi QR Code Generator

const { SHEETS, setDoc, listDocs, getDoc } = require('../firestore');
const { newId, nowStr, todayStr, logAudit } = require('../util');
const { verifyAdmin } = require('../auth');

/**
 * ดึงรายการคำขอใช้บริการทั้งหมด (สำหรับ Admin / Manager)
 */
async function getServiceRequests(adminCode) {
  if (!verifyAdmin(adminCode)) {
    return { success: false, message: 'ต้องเป็น Admin หรือผู้จัดการเท่านั้น' };
  }
  try {
    const rows = await listDocs(SHEETS.SERVICE_REQUESTS);
    rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    
    const stats = {
      total: rows.length,
      pending: rows.filter((r) => (r.status || '').includes('รอพิจารณา')).length,
      approved: rows.filter((r) => (r.status || '').includes('อนุมัติ')).length,
      rejected: rows.filter((r) => (r.status || '').includes('ไม่อนุมัติ')).length,
      vpn: rows.filter((r) => (r.requestType || '').toUpperCase().includes('VPN')).length,
      hosxp: rows.filter((r) => (r.requestType || '').toUpperCase().includes('HOSXP')).length,
    };

    return { success: true, data: rows, stats };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * ค้นหาติดตามสถานะคำขอด้วยเลขบัตรประชาชน 13 หลัก
 */
async function trackServiceRequest(idCard) {
  try {
    if (!idCard) return { success: false, message: 'กรุณากรอกเลขบัตรประชาชน 13 หลัก' };
    const cleanId = String(idCard).replace(/['\s-]/g, '');

    const rows = await listDocs(SHEETS.SERVICE_REQUESTS);
    const matches = rows
      .filter((r) => String(r.idCard || '').replace(/['\s-]/g, '') === cleanId)
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt || r.date || '-',
        requestType: r.requestType || 'HOSXP',
        nameTh: r.nameTh || '-',
        position: r.position || '-',
        status: r.status || 'รอพิจารณา',
        remark: r.remark || '-',
        hosxpUser: r.status === 'อนุมัติ' ? r.hosxpUser : '***',
        hosxpPass: r.status === 'อนุมัติ' ? r.hosxpPass : '***',
        internetUser: r.status === 'อนุมัติ' ? r.internetUser : '***',
        internetPass: r.status === 'อนุมัติ' ? r.internetPass : '***',
        vpnUser: r.status === 'อนุมัติ' ? r.vpnUser : '***',
        vpnPass: r.status === 'อนุมัติ' ? r.vpnPass : '***',
      }));

    if (matches.length === 0) {
      return { success: false, message: 'ไม่พบรายการคำขอที่ตรงกับเลขบัตรประชาชนนี้' };
    }

    matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { success: true, data: matches };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * บันทึกคำขอใช้บริการใหม่
 */
async function createServiceRequest(formData) {
  try {
    if (!formData || !formData.nameTh) {
      return { success: false, message: 'กรุณากรอกชื่อ-นามสกุล' };
    }
    if (!formData.idCard || String(formData.idCard).trim().length < 13) {
      return { success: false, message: 'กรุณากรอกเลขบัตรประชาชน 13 หลักให้ถูกต้อง' };
    }

    const docId = newId('REQ');
    const newReq = {
      id: docId,
      requestType: formData.requestType || 'HOSXP',
      nameTh: String(formData.nameTh || '').trim(),
      nameEn: String(formData.nameEn || '').trim().toUpperCase(),
      position: String(formData.position || '').trim(),
      idCard: String(formData.idCard || '').trim(),
      birthDate: String(formData.birthDate || '').trim(),
      licenseNo: String(formData.licenseNo || '-').trim(),
      email: String(formData.email || '').trim(),
      lineId: String(formData.lineId || '').trim(),
      telegramId: String(formData.telegramId || '').trim(),
      vpnPurpose: String(formData.vpnPurpose || '-').trim(),
      status: 'รอพิจารณา',
      hosxpUser: '-',
      hosxpPass: '-',
      internetUser: '-',
      internetPass: '-',
      vpnUser: '-',
      vpnPass: '-',
      remark: '-',
      createdAt: nowStr(),
      updatedAt: nowStr(),
    };

    await setDoc(SHEETS.SERVICE_REQUESTS, docId, newReq);
    await logAudit('ขอใช้บริการ IT', formData.nameTh, `ประเภทคำขอ: ${newReq.requestType}, เลขบัตร: ${newReq.idCard}`);

    return { success: true, message: 'บันทึกคำขอใช้บริการเรียบร้อยแล้ว', docId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * อัปเดตสถานะคำขอ (อนุมัติ / ไม่อนุมัติ / ออกบัญชีผู้ใช้งาน)
 */
async function updateServiceRequestStatus(updateData, adminCode) {
  if (!verifyAdmin(adminCode)) {
    return { success: false, message: 'ต้องเป็น Admin หรือผู้จัดการเท่านั้น' };
  }
  try {
    const docId = String(updateData.id || updateData.docId || '').trim();
    if (!docId) return { success: false, message: 'ไม่พบรหัสเอกสารคำขอ' };

    const existing = await getDoc(SHEETS.SERVICE_REQUESTS, docId);
    if (!existing) return { success: false, message: 'ไม่พบข้อมูลคำขอนี้ในระบบ' };

    const updated = {
      ...existing,
      status: updateData.status || existing.status,
      remark: updateData.remark !== undefined ? updateData.remark : existing.remark,
      updatedAt: nowStr(),
    };

    if (updateData.status === 'อนุมัติ') {
      if (updateData.hosxpUser) updated.hosxpUser = updateData.hosxpUser;
      if (updateData.hosxpPass) updated.hosxpPass = updateData.hosxpPass;
      if (updateData.internetUser) updated.internetUser = updateData.internetUser;
      if (updateData.internetPass) updated.internetPass = updateData.internetPass;
      if (updateData.vpnUser) updated.vpnUser = updateData.vpnUser;
      if (updateData.vpnPass) updated.vpnPass = updateData.vpnPass;
    }

    await setDoc(SHEETS.SERVICE_REQUESTS, docId, updated);
    await logAudit('อัปเดตคำขอ IT', 'admin', `รหัส: ${docId}, สถานะ: ${updated.status}`);

    return { success: true, message: `อัปเดตสถานะเป็น "${updated.status}" เรียบร้อยแล้ว` };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * ดึงข้อมูลคลัง WiFi QR Code Logs
 */
async function getWifiQrLogs() {
  try {
    const rows = await listDocs(SHEETS.WIFI_QR_LOGS);
    rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * บันทึก WiFi QR Code Log ใหม่
 */
async function createWifiQrLog(qrData) {
  try {
    const docId = newId('WIFI');
    const newLog = {
      id: docId,
      department: String(qrData.department || '-').trim(),
      ssid: String(qrData.ssid || '-').trim(),
      username: String(qrData.username || '-').trim(),
      imageUrl: qrData.imageUrl || '',
      createdAt: nowStr(),
    };

    await setDoc(SHEETS.WIFI_QR_LOGS, docId, newLog);
    return { success: true, message: 'บันทึก WiFi QR Code เรียบร้อยแล้ว', docId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  getServiceRequests,
  trackServiceRequest,
  createServiceRequest,
  updateServiceRequestStatus,
  getWifiQrLogs,
  createWifiQrLog,
};
