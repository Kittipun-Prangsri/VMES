/* ============================================================================
 * หน้าต่าง "อ่านข้อความจากกล้อง" (OCR) — ใช้ร่วมกันในฟอร์มอุปกรณ์และโหมดสำรวจภาคสนาม
 * พึ่ง ocr-capture.js (OCR) และ global ของ index.html: $, esc, toast
 *
 * ocrOpenScanner({
 *   fields:  { tag, serial, model, brand, name, note }   // id ของช่องที่จะเติม (ไม่มี = ข้ามช่องนั้น)
 *   onField: (field) => void                              // เรียกก่อนเติมช่องนั้น (เช่น สลับเป็น "มีป้าย")
 *   onApplied: () => void                                 // เรียกหลังเติมค่าเสร็จ
 *   addPhoto: (dataUrl, label) => boolean                 // (ไม่บังคับ) เก็บภาพที่ใช้อ่านเป็นรูปมุมของอุปกรณ์
 * })
 * ========================================================================== */
(function () {
  const FIELD_LABELS = { tag: 'เลขครุภัณฑ์', serial: 'Serial Number', model: 'รุ่น', brand: 'ยี่ห้อ', name: 'ชื่ออุปกรณ์', note: 'หมายเหตุ' };

  function ensureCss() {
    if (document.getElementById('ocr-css')) return;
    const st = document.createElement('style');
    st.id = 'ocr-css';
    st.textContent = `
      .ocr-ov { position:fixed; inset:0; z-index:100001; background:rgba(2,6,23,.75); display:flex; align-items:flex-start; justify-content:center; overflow:auto; padding:20px 12px; }
      .ocr-box { background:#fff; border-radius:16px; width:min(640px,100%); box-shadow:0 20px 60px rgba(0,0,0,.45); overflow:hidden; }
      .ocr-head { display:flex; justify-content:space-between; align-items:center; padding:14px 18px; background:#0f766e; color:#fff; font-weight:700; }
      .ocr-head button { background:transparent; border:none; color:#fff; font-size:18px; cursor:pointer; }
      .ocr-body { padding:16px 18px; display:flex; flex-direction:column; gap:14px; }
      .ocr-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .ocr-btn { border:none; border-radius:10px; padding:10px 16px; font-weight:700; cursor:pointer; font-size:14px; background:#0d9488; color:#fff; }
      .ocr-btn.sec { background:#e2e8f0; color:#0f172a; }
      .ocr-btn:disabled { opacity:.5; cursor:not-allowed; }
      .ocr-prev { max-width:100%; max-height:260px; border-radius:10px; border:1px solid #e2e8f0; display:none; background:#f8fafc; }
      .ocr-bar { height:8px; background:#e2e8f0; border-radius:6px; overflow:hidden; display:none; }
      .ocr-bar > div { height:100%; width:0; background:#0d9488; transition:width .2s; }
      .ocr-field { display:grid; grid-template-columns:120px 1fr auto; gap:8px; align-items:center; }
      .ocr-field input { padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; min-width:0; }
      .ocr-chip { display:inline-block; border:1px solid #cbd5e1; background:#f8fafc; border-radius:14px; padding:3px 10px; font-size:12px; cursor:pointer; margin:0 6px 6px 0; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ocr-chip:hover, .ocr-chip.on { background:#ccfbf1; border-color:#2dd4bf; }
      .ocr-note { font-size:12px; color:#64748b; }
      .ocr-filled { outline:2px solid #f59e0b !important; background:#fffbeb !important; }
    `;
    document.head.appendChild(st);
  }

  function readFileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดไฟล์รูปไม่ได้ (ถ้าเป็นไฟล์ HEIC ลองถ่ายใหม่หรือเปลี่ยนเป็น JPEG)')); };
      img.src = url;
    });
  }

  function markFilled(el) {
    el.classList.add('ocr-filled');
    el.title = 'เติมจากกล้อง — โปรดตรวจสอบความถูกต้อง';
    const clear = () => { el.classList.remove('ocr-filled'); el.title = ''; el.removeEventListener('input', clear); };
    el.addEventListener('input', clear);
  }

  window.ocrOpenScanner = function ocrOpenScanner(cfg) {
    cfg = cfg || {};
    if (typeof OCR === 'undefined') { toast('โหลดโมดูลอ่านตัวอักษรไม่สำเร็จ กรุณารีเฟรชหน้า', 'error'); return; }
    ensureCss();
    const fields = cfg.fields || {};
    const targets = Object.keys(FIELD_LABELS).filter(k => fields[k]);
    const S = { mode: 'en', canvas: null, parsed: null, busy: false, picked: '' };

    const ov = document.createElement('div');
    ov.className = 'ocr-ov';
    ov.innerHTML = `
      <div class="ocr-box" role="dialog" aria-label="อ่านข้อความจากกล้อง">
        <div class="ocr-head"><span>📷 อ่านข้อความจากกล้อง (ลดการพิมพ์)</span><button type="button" data-act="close" aria-label="ปิด">✕</button></div>
        <div class="ocr-body">
          <div class="ocr-note">ถ่ายภาพ <b>ป้ายครุภัณฑ์</b> หรือ <b>ป้ายซีเรียล/รุ่น</b> บนตัวเครื่องให้ตัวอักษรชัดและตรงกรอบ ระบบอ่านในเบราว์เซอร์ของคุณ ภาพไม่ถูกส่งออกไปที่อื่น · ใช้ครั้งแรกจะโหลดตัวอ่านก่อน (ต้องต่ออินเทอร์เน็ต)</div>
          <div class="ocr-row">
            <label style="font-size:13px;"><input type="radio" name="ocr_mode" value="en" checked> ตัวเลข/อังกฤษ <span class="ocr-note">(เร็ว — เหมาะกับป้ายและซีเรียล)</span></label>
            <label style="font-size:13px;"><input type="radio" name="ocr_mode" value="th"> รวมภาษาไทย <span class="ocr-note">(ช้ากว่า)</span></label>
          </div>
          <div class="ocr-row">
            <button type="button" class="ocr-btn" data-act="cam">📷 ถ่ายภาพ</button>
            <button type="button" class="ocr-btn sec" data-act="pick">🖼️ เลือกรูปจากเครื่อง</button>
            <input type="file" accept="image/*" capture="environment" data-in="cam" style="display:none">
            <input type="file" accept="image/*" data-in="pick" style="display:none">
          </div>
          <img class="ocr-prev" alt="ภาพที่ใช้อ่าน">
          <div class="ocr-bar"><div></div></div>
          <div class="ocr-status ocr-note" aria-live="polite"></div>
          <div class="ocr-result"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const q = (sel) => ov.querySelector(sel);
    const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    function setStatus(text) { q('.ocr-status').textContent = text || ''; }
    function setProgress(p) {
      const bar = q('.ocr-bar');
      bar.style.display = p == null ? 'none' : 'block';
      if (p != null) bar.firstElementChild.style.width = Math.round(p * 100) + '%';
    }

    // เติมค่าลงช่อง (force = ทับค่าเดิมที่พิมพ์ไว้ด้วย)
    function applyField(field, value, force) {
      const id = fields[field];
      const el = id && document.getElementById(id);
      const v = String(value || '').trim();
      if (!el || !v) return false;
      if (!force && String(el.value || '').trim()) return false;
      if (typeof cfg.onField === 'function') cfg.onField(field);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      markFilled(el);
      return true;
    }

    function renderResult() {
      const p = S.parsed;
      const box = q('.ocr-result');
      const sugg = { tag: p.tag, serial: p.serial || '', model: p.model, brand: p.brand };
      const extra = { serial: p.serials.slice(1).concat(p.serialGuesses) };
      const rows = targets.filter(t => ['tag', 'serial', 'model', 'brand'].includes(t)).map(t => `
        <div class="ocr-field" data-field="${t}">
          <label style="font-size:13px; font-weight:600;">${FIELD_LABELS[t]}</label>
          <input value="${esc(sugg[t] || '')}" placeholder="${sugg[t] ? '' : 'ไม่พบ — พิมพ์หรือแตะข้อความด้านล่าง'}">
          <button type="button" class="ocr-btn" style="padding:7px 12px;" data-act="use" data-field="${t}">ใช้ค่านี้</button>
        </div>
        ${(extra[t] || []).length ? `<div class="ocr-note" style="margin:-6px 0 0 128px;">ตัวเลือกอื่น: ${(extra[t] || []).slice(0, 4).map(v => `<span class="ocr-chip" data-act="alt" data-field="${t}" data-v="${esc(v)}">${esc(v)}</span>`).join('')}</div>` : ''}`).join('');
      const lines = p.lines.slice(0, 40).map(l => `<span class="ocr-chip" data-act="line" data-v="${esc(l)}" title="${esc(l)}">${esc(l)}</span>`).join('');
      box.innerHTML = `
        <div style="font-weight:700; font-size:14px; margin-bottom:8px;">ค่าที่อ่านได้ — ตรวจแล้วกด “ใช้ค่านี้”</div>
        <div style="display:flex; flex-direction:column; gap:8px;">${rows || '<div class="ocr-note">ฟอร์มนี้ไม่มีช่องที่รองรับ</div>'}</div>
        ${p.lines.length ? `
        <div style="margin-top:14px; font-weight:700; font-size:13px;">ข้อความทั้งหมดที่อ่านได้ (แตะเพื่อเลือก แล้วส่งไปช่องที่ต้องการ)</div>
        <div style="margin-top:6px;">${lines}</div>
        <div class="ocr-row" style="margin-top:6px;">
          <input data-pick style="flex:1; min-width:160px; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px;" placeholder="ข้อความที่เลือก (แก้ไขได้)">
          <select data-target style="padding:8px; border:1px solid #cbd5e1; border-radius:8px;">${targets.map(t => `<option value="${t}">${FIELD_LABELS[t]}</option>`).join('')}</select>
          <button type="button" class="ocr-btn sec" data-act="send">ส่งไปช่อง</button>
        </div>` : '<div class="ocr-note" style="margin-top:10px;">ไม่พบข้อความ — ลองถ่ายใหม่ให้ใกล้ขึ้น แสงสว่างพอ และไม่เงาสะท้อน</div>'}
        ${typeof cfg.addPhoto === 'function' ? `<label style="display:flex; gap:8px; align-items:center; margin-top:12px; font-size:13px;"><input type="checkbox" data-savephoto checked> เก็บภาพนี้เป็นรูปมุม “ป้ายครุภัณฑ์/ซีเรียล” ของอุปกรณ์ด้วย</label>` : ''}
        <div class="ocr-row" style="margin-top:14px; justify-content:flex-end;">
          <button type="button" class="ocr-btn sec" data-act="fillall" title="เติมเฉพาะช่องที่ยังว่าง ไม่ทับที่พิมพ์ไว้">เติมทั้งหมดที่ยังว่าง</button>
          <button type="button" class="ocr-btn" data-act="done">เสร็จสิ้น</button>
        </div>`;
    }

    async function run(file) {
      if (S.busy) return;
      S.busy = true;
      try {
        setStatus('กำลังเปิดภาพ…'); setProgress(0.02);
        const { img, url } = await readFileToImage(file);
        S.canvas = OCR.prepareCanvas(img, 1800);
        S.dataUrl = (function () { // เก็บเป็นรูปมุม: ย่อให้เล็กลงและเป็นสี (ภาพเดิม)
          const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          return c.toDataURL('image/jpeg', 0.7);
        })();
        const prev = q('.ocr-prev'); prev.src = url; prev.style.display = 'block';
        q('.ocr-result').innerHTML = '';
        setStatus('กำลังเตรียมตัวอ่านตัวอักษร… (ครั้งแรกอาจใช้เวลาสักครู่)');
        const mode = (ov.querySelector('input[name="ocr_mode"]:checked') || {}).value || 'en';
        const res = await OCR.recognize(S.canvas, mode, (status, prog) => {
          if (/recogniz/i.test(status)) setStatus('กำลังอ่านข้อความ… ' + Math.round(prog * 100) + '%');
          else setStatus('กำลังเตรียมตัวอ่านตัวอักษร… (ครั้งแรกอาจใช้เวลาสักครู่)');
          setProgress(Math.max(0.05, prog));
        });
        setProgress(null);
        S.parsed = OCR.parse(res.text);
        const found = [S.parsed.tag, S.parsed.serial, S.parsed.model, S.parsed.brand].filter(Boolean).length;
        setStatus(found ? 'อ่านได้ ' + found + ' รายการ — ตรวจสอบความถูกต้องก่อนใช้' : 'อ่านข้อความได้ แต่ยังจับค่าเลขครุภัณฑ์/ซีเรียลไม่ได้ — แตะข้อความด้านล่างเพื่อเลือกเอง');
        renderResult();
        // เติมอัตโนมัติเฉพาะช่องที่ยังว่าง และค่าที่ "มั่นใจพอ" (เลขครุภัณฑ์/ซีเรียลที่มีคำนำหน้า/ยี่ห้อที่รู้จัก)
        const auto = ['tag', 'serial', 'brand', 'model'].filter(t => targets.includes(t)).map(t => applyField(t, S.parsed[t], false)).filter(Boolean).length;
        if (auto) setStatus('เติมให้อัตโนมัติ ' + auto + ' ช่อง (ไฮไลต์สีเหลือง — โปรดตรวจสอบ) · แก้ค่าด้านล่างแล้วกด “ใช้ค่านี้” เพื่อเปลี่ยน');
      } catch (err) {
        setProgress(null);
        setStatus('');
        toast('อ่านข้อความไม่สำเร็จ: ' + err.message, 'error');
      } finally {
        S.busy = false;
      }
    }

    ov.addEventListener('change', (ev) => {
      const inp = ev.target;
      if (inp && inp.matches && inp.matches('input[type=file]')) {
        const f = inp.files && inp.files[0];
        inp.value = '';
        if (f) run(f);
      }
    });
    ov.addEventListener('click', (ev) => {
      const el = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (ev.target === ov) { close(); return; }
      if (!el) return;
      const act = el.getAttribute('data-act');
      const field = el.getAttribute('data-field');
      if (act === 'close' || act === 'done') {
        if (act === 'done' && S.parsed && typeof cfg.addPhoto === 'function') {
          const cb = ov.querySelector('[data-savephoto]');
          if (cb && cb.checked && S.dataUrl) {
            const ok = cfg.addPhoto(S.dataUrl, targets.includes('tag') && S.parsed.tag ? 'ป้ายครุภัณฑ์' : 'ซีเรียล/รุ่น');
            if (!ok) toast('แนบรูปครบจำนวนสูงสุดแล้ว — ไม่ได้เก็บภาพนี้', 'warning');
          }
        }
        if (typeof cfg.onApplied === 'function') cfg.onApplied();
        close();
      } else if (act === 'cam') q('input[data-in="cam"]').click();
      else if (act === 'pick') q('input[data-in="pick"]').click();
      else if (act === 'use') {
        const val = q('.ocr-field[data-field="' + field + '"] input').value;
        const el0 = document.getElementById(fields[field]);
        if (el0 && String(el0.value || '').trim() && String(el0.value).trim() !== val.trim() && !confirm('ช่อง “' + FIELD_LABELS[field] + '” มีค่าอยู่แล้ว (' + el0.value + ')\nต้องการแทนที่ด้วย “' + val + '” หรือไม่?')) return;
        if (applyField(field, val, true)) toast('เติม' + FIELD_LABELS[field] + ' แล้ว', 'success');
        if (typeof cfg.onApplied === 'function') cfg.onApplied();
      } else if (act === 'alt') {
        const row = q('.ocr-field[data-field="' + field + '"] input');
        if (row) row.value = el.getAttribute('data-v');
      } else if (act === 'line') {
        const pk = q('[data-pick]');
        if (pk) pk.value = el.getAttribute('data-v');
        ov.querySelectorAll('.ocr-chip.on').forEach(c => c.classList.remove('on'));
        el.classList.add('on');
      } else if (act === 'send') {
        const pk = q('[data-pick]'), tg = q('[data-target]');
        if (pk && tg && applyField(tg.value, pk.value, true)) {
          toast('เติม' + FIELD_LABELS[tg.value] + ' แล้ว', 'success');
          if (typeof cfg.onApplied === 'function') cfg.onApplied();
        }
      } else if (act === 'fillall') {
        let n = 0;
        ['tag', 'serial', 'brand', 'model'].forEach(t => { if (targets.includes(t) && S.parsed) { const v = (q('.ocr-field[data-field="' + t + '"] input') || {}).value; if (applyField(t, v, false)) n++; } });
        toast(n ? 'เติมให้ ' + n + ' ช่อง' : 'ไม่มีช่องว่างให้เติม (ช่องที่มีค่าอยู่แล้วจะไม่ถูกทับ)', n ? 'success' : 'warning');
        if (typeof cfg.onApplied === 'function') cfg.onApplied();
      }
    });
    return ov;
  };
})();
