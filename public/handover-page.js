/* ============================================================================
 * หน้า "ใบส่งมอบ-รับคืนครุภัณฑ์" (แยกออกจาก index.html)
 * โหลดเป็น <script src> ปกติ แชร์ global กับสคริปต์หลัก (อ้างถึงเฉพาะตอนเรียกใช้):
 *   DATA, CURRENT_USER, $, esc, jsArg, fmt, money, toast, openModal, closeModal, callApi,
 *   ADMIN_PASS, showLoading, refreshData, isAdmin, canManageEquipment, requireAdmin, navigate,
 *   exportSheet และจาก equipment-page.js: eqPaginate, eqNorm, eqCatLabel, eqState
 * ========================================================================== */
// ============== EQUIPMENT HANDOVER (ใบส่งมอบ/รับคืนครุภัณฑ์) ==============
// เอกสารทางการสำหรับมอบครุภัณฑ์ให้หน่วยงาน/ผู้รับผิดชอบประจำ (ต่างจาก "ยืม" ระยะสั้น
// ในระบบ borrowing) ตามแบบฟอร์ม "ส่งมอบ/รับคืน ครุภัณฑ์" ที่ใช้งานจริง — เอกสารเดียว
// บันทึกได้ทั้งฝั่งส่งมอบและฝั่งรับคืน (กรอกฝั่งรับคืนเมื่อถึงเวลาจริง)
const HO_CHECK_LABELS = { scratch: 'รอยถลอก', crack: 'รอยแตก/หัก', notReady: 'เครื่องไม่พร้อมใช้งาน' };

// ตัวเลือกครุภัณฑ์แบบค้นหาได้ (แทน <select> ยาวๆ ที่เลื่อนหาไม่ไหว)
// ยังเก็บค่าไว้ใน input#ho_equipId (hidden) เหมือนเดิม โค้ดส่วนอื่นอ่านค่าจากตัวนี้
function hoEquipLabel(e) {
  return (e['รหัสครุภัณฑ์'] || e['รหัส'] || '') + ' — ' + (e['ชื่ออุปกรณ์'] || '');
}

function hoEquipPicker(h) {
  const cur = h.equipId ? hoFindEquip(h.equipId) : null;
  const text = cur ? hoEquipLabel(cur) : (h.equipId ? ((h['เลขครุภัณฑ์'] || '') + ' — ' + (h['รายการ'] || h.equipId)) : '');
  return `
  <div id="ho_picker" style="position:relative;">
    <input type="hidden" id="ho_equipId" value="${esc(h.equipId || '')}">
    <input id="ho_equipSearch" autocomplete="off" placeholder="🔍 พิมพ์เพื่อค้นหาครุภัณฑ์..." value="${esc(text)}"
      oninput="window._hoPickType()" onfocus="window._hoPickOpen()" onblur="window._hoPickBlur()" onkeydown="window._hoPickKey(event)"
      style="width:100%; padding-right:34px; box-sizing:border-box;">
    <button type="button" onclick="window._hoPickClear()" title="ล้าง" style="position:absolute; right:6px; top:6px; border:none; background:transparent; cursor:pointer; font-size:14px; color:#94a3b8;">✕</button>
    <div id="ho_pick_status" style="font-size:12px; margin-top:4px; min-height:16px; color:${h.equipId ? '#15803d' : '#64748b'};">${h.equipId ? '✓ เลือกครุภัณฑ์แล้ว' : 'ยังไม่ได้เลือก — พิมพ์ค้นหาแล้วคลิกรายการ (หรือใช้ลูกศร ↑↓ แล้วกด Enter)'}</div>
    <div id="ho_equipList" style="display:none; position:absolute; left:0; right:0; top:100%; z-index:50; max-height:280px; overflow:auto; background:#fff; border:1px solid #cbd5e1; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.15); margin-top:4px;"></div>
  </div>`;
}

const HO_PICK = { active: -1, shown: [], activeHo: new Map(), query: '' };

function hoPickRender(query) {
  const q = String(query || '').trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  const fields = ['รหัสครุภัณฑ์', 'รหัส', 'ชื่ออุปกรณ์', 'ยี่ห้อ', 'รุ่น', 'Serial', 'ที่เก็บ', 'หมวดหมู่'];
  const all = DATA.equipment.filter(e => !words.length || words.every(w => fields.some(f => String(e[f] ?? '').toLowerCase().includes(w))));
  const LIMIT = 50;
  HO_PICK.activeHo = hoActiveByEquip();
  HO_PICK.query = q;
  HO_PICK.shown = all.slice(0, LIMIT);
  HO_PICK.active = -1; // ไม่เลือกรายการแรกให้เอง — ต้องใช้ลูกศร/เมาส์ชี้จริง/คลิก จึงจะมีรายการที่ไฮไลต์
  const list = $('ho_equipList');
  if (!list) return;
  list.innerHTML = HO_PICK.shown.map((e, i) => `
    <div class="ho-opt" data-i="${i}" onmousedown="event.preventDefault(); window._hoPickChoose(${i})" onmousemove="window._hoPickHover(${i})"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9;">
      <div style="font-size:13px; font-weight:600; color:#0f172a;">${esc(e['รหัสครุภัณฑ์'] || e['รหัส'])} <span style="font-weight:500;">— ${esc(e['ชื่ออุปกรณ์'])}</span></div>
      <div style="font-size:11px; color:#64748b;">${esc([e['ยี่ห้อ'], e['รุ่น']].filter(Boolean).join(' '))}${e['Serial'] ? ' · S/N ' + esc(e['Serial']) : ''}${e['ที่เก็บ'] ? ' · 📍 ' + esc(e['ที่เก็บ']) : ''}</div>
      ${HO_PICK.activeHo.get(String(e['รหัส'])) ? `<div style="font-size:11px; color:#b45309; font-weight:600;">📋 ส่งมอบให้ ${esc(HO_PICK.activeHo.get(String(e['รหัส']))['ส่งมอบให้หน่วยงาน'] || '-')} แล้ว (ยังไม่รับคืน)</div>` : ''}
    </div>`).join('') + (all.length > LIMIT ? `<div style="padding:8px 12px; font-size:12px; color:#64748b; background:#f8fafc;">แสดง ${LIMIT} จาก ${all.length} รายการ — พิมพ์เพิ่มเพื่อกรองให้แคบลง</div>` : '')
    || `<div style="padding:12px; font-size:13px; color:#b45309;">ไม่พบครุภัณฑ์ที่ตรงกับ “${esc(String(query || '').trim())}” — ถ้ายังไม่มีในคลัง ต้องเพิ่มครุภัณฑ์ในเมนูคลังอุปกรณ์ก่อน</div>`;
  hoPickHighlight();
}

function hoPickHighlight() {
  document.querySelectorAll('#ho_equipList .ho-opt').forEach(el => {
    const on = +el.dataset.i === HO_PICK.active;
    el.style.background = on ? '#e0f2fe' : '';
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
}

function hoPickStatus(kind, text) {
  const el = $('ho_pick_status'), inp = $('ho_equipSearch');
  if (!el) return;
  el.textContent = text;
  el.style.color = kind === 'ok' ? '#15803d' : kind === 'warn' ? '#b45309' : '#64748b';
  if (inp) inp.style.borderColor = kind === 'warn' ? '#f59e0b' : '';
}
window._hoPickOpen = () => {
  const inp = $('ho_equipSearch');
  // ถ้าเลือกไว้แล้ว ให้แสดงรายการทั้งหมดตอนโฟกัส แทนที่จะกรองด้วยข้อความที่เลือกไว้
  hoPickRender($('ho_equipId').value ? '' : inp.value);
  $('ho_equipList').style.display = '';
  if ($('ho_equipId').value) inp.select();
};
window._hoPickType = () => {
  $('ho_equipId').value = ''; // พิมพ์ใหม่ = ยังไม่ได้เลือก กันค่าเก่าค้างไม่ตรงกับข้อความ
  hoPickRender($('ho_equipSearch').value);
  $('ho_equipList').style.display = '';
  hoPickStatus('', 'ยังไม่ได้เลือก — คลิกรายการด้านล่างเพื่อเลือก (หรือใช้ลูกศร ↑↓ แล้วกด Enter)');
};
// ออกจากช่องโดยมีข้อความแต่ยังไม่ได้เลือกรายการ = เตือนชัดๆ (ข้อความที่พิมพ์ค้างไว้ไม่ใช่การเลือก)
window._hoPickBlur = () => {
  setTimeout(() => {
    const inp = $('ho_equipSearch');
    if (!inp || $('ho_equipId').value) return;
    if (inp.value.trim()) hoPickStatus('warn', '⚠️ ยังไม่ได้เลือกครุภัณฑ์จากรายการ — ข้อความที่พิมพ์ไว้ยังไม่ถูกนับเป็นการเลือก');
  }, 150);
};
window._hoPickHover = (i) => { if (HO_PICK.active !== i) { HO_PICK.active = i; hoPickHighlight(); } };
window._hoPickChoose = (i) => {
  const e = HO_PICK.shown[i];
  if (!e) return;
  $('ho_equipId').value = e['รหัส'];
  $('ho_equipSearch').value = hoEquipLabel(e);
  $('ho_equipList').style.display = 'none';
  hoEquipChange(e); // ใช้รายการที่เลือกจริง ไม่ค้นซ้ำจากรหัส
  hoPickStatus('ok', '✓ เลือกครุภัณฑ์แล้ว: ' + hoEquipLabel(e));
  const act = hoActiveByEquip().get(String(e['รหัส']));
  if (act && String(act['รหัส']) !== String(HO_EDITING.id)) toast('ครุภัณฑ์ชิ้นนี้ยังอยู่ระหว่างส่งมอบให้ ' + (act['ส่งมอบให้หน่วยงาน'] || '-') + ' (ใบ ' + act['รหัส'] + ') — ตรวจสอบก่อนสร้างใบใหม่', 'warning');
};
window._hoPickClear = () => {
  $('ho_equipId').value = '';
  $('ho_equipSearch').value = '';
  hoPickStatus('', 'ยังไม่ได้เลือก — พิมพ์ค้นหาแล้วคลิกรายการ');
  $('ho_equipSearch').focus();
};
window._hoPickKey = (ev) => {
  const list = $('ho_equipList');
  const open = list.style.display !== 'none';
  if (ev.key === 'Escape') { list.style.display = 'none'; return; }
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    if (!open) window._hoPickOpen();
    const n = HO_PICK.shown.length;
    if (n) {
      const d = ev.key === 'ArrowDown' ? 1 : -1;
      HO_PICK.active = HO_PICK.active < 0 ? (d > 0 ? 0 : n - 1) : (HO_PICK.active + d + n) % n;
    }
    hoPickHighlight();
  } else if (ev.key === 'Enter') {
    ev.preventDefault(); // กัน Enter ไปกดปุ่ม/ส่งฟอร์ม
    if (!open) return;
    // Enter เลือกให้เฉพาะเมื่อ "ชัดเจน": ผู้ใช้ไฮไลต์เอง / เหลือผลลัพธ์เดียว / พิมพ์เลขครุภัณฑ์ตรงเป๊ะ
    let idx = HO_PICK.active;
    if (idx < 0 && HO_PICK.shown.length === 1) idx = 0;
    if (idx < 0) {
      const q = eqNorm($('ho_equipSearch').value).toLowerCase();
      const exact = q ? HO_PICK.shown.findIndex(e => eqNorm(e['รหัสครุภัณฑ์']).toLowerCase() === q || String(e['รหัส']).toLowerCase() === q) : -1;
      if (exact >= 0) idx = exact;
    }
    if (idx >= 0) window._hoPickChoose(idx);
    else toast('ยังมีหลายรายการที่ตรงกับคำค้น — คลิกเลือก หรือกดลูกศร ↑↓ เพื่อเลือกรายการที่ต้องการ', 'warning');
  }
};
// คลิกนอกช่องค้นหา = ปิดรายการ
document.addEventListener('mousedown', (ev) => {
  const pk = $('ho_picker');
  if (pk && !pk.contains(ev.target)) { const l = $('ho_equipList'); if (l) l.style.display = 'none'; }
});

// รายชื่อเจ้าหน้าที่จากตารางผู้ใช้งาน (ตัดบัญชีที่ระงับ/รออนุมัติ และชื่อซ้ำ) — คนในหน่วยงานที่เลือกขึ้นก่อน
function hoStaffList(dept) {
  const seen = new Set();
  const list = (DATA.users || []).filter(u => {
    const name = String(u['ชื่อ-นามสกุล'] || '').replace(/\s+/g, ' ').trim();
    const st = String(u['สถานะ'] || '').trim();
    if (!name || ['ระงับ', 'ไม่ใช้งาน', 'รออนุมัติ'].includes(st) || seen.has(name)) return false;
    seen.add(name);
    return true;
  }).map(u => ({
    name: String(u['ชื่อ-นามสกุล']).replace(/\s+/g, ' ').trim(),
    dept: String(u['หน่วยงาน'] || '').trim(),
    pos: String(u['ตำแหน่ง'] || '').trim(),
  }));
  const inDept = (x) => dept && x.dept === dept ? 0 : 1;
  return list.sort((a, b) => inDept(a) - inDept(b) || a.name.localeCompare(b.name, 'th'));
}
function hoStaffOptions(dept) {
  return hoStaffList(dept).map(x => `<option value="${esc(x.name)}" label="${esc([x.pos, x.dept].filter(Boolean).join(' · '))}"></option>`).join('');
}
window._hoStaffRefresh = () => {
  const dl = $('ho_staff_list');
  if (dl) dl.innerHTML = hoStaffOptions($('ho_dept').value);
};

// ใบส่งมอบที่ยัง "ส่งมอบแล้ว" (ยังไม่รับคืน) แยกตามครุภัณฑ์ — เอาใบล่าสุดของแต่ละชิ้น
function hoActiveByEquip() {
  const m = new Map();
  (DATA.equipmentHandover || []).forEach(h => {
    if (h['สถานะ'] === 'รับคืนแล้ว' || !h.equipId) return;
    const cur = m.get(String(h.equipId));
    if (!cur || String(h['วันที่บันทึก'] || '') >= String(cur['วันที่บันทึก'] || '')) m.set(String(h.equipId), h);
  });
  return m;
}
window.hoActiveByEquip = hoActiveByEquip;

function hoFindEquip(id) {
  return DATA.equipment.find(e => String(e['รหัส']) === String(id));
}

function hoChecklistRows(prefix, h) {
  const item1Label = h[prefix + 'Item1Label'] || 'อุปกรณ์เสริม (เมาส์/คีย์บอร์ด/สายชาร์จ ฯลฯ)';
  const rows = [
    { key: 'item1', label: item1Label, isCustomLabel: true },
    { key: 'scratch', label: HO_CHECK_LABELS.scratch },
    { key: 'crack', label: HO_CHECK_LABELS.crack },
    { key: 'notReady', label: HO_CHECK_LABELS.notReady },
  ];
  return rows.map(r => `
    <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #f1f5f9;">
      ${r.isCustomLabel
        ? `<input autocomplete="off" id="ho_${prefix}_item1Label" value="${esc(item1Label)}" style="flex:1; font-size:12px; padding:4px 6px;">`
        : `<span style="flex:1; font-size:13px;">${esc(r.label)}</span>`}
      <label style="display:flex; align-items:center; gap:4px; font-size:12px; color:#475569;"><input type="checkbox" id="ho_${prefix}_${r.key}" ${h[prefix + 'Check_' + r.key] ? 'checked' : ''}> มี</label>
    </div>`).join('') + `
    <div style="display:flex; align-items:center; gap:8px; padding:6px 0;">
      <span style="font-size:13px;">อื่นๆ</span>
      <input autocomplete="off" id="ho_${prefix}_otherNote" value="${esc(h[prefix + 'OtherNote'] || '')}" placeholder="ระบุ (ถ้ามี)" style="flex:1; font-size:12px; padding:4px 6px;">
    </div>`;
}

function equipmentHandoverForm(h) {
  h = h || {};
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD ตามเวลาเครื่อง (toISOString เป็น UTC -> ก่อน 07:00 ไทยจะได้วันที่เมื่อวาน)
  return `
<div class="form-grid">
  <div class="field full"><label>ครุภัณฑ์ * <span style="font-weight:400; color:#64748b; font-size:12px;">(พิมพ์ค้นหาด้วย เลขครุภัณฑ์ / ชื่อ / ยี่ห้อ / รุ่น / Serial / ที่เก็บ)</span></label>${hoEquipPicker(h)}</div>
  <div class="field"><label>เลขครุภัณฑ์</label><input autocomplete="off" id="ho_assetNo" value="${esc(h['เลขครุภัณฑ์'] || '')}"></div>
  <div class="field"><label>รุ่น</label><input autocomplete="off" id="ho_model" value="${esc(h['รุ่น'] || '')}"></div>
  <div class="field"><label>สเปค/ยี่ห้อ-Serial</label><input autocomplete="off" id="ho_spec" value="${esc(h['สเปค'] || '')}"></div>
  <div class="field"><label>ราคา</label><input autocomplete="off" id="ho_price" type="number" value="${esc(h['ราคา'] || 0)}"></div>
  <div class="field"><label>ส่งมอบให้หน่วยงาน * <small style="color:#94a3b8;">(พิมพ์ค้นหา — ถ้ายังไม่มีในระบบ เพิ่มได้ทันที)</small></label>
    ${eqDeptInputHtml('ho_dept', h['ส่งมอบให้หน่วยงาน'], 'window._hoStaffRefresh()')}
  </div>
  <div class="field"><label>ผู้รับผิดชอบ <small style="color:#94a3b8;">(เลือกจากรายชื่อเจ้าหน้าที่ หรือพิมพ์เอง)</small></label>
    <input autocomplete="off" id="ho_responsible" list="ho_staff_list" placeholder="พิมพ์ชื่อเพื่อค้นหา..." value="${esc(h['ผู้รับผิดชอบ'] || '')}">
    <datalist id="ho_staff_list">${hoStaffOptions(h['ส่งมอบให้หน่วยงาน'])}</datalist>
  </div>
  <div class="field"><label>ใช้งานครั้งที่</label><input autocomplete="off" id="ho_useNo" type="number" value="${esc(h['ใช้งานครั้งที่'] || 1)}"></div>
  <div class="field"><label>วันที่ใช้งานครั้งแรก</label><input autocomplete="off" id="ho_firstUseDate" type="date" value="${esc(h['วันที่ใช้งานครั้งแรก'] || today)}"></div>
</div>

<div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
  <div style="border:1px solid #bae6fd; background:#f0f9ff; border-radius:10px; padding:12px;">
    <div style="font-weight:700; color:#0369a1; font-size:14px; margin-bottom:8px;">📤 ครุภัณฑ์ที่ส่งมอบ</div>
    <div id="ho_give_rows">${hoChecklistRows('give', h)}</div>
    <div class="form-grid" style="margin-top:10px;">
      <div class="field"><label style="font-size:12px;">ผู้รับ</label><input autocomplete="off" id="ho_give_receiver" value="${esc(h['ส่งมอบ_ผู้รับ'] || '')}"></div>
      <div class="field"><label style="font-size:12px;">วันที่รับ</label><input autocomplete="off" id="ho_give_receiverDate" type="date" value="${esc(h['ส่งมอบ_วันที่รับ'] || '')}"></div>
      <div class="field"><label style="font-size:12px;">ผู้ส่งมอบ</label><input autocomplete="off" id="ho_give_sender" value="${esc(h['ส่งมอบ_ผู้ส่งมอบ'] || CURRENT_USER.name || '')}"></div>
      <div class="field"><label style="font-size:12px;">วันที่ส่งมอบ</label><input autocomplete="off" id="ho_give_senderDate" type="date" value="${esc(h['ส่งมอบ_วันที่ส่งมอบ'] || today)}"></div>
    </div>
  </div>
  <div style="border:1px solid #fde68a; background:#fffbeb; border-radius:10px; padding:12px;">
    <div style="font-weight:700; color:#b45309; font-size:14px; margin-bottom:8px;">📥 ครุภัณฑ์ที่รับคืน (กรอกเมื่อมีการคืนจริง)</div>
    <div id="ho_return_rows">${hoChecklistRows('return', h)}</div>
    <div class="form-grid" style="margin-top:10px;">
      <div class="field"><label style="font-size:12px;">ผู้ส่งคืน</label><input autocomplete="off" id="ho_return_sender" value="${esc(h['รับคืน_ผู้ส่งคืน'] || '')}"></div>
      <div class="field"><label style="font-size:12px;">วันที่ส่งคืน</label><input autocomplete="off" id="ho_return_senderDate" type="date" value="${esc(h['รับคืน_วันที่ส่งคืน'] || '')}"></div>
      <div class="field"><label style="font-size:12px;">ผู้รับคืน</label><input autocomplete="off" id="ho_return_receiver" value="${esc(h['รับคืน_ผู้รับคืน'] || '')}"></div>
      <div class="field"><label style="font-size:12px;">วันที่รับคืน</label><input autocomplete="off" id="ho_return_receiverDate" type="date" value="${esc(h['รับคืน_วันที่รับคืน'] || '')}"></div>
    </div>
  </div>
</div>`;
}

function hoEquipChange(eq) {
  const e = eq || hoFindEquip($('ho_equipId').value);
  if (!e) return;
  $('ho_assetNo').value = e['รหัสครุภัณฑ์'] || '';
  $('ho_model').value = e['รุ่น'] || '';
  $('ho_spec').value = [e['ยี่ห้อ'], e['Serial'] ? ('S/N: ' + e['Serial']) : ''].filter(Boolean).join(' / ');
  $('ho_price').value = e['มูลค่า'] || 0;
}
window._hoEquipChange = () => hoEquipChange();

const HO_EDITING = { id: '' }; // รหัสใบที่กำลังแก้ไข ('' = สร้างใหม่) ใช้เทียบตอนเตือนส่งมอบซ้ำ

function addEquipmentHandover(row, prefillEquipId) {
  if (!canManageEquipment()) return;
  HO_EDITING.id = '';
  const h = prefillEquipId ? { equipId: prefillEquipId } : {};
  if (prefillEquipId) {
    const e = hoFindEquip(prefillEquipId);
    if (e) { h['เลขครุภัณฑ์'] = e['รหัสครุภัณฑ์']; h['รุ่น'] = e['รุ่น']; h['สเปค'] = [e['ยี่ห้อ'], e['Serial'] ? ('S/N: ' + e['Serial']) : ''].filter(Boolean).join(' / '); h['ราคา'] = e['มูลค่า']; }
  }
  openModal('📋 สร้างใบส่งมอบ/รับคืนครุภัณฑ์', equipmentHandoverForm(h), () => saveEquipmentHandover(row), true);
}

function editEquipmentHandover(row) {
  if (!canManageEquipment()) return;
  HO_EDITING.id = String(row);
  const h = DATA.equipmentHandover.find(x => String(x['รหัส']) === String(row));
  if (!h) return;
  openModal('✏️ แก้ไขใบส่งมอบ/รับคืนครุภัณฑ์', equipmentHandoverForm(h), () => saveEquipmentHandover(row), true);
}

function hoCollectChecklist(prefix) {
  return {
    [prefix + 'Item1Label']: $('ho_' + prefix + '_item1Label').value,
    [prefix + 'Check_item1']: $('ho_' + prefix + '_item1').checked,
    [prefix + 'Check_scratch']: $('ho_' + prefix + '_scratch').checked,
    [prefix + 'Check_crack']: $('ho_' + prefix + '_crack').checked,
    [prefix + 'Check_notReady']: $('ho_' + prefix + '_notReady').checked,
    [prefix + 'OtherNote']: $('ho_' + prefix + '_otherNote').value,
  };
}

async function saveEquipmentHandover(row) {
  const equipId = $('ho_equipId').value;
  if (!equipId) { toast('กรุณาเลือกครุภัณฑ์', 'warning'); return; }
  if (!$('ho_dept').value.trim()) { toast('กรุณาระบุหน่วยงานที่ส่งมอบให้', 'warning'); return; }
  if (!(await eqDeptEnsure('ho_dept'))) return;
  const dept = eqNorm($('ho_dept').value);
  const e = hoFindEquip(equipId);

  const returnSenderDate = $('ho_return_senderDate').value;
  const returnReceiverDate = $('ho_return_receiverDate').value;
  const status = (returnSenderDate && returnReceiverDate) ? 'รับคืนแล้ว' : 'ส่งมอบแล้ว';

  const data = {
    equipId,
    'เลขครุภัณฑ์': $('ho_assetNo').value,
    'รายการ': e ? e['ชื่ออุปกรณ์'] : (DATA.equipmentHandover.find(x => String(x['รหัส']) === String(row)) || {})['รายการ'],
    'รุ่น': $('ho_model').value,
    'สเปค': $('ho_spec').value,
    'ราคา': +$('ho_price').value || 0,
    'ส่งมอบให้หน่วยงาน': dept,
    'ผู้รับผิดชอบ': $('ho_responsible').value,
    'ใช้งานครั้งที่': +$('ho_useNo').value || 1,
    'วันที่ใช้งานครั้งแรก': $('ho_firstUseDate').value,
    ...hoCollectChecklist('give'),
    'ส่งมอบ_ผู้รับ': $('ho_give_receiver').value,
    'ส่งมอบ_วันที่รับ': $('ho_give_receiverDate').value,
    'ส่งมอบ_ผู้ส่งมอบ': $('ho_give_sender').value,
    'ส่งมอบ_วันที่ส่งมอบ': $('ho_give_senderDate').value,
    ...hoCollectChecklist('return'),
    'รับคืน_ผู้ส่งคืน': $('ho_return_sender').value,
    'รับคืน_วันที่ส่งคืน': returnSenderDate,
    'รับคืน_ผู้รับคืน': $('ho_return_receiver').value,
    'รับคืน_วันที่รับคืน': returnReceiverDate,
    'สถานะ': status,
  };
  if (row) data['รหัส'] = row;
  if (!data['รายการ']) { toast('ไม่พบข้อมูลครุภัณฑ์ที่เลือก', 'error'); return; }
  const sd = data['ส่งมอบ_วันที่ส่งมอบ'], rs = data['รับคืน_วันที่ส่งคืน'], rr = data['รับคืน_วันที่รับคืน'];
  if (sd && rs && rs < sd) { toast('วันที่ส่งคืนต้องไม่ก่อนวันที่ส่งมอบ', 'warning'); return; }
  if (rs && rr && rr < rs) { toast('วันที่รับคืนต้องไม่ก่อนวันที่ส่งคืน', 'warning'); return; }
  const dup = hoActiveByEquip().get(String(equipId));
  if (dup && String(dup['รหัส']) !== String(row || '') && status !== 'รับคืนแล้ว') {
    if (!confirm('ครุภัณฑ์ "' + data['รายการ'] + '" ยังอยู่ระหว่างส่งมอบให้ ' + (dup['ส่งมอบให้หน่วยงาน'] || '-') + ' (ใบ ' + dup['รหัส'] + ' ยังไม่รับคืน)\n\nต้องการสร้างใบส่งมอบซ้ำสำหรับครุภัณฑ์ชิ้นนี้หรือไม่?')) return;
  }

  showLoading(true);
  callApi('saveEquipmentHandover', data)
    .then(r => {
      showLoading(false);
      if (r.success) { toast('บันทึกสำเร็จ'); closeModal(); refreshData(); }
      else toast(r.message || 'บันทึกไม่สำเร็จ', 'error');
    })
    .catch(err => { showLoading(false); toast('ผิดพลาด: ' + err.message, 'error'); });
}

function delEquipmentHandover(row, name) {
  if (!requireAdmin()) return;
  if (!confirm('ยืนยันการลบใบส่งมอบ/รับคืน: ' + (name || '') + ' ?')) return;
  showLoading(true);
  callApi('deleteEquipmentHandover', row, ADMIN_PASS)
    .then(r => {
      showLoading(false);
      if (r.success) { toast('ลบสำเร็จ'); refreshData(); }
      else toast(r.message, 'error');
    })
    .catch(err => { showLoading(false); toast('ผิดพลาด: ' + err.message, 'error'); });
}

function hoChecklistPreviewRows(prefix, h) {
  const item1Label = h[prefix + 'Item1Label'] || 'อุปกรณ์เสริม';
  const rows = [
    { label: item1Label, checked: h[prefix + 'Check_item1'] },
    { label: HO_CHECK_LABELS.scratch, checked: h[prefix + 'Check_scratch'] },
    { label: HO_CHECK_LABELS.crack, checked: h[prefix + 'Check_crack'] },
    { label: HO_CHECK_LABELS.notReady, checked: h[prefix + 'Check_notReady'] },
  ];
  let rowsHtml = rows.map(r => `
    <tr>
      <td style="padding:4px 6px; border-bottom:1px solid #e2e8f0; font-size:12px;">${esc(r.label)}</td>
      <td style="padding:4px 6px; border-bottom:1px solid #e2e8f0; text-align:center; width:40px;">${r.checked ? '✓' : ''}</td>
      <td style="padding:4px 6px; border-bottom:1px solid #e2e8f0; text-align:center; width:40px;">${!r.checked ? '✓' : ''}</td>
    </tr>`).join('');
  rowsHtml += `
    <tr>
      <td style="padding:4px 6px; border-bottom:1px solid #e2e8f0; font-size:12px;">อื่นๆ ${h[prefix + 'OtherNote'] ? ('— ' + esc(h[prefix + 'OtherNote'])) : ''}</td>
      <td style="padding:4px 6px; border-bottom:1px solid #e2e8f0;"></td>
      <td style="padding:4px 6px; border-bottom:1px solid #e2e8f0;"></td>
    </tr>`;
  return rowsHtml;
}

function hoDocumentHtml(h) {
  return `
    <div style="text-align:center; margin-bottom:14px;">
      <div style="font-weight:800; font-size:17px;">ส่งมอบ/รับคืน ครุภัณฑ์</div>
      <div style="font-size:13px; margin-top:4px;">ส่งมอบให้หน่วยงาน <strong>${esc(h['ส่งมอบให้หน่วยงาน'] || '-')}</strong></div>
      <div style="font-size:13px;">ครุภัณฑ์เลขที่ <strong>${esc(h['เลขครุภัณฑ์'] || '-')}</strong></div>
    </div>
    <table style="width:100%; border-collapse:collapse; font-size:13px; margin-bottom:10px;">
      <thead><tr style="background:#f1f5f9;">
        <th style="border:1px solid #cbd5e1; padding:6px;">ลำดับ</th>
        <th style="border:1px solid #cbd5e1; padding:6px;">รายการ</th>
        <th style="border:1px solid #cbd5e1; padding:6px;">รุ่น</th>
        <th style="border:1px solid #cbd5e1; padding:6px;">เลขครุภัณฑ์</th>
        <th style="border:1px solid #cbd5e1; padding:6px;">สเปค</th>
        <th style="border:1px solid #cbd5e1; padding:6px;">ราคา</th>
      </tr></thead>
      <tbody><tr>
        <td style="border:1px solid #cbd5e1; padding:6px; text-align:center;">1</td>
        <td style="border:1px solid #cbd5e1; padding:6px;">${esc(h['รายการ'] || '-')}</td>
        <td style="border:1px solid #cbd5e1; padding:6px;">${esc(h['รุ่น'] || '-')}</td>
        <td style="border:1px solid #cbd5e1; padding:6px;">${esc(h['เลขครุภัณฑ์'] || '-')}</td>
        <td style="border:1px solid #cbd5e1; padding:6px;">${esc(h['สเปค'] || '-')}</td>
        <td style="border:1px solid #cbd5e1; padding:6px; text-align:right;">${h['ราคา'] ? money(h['ราคา']) : '-'}</td>
      </tr></tbody>
    </table>
    <div style="font-size:13px; margin-bottom:14px;">
      ใช้งานครั้งที่ ${esc(h['ใช้งานครั้งที่'] || 1)} วันที่ ${esc(h['วันที่ใช้งานครั้งแรก'] || '-')} โดยงาน/ฝ่าย <strong>${esc(h['ส่งมอบให้หน่วยงาน'] || '-')}</strong><br>
      ผู้รับผิดชอบ ${esc(h['ผู้รับผิดชอบ'] || '-')}
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
      <div>
        <div style="font-weight:700; font-size:13px; margin-bottom:4px;">ครุภัณฑ์ที่ส่งมอบ</div>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="background:#f8fafc;"><th style="border:1px solid #cbd5e1; padding:4px; font-size:11px;">รายการและสภาพครุภัณฑ์</th><th style="border:1px solid #cbd5e1; padding:4px; font-size:11px; width:36px;">มี</th><th style="border:1px solid #cbd5e1; padding:4px; font-size:11px; width:36px;">ไม่มี</th></tr></thead>
          <tbody>${hoChecklistPreviewRows('give', h)}</tbody>
        </table>
      </div>
      <div>
        <div style="font-weight:700; font-size:13px; margin-bottom:4px;">ครุภัณฑ์ที่รับคืน</div>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="background:#f8fafc;"><th style="border:1px solid #cbd5e1; padding:4px; font-size:11px;">รายการและสภาพครุภัณฑ์</th><th style="border:1px solid #cbd5e1; padding:4px; font-size:11px; width:36px;">มี</th><th style="border:1px solid #cbd5e1; padding:4px; font-size:11px; width:36px;">ไม่มี</th></tr></thead>
          <tbody>${hoChecklistPreviewRows('return', h)}</tbody>
        </table>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:28px; text-align:center; font-size:12px;">
      <div>
        <div>ผู้รับ .............................................</div>
        <div style="margin-top:4px;">( ${esc(h['ส่งมอบ_ผู้รับ'] || '')} )</div>
        <div>วันที่ ${esc(h['ส่งมอบ_วันที่รับ'] || '.............................')}</div>
      </div>
      <div>
        <div>ผู้ส่งคืน .............................................</div>
        <div style="margin-top:4px;">( ${esc(h['รับคืน_ผู้ส่งคืน'] || '')} )</div>
        <div>วันที่ ${esc(h['รับคืน_วันที่ส่งคืน'] || '.............................')}</div>
      </div>
      <div>
        <div>ผู้ส่งมอบ .............................................</div>
        <div style="margin-top:4px;">( ${esc(h['ส่งมอบ_ผู้ส่งมอบ'] || '')} )</div>
        <div>วันที่ ${esc(h['ส่งมอบ_วันที่ส่งมอบ'] || '.............................')}</div>
      </div>
      <div>
        <div>ผู้รับคืน .............................................</div>
        <div style="margin-top:4px;">( ${esc(h['รับคืน_ผู้รับคืน'] || '')} )</div>
        <div>วันที่ ${esc(h['รับคืน_วันที่รับคืน'] || '.............................')}</div>
      </div>
    </div>
    <div style="margin-top:20px; font-size:11px; color:#64748b;">
      *แนะนำการใช้งานเบื้องต้น *ข้อห้าม<br>- ห้ามขีดเขียน แปะเอกสาร แปะสติ๊กเกอร์ กาว ต่างๆ บนครุภัณฑ์นี้
    </div>`;
}

function previewEquipmentHandover(row) {
  const h = DATA.equipmentHandover.find(x => String(x['รหัส']) === String(row));
  if (!h) { toast('ไม่พบข้อมูลใบส่งมอบ/รับคืน', 'error'); return; }
  const body = `
    <div style="max-width:720px; margin:0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:24px;">
      ${hoDocumentHtml(h)}
    </div>
    <div style="text-align:center; margin-top:16px;">
      <button class="btn btn-primary" onclick="printEquipmentHandover(${jsArg(row)})">🖨️ พิมพ์เอกสาร / Save PDF</button>
    </div>`;
  openModal('👁️ ตัวอย่างใบส่งมอบ/รับคืนครุภัณฑ์', body, null, true);
}

function printEquipmentHandover(row) {
  const h = DATA.equipmentHandover.find(x => String(x['รหัส']) === String(row));
  if (!h) { toast('ไม่พบข้อมูลใบส่งมอบ/รับคืน', 'error'); return; }
  const win = window.open('', '_blank');
  if (!win) { toast('กรุณายอมรับ Pop-up window ในเบราว์เซอร์เพื่อพิมพ์เอกสาร', 'warning'); return; }
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>ใบส่งมอบ-รับคืนครุภัณฑ์ - ${esc(h['เลขครุภัณฑ์'] || row)}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap');
        body { font-family:'Sarabun', sans-serif; background:#f8fafc; padding:20px; color:#0f172a; margin:0; }
        .sheet { background:#fff; max-width:800px; margin:0 auto; padding:40px; border-radius:8px; box-shadow:0 4px 14px rgba(0,0,0,0.1); border:1px solid #e2e8f0; }
        @media print { body { background:#fff; padding:0; } .sheet { box-shadow:none; border:none; max-width:100%; padding:20px; } .no-print { display:none; } }
      </style>
    </head>
    <body>
      <div class="no-print" style="max-width:800px; margin:0 auto 16px auto; text-align:right;">
        <button onclick="window.print()" style="padding:10px 20px; background:#0284c7; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer; font-size:14px;">🖨️ พิมพ์เอกสาร / Save PDF</button>
      </div>
      <div class="sheet">${hoDocumentHtml(h)}</div>
    </body>
    </html>
  `);
  win.document.close();
}

// ------------------------------------------------------------------ หน้ารายการใบส่งมอบ
// ใช้ชุดเครื่องมือเดียวกับหน้าคลังอุปกรณ์: ค้นหาหลายคำ, กรอง, เรียงลำดับ, แบ่งหน้า, ลิงก์ไปยังครุภัณฑ์ในคลัง
const HO_STATE_DEFAULT = { text: '', status: '', dept: '', sortKey: 'date', sortDir: 'desc', page: 1, pageSize: 25 };
const HO_SORTS = {
  id: { get: h => h['รหัส'] },
  dept: { get: h => h['ส่งมอบให้หน่วยงาน'] },
  person: { get: h => h['ผู้รับผิดชอบ'] },
  date: { get: h => h['ส่งมอบ_วันที่ส่งมอบ'] || h['วันที่บันทึก'] },
  status: { get: h => h['สถานะ'] },
};
const HO_SEARCH_FIELDS = ['รหัส', 'รายการ', 'เลขครุภัณฑ์', 'ส่งมอบให้หน่วยงาน', 'ผู้รับผิดชอบ', 'ส่งมอบ_ผู้รับ', 'ส่งมอบ_ผู้ส่งมอบ', 'รับคืน_ผู้ส่งคืน', 'รับคืน_ผู้รับคืน', 'สถานะ'];

function hoState() {
  window.HANDOVER_STATE = Object.assign({}, HO_STATE_DEFAULT, window.HANDOVER_STATE || {});
  return window.HANDOVER_STATE;
}

// equipOf: ฟังก์ชันหาครุภัณฑ์จาก equipId (ฉีดเข้ามาเพื่อให้ทดสอบแยกได้)
function hoFilter(all, st, equipOf) {
  let items = all;
  const words = String(st.text || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    // ค้นเฉพาะฟิลด์ที่แสดงจริง (ไม่ใช่ JSON ทั้งก้อน ซึ่งจะไปตรงกับชื่อฟิลด์/ค่า true-false ของเช็กลิสต์)
    items = items.filter(h => {
      const eq = equipOf ? equipOf(h.equipId) : null;
      const hay = HO_SEARCH_FIELDS.map(f => String(h[f] ?? '')).concat(eq ? [String(eq['Serial'] ?? ''), String(eq['ที่เก็บ'] ?? '')] : []).join(' ').toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }
  if (st.status) items = items.filter(h => (h['สถานะ'] || 'ส่งมอบแล้ว') === st.status);
  if (st.dept) items = items.filter(h => h['ส่งมอบให้หน่วยงาน'] === st.dept);
  return items;
}

function hoSort(items, key, dir) {
  const spec = HO_SORTS[key];
  if (!spec) return items;
  const sign = dir === 'asc' ? 1 : -1;
  return items.slice().sort((a, b) => {
    const va = String(spec.get(a) ?? ''), vb = String(spec.get(b) ?? '');
    if (!va || !vb) return va === vb ? 0 : (va ? -1 : 1); // ค่าว่างท้ายเสมอ
    return va.localeCompare(vb, 'th', { numeric: true }) * sign;
  });
}

function hoStatusBadge(status) {
  return status === 'รับคืนแล้ว'
    ? `<span style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; padding:3px 8px; border-radius:12px; font-weight:700; font-size:11px;">✅ รับคืนแล้ว</span>`
    : `<span style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; padding:3px 8px; border-radius:12px; font-weight:700; font-size:11px;">📤 ส่งมอบแล้ว</span>`;
}

// กระโดดจากหน้าคลังไปดูใบส่งมอบของครุภัณฑ์ชิ้นนั้น (ใช้เลขครุภัณฑ์/รหัสเป็นคำค้น)
function hoJumpToEquipment(equipId) {
  const e = hoFindEquip(equipId);
  window.HANDOVER_STATE = Object.assign({}, HO_STATE_DEFAULT, { text: e ? String(e['รหัสครุภัณฑ์'] || e['รหัส']) : String(equipId) });
  navigate('equipmentHandover');
}

// กระโดดจากใบส่งมอบไปดูครุภัณฑ์ในหน้าคลัง
function hoOpenInInventory(equipId) {
  const e = hoFindEquip(equipId);
  if (!e) { toast('ไม่พบครุภัณฑ์นี้ในคลังแล้ว', 'warning'); return; }
  window.EQUIPMENT_FILTER_STATE = Object.assign({}, EQ_STATE_DEFAULT, { collapsed: {}, text: String(e['รหัสครุภัณฑ์'] || e['รหัส']) });
  navigate('equipment');
}
window.hoJumpToEquipment = hoJumpToEquipment;
window.hoOpenInInventory = hoOpenInInventory;

function renderEquipmentHandover() {
  const st = hoState();
  const all = DATA.equipmentHandover || [];

  const sortTh = (key, label, style) => {
    const on = st.sortKey === key;
    return `<th onclick="window._hoSort('${key}')" title="คลิกเพื่อเรียงลำดับ" style="cursor:pointer; user-select:none; white-space:nowrap; ${style || ''}">${label} <span style="font-size:10px; color:${on ? '#0f766e' : '#cbd5e1'};">${on ? (st.sortDir === 'asc' ? '▲' : '▼') : '↕'}</span></th>`;
  };

  const resultsHtml = () => {
    const items = hoSort(hoFilter(all, st, hoFindEquip), st.sortKey, st.sortDir);
    const pg = eqPaginate(items, st.page, st.pageSize);
    st.page = pg.page;
    const isFiltered = !!(st.text || st.status || st.dept);
    const rows = pg.slice.map(h => {
      const eq = hoFindEquip(h.equipId);
      const id = jsArg(h['รหัส']);
      return `
        <tr>
          <td data-label="เลขที่เอกสาร" style="padding-left:20px;">
            <code style="font-size:12px; font-weight:700; color:#0f766e;">${esc(h['รหัส'])}</code>
            <div style="font-size:12px; color:#334155; margin-top:2px; font-weight:600;">${esc(h['รายการ'] || '-')} <span style="color:#64748b; font-weight:400;">(${esc(h['เลขครุภัณฑ์'] || '-')})</span></div>
            ${eq ? `<div style="font-size:11px; color:#64748b; margin-top:2px;">🏷️ ${esc(eq['หมวดหมู่'] ? eqCatLabel(eq['หมวดหมู่']) : 'ทั่วไป')}${eq['ที่เก็บ'] ? ' · 📍 ' + esc(eq['ที่เก็บ']) : ''}
              <a href="javascript:void(0)" onclick="hoOpenInInventory(${jsArg(h.equipId)})" style="color:#0891b2; margin-left:6px;">ดูในคลัง ›</a></div>` : `<div style="font-size:11px; color:#b45309; margin-top:2px;">⚠️ ไม่พบครุภัณฑ์นี้ในคลังแล้ว</div>`}
          </td>
          <td data-label="หน่วยงาน">${esc(h['ส่งมอบให้หน่วยงาน'] || '-')}</td>
          <td data-label="ผู้รับผิดชอบ">${esc(h['ผู้รับผิดชอบ'] || '-')}</td>
          <td data-label="วันที่ส่งมอบ">${esc(h['ส่งมอบ_วันที่ส่งมอบ'] || '-')}</td>
          <td data-label="สถานะ">${hoStatusBadge(h['สถานะ'])}</td>
          <td data-label="การจัดการ" style="text-align:center;">
            <div style="display:inline-flex; gap:6px; justify-content:center; align-items:center;">
              <button class="btn btn-sm btn-info" onclick="previewEquipmentHandover(${id})" title="ดูตัวอย่างก่อนพิมพ์" aria-label="ดูตัวอย่าง" style="padding:4px 8px;">👁️</button>
              <button class="btn btn-sm btn-secondary" onclick="printEquipmentHandover(${id})" title="พิมพ์เอกสาร" aria-label="พิมพ์เอกสาร" style="padding:4px 8px;">🖨️</button>
              ${canManageEquipment() ? `<button class="btn btn-sm btn-secondary" onclick="editEquipmentHandover(${id})" title="แก้ไข / บันทึกรับคืน" aria-label="แก้ไข" style="padding:4px 8px;">✏️</button>` : ''}
              ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="delEquipmentHandover(${id}, ${jsArg(h['รายการ'] || '')})" title="ลบ" aria-label="ลบ" style="padding:4px 8px;">🗑️</button>` : ''}
            </div>
          </td>
        </tr>`;
    }).join('') || `
        <tr><td colspan="6">
          <div style="text-align:center; padding:48px 20px; background:#fafafa; border-radius:12px;">
            <div style="font-size:44px; margin-bottom:10px;">${isFiltered ? '🔍' : '📋'}</div>
            <div style="font-size:16px; font-weight:700; color:#334155;">${isFiltered ? 'ไม่พบใบส่งมอบตามเงื่อนไขที่ค้นหา' : 'ยังไม่มีใบส่งมอบ/รับคืนครุภัณฑ์ในระบบ'}</div>
            <div style="margin-top:14px; display:flex; gap:10px; justify-content:center;">
              ${isFiltered ? `<button class="btn btn-sm btn-secondary" onclick="window._hoClear()" style="border-radius:8px;">🔄 ล้างตัวกรอง</button>` : ''}
              ${canManageEquipment() && !isFiltered ? `<button class="btn btn-sm btn-primary" onclick="addEquipmentHandover()" style="border-radius:8px;">➕ สร้างใบส่งมอบใหม่</button>` : ''}
            </div>
          </div>
        </td></tr>`;
    const from = st.pageSize ? (pg.page - 1) * st.pageSize + 1 : 1;
    const to = st.pageSize ? Math.min(pg.page * st.pageSize, pg.total) : pg.total;
    const btn = (label, page, disabled) => `<button class="btn btn-sm btn-secondary" ${disabled ? 'disabled' : `onclick="window._hoPage(${page})"`} style="min-width:36px;">${label}</button>`;
    return `
    <div class="card" id="hoResults"><div class="card-body" style="padding:0">
    <div class="table-wrap" style="border:none"><table>
      <thead><tr>
        ${sortTh('id', 'เลขที่เอกสาร &amp; ครุภัณฑ์', 'padding-left:20px;')}
        ${sortTh('dept', 'ส่งมอบให้หน่วยงาน')}
        ${sortTh('person', 'ผู้รับผิดชอบ')}
        ${sortTh('date', 'วันที่ส่งมอบ')}
        ${sortTh('status', 'สถานะ')}
        <th style="text-align:center;">การจัดการ</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pg.total ? `<div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:12px 20px; border-top:1px solid #e2e8f0; font-size:13px; color:#475569;">
      <div>แสดง ${fmt(from)}–${fmt(to)} จาก ${fmt(pg.total)} ใบ</div>
      <div style="display:flex; align-items:center; gap:6px;">${btn('‹ ก่อนหน้า', pg.page - 1, pg.page <= 1)}<span style="padding:0 8px;">หน้า ${pg.page} / ${pg.pages}</span>${btn('ถัดไป ›', pg.page + 1, pg.page >= pg.pages)}</div>
    </div>` : ''}
    </div></div>`;
  };

  const render = () => {
    const active = all.filter(h => h['สถานะ'] !== 'รับคืนแล้ว').length;
    const depts = Array.from(new Set(all.map(h => h['ส่งมอบให้หน่วยงาน']).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'th'));
    const selStyle = 'padding:10px 14px; border-radius:10px; border:1px solid #cbd5e1; font-size:14px; background:#fff;';
    return `
    <div class="stat-grid" style="margin-bottom:16px;">
      <div class="stat s-blue" onclick="window._hoSet({status:''})" style="cursor:pointer;"><div class="icon-big">📋</div><div class="label">ใบส่งมอบทั้งหมด</div><div class="value">${fmt(all.length)}</div></div>
      <div class="stat s-purple" onclick="window._hoSet({status:'ส่งมอบแล้ว'})" style="cursor:pointer;"><div class="icon-big">📤</div><div class="label">อยู่ระหว่างส่งมอบ (ยังไม่รับคืน)</div><div class="value">${fmt(active)}</div></div>
      <div class="stat s-green" onclick="window._hoSet({status:'รับคืนแล้ว'})" style="cursor:pointer;"><div class="icon-big">✅</div><div class="label">รับคืนแล้ว</div><div class="value">${fmt(all.length - active)}</div></div>
    </div>
    <div class="toolbar" style="flex-wrap:wrap; gap:10px;">
      <div class="search" style="flex:1; min-width:220px;"><input id="hoSearch" placeholder="🔍 ค้นหา ครุภัณฑ์ / เลขครุภัณฑ์ / หน่วยงาน / ผู้รับผิดชอบ... (พิมพ์หลายคำได้)" oninput="window._hoText(this.value)" value="${esc(st.text)}"></div>
      <select onchange="window._hoSet({status: this.value})" style="${selStyle}">
        <option value="">📌 ทุกสถานะ</option>
        <option value="ส่งมอบแล้ว" ${st.status === 'ส่งมอบแล้ว' ? 'selected' : ''}>📤 ส่งมอบแล้ว</option>
        <option value="รับคืนแล้ว" ${st.status === 'รับคืนแล้ว' ? 'selected' : ''}>✅ รับคืนแล้ว</option>
      </select>
      <select onchange="window._hoSet({dept: this.value})" style="${selStyle} max-width:240px;">
        <option value="">🏢 ทุกหน่วยงาน (${depts.length})</option>
        ${depts.map(d => `<option value="${esc(d)}" ${st.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
      </select>
      ${(st.text || st.status || st.dept) ? `<button class="btn btn-outline-danger" onclick="window._hoClear()">✕ ล้างการกรอง</button>` : ''}
      ${canManageEquipment() ? `<button class="btn btn-success" onclick="addEquipmentHandover()">➕ สร้างใบส่งมอบใหม่</button>` : ''}
      ${canManageEquipment() ? `<button class="btn btn-info" onclick="exportSheet('equipmentHandover')">📥 Export</button>` : ''}
    </div>
    ${resultsHtml()}`;
  };

  const repaint = () => { $('content').innerHTML = render(); };
  window._hoSet = (patch) => { Object.assign(st, patch); if (!('page' in patch)) st.page = 1; repaint(); };
  window._hoClear = () => window._hoSet({ text: '', status: '', dept: '' });
  window._hoPage = (n) => { st.page = n; repaint(); const r = document.getElementById('hoResults'); if (r) r.scrollIntoView({ block: 'start' }); };
  window._hoSort = (key) => {
    if (st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
    else { st.sortKey = key; st.sortDir = key === 'date' ? 'desc' : 'asc'; }
    st.page = 1; repaint();
  };
  // พิมพ์ค้นหาแบบเรียลไทม์: อัปเดตเฉพาะตาราง ไม่สร้างช่อง input ใหม่ (ไม่เสีย focus / พิมพ์ไทยไม่สะดุด)
  window._hoText = (v) => {
    st.text = v; st.page = 1;
    const tmp = document.createElement('div');
    tmp.innerHTML = resultsHtml();
    const cur = document.getElementById('hoResults'), next = tmp.firstElementChild;
    if (cur && next) cur.replaceWith(next);
  };
  repaint();
}

if (typeof module === 'object' && module.exports) module.exports = { hoFilter, hoSort, HO_STATE_DEFAULT };
