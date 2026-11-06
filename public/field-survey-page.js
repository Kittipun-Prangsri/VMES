/* ============================================================================
 * โหมดสำรวจภาคสนาม (แยกออกจาก index.html)
 *
 * เดินตรวจแต่ละห้อง บันทึกเครื่องที่พบ ผูกจอ/คีย์บอร์ด/เมาส์เข้ากับเครื่องหลัก และผูกเลขครุภัณฑ์ทีหลังได้
 * โหลดเป็น <script src> ปกติ แชร์ global กับสคริปต์หลัก (อ้างถึงเฉพาะตอนเรียกใช้):
 *   DATA, CURRENT_USER, $, esc, jsArg, fmt, toast, openModal, closeModal, callApi, ADMIN_PASS,
 *   showLoading, refreshData, canManageEquipment, navigate, storageGet, storageSet
 *   และจาก equipment-page.js: eq* (หมวดหมู่ตามรหัส, สถานที่, หน่วยงาน, แกลเลอรีรูป)
 *
 * ปรับปรุง: ร่างฟอร์มอัตโนมัติ (ปิดแท็บ/รีเฟรชไม่หาย) · รอบสำรวจวันนี้คงอยู่ · แสดงของที่มีในห้องนั้นอยู่แล้ว
 * · เช็กเลขครุภัณฑ์ซ้ำสด + เลือกหมวดจาก 4 หลักแรก · สภาพเครื่อง (ปกติ/ชำรุด) · คงยี่ห้อ/รุ่นสำหรับเครื่องถัดไป
 * · รูปหลายรูปแบบกรอบรูป · รายการรอผูกเลขมีค้นหา/กรองห้อง/ดูเพิ่ม
 * ========================================================================== */

const PERIPHERAL_TYPES = ['จอภาพ', 'คีย์บอร์ด', 'เมาส์', 'เครื่องสำรองไฟ (UPS)', 'ลำโพง', 'เครื่องพิมพ์', 'อื่นๆ'];
const FS_STORE_KEY = 'vmes_fs_state';
const FS_DRAFT_KEY = 'vmes_fs_draft';
const FS_DRAFT_FIELDS = ['fs_room', 'fs_type', 'fs_name', 'fs_brand', 'fs_model', 'fs_sn', 'fs_code', 'fs_note', 'fs_cond', 'fs_resp', 'fs_dept'];
const FS_PENDING_STEP = 15;

let FIELD_SURVEY_STATE = { room: '', category: '', items: [], keepModel: false };
const FS_PENDING = { text: '', room: '', limit: FS_PENDING_STEP };
let FS_BUSY = false;

// ------------------------------------------------------------------ ฟังก์ชันล้วน (ทดสอบแยกได้)
function fsNorm(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function fsSame(a, b) { const x = fsNorm(a).toLowerCase(); return !!x && x === fsNorm(b).toLowerCase(); }

// เลขครุภัณฑ์ซ้ำกับชิ้นอื่นหรือไม่ (exceptId = รหัสของชิ้นที่กำลังแก้ ไม่นับตัวเอง)
function fsFindDuplicate(equipment, tag, exceptId) {
  const t = fsNorm(tag).toLowerCase();
  if (!t) return null;
  return (equipment || []).find(e => fsNorm(e['รหัสครุภัณฑ์']).toLowerCase() === t && String(e['รหัส']) !== String(exceptId || '')) || null;
}
function fsRoomItems(equipment, room) {
  if (!fsNorm(room)) return [];
  return (equipment || []).filter(e => fsSame(e['ที่เก็บ'], room));
}
function fsFilterPending(list, text, room) {
  const words = fsNorm(text).toLowerCase().split(' ').filter(Boolean);
  return (list || []).filter(e => {
    if (room && !fsSame(e['ที่เก็บ'], room)) return false;
    if (!words.length) return true;
    const hay = [e['ชื่ออุปกรณ์'], e['ที่เก็บ'], e['ยี่ห้อ'], e['รุ่น'], e['Serial'], e['ผู้สำรวจ']].map(v => String(v ?? '')).join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

// ------------------------------------------------------------------ สถานะที่เก็บไว้ในเครื่อง (รอบวันนี้ + ร่างฟอร์ม)
function fsToday() { return new Date().toLocaleDateString('en-CA'); }
function fsSurveyorName() { return (CURRENT_USER && (CURRENT_USER.name || CURRENT_USER.username)) || 'ไม่ระบุ'; }

function fsLoadState() {
  try {
    const s = JSON.parse(storageGet(FS_STORE_KEY) || 'null');
    if (!s) return;
    FIELD_SURVEY_STATE.room = s.room || '';
    FIELD_SURVEY_STATE.category = s.category || '';
    FIELD_SURVEY_STATE.keepModel = !!s.keepModel;
    // "รอบนี้" = ของวันนี้เท่านั้น (วันใหม่เริ่มรายการใหม่)
    FIELD_SURVEY_STATE.items = s.date === fsToday() && Array.isArray(s.items) ? s.items : [];
  } catch (e) { /* ข้อมูลในเครื่องเสีย = เริ่มใหม่ */ }
}
function fsSaveState() {
  storageSet(FS_STORE_KEY, JSON.stringify({
    date: fsToday(), room: FIELD_SURVEY_STATE.room, category: FIELD_SURVEY_STATE.category,
    keepModel: FIELD_SURVEY_STATE.keepModel, items: FIELD_SURVEY_STATE.items.slice(-100),
  }));
}
function fsDraft() { try { return JSON.parse(storageGet(FS_DRAFT_KEY) || '{}') || {}; } catch (e) { return {}; } }
function fsDraftClear() { storageSet(FS_DRAFT_KEY, '{}'); }
let _fsDraftTimer = null;
function fsDraftSave() {
  clearTimeout(_fsDraftTimer);
  _fsDraftTimer = setTimeout(() => {
    const d = {};
    FS_DRAFT_FIELDS.forEach(id => { const el = document.getElementById(id); if (el) d[id] = el.value; });
    const tag = document.querySelector('input[name="fs_tag"]:checked');
    if (tag) d.fs_tag = tag.value;
    storageSet(FS_DRAFT_KEY, JSON.stringify(d));
  }, 300);
}

// ------------------------------------------------------------------ ส่วนประกอบหน้าจอ
function fsRoomPanelHtml(room) {
  const r = fsNorm(room);
  if (!r) return '<div style="font-size:12px; color:#94a3b8; margin-top:4px;">เลือกหรือพิมพ์ห้อง เพื่อดูว่าห้องนี้มีอะไรในระบบแล้วบ้าง (กันบันทึกซ้ำ)</div>';
  const items = fsRoomItems(DATA.equipment, r);
  if (!items.length) return `<div style="font-size:12px; color:#0f766e; margin-top:4px;">🆕 ยังไม่มีครุภัณฑ์ในระบบสำหรับ “${esc(r)}” — ห้องนี้จะถูกเพิ่มเป็นสถานที่ใหม่เมื่อบันทึก</div>`;
  const shown = items.slice(0, 12);
  return `<details style="margin-top:6px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:10px; padding:8px 12px;">
    <summary style="cursor:pointer; font-size:13px; font-weight:600; color:#0369a1;">📍 ห้องนี้มีในระบบแล้ว ${fmt(items.length)} รายการ (กดดู — ตรวจก่อนบันทึกเพื่อไม่ให้ซ้ำ)</summary>
    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
      ${shown.map(e => `<span title="${esc(e['ชื่ออุปกรณ์'])}" style="font-size:11px; background:#fff; border:1px solid #cbd5e1; border-radius:10px; padding:2px 8px;">
        ${esc(e['ชื่ออุปกรณ์'])} <b style="color:${e['รหัสครุภัณฑ์'] ? '#0f766e' : '#b45309'};">${esc(e['รหัสครุภัณฑ์'] || 'ไม่มีป้าย')}</b></span>`).join('')}
      ${items.length > shown.length ? `<span style="font-size:11px; color:#64748b; padding:2px 4px;">… และอีก ${items.length - shown.length} รายการ</span>` : ''}
    </div>
    <a href="javascript:void(0)" onclick="fsOpenRoomInInventory(${jsArg(r)})" style="display:inline-block; margin-top:8px; font-size:12px; color:#0891b2;">ดูทั้งหมดในคลัง ›</a>
  </details>`;
}
function fsOpenRoomInInventory(room) {
  window.EQUIPMENT_FILTER_STATE = Object.assign({}, EQ_STATE_DEFAULT, { collapsed: {}, loc: fsNorm(room) });
  navigate('equipment');
}

function fsPendingHtml() {
  const all = (DATA.equipment || []).filter(e => e['สถานะป้ายครุภัณฑ์'] === 'ไม่มีป้าย');
  const rooms = Array.from(new Set(all.map(e => fsNorm(e['ที่เก็บ'])).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'th'));
  const list = fsFilterPending(all, FS_PENDING.text, FS_PENDING.room);
  const shown = list.slice(0, FS_PENDING.limit);
  return `
    <div id="fs_pending">
      <div style="font-weight:700; font-size:14px; color:#0f172a; margin-bottom:10px;">📋 รอผูกเลขครุภัณฑ์ทั้งระบบ (${fmt(all.length)})</div>
      ${all.length > 5 ? `<div style="display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
        <input placeholder="🔍 ค้นหาชื่อ/ห้อง/ผู้สำรวจ" value="${esc(FS_PENDING.text)}" oninput="fsPendingFilter({text: this.value})" style="flex:1; min-width:140px; padding:8px 12px; border-radius:10px; border:1px solid #cbd5e1; box-sizing:border-box;">
        <select onchange="fsPendingFilter({room: this.value})" style="max-width:170px; padding:8px 10px; border-radius:10px; border:1px solid #cbd5e1;">
          <option value="">ทุกห้อง (${rooms.length})</option>
          ${rooms.map(r => `<option value="${esc(r)}" ${fsSame(FS_PENDING.room, r) ? 'selected' : ''}>${esc(r)}</option>`).join('')}
        </select></div>` : ''}
      ${shown.map(e => `
        <div style="border:1px solid #fde68a; background:#fffbeb; border-radius:10px; padding:10px 14px; margin-bottom:8px;">
          <div style="font-weight:700; font-size:13px; color:#0f172a;">${esc(e['ชื่ออุปกรณ์'])}</div>
          <div style="font-size:12px; color:#64748b; margin:2px 0 8px;">📍 ${esc(e['ที่เก็บ'] || '-')} ${e['เชื่อมกับ'] ? '· 🔗 อุปกรณ์เชื่อมต่อ' : ''} · โดย ${esc(e['ผู้สำรวจ'] || '-')}</div>
          <button class="btn btn-sm btn-primary" style="width:100%;" onclick="fsResolveTag(${jsArg(e['รหัส'])}, ${jsArg(e['ชื่ออุปกรณ์'])})">🏷️ ผูกเลขครุภัณฑ์ที่ตรวจสอบได้</button>
        </div>`).join('')
        || `<div style="text-align:center; padding:30px 10px; color:#94a3b8; font-size:13px;">${all.length ? 'ไม่พบรายการตามเงื่อนไขที่กรอง' : '🎉 ไม่มีรายการค้าง — ครุภัณฑ์ที่สำรวจแล้วมีป้ายครบ'}</div>`}
      ${list.length > shown.length ? `<button class="btn btn-sm btn-secondary" style="width:100%;" onclick="fsPendingMore()">แสดงเพิ่ม (อีก ${fmt(list.length - shown.length)} รายการ)</button>` : ''}
    </div>`;
}
function fsPendingRepaint() {
  const cur = document.getElementById('fs_pending');
  if (!cur) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = fsPendingHtml();
  cur.replaceWith(tmp.firstElementChild);
}
function fsPendingFilter(patch) { Object.assign(FS_PENDING, patch, { limit: FS_PENDING_STEP }); fsPendingRepaint(); }
function fsPendingMore() { FS_PENDING.limit += FS_PENDING_STEP; fsPendingRepaint(); }

function fsCatOptions(selected) {
  const cats = eqCats().slice().sort(eqCatCompare);
  return cats.map(c => `<option value="${esc(c['ชื่อหมวด'])}" ${fsSame(c['ชื่อหมวด'], selected) ? 'selected' : ''}>${esc(eqCatLabel(c['ชื่อหมวด']))}</option>`).join('');
}

// ------------------------------------------------------------------ หน้าหลัก
function renderFieldSurvey() {
  if (!canManageEquipment()) {
    $('content').innerHTML = `
      <div class="card"><div class="card-body" style="text-align:center; padding:60px 20px;">
        <div style="font-size:48px; opacity:0.3; margin-bottom:12px;">🔒</div>
        <div style="font-size:15px; font-weight:700; color:#64748b;">โหมดสำรวจภาคสนามใช้ได้เฉพาะผู้ดูแลระบบ/ผู้จัดการ</div>
      </div></div>`;
    return;
  }
  if (!FIELD_SURVEY_STATE._loaded) { fsLoadState(); FIELD_SURVEY_STATE._loaded = true; }

  const draft = fsDraft();
  const dv = (k) => esc(draft[k] ?? '');
  const today = fsToday();
  const me = fsSurveyorName();
  const fieldItems = DATA.equipment.filter(e => e['บันทึกจากการสำรวจภาคสนาม']);
  const todayItems = fieldItems.filter(e => (e['วันที่บันทึก'] || '').slice(0, 10) === today);
  const pendingCount = DATA.equipment.filter(e => e['สถานะป้ายครุภัณฑ์'] === 'ไม่มีป้าย').length;
  const roomsSurveyed = new Set(fieldItems.map(e => fsNorm(e['ที่เก็บ']).toLowerCase()).filter(Boolean)).size;
  const rooms = eqAllLocations().map(l => l.name);
  const defaultCat = draft.fs_type || FIELD_SURVEY_STATE.category
    || ((eqCats().find(c => (c['ชื่อหมวด'] || '').includes('คอมพิวเตอร์')) || eqCats()[0] || {})['ชื่อหมวด'] || '');
  const hasTagDraft = draft.fs_tag === 'yes';
  const room0 = draft.fs_room ?? FIELD_SURVEY_STATE.room;
  const keepModel = FIELD_SURVEY_STATE.keepModel;
  eqPhotoInit({});

  $('content').innerHTML = `
    <div style="background:linear-gradient(135deg,#0e7490 0%,#0891b2 55%,#06b6d4 100%); border-radius:20px; padding:20px 24px; margin-bottom:20px; box-shadow:0 8px 32px rgba(8,145,178,0.25); position:relative; overflow:hidden; color:#fff;">
      <div style="position:absolute; width:220px; height:220px; border-radius:50%; background:rgba(255,255,255,0.06); top:-70px; right:-50px; pointer-events:none;"></div>
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="background:rgba(255,255,255,0.18); border-radius:14px; width:52px; height:52px; display:flex; align-items:center; justify-content:center; font-size:26px; flex-shrink:0;">🔎</div>
        <div>
          <div style="font-size:20px; font-weight:700; line-height:1.2;">โหมดสำรวจภาคสนาม</div>
          <div style="color:rgba(255,255,255,0.85); font-size:13px; margin-top:4px;">เดินตรวจแต่ละห้อง บันทึกเครื่องที่พบทันที แล้วผูกจอ/คีย์บอร์ด/เมาส์เข้ากับเครื่องหลัก — ถ้าไม่เห็นป้ายครุภัณฑ์ ให้บันทึกไว้ก่อนแล้วค่อยผูกเลขทีหลัง · ข้อมูลที่กรอกค้างไว้จะถูกเก็บเป็นร่างอัตโนมัติ</div>
        </div>
      </div>
    </div>

    <div class="stat-grid" style="margin-bottom:20px;">
      <div class="stat s-blue"><div class="icon-big">📅</div><div class="label">สำรวจวันนี้</div><div class="value">${todayItems.length} <span style="font-size:14px;color:var(--gray-500)">รายการ</span></div><div class="sub">โดยฉัน ${todayItems.filter(e => e['ผู้สำรวจ'] === me).length} · ${esc(me)}</div></div>
      <div class="stat s-green"><div class="icon-big">🏠</div><div class="label">ห้อง/จุดที่สำรวจแล้ว</div><div class="value">${roomsSurveyed}</div><div class="sub">สะสมทั้งหมด</div></div>
      <div class="stat s-purple"><div class="icon-big">📦</div><div class="label">บันทึกจากการสำรวจสะสม</div><div class="value">${fieldItems.length}</div><div class="sub">รวมทุกรอบ</div></div>
      <div class="stat s-red"><div class="icon-big">⚠️</div><div class="label">รอผูกเลขครุภัณฑ์</div><div class="value">${pendingCount}</div><div class="sub">ยังไม่เห็นป้ายตอนสำรวจ</div></div>
    </div>

    <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:flex-start;">
      <div style="flex:1.2; min-width:340px; display:flex; flex-direction:column; gap:20px;">
        <div class="card">
          <div class="card-body">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; gap:8px; flex-wrap:wrap;">
              <div style="font-weight:700; font-size:15px; color:#0f172a;">➕ บันทึกเครื่องที่พบ</div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button type="button" class="btn btn-sm btn-info" onclick="fsOpenOcr()" title="ถ่ายป้ายครุภัณฑ์/ซีเรียลบนเครื่อง ระบบอ่านตัวอักษรแล้วเติมให้ — ไม่ต้องพิมพ์">📷 ถ่ายป้ายเพื่อเติมข้อมูล</button>
                ${Object.keys(draft).length ? `<button class="btn btn-sm btn-secondary" onclick="fsDiscardDraft()" title="ล้างข้อมูลที่กรอกค้างไว้">🧹 ล้างฟอร์ม</button>` : ''}
              </div>
            </div>
            <div class="form-grid" id="fs_form" oninput="fsDraftSave()" onchange="fsDraftSave()">
              <div class="field full">
                <label>ห้อง/จุดติดตั้ง *</label>
                <input id="fs_room" list="fsRoomList" autocomplete="off" value="${esc(room0)}" placeholder="เช่น ห้องการเงิน ชั้น 2 ตึกผู้ป่วยนอก" oninput="fsRoomChanged()" onchange="fsRoomChanged()">
                <datalist id="fsRoomList">${rooms.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
                <div id="fs_room_panel">${fsRoomPanelHtml(room0)}</div>
              </div>
              <div class="field">
                <label>ประเภทอุปกรณ์ (หมวดหมู่)</label>
                <select id="fs_type">${fsCatOptions(defaultCat)}</select>
              </div>
              <div class="field"><label>ชื่ออุปกรณ์ *</label><input id="fs_name" autocomplete="off" value="${dv('fs_name')}" placeholder="เช่น คอมพิวเตอร์ตั้งโต๊ะ"></div>
              <div class="field"><label>ยี่ห้อ</label><input id="fs_brand" list="eq_dl_brand" autocomplete="off" value="${dv('fs_brand')}"></div>
              <div class="field"><label>รุ่น</label><input id="fs_model" autocomplete="off" value="${dv('fs_model')}"></div>
              <div class="field"><label>Serial Number</label><input id="fs_sn" autocomplete="off" value="${dv('fs_sn')}"></div>
              <div class="field">
                <label>สภาพเครื่อง</label>
                <select id="fs_cond">
                  <option value="ok" ${draft.fs_cond !== 'bad' ? 'selected' : ''}>✅ ใช้งานได้ปกติ</option>
                  <option value="bad" ${draft.fs_cond === 'bad' ? 'selected' : ''}>🔴 ชำรุด / ใช้งานไม่ได้</option>
                </select>
              </div>
              <div class="field full">
                <label>ป้ายครุภัณฑ์</label>
                <div style="display:flex; gap:16px; align-items:center; margin-top:6px; flex-wrap:wrap;">
                  <label style="display:flex; align-items:center; gap:6px; font-weight:500; font-size:13px; cursor:pointer;">
                    <input type="radio" name="fs_tag" value="yes" ${hasTagDraft ? 'checked' : ''} onchange="fsToggleTag(true)"> มีป้าย เห็นเลขครุภัณฑ์
                  </label>
                  <label style="display:flex; align-items:center; gap:6px; font-weight:500; font-size:13px; cursor:pointer;">
                    <input type="radio" name="fs_tag" value="no" ${hasTagDraft ? '' : 'checked'} onchange="fsToggleTag(false)"> ไม่มีป้าย / หาไม่พบ
                  </label>
                </div>
                <input id="fs_code" autocomplete="off" value="${dv('fs_code')}" placeholder="กรอกเลขครุภัณฑ์ที่เห็นบนป้าย (เช่น 7440-14-0001/31)" oninput="fsCodeInput()" style="margin-top:8px; ${hasTagDraft ? '' : 'display:none;'}">
                <div id="fs_code_hint" style="font-size:12px; margin-top:4px; min-height:16px;"></div>
              </div>
              <details class="field full" ${(draft.fs_resp || draft.fs_dept) ? 'open' : ''} style="margin-top:2px;">
                <summary style="cursor:pointer; font-size:13px; color:#0f766e; font-weight:600;">➕ ผู้รับผิดชอบ / หน่วยงาน (ไม่บังคับ)</summary>
                <div class="form-grid" style="margin-top:10px;">
                  <div class="field"><label>หน่วยงานที่รับผิดชอบ</label>${eqDeptInputHtml('fs_dept', draft.fs_dept || '', 'fsRefreshStaff()', 'พิมพ์เพื่อค้นหา หรือเว้นว่าง')}</div>
                  <div class="field"><label>ผู้รับผิดชอบ</label>
                    <input id="fs_resp" list="fs_staff_list" autocomplete="off" value="${dv('fs_resp')}" placeholder="พิมพ์ชื่อเพื่อค้นหา...">
                    <datalist id="fs_staff_list">${typeof hoStaffOptions === 'function' ? hoStaffOptions(draft.fs_dept || '') : ''}</datalist>
                  </div>
                </div>
              </details>
              <div class="field full">
                <label>รูปถ่าย (ได้สูงสุด ${EQ_PHOTO_MAX} รูป)</label>
                <div id="e_gallery">${eqGalleryHtml()}</div>
              </div>
              <div class="field full"><label>หมายเหตุ</label><input id="fs_note" autocomplete="off" value="${dv('fs_note')}" placeholder="เช่น เครื่องอยู่มุมห้อง ใกล้หน้าต่าง"></div>
            </div>
            <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:13px; cursor:pointer; color:#475569;">
              <input type="checkbox" id="fs_keep" ${keepModel ? 'checked' : ''} onchange="fsKeepChanged()"> คงยี่ห้อ / รุ่น / ประเภท ไว้สำหรับเครื่องถัดไป (เหมาะกับเครื่องรุ่นเดียวกันหลายเครื่อง)
            </label>
            <button class="btn btn-primary btn-block" id="fs_save_btn" style="margin-top:14px; font-weight:700;" onclick="fsSaveDevice()">💾 บันทึกเครื่องนี้ แล้วสำรวจเครื่องถัดไป</button>
          </div>
        </div>

        ${FIELD_SURVEY_STATE.items.length ? `
        <div class="card">
          <div class="card-body">
            <div style="font-weight:700; font-size:14px; color:#0f172a; margin-bottom:10px;">📝 บันทึกแล้วในรอบนี้ (${FIELD_SURVEY_STATE.items.length} รายการ · เก็บไว้ในเครื่องนี้ถึงสิ้นวัน)</div>
            ${FIELD_SURVEY_STATE.items.slice().reverse().map(it => {
              const children = DATA.equipment.filter(c => c['เชื่อมกับ'] && String(c['เชื่อมกับ']) === String(it.code));
              const full = DATA.equipment.find(x => String(x['รหัส']) === String(it.code));
              return `
              <div style="border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                  <div style="display:flex; align-items:center;">
                    ${full ? eqPhotoCell(full) : ''}
                    <div>
                      <div style="font-weight:700; font-size:13px; color:#0f172a;">💻 ${esc(it.name)}</div>
                      <div style="font-size:12px; color:#64748b;">📍 ${esc(it.room)} ${it.hasTag ? '' : '<span style="color:#b45309; font-weight:600;">⚠️ ยังไม่มีป้าย</span>'}</div>
                    </div>
                  </div>
                  <button class="btn btn-sm btn-secondary" onclick="fsAddPeripheral(${jsArg(it.code)}, ${jsArg(it.name)})">🔌 + เพิ่มอุปกรณ์เชื่อมต่อ</button>
                </div>
                ${children.length ? `<div style="margin-top:8px; padding-top:8px; border-top:1px dashed #e2e8f0; display:flex; flex-wrap:wrap; gap:6px;">
                  ${children.map(c => `<span style="font-size:11px; background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; padding:2px 8px; border-radius:10px;">${esc(c['ชื่ออุปกรณ์'])}</span>`).join('')}
                </div>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}
      </div>

      <div style="flex:1; min-width:320px;">
        <div class="card"><div class="card-body">${fsPendingHtml()}</div></div>
      </div>
    </div>
  `;
  fsCodeInput(true); // แสดงสถานะเลขครุภัณฑ์จากร่าง (ไม่เปลี่ยนหมวด)
}

// ------------------------------------------------------------------ ตัวจัดการเหตุการณ์
function fsToggleTag(hasTag) {
  const el = $('fs_code');
  if (el) { el.style.display = hasTag ? '' : 'none'; if (hasTag) el.focus(); }
  const hint = $('fs_code_hint');
  if (hint && !hasTag) hint.innerHTML = '';
  fsDraftSave();
}
function fsRoomChanged() {
  const el = $('fs_room_panel');
  if (el) el.innerHTML = fsRoomPanelHtml($('fs_room').value);
}
function fsRefreshStaff() {
  const dl = $('fs_staff_list');
  if (dl && typeof hoStaffOptions === 'function') dl.innerHTML = hoStaffOptions($('fs_dept') ? $('fs_dept').value : '');
}
function fsKeepChanged() {
  FIELD_SURVEY_STATE.keepModel = $('fs_keep').checked;
  fsSaveState();
}
// อ่านป้ายด้วยกล้อง (OCR) แล้วเติมเลขครุภัณฑ์/Serial/รุ่น/ยี่ห้อ — เติมเฉพาะช่องว่าง ไฮไลต์ให้ตรวจ
function fsOpenOcr() {
  ocrOpenScanner({
    fields: { tag: 'fs_code', serial: 'fs_sn', model: 'fs_model', brand: 'fs_brand', name: 'fs_name', note: 'fs_note' },
    onField: (f) => {
      if (f !== 'tag') return;
      const yes = document.querySelector('input[name="fs_tag"][value="yes"]');
      if (yes) yes.checked = true;
      const code = $('fs_code'); if (code) code.style.display = '';
    },
    onApplied: () => { fsCodeInput(); fsDraftSave(); },
    addPhoto: (dataUrl, label) => eqPhotoAddDataUrl(dataUrl, label),
  });
}
function fsDiscardDraft() {
  if (!confirm('ล้างข้อมูลที่กรอกค้างไว้ในฟอร์มนี้ทั้งหมด?')) return;
  fsDraftClear();
  renderFieldSurvey();
}
// เลขครุภัณฑ์: เช็กซ้ำสด + เลือกหมวดจาก 4 หลักแรก (quiet = วาดจากร่างตอนเปิดหน้า ไม่แตะหมวดที่เลือกไว้)
function fsCodeInput(quiet) {
  const hint = $('fs_code_hint'), codeEl = $('fs_code');
  if (!hint || !codeEl) return;
  const tag = fsNorm(codeEl.value);
  const visible = codeEl.style.display !== 'none';
  if (!visible || !tag) { hint.innerHTML = ''; return; }
  const dup = fsFindDuplicate(DATA.equipment, tag, '');
  if (dup) {
    hint.innerHTML = `<span style="color:#dc2626; font-weight:600;">⛔ เลขครุภัณฑ์นี้มีในระบบแล้ว: ${esc(dup['ชื่ออุปกรณ์'] || dup['รหัส'])}${dup['ที่เก็บ'] ? ' (📍 ' + esc(dup['ที่เก็บ']) + ')' : ''} — ตรวจสอบก่อนบันทึก</span>`;
    return;
  }
  const prefix = eqTagPrefix(tag);
  const c = prefix ? eqCatByCode(prefix) : null;
  if (c) {
    if (!quiet) { const sel = $('fs_type'); if (sel) sel.value = c['ชื่อหมวด']; fsDraftSave(); }
    hint.innerHTML = `<span style="color:#0f766e;">✓ รหัส ${esc(prefix)} = ${esc(c['ชื่อหมวด'])}</span>`;
  } else if (prefix) {
    hint.innerHTML = `<span style="color:#b45309;">ยังไม่มีหมวดสำหรับรหัส ${esc(prefix)} (สร้างได้ที่คลังอุปกรณ์ › 🗂️ จัดการหมวดหมู่)</span>`;
  } else hint.innerHTML = '';
}

async function fsSaveDevice() {
  if (FS_BUSY) return;
  const room = eqCanon('ที่เก็บ', $('fs_room').value);
  const type = $('fs_type') ? $('fs_type').value : '';
  const name = fsNorm($('fs_name').value);
  const brand = eqCanon('ยี่ห้อ', $('fs_brand').value);
  const model = fsNorm($('fs_model').value);
  const sn = fsNorm($('fs_sn').value);
  const hasTag = document.querySelector('input[name="fs_tag"]:checked').value === 'yes';
  const code = fsNorm($('fs_code').value);
  const note = ($('fs_note').value || '').trim();
  const bad = $('fs_cond').value === 'bad';

  if (!room) { toast('กรอกห้อง/จุดติดตั้งก่อน', 'warning'); return; }
  if (!name) { toast('กรอกชื่ออุปกรณ์', 'warning'); return; }
  if (hasTag && !code) { toast('กรอกเลขครุภัณฑ์ที่เห็นบนป้าย', 'warning'); return; }
  if (hasTag) {
    const dup = fsFindDuplicate(DATA.equipment, code, '');
    if (dup) { toast('เลขครุภัณฑ์ ' + code + ' มีในระบบแล้ว (' + (dup['ชื่ออุปกรณ์'] || dup['รหัส']) + ') — ไม่บันทึกซ้ำ', 'error'); return; }
  }
  if (!(await eqDeptEnsure('fs_dept'))) return;

  FIELD_SURVEY_STATE.room = room;
  FIELD_SURVEY_STATE.category = type;

  const data = {
    'รหัสครุภัณฑ์': hasTag ? code : '', 'ชื่ออุปกรณ์': name, 'หมวดหมู่': type,
    'ยี่ห้อ': brand, 'รุ่น': model, 'Serial': sn,
    'จำนวน': 1, 'หน่วยนับ': 'เครื่อง', 'ที่เก็บ': room,
    'มูลค่า': 0, 'สถานะ': bad ? 'ชำรุด' : 'ประจำจุด', 'หมายเหตุ': note,
    'สถานะป้ายครุภัณฑ์': hasTag ? 'มีป้าย' : 'ไม่มีป้าย',
    'บันทึกจากการสำรวจภาคสนาม': true,
    'ผู้สำรวจ': fsSurveyorName(),
    'รูปภาพทั้งหมด': [],
  };
  const dept = fsNorm($('fs_dept') ? $('fs_dept').value : '');
  const resp = fsNorm($('fs_resp') ? $('fs_resp').value : '');
  if (dept) data['หน่วยงานที่รับผิดชอบ'] = dept;
  if (resp) data['ผู้รับผิดชอบ'] = resp;

  FS_BUSY = true;
  const btn = $('fs_save_btn'); if (btn) btn.disabled = true;
  showLoading(true);
  try {
    const r = await callApi('saveEquipment', data, ADMIN_PASS);
    if (!r.success) { showLoading(false); toast(r.message, 'error'); return; }
    const failed = await eqPersistPhotos(r.code, EQ_PHOTO.items); // อัปโหลดรูปทั้งหมด (ต่อท้าย/จัดลำดับรูปหลัก)
    showLoading(false);
    toast(failed ? 'บันทึก "' + name + '" แล้ว แต่รูปอัปโหลดไม่สำเร็จ ' + failed + ' รูป' : 'บันทึกเครื่อง "' + name + '" แล้ว ✓', failed ? 'warning' : 'success');

    FIELD_SURVEY_STATE.items.push({ code: r.code, name, room, hasTag });
    // ใส่เครื่องที่เพิ่งบันทึกเข้า DATA ทันที (ห้องนี้/เช็กซ้ำจะเห็นเลย ไม่ต้องรอรอบโหลดข้อมูล)
    DATA.equipment.push(Object.assign({}, data, { 'รหัส': r.code, 'รูปภาพทั้งหมด': EQ_PHOTO.items.filter(i => i.url).map(i => i.url) }));
    fsSaveState();
    fsDraftClear();
    if (FIELD_SURVEY_STATE.keepModel) storageSet(FS_DRAFT_KEY, JSON.stringify({ fs_room: room, fs_type: type, fs_brand: brand, fs_model: model, fs_cond: 'ok', fs_tag: 'no', fs_dept: dept, fs_resp: resp }));
    renderFieldSurvey();
    const nameEl = $('fs_name'); if (nameEl) nameEl.focus();
    if (typeof refreshData === 'function') setTimeout(refreshData, 800); // ซิงก์ข้อมูลจริงเบื้องหลัง
  } catch (err) {
    showLoading(false);
    toast('ผิดพลาด: ' + err.message, 'error');
  } finally {
    FS_BUSY = false;
    const b = $('fs_save_btn'); if (b) b.disabled = false;
  }
}

// ---- อุปกรณ์เชื่อมต่อ (จอ/คีย์บอร์ด/เมาส์ ฯลฯ ผูกกับเครื่องหลัก) ----
function fpToggleTag(hasTag) {
  const el = $('fp_code');
  if (el) { el.style.display = hasTag ? '' : 'none'; if (hasTag) el.focus(); }
}

function fsAddPeripheral(parentCode, parentName) {
  const body = `
    <div class="form-grid">
      <div class="field"><label>ชนิดอุปกรณ์ *</label>
        <select id="fp_type">${PERIPHERAL_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>ยี่ห้อ</label><input id="fp_brand" list="eq_dl_brand" autocomplete="off"></div>
      <div class="field"><label>รุ่น</label><input id="fp_model" autocomplete="off"></div>
      <div class="field"><label>Serial Number</label><input id="fp_sn" autocomplete="off"></div>
      <div class="field full">
        <label>ป้ายครุภัณฑ์</label>
        <div style="display:flex; gap:16px; align-items:center; margin-top:6px; flex-wrap:wrap;">
          <label style="display:flex; align-items:center; gap:6px; font-weight:500; font-size:13px; cursor:pointer;">
            <input type="radio" name="fp_tag" value="yes" onchange="fpToggleTag(true)"> มีป้าย
          </label>
          <label style="display:flex; align-items:center; gap:6px; font-weight:500; font-size:13px; cursor:pointer;">
            <input type="radio" name="fp_tag" value="no" checked onchange="fpToggleTag(false)"> ไม่มีป้าย
          </label>
        </div>
        <input id="fp_code" autocomplete="off" placeholder="เลขครุภัณฑ์" style="margin-top:8px; display:none;">
      </div>
      <div class="field full"><label>รูปถ่าย</label><div id="e_gallery">${(eqPhotoInit({}), eqGalleryHtml())}</div></div>
      <datalist id="eq_dl_brand">${eqDistinct('ยี่ห้อ').map(v => `<option value="${esc(v)}">`).join('')}</datalist>
    </div>`;
  openModal('🔌 เพิ่มอุปกรณ์เชื่อมต่อกับ "' + esc(parentName) + '"', body, () => fsSavePeripheral(parentCode), false);
}

async function fsSavePeripheral(parentCode) {
  if (FS_BUSY) return;
  const type = $('fp_type').value;
  const brand = eqCanon('ยี่ห้อ', $('fp_brand').value);
  const model = fsNorm($('fp_model').value);
  const sn = fsNorm($('fp_sn').value);
  const hasTag = document.querySelector('input[name="fp_tag"]:checked').value === 'yes';
  const code = fsNorm($('fp_code').value);
  if (hasTag && !code) { toast('กรอกเลขครุภัณฑ์', 'warning'); return; }
  if (hasTag) {
    const dup = fsFindDuplicate(DATA.equipment, code, '');
    if (dup) { toast('เลขครุภัณฑ์ ' + code + ' มีในระบบแล้ว (' + (dup['ชื่ออุปกรณ์'] || dup['รหัส']) + ')', 'error'); return; }
  }

  const parent = DATA.equipment.find(x => String(x['รหัส']) === String(parentCode));
  const data = {
    'รหัสครุภัณฑ์': hasTag ? code : '', 'ชื่ออุปกรณ์': type, 'หมวดหมู่': (parent && parent['หมวดหมู่']) || FIELD_SURVEY_STATE.category || type,
    'ยี่ห้อ': brand, 'รุ่น': model, 'Serial': sn,
    'จำนวน': 1, 'หน่วยนับ': 'เครื่อง', 'ที่เก็บ': (parent && parent['ที่เก็บ']) || FIELD_SURVEY_STATE.room,
    'มูลค่า': 0, 'สถานะ': 'ประจำจุด',
    'สถานะป้ายครุภัณฑ์': hasTag ? 'มีป้าย' : 'ไม่มีป้าย',
    'บันทึกจากการสำรวจภาคสนาม': true,
    'เชื่อมกับ': parentCode,
    'ผู้สำรวจ': fsSurveyorName(),
    'รูปภาพทั้งหมด': [],
  };
  if (parent && parent['หน่วยงานที่รับผิดชอบ']) data['หน่วยงานที่รับผิดชอบ'] = parent['หน่วยงานที่รับผิดชอบ'];
  if (parent && parent['ผู้รับผิดชอบ']) data['ผู้รับผิดชอบ'] = parent['ผู้รับผิดชอบ'];

  FS_BUSY = true;
  showLoading(true);
  try {
    const r = await callApi('saveEquipment', data, ADMIN_PASS);
    if (!r.success) { showLoading(false); toast(r.message, 'error'); return; }
    const failed = await eqPersistPhotos(r.code, EQ_PHOTO.items);
    showLoading(false);
    toast(failed ? 'เพิ่มอุปกรณ์สำเร็จ แต่รูปอัปโหลดไม่สำเร็จ ' + failed + ' รูป' : 'เพิ่มอุปกรณ์เชื่อมต่อแล้ว ✓', failed ? 'warning' : 'success');
    DATA.equipment.push(Object.assign({}, data, { 'รหัส': r.code }));
    closeModal();
    renderFieldSurvey();
    if (typeof refreshData === 'function') setTimeout(refreshData, 800);
  } catch (err) {
    showLoading(false);
    toast('ผิดพลาด: ' + err.message, 'error');
  } finally {
    FS_BUSY = false;
  }
}

// ---- ผูกเลขครุภัณฑ์ทีหลัง (ส่งเฉพาะฟิลด์ที่เปลี่ยน — server รวมกับข้อมูลเดิมให้ ไม่ทำฟิลด์อื่นหาย) ----
function fsResolveTag(code, name) {
  const existing = DATA.equipment.find(x => String(x['รหัส']) === String(code));
  if (!existing) { toast('ไม่พบข้อมูลอุปกรณ์นี้แล้ว', 'error'); return; }
  openModal('🏷️ ผูกเลขครุภัณฑ์ให้ "' + esc(name) + '"', `
    <div class="field full">
      <label>เลขครุภัณฑ์ที่ตรวจสอบพบ *</label>
      <input id="fs_resolve_code" autocomplete="off" placeholder="กรอกเลขครุภัณฑ์ (เช่น 7440-14-0001/31)" oninput="fsResolveInput(${jsArg(code)})">
      <div id="fs_resolve_hint" style="font-size:12px; margin-top:6px; min-height:16px;"></div>
    </div>
  `, () => fsSaveResolve(code), false);
  setTimeout(() => { const el = $('fs_resolve_code'); if (el) el.focus(); }, 50);
}
function fsResolveInput(code) {
  const hint = $('fs_resolve_hint');
  if (!hint) return;
  const tag = fsNorm($('fs_resolve_code').value);
  if (!tag) { hint.innerHTML = ''; return; }
  const dup = fsFindDuplicate(DATA.equipment, tag, code);
  if (dup) { hint.innerHTML = `<span style="color:#dc2626; font-weight:600;">⛔ เลขนี้มีในระบบแล้ว: ${esc(dup['ชื่ออุปกรณ์'] || dup['รหัส'])}</span>`; return; }
  const existing = DATA.equipment.find(x => String(x['รหัส']) === String(code)) || {};
  const c = eqCatByCode(eqTagPrefix(tag));
  hint.innerHTML = c && !fsSame(c['ชื่อหมวด'], existing['หมวดหมู่'])
    ? `<span style="color:#0f766e;">✓ รหัส ${esc(eqTagPrefix(tag))} = ${esc(c['ชื่อหมวด'])} — จะย้ายหมวดให้อัตโนมัติ (เดิม: ${esc(existing['หมวดหมู่'] || 'ไม่ระบุ')})</span>`
    : '';
}
async function fsSaveResolve(code) {
  const existing = DATA.equipment.find(x => String(x['รหัส']) === String(code));
  if (!existing) { toast('ไม่พบข้อมูลอุปกรณ์นี้แล้ว', 'error'); return; }
  const newCode = fsNorm($('fs_resolve_code').value);
  if (!newCode) { toast('กรอกเลขครุภัณฑ์', 'warning'); return; }
  const dup = fsFindDuplicate(DATA.equipment, newCode, code);
  if (dup) { toast('เลขครุภัณฑ์ ' + newCode + ' มีในระบบแล้ว (' + (dup['ชื่ออุปกรณ์'] || dup['รหัส']) + ')', 'error'); return; }
  const patch = { 'รหัส': existing['รหัส'], 'รหัสครุภัณฑ์': newCode, 'สถานะป้ายครุภัณฑ์': 'มีป้าย' };
  const c = eqCatByCode(eqTagPrefix(newCode));
  if (c && !fsSame(c['ชื่อหมวด'], existing['หมวดหมู่'])) patch['หมวดหมู่'] = c['ชื่อหมวด'];
  showLoading(true);
  try {
    const r = await callApi('saveEquipment', patch, ADMIN_PASS);
    showLoading(false);
    if (!r.success) { toast(r.message, 'error'); return; }
    Object.assign(existing, patch);
    toast('ผูกเลขครุภัณฑ์สำเร็จ ✓' + (patch['หมวดหมู่'] ? ' · ย้ายหมวดเป็น ' + patch['หมวดหมู่'] : ''));
    closeModal();
    renderFieldSurvey();
    if (typeof refreshData === 'function') setTimeout(refreshData, 800);
  } catch (err) { showLoading(false); toast('ผิดพลาด: ' + err.message, 'error'); }
}

if (typeof window !== 'undefined') {
  Object.assign(window, {
    fsOpenOcr, fsToggleTag, fsRoomChanged, fsRefreshStaff, fsKeepChanged, fsDiscardDraft, fsCodeInput, fsSaveDevice, fsDraftSave,
    fpToggleTag, fsAddPeripheral, fsResolveTag, fsResolveInput, fsPendingFilter, fsPendingMore, fsOpenRoomInInventory,
  });
}
if (typeof module === 'object' && module.exports) {
  module.exports = { fsFindDuplicate, fsRoomItems, fsFilterPending, fsNorm };
}
