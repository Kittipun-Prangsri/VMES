/* ============================================================================
 * หน้าต่างพิมพ์ป้ายสติกเกอร์ครุภัณฑ์ (Brother PT-P710BT) — แยกออกจาก index.html
 * พึ่ง ptouch-label.js (PTouch) และ global ของ index.html: DATA, $, esc, toast, openModal,
 * storageGet/storageSet, isAdmin  (อ้างถึงเฉพาะตอนเรียกใช้)
 * ========================================================================== */
// ============== LABEL PRINT (Brother PT-P710BT) ==============
// วาดป้าย (QR + รหัส + ชื่อ + วันที่) ด้วย ptouch-label.js แล้วพิมพ์ได้ 3 ทาง:
//  1) Bluetooth ตรง (Web Serial — Chrome/Edge บนคอมพิวเตอร์ ต้อง pair เครื่องก่อน)
//  2) ผ่านไดรเวอร์/หน้าต่างพิมพ์ของเบราว์เซอร์ (@page ขนาดเท่าป้าย)
//  3) ดาวน์โหลด PNG ไปเปิดในแอป Brother iPrint&Label (มือถือ)
const PT_PREF_KEY = 'vmes_ptouch_pref';
const PT_DEFAULT = { tapeMm: 24, lenMode: 'auto', lenMm: 45, showQr: true, showCode: true, showName: true, showLocation: false, showDate: 'purchase', autoCut: true, flipH: false, flipV: false, copies: 1 };
const PT_STATE = { items: [], idx: 0, pref: null, printer: null, busy: false, last: null };

function ptLoadPref() {
  let p = {};
  try { p = JSON.parse(storageGet(PT_PREF_KEY) || '{}') || {}; } catch (e) {}
  return Object.assign({}, PT_DEFAULT, p);
}

function ptItemData(e, pref) {
  let date = '';
  if (pref.showDate === 'purchase') date = PTouch.thaiDate(e['วันที่จัดซื้อ']);
  else if (pref.showDate === 'print') date = PTouch.thaiDate(new Date());
  return {
    name: e['ชื่ออุปกรณ์'], code: e['รหัสครุภัณฑ์'] || e['รหัส'], location: e['ที่เก็บ'],
    date, qrText: String(e['รหัส'] || e['รหัสครุภัณฑ์'] || ''),
  };
}

async function ptRender(e, pref) {
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.all(['500', '400'].map(w => document.fonts.load(w + ' 24px "IBM Plex Sans Thai"', 'กขค๑๒๓0')));
    }
  } catch (err) {}
  return PTouch.renderLabel(ptItemData(e, pref), {
    tapeMm: pref.tapeMm, lengthMm: pref.lenMode === 'custom' ? pref.lenMm : null,
    showQr: pref.showQr, showCode: pref.showCode, showName: pref.showName,
    showLocation: pref.showLocation, showDate: pref.showDate !== 'none',
  });
}

function openLabelPrintModal(list) {
  if (!isAdmin()) { toast('การพิมพ์ป้ายอนุญาตเฉพาะ Admin', 'warning'); return; }
  if (typeof PTouch === 'undefined') { toast('โหลดโมดูลพิมพ์ป้ายไม่สำเร็จ กรุณารีเฟรชหน้า', 'error'); return; }
  // รับได้ทั้ง record หรือรหัส (จากปุ่มในตาราง)
  const items = (list || []).map(x => (typeof x === 'object' ? x : DATA.equipment.find(e => String(e['รหัส']) === String(x) || String(e['รหัสครุภัณฑ์']) === String(x)))).filter(Boolean);
  if (!items.length) { toast('ไม่พบรายการที่จะพิมพ์', 'warning'); return; }
  PT_STATE.items = items;
  PT_STATE.idx = 0;
  PT_STATE.pref = ptLoadPref();
  const p = PT_STATE.pref;
  const sup = PTouch.Printer.supported();
  const body = `
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:20px;">
      <div>
        ${items.length > 1 ? `<div class="field"><label>ดูตัวอย่างรายการที่ (ทั้งหมด ${items.length} ป้าย)</label>
          <select id="pt_idx" onchange="ptUpdate()">${items.map((e, i) => `<option value="${i}">${esc(e['รหัสครุภัณฑ์'] || e['รหัส'])} — ${esc(e['ชื่ออุปกรณ์'])}</option>`).join('')}</select></div>` : `<div style="font-weight:700; margin-bottom:10px;">${esc(items[0]['ชื่ออุปกรณ์'])}</div>`}
        <div class="field"><label>ความกว้างเทป (TZe)</label>
          <select id="pt_tape" onchange="ptUpdate()">${Object.keys(PTouch.TAPES).map(t => `<option value="${t}" ${+t === +p.tapeMm ? 'selected' : ''}>${t} มม.</option>`).join('')}</select></div>
        <div class="field"><label>ความยาวป้าย</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <select id="pt_lenMode" onchange="ptUpdate()"><option value="auto" ${p.lenMode === 'auto' ? 'selected' : ''}>อัตโนมัติ (ตามข้อความ)</option><option value="custom" ${p.lenMode === 'custom' ? 'selected' : ''}>กำหนดเอง</option></select>
            <input id="pt_lenMm" type="number" min="15" max="${PTouch.MAX_AUTO_MM * 2}" value="${esc(p.lenMm)}" oninput="ptUpdate()" style="width:80px;"> มม.
          </div></div>
        <div style="display:flex; flex-wrap:wrap; gap:6px 16px; margin:8px 0;">
          <label><input type="checkbox" id="pt_qr" ${p.showQr ? 'checked' : ''} onchange="ptUpdate()"> QR Code</label>
          <label><input type="checkbox" id="pt_code" ${p.showCode ? 'checked' : ''} onchange="ptUpdate()"> รหัสครุภัณฑ์</label>
          <label><input type="checkbox" id="pt_name" ${p.showName ? 'checked' : ''} onchange="ptUpdate()"> ชื่ออุปกรณ์</label>
          <label><input type="checkbox" id="pt_loc" ${p.showLocation ? 'checked' : ''} onchange="ptUpdate()"> ที่เก็บ</label>
        </div>
        <div class="field"><label>วันที่บนป้าย (แบบไทย เช่น ๒๖ ตุลาคม ๒๕๖๙)</label>
          <select id="pt_date" onchange="ptUpdate()">
            <option value="purchase" ${p.showDate === 'purchase' ? 'selected' : ''}>วันที่จัดซื้อของอุปกรณ์</option>
            <option value="print" ${p.showDate === 'print' ? 'selected' : ''}>วันที่พิมพ์ป้าย</option>
            <option value="none" ${p.showDate === 'none' ? 'selected' : ''}>ไม่แสดงวันที่</option></select></div>
        <div class="field"><label>จำนวนที่พิมพ์ต่อป้าย</label><input id="pt_copies" type="number" min="1" max="20" value="${esc(p.copies)}" oninput="ptUpdate()" style="width:90px;"></div>
        <details style="margin-top:6px;"><summary style="cursor:pointer; font-size:13px; color:#64748b;">⚙️ ตั้งค่าขั้นสูง</summary>
          <div style="display:flex; flex-direction:column; gap:6px; margin-top:8px; font-size:13px;">
            <label><input type="checkbox" id="pt_cut" ${p.autoCut ? 'checked' : ''} onchange="ptUpdate()"> ตัดเทปอัตโนมัติหลังพิมพ์แต่ละป้าย</label>
            <label><input type="checkbox" id="pt_flipH" ${p.flipH ? 'checked' : ''} onchange="ptUpdate()"> กลับซ้าย-ขวา (ใช้ถ้าป้ายที่พิมพ์ออกมากลับด้านกระจก)</label>
            <label><input type="checkbox" id="pt_flipV" ${p.flipV ? 'checked' : ''} onchange="ptUpdate()"> กลับบน-ล่าง (ใช้ถ้าป้ายที่พิมพ์ออกมากลับหัว)</label>
          </div></details>
      </div>
      <div>
        <div style="font-size:13px; color:#64748b; margin-bottom:6px;">ตัวอย่างป้าย <span id="pt_size"></span></div>
        <div style="background:#e2e8f0; border-radius:10px; padding:14px; overflow:auto;">
          <div id="pt_preview" style="display:inline-block; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.25);"></div>
        </div>
        <div id="pt_qrwarn" style="display:none; margin-top:8px; font-size:12px; color:#b45309; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:6px 10px;"></div>
        <div style="margin-top:14px; padding:12px; border:1px solid #e2e8f0; border-radius:10px;">
          <div style="font-weight:700; font-size:13px; margin-bottom:8px;">🔌 Brother PT-P710BT (Bluetooth)</div>
          <div id="pt_conn" style="font-size:12px; color:#64748b; margin-bottom:8px;">${sup ? 'ยังไม่ได้เชื่อมต่อ — จับคู่ (pair) บลูทูธของเครื่องกับคอมพิวเตอร์ก่อน แล้วกดเชื่อมต่อ' : '⚠️ เบราว์เซอร์นี้ไม่รองรับ Web Serial (ต้องใช้ Chrome/Edge บนคอมพิวเตอร์) — ใช้ปุ่ม "ไดรเวอร์" หรือ "PNG" แทน'}</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-sm btn-secondary" onclick="ptConnect()" ${sup ? '' : 'disabled'}>🔌 เชื่อมต่อเครื่องพิมพ์</button>
            <button class="btn btn-sm btn-primary" id="pt_btnBT" onclick="ptPrintBT()" ${sup ? '' : 'disabled'} style="font-weight:700;">🖨️ พิมพ์ผ่านบลูทูธ</button>
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
          <button class="btn btn-sm btn-info" onclick="ptPrintBrowser()">🖨️ พิมพ์ผ่านไดรเวอร์/เบราว์เซอร์</button>
          <button class="btn btn-sm btn-secondary" onclick="ptDownloadPng()">💾 ดาวน์โหลด PNG (แอป iPrint&amp;Label)</button>
        </div>
      </div>
    </div>`;
  openModal('🏷️ พิมพ์ป้ายสติกเกอร์ — Brother PT-P710BT', body, null, true);
  if (PT_STATE.printer && PT_STATE.printer.connected) ptSetConn('✅ เชื่อมต่อเครื่องพิมพ์แล้ว', true);
  ptUpdate();
}

function ptSetConn(text, ok) {
  const el = $('pt_conn');
  if (el) { el.textContent = text; el.style.color = ok ? '#15803d' : '#64748b'; }
}

function ptReadForm() {
  const g = id => $(id);
  const p = PT_STATE.pref;
  p.tapeMm = +g('pt_tape').value;
  p.lenMode = g('pt_lenMode').value;
  p.lenMm = Math.max(15, +g('pt_lenMm').value || PT_DEFAULT.lenMm);
  p.showQr = g('pt_qr').checked; p.showCode = g('pt_code').checked; p.showName = g('pt_name').checked; p.showLocation = g('pt_loc').checked;
  p.showDate = g('pt_date').value;
  p.copies = Math.min(20, Math.max(1, Math.floor(+g('pt_copies').value) || 1));
  p.autoCut = g('pt_cut').checked; p.flipH = g('pt_flipH').checked; p.flipV = g('pt_flipV').checked;
  PT_STATE.idx = g('pt_idx') ? +g('pt_idx').value : 0;
  storageSet(PT_PREF_KEY, JSON.stringify(p));
  return p;
}

let _ptSeq = 0;
async function ptUpdate() {
  const p = ptReadForm();
  const seq = ++_ptSeq;
  $('pt_lenMm').disabled = p.lenMode !== 'custom';
  const e = PT_STATE.items[PT_STATE.idx];
  const r = await ptRender(e, p);
  if (seq !== _ptSeq || !$('pt_preview')) return; // มีการเปลี่ยนค่าใหม่กว่านี้แล้ว
  PT_STATE.last = r;
  const cv = r.canvas;
  cv.style.cssText = 'display:block; image-rendering:pixelated; height:' + (cv.height * 2) + 'px; width:' + (cv.width * 2) + 'px;';
  $('pt_preview').innerHTML = '';
  $('pt_preview').appendChild(cv);
  $('pt_size').textContent = '· ' + r.lengthMm.toFixed(1) + ' × ' + PTouch.dotsToMm(cv.height).toFixed(1) + ' มม. (เทป ' + p.tapeMm + ' มม.)';
  const warn = $('pt_qrwarn');
  const fit = PTouch.qrFits(p.tapeMm, ptItemData(e, p).qrText);
  if (p.showQr && !fit.ok) {
    warn.style.display = '';
    warn.textContent = '⚠️ เทป ' + p.tapeMm + ' มม. เล็กเกินกว่าจะพิมพ์ QR ให้สแกนติด จึงพิมพ์เฉพาะข้อความ (แนะนำเทป 12 มม. ขึ้นไป)';
  } else if (r.lengthMm > PTouch.MAX_AUTO_MM + 0.5 && p.lenMode === 'auto') {
    warn.style.display = '';
    warn.textContent = 'ℹ️ ข้อความยาว ระบบย่อตัวอักษรให้พอดี ' + PTouch.MAX_AUTO_MM + ' มม.';
  } else warn.style.display = 'none';
}

async function ptConnect() {
  try {
    if (!PT_STATE.printer) PT_STATE.printer = new PTouch.Printer();
    ptSetConn('กำลังเชื่อมต่อ… เลือกเครื่อง PT-P710BT ในหน้าต่างที่เด้งขึ้นมา', false);
    const st = await PT_STATE.printer.connect();
    let msg = '✅ เชื่อมต่อเครื่องพิมพ์แล้ว';
    if (st) {
      const mm = st.tapeMm === 4 ? 3.5 : st.tapeMm;
      if (PTouch.TAPES[mm]) {
        msg += ' · พบเทปกว้าง ' + mm + ' มม.';
        $('pt_tape').value = String(mm);
        ptUpdate();
      }
      if (st.errors.length) msg += ' · ⚠️ ' + st.errors.join(', ');
    } else msg += ' · (เครื่องไม่ตอบสถานะ — ตรวจว่าเปิดเครื่องและใส่เทปแล้ว)';
    ptSetConn(msg, true);
  } catch (err) {
    PT_STATE.printer = null;
    ptSetConn('❌ เชื่อมต่อไม่สำเร็จ: ' + err.message, false);
  }
}

async function ptPrintBT() {
  if (PT_STATE.busy) return;
  const p = ptReadForm();
  try {
    if (!PT_STATE.printer || !PT_STATE.printer.connected) { await ptConnect(); }
    const pr = PT_STATE.printer;
    if (!pr || !pr.connected) return;
    PT_STATE.busy = true;
    const st = await pr.requestStatus();
    if (st) {
      const mm = st.tapeMm === 4 ? 3.5 : st.tapeMm;
      if (st.errors.length) { toast('เครื่องพิมพ์: ' + st.errors.join(', '), 'error'); return; }
      if (mm && +mm !== +p.tapeMm) {
        if (PTouch.TAPES[mm]) { $('pt_tape').value = String(mm); ptUpdate(); }
        toast('เทปในเครื่องกว้าง ' + mm + ' มม. แต่เลือก ' + p.tapeMm + ' มม. — ปรับให้ตรงแล้ว ตรวจตัวอย่างก่อนกดพิมพ์อีกครั้ง', 'warning');
        return;
      }
    }
    const total = PT_STATE.items.length * p.copies;
    let n = 0;
    for (const e of PT_STATE.items) {
      const r = await ptRender(e, p);
      for (let c = 0; c < p.copies; c++) {
        n++;
        toast('กำลังพิมพ์ป้าย ' + n + '/' + total + '…', 'info');
        const res = await pr.printBitmap(r.bitmap, p.tapeMm, { autoCut: p.autoCut, flipH: p.flipH, flipV: p.flipV });
        if (!res.ok) { toast('พิมพ์ไม่สำเร็จ: ' + res.errors.join(', '), 'error'); return; }
      }
    }
    toast('ส่งพิมพ์ครบ ' + total + ' ป้ายแล้ว');
  } catch (err) {
    ptSetConn('❌ ' + err.message, false);
    toast('พิมพ์ไม่สำเร็จ: ' + err.message, 'error');
    if (PT_STATE.printer) { try { await PT_STATE.printer.disconnect(); } catch (x) {} PT_STATE.printer = null; }
  } finally {
    PT_STATE.busy = false;
  }
}

async function ptPrintBrowser() {
  const p = ptReadForm();
  const w = window.open('', '_blank'); // เปิดทันทีใน call stack ของการคลิก กัน popup blocker
  if (!w) { toast('เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป กรุณาอนุญาตแล้วลองใหม่', 'error'); return; }
  w.document.write('<p style="font-family:sans-serif">กำลังเตรียมป้าย…</p>');
  let css = '', pages = '', k = 0;
  for (const e of PT_STATE.items) {
    const r = await ptRender(e, p);
    const wMm = r.lengthMm.toFixed(2), hMm = PTouch.dotsToMm(r.canvas.height).toFixed(2);
    const url = r.canvas.toDataURL('image/png');
    css += '@page l' + k + ' { size: ' + wMm + 'mm ' + p.tapeMm + 'mm; margin: 0; } .l' + k + ' { page: l' + k + '; width:' + wMm + 'mm; height:' + p.tapeMm + 'mm; }\n';
    for (let c = 0; c < p.copies; c++) pages += '<div class="pg l' + k + '"><img src="' + url + '" style="width:' + wMm + 'mm;height:' + hMm + 'mm;"></div>';
    k++;
  }
  w.document.open();
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>พิมพ์ป้าย</title><style>' + css +
    'html,body{margin:0;padding:0}.pg{display:flex;align-items:center;overflow:hidden;page-break-after:always;break-after:page}.pg img{display:block;image-rendering:pixelated}' +
    '@media screen{body{background:#e2e8f0;padding:12px}.pg{background:#fff;margin:0 0 10px;box-shadow:0 1px 4px rgba(0,0,0,.3)}}' +
    '</style></head><body>' + pages +
    '<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>');
  w.document.close();
}

function ptDownloadPng() {
  const r = PT_STATE.last;
  if (!r) return;
  const e = PT_STATE.items[PT_STATE.idx];
  r.canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'label-' + String(e['รหัสครุภัณฑ์'] || e['รหัส']).replace(/[^\w.\-ก-๙]+/g, '_') + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}
window.openLabelPrintModal = openLabelPrintModal;
window.ptUpdate = ptUpdate; window.ptConnect = ptConnect; window.ptPrintBT = ptPrintBT;
window.ptPrintBrowser = ptPrintBrowser; window.ptDownloadPng = ptDownloadPng;
