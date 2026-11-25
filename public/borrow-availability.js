/* ============================================================================
 * ความพร้อมยืมของอุปกรณ์ "ตามช่วงวันที่" — ใช้ทั้ง backend (ตรวจก่อนบันทึก) และหน้า LIFF/เว็บ (แสดงผล)
 *
 * แหล่งจริงอยู่ที่ backend-node/lib/borrowAvailability.js; `npm run build` คัดลอกไป public/borrow-availability.js
 * ให้เบราว์เซอร์ใช้ (มีเทสต์เช็กว่าสำเนาตรงกันเสมอ) — ไฟล์นี้จึงห้ามอ้างอะไรที่มีเฉพาะ Node
 *
 * หลักการ (ต่างจากเดิมที่ "มีคำขอค้างอยู่ = ติดยืมทั้งหมด" ไม่ดูวัน และนับเฉพาะรายการแรกของคำขอหลายชิ้น):
 *  - คำขอหนึ่งใบมีได้หลายรายการ (รายการอุปกรณ์) นับจำนวนแยกตามอุปกรณ์แต่ละชิ้น
 *  - คำขอกินช่วง [วันที่ต้องการรับ, วันที่ครบกำหนดคืน] ถ้าเลยกำหนดแล้วแต่ยังไม่คืน ถือว่ายังอยู่นอกคลังถึง "วันนี้"
 *  - ความว่างในช่วงที่ขอ = จำนวนในคลัง − ปริมาณการใช้พร้อมกันสูงสุดในช่วงนั้น → ของที่ติดยืมถึงวัน X จองหลังวัน X ได้
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BorrowAvail = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ยังไม่ปิดงาน = ยังกันของไว้ ('ขอขยายเวลา' ต้องนับด้วย — เดิมหายไปทำให้ยืมซ้อนได้)
  const ACTIVE_STATUSES = ['รอรับเรื่อง', 'รับเรื่องแล้ว', 'อยู่ในระหว่างการยืม', 'ถึงวันครบกำหนดคืน', 'อยู่ในระหว่างการคืน', 'ขอขยายเวลา'];
  // สถานะของตัวอุปกรณ์ที่ยืมไม่ได้เลย
  const UNBORROWABLE_STATUSES = ['ชำรุด', 'ยืมอยู่', 'จำหน่าย', 'ส่งซ่อม', 'สูญหาย'];

  const pad = (n) => String(n).padStart(2, '0');

  // 'dd/mm/yyyy' (ฟอร์ม LIFF), 'yyyy-mm-dd[ ...]' (เว็บ/ฐานข้อมูล), ปี พ.ศ. (> 2400) -> 'YYYY-MM-DD' หรือ '' ถ้าอ่านไม่ได้
  function toIso(v) {
    if (v == null) return '';
    const s = String(v).trim();
    let y, m, d;
    let x = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (x) { y = +x[1]; m = +x[2]; d = +x[3]; }
    else if ((x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) { d = +x[1]; m = +x[2]; y = +x[3]; }
    else return '';
    if (y > 2400) y -= 543;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function addDays(iso, n) {
    const t = new Date(iso + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + n);
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }

  // รายการที่คำขอหนึ่งใบยืมอยู่ — แบบหลายรายการใช้ 'รายการอุปกรณ์' (ข้อมูลเก่าที่มีชิ้นเดียวใช้ 'รหัสอุปกรณ์' + 'จำนวน')
  function linesOf(b) {
    if (Array.isArray(b['รายการอุปกรณ์']) && b['รายการอุปกรณ์'].length) {
      return b['รายการอุปกรณ์'].map((i) => ({ id: i['รหัสอุปกรณ์'], qty: parseFloat(i['จำนวน']) || 0 }));
    }
    return b['รหัสอุปกรณ์'] ? [{ id: b['รหัสอุปกรณ์'], qty: parseFloat(b['จำนวน']) || 0 }] : [];
  }

  // ช่วงวันที่คำขอนี้กันของไว้: { s, e } เป็น 'YYYY-MM-DD'
  function windowOf(b, today) {
    const s = toIso(b['วันที่ต้องการรับ']) || toIso(b['วันที่ขอยืม']) || toIso(String(b['วันที่บันทึก'] || '').slice(0, 10)) || today;
    let e = toIso(b['วันที่ครบกำหนด']) || s;
    if (e < s) e = s;
    // เลยกำหนดแล้วแต่ยังไม่ปิดงาน (ทั้งที่ยังรอรับเรื่อง/อยู่กับผู้ยืม) ของยังไม่กลับ — กันไว้ถึงวันนี้
    if (e < today) e = today;
    return { s, e };
  }

  // ช่วงที่อุปกรณ์ชิ้นนี้ถูกกันไว้ (ไม่มีข้อมูลบุคคล — ส่งให้หน้า LIFF สาธารณะได้)
  function busyWindows(equipId, borrowings, today, opts) {
    const except = opts && opts.excludeCode;
    const out = [];
    (borrowings || []).forEach((b) => {
      if (!ACTIVE_STATUSES.includes(b['สถานะ'])) return;
      if (except && String(b['รหัส']) === String(except)) return;
      let q = 0;
      linesOf(b).forEach((l) => { if (String(l.id) === String(equipId)) q += l.qty; });
      if (q > 0) { const w = windowOf(b, today); out.push({ s: w.s, e: w.e, q }); }
    });
    return out;
  }

  // ปริมาณที่ถูกกันไว้พร้อมกันสูงสุดตลอดช่วง [from, to] (การใช้งานเปลี่ยนเฉพาะวันที่คำขอเริ่ม จึงเช็กที่ from และทุกวันเริ่มภายในช่วง)
  function peakUsage(busy, from, to) {
    const overlap = (busy || []).filter((b) => b.s <= to && b.e >= from);
    if (!overlap.length) return 0;
    const points = [from].concat(overlap.map((b) => b.s).filter((s) => s > from && s <= to));
    let peak = 0;
    points.forEach((p) => {
      const sum = overlap.reduce((a, b) => (b.s <= p && b.e >= p ? a + b.q : a), 0);
      if (sum > peak) peak = sum;
    });
    return peak;
  }

  function availableFor(stock, busy, from, to) {
    const total = parseFloat(stock) || 0;
    const f = from || '0000-01-01', t = to || f;
    return Math.max(0, total - peakUsage(busy, f, t < f ? f : t));
  }

  // วันที่เร็วที่สุด (ตั้งแต่วันนี้) ที่มีของว่างอย่างน้อย need ชิ้น — '' ถ้าไม่มีทาง (เช่น need > จำนวนในคลัง)
  function nextFreeDate(stock, busy, today, need) {
    const n = need || 1;
    if ((parseFloat(stock) || 0) < n) return '';
    const cands = [today].concat((busy || []).map((b) => addDays(b.e, 1))).filter((d) => d >= today).sort();
    for (const d of cands) if (availableFor(stock, busy, d, d) >= n) return d;
    return '';
  }

  function isBorrowableStatus(status) { return !UNBORROWABLE_STATUSES.includes(String(status || '').trim()); }

  // อุปกรณ์ที่เปิดให้ยืมผ่านระบบนี้ = ของงานสารสนเทศเท่านั้น; ของหน่วยงานอื่นเป็นครุภัณฑ์ที่ตั้งใช้งานอยู่ในหน่วยงานนั้นแล้ว
  // (ข้อมูลเก่าที่ยังไม่ระบุหน่วยงานที่รับผิดชอบ ถือเป็นของงานสารสนเทศ)
  function isITUnit(unit) {
    const u = String(unit == null ? '' : unit).trim();
    return !u || /สารสนเทศ|ไอที|(^|[^A-Za-z])IT([^A-Za-z]|$)/i.test(u);
  }
  function isBorrowPoolEquipment(e) { return !!e && isITUnit(e['หน่วยงานที่รับผิดชอบ']); }

  return { isITUnit, isBorrowPoolEquipment, ACTIVE_STATUSES, UNBORROWABLE_STATUSES, toIso, addDays, linesOf, windowOf, busyWindows, peakUsage, availableFor, nextFreeDate, isBorrowableStatus };
});
