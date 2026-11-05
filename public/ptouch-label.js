/* ============================================================================
 * PTouch — พิมพ์ป้ายสติกเกอร์ด้วย Brother PT-P710BT (P-touch CUBE Plus)
 *
 * ทำงาน 3 ส่วน (ใช้ได้ทั้งในเบราว์เซอร์และ Node สำหรับเทสต์ตัวเข้ารหัส):
 *   1) core    — แปลง bitmap 1 บิต -> คำสั่ง raster ของ Brother (PackBits/TIFF)
 *   2) render  — วาดป้าย (QR + ข้อความ) ลง canvas ให้พอดีกับความกว้างเทป
 *   3) Printer — ส่งงานผ่าน Web Serial (Bluetooth SPP) พร้อมอ่านสถานะเครื่อง
 *
 * อ้างอิงข้อกำหนด: Brother "Raster Command Reference" ของตระกูล PT-P700/P750W
 * (PT-P710BT ใช้ชุดคำสั่งเดียวกัน, หัวพิมพ์ 128 จุด, 180 dpi)
 *
 * หมายเหตุ: ทิศทางภาพ (กลับซ้าย-ขวา / บน-ล่าง) ปรับได้จาก options.flipH/flipV
 * เผื่อทิศทางจริงของเครื่องต่างจากค่าเริ่มต้น
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PTouch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DPI = 180;
  const DOTS_PER_MM = DPI / 25.4;
  const HEAD_PINS = 128;
  const BYTES_PER_LINE = HEAD_PINS / 8; // 16

  // ความกว้างเทป (มม.) -> { pins: จำนวนจุดที่พิมพ์ได้, margin: จำนวนจุดว่างด้านซ้ายของหัวพิมพ์ }
  // margin + pins + margin = 128 เสมอ
  const TAPES = {
    3.5: { pins: 24, margin: 52 },
    6: { pins: 32, margin: 48 },
    9: { pins: 50, margin: 39 },
    12: { pins: 70, margin: 29 },
    18: { pins: 112, margin: 8 },
    24: { pins: 128, margin: 0 },
  };

  const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const toThaiDigits = (v) => String(v).replace(/[0-9]/g, (d) => '๐๑๒๓๔๕๖๗๘๙'[d]);
  // 'YYYY-MM-DD' (ค.ศ.) หรือ Date -> "๒๖ ตุลาคม ๒๕๖๙"; ค่าที่อ่านไม่ได้คืน ''
  function thaiDate(v) {
    if (!v) return '';
    let y, m, d;
    const mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
    else {
      const dt = v instanceof Date ? v : new Date(v);
      if (isNaN(dt)) return '';
      y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate();
    }
    if (m < 1 || m > 12) return '';
    return toThaiDigits(d) + ' ' + TH_MONTHS[m - 1] + ' ' + toThaiDigits(y < 2400 ? y + 543 : y);
  }

  const mmToDots = (mm) => Math.round(mm * DOTS_PER_MM);
  const dotsToMm = (d) => d / DOTS_PER_MM;

  // ---------------------------------------------------------------- core
  // PackBits ตามที่ Brother ใช้ (TIFF compression, "M 02")
  function packBits(src) {
    const out = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
      let run = 1;
      while (i + run < n && src[i + run] === src[i] && run < 128) run++;
      if (run >= 2) {
        out.push(257 - run, src[i]);
        i += run;
      } else {
        const start = i;
        let len = 1;
        i++;
        while (i < n && len < 128) {
          if (i + 1 < n && src[i] === src[i + 1]) break;
          len++;
          i++;
        }
        out.push(len - 1);
        for (let k = 0; k < len; k++) out.push(src[start + k]);
      }
    }
    return out;
  }

  // bitmap: { width, height, data: Uint8Array(0|1) แถวต่อแถว } โดย height ต้องเท่ากับ pins ของเทป
  // แต่ละ "raster line" ของเครื่องคือ 1 คอลัมน์ของภาพ (วิ่งตามความยาวเทป)
  function bitmapToRasterLines(bitmap, tapeMm, opts) {
    const tape = TAPES[tapeMm];
    if (!tape) throw new Error('ไม่รองรับเทปกว้าง ' + tapeMm + ' มม.');
    if (bitmap.height !== tape.pins) {
      throw new Error('ความสูงภาพ ' + bitmap.height + ' จุด ไม่ตรงกับเทป ' + tapeMm + ' มม. (' + tape.pins + ' จุด)');
    }
    const o = opts || {};
    const lines = [];
    for (let c = 0; c < bitmap.width; c++) {
      const x = o.flipH ? bitmap.width - 1 - c : c;
      const line = new Uint8Array(BYTES_PER_LINE);
      for (let k = 0; k < bitmap.height; k++) {
        // ค่าเริ่มต้น: pin แรก = ขอบล่างของภาพ (flipV กลับเป็นขอบบน)
        const y = o.flipV ? k : bitmap.height - 1 - k;
        if (bitmap.data[y * bitmap.width + x]) {
          const pin = tape.margin + k;
          line[pin >> 3] |= 0x80 >> (pin & 7);
        }
      }
      lines.push(line);
    }
    return lines;
  }

  // สร้างงานพิมพ์ 1 ป้าย (ครบชุดตั้งแต่ invalidate จนถึงสั่งพิมพ์+ตัด)
  function buildPrintJob(bitmap, tapeMm, opts) {
    const o = Object.assign({ autoCut: true, marginDots: 14 }, opts || {});
    const lines = bitmapToRasterLines(bitmap, tapeMm, o);
    const n = lines.length;
    const bytes = [];
    const push = (...b) => b.forEach((v) => bytes.push(v & 0xff));

    for (let i = 0; i < 100; i++) push(0x00); // invalidate: ล้างบัฟเฟอร์เครื่อง
    push(0x1b, 0x40); // ESC @ initialize
    push(0x1b, 0x69, 0x61, 0x01); // ESC i a 1 : เข้าโหมด raster
    // ESC i z : print information — flags 0x84 = ตรวจความกว้างเทป + เปิด recovery
    push(0x1b, 0x69, 0x7a, 0x84, 0x00, tapeMm === 3.5 ? 4 : tapeMm, 0x00,
      n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff, 0x00, 0x00);
    push(0x1b, 0x69, 0x4d, o.autoCut ? 0x40 : 0x00); // ESC i M : auto cut
    push(0x1b, 0x69, 0x4b, 0x08); // ESC i K : no chain printing (ฟีด+ตัดท้ายงาน)
    push(0x1b, 0x69, 0x64, o.marginDots & 0xff, (o.marginDots >> 8) & 0xff); // ESC i d : margin
    push(0x4d, 0x02); // M 02 : TIFF/PackBits compression

    for (const line of lines) {
      let allZero = true;
      for (let i = 0; i < line.length; i++) if (line[i]) { allZero = false; break; }
      if (allZero) {
        push(0x5a); // Z : raster line ว่างทั้งเส้น
      } else {
        const packed = packBits(line);
        push(0x47, packed.length & 0xff, (packed.length >> 8) & 0xff);
        packed.forEach((v) => bytes.push(v));
      }
    }
    push(0x1a); // Ctrl-Z : พิมพ์หน้าสุดท้าย + ฟีด
    return Uint8Array.from(bytes);
  }

  const ERRORS_1 = [
    [0x01, 'ไม่มีเทปในเครื่อง'],
    [0x02, 'เทปหมด'],
    [0x04, 'ใบมีดตัดติด'],
    [0x08, 'แบตเตอรี่อ่อน'],
    [0x10, 'อะแดปเตอร์ไฟไม่ถูกต้อง'],
  ];
  const ERRORS_2 = [
    [0x01, 'เทปที่ใส่ไม่ตรงกับความกว้างที่เลือก'],
    [0x02, 'บัฟเฟอร์ขยายเต็ม'],
    [0x04, 'การสื่อสารผิดพลาด'],
    [0x08, 'บัฟเฟอร์การสื่อสารเต็ม'],
    [0x10, 'ฝาเครื่องเปิดอยู่'],
    [0x40, 'ป้อนเทปไม่ได้'],
    [0x80, 'ระบบผิดพลาด'],
  ];

  // สถานะ 32 ไบต์ที่เครื่องส่งกลับ (ขึ้นต้น 0x80 0x20 0x42)
  function parseStatus(buf, start) {
    const s = start || 0;
    if (buf.length < s + 32 || buf[s] !== 0x80 || buf[s + 1] !== 0x20 || buf[s + 2] !== 0x42) return null;
    const err1 = buf[s + 8];
    const err2 = buf[s + 9];
    const errors = [];
    ERRORS_1.forEach(([m, t]) => { if (err1 & m) errors.push(t); });
    ERRORS_2.forEach(([m, t]) => { if (err2 & m) errors.push(t); });
    return {
      err1, err2, errors,
      tapeMm: buf[s + 10],
      statusType: buf[s + 18], // 0=ตอบ status, 1=พิมพ์เสร็จ, 2=error, 5=notification, 6=phase change
      phase: buf[s + 19],
    };
  }

  function findStatus(buf) {
    for (let i = 0; i + 32 <= buf.length; i++) {
      if (buf[i] === 0x80 && buf[i + 1] === 0x20 && buf[i + 2] === 0x42) return { index: i, status: parseStatus(buf, i) };
    }
    return null;
  }

  // ---------------------------------------------------------------- render
  // ตัวเลือกเนื้อหา: { name, code, location, date, qrText } ; opts: { tapeMm, lengthMm|null, showQr, showName, showCode, showLocation, showDate, fontFamily }
  // เลย์เอาต์ตามตัวอย่างป้ายครุภัณฑ์: QR ซ้าย (สูงเต็มป้าย) | ขวา: รหัสครุภัณฑ์ (ใหญ่สุด) / ชื่ออุปกรณ์ / (ที่เก็บ) / วันที่
  const MAX_AUTO_MM = 90;
  const MIN_QR_SCALE = 2; // module ต่ำกว่า 2 จุด (~0.28 มม.) สแกนไม่ติด

  function qrMatrix(text) {
    if (typeof document === 'undefined' || typeof QRCode === 'undefined') return null;
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
    document.body.appendChild(holder);
    try {
      const q = new QRCode(holder, { text: String(text), width: 64, height: 64, correctLevel: QRCode.CorrectLevel.M });
      const m = q._oQRCode;
      const n = m.getModuleCount();
      const rows = [];
      for (let r = 0; r < n; r++) {
        const row = [];
        for (let c = 0; c < n; c++) row.push(m.isDark(r, c));
        rows.push(row);
      }
      return rows;
    } finally {
      document.body.removeChild(holder);
    }
  }

  // คืนข้อมูลว่า QR พิมพ์ได้ชัดบนเทปนี้ไหม
  function qrFits(tapeMm, qrText) {
    const tape = TAPES[tapeMm];
    const m = qrMatrix(qrText);
    if (!tape || !m) return { ok: false, scale: 0, modules: 0 };
    const cells = m.length + 2;
    const scale = Math.floor(tape.pins / cells);
    return { ok: scale >= MIN_QR_SCALE, scale, modules: m.length };
  }

  function renderLabel(item, options) {
    const o = Object.assign({
      tapeMm: 24, lengthMm: null, showQr: true, showName: true, showCode: true, showLocation: false, showDate: true,
      fontFamily: "'IBM Plex Sans Thai','Sarabun','Tahoma',sans-serif",
    }, options || {});
    const tape = TAPES[o.tapeMm];
    if (!tape) throw new Error('ไม่รองรับเทปกว้าง ' + o.tapeMm + ' มม.');
    const H = tape.pins;
    const pad = Math.max(2, Math.round(H * 0.05));
    const gap = Math.max(3, Math.round(H * 0.07));

    // 1) QR
    let qr = null;
    let qrW = 0;
    if (o.showQr && item.qrText) {
      const m = qrMatrix(item.qrText);
      if (m) {
        const cells = m.length + 2; // quiet zone 1 module รอบด้าน
        const scale = Math.floor(H / cells);
        if (scale >= MIN_QR_SCALE) {
          qr = { m, scale, cells };
          qrW = cells * scale;
        }
      }
    }

    // 2) ข้อความ (rel = ขนาดเทียบบรรทัดชื่อ)
    const lines = [];
    if (o.showCode && item.code) lines.push({ text: String(item.code), weight: 500, rel: 1, family: o.fontFamily });
    if (o.showName && item.name) lines.push({ text: String(item.name), weight: 500, rel: 0.85, family: o.fontFamily });
    if (o.showLocation && item.location) lines.push({ text: String(item.location), weight: 400, rel: 0.7, family: o.fontFamily });
    if (o.showDate && item.date) lines.push({ text: String(item.date), weight: 400, rel: 0.7, family: o.fontFamily });
    if (!lines.length && !qr) lines.push({ text: String(item.code || item.name || '-'), weight: 700, rel: 1, family: o.fontFamily });

    const meas = document.createElement('canvas').getContext('2d');
    const lineH = 1.25;
    const relSum = lines.reduce((s, l) => s + l.rel, 0);
    let base = relSum ? Math.floor((H - 2 * pad) / (relSum * lineH)) : 0;
    base = Math.max(8, Math.min(base, Math.round(H * 0.5)));
    const widthAt = (b) => lines.reduce((mx, l) => {
      meas.font = l.weight + ' ' + Math.round(b * l.rel) + 'px ' + l.family;
      return Math.max(mx, Math.ceil(meas.measureText(l.text).width));
    }, 0);

    const textX = pad + (qr ? qrW + gap : 0);
    const maxTotal = o.lengthMm ? mmToDots(o.lengthMm) : mmToDots(MAX_AUTO_MM);
    const availText = maxTotal - textX - pad;
    if (lines.length) {
      while (base > 6 && widthAt(base) > availText) base--;
    }
    const textW = lines.length ? widthAt(base) : 0;
    let W = o.lengthMm ? mmToDots(o.lengthMm) : textX + textW + pad;
    W = Math.max(W, qr ? qrW + 2 * pad : 24);

    // 3) วาด
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000';

    if (qr) {
      const top = Math.floor((H - qr.cells * qr.scale) / 2);
      for (let r = 0; r < qr.m.length; r++) {
        for (let c = 0; c < qr.m.length; c++) {
          if (qr.m[r][c]) ctx.fillRect(pad + (c + 1) * qr.scale, top + (r + 1) * qr.scale, qr.scale, qr.scale);
        }
      }
    }

    if (lines.length) {
      const totalH = lines.reduce((s, l) => s + Math.round(base * l.rel) * lineH, 0);
      let y = Math.max(pad, (H - totalH) / 2);
      ctx.textBaseline = 'middle';
      lines.forEach((l) => {
        const fs = Math.round(base * l.rel);
        ctx.font = l.weight + ' ' + fs + 'px ' + l.family;
        const slot = fs * lineH;
        ctx.fillText(l.text, textX, y + slot / 2, Math.max(1, W - textX - pad));
        y += slot;
      });
    }

    // 4) แปลงเป็น 1 บิต
    const img = ctx.getImageData(0, 0, W, H).data;
    const data = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const lum = img[i * 4] * 0.299 + img[i * 4 + 1] * 0.587 + img[i * 4 + 2] * 0.114;
      data[i] = img[i * 4 + 3] > 128 && lum < 150 ? 1 : 0;
    }
    return { canvas, bitmap: { width: W, height: H, data }, lengthMm: dotsToMm(W) };
  }

  // ---------------------------------------------------------------- printer (Web Serial)
  const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class Printer {
    constructor() {
      this.port = null;
      this.rx = [];
      this.reading = false;
      this.lastStatus = null;
    }

    static supported() {
      return typeof navigator !== 'undefined' && 'serial' in navigator && (typeof isSecureContext === 'undefined' || isSecureContext);
    }

    get connected() { return !!this.port; }

    async connect() {
      if (!Printer.supported()) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Serial (ใช้ Chrome/Edge บนคอมพิวเตอร์)');
      let port;
      try {
        port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP_UUID], filters: [{ bluetoothServiceClassId: SPP_UUID }] });
      } catch (e) {
        if (e && e.name === 'NotFoundError') throw new Error('ยกเลิกการเลือกเครื่องพิมพ์');
        port = await navigator.serial.requestPort(); // Chrome รุ่นเก่า/ระบบที่แสดงเป็น COM port
      }
      await port.open({ baudRate: 115200, bufferSize: 65536 });
      this.port = port;
      this.rx = [];
      this._readLoop();
      return this.requestStatus();
    }

    async _readLoop() {
      this.reading = true;
      while (this.port && this.port.readable) {
        const reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) for (let i = 0; i < value.length; i++) this.rx.push(value[i]);
          }
        } catch (e) {
          break;
        } finally {
          try { reader.releaseLock(); } catch (e) {}
        }
      }
      this.reading = false;
    }

    async _write(bytes) {
      const writer = this.port.writable.getWriter();
      try {
        const CH = 1024;
        for (let i = 0; i < bytes.length; i += CH) await writer.write(bytes.subarray(i, i + CH));
      } finally {
        writer.releaseLock();
      }
    }

    async _waitStatus(timeoutMs, accept) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        const f = findStatus(this.rx);
        if (f && f.status) {
          this.rx.splice(0, f.index + 32);
          this.lastStatus = f.status;
          if (!accept || accept(f.status)) return f.status;
          continue;
        }
        if (Date.now() > end) return null;
        await sleep(40);
      }
    }

    // ESC i S : ขอสถานะ (ได้ความกว้างเทปที่ใส่อยู่ + error)
    async requestStatus() {
      this.rx = [];
      await this._write(Uint8Array.from([0x1b, 0x40, 0x1b, 0x69, 0x53]));
      return this._waitStatus(2500, (s) => s.statusType === 0x00);
    }

    // พิมพ์ bitmap หนึ่งป้าย แล้วรอเครื่องรายงาน "พิมพ์เสร็จ" (หรือ error)
    async printBitmap(bitmap, tapeMm, opts) {
      if (!this.port) throw new Error('ยังไม่ได้เชื่อมต่อเครื่องพิมพ์');
      const job = buildPrintJob(bitmap, tapeMm, opts);
      this.rx = [];
      await this._write(job);
      const done = await this._waitStatus(20000 + bitmap.width * 8, (s) => s.statusType === 0x01 || s.statusType === 0x02);
      if (!done) return { ok: true, confirmed: false };
      if (done.statusType === 0x02 || done.errors.length) {
        return { ok: false, errors: done.errors.length ? done.errors : ['เครื่องพิมพ์รายงานข้อผิดพลาด'] };
      }
      return { ok: true, confirmed: true };
    }

    async disconnect() {
      const p = this.port;
      this.port = null;
      if (p) { try { await p.close(); } catch (e) {} }
    }
  }

  return {
    DPI, TAPES, HEAD_PINS, MAX_AUTO_MM, MIN_QR_SCALE,
    mmToDots, dotsToMm, thaiDate, toThaiDigits, packBits, bitmapToRasterLines, buildPrintJob, parseStatus, findStatus,
    qrFits, renderLabel, Printer,
  };
});
