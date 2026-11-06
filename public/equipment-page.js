/* ============================================================================
 * หน้า "คลังทะเบียนอุปกรณ์ & ครุภัณฑ์" (แยกออกจาก index.html)
 *
 * โหลดเป็น <script src> ปกติ (ไม่ใช่ module) จึงแชร์ตัวแปร global กับสคริปต์หลักของ index.html
 * โดยอ้างถึงเฉพาะตอนเรียกใช้ (ไม่ใช่ตอนโหลด): DATA, $, esc, jsArg, fmt, money, toast, openModal,
 * closeModal, callApi, ADMIN_PASS, showLoading, refreshData, isAdmin, canManageEquipment,
 * quickBorrow, showQrModal, addEquipmentHandover,
 * openLabelPrintModal (equipment-labels.js), exportSheet, openImportEquipmentModal
 *
 * โครงไฟล์:
 *   1) ค่าคงที่ + state ของตัวกรอง/เรียงลำดับ/จัดกลุ่ม/แบ่งหน้า
 *   2) ฟังก์ชันล้วน (กรอง -> เรียง -> จัดกลุ่ม -> แบ่งหน้า) ทดสอบแยกได้
 *   3) renderEquipment() + ตัวช่วยสร้าง HTML
 *   4) ฟอร์มเพิ่ม/แก้ไข/ลบ
 * ========================================================================== */

// ------------------------------------------------------------------ 1) state
const EQ_STATE_DEFAULT = { text: '', cat: '', status: '', loc: '', sortKey: '', sortDir: 'asc', group: '', page: 1, pageSize: 50, collapsed: {} };
const EQ_PAGE_SIZES = [25, 50, 100, 0]; // 0 = ทั้งหมด
const EQ_SEARCH_FIELDS = ['รหัสครุภัณฑ์', 'รหัส', 'ชื่ออุปกรณ์', 'ยี่ห้อ', 'รุ่น', 'Serial', 'ที่เก็บ', 'หมวดหมู่', 'ประเภทครุภัณฑ์', 'ผู้จำหน่าย', 'ผู้รับผิดชอบ', 'หน่วยงานที่รับผิดชอบ'];
const EQ_GROUPS = { cat: { label: 'หมวดหมู่', field: 'หมวดหมู่' }, loc: { label: 'สถานที่จัดเก็บ', field: 'ที่เก็บ' } };

// เรียงตามคอลัมน์: type 'num' เทียบเป็นตัวเลข นอกนั้นเทียบข้อความแบบไทย (เลขในข้อความเรียงตามค่า)
const EQ_SORT_KEYS = {
  tag: { field: 'รหัสครุภัณฑ์', type: 'str' },
  name: { field: 'ชื่ออุปกรณ์', type: 'str' },
  qty: { field: 'จำนวน', type: 'num' },
  loc: { field: 'ที่เก็บ', type: 'str' },
  price: { field: 'มูลค่า', type: 'num' },
};

function eqState() {
  const cur = window.EQUIPMENT_FILTER_STATE;
  if (!cur || typeof cur !== 'object') window.EQUIPMENT_FILTER_STATE = Object.assign({}, EQ_STATE_DEFAULT, { collapsed: {} });
  else window.EQUIPMENT_FILTER_STATE = Object.assign({}, EQ_STATE_DEFAULT, cur);
  return window.EQUIPMENT_FILTER_STATE;
}

// ------------------------------------------------------------------ 2) pure helpers
function eqFilter(all, st) {
  let items = all;
  const q = String(st.text || '').trim().toLowerCase();
  if (q) {
    // ค่าจาก Excel/DB อาจเป็นตัวเลข (Serial, รหัสครุภัณฑ์) — แปลงเป็น String ก่อนเสมอ ไม่งั้นช่องค้นหาพัง
    const words = q.split(/\s+/);
    items = items.filter(e => words.every(w => EQ_SEARCH_FIELDS.some(f => String(e[f] ?? '').toLowerCase().includes(w))));
  }
  if (st.cat) items = items.filter(e => e['หมวดหมู่'] === st.cat);
  if (st.status) items = items.filter(e => e['สถานะ'] === st.status);
  if (st.loc) items = items.filter(e => eqNorm(e['ที่เก็บ']).toLowerCase() === eqNorm(st.loc).toLowerCase());
  return items;
}

function eqSort(items, key, dir) {
  const spec = EQ_SORT_KEYS[key];
  if (!spec) return items;
  const sign = dir === 'desc' ? -1 : 1;
  return items.slice().sort((a, b) => {
    const va = a[spec.field], vb = b[spec.field];
    const ea = va === undefined || va === null || String(va).trim() === '';
    const eb = vb === undefined || vb === null || String(vb).trim() === '';
    if (ea || eb) return ea === eb ? 0 : (ea ? 1 : -1); // ค่าว่างอยู่ท้ายเสมอ ไม่ว่าเรียงขึ้นหรือลง
    if (spec.type === 'num') return ((+va || 0) - (+vb || 0)) * sign;
    return String(va).localeCompare(String(vb), 'th', { numeric: true }) * sign;
  });
}

// คืน entries เรียงตามที่จะแสดง: { type:'group', name, count, sum, collapsed, id } | { type:'row', e, group }
function eqBuildEntries(items, st) {
  const sorted = eqSort(items, st.sortKey, st.sortDir);
  const g = EQ_GROUPS[st.group];
  if (!g) return sorted.map(e => ({ type: 'row', e, group: '' }));
  const map = new Map();
  sorted.forEach(e => {
    const name = String(e[g.field] || '').trim() || '(ไม่ระบุ)';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(e);
  });
  const catKey = (n) => { // จัดกลุ่มตามหมวด: เรียงตามรหัสหมวดก่อน
    if (st.group !== 'cat') return null;
    const c = eqCatByName(n);
    return c && eqCatCode(c) ? eqCatCode(c) : null;
  };
  const names = Array.from(map.keys()).sort((a, b) => {
    if (a === '(ไม่ระบุ)') return 1;
    if (b === '(ไม่ระบุ)') return -1;
    const ka = catKey(a), kb = catKey(b);
    if (ka && kb) return ka.localeCompare(kb);
    if (ka || kb) return ka ? -1 : 1;
    return a.localeCompare(b, 'th', { numeric: true });
  });
  const out = [];
  names.forEach(name => {
    const rows = map.get(name);
    const id = st.group + ':' + name;
    const collapsed = !!(st.collapsed && st.collapsed[id]);
    out.push({ type: 'group', name, id, count: rows.length, sum: rows.reduce((s, e) => s + (+e['มูลค่า'] || 0) * (+e['จำนวน'] || 1), 0), collapsed });
    if (!collapsed) rows.forEach(e => out.push({ type: 'row', e, group: name }));
  });
  return out;
}

function eqPaginate(entries, page, size) {
  if (!size) return { slice: entries, page: 1, pages: 1, total: entries.length };
  const pages = Math.max(1, Math.ceil(entries.length / size));
  const p = Math.min(Math.max(1, +page || 1), pages);
  return { slice: entries.slice((p - 1) * size, p * size), page: p, pages, total: entries.length };
}

// ค่าที่ใช้ซ้ำในฟอร์ม: รวมตัวสะกดต่างกันเฉพาะตัวพิมพ์/ช่องว่าง แล้วเลือกแบบที่พบบ่อยสุดเป็นตัวแทน
function eqNorm(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

// ---- หมวดหมู่ที่ผูกกับ 4 หลักแรกของเลขครุภัณฑ์ (เช่น 7440-14-0001/31 -> 7440) ----
const EQ_KNOWN_CODES = { '7440': 'อุปกรณ์คอมพิวเตอร์และเครื่องพิมพ์' }; // ชื่อที่แนะนำตอนสร้างหมวดจากรหัสที่พบ
function eqTagPrefix(tag) {
  const m = /^\s*(\d{4})(?!\d)/.exec(String(tag == null ? '' : tag));
  return m ? m[1] : '';
}
function eqCats() { return (typeof DATA !== 'undefined' && DATA && DATA.categories) || []; }
function eqCatCode(c) { return String((c && c['รหัสหมวด']) || '').trim(); }
function eqCatByName(name) { const n = eqNorm(name).toLowerCase(); return eqCats().find(c => eqNorm(c['ชื่อหมวด']).toLowerCase() === n); }
function eqCatByCode(code) { return code ? eqCats().find(c => eqCatCode(c) === code) : undefined; }
function eqCatLabel(name) { const c = eqCatByName(name); const code = c ? eqCatCode(c) : ''; return code ? code + ' · ' + name : name; }
// เรียงหมวด: มีรหัสก่อน (ตามเลขรหัส) แล้วตามด้วยหมวดที่ไม่มีรหัส (ตามชื่อ)
function eqCatCompare(a, b) {
  const ca = eqCatCode(a), cb = eqCatCode(b);
  if (ca && cb) return ca.localeCompare(cb);
  if (ca || cb) return ca ? -1 : 1;
  return String(a['ชื่อหมวด']).localeCompare(String(b['ชื่อหมวด']), 'th');
}
// สถานที่จัดเก็บทั้งหมด = ที่ตั้งไว้ล่วงหน้า (settings.EQUIPMENT_LOCATIONS) + ที่อุปกรณ์ใช้อยู่จริง
// รวมชื่อที่ต่างแค่ตัวพิมพ์/ช่องว่าง; คืน [{ name, count, inMaster }] เรียงแบบไทย
function eqMasterLocations() {
  try {
    const raw = DATA.settings && DATA.settings.EQUIPMENT_LOCATIONS;
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.map(eqNorm).filter(Boolean) : [];
  } catch (e) { return []; }
}
function eqAllLocations() {
  const map = new Map();
  const touch = (name, inMaster, inc) => {
    const k = name.toLowerCase();
    const cur = map.get(k) || { name, count: 0, inMaster: false };
    if (inMaster) { cur.name = name; cur.inMaster = true; } // ชื่อใน master เป็นตัวหลัก
    cur.count += inc;
    map.set(k, cur);
  };
  eqMasterLocations().forEach(n => touch(n, true, 0));
  (DATA.equipment || []).forEach(e => { const n = eqNorm(e['ที่เก็บ']); if (n) touch(n, false, 1); });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'th', { numeric: true }));
}

function eqDistinct(field) {
  if (field === 'ที่เก็บ') return eqAllLocations().map(l => l.name);
  const buckets = new Map();
  (DATA.equipment || []).forEach(e => {
    const v = eqNorm(e[field]);
    if (!v) return;
    const k = v.toLowerCase();
    if (!buckets.has(k)) buckets.set(k, new Map());
    const m = buckets.get(k);
    m.set(v, (m.get(v) || 0) + 1);
  });
  return Array.from(buckets.values())
    .map(m => Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0][0])
    .sort((a, b) => a.localeCompare(b, 'th'));
}
// พิมพ์ซ้ำของเดิมที่ต่างแค่ตัวพิมพ์/ช่องว่าง -> ใช้ตัวสะกดที่มีอยู่แล้ว (กันข้อมูลแตกเป็นหลายแบบ)
function eqCanon(field, v) {
  const n = eqNorm(v);
  if (!n) return '';
  const hit = eqDistinct(field).find(x => x.toLowerCase() === n.toLowerCase());
  return hit || n;
}

// ------------------------------------------------------------------ 3) หน้าหลัก
function eqStatusBadge(st) {
  const base = 'padding:3px 8px; border-radius:12px; font-weight:700; font-size:11px;';
  if (st === 'พร้อมยืม') return `<span style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; ${base}">🟢 พร้อมยืม</span>`;
  if (st === 'อยู่ระหว่างยืม') return `<span style="background:#f3e8ff; color:#7e22ce; border:1px solid #e9d5ff; ${base}">📦 อยู่ระหว่างยืม</span>`;
  if (st === 'ประจำจุด') return `<span style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; ${base}">🖥️ ประจำจุด</span>`;
  return `<span style="background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; ${base}">🔴 ${esc(st)}</span>`;
}

let EQ_HO_MAP = new Map(); // ครุภัณฑ์ -> ใบส่งมอบที่ยังไม่รับคืน (คำนวณใหม่ทุกครั้งที่วาดตาราง)

function eqRowHtml(e) {
  const equipKey = (e._row !== undefined && e._row !== null) ? e._row : jsArg(e['รหัส'] || e['รหัสครุภัณฑ์'] || e.id || '');
  const st = e['สถานะ'] || 'พร้อมยืม';
  const noTag = e['สถานะป้ายครุภัณฑ์'] === 'ไม่มีป้าย';
  const linkedParent = e['เชื่อมกับ'] ? DATA.equipment.find(p => String(p['รหัส']) === String(e['เชื่อมกับ'])) : null;
  const linkedChildren = DATA.equipment.filter(c => c['เชื่อมกับ'] && String(c['เชื่อมกับ']) === String(e['รหัส']));
  return `
              <tr>
                <td data-label="รหัสครุภัณฑ์" style="padding-left:20px;">
                  ${noTag
                    ? `<span style="font-size:11px; font-weight:700; color:#b45309; background:#fffbeb; padding:3px 8px; border-radius:6px; border:1px solid #fde68a;">⚠️ ยังไม่มีป้าย</span>`
                    : `<code style="font-size:13px; font-weight:700; color:#0f766e; background:#f0fdf4; padding:3px 8px; border-radius:6px; border:1px solid #ccfbf1;">${esc(e['รหัสครุภัณฑ์'] || '-')}</code>`}
                  <div style="font-size:12px; color:#64748b; margin-top:4px;">🏷️ ${esc(e['หมวดหมู่'] ? eqCatLabel(e['หมวดหมู่']) : 'ทั่วไป')}</div>
                </td>
                <td data-label="ชื่ออุปกรณ์">
                  <div style="display:flex; align-items:center;">
                    ${eqPhotoCell(e)}
                    <div>
                      <div style="font-weight:700; color:#0f172a; font-size:14px;">${esc(e['ชื่ออุปกรณ์'])}</div>
                      <div style="font-size:12px; color:#64748b; margin-top:2px;">
                        ${esc(e['ยี่ห้อ'] || '')} ${esc(e['รุ่น'] || '')} ${e['Serial'] ? `<span style="color:#94a3b8; font-size:11px;">(S/N: ${esc(e['Serial'])})</span>` : ''}
                      </div>
                    </div>
                  </div>
                  ${linkedParent ? `<div style="font-size:11px; color:#7c3aed; margin-top:3px;">🔗 เชื่อมกับ: ${esc(linkedParent['ชื่ออุปกรณ์'] || linkedParent['รหัส'])}</div>` : ''}
                  ${linkedChildren.length ? `<div style="font-size:11px; color:#0891b2; margin-top:3px;">🔌 มีอุปกรณ์เชื่อมต่อ ${linkedChildren.length} ชิ้น</div>` : ''}
                </td>
                <td data-label="จำนวน & สถานะ">
                  <div style="font-weight:700; color:#1e293b; font-size:14px; margin-bottom:4px;">
                    ${fmt(e['จำนวน'])} <span style="font-size:12px; color:#64748b; font-weight:500;">${esc(e['หน่วยนับ'] || 'เครื่อง')}</span>
                  </div>
                  ${eqStatusBadge(st)}
                  ${EQ_HO_MAP.get(String(e['รหัส'])) ? `<div style="margin-top:4px;"><a href="javascript:void(0)" onclick="hoJumpToEquipment(${jsArg(e['รหัส'])})" title="ดูใบส่งมอบ ${esc(EQ_HO_MAP.get(String(e['รหัส']))['รหัส'])}" style="font-size:11px; color:#b45309; font-weight:600; text-decoration:none;">📋 ส่งมอบให้ ${esc(EQ_HO_MAP.get(String(e['รหัส']))['ส่งมอบให้หน่วยงาน'] || '-')} ›</a></div>` : ''}
                </td>
                <td data-label="ที่เก็บ">
                  <span style="font-size:13px; color:#334155; font-weight:500;">📍 ${esc(e['ที่เก็บ'] || '-')}</span>
                  ${e['ผู้รับผิดชอบ'] || e['หน่วยงานที่รับผิดชอบ'] ? `<div style="font-size:12px; color:#64748b; margin-top:3px;">👤 ${esc([e['ผู้รับผิดชอบ'], e['หน่วยงานที่รับผิดชอบ']].filter(Boolean).join(' · '))}</div>` : ''}
                </td>
                <td data-label="มูลค่า">
                  <span style="font-size:13px; font-weight:600; color:#0f766e;">${money(e['มูลค่า'])}</span>
                </td>
                <td data-label="การจัดการ" style="text-align:center;">
                  <div style="display:inline-flex; gap:6px; justify-content:center; align-items:center;">
                    ${st !== 'ประจำจุด' ? `<button class="btn btn-sm btn-primary" onclick="quickBorrow(${jsArg(e['รหัส'])},${jsArg(e['ชื่ออุปกรณ์'])})" title="ยืมอุปกรณ์นี้" style="padding:4px 10px; font-weight:600;">📦 ยืม</button>` : ''}
                    ${isAdmin() ? `<button class="btn btn-sm btn-info" onclick="showQrModal(${jsArg(e['รหัส'] || e['รหัสครุภัณฑ์'])}, ${jsArg(e['ชื่ออุปกรณ์'])})" title="สร้าง QR Code" style="padding:4px 8px;">🔲 QR</button>
                    <button class="btn btn-sm btn-secondary" onclick="openLabelPrintModal([${jsArg(e['รหัส'] || e['รหัสครุภัณฑ์'])}])" title="พิมพ์ป้ายสติกเกอร์ (PT-P710BT)" style="padding:4px 8px;">🏷️</button>` : ''}
                    ${canManageEquipment() ? `
                      <button class="btn btn-sm btn-secondary" onclick="addEquipmentHandover(null, ${jsArg(e['รหัส'])})" title="สร้างใบส่งมอบ/รับคืนสำหรับครุภัณฑ์นี้" style="padding:4px 8px;">📋</button>
                      <button class="btn btn-sm btn-secondary" onclick="editEquip(${equipKey})" title="แก้ไขครุภัณฑ์" style="padding:4px 8px;">✏️</button>
                      <button class="btn btn-sm btn-danger" onclick="delEquip(${equipKey}, ${jsArg(e['ชื่ออุปกรณ์'])})" title="ลบครุภัณฑ์" style="padding:4px 8px;">🗑️</button>
                    ` : ''}
                  </div>
                </td>
              </tr>`;
}

function eqGroupRowHtml(g, continued) {
  if (continued) {
    return `<tr><td colspan="6" style="background:#f8fafc; color:#64748b; font-size:12px; padding:6px 20px;">${esc(g.name)} <em>(ต่อจากหน้าก่อน)</em></td></tr>`;
  }
  return `<tr class="eq-group" onclick="window._efToggleGroup(${jsArg(g.id)})" style="cursor:pointer;">
    <td colspan="6" style="background:#f0fdfa; border-top:2px solid #99f6e4; padding:10px 20px; font-weight:700; color:#0f766e;">
      <span style="display:inline-block; width:18px;">${g.collapsed ? '▶' : '▼'}</span>${esc(eqState().group === 'cat' ? eqCatLabel(g.name) : g.name)}
      <span style="font-weight:500; color:#64748b; font-size:12px; margin-left:8px;">${fmt(g.count)} รายการ · มูลค่ารวม ${money(g.sum)}</span>
    </td></tr>`;
}

function eqPagerHtml(pg, st) {
  if (pg.total === 0) return '';
  const from = st.pageSize ? (pg.page - 1) * st.pageSize + 1 : 1;
  const to = st.pageSize ? Math.min(pg.page * st.pageSize, pg.total) : pg.total;
  const btn = (label, page, disabled) => `<button class="btn btn-sm btn-secondary" ${disabled ? 'disabled' : `onclick="window._efPage(${page})"`} style="min-width:36px;">${label}</button>`;
  return `<div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:12px 20px; border-top:1px solid #e2e8f0; font-size:13px; color:#475569;">
      <div>แสดง ${fmt(from)}–${fmt(to)} จาก ${fmt(pg.total)} แถว</div>
      <div style="display:flex; align-items:center; gap:6px;">
        ${btn('«', 1, pg.page <= 1)}${btn('‹ ก่อนหน้า', pg.page - 1, pg.page <= 1)}
        <span style="padding:0 8px;">หน้า ${pg.page} / ${pg.pages}</span>
        ${btn('ถัดไป ›', pg.page + 1, pg.page >= pg.pages)}${btn('»', pg.pages, pg.page >= pg.pages)}
      </div>
    </div>`;
}

function renderEquipment() {
  const st = eqState();
  const getFiltered = () => eqFilter(DATA.equipment, st);

  // พิมพ์ป้ายสติกเกอร์ของรายการที่กรองอยู่ (ไม่เกิน 100 ชิ้นต่อครั้ง กันสั่งพิมพ์พลาดทั้งคลัง)
  window._efPrintLabels = () => {
    const list = getFiltered();
    if (!list.length) { toast('ไม่มีรายการให้พิมพ์', 'warning'); return; }
    if (list.length > 100) { toast('รายการมากกว่า 100 ชิ้น กรุณากรองให้แคบลงก่อน (' + list.length + ')', 'warning'); return; }
    openLabelPrintModal(list);
  };

  const sortTh = (key, label, style) => {
    const on = st.sortKey === key;
    const arrow = on ? (st.sortDir === 'desc' ? '▼' : '▲') : '↕';
    return `<th onclick="window._efSort('${key}')" title="คลิกเพื่อเรียงลำดับ" style="cursor:pointer; user-select:none; white-space:nowrap; ${style || ''}">${label} <span style="font-size:10px; color:${on ? '#0f766e' : '#cbd5e1'};">${arrow}</span></th>`;
  };

  const resultsHtml = (items) => {
    EQ_HO_MAP = (typeof hoActiveByEquip === 'function') ? hoActiveByEquip() : new Map();
    const entries = eqBuildEntries(items, st);
    const pg = eqPaginate(entries, st.page, st.pageSize);
    st.page = pg.page; // ถูกบีบให้อยู่ในช่วงถ้าข้อมูลลดลง
    const isFiltered = !!(st.text || st.cat || st.status || st.loc);
    let body = '';
    let lastGroup = null;
    pg.slice.forEach((en, i) => {
      if (en.type === 'group') { body += eqGroupRowHtml(en, false); lastGroup = en.name; return; }
      if (st.group && en.group !== lastGroup) { body += eqGroupRowHtml({ name: en.group }, true); lastGroup = en.group; }
      body += eqRowHtml(en.e);
    });
    if (!body) {
      body = `
              <tr>
                <td colspan="6">
                  <div style="text-align:center; padding:48px 20px; background:#fafafa; border-radius:12px;">
                    <div style="font-size:44px; margin-bottom:10px;">${isFiltered ? '🔍' : '🏬'}</div>
                    <div style="font-size:16px; font-weight:700; color:#334155;">
                      ${isFiltered ? 'ไม่พบข้อมูลอุปกรณ์ตามเงื่อนไขที่ค้นหาบนระบบ' : 'ยังไม่มีข้อมูลครุภัณฑ์ในระบบ'}
                    </div>
                    <div style="font-size:13px; color:#64748b; margin-top:4px; margin-bottom:16px;">
                      ${isFiltered ? `คำค้นหา "${esc(st.text)}": ไม่พบรายการที่ตรงกับตัวกรอง` : 'เริ่มต้นใช้งานโดยการเพิ่มรายการอุปกรณ์ใหม่ หรือนำเข้าข้อมูลครุภัณฑ์ผ่าน Excel / Google Sheet'}
                    </div>
                    <div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap;">
                      ${isFiltered ? `<button class="btn btn-sm btn-secondary" onclick="window._ef('','','','')" style="border-radius:8px;">🔄 ล้างตัวกรองค้นหา</button>` : ''}
                      ${canManageEquipment() ? `
                        <button class="btn btn-sm btn-primary" onclick="addEquipWithCode(${jsArg(st.text)})" style="border-radius:8px;">
                          ➕ ${isFiltered ? 'เพิ่มอุปกรณ์ใหม่ด้วยชื่อ/รหัสนี้' : 'เพิ่มอุปกรณ์ใหม่รายการแรก'}
                        </button>
                        ${!isFiltered ? `<button class="btn btn-sm btn-info" onclick="openImportEquipmentModal()" style="border-radius:8px;">📥 นำเข้าข้อมูล (Import Excel)</button>` : ''}
                      ` : ''}
                    </div>
                  </div>
                </td>
              </tr>`;
    }
    return `
    <div class="card" id="eResults">
      <div class="card-body" style="padding:0">
        <div class="table-wrap" style="border:none">
          <table>
            <thead>
              <tr>
                ${sortTh('tag', 'รหัสครุภัณฑ์ &amp; หมวดหมู่', 'padding-left:20px;')}
                ${sortTh('name', 'ชื่ออุปกรณ์ &amp; ยี่ห้อ/รุ่น')}
                ${sortTh('qty', 'จำนวน &amp; สถานะคลัง')}
                ${sortTh('loc', 'สถานที่จัดเก็บ')}
                ${sortTh('price', 'มูลค่า/หน่วย')}
                <th style="text-align:center;">การจัดการ</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        ${eqPagerHtml(pg, st)}
      </div>
    </div>`;
  };

  const render = () => {
    const items = getFiltered();
    const all = DATA.equipment;
    const valAll = all.length;
    const count = (s) => all.filter(e => e['สถานะ'] === s).length;
    const valReady = count('พร้อมยืม'), valBorrowed = count('อยู่ระหว่างยืม'), valStationed = count('ประจำจุด'), valDamaged = count('ชำรุด');
    const valTotalMoney = all.reduce((s, e) => s + (+e['มูลค่า'] || 0) * (+e['จำนวน'] || 1), 0);
    const tally = (field) => {
      const m = {};
      all.forEach(e => { const v = String(e[field] || '').trim(); if (v) m[v] = (m[v] || 0) + 1; });
      return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0], 'th'));
    };
    const catCounts = new Map(tally('หมวดหมู่'));
    const catList = [];
    const seenCat = new Set();
    eqCats().slice().sort(eqCatCompare).forEach(c => {
      const n = eqNorm(c['ชื่อหมวด']); if (!n || seenCat.has(n.toLowerCase())) return;
      seenCat.add(n.toLowerCase()); catList.push([n, catCounts.get(n) || 0]);
    });
    catCounts.forEach((n, name) => { if (!seenCat.has(eqNorm(name).toLowerCase())) catList.push([name, n]); });
    const locList = eqAllLocations().map(l => [l.name, l.count]);
    const isFiltered = !!(st.text || st.cat || st.status || st.loc);
    const selStyle = 'width:100%; padding:10px 14px; border-radius:10px; border:1px solid #cbd5e1; font-size:14px; outline:none; cursor:pointer; box-sizing:border-box; background:#fff;';
    const heroBtn = 'background:rgba(255,255,255,0.18); border:1px solid rgba(255,255,255,0.35); color:#fff; font-weight:600; border-radius:10px; padding:8px 14px;';

    return `
    <div style="background:linear-gradient(135deg,#0f766e 0%,#0d9488 55%,#06b6d4 100%); border-radius:20px; padding:20px 24px; margin-bottom:20px; box-shadow:0 8px 32px rgba(15,118,110,0.25); position:relative; overflow:hidden; color:#fff;">
      <div style="position:absolute; width:220px; height:220px; border-radius:50%; background:rgba(255,255,255,0.06); top:-70px; right:-50px; pointer-events:none;"></div>
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:14px;">
          <div style="background:rgba(255,255,255,0.18); border-radius:14px; width:52px; height:52px; display:flex; align-items:center; justify-content:center; font-size:26px; flex-shrink:0;">🏬</div>
          <div>
            <div style="font-size:20px; font-weight:700; line-height:1.2;">คลังทะเบียนอุปกรณ์ &amp; ครุภัณฑ์</div>
            <div style="color:rgba(255,255,255,0.82); font-size:13px; margin-top:4px;">
              ทะเบียนครุภัณฑ์ทั้งหมด <strong>${valAll}</strong> รายการ | มูลค่ารวม <strong style="color:#fef08a;">${money(valTotalMoney)}</strong> บาท
            </div>
          </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          ${canManageEquipment() ? `
            <button class="btn btn-sm" onclick="addEquip()" style="background:#10b981; border:none; color:#fff; font-weight:700; border-radius:10px; padding:8px 14px; box-shadow:0 4px 12px rgba(16,185,129,0.35);">➕ เพิ่มอุปกรณ์ใหม่</button>
            <button class="btn btn-sm" onclick="openImportEquipmentModal()" style="${heroBtn}">📥 นำเข้า</button>
          ` : ''}
          ${canManageEquipment() ? `<button class="btn btn-sm" onclick="openCategoryManager()" title="จัดการหมวดหมู่ครุภัณฑ์ (ตามรหัส 4 หลักแรก)" style="${heroBtn}">🗂️ จัดการหมวดหมู่</button>` : ''}
          ${canManageEquipment() ? `<button class="btn btn-sm" onclick="openLocationManager()" title="เพิ่ม/แก้ไขสถานที่จัดเก็บ" style="${heroBtn}">📍 จัดการสถานที่</button>` : ''}
          ${isAdmin() ? `<button class="btn btn-sm" onclick="window._efPrintLabels()" title="พิมพ์ป้ายสติกเกอร์ Brother PT-P710BT ของรายการที่กรองอยู่" style="${heroBtn}">🏷️ พิมพ์ป้าย</button>` : ''}
          <button class="btn btn-sm" onclick="exportSheet('อุปกรณ์')" style="${heroBtn}">📊 Export</button>
        </div>
      </div>
    </div>

    <div class="stat-grid" style="margin-bottom: 20px;">
      <div class="stat s-blue" onclick="window._ef(undefined, undefined, '')" style="cursor:pointer; transition:transform 0.15s;" title="คลิกเพื่อดูอุปกรณ์ทั้งหมด">
        <div class="icon-big">💻</div><div class="label">ครุภัณฑ์ในระบบ</div>
        <div class="value">${valAll} <span style="font-size:14px;color:var(--gray-500)">รายการ</span></div>
        <div class="sub">ครอบคลุม ${catList.length} หมวดหมู่</div>
      </div>
      <div class="stat s-green" onclick="window._ef(undefined, undefined, 'พร้อมยืม')" style="cursor:pointer; transition:transform 0.15s;" title="คลิกเพื่อกรองเฉพาะพร้อมยืม">
        <div class="icon-big">✅</div><div class="label">พร้อมใช้งานในคลัง</div>
        <div class="value">${valReady} <span style="font-size:14px;color:var(--gray-500)">รายการ</span></div>
        <div class="sub">พร้อมสำหรับการยืม</div>
      </div>
      <div class="stat s-purple" onclick="window._ef(undefined, undefined, 'อยู่ระหว่างยืม')" style="cursor:pointer; transition:transform 0.15s;" title="คลิกเพื่อกรองเฉพาะกำลังยืม">
        <div class="icon-big">📦</div><div class="label">กำลังยืมใช้งานอยู่</div>
        <div class="value">${valBorrowed} <span style="font-size:14px;color:var(--gray-500)">รายการ</span></div>
        <div class="sub">อยู่นอกคลังขณะนี้</div>
      </div>
      <div class="stat s-red" onclick="window._ef(undefined, undefined, 'ชำรุด')" style="cursor:pointer; transition:transform 0.15s;" title="คลิกเพื่อกรองเฉพาะชำรุด">
        <div class="icon-big">⚠️</div><div class="label">ชำรุด / ส่งซ่อม</div>
        <div class="value">${valDamaged} <span style="font-size:14px;color:var(--gray-500)">รายการ</span></div>
        <div class="sub">งดให้บริการชั่วคราว</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 20px;">
      <div class="card-body" style="padding: 16px 20px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <div style="flex:1.5; min-width:220px;">
            <input id="eSearchText" value="${esc(st.text)}"
              placeholder="🔍 ค้นหา รหัสครุภัณฑ์, ชื่ออุปกรณ์, ยี่ห้อ, Serial, ที่เก็บ... (พิมพ์หลายคำได้)"
              oninput="window._efText(this.value)"
              style="width:100%; padding:10px 14px; border-radius:10px; border:1px solid #cbd5e1; font-size:14px; outline:none; box-sizing:border-box;">
          </div>
          <div style="flex:1; min-width:160px; max-width:220px;">
            <select id="eSearchCat" onchange="window._ef(undefined, this.value)" style="${selStyle}">
              <option value="">🏷️ ทุกหมวดหมู่ (${catList.length})</option>
              ${catList.map(([name, n]) => `<option value="${esc(name)}" ${st.cat === name ? 'selected' : ''}>${esc(eqCatLabel(name))} (${n})</option>`).join('')}
            </select>
          </div>
          <div style="flex:1; min-width:150px; max-width:200px;">
            <select id="eSearchStatus" onchange="window._ef(undefined, undefined, this.value)" style="${selStyle}">
              <option value="">📌 ทุกสถานะคลัง</option>
              <option value="พร้อมยืม" ${st.status === 'พร้อมยืม' ? 'selected' : ''}>🟢 พร้อมยืม (${valReady})</option>
              <option value="อยู่ระหว่างยืม" ${st.status === 'อยู่ระหว่างยืม' ? 'selected' : ''}>📦 อยู่ระหว่างยืม (${valBorrowed})</option>
              <option value="ประจำจุด" ${st.status === 'ประจำจุด' ? 'selected' : ''}>🖥️ ประจำจุด (${valStationed})</option>
              <option value="ชำรุด" ${st.status === 'ชำรุด' ? 'selected' : ''}>🔴 ชำรุด (${valDamaged})</option>
            </select>
          </div>
          <div style="flex:1; min-width:160px; max-width:220px;">
            <select id="eSearchLoc" onchange="window._ef(undefined, undefined, undefined, this.value)" style="${selStyle}">
              <option value="">📍 ทุกสถานที่จัดเก็บ (${locList.length})</option>
              ${locList.map(([name, n]) => `<option value="${esc(name)}" ${st.loc === name ? 'selected' : ''}>${esc(name)} (${n})</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:12px;">
          <label style="font-size:13px; color:#64748b;">จัดกลุ่มตาม</label>
          <select onchange="window._efSet({group: this.value})" style="padding:8px 12px; border-radius:10px; border:1px solid #cbd5e1; font-size:13px; background:#fff;">
            <option value="">ไม่จัดกลุ่ม</option>
            ${Object.entries(EQ_GROUPS).map(([k, g]) => `<option value="${k}" ${st.group === k ? 'selected' : ''}>${g.label}</option>`).join('')}
          </select>
          ${st.group ? `<button class="btn btn-sm btn-secondary" onclick="window._efCollapseAll(true)">▶ ย่อทั้งหมด</button><button class="btn btn-sm btn-secondary" onclick="window._efCollapseAll(false)">▼ ขยายทั้งหมด</button>` : ''}
          <label style="font-size:13px; color:#64748b; margin-left:8px;">แถวต่อหน้า</label>
          <select onchange="window._efSet({pageSize: +this.value})" style="padding:8px 12px; border-radius:10px; border:1px solid #cbd5e1; font-size:13px; background:#fff;">
            ${EQ_PAGE_SIZES.map(n => `<option value="${n}" ${st.pageSize === n ? 'selected' : ''}>${n || 'ทั้งหมด'}</option>`).join('')}
          </select>
          ${st.sortKey ? `<button class="btn btn-sm btn-secondary" onclick="window._efSet({sortKey: '', sortDir: 'asc'})" title="กลับไปลำดับเดิม">↕ ล้างการเรียง</button>` : ''}
          <div id="eCountWrap" style="display:flex; align-items:center; gap:8px; margin-left:auto;">
            <span class="badge b-blue" style="font-size:12px; padding:8px 12px; border-radius:10px; font-weight:700; white-space:nowrap;">แสดง ${items.length} / ${valAll} รายการ</span>
            ${isFiltered ? `<button class="btn btn-sm btn-outline-danger" onclick="window._ef('','','','')" style="border-radius:10px; padding:8px 12px; font-weight:600;">✕ ล้างการกรอง</button>` : ''}
          </div>
        </div>
      </div>
    </div>

    ${resultsHtml(items)}
  `;
  };

  const repaint = () => { $('content').innerHTML = render(); };

  // handler ใน HTML ส่ง undefined = คงค่าเดิมไว้ — ห้ามอ่านตัวแปรกรองจาก inline handler
  // เพราะ renderEquipment ถูกเรียกซ้ำทุกรอบ auto-refresh (state อยู่ที่ window.EQUIPMENT_FILTER_STATE)
  window._ef = (text, catVal, statusVal, locVal) => {
    if (text !== undefined) st.text = text;
    if (catVal !== undefined) st.cat = catVal;
    if (statusVal !== undefined) st.status = statusVal;
    if (locVal !== undefined) st.loc = locVal;
    st.page = 1;
    repaint();
  };
  window._efSet = (patch) => {
    Object.assign(st, patch);
    if (!('page' in patch)) st.page = 1;
    repaint();
  };
  window._efSort = (key) => {
    if (st.sortKey !== key) { st.sortKey = key; st.sortDir = 'asc'; }
    else if (st.sortDir === 'asc') st.sortDir = 'desc';
    else { st.sortKey = ''; st.sortDir = 'asc'; } // รอบที่ 3 = กลับไปลำดับเดิม
    st.page = 1;
    repaint();
  };
  window._efPage = (n) => { st.page = n; repaint(); const r = document.getElementById('eResults'); if (r) r.scrollIntoView({ block: 'start' }); };
  window._efToggleGroup = (id) => {
    st.collapsed = Object.assign({}, st.collapsed);
    if (st.collapsed[id]) delete st.collapsed[id]; else st.collapsed[id] = true;
    repaint();
  };
  window._efCollapseAll = (collapse) => {
    const entries = eqBuildEntries(getFiltered(), Object.assign({}, st, { collapsed: {} }));
    st.collapsed = {};
    if (collapse) entries.filter(e => e.type === 'group').forEach(g => { st.collapsed[g.id] = true; });
    st.page = 1;
    repaint();
  };

  // ค้นหาแบบเรียลไทม์: อัปเดตเฉพาะตารางและตัวนับ ไม่สร้างช่อง input ใหม่
  // (สร้างใหม่ทุกตัวอักษรทำให้เสีย focus / คีย์บอร์ดมือถือหุบ / พิมพ์ไทยสะดุด)
  window._efText = (text) => {
    st.text = text;
    st.page = 1;
    const tmp = document.createElement('div');
    tmp.innerHTML = render();
    ['eResults', 'eCountWrap'].forEach(id => {
      const cur = document.getElementById(id);
      const next = tmp.querySelector('#' + id);
      if (cur && next) cur.replaceWith(next);
    });
  };

  repaint();
}

// ------------------------------------------------------------------ 4) ฟอร์ม เพิ่ม/แก้ไข/ลบ
const EQ_ASSET_TYPES = ['ครุภัณฑ์สำนักงาน', 'ครุภัณฑ์คอมพิวเตอร์', 'ครุภัณฑ์การแพทย์', 'ครุภัณฑ์ไฟฟ้าและวิทยุ', 'ครุภัณฑ์ยานพาหนะและขนส่ง', 'ครุภัณฑ์งานบ้านงานครัว', 'ครุภัณฑ์โฆษณาและเผยแพร่', 'ครุภัณฑ์อื่น ๆ'];
const EQ_DEPR_TYPES = ['ไม่คิดค่าเสื่อม', 'เส้นตรง (Straight-line)', 'ยอดลดลง (Declining balance)', 'ผลผลิตหน่วย (Units of production)']; // ต้องตรงกับ DEPRECIATION_TYPES ใน backend

function eqDatalist(id, field, extra) {
  const vals = eqDistinct(field);
  (extra || []).forEach(x => { if (!vals.some(v => v.toLowerCase() === x.toLowerCase())) vals.push(x); });
  vals.sort((a, b) => a.localeCompare(b, 'th'));
  return `<datalist id="${id}">${vals.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

// ---- รูปภาพหลายรูป: กรอบรูปจำลอง (สูงสุด EQ_PHOTO_MAX รูป, รูปแรก = รูปหลัก) ----
const EQ_PHOTO_MAX = 6;
// items: ลำดับที่แสดง/บันทึก; { url } = รูปเดิมที่อัปโหลดแล้ว, { dataUrl, base64, contentType } = รูปใหม่ที่ยังไม่อัปโหลด
const EQ_PHOTO = { items: [], busy: false, pendingLabel: '' };
// มุมถ่ายที่แนะนำ (ถ่ายตามมุมแล้วระบบติดป้ายชื่อมุมให้ — เปลี่ยนได้ภายหลัง)
const EQ_ANGLES = ['ด้านหน้า', 'ด้านหลัง', 'ด้านข้าง', 'ป้ายครุภัณฑ์', 'ซีเรียล/รุ่น'];
function eqPhotoLabels(e) { const m = e && e['ป้ายกำกับรูป']; return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }

function eqPhotoList(e) {
  const arr = Array.isArray(e && e['รูปภาพทั้งหมด']) ? e['รูปภาพทั้งหมด'].filter(u => /^https?:\/\//i.test(u)) : [];
  if (arr.length) return arr;
  return e && /^https?:\/\//i.test(e['รูปภาพ'] || '') ? [e['รูปภาพ']] : [];
}

function eqEnsureFrameCss() {
  if (document.getElementById('eq-frame-css')) return;
  const st = document.createElement('style');
  st.id = 'eq-frame-css';
  st.textContent = `
    .eq-gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(132px,1fr)); gap:14px; }
    .eq-frame { position:relative; aspect-ratio:1/1; background:linear-gradient(135deg,#a16207,#78350f); padding:8px; border-radius:4px;
      box-shadow:0 4px 10px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.18); }
    .eq-frame.cover { background:linear-gradient(135deg,#facc15,#a16207); box-shadow:0 4px 12px rgba(161,98,7,.45), inset 0 0 0 1px rgba(255,255,255,.35); }
    .eq-frame .mat { width:100%; height:100%; background:#f8fafc; padding:6px; box-sizing:border-box; box-shadow:inset 0 0 6px rgba(0,0,0,.35); }
    .eq-frame .mat img { width:100%; height:100%; object-fit:cover; display:block; cursor:zoom-in; background:#e2e8f0; }
    .eq-frame .tag { position:absolute; left:6px; top:-9px; background:#0f766e; color:#fff; font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px; }
    .eq-frame .tools { position:absolute; right:4px; bottom:4px; display:flex; gap:4px; }
    .eq-frame .tools button { border:none; border-radius:6px; width:26px; height:26px; cursor:pointer; background:rgba(15,23,42,.8); color:#fff; font-size:13px; line-height:1; }
    .eq-frame .tools button:hover { background:#0f766e; }
    .eq-frame .tools button.del:hover { background:#dc2626; }
    .eq-angles { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
    .eq-angle { border:1px solid #99f6e4; background:#f0fdfa; color:#0f766e; border-radius:16px; padding:5px 12px; font-size:12px; font-weight:600; cursor:pointer; }
    .eq-angle.done { background:#dcfce7; border-color:#86efac; color:#15803d; }
    .eq-angle:disabled { opacity:.45; cursor:not-allowed; }
    .eq-frame .lbl { position:absolute; left:8px; bottom:4px; max-width:calc(100% - 70px); font-size:10px; padding:1px 3px; border-radius:6px; border:none; background:rgba(15,23,42,.8); color:#fff; }
    .eq-slot { aspect-ratio:1/1; border:2px dashed #cbd5e1; border-radius:4px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#94a3b8; font-size:12px; gap:4px; box-sizing:border-box; }
    .eq-slot.add { cursor:pointer; border-color:#0d9488; color:#0f766e; background:#f0fdfa; }
    .eq-slot.add:hover { background:#ccfbf1; }
    .eq-slot .plus { font-size:30px; line-height:1; }
    .eq-viewer { position:fixed; inset:0; z-index:100000; background:rgba(2,6,23,.92); display:flex; align-items:center; justify-content:center; flex-direction:column; gap:12px; }
    .eq-viewer .stage { background:linear-gradient(135deg,#a16207,#78350f); padding:14px; border-radius:6px; box-shadow:0 10px 40px rgba(0,0,0,.6); }
    .eq-viewer .stage .mat { background:#f8fafc; padding:12px; box-shadow:inset 0 0 10px rgba(0,0,0,.4); }
    .eq-viewer img { max-width:min(86vw,900px); max-height:68vh; display:block; }
    .eq-viewer .cap { color:#fde68a; font-size:15px; font-weight:700; }
    .eq-viewer .bar { color:#e2e8f0; font-size:14px; display:flex; gap:14px; align-items:center; }
    .eq-viewer button { background:#334155; color:#fff; border:none; border-radius:8px; padding:8px 14px; cursor:pointer; font-size:14px; }`;
  document.head.appendChild(st);
}

function eqPhotoInit(e) {
  const labels = eqPhotoLabels(e);
  EQ_PHOTO.items = eqPhotoList(e).map(url => ({ url, label: labels[url] || '' }));
  EQ_PHOTO.busy = false;
  EQ_PHOTO.pendingLabel = '';
}

function eqGalleryHtml() {
  eqEnsureFrameCss();
  const items = EQ_PHOTO.items;
  const full = items.length >= EQ_PHOTO_MAX;
  const have = new Set(items.map(it => it.label).filter(Boolean));
  const angleChips = EQ_ANGLES.map(a => `<button type="button" class="eq-angle ${have.has(a) ? 'done' : ''}" ${full ? 'disabled' : ''} onclick="eqPhotoCapture(${jsArg(a)})" title="ถ่ายภาพมุม “${esc(a)}”">${have.has(a) ? '✓' : '📷'} ${esc(a)}</button>`).join('');
  const cells = [];
  items.forEach((it, i) => {
    cells.push(`
      <div class="eq-frame ${i === 0 ? 'cover' : ''}">
        ${i === 0 ? '<span class="tag">⭐ รูปหลัก</span>' : ''}
        <div class="mat"><img src="${esc(it.url || it.dataUrl)}" alt="รูปที่ ${i + 1}" onclick="eqPhotoPreview(${i})" title="คลิกเพื่อดูรูปใหญ่"></div>
        <select class="lbl" onchange="eqPhotoSetLabel(${i}, this.value)" aria-label="มุมภาพของรูปที่ ${i + 1}">
          <option value="">มุม: ไม่ระบุ</option>
          ${EQ_ANGLES.map(a => `<option ${it.label === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
          ${it.label && !EQ_ANGLES.includes(it.label) ? `<option selected>${esc(it.label)}</option>` : ''}
        </select>
        <div class="tools">
          ${i === 0 ? '' : `<button type="button" title="ตั้งเป็นรูปหลัก" aria-label="ตั้งเป็นรูปหลัก" onclick="eqPhotoMakeCover(${i})">⭐</button>`}
          <button type="button" class="del" title="ลบรูปนี้" aria-label="ลบรูปนี้" onclick="eqPhotoRemove(${i})">✕</button>
        </div>
      </div>`);
  });
  if (!full) {
    cells.push(`<div class="eq-slot add" role="button" tabindex="0" onclick="eqPhotoPick()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();eqPhotoPick();}"><span class="plus">＋</span>เลือกรูปจากเครื่อง</div>`);
  }
  for (let i = cells.length; i < EQ_PHOTO_MAX; i++) cells.push(`<div class="eq-slot" aria-hidden="true"><span>🖼️</span>ว่าง</div>`);
  return `<div class="eq-angles">${angleChips}</div>
    <div class="eq-gallery">${cells.join('')}</div>
    <div style="font-size:12px; color:#64748b; margin-top:8px;">ถ่ายได้หลายมุม สูงสุด ${EQ_PHOTO_MAX} รูป (${items.length}/${EQ_PHOTO_MAX}) · กดปุ่มมุมเพื่อเปิดกล้องแล้วระบบติดป้ายชื่อมุมให้ · รูปแรกเป็นรูปหลัก (กด ⭐ เพื่อเปลี่ยน) · ระบบย่อรูปให้อัตโนมัติ</div>
    <input type="file" id="e_photos" accept="image/*" multiple style="display:none" onchange="eqPhotoAddFiles(this)">
    <input type="file" id="e_photo_cam" accept="image/*" capture="environment" style="display:none" onchange="eqPhotoAddFiles(this, EQ_PHOTO.pendingLabel)">`;
}

function eqPhotoRepaint() {
  const box = document.getElementById('e_gallery');
  if (box) box.innerHTML = eqGalleryHtml();
}
function eqPhotoPick() { const i = document.getElementById('e_photos'); if (i) i.click(); }

// ย่อรูปฝั่งเบราว์เซอร์ก่อนส่ง (ถ้าถอดรหัสไม่ได้ เช่น HEIC จะส่งไฟล์ต้นฉบับแทน แต่แสดงตัวอย่างไม่ได้)
function eqCompressFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
    reader.onload = (ev) => {
      const raw = ev.target.result;
      const raw64 = () => { const c = raw.indexOf(','); return c >= 0 ? raw.slice(c + 1) : raw; };
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.width, h = img.height;
          const max = maxDim || 1024;
          if (w > max || h > max) { if (w > h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = cv.toDataURL('image/jpeg', quality || 0.7);
          resolve({ dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), contentType: 'image/jpeg' });
        } catch (err) { resolve({ dataUrl: raw, base64: raw64(), contentType: file.type || 'image/jpeg' }); }
      };
      img.onerror = () => resolve({ dataUrl: raw, base64: raw64(), contentType: file.type || 'image/jpeg' });
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

async function eqPhotoAddFiles(input, label) {
  const files = Array.from((input && input.files) || []).filter(f => /^image\//.test(f.type || '') || /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name || ''));
  input.value = '';
  if (!files.length) return;
  const room = EQ_PHOTO_MAX - EQ_PHOTO.items.length;
  if (files.length > room) toast('แนบได้อีก ' + room + ' รูป — ข้ามไฟล์ส่วนที่เกิน', 'warning');
  for (const f of files.slice(0, Math.max(0, room))) {
    try { const it = await eqCompressFile(f, 1024, 0.7); it.label = label || ''; EQ_PHOTO.items.push(it); }
    catch (err) { toast('เพิ่มรูปไม่สำเร็จ: ' + err.message, 'error'); }
  }
  eqPhotoRepaint();
}
function eqPhotoCapture(label) {
  EQ_PHOTO.pendingLabel = label || '';
  const i = document.getElementById('e_photo_cam');
  if (i) i.click();
}
function eqPhotoSetLabel(i, v) { if (EQ_PHOTO.items[i]) { EQ_PHOTO.items[i].label = v || ''; eqPhotoRepaint(); } }
// เพิ่มรูปจากแคนวาส/ข้อมูลภาพที่มีอยู่แล้ว (เช่น ภาพที่ใช้อ่านป้ายด้วย OCR) — คืน false ถ้าเต็ม
function eqPhotoAddDataUrl(dataUrl, label) {
  if (EQ_PHOTO.items.length >= EQ_PHOTO_MAX) return false;
  EQ_PHOTO.items.push({ dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), contentType: 'image/jpeg', label: label || '' });
  eqPhotoRepaint();
  return true;
}
function eqPhotoRemove(i) { EQ_PHOTO.items.splice(i, 1); eqPhotoRepaint(); }
function eqPhotoMakeCover(i) { const [it] = EQ_PHOTO.items.splice(i, 1); EQ_PHOTO.items.unshift(it); eqPhotoRepaint(); }
function eqPhotoPreview(i) { eqOpenViewer(EQ_PHOTO.items.map(x => x.url || x.dataUrl), i, EQ_PHOTO.items.map(x => x.label || '')); }

// ตัวดูรูปเต็ม (กรอบรูปใหญ่) — ใช้ทั้งในฟอร์มและตารางคลัง
function eqOpenViewer(urls, start, labels) {
  if (!urls || !urls.length) return;
  eqEnsureFrameCss();
  let idx = Math.min(Math.max(0, start || 0), urls.length - 1);
  const ov = document.createElement('div');
  ov.className = 'eq-viewer';
  const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
  const draw = () => {
    const cap = labels && labels[idx] ? labels[idx] : '';
    ov.innerHTML = `<div class="stage"><div class="mat"><img src="${esc(urls[idx])}" alt="รูปที่ ${idx + 1}"></div></div>
      ${cap ? `<div class="cap">มุม: ${esc(cap)}</div>` : ''}
      <div class="bar">
        <button type="button" ${urls.length < 2 ? 'disabled' : ''} data-act="prev" aria-label="รูปก่อนหน้า">‹</button>
        <span>${idx + 1} / ${urls.length}${idx === 0 ? ' · ⭐ รูปหลัก' : ''}</span>
        <button type="button" ${urls.length < 2 ? 'disabled' : ''} data-act="next" aria-label="รูปถัดไป">›</button>
        <button type="button" data-act="close">ปิด</button>
      </div>`;
  };
  const step = (d) => { idx = (idx + d + urls.length) % urls.length; draw(); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); else if (ev.key === 'ArrowRight') step(1); else if (ev.key === 'ArrowLeft') step(-1); };
  ov.addEventListener('click', (ev) => {
    const act = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-act');
    if (act === 'prev') step(-1); else if (act === 'next') step(1); else if (act === 'close' || ev.target === ov) close();
  });
  document.addEventListener('keydown', onKey);
  draw();
  document.body.appendChild(ov);
}

// รูปย่อในตารางคลัง: รูปหลัก + ตัวเลขจำนวนรูป คลิกเปิดดูทั้งชุด
function eqPhotoCell(e) {
  const list = eqPhotoList(e);
  if (!list.length) return '';
  return `<span style="position:relative; display:inline-block; margin-right:8px; vertical-align:middle;">
    <img src="${esc(list[0])}" onclick="eqViewEquipPhotos(${jsArg(e['รหัส'])})" title="คลิกดูรูป${list.length > 1 ? 'ทั้ง ' + list.length + ' รูป' : ''}" alt="" style="width:40px; height:40px; object-fit:cover; border-radius:8px; border:1px solid #e2e8f0; cursor:zoom-in; display:block;">
    ${list.length > 1 ? `<span style="position:absolute; right:-4px; bottom:-4px; background:#0f766e; color:#fff; font-size:10px; font-weight:700; border-radius:10px; padding:1px 5px; border:1px solid #fff;">${list.length}</span>` : ''}
  </span>`;
}
function eqViewEquipPhotos(id) {
  const e = (DATA.equipment || []).find(x => String(x['รหัส']) === String(id));
  const list = eqPhotoList(e || {}), lm = eqPhotoLabels(e || {});
  eqOpenViewer(list, 0, list.map(u => lm[u] || ''));
}

// ค่าเสื่อมราคาเฉลี่ยต่อปี (เส้นตรง) แสดงเป็นข้อมูลประกอบในฟอร์มเท่านั้น
function eqDeprHint() {
  const el = document.getElementById('e_depr_hint');
  if (!el) return;
  const type = $('e_depr').value, life = +$('e_life').value, price = +$('e_price').value, qty = +$('e_qty').value;
  const lifeBox = document.getElementById('e_life_wrap');
  if (lifeBox) lifeBox.style.opacity = type && type !== 'ไม่คิดค่าเสื่อม' ? '1' : '.5';
  if (type.startsWith('เส้นตรง') && life > 0 && price > 0) {
    const total = price * (qty > 0 ? qty : 1);
    el.textContent = '≈ ค่าเสื่อมปีละ ' + money(total / life) + ' (มูลค่ารวม ' + money(total) + ' ÷ ' + life + ' ปี)';
  } else if (type.startsWith('เส้นตรง')) {
    el.textContent = 'กรอกอายุการใช้งาน (ปี) และมูลค่า เพื่อดูค่าเสื่อมโดยประมาณ';
  } else el.textContent = '';
}
function eqRefreshStaff() {
  const dl = document.getElementById('e_staff_list');
  const dept = $('e_dept') ? $('e_dept').value : '';
  if (dl && typeof hoStaffOptions === 'function') dl.innerHTML = hoStaffOptions(dept);
}
if (typeof window !== 'undefined') { window._eqDeprHint = eqDeprHint; window._eqRefreshStaff = eqRefreshStaff; }

function equipForm(e) {
  e = e || {};
  eqPhotoInit(e);
  let buyDate = '';
  if (e['วันที่จัดซื้อ']) {
    try {
      const d = new Date(e['วันที่จัดซื้อ']);
      buyDate = d.toISOString().split('T')[0];
    } catch (err) {
      buyDate = e['วันที่จัดซื้อ'];
    }
  }
  const sec = (t) => `<div class="field full" style="margin-top:6px;"><div style="font-weight:700; color:#0f766e; font-size:13px; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">${t}</div></div>`;
  const depts = (DATA.departments || []).map(d => d['ชื่อหน่วยงาน']).filter(Boolean);
  const curDept = e['หน่วยงานที่รับผิดชอบ'] || '';
  return `
    <div class="form-grid">
      ${sec('📌 ข้อมูลหลัก')}
      <div class="field"><label>รหัสครุภัณฑ์ (เว้นว่างได้ถ้ายังไม่มีป้าย)</label><input id="e_code" value="${esc(e['รหัสครุภัณฑ์'] || '')}" oninput="window._eqCodeChanged()"></div>
      <div class="field"><label>ชื่ออุปกรณ์ *</label><input id="e_name" value="${esc(e['ชื่ออุปกรณ์'] || '')}"></div>
      <div class="field"><label>หมวดหมู่ <small style="color:#94a3b8;">(เลือกอัตโนมัติจาก 4 หลักแรกของรหัสครุภัณฑ์)</small></label>
        <select id="e_cat" onchange="window._eqCatManual()">
          ${(e['หมวดหมู่'] && !eqCatByName(e['หมวดหมู่'])) ? `<option value="${esc(e['หมวดหมู่'])}" selected>${esc(e['หมวดหมู่'])}</option>` : ''}
          ${eqCats().slice().sort(eqCatCompare).map(c => `<option value="${esc(c['ชื่อหมวด'])}" ${eqNorm(c['ชื่อหมวด']).toLowerCase() === eqNorm(e['หมวดหมู่']).toLowerCase() ? 'selected' : ''}>${esc(eqCatLabel(c['ชื่อหมวด']))}</option>`).join('')}
        </select>
        <div id="e_cat_hint" style="font-size:12px; margin-top:4px; min-height:16px;"></div>
      </div>
      <div class="field"><label>ประเภทครุภัณฑ์ <small style="color:#94a3b8;">(เลือกหรือพิมพ์เอง)</small></label><input id="e_atype" list="eq_dl_atype" value="${esc(e['ประเภทครุภัณฑ์'] || '')}" placeholder="เช่น ครุภัณฑ์คอมพิวเตอร์"></div>
      <div class="field"><label>สถานะ</label>
        <select id="e_status">
          ${['พร้อมยืม', 'อยู่ระหว่างยืม', 'ประจำจุด', 'ชำรุด'].map(s => `<option ${e['สถานะ'] === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>

      ${sec('🖥️ รายละเอียดเครื่องและการจัดซื้อ')}
      <div class="field full"><button type="button" class="btn btn-sm btn-info" onclick="eqOpenOcr()" title="ถ่ายป้ายบนเครื่อง ระบบอ่านตัวอักษรแล้วเติมให้">📷 ถ่ายป้ายเพื่ออ่านเลขครุภัณฑ์ / Serial / รุ่น / ยี่ห้อ อัตโนมัติ</button></div>
      <div class="field"><label>ยี่ห้อ <small style="color:#94a3b8;">(เลือกจากที่เคยใช้ หรือพิมพ์ใหม่)</small></label><input id="e_brand" list="eq_dl_brand" value="${esc(e['ยี่ห้อ'] || '')}"></div>
      <div class="field"><label>รุ่น</label><input id="e_model" value="${esc(e['รุ่น'] || '')}"></div>
      <div class="field"><label>Serial Number</label><input id="e_sn" value="${esc(e['Serial'] || '')}"></div>
      <div class="field"><label>วันที่จัดซื้อ</label><input id="e_buy" type="date" value="${buyDate}"></div>
      <div class="field full"><label>ผู้จำหน่าย / ผู้ขาย <small style="color:#94a3b8;">(เลือกจากที่เคยใช้ หรือพิมพ์ใหม่)</small></label><input id="e_vendor" list="eq_dl_vendor" value="${esc(e['ผู้จำหน่าย'] || '')}" placeholder="เช่น บริษัท ... จำกัด"></div>

      ${sec('📍 ที่ตั้ง / ผู้รับผิดชอบ')}
      <div class="field"><label>ที่ตั้ง/ที่เก็บ <small style="color:#94a3b8;">(เลือกจากที่เคยใช้ หรือพิมพ์ใหม่)</small></label><input id="e_loc" list="eq_dl_loc" value="${esc(e['ที่เก็บ'] || '')}"></div>
      <div class="field"><label>หน่วยงานที่รับผิดชอบ</label>
        ${eqDeptInputHtml('e_dept', curDept, 'window._eqRefreshStaff()', 'พิมพ์เพื่อค้นหา หรือเว้นว่างถ้าไม่ระบุ')}
      </div>
      <div class="field full"><label>ผู้รับผิดชอบ <small style="color:#94a3b8;">(เลือกจากรายชื่อเจ้าหน้าที่ หรือพิมพ์เอง)</small></label>
        <input id="e_resp" list="e_staff_list" autocomplete="off" value="${esc(e['ผู้รับผิดชอบ'] || '')}" placeholder="พิมพ์ชื่อเพื่อค้นหา...">
        <datalist id="e_staff_list">${typeof hoStaffOptions === 'function' ? hoStaffOptions(curDept) : ''}</datalist>
      </div>

      ${sec('💰 จำนวน มูลค่า และค่าเสื่อมราคา')}
      <div class="field"><label>จำนวน</label><input id="e_qty" type="number" min="0" value="${esc(e['จำนวน'] ?? 1)}" oninput="window._eqDeprHint()"></div>
      <div class="field"><label>หน่วยนับ</label><input id="e_unit" list="eq_dl_unit" value="${esc(e['หน่วยนับ'] || 'เครื่อง')}"></div>
      <div class="field"><label>มูลค่า/หน่วย (บาท)</label><input id="e_price" type="number" min="0" value="${esc(e['มูลค่า'] ?? '')}" oninput="window._eqDeprHint()"></div>
      <div class="field"><label>ประเภทค่าเสื่อม</label>
        <select id="e_depr" onchange="window._eqDeprHint()">
          <option value="">-- ไม่ระบุ --</option>
          ${EQ_DEPR_TYPES.map(t => `<option ${e['ประเภทค่าเสื่อม'] === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="field" id="e_life_wrap"><label>อายุการใช้งาน (ปี)</label><input id="e_life" type="number" min="0" max="100" step="0.5" value="${esc(e['อายุการใช้งานปี'] ?? '')}" oninput="window._eqDeprHint()"></div>
      <div class="field"><label>&nbsp;</label><div id="e_depr_hint" style="font-size:12px; color:#0f766e; padding-top:10px;"></div></div>

      ${sec('🖼️ รูปภาพอุปกรณ์')}
      <div class="field full" id="e_gallery">${eqGalleryHtml()}</div>

      ${sec('📝 หมายเหตุ')}
      <div class="field full"><textarea id="e_note" rows="2">${esc(e['หมายเหตุ'] || '')}</textarea></div>
    </div>
    ${eqDatalist('eq_dl_brand', 'ยี่ห้อ')}${eqDatalist('eq_dl_loc', 'ที่เก็บ')}${eqDatalist('eq_dl_unit', 'หน่วยนับ')}
    ${eqDatalist('eq_dl_vendor', 'ผู้จำหน่าย')}${eqDatalist('eq_dl_atype', 'ประเภทครุภัณฑ์', EQ_ASSET_TYPES)}
    <img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="display:none" onload="window._eqDeprHint()">
  `;
}

// กรอกเลขครุภัณฑ์ -> เลือกหมวดให้อัตโนมัติ (เว้นแต่ผู้ใช้เลือกหมวดเองหลังจากนั้น แล้วค่อยแก้รหัสอีกครั้งจึงเลือกใหม่)
function eqCodeChanged() {
  const hint = $('e_cat_hint'), sel = $('e_cat');
  if (!sel || !hint) return;
  const prefix = eqTagPrefix($('e_code').value);
  if (!prefix) { hint.textContent = ''; return; }
  const c = eqCatByCode(prefix);
  if (!c) { hint.style.color = '#b45309'; hint.textContent = 'ยังไม่มีหมวดสำหรับรหัส ' + prefix + ' — สร้างได้ที่ปุ่ม 🗂️ จัดการหมวดหมู่'; return; }
  sel.value = c['ชื่อหมวด'];
  hint.style.color = '#0f766e';
  hint.textContent = '✓ รหัส ' + prefix + ' = ' + c['ชื่อหมวด'];
}

function eqCatManual() {
  const hint = $('e_cat_hint'), sel = $('e_cat');
  if (!hint || !sel) return;
  const prefix = eqTagPrefix($('e_code').value);
  const c = prefix ? eqCatByCode(prefix) : null;
  if (c && c['ชื่อหมวด'] !== sel.value) { hint.style.color = '#b45309'; hint.textContent = '⚠️ รหัส ' + prefix + ' ตรงกับหมวด "' + c['ชื่อหมวด'] + '" แต่เลือกหมวดอื่น'; }
  else { hint.textContent = ''; }
}
if (typeof window !== 'undefined') { window._eqCodeChanged = eqCodeChanged; window._eqCatManual = eqCatManual; }

// อ่านป้ายด้วยกล้อง (OCR) เติมฟอร์มอุปกรณ์ — เติมเฉพาะช่องว่าง ไฮไลต์ให้ตรวจ
function eqOpenOcr() {
  ocrOpenScanner({
    fields: { tag: 'e_code', serial: 'e_sn', model: 'e_model', brand: 'e_brand', name: 'e_name', note: 'e_note' },
    onApplied: () => { if (typeof window._eqCodeChanged === 'function') window._eqCodeChanged(); },
    addPhoto: (dataUrl, label) => eqPhotoAddDataUrl(dataUrl, label),
  });
}

function addEquip() {
  if (!canManageEquipment()) return;
  openModal('💻 เพิ่มอุปกรณ์ใหม่', equipForm(), () => saveEquip(), true);
  eqDeprHint();
}

function editEquip(row) {
  if (!canManageEquipment()) return;
  const e = DATA.equipment.find(x => x._row === row || String(x['รหัส']) === String(row));
  openModal('✏️ แก้ไขข้อมูลอุปกรณ์', equipForm(e), () => saveEquip(row), true);
  eqDeprHint();
}

// อัปโหลดรูปใหม่ทีละรูป (ต่อท้ายรายการฝั่ง server) แล้วจัดลำดับสุดท้ายตามที่ผู้ใช้เรียงไว้ — คืนจำนวนรูปที่อัปโหลดไม่สำเร็จ
// items = EQ_PHOTO.items ({url} = รูปเดิมที่เหลือ, {base64,...} = รูปใหม่) ใช้ร่วมกับโหมดสำรวจภาคสนาม
async function eqPersistPhotos(code, items) {
  const keptUrls = items.filter(it => it.url).map(it => it.url);
  const added = items.filter(it => !it.url);
  let failed = 0;
  const uploaded = new Map();
  for (let i = 0; i < added.length; i++) {
    const pr = await callApi('uploadEquipmentPhoto', code, added[i].base64, added[i].contentType, ADMIN_PASS, added[i].label || '');
    if (pr.success) uploaded.set(added[i], pr.url); else { failed++; toast('อัปโหลดรูปที่ ' + (i + 1) + ' ไม่สำเร็จ: ' + pr.message, 'warning'); }
  }
  if (uploaded.size) {
    const finalOrder = items.map(it => it.url || uploaded.get(it)).filter(Boolean);
    const serverOrder = keptUrls.concat(added.map(it => uploaded.get(it)).filter(Boolean));
    if (finalOrder.join('|') !== serverOrder.join('|')) {
      // ผู้ใช้ตั้งรูปใหม่เป็นรูปหลัก/สลับลำดับ — บันทึกลำดับสุดท้ายอีกครั้ง (ส่งเฉพาะรหัส + รายการรูป)
      const lm = {};
      items.forEach(it => { const u = it.url || uploaded.get(it); if (u && it.label) lm[u] = it.label; });
      const fr = await callApi('saveEquipment', { 'รหัส': code, 'รูปภาพทั้งหมด': finalOrder, 'ป้ายกำกับรูป': lm }, ADMIN_PASS);
      if (!fr.success) toast('บันทึกข้อมูลสำเร็จ แต่จัดลำดับรูปไม่สำเร็จ: ' + fr.message, 'warning');
    }
  }
  return failed;
}

async function saveEquip(row) {
  if (EQ_PHOTO.busy) return;
  if (!(await eqDeptEnsure('e_dept'))) return;
  const lifeRaw = $('e_life').value.trim();
  const data = {
    'รหัสครุภัณฑ์': eqNorm($('e_code').value), 'ชื่ออุปกรณ์': eqNorm($('e_name').value), 'หมวดหมู่': $('e_cat').value,
    'ประเภทครุภัณฑ์': eqCanon('ประเภทครุภัณฑ์', $('e_atype').value),
    'ยี่ห้อ': eqCanon('ยี่ห้อ', $('e_brand').value), 'รุ่น': eqNorm($('e_model').value), 'Serial': eqNorm($('e_sn').value),
    'ผู้จำหน่าย': eqCanon('ผู้จำหน่าย', $('e_vendor').value),
    'จำนวน': +$('e_qty').value, 'หน่วยนับ': eqCanon('หน่วยนับ', $('e_unit').value), 'ที่เก็บ': eqCanon('ที่เก็บ', $('e_loc').value),
    'หน่วยงานที่รับผิดชอบ': eqNorm($('e_dept').value), 'ผู้รับผิดชอบ': eqNorm($('e_resp').value),
    'มูลค่า': +$('e_price').value, 'ประเภทค่าเสื่อม': $('e_depr').value, 'อายุการใช้งานปี': lifeRaw === '' ? '' : +lifeRaw,
    'สถานะ': $('e_status').value, 'วันที่จัดซื้อ': $('e_buy').value,
    'หมายเหตุ': $('e_note').value.trim(),
  };
  if (!data['ชื่ออุปกรณ์']) { toast('กรอกชื่ออุปกรณ์', 'warning'); return; }
  if (!Number.isFinite(data['จำนวน']) || data['จำนวน'] < 0) { toast('จำนวนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', 'warning'); return; }
  if (!Number.isFinite(data['มูลค่า']) || data['มูลค่า'] < 0) { toast('มูลค่าต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', 'warning'); return; }
  if (data['อายุการใช้งานปี'] !== '' && (!Number.isFinite(data['อายุการใช้งานปี']) || data['อายุการใช้งานปี'] < 0 || data['อายุการใช้งานปี'] > 100)) { toast('อายุการใช้งานต้องอยู่ระหว่าง 0–100 ปี', 'warning'); return; }
  const tag = data['รหัสครุภัณฑ์'];
  if (tag) {
    const dup = DATA.equipment.find(x => eqNorm(x['รหัสครุภัณฑ์']) === tag && String(x['รหัส']) !== String(row || ''));
    if (dup) { toast('รหัสครุภัณฑ์ ' + tag + ' ซ้ำกับ "' + (dup['ชื่ออุปกรณ์'] || dup['รหัส']) + '" ในระบบ', 'warning'); return; }
  }
  if (row) data['รหัส'] = row;
  // รูปเดิมที่เหลืออยู่ (ตามลำดับที่ผู้ใช้จัด) — รูปใหม่จะอัปโหลดทีหลังแล้วค่อยจัดลำดับสุดท้าย
  const keptUrls = EQ_PHOTO.items.filter(it => it.url).map(it => it.url);
  data['รูปภาพทั้งหมด'] = keptUrls;
  data['ป้ายกำกับรูป'] = {};
  EQ_PHOTO.items.forEach(it => { if (it.url && it.label) data['ป้ายกำกับรูป'][it.url] = it.label; });

  EQ_PHOTO.busy = true;
  showLoading(true);
  try {
    const r = await callApi('saveEquipment', data, ADMIN_PASS);
    if (!r.success) { showLoading(false); toast(r.message, 'error'); return; }

    const failed = await eqPersistPhotos(r.code, EQ_PHOTO.items);

    showLoading(false);
    toast(failed ? 'บันทึกข้อมูลแล้ว แต่รูปอัปโหลดไม่สำเร็จ ' + failed + ' รูป' : 'บันทึกสำเร็จ', failed ? 'warning' : 'success');
    closeModal();
    refreshData();
  } catch (err) {
    showLoading(false);
    toast('ผิดพลาด: ' + err.message, 'error');
  } finally {
    EQ_PHOTO.busy = false;
  }
}

function delEquip(row, name) {
  if (!canManageEquipment()) return;
  const reason = prompt('กรุณาระบุเหตุผลในการลบอุปกรณ์ ' + (name || '') + ':');
  if (reason === null) return;
  if (!reason.trim()) { toast('กรุณาระบุเหตุผลในการลบข้อมูล', 'warning'); return; }
  showLoading(true);
  callApi('deleteEquipment', row, ADMIN_PASS, reason.trim())
    .then(r => {
      showLoading(false);
      if (r.success) {
        toast('ลบสำเร็จ');
        refreshData();
      } else {
        toast(r.message, 'error');
      }
    })
    .catch(err => {
      showLoading(false);
      toast('ผิดพลาด: ' + err.message, 'error');
    });
}

// ------------------------------------------------------------------ 5) จัดการสถานที่จัดเก็บ
function eqLocManagerHtml() {
  const locs = eqAllLocations();
  return `
    <div style="display:flex; gap:8px; margin-bottom:14px;">
      <input id="loc_new" placeholder="ชื่อสถานที่ใหม่ เช่น ห้องธุรการ&การเงิน ชั้น2" maxlength="100"
        onkeydown="if(event.key==='Enter'){event.preventDefault();addLocation();}"
        style="flex:1; padding:10px 14px; border-radius:10px; border:1px solid #cbd5e1; font-size:14px; box-sizing:border-box;">
      <button class="btn btn-primary" onclick="addLocation()" style="white-space:nowrap;">➕ เพิ่มสถานที่</button>
    </div>
    <div class="table-wrap" style="max-height:50vh; overflow:auto;">
      <table>
        <thead><tr><th>สถานที่จัดเก็บ</th><th style="text-align:center; width:110px;">อุปกรณ์</th><th style="text-align:center; width:130px;">จัดการ</th></tr></thead>
        <tbody>${locs.map(l => `
          <tr>
            <td data-label="สถานที่">📍 ${esc(l.name)}${l.inMaster ? '' : ' <span style="font-size:11px; color:#94a3b8;">(มาจากข้อมูลอุปกรณ์)</span>'}</td>
            <td data-label="อุปกรณ์" style="text-align:center;">${fmt(l.count)}</td>
            <td data-label="จัดการ" style="text-align:center;">
              <button class="btn btn-sm btn-secondary" onclick="renameLocation(${jsArg(l.name)})" title="เปลี่ยนชื่อ (อัปเดตอุปกรณ์ทุกชิ้นที่ใช้สถานที่นี้)" style="padding:4px 8px;">✏️</button>
              <button class="btn btn-sm btn-danger" onclick="deleteLocation(${jsArg(l.name)})" ${l.count ? 'disabled title="มีอุปกรณ์ใช้อยู่ ลบไม่ได้"' : 'title="ลบ"'} style="padding:4px 8px;">🗑️</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="3" style="text-align:center; padding:24px; color:#94a3b8;">ยังไม่มีสถานที่จัดเก็บ</td></tr>'}
        </tbody>
      </table>
    </div>
    <div style="font-size:12px; color:#64748b; margin-top:10px;">การเปลี่ยนชื่อจะอัปเดตอุปกรณ์ทุกชิ้นที่ใช้สถานที่นี้ · ถ้าชื่อใหม่ซ้ำกับสถานที่ที่มีอยู่ ระบบจะถามยืนยันก่อนควบรวม · ลบได้เฉพาะสถานที่ที่ไม่มีอุปกรณ์ใช้อยู่</div>`;
}

function openLocationManager() {
  if (!canManageEquipment()) return;
  openModal('📍 จัดการสถานที่จัดเก็บ', eqLocManagerHtml(), null, true);
}

// อัปเดต DATA ในหน่วยความจำทันทีหลังเรียก API สำเร็จ แล้ววาดหน้าต่างจัดการใหม่ (ไม่รอรอบโหลดข้อมูล)
function eqLocAfter() {
  const box = document.getElementById('modalBody');
  if (box) box.innerHTML = eqLocManagerHtml();
  if (typeof refreshData === 'function') refreshData();
}
function eqSetMasterLocal(list) {
  if (!DATA.settings) DATA.settings = {};
  DATA.settings.EQUIPMENT_LOCATIONS = JSON.stringify(list);
}

async function addLocation() {
  const inp = $('loc_new');
  const name = eqNorm(inp ? inp.value : '');
  if (!name) { toast('กรุณาระบุชื่อสถานที่', 'warning'); return; }
  showLoading(true);
  try {
    const r = await callApi('addEquipmentLocation', name, ADMIN_PASS);
    showLoading(false);
    if (!r.success) { toast(r.message, 'error'); return; }
    eqSetMasterLocal(eqMasterLocations().filter(x => x.toLowerCase() !== r.name.toLowerCase()).concat(r.name));
    toast(r.existed ? 'มีสถานที่ "' + r.name + '" อยู่แล้ว' : 'เพิ่มสถานที่ "' + r.name + '" แล้ว', r.existed ? 'warning' : 'success');
    eqLocAfter();
  } catch (err) { showLoading(false); toast('ผิดพลาด: ' + err.message, 'error'); }
}

async function renameLocation(oldName) {
  const next = prompt('เปลี่ยนชื่อสถานที่ (อุปกรณ์ทุกชิ้นที่ใช้ "' + oldName + '" จะถูกอัปเดตตาม):', oldName);
  if (next === null) return;
  const name = eqNorm(next);
  if (!name) { toast('กรุณาระบุชื่อสถานที่', 'warning'); return; }
  if (name === oldName) return;
  showLoading(true);
  try {
    let r = await callApi('renameEquipmentLocation', oldName, name, ADMIN_PASS);
    if (!r.success && r.needsMerge) {
      // ชื่อใหม่ซ้ำกับห้องอื่นที่มีอยู่ — ถามก่อนรวม (ย้อนกลับไม่ได้)
      showLoading(false);
      const ok = confirm('⚠️ มีสถานที่ชื่อ "' + r.target + '" อยู่แล้ว (' + r.targetCount + ' รายการ)\n\n'
        + 'ถ้าดำเนินการต่อ อุปกรณ์ของ "' + r.from + '" (' + r.fromCount + ' รายการ) จะถูกย้ายไปอยู่ใน "' + r.target + '" '
        + 'และ "' + r.from + '" จะหายไปจากรายการ ย้อนกลับไม่ได้\n\n'
        + 'ถ้าเป็นคนละห้องกัน ให้กด "ยกเลิก" แล้วตั้งชื่อใหม่ให้ต่างกัน (เช่น ระบุชั้น/หน่วยงานเพิ่ม)\n\nต้องการรวมสองสถานที่นี้หรือไม่?');
      if (!ok) return;
      showLoading(true);
      r = await callApi('renameEquipmentLocation', oldName, name, ADMIN_PASS, true);
    }
    showLoading(false);
    if (!r.success) { toast(r.message, 'error'); return; }
    // ปรับสำเนาในหน่วยความจำให้ตรงทันที
    DATA.equipment.forEach(e => { if (eqNorm(e['ที่เก็บ']).toLowerCase() === eqNorm(oldName).toLowerCase()) e['ที่เก็บ'] = r.name; });
    eqSetMasterLocal(eqMasterLocations().filter(x => x.toLowerCase() !== oldName.toLowerCase() && x.toLowerCase() !== r.name.toLowerCase()).concat(r.name));
    if (window.EQUIPMENT_FILTER_STATE && eqNorm(window.EQUIPMENT_FILTER_STATE.loc).toLowerCase() === eqNorm(oldName).toLowerCase()) window.EQUIPMENT_FILTER_STATE.loc = r.name;
    toast('เปลี่ยนชื่อเป็น "' + r.name + '" แล้ว · อัปเดตอุปกรณ์ ' + r.updated + ' รายการ' + (r.merged ? ' (ควบรวมกับสถานที่เดิม)' : ''));
    eqLocAfter();
  } catch (err) { showLoading(false); toast('ผิดพลาด: ' + err.message, 'error'); }
}

async function deleteLocation(name) {
  if (!confirm('ลบสถานที่ "' + name + '" ออกจากรายการ?')) return;
  showLoading(true);
  try {
    const r = await callApi('deleteEquipmentLocation', name, ADMIN_PASS);
    showLoading(false);
    if (!r.success) { toast(r.message, 'error'); return; }
    eqSetMasterLocal(eqMasterLocations().filter(x => x.toLowerCase() !== name.toLowerCase()));
    toast('ลบสถานที่ "' + name + '" แล้ว');
    eqLocAfter();
  } catch (err) { showLoading(false); toast('ผิดพลาด: ' + err.message, 'error'); }
}

// ------------------------------------------------------------------ 6) จัดการหมวดหมู่ (ผูกกับ 4 หลักแรกของเลขครุภัณฑ์)
const EQ_CAT_EDIT = { id: '' }; // id ของหมวดที่กำลังแก้ไข ('' = เพิ่มใหม่)

// รหัส 4 หลักที่พบในเลขครุภัณฑ์ของอุปกรณ์ แต่ยังไม่มีหมวดรองรับ
function eqUnmatchedPrefixes() {
  const m = new Map();
  (DATA.equipment || []).forEach(e => {
    const p = eqTagPrefix(e['รหัสครุภัณฑ์']);
    if (p && !eqCatByCode(p)) m.set(p, (m.get(p) || 0) + 1);
  });
  return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function eqCatManagerHtml(prefill) {
  const cats = eqCats().slice().sort(eqCatCompare);
  const editing = EQ_CAT_EDIT.id ? cats.find(c => (c.id || c._id || c['รหัส']) === EQ_CAT_EDIT.id) : null;
  const pf = prefill || (editing ? { code: eqCatCode(editing), name: editing['ชื่อหมวด'] } : { code: '', name: '' });
  const useCount = (c) => (DATA.equipment || []).filter(e => eqNorm(e['หมวดหมู่']).toLowerCase() === eqNorm(c['ชื่อหมวด']).toLowerCase()).length;
  const unmatched = eqUnmatchedPrefixes();
  return `
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-bottom:14px;">
      <div style="font-weight:700; font-size:13px; margin-bottom:8px;">${editing ? '✏️ แก้ไขหมวดหมู่' : '➕ เพิ่มหมวดหมู่ใหม่'}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <input id="cat_code" value="${esc(pf.code)}" placeholder="รหัส 4 หลัก เช่น 7440" maxlength="4" inputmode="numeric" style="width:150px; padding:10px 12px; border-radius:10px; border:1px solid #cbd5e1; box-sizing:border-box;">
        <input id="cat_name" value="${esc(pf.name)}" placeholder="ชื่อหมวด เช่น อุปกรณ์คอมพิวเตอร์และเครื่องพิมพ์" maxlength="100"
          onkeydown="if(event.key==='Enter'){event.preventDefault();saveCategoryForm();}"
          style="flex:1; min-width:220px; padding:10px 14px; border-radius:10px; border:1px solid #cbd5e1; box-sizing:border-box;">
        <button class="btn btn-primary" onclick="saveCategoryForm()" style="white-space:nowrap;">${editing ? '💾 บันทึก' : '➕ เพิ่ม'}</button>
        ${editing ? `<button class="btn btn-secondary" onclick="cancelCategoryEdit()">ยกเลิก</button>` : ''}
      </div>
      <div style="font-size:12px; color:#64748b; margin-top:6px;">รหัสหมวด = 4 ตัวแรกของเลขครุภัณฑ์ เช่น <b>7440</b>-14-0001/31 · เว้นรหัสว่างได้ถ้าไม่ต้องการผูกอัตโนมัติ${editing ? ' · การเปลี่ยนชื่อจะอัปเดตอุปกรณ์ในหมวดนี้ให้ด้วย' : ''}</div>
    </div>

    ${unmatched.length ? `
    <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:12px; margin-bottom:14px;">
      <div style="font-weight:700; font-size:13px; color:#b45309; margin-bottom:6px;">⚠️ พบรหัสในเลขครุภัณฑ์ที่ยังไม่มีหมวดรองรับ</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${unmatched.map(([code, n]) => `<button class="btn btn-sm btn-secondary" onclick="prefillCategory(${jsArg(code)})" title="กดเพื่อสร้างหมวดสำหรับรหัสนี้">${esc(code)} <span style="color:#64748b;">(${fmt(n)} ชิ้น)</span> ➕</button>`).join('')}
      </div>
    </div>` : ''}

    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
      <div style="font-weight:700; font-size:13px;">หมวดหมู่ทั้งหมด (${cats.length})</div>
      <button class="btn btn-sm btn-info" onclick="autoAssignCategories()" title="ตั้งหมวดของอุปกรณ์ตามรหัส 4 หลักแรกของเลขครุภัณฑ์">🪄 จัดหมวดอัตโนมัติจากรหัสครุภัณฑ์</button>
    </div>
    <div class="table-wrap" style="max-height:40vh; overflow:auto;">
      <table>
        <thead><tr><th style="width:110px;">รหัสหมวด</th><th>ชื่อหมวดหมู่</th><th style="text-align:center; width:90px;">อุปกรณ์</th><th style="text-align:center; width:120px;">จัดการ</th></tr></thead>
        <tbody>${cats.map(c => {
          const id = c.id || c._id || c['รหัส'] || '';
          const n = useCount(c);
          return `<tr>
            <td data-label="รหัสหมวด">${eqCatCode(c) ? `<code style="font-weight:700; color:#0f766e;">${esc(eqCatCode(c))}</code>` : '<span style="color:#cbd5e1;">—</span>'}</td>
            <td data-label="ชื่อหมวด">${esc(c['ชื่อหมวด'])}</td>
            <td data-label="อุปกรณ์" style="text-align:center;">${fmt(n)}</td>
            <td data-label="จัดการ" style="text-align:center;">
              <button class="btn btn-sm btn-secondary" onclick="editCategory(${jsArg(id)})" ${id ? '' : 'disabled title="หมวดนี้ไม่มีรหัสอ้างอิงในระบบ แก้ไขไม่ได้"'} style="padding:4px 8px;">✏️</button>
              <button class="btn btn-sm btn-danger" onclick="deleteCategory(${jsArg(id)}, ${jsArg(c['ชื่อหมวด'])})" ${(!id || n) ? `disabled title="${n ? 'มีอุปกรณ์ใช้อยู่ ลบไม่ได้' : 'ไม่มีรหัสอ้างอิงในระบบ'}"` : 'title="ลบ"'} style="padding:4px 8px;">🗑️</button>
            </td></tr>`;
        }).join('') || '<tr><td colspan="4" style="text-align:center; padding:24px; color:#94a3b8;">ยังไม่มีหมวดหมู่</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function openCategoryManager() {
  if (!canManageEquipment()) return;
  EQ_CAT_EDIT.id = '';
  openModal('🗂️ จัดการหมวดหมู่ครุภัณฑ์', eqCatManagerHtml(), null, true);
}

function eqCatRepaint(prefill) {
  const box = document.getElementById('modalBody');
  if (box) box.innerHTML = eqCatManagerHtml(prefill);
}

function prefillCategory(code) {
  EQ_CAT_EDIT.id = '';
  eqCatRepaint({ code, name: EQ_KNOWN_CODES[code] || '' });
  const el = $(EQ_KNOWN_CODES[code] ? 'cat_code' : 'cat_name');
  if (el) el.focus();
}
function editCategory(id) { EQ_CAT_EDIT.id = id; eqCatRepaint(); const n = $('cat_name'); if (n) n.focus(); }
function cancelCategoryEdit() { EQ_CAT_EDIT.id = ''; eqCatRepaint(); }

async function saveCategoryForm() {
  const code = String($('cat_code').value || '').trim();
  const name = eqNorm($('cat_name').value);
  if (!name) { toast('กรุณาระบุชื่อหมวดหมู่', 'warning'); return; }
  if (code && !/^\d{4}$/.test(code)) { toast('รหัสหมวดต้องเป็นตัวเลข 4 หลัก เช่น 7440', 'warning'); return; }
  showLoading(true);
  try {
    const r = await callApi('saveEquipmentCategory', { id: EQ_CAT_EDIT.id, name, code }, ADMIN_PASS);
    showLoading(false);
    if (!r.success) { toast(r.message, 'error'); return; }
    // ปรับสำเนาในหน่วยความจำให้ตรงทันที
    const prev = DATA.categories.find(c => (c.id || c._id || c['รหัส']) === r.id);
    if (prev) {
      const oldName = prev['ชื่อหมวด'];
      DATA.equipment.forEach(e => { if (eqNorm(e['หมวดหมู่']).toLowerCase() === eqNorm(oldName).toLowerCase()) e['หมวดหมู่'] = r.name; });
      prev['ชื่อหมวด'] = r.name;
      if (r.code) prev['รหัสหมวด'] = r.code; else delete prev['รหัสหมวด'];
    } else {
      DATA.categories.push(Object.assign({ id: r.id, 'ชื่อหมวด': r.name }, r.code ? { 'รหัสหมวด': r.code } : {}));
    }
    if (window.EQUIPMENT_FILTER_STATE && prev && window.EQUIPMENT_FILTER_STATE.cat) window.EQUIPMENT_FILTER_STATE.cat = ''; // ชื่อเปลี่ยน ล้างตัวกรองเดิมกันค้าง
    toast(EQ_CAT_EDIT.id ? 'บันทึกแล้ว' + (r.updated ? ' · อัปเดตอุปกรณ์ ' + r.updated + ' รายการ' : '') : 'เพิ่มหมวด "' + r.name + '" แล้ว');
    EQ_CAT_EDIT.id = '';
    eqCatRepaint();
    if (typeof refreshData === 'function') refreshData();
  } catch (err) { showLoading(false); toast('ผิดพลาด: ' + err.message, 'error'); }
}

async function deleteCategory(id, name) {
  if (!confirm('ลบหมวดหมู่ "' + name + '" ?')) return;
  showLoading(true);
  try {
    const r = await callApi('deleteEquipmentCategory', id, ADMIN_PASS);
    showLoading(false);
    if (!r.success) { toast(r.message, 'error'); return; }
    DATA.categories = DATA.categories.filter(c => (c.id || c._id || c['รหัส']) !== id);
    toast('ลบหมวด "' + name + '" แล้ว');
    eqCatRepaint();
    if (typeof refreshData === 'function') refreshData();
  } catch (err) { showLoading(false); toast('ผิดพลาด: ' + err.message, 'error'); }
}

// จัดหมวดอัตโนมัติ: ดูตัวอย่างก่อน (ยังไม่แก้ข้อมูล) แล้วถามยืนยัน
async function autoAssignCategories() {
  showLoading(true);
  try {
    const pv = await callApi('assignEquipmentCategoriesByCode', false, ADMIN_PASS);
    showLoading(false);
    if (!pv.success) { toast(pv.message, 'error'); return; }
    if (!pv.count) { toast('อุปกรณ์ทุกชิ้นที่มีรหัสตรงกับหมวด อยู่ในหมวดที่ถูกต้องแล้ว'); return; }
    const sample = pv.items.slice(0, 8).map(x => '• ' + (x.tag || '') + ' ' + (x.name || '') + '\n   ' + (x.from || '(ไม่มีหมวด)') + ' → ' + x.to).join('\n');
    const ok = confirm('จะปรับหมวดหมู่ของอุปกรณ์ ' + pv.count + ' รายการ ตามรหัส 4 หลักแรกของเลขครุภัณฑ์\n\nตัวอย่าง:\n' + sample + (pv.count > 8 ? '\n... และอีก ' + (pv.count - 8) + ' รายการ' : '') + '\n\nอุปกรณ์ที่รหัสไม่ตรงกับหมวดใดจะไม่ถูกแตะ\nต้องการดำเนินการหรือไม่?');
    if (!ok) return;
    showLoading(true);
    const r = await callApi('assignEquipmentCategoriesByCode', true, ADMIN_PASS);
    showLoading(false);
    if (!r.success) { toast(r.message, 'error'); return; }
    toast('ปรับหมวดหมู่อุปกรณ์ ' + r.updated + ' รายการแล้ว');
    if (typeof refreshData === 'function') refreshData();
    setTimeout(() => eqCatRepaint(), 600); // รอข้อมูลรีเฟรชแล้ววาดจำนวนอุปกรณ์ต่อหมวดใหม่
  } catch (err) { showLoading(false); toast('ผิดพลาด: ' + err.message, 'error'); }
}

// ------------------------------------------------------------------ 7) ช่องหน่วยงานแบบพิมพ์ค้นหา + เพิ่มหน่วยงานใหม่ได้ (ใช้ร่วมกับฟอร์มใบส่งมอบ)
// เดิมเป็น <select> ตายตัวจากตารางหน่วยงาน: หน่วยงานที่ยังไม่มีในตาราง (เช่น ห้องคลอด) จึงหาไม่เจอและเพิ่มไม่ได้
function eqDeptNames() {
  const seen = new Set();
  return (DATA.departments || []).map(d => eqNorm(d['ชื่อหน่วยงาน'])).filter(n => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'th'));
}
function eqDeptFind(name) {
  const n = eqNorm(name).toLowerCase();
  return n ? eqDeptNames().find(x => x.toLowerCase() === n) : undefined;
}
// onChangeJs: โค้ด JS (สตริง) ที่รันเมื่อค่าเปลี่ยน เช่น รีเฟรชรายชื่อเจ้าหน้าที่ของหน่วยงานนั้น
function eqDeptInputHtml(id, value, onChangeJs, placeholder) {
  return `<input id="${id}" list="${id}_list" autocomplete="off" value="${esc(value || '')}" placeholder="${esc(placeholder || 'พิมพ์เพื่อค้นหาหน่วยงาน...')}"
      oninput="eqDeptCheck('${id}')" onchange="eqDeptCheck('${id}');${onChangeJs || ''}">
    <datalist id="${id}_list">${eqDeptNames().map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
    <div id="${id}_hint" style="font-size:12px; margin-top:4px; min-height:16px;"></div>`;
}
// พิมพ์ชื่อที่ยังไม่มีในระบบ -> แสดงปุ่มเพิ่มเป็นหน่วยงานใหม่ (ชื่อที่ตรงกับของเดิมต่างแค่ตัวพิมพ์/ช่องว่างจะใช้ของเดิม)
function eqDeptCheck(id) {
  const inp = document.getElementById(id), hint = document.getElementById(id + '_hint');
  if (!inp || !hint) return;
  const typed = eqNorm(inp.value);
  if (!typed) { hint.innerHTML = ''; return; }
  const hit = eqDeptFind(typed);
  if (hit) { if (hit !== inp.value) inp.value = hit; hint.innerHTML = ''; return; }
  const canAdd = typeof canManageEquipment === 'function' && canManageEquipment();
  hint.innerHTML = `<span style="color:#b45309;">ไม่พบหน่วยงาน “${esc(typed)}” ในระบบ</span>`
    + (canAdd ? ` <button type="button" class="btn btn-sm btn-secondary" onclick="eqDeptAdd('${id}')" style="padding:2px 10px; margin-left:6px;">➕ เพิ่มเป็นหน่วยงานใหม่</button>` : '');
}
// เพิ่มหน่วยงานเข้าตารางหน่วยงาน (ฝั่ง server กันชื่อซ้ำ) แล้วอัปเดตรายการในหน่วยความจำทันที
async function eqDeptAdd(id) {
  const inp = document.getElementById(id);
  const name = eqNorm(inp ? inp.value : '');
  if (!name) return false;
  showLoading(true);
  try {
    const r = await callApi('saveDepartment', { 'ชื่อหน่วยงาน': name }, ADMIN_PASS);
    showLoading(false);
    if (!r.success) { toast(r.message || 'เพิ่มหน่วยงานไม่สำเร็จ', 'error'); return false; }
    if (!DATA.departments) DATA.departments = [];
    if (!eqDeptFind(r.name)) DATA.departments.push({ 'รหัส': r.id, 'ชื่อหน่วยงาน': r.name });
    if (inp) inp.value = r.name;
    const dl = document.getElementById(id + '_list');
    if (dl) dl.innerHTML = eqDeptNames().map(n => `<option value="${esc(n)}"></option>`).join('');
    eqDeptCheck(id);
    toast(r.existed ? 'มีหน่วยงาน "' + r.name + '" อยู่แล้ว' : 'เพิ่มหน่วยงาน "' + r.name + '" แล้ว', r.existed ? 'warning' : 'success');
    if (typeof inp.onchange === 'function') inp.onchange();
    if (typeof refreshData === 'function') refreshData();
    return true;
  } catch (err) { showLoading(false); toast('ผิดพลาด: ' + err.message, 'error'); return false; }
}
// ก่อนบันทึก: ถ้าชื่อที่พิมพ์ไม่อยู่ในระบบ ให้ถามเพิ่มเป็นหน่วยงานใหม่ (ไม่ปล่อยให้พิมพ์ผิดแล้วบันทึกเงียบๆ) — true = ไปต่อได้
async function eqDeptEnsure(id) {
  const inp = document.getElementById(id);
  const typed = eqNorm(inp ? inp.value : '');
  if (!typed) return true;
  const hit = eqDeptFind(typed);
  if (hit) { inp.value = hit; return true; }
  if (typeof canManageEquipment === 'function' && !canManageEquipment()) { toast('ไม่พบหน่วยงาน "' + typed + '" ในระบบ', 'warning'); return false; }
  if (!confirm('ไม่พบหน่วยงาน "' + typed + '" ในระบบ\n\nต้องการเพิ่มเป็นหน่วยงานใหม่หรือไม่?\n(กด "ยกเลิก" เพื่อกลับไปแก้ชื่อ)')) return false;
  return eqDeptAdd(id);
}
if (typeof window !== 'undefined') { window.eqDeptCheck = eqDeptCheck; window.eqDeptAdd = eqDeptAdd; }

if (typeof module === 'object' && module.exports) {
  module.exports = { eqFilter, eqSort, eqBuildEntries, eqPaginate, eqNorm, eqTagPrefix, EQ_STATE_DEFAULT };
}
