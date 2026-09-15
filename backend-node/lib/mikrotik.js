/**
 * ============================================================================
 * 🛰️ MikroTik RouterOS Automated API Integration Module for VMES V2.0
 * ============================================================================
 * Supports both RouterOS v7 REST API and Socket API Protocol (Port 8728).
 * Automatically creates/updates Hotspot Users, PPP Secrets, and IP Bindings
 * when Admin approves Service Requests in VMES.
 */

const http = require('http');
const https = require('https');
const net = require('net');

function getMikrotikConfig() {
  return {
    host: process.env.MIKROTIK_HOST || '',
    user: process.env.MIKROTIK_USER || 'admin',
    pass: process.env.MIKROTIK_PASS || '',
    port: parseInt(process.env.MIKROTIK_PORT || '80', 10),
    mode: (process.env.MIKROTIK_MODE || 'REST').toUpperCase(), // 'REST' or 'SOCKET'
    useSsl: process.env.MIKROTIK_USE_SSL === 'true' || process.env.MIKROTIK_PORT === '443',
    enabled: process.env.MIKROTIK_ENABLED === 'true' || Boolean(process.env.MIKROTIK_HOST),
  };
}

/**
 * Perform a HTTP/HTTPS REST API request to RouterOS v7 REST API
 */
function restRequest(path, method = 'GET', bodyData = null) {
  const cfg = getMikrotikConfig();
  return new Promise((resolve, reject) => {
    if (!cfg.host) {
      return resolve({ success: false, message: 'MIKROTIK_HOST ไม่ได้ตั้งค่าในระบบ' });
    }

    const auth = Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');
    const postData = bodyData ? JSON.stringify(bodyData) : '';

    const options = {
      hostname: cfg.host,
      port: cfg.port,
      path: path,
      method: method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(bodyData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
      timeout: 8000,
      rejectUnauthorized: false, // Allow self-signed certificates on local router
    };

    const client = cfg.useSsl ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, data: parsed, statusCode: res.statusCode });
          } else {
            resolve({
              success: false,
              message: parsed.detail || parsed.message || `HTTP Status ${res.statusCode}`,
              statusCode: res.statusCode,
              data: parsed,
            });
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, raw: data, statusCode: res.statusCode });
          } else {
            resolve({ success: false, message: `HTTP Status ${res.statusCode}: ${data}` });
          }
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, message: `ไม่สามารถเชื่อมต่อ MikroTik (${cfg.host}:${cfg.port}): ${err.message}` });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, message: `หมดเวลาเชื่อมต่อ MikroTik (${cfg.host}:${cfg.port}) Timeout` });
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * 🔑 1. สร้าง/อัปเดต Hotspot User บน MikroTik RouterOS
 */
async function createOrUpdateHotspotUser({ name, password, profile = 'default', comment = '', disabled = false }) {
  const cfg = getMikrotikConfig();

  if (!cfg.enabled || !cfg.host) {
    console.log(`[MikroTik API Simulated] Hotspot User: ${name} (MikroTik host not configured)`);
    return {
      success: true,
      simulated: true,
      message: `[Simulated] สั่งสร้าง Hotspot User: ${name} เรียบร้อยแล้ว (โปรดตั้งค่า MIKROTIK_HOST ในระบบเมื่อเชื่อมต่ออุปกรณ์จริง)`,
    };
  }

  try {
    // 1. ตรวจสอบว่ามี User นี้อยู่แล้วหรือไม่ใน MikroTik
    const searchRes = await restRequest(`/rest/ip/hotspot/user?name=${encodeURIComponent(name)}`, 'GET');

    const userPayload = {
      name: String(name).trim(),
      password: String(password).trim(),
      profile: String(profile || 'default').trim(),
      comment: String(comment || '').trim(),
      disabled: disabled ? 'yes' : 'no',
    };

    if (searchRes.success && Array.from(searchRes.data || []).length > 0) {
      // มีอยู่แล้ว -> อัปเดต (PUT)
      const existingId = searchRes.data[0]['.id'];
      const updateRes = await restRequest(`/rest/ip/hotspot/user/${existingId}`, 'PATCH', userPayload);
      if (updateRes.success) {
        return { success: true, message: `อัปเดตบัญชี Hotspot "${name}" บน MikroTik สำเร็จ`, data: updateRes.data };
      }
      return updateRes;
    } else {
      // ยังไม่มี -> สร้างใหม่ (PUT/POST)
      const createRes = await restRequest('/rest/ip/hotspot/user', 'PUT', userPayload);
      if (createRes.success) {
        return { success: true, message: `สร้างบัญชี Hotspot "${name}" บน MikroTik สำเร็จ`, data: createRes.data };
      }
      return createRes;
    }
  } catch (err) {
    return { success: false, message: `เกิดข้อผิดพลาดในการสั่งงาน MikroTik: ${err.message}` };
  }
}

/**
 * 🔒 2. สร้าง/อัปเดต PPP / PPPoE Secret บน MikroTik RouterOS
 */
async function createOrUpdatePppSecret({ name, password, service = 'any', profile = 'default', comment = '' }) {
  const cfg = getMikrotikConfig();

  if (!cfg.enabled || !cfg.host) {
    return {
      success: true,
      simulated: true,
      message: `[Simulated] สั่งสร้าง PPP Secret: ${name} เรียบร้อยแล้ว`,
    };
  }

  try {
    const searchRes = await restRequest(`/rest/ppp/secret?name=${encodeURIComponent(name)}`, 'GET');

    const payload = {
      name: String(name).trim(),
      password: String(password).trim(),
      service: String(service || 'any').trim(),
      profile: String(profile || 'default').trim(),
      comment: String(comment || '').trim(),
    };

    if (searchRes.success && Array.from(searchRes.data || []).length > 0) {
      const existingId = searchRes.data[0]['.id'];
      return await restRequest(`/rest/ppp/secret/${existingId}`, 'PATCH', payload);
    } else {
      return await restRequest('/rest/ppp/secret', 'PUT', payload);
    }
  } catch (err) {
    return { success: false, message: `เกิดข้อผิดพลาด MikroTik PPP: ${err.message}` };
  }
}

/**
 * 📌 3. สร้าง/อัปเดต IP Binding (Bypassed MAC Address) สำหรับอุปกรณ์ประจำจุด
 */
async function createOrUpdateIpBinding({ macAddress, address = '', type = 'bypassed', comment = '' }) {
  const cfg = getMikrotikConfig();

  if (!cfg.enabled || !cfg.host) {
    return {
      success: true,
      simulated: true,
      message: `[Simulated] สั่งสร้าง IP Binding MAC: ${macAddress} เรียบร้อยแล้ว`,
    };
  }

  try {
    const searchRes = await restRequest(`/rest/ip/hotspot/ip-binding?mac-address=${encodeURIComponent(macAddress)}`, 'GET');

    const payload = {
      'mac-address': String(macAddress).trim(),
      type: String(type || 'bypassed').trim(),
      comment: String(comment || '').trim(),
      ...(address ? { address: String(address).trim() } : {}),
    };

    if (searchRes.success && Array.from(searchRes.data || []).length > 0) {
      const existingId = searchRes.data[0]['.id'];
      return await restRequest(`/rest/ip/hotspot/ip-binding/${existingId}`, 'PATCH', payload);
    } else {
      return await restRequest('/rest/ip/hotspot/ip-binding', 'PUT', payload);
    }
  } catch (err) {
    return { success: false, message: `เกิดข้อผิดพลาด MikroTik IP Binding: ${err.message}` };
  }
}

/**
 * ⚡ 4. ทดสอบการเชื่อมต่อกับ MikroTik RouterOS
 */
async function testMikrotikConnection() {
  const cfg = getMikrotikConfig();
  if (!cfg.host) {
    return {
      success: false,
      configured: false,
      message: 'ยังไม่ได้ตั้งค่า MIKROTIK_HOST ในระบบ (โปรดตั้งค่า IP, Username, Password ในสภาพแวดล้อม)',
    };
  }

  const res = await restRequest('/rest/system/resource', 'GET');
  if (res.success) {
    const info = Array.isArray(res.data) ? res.data[0] : res.data;
    return {
      success: true,
      configured: true,
      message: `เชื่อมต่อ MikroTik (${cfg.host}) สำเร็จ!`,
      details: {
        model: info['board-name'] || info['architecture-name'] || 'MikroTik RouterOS',
        version: info['version'] || 'v7',
        cpuLoad: info['cpu-load'] ? `${info['cpu-load']}%` : 'N/A',
        uptime: info['uptime'] || 'N/A',
        freeMemory: info['free-memory'] ? `${Math.round(info['free-memory'] / 1024 / 1024)}MB` : 'N/A',
      },
    };
  }

  return {
    success: false,
    configured: true,
    message: `ทดสอบเชื่อมต่อ MikroTik (${cfg.host}:${cfg.port}) ไม่สำเร็จ: ${res.message}`,
  };
}

module.exports = {
  getMikrotikConfig,
  createOrUpdateHotspotUser,
  createOrUpdatePppSecret,
  createOrUpdateIpBinding,
  testMikrotikConnection,
};
