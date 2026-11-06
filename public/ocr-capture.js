/* ============================================================================
 * อ่านตัวอักษรจากกล้อง (OCR) เพื่อลดการพิมพ์ — ป้ายครุภัณฑ์ / ป้ายซีเรียล / ป้ายรุ่นบนตัวเครื่อง
 *
 *   1) parse   — แปลงข้อความดิบจาก OCR เป็น เลขครุภัณฑ์ / Serial / รุ่น / ยี่ห้อ (ฟังก์ชันล้วน ทดสอบใน Node ได้)
 *   2) engine  — โหลด Tesseract.js ตอนใช้งานครั้งแรกเท่านั้น (ประมวลผลในเบราว์เซอร์ ภาพไม่ถูกส่งออกไปไหน)
 *   3) ui      — หน้าต่างถ่ายภาพ/เลือกรูป -> แสดงค่าที่อ่านได้ให้ตรวจ -> เติมลงช่องที่เลือก
 *
 * ผลจาก OCR มีโอกาสผิดเสมอ: ระบบเติมให้เฉพาะ "ช่องที่ยังว่าง" และไฮไลต์สีเหลืองให้ตรวจ ไม่ทับค่าที่ผู้ใช้พิมพ์ไว้
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OCR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  const KNOWN_BRANDS = [
    'Dell', 'HP', 'Hewlett-Packard', 'Lenovo', 'Acer', 'Asus', 'MSI', 'Apple', 'Samsung', 'LG', 'Philips', 'AOC', 'BenQ', 'ViewSonic',
    'Epson', 'Canon', 'Brother', 'Ricoh', 'Xerox', 'Kyocera', 'Fuji Xerox', 'Fujitsu', 'Toshiba', 'Sony', 'Panasonic', 'Sharp',
    'Cisco', 'TP-Link', 'D-Link', 'Huawei', 'Ubiquiti', 'MikroTik', 'Zyxel', 'Netgear', 'Hikvision', 'Dahua', 'Logitech', 'APC',
    'Zircon', 'Leonics', 'Cyberpower', 'Eaton', 'Western Digital', 'Seagate', 'Kingston', 'Microsoft', 'Intel', 'Gigabyte', 'Zebra', 'Honeywell',
  ];

  const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  // ตัวอักษรที่ OCR มักอ่านสลับกับตัวเลข (ใช้แก้เฉพาะในรูปแบบเลขครุภัณฑ์เท่านั้น)
  const DIGIT_FIX = { O: '0', o: '0', I: '1', l: '1', '|': '1', S: '5', B: '8', Z: '2' };
  const fixDigits = (s) => s.replace(/[OoIl|SBZ]/g, (c) => DIGIT_FIX[c]);

  // เลขครุภัณฑ์แบบราชการ เช่น 7440-14-0001/31 · 7440-001-0006/191 (กลุ่มแรก 4 หลักคือรหัสหมวด)
  const TAG_LOOSE = /([0-9OoIl|SBZ]{4})\s*[-–—−]\s*([0-9OoIl|SBZ]{2,3})\s*[-–—−]\s*([0-9OoIl|SBZ]{3,4})(?:\s*[\/\\]\s*([0-9OoIl|SBZ]{1,4}))?/g;

  function findTags(text) {
    const found = [];
    const seen = new Set();
    String(text || '').replace(TAG_LOOSE, (m, a, b, c, d) => {
      const parts = [a, b, c].concat(d ? [d] : []);
      const realDigits = parts.join('').replace(/[^0-9]/g, '').length;
      if (realDigits < 6) return m; // ส่วนใหญ่ต้องเป็นตัวเลขจริง กันข้อความธรรมดาหลุดเข้ามา
      const tag = fixDigits(a) + '-' + fixDigits(b) + '-' + fixDigits(c) + (d ? '/' + fixDigits(d) : '');
      if (!seen.has(tag)) { seen.add(tag); found.push(tag); }
      return m;
    });
    return found;
  }

  const SERIAL_LABEL = /(?:S\s*\/\s*N|S\.\s*N\.?|\bSN\b|Serial(?:\s*(?:No\.?|Number|#))?|Service\s*Tag|SVC\s*Tag|Ser\.?\s*No\.?)\s*[:：#.\-]?\s*([A-Z0-9][A-Z0-9\-]{4,29})/gi;
  const MODEL_LABEL = /(?:Model(?:\s*(?:No\.?|Number|Name))?|M\s*\/\s*N|Type)\s*[:：#.]?\s*([A-Za-z0-9][A-Za-z0-9 \-_\/\.]{1,30})/i;

  function findSerials(text) {
    const out = [];
    const seen = new Set();
    const add = (v) => { const s = String(v).toUpperCase().replace(/[^A-Z0-9\-]/g, ''); if (s.length >= 5 && !seen.has(s)) { seen.add(s); out.push(s); } };
    String(text || '').replace(SERIAL_LABEL, (m, v) => { add(v); return m; });
    return out;
  }

  // โทเค็นยาวที่ผสมตัวอักษร+ตัวเลข (มักเป็นบาร์โค้ด/ซีเรียลที่ไม่มีคำนำหน้า) — ความมั่นใจต่ำ ให้ผู้ใช้เลือกเอง
  function looseTokens(lines) {
    const out = [];
    const seen = new Set();
    lines.forEach((ln) => {
      ln.split(/[\s,;:]+/).forEach((tok) => {
        const t = tok.replace(/[^A-Za-z0-9\-]/g, '');
        if (t.length >= 8 && t.length <= 30 && /[A-Za-z]/.test(t) && /[0-9]/.test(t) && !seen.has(t.toUpperCase())) {
          seen.add(t.toUpperCase());
          out.push(t.toUpperCase());
        }
      });
    });
    return out;
  }

  function findBrand(text) {
    const t = String(text || '');
    for (const b of KNOWN_BRANDS) {
      const re = new RegExp('(^|[^A-Za-z])' + b.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '([^A-Za-z]|$)', 'i');
      if (re.test(t)) return b === 'Hewlett-Packard' ? 'HP' : b;
    }
    return '';
  }

  function findModel(lines) {
    for (const ln of lines) {
      const m = MODEL_LABEL.exec(ln);
      if (m) {
        const v = norm(m[1]).replace(/[\s.:-]+$/, '');
        if (v.length >= 2 && /[A-Za-z0-9]/.test(v)) return v;
      }
    }
    return '';
  }

  // text = ข้อความดิบจาก OCR -> ค่าที่แนะนำให้เติมฟอร์ม + บรรทัดดิบให้เลือกเอง
  function parse(text) {
    const raw = String(text || '').replace(/\r/g, '');
    const lines = raw.split('\n').map(norm).filter((l) => l.length >= 2 && /[A-Za-z0-9฀-๿]/.test(l));
    const tags = findTags(raw);
    const serials = findSerials(raw);
    const loose = looseTokens(lines).filter((t) => !serials.includes(t) && !tags.some((g) => g.replace(/[^0-9A-Z]/g, '') === t.replace(/[^0-9A-Z]/g, '')));
    return {
      tag: tags[0] || '',
      tags,
      serial: serials[0] || '',
      serials,
      serialGuesses: loose,
      model: findModel(lines),
      brand: findBrand(raw),
      lines,
    };
  }

  // ---------------------------------------------------------------- engine (เบราว์เซอร์เท่านั้น)
  let _loading = null;
  const _workers = {};

  function loadEngine() {
    if (typeof window !== 'undefined' && window.Tesseract) return Promise.resolve(window.Tesseract);
    if (_loading) return _loading;
    _loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      s.async = true;
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('โหลดตัวอ่านตัวอักษรไม่สำเร็จ')));
      s.onerror = () => { _loading = null; reject(new Error('โหลดตัวอ่านตัวอักษรไม่สำเร็จ — ต้องต่ออินเทอร์เน็ตในการใช้งานครั้งแรก')); };
      document.head.appendChild(s);
    });
    return _loading;
  }

  // ย่อ + ปรับเป็นขาวดำเพิ่มความคมชัด เพื่อให้อ่านป้ายเล็กๆ ได้แม่นขึ้นและเร็วขึ้น
  function prepareCanvas(source, maxSide) {
    const max = maxSide || 1800;
    const w0 = source.naturalWidth || source.videoWidth || source.width;
    const h0 = source.naturalHeight || source.videoHeight || source.height;
    const k = Math.min(1, max / Math.max(w0, h0));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w0 * k));
    cv.height = Math.max(1, Math.round(h0 * k));
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, cv.width, cv.height);
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = img.data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      d[i] = d[i + 1] = d[i + 2] = g;
      hist[g]++;
    }
    // ยืดคอนทราสต์ระหว่างเปอร์เซ็นไทล์ 2–98 (ทนแสงสะท้อน/ภาพซีด)
    const total = cv.width * cv.height;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, Math.round(((d[i] - lo) * 255) / span)));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // mode: 'en' = ตัวเลข/อังกฤษ (เร็ว เหมาะกับป้ายและซีเรียล), 'th' = รวมภาษาไทย (ไฟล์ภาษาใหญ่กว่า ช้ากว่า)
  async function recognize(canvas, mode, onProgress) {
    const T = await loadEngine();
    const lang = mode === 'th' ? 'tha+eng' : 'eng';
    if (!_workers[lang]) {
      _workers[lang] = T.createWorker(lang, 1, {
        logger: (m) => { if (onProgress && m && typeof m.progress === 'number') onProgress(m.status || '', m.progress); },
      }).then(async (w) => {
        await w.setParameters({ tessedit_pageseg_mode: '11' }); // sparse text: ข้อความกระจายบนป้าย
        return w;
      });
      _workers[lang].catch(() => { delete _workers[lang]; });
    }
    const worker = await _workers[lang];
    const { data } = await worker.recognize(canvas);
    return { text: data.text || '', confidence: data.confidence || 0 };
  }

  return { parse, findTags, findSerials, findBrand, findModel, prepareCanvas, loadEngine, recognize, KNOWN_BRANDS, TESSERACT_URL };
});
