/* ============================================================================
 * หน้า "คลังทะเบียนอุปกรณ์ & ครุภัณฑ์" (แยกออกจาก index.html)
 *
 * โหลดเป็น <script src> ปกติ (ไม่ใช่ module) จึงแชร์ตัวแปร global กับสคริปต์หลักของ index.html
 * โดยอ้างถึงเฉพาะตอนเรียกใช้ (ไม่ใช่ตอนโหลด): DATA, $, esc, jsArg, fmt, money, toast, openModal,
 * closeModal, callApi, ADMIN_PASS, showLoading, refreshData, isAdmin, canManageEquipment,
 * fsPhotoCell, fsReadAndCompressImage, quickBorrow, showQrModal, addEquipmentHandover,
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
const EQ_SEARCH_FIELDS = ['รหัสครุภัณฑ์', 'รหัส', 'ชื่ออุปกรณ์', 'ยี่ห้อ', 'รุ่น', 'Serial', 'ที่เก็บ', 'หมวดหมู่'];
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
  const names = Array.from(map.keys()).sort((a, b) => {
    if (a === '(ไม่ระบุ)') return 1;
    if (b === '(ไม่ระบุ)') return -1;
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
                  <div style="font-size:12px; color:#64748b; margin-top:4px;">🏷️ ${esc(e['หมวดหมู่'] || 'ทั่วไป')}</div>
                </td>
                <td data-label="ชื่ออุปกรณ์">
                  <div style="display:flex; align-items:center;">
                    ${fsPhotoCell(e)}
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
                </td>
                <td data-label="ที่เก็บ">
                  <span style="font-size:13px; color:#334155; font-weight:500;">📍 ${esc(e['ที่เก็บ'] || '-')}</span>
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
      <span style="display:inline-block; width:18px;">${g.collapsed ? '▶' : '▼'}</span>${esc(g.name)}
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
    const catList = tally('หมวดหมู่');
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
              ${catList.map(([name, n]) => `<option value="${esc(name)}" ${st.cat === name ? 'selected' : ''}>${esc(name)} (${n})</option>`).join('')}
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
function eqDatalist(id, field) {
  return `<datalist id="${id}">${eqDistinct(field).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

function equipForm(e) {
  e = e || {};
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
  return `
    <div class="form-grid">
      ${sec('📌 ข้อมูลหลัก')}
      <div class="field"><label>รหัสครุภัณฑ์ (เว้นว่างได้ถ้ายังไม่มีป้าย)</label><input id="e_code" value="${esc(e['รหัสครุภัณฑ์'] || '')}"></div>
      <div class="field"><label>ชื่ออุปกรณ์ *</label><input id="e_name" value="${esc(e['ชื่ออุปกรณ์'] || '')}"></div>
      <div class="field"><label>หมวดหมู่</label>
        <select id="e_cat">
          ${(e['หมวดหมู่'] && !DATA.categories.some(c => c['ชื่อหมวด'] === e['หมวดหมู่'])) ? `<option selected>${esc(e['หมวดหมู่'])}</option>` : ''}
          ${DATA.categories.map(c => `<option ${c['ชื่อหมวด'] === e['หมวดหมู่'] ? 'selected' : ''}>${esc(c['ชื่อหมวด'])}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>สถานะ</label>
        <select id="e_status">
          ${['พร้อมยืม', 'อยู่ระหว่างยืม', 'ประจำจุด', 'ชำรุด'].map(s => `<option ${e['สถานะ'] === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>

      ${sec('🖥️ รายละเอียดเครื่อง')}
      <div class="field"><label>ยี่ห้อ <small style="color:#94a3b8;">(เลือกจากที่เคยใช้ หรือพิมพ์ใหม่)</small></label><input id="e_brand" list="eq_dl_brand" value="${esc(e['ยี่ห้อ'] || '')}"></div>
      <div class="field"><label>รุ่น</label><input id="e_model" value="${esc(e['รุ่น'] || '')}"></div>
      <div class="field"><label>Serial Number</label><input id="e_sn" value="${esc(e['Serial'] || '')}"></div>
      <div class="field"><label>วันที่จัดซื้อ</label><input id="e_buy" type="date" value="${buyDate}"></div>

      ${sec('📦 การจัดเก็บและมูลค่า')}
      <div class="field"><label>ที่เก็บ <small style="color:#94a3b8;">(เลือกจากที่เคยใช้ หรือพิมพ์ใหม่)</small></label><input id="e_loc" list="eq_dl_loc" value="${esc(e['ที่เก็บ'] || '')}"></div>
      <div class="field"><label>จำนวน</label><input id="e_qty" type="number" min="0" value="${esc(e['จำนวน'] ?? 1)}"></div>
      <div class="field"><label>หน่วยนับ</label><input id="e_unit" list="eq_dl_unit" value="${esc(e['หน่วยนับ'] || 'เครื่อง')}"></div>
      <div class="field"><label>มูลค่า/หน่วย (บาท)</label><input id="e_price" type="number" min="0" value="${esc(e['มูลค่า'] ?? '')}"></div>

      ${sec('📝 รูปและหมายเหตุ')}
      <div class="field full">
        <label>รูปถ่ายอุปกรณ์ (ถ้ามี)</label>
        <input type="file" id="e_photo" accept="image/*" onchange="window._fsPreviewPhoto(this, 'e_photo_preview')">
        <div id="e_photo_preview" style="margin-top:8px;">${e['รูปภาพ'] ? `<img src="${esc(e['รูปภาพ'])}" style="max-width:110px; max-height:110px; border-radius:10px; border:1px solid #e2e8f0; object-fit:cover;">` : ''}</div>
      </div>
      <div class="field full"><label>หมายเหตุ</label><textarea id="e_note" rows="2">${esc(e['หมายเหตุ'] || '')}</textarea></div>
    </div>
    ${eqDatalist('eq_dl_brand', 'ยี่ห้อ')}${eqDatalist('eq_dl_loc', 'ที่เก็บ')}${eqDatalist('eq_dl_unit', 'หน่วยนับ')}
  `;
}

function addEquip() {
  if (!canManageEquipment()) return;
  openModal('💻 เพิ่มอุปกรณ์ใหม่', equipForm(), () => saveEquip(), true);
}

function editEquip(row) {
  if (!canManageEquipment()) return;
  const e = DATA.equipment.find(x => x._row === row || String(x['รหัส']) === String(row));
  openModal('✏️ แก้ไขข้อมูลอุปกรณ์', equipForm(e), () => saveEquip(row), true);
}

async function saveEquip(row) {
  const data = {
    'รหัสครุภัณฑ์': eqNorm($('e_code').value), 'ชื่ออุปกรณ์': eqNorm($('e_name').value), 'หมวดหมู่': $('e_cat').value,
    'ยี่ห้อ': eqCanon('ยี่ห้อ', $('e_brand').value), 'รุ่น': eqNorm($('e_model').value), 'Serial': eqNorm($('e_sn').value),
    'จำนวน': +$('e_qty').value, 'หน่วยนับ': eqCanon('หน่วยนับ', $('e_unit').value), 'ที่เก็บ': eqCanon('ที่เก็บ', $('e_loc').value),
    'มูลค่า': +$('e_price').value, 'สถานะ': $('e_status').value, 'วันที่จัดซื้อ': $('e_buy').value,
    'หมายเหตุ': $('e_note').value.trim(),
  };
  if (!data['ชื่ออุปกรณ์']) { toast('กรอกชื่ออุปกรณ์', 'warning'); return; }
  if (!Number.isFinite(data['จำนวน']) || data['จำนวน'] < 0) { toast('จำนวนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', 'warning'); return; }
  if (!Number.isFinite(data['มูลค่า']) || data['มูลค่า'] < 0) { toast('มูลค่าต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', 'warning'); return; }
  const tag = data['รหัสครุภัณฑ์'];
  if (tag) {
    const dup = DATA.equipment.find(x => eqNorm(x['รหัสครุภัณฑ์']) === tag && String(x['รหัส']) !== String(row || ''));
    if (dup) { toast('รหัสครุภัณฑ์ ' + tag + ' ซ้ำกับ "' + (dup['ชื่ออุปกรณ์'] || dup['รหัส']) + '" ในระบบ', 'warning'); return; }
  }
  if (row) data['รหัส'] = row;
  showLoading(true);
  try {
    const r = await callApi('saveEquipment', data, ADMIN_PASS);
    if (!r.success) { showLoading(false); toast(r.message, 'error'); return; }

    const photo = await fsReadAndCompressImage('e_photo', 1024, 0.7);
    if (photo) {
      const pr = await callApi('uploadEquipmentPhoto', r.code, photo.base64, photo.contentType, ADMIN_PASS);
      if (!pr.success) toast('บันทึกข้อมูลสำเร็จ แต่อัปโหลดรูปไม่สำเร็จ: ' + pr.message, 'warning');
    }

    showLoading(false);
    toast('บันทึกสำเร็จ');
    closeModal();
    refreshData();
  } catch (err) {
    showLoading(false);
    toast('ผิดพลาด: ' + err.message, 'error');
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

if (typeof module === 'object' && module.exports) {
  module.exports = { eqFilter, eqSort, eqBuildEntries, eqPaginate, eqNorm, EQ_STATE_DEFAULT };
}
