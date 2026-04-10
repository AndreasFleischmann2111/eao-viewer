'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  SETTINGS — persisted per environment in localStorage
// ═══════════════════════════════════════════════════════════════════════════

const SETTINGS_KEY = 'eao-viewer-settings';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch { return {}; }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// settings structure (all per-environment):
// {
//   lastEnv: 'prod',
//   dev:     { email: '', password: '', groupId: '', dispatcherUrl: '' },
//   staging: { ... },
//   prod:    { ... },
// }

// ═══════════════════════════════════════════════════════════════════════════
//  DOM REFS
// ═══════════════════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);
const groupIdInput       = $('groupId');
const usernameInput      = $('username');
const passwordInput      = $('password');
const loadBtn            = $('loadBtn');
const statusBar          = $('statusBar');
const envButtons         = document.querySelectorAll('.env-btn');
const dispatcherUrlInput = $('dispatcherUrl');
const loadFilesBtn       = $('loadFilesBtn');

// ═══════════════════════════════════════════════════════════════════════════
//  RESIZABLE PANEL
// ═══════════════════════════════════════════════════════════════════════════

const PANEL_WIDTH_KEY = 'eao-viewer-panel-width';
const panelLeft    = $('panelLeft');
const panelResizer = $('panelResizer');

// Restore saved width
const savedPanelWidth = localStorage.getItem(PANEL_WIDTH_KEY);
if (savedPanelWidth) panelLeft.style.width = savedPanelWidth;

let _resizing = false;

panelResizer.addEventListener('mousedown', e => {
  _resizing = true;
  panelResizer.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!_resizing) return;
  const layoutRect = panelLeft.parentElement.getBoundingClientRect();
  const newWidth   = e.clientX - layoutRect.left;
  const maxWidth   = layoutRect.width - 140;   // leave room for right panel
  if (newWidth >= 280 && newWidth <= maxWidth) {
    panelLeft.style.width = newWidth + 'px';
  }
});

document.addEventListener('mouseup', () => {
  if (!_resizing) return;
  _resizing = false;
  panelResizer.classList.remove('resizing');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  localStorage.setItem(PANEL_WIDTH_KEY, panelLeft.style.width);
});

let currentEnv = 'prod';

// ═══════════════════════════════════════════════════════════════════════════
//  INIT — restore saved settings
// ═══════════════════════════════════════════════════════════════════════════

(function init() {
  const s = loadSettings();
  currentEnv = s.lastEnv || 'prod';
  setActiveEnv(currentEnv, false);   // restores all per-env fields
})();

// ═══════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT SWITCHING
// ═══════════════════════════════════════════════════════════════════════════

function setActiveEnv(env, persist = true) {
  currentEnv = env;
  envButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.env === env));

  // Restore all per-env fields
  const s = loadSettings();
  const e = s[env] || {};
  groupIdInput.value       = e.groupId       || '';
  usernameInput.value      = e.email         || '';
  passwordInput.value      = e.password      || '';
  dispatcherUrlInput.value = e.dispatcherUrl || '';

  if (persist) { s.lastEnv = env; saveSettings(s); }
  updateLoadFilesBtnState();
}

envButtons.forEach(btn => {
  btn.addEventListener('click', () => setActiveEnv(btn.dataset.env));
});

// Persist all per-env fields on any change
function persistEnv() {
  const s   = loadSettings();
  const prev = s[currentEnv] || {};
  const newEmail = usernameInput.value.trim();

  // Invalidate server token cache when EAO credentials change
  if (prev.email !== newEmail || prev.password !== passwordInput.value) {
    fetch('/api/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: currentEnv, email: newEmail }),
    }).catch(() => {});
  }

  s[currentEnv] = {
    groupId:       groupIdInput.value.trim(),
    email:         newEmail,
    password:      passwordInput.value,
    dispatcherUrl: dispatcherUrlInput.value.trim(),
  };
  saveSettings(s);
  updateLoadFilesBtnState();
}

groupIdInput.addEventListener('change', persistEnv);
usernameInput.addEventListener('change', persistEnv);
passwordInput.addEventListener('change', persistEnv);
dispatcherUrlInput.addEventListener('change', persistEnv);

// ═══════════════════════════════════════════════════════════════════════════
//  STATUS BAR
// ═══════════════════════════════════════════════════════════════════════════

function showStatus(msg, type = 'info') {
  statusBar.textContent = msg;
  statusBar.className = `status-bar status-bar--${type}`;
}

function hideStatus() {
  statusBar.className = 'status-bar hidden';
}

// ═══════════════════════════════════════════════════════════════════════════
//  EXPANDER TOGGLE
// ═══════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.expander-header').forEach(btn => {
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    const bodyId = btn.getAttribute('aria-controls');
    const body = document.getElementById(bodyId);
    if (expanded) {
      body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => { body.style.maxHeight = '0'; });
    } else {
      body.style.maxHeight = body.scrollHeight + 'px';
      body.addEventListener('transitionend', () => {
        if (btn.getAttribute('aria-expanded') === 'true') body.style.maxHeight = 'none';
      }, { once: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  LOAD BUTTON
// ═══════════════════════════════════════════════════════════════════════════

loadBtn.addEventListener('click', async () => {
  const groupId  = groupIdInput.value.trim();
  const email    = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!groupId)  return showStatus('Please enter an Elevator Group ID.', 'error');
  if (!email)    return showStatus('Please enter a username.', 'error');
  if (!password) return showStatus('Please enter a password.', 'error');

  // Persist before loading
  persistEnv();

  loadBtn.disabled = true;
  loadBtn.textContent = 'Loading…';
  showStatus(`Connecting to ${currentEnv.toUpperCase()} environment…`, 'info');

  try {
    const res  = await fetch('/api/load', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ env: currentEnv, email, password, groupId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    hideStatus();
    renderAll(data);
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  } finally {
    loadBtn.disabled = false;
    loadBtn.innerHTML = '<img src="/assets/icons/elevator-group.svg" alt="" class="btn-icon" /> Load';
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function val(v, unit = '') {
  if (v == null || v === '') return '<span class="val-empty">—</span>';
  return `<span class="val">${esc(v)}${unit ? '<span class="val-unit"> ' + unit + '</span>' : ''}</span>`;
}

function row(label, value, unit = '') {
  return `<tr><td class="info-label">${esc(label)}</td><td class="info-value">${val(value, unit)}</td></tr>`;
}

function infoTable(rows) {
  return `<table class="info-table"><tbody>${rows.join('')}</tbody></table>`;
}


// ═══════════════════════════════════════════════════════════════════════════
//  RENDER — Site & Building
// ═══════════════════════════════════════════════════════════════════════════

function renderSiteBuilding(site, building) {
  const el = $('site-content');

  const siteRows = [
    row('Name',         site.title ?? site.name),
    row('Site ID',      site.siteId ?? site.id),
    row('Street',       site.street ?? site.address),
    row('City',         site.city),
    row('Postal Code',  site.postalCode ?? site.zip),
    row('Country',      site.country),
    row('Region',       site.region),
    row('Description',  site.description),
  ].filter(r => !r.includes('val-empty'));

  const buildingRows = [
    row('Name',           building.title ?? building.name),
    row('Building ID',    building.siteBuildingId ?? building.id),
    row('Type',           building.buildingType ?? building.type),
    row('Floor Count',    building.floors ?? building.floorCount ?? building.numberOfFloors),
    row('Height',         building.height, 'mm'),
    row('Description',    building.description),
    row('Year Built',     building.yearBuilt ?? building.constructionYear),
  ].filter(r => !r.includes('val-empty'));

  el.innerHTML = `
    <div class="info-grid">
      <div class="info-card">
        <div class="info-card-header">
          <img src="/assets/icons/site.svg" alt="" class="info-card-icon" />
          <span>Site</span>
        </div>
        ${siteRows.length ? infoTable(siteRows) : '<p class="val-empty">No site details available.</p>'}
      </div>
      <div class="info-card">
        <div class="info-card-header">
          <img src="/assets/icons/building.svg" alt="" class="info-card-icon" />
          <span>Building</span>
        </div>
        ${buildingRows.length ? infoTable(buildingRows) : '<p class="val-empty">No building details available.</p>'}
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RENDER — Floor Levels
//  Building floor levels (rows) matched to unit service flags by floor ID.
//  Per unit: FRONT column always shown; REAR column only if unit has rear service.
//  If bank2StartSx is set, a bank separator is inserted in the column headers.
// ═══════════════════════════════════════════════════════════════════════════

function renderFloorLevels(floorLevels, units, bank2StartSx) {
  const el = $('floors-content');

  if (!floorLevels || floorLevels.length === 0) {
    el.innerHTML = '<p class="expander-placeholder"><img src="/assets/icons/circle-info.svg" alt="" />No floor level data available.</p>';
    return;
  }

  // Highest floor first
  const sorted = [...floorLevels].sort((a, b) => b.ix - a.ix);

  // Determine per-unit column config
  const unitCols = (units ?? []).map(u => {
    const hasRear = Object.values(u.floorFlags ?? {}).some(bits => !!(bits & 0x2));
    const sx      = u.sx ?? u.shaftIndex ?? null;
    const bank    = (bank2StartSx != null && sx != null && sx >= bank2StartSx) ? 2 : 1;
    return { unit: u, hasRear, bank };
  });

  // ── Header row 1: bank labels + unit titles ───────────────────────────────
  // Inject a bank-separator <th> before the first Bank 2 unit
  let bankHeaderHtml = '';
  let prevBank = 0;
  for (const { unit, hasRear, bank } of unitCols) {
    if (bank !== prevBank) {
      // bank label spanning all columns of that bank
      const bankColSpan = unitCols
        .filter(c => c.bank === bank)
        .reduce((s, c) => s + (c.hasRear ? 2 : 1), 0);
      bankHeaderHtml += `<th colspan="${bankColSpan}" class="fl-bank-header">BANK ${bank}</th>`;
      prevBank = bank;
    }
  }

  const unitGroupHeaders = unitCols.map(({ unit, hasRear }) => {
    const span  = hasRear ? 2 : 1;
    const title = esc(unit.title ?? unit.elevatorUnitId ?? '');
    return `<th colspan="${span}" class="fl-unit-group-header">${title}</th>`;
  }).join('');

  const unitSubHeaders = unitCols.map(({ hasRear }) =>
    `<th class="fl-sub-header">FRONT</th>${hasRear ? '<th class="fl-sub-header">REAR</th>' : ''}`
  ).join('');

  // Use 3-row header when banks exist, 2-row otherwise
  const hasBanks    = bank2StartSx != null && unitCols.some(c => c.bank === 2);
  const floorColSpan = hasBanks ? 'rowspan="3"' : 'rowspan="2"';

  const theadHtml = hasBanks ? `
    <tr>
      <th ${floorColSpan}>Description</th>
      <th ${floorColSpan}>DZ</th>
      <th ${floorColSpan}>Level (IX)</th>
      <th ${floorColSpan}>z_POT (mm)</th>
      ${bankHeaderHtml}
    </tr>
    <tr>${unitGroupHeaders}</tr>
    <tr>${unitSubHeaders}</tr>
  ` : `
    <tr>
      <th rowspan="2">Description</th>
      <th rowspan="2">DZ</th>
      <th rowspan="2">Level (IX)</th>
      <th rowspan="2">z_POT (mm)</th>
      ${unitGroupHeaders}
    </tr>
    <tr>${unitSubHeaders}</tr>
  `;

  // ── Rows ──────────────────────────────────────────────────────────────────
  const rows = sorted.map(f => {
    const unitCells = unitCols.map(({ unit, hasRear }) => {
      const bits  = (unit.floorFlags ?? {})[f.id] ?? null;
      const front = bits !== null ? !!(bits & 0x1) : false;
      const rear  = bits !== null ? !!(bits & 0x2) : false;
      const frontCell = `<td class="fl-flag-cell">${front ? '<span class="fl-check">✓</span>' : '<span class="fl-uncheck"></span>'}</td>`;
      const rearCell  = hasRear
        ? `<td class="fl-flag-cell">${rear  ? '<span class="fl-check">✓</span>' : '<span class="fl-uncheck"></span>'}</td>`
        : '';
      return frontCell + rearCell;
    }).join('');

    return `<tr>
      <td class="fl-desc">${esc(f.desc)}</td>
      <td class="fl-dz">${esc(f.dz)}</td>
      <td class="fl-ix">${esc(f.ix)}</td>
      <td class="fl-zpot">${f.zPot != null ? f.zPot.toLocaleString('de-AT') : '—'}</td>
      ${unitCells}
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="fl-table-wrap">
      <table class="fl-table">
        <thead>${theadHtml}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RENDER — Elevator Group & Units
// ═══════════════════════════════════════════════════════════════════════════

function buildUnitCard(u, i) {
  const unitRows = [
    row('Unit ID',      u.elevatorUnitId ?? u.id),
    row('Shaft Index',  u.sx ?? u.shaftIndex),
    row('Model',        u.elevatorSupplierModelTitle ?? u.model),
    row('Payload',      u.payload, 'kg'),
    row('Speed',        u.speed, 'm/s'),
    row('Floors',       u.floors),
    row('Travel Height',u.travelHeight, 'mm'),
    row('Shaft W×D',    u.shaftWidth && u.shaftDepth ? `${u.shaftWidth} × ${u.shaftDepth}` : null, 'mm'),
    row('Shaft Height', u.shaftHeight, 'mm'),
    row('Car W×D',      u.carWidth && u.carDepth ? `${u.carWidth} × ${u.carDepth}` : null, 'mm'),
    row('Car Height',   u.carHeight, 'mm'),
    row('Door W×H',     u.doorWidth && u.doorHeight ? `${u.doorWidth} × ${u.doorHeight}` : null, 'mm'),
    row('Pit',          u.pit, 'mm'),
    row('Head',         u.head, 'mm'),
    row('Machine Room', u.mrLess != null ? (u.mrLess ? 'MRL (no room)' : 'With machine room') : null),
  ].filter(r => !r.includes('val-empty'));

  return `
    <div class="info-card unit-card">
      <div class="info-card-header unit-card-header">
        <img src="/assets/icons/add-elevator-unit.svg" alt="" class="info-card-icon" />
        <span>${esc(u.title ?? `Unit ${i + 1}`)}</span>
      </div>
      ${unitRows.length ? infoTable(unitRows) : '<p class="val-empty">No unit details available.</p>'}
    </div>
  `;
}

function renderGroupAndUnits(groupEx, units, supplierName, bank2StartSx) {
  const el = $('group-content');

  // ── Group summary ─────────────────────────────────────────────────────────
  const groupRows = [
    row('Group ID',    groupEx.elevatorGroupId ?? groupEx.id),
    row('Title',       groupEx.title ?? groupEx.name),
    row('Supplier',    supplierName),
    row('Standard',    groupEx.standardUsedTitle ?? groupEx.standard),
    row('Unit Count',  groupEx.elevatorUnitsCount ?? units.length),
    row('Description', groupEx.description),
  ].filter(r => !r.includes('val-empty'));

  const groupHtml = `
    <div class="info-card group-summary-card">
      <div class="info-card-header">
        <img src="/assets/icons/elevator-group.svg" alt="" class="info-card-icon" />
        <span>${esc(groupEx.title ?? 'Elevator Group')}</span>
      </div>
      ${infoTable(groupRows)}
    </div>
  `;

  // ── Split units into banks if BANK_2_START_SX is set ─────────────────────
  const hasBanks = bank2StartSx != null;
  const bank1    = hasBanks ? units.filter(u => (u.sx ?? u.shaftIndex ?? 0) <  bank2StartSx) : units;
  const bank2    = hasBanks ? units.filter(u => (u.sx ?? u.shaftIndex ?? 0) >= bank2StartSx) : [];

  function bankSection(bankUnits, bankNum) {
    const cards = bankUnits.map((u, i) => buildUnitCard(u, i)).join('');
    if (!hasBanks) {
      // No banking — render without label
      return `<div class="unit-columns-wrap"><div class="unit-columns">${cards}</div></div>`;
    }
    return `
      <div class="bank-section">
        <div class="bank-label-vertical">BANK ${bankNum}</div>
        <div class="unit-columns">${cards}</div>
      </div>
    `;
  }

  el.innerHTML = `
    ${groupHtml}
    ${bankSection(bank1, 1)}
    ${bank2.length ? bankSection(bank2, 2) : ''}
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RENDER ALL
// ═══════════════════════════════════════════════════════════════════════════

let _groupLoaded = false;

function renderAll(data) {
  renderSiteBuilding(data.site, data.building);
  renderFloorLevels(data.floorLevels, data.units, data.bank2StartSx);
  renderGroupAndUnits(data.groupEx, data.units, data.supplierName, data.bank2StartSx);

  // Make sure all expanders are open after loading
  document.querySelectorAll('.expander-header').forEach(btn => {
    btn.setAttribute('aria-expanded', 'true');
    const bodyId = btn.getAttribute('aria-controls');
    document.getElementById(bodyId).style.maxHeight = 'none';
  });

  // Enable Load Files once a group is loaded
  _groupLoaded = true;
  updateLoadFilesBtnState();
}

// ═══════════════════════════════════════════════════════════════════════════
//  RIGHT PANEL — SVG Viewer
// ═══════════════════════════════════════════════════════════════════════════

class SvgViewer {
  constructor(viewportEl) {
    this.vp    = viewportEl;
    this.svgEl = null;
    this.scale = 1;
    this.tx    = 0;
    this.ty    = 0;
    this._drag = null; // { x, y, tx, ty } while dragging

    this._onWheel = this._onWheel.bind(this);
    this._onDown  = this._onDown.bind(this);
    this._onMove  = this._onMove.bind(this);
    this._onUp    = this._onUp.bind(this);

    this.vp.addEventListener('wheel', this._onWheel, { passive: false });
    this.vp.addEventListener('mousedown', this._onDown);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('mouseup',   this._onUp);
    this.vp.style.cursor = 'grab';
  }

  /** Inject SVG string and fit to viewport. */
  loadSvg(svgString) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(svgString, 'image/svg+xml');
    const el     = doc.documentElement;

    // Remove fixed dimensions so we control size via transform
    el.removeAttribute('width');
    el.removeAttribute('height');
    el.style.cssText = 'position:absolute; top:0; left:0; transform-origin:0 0; max-width:none; max-height:none; pointer-events:none;';

    // Clear placeholder + old SVG
    this.vp.innerHTML = '';
    this.vp.appendChild(el);
    this.svgEl = el;

    requestAnimationFrame(() => this.fitAll());
  }

  /** Fit SVG to viewport with padding. */
  fitAll() {
    if (!this.svgEl) return;
    const vpRect = this.vp.getBoundingClientRect();
    const vb     = this.svgEl.viewBox?.baseVal;
    let svgW, svgH;

    if (vb && vb.width > 0 && vb.height > 0) {
      svgW = vb.width;
      svgH = vb.height;
    } else {
      svgW = this.svgEl.width?.baseVal?.value  || 800;
      svgH = this.svgEl.height?.baseVal?.value || 600;
    }

    const pad    = 20;
    const scaleX = (vpRect.width  - pad * 2) / svgW;
    const scaleY = (vpRect.height - pad * 2) / svgH;
    this.scale   = Math.min(scaleX, scaleY);
    this.tx      = (vpRect.width  - svgW * this.scale) / 2;
    this.ty      = (vpRect.height - svgH * this.scale) / 2;
    this._apply();
  }

  /** Zoom by factor, centred on (cx, cy) screen coordinates. */
  zoom(factor, cx, cy) {
    const newScale = Math.min(100, Math.max(0.01, this.scale * factor));
    const r        = newScale / this.scale;
    const rect     = this.vp.getBoundingClientRect();
    const px       = cx != null ? cx - rect.left : rect.width  / 2;
    const py       = cy != null ? cy - rect.top  : rect.height / 2;
    this.tx  = px - r * (px - this.tx);
    this.ty  = py - r * (py - this.ty);
    this.scale = newScale;
    this._apply();
  }

  _apply() {
    if (this.svgEl) {
      this.svgEl.style.transform = `translate(${this.tx}px,${this.ty}px) scale(${this.scale})`;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
  }

  _onDown(e) {
    if (e.button !== 0) return;
    this._drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
    this.vp.style.cursor = 'grabbing';
    e.preventDefault();
  }

  _onMove(e) {
    if (!this._drag) return;
    this.tx = this._drag.tx + (e.clientX - this._drag.x);
    this.ty = this._drag.ty + (e.clientY - this._drag.y);
    this._apply();
  }

  _onUp() {
    if (!this._drag) return;
    this._drag = null;
    this.vp.style.cursor = 'grab';
  }

  destroy() {
    this.vp.removeEventListener('wheel', this._onWheel);
    this.vp.removeEventListener('mousedown', this._onDown);
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('mouseup',   this._onUp);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  RIGHT PANEL — Tab System
// ═══════════════════════════════════════════════════════════════════════════

const SVG_SHEETS = [
  { tab: '2d-plan',    name: 'EAOSLOT-2D-PLAN',     label: '2D Plan' },
  { tab: '2d-details', name: 'EAOSLOT-2D-DETAILS',  label: '2D Details' },
  { tab: '2d-vert',    name: 'EAOSLOT-2D-VERTICAL', label: '2D Vertical' },
];
const IFC_SHEETS = [
  { tab: 'lod100', name: 'EAOSLOT-LOD-100', label: 'LOD 100' },
  { tab: 'lod200', name: 'EAOSLOT-LOD-200', label: 'LOD 200' },
  { tab: 'lod300', name: 'EAOSLOT-LOD-300', label: 'LOD 300' },
];
const ALL_SHEETS = [...SVG_SHEETS, ...IFC_SHEETS];

// Active instances
const svgViewers  = {};  // { tabId: SvgViewer }
const ifcInstances = {}; // { tabId: IfcViewer }
const ifcData     = {};  // { tabId: ArrayBuffer }

let activeTab = '2d-plan';

document.querySelectorAll('.viewer-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabId = tab.dataset.tab;
    if (tabId === activeTab) return;
    activeTab = tabId;

    document.querySelectorAll('.viewer-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tabId));
    document.querySelectorAll('.viewer-pane').forEach(p =>
      p.classList.toggle('active', p.id === `pane-${tabId}`));

    // Lazy-init IFC viewer on first tab activation if data is ready
    if (IFC_SHEETS.find(s => s.tab === tabId) && ifcData[tabId]) {
      initIfcPane(tabId);
    }

    // Re-fit SVG if it has content (viewport may have been resized)
    if (svgViewers[tabId]) {
      requestAnimationFrame(() => svgViewers[tabId].fitAll());
    }
  });
});

// ── Toolbar button delegation ──────────────────────────────────────────────
document.querySelectorAll('.viewer-pane').forEach(pane => {
  const toolbar = pane.querySelector('.viewer-toolbar');
  if (!toolbar) return;
  toolbar.addEventListener('click', e => {
    const btn = e.target.closest('.vt-btn');
    if (!btn) return;
    const action = btn.dataset.action;
    const tabId  = pane.id.replace('pane-', '');

    if (action === 'zoom-in')  svgViewers[tabId]?.zoom(1.3);
    if (action === 'zoom-out') svgViewers[tabId]?.zoom(1 / 1.3);
    if (action === 'fit-all') {
      svgViewers[tabId]?.fitAll();
      ifcInstances[tabId]?.fitAll();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  RIGHT PANEL — IFC Viewer init
// ═══════════════════════════════════════════════════════════════════════════

async function initIfcPane(tabId) {
  if (ifcInstances[tabId]) return; // already initialised

  const vp = $(`ifc-${tabId}`);
  if (!vp || !ifcData[tabId]) return;

  // Check the IFC bundle has loaded (it's type="module" so loads async)
  if (!window.IfcViewer) {
    setIfcStatus(tabId, 'IFC viewer module loading, please try again…');
    return;
  }

  setIfcStatus(tabId, 'Initialising viewer…');
  vp.querySelector('.viewer-placeholder')?.remove();

  const viewer = new window.IfcViewer(vp);
  ifcInstances[tabId] = viewer;

  try {
    await viewer.init();
    await viewer.loadIfc(ifcData[tabId], msg => {
      if (msg) {
        setIfcStatus(tabId, msg);
      } else {
        setIfcStatus(tabId, '');
        // Enable "Fit All" button
        const fitBtn = $(`pane-${tabId}`)?.querySelector('[data-action="fit-all"]');
        if (fitBtn) fitBtn.disabled = false;
      }
    });
  } catch (err) {
    setIfcStatus(tabId, `Error: ${err.message}`);
  }
}

function setIfcStatus(tabId, msg) {
  const el = $(`ifcstatus-${tabId}`);
  if (el) el.textContent = msg || '';
}

// ═══════════════════════════════════════════════════════════════════════════
//  RIGHT PANEL — Load Files Button
// ═══════════════════════════════════════════════════════════════════════════

function updateLoadFilesBtnState() {
  loadFilesBtn.disabled = !(_groupLoaded && dispatcherUrlInput.value.trim());
}

dispatcherUrlInput.addEventListener('input', updateLoadFilesBtnState);

loadFilesBtn.addEventListener('click', async () => {
  const groupId       = groupIdInput.value.trim();
  const email         = usernameInput.value.trim();
  const password      = passwordInput.value;
  const dispatcherUrl = dispatcherUrlInput.value.trim();

  if (!groupId || !email || !password) {
    showStatus('Load an elevator group first.', 'error');
    return;
  }
  if (!dispatcherUrl) {
    showStatus('Enter a Dispatcher URL.', 'error');
    return;
  }

  loadFilesBtn.disabled = true;
  loadFilesBtn.innerHTML = '<img src="/assets/icons/elevator-group.svg" alt="" class="btn-icon" /> Loading…';
  showStatus('Downloading drawings from LDWorker…', 'info');

  try {
    const allSheetDefs = ALL_SHEETS.map(s => ({
      name: s.name,
      type: IFC_SHEETS.find(i => i.tab === s.tab) ? 'ifc' : 'svg',
    }));

    const res  = await fetch('/api/viewer/load', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        env: currentEnv, email, password, groupId,
        dispatcherUrl,
        sheets: allSheetDefs,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    hideStatus();

    const results = data.results ?? {};

    // ── Inject SVG sheets ──────────────────────────────────────────────────
    for (const sheet of SVG_SHEETS) {
      const b64 = results[sheet.name];
      const vp  = $(`svg-${sheet.tab}`);
      if (!vp) continue;

      if (!b64) {
        vp.innerHTML = `<div class="viewer-placeholder">
          <img src="/assets/icons/circle-info.svg" alt="" />
          Sheet "${sheet.name}" not available.
        </div>`;
        continue;
      }

      const svgString = atob(b64);

      // Create or reuse SvgViewer
      if (svgViewers[sheet.tab]) {
        svgViewers[sheet.tab].destroy();
        delete svgViewers[sheet.tab];
      }
      svgViewers[sheet.tab] = new SvgViewer(vp);
      svgViewers[sheet.tab].loadSvg(svgString);
    }

    // ── Store IFC data; init viewer if that tab is active ──────────────────
    for (const sheet of IFC_SHEETS) {
      const b64 = results[sheet.name];
      if (!b64) {
        const vp = $(`ifc-${sheet.tab}`);
        if (vp) vp.innerHTML = `<div class="viewer-placeholder">
          <img src="/assets/icons/circle-info.svg" alt="" />
          Sheet "${sheet.name}" not available.
        </div>`;
        continue;
      }

      // Dispose existing viewer if reloading
      if (ifcInstances[sheet.tab]) {
        ifcInstances[sheet.tab].dispose();
        delete ifcInstances[sheet.tab];
        const vp = $(`ifc-${sheet.tab}`);
        if (vp) vp.innerHTML = '';
      }

      // Decode base64 → ArrayBuffer
      const raw = atob(b64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      ifcData[sheet.tab] = buf.buffer;

      // Add placeholder back until viewer inits
      const vp = $(`ifc-${sheet.tab}`);
      if (vp) vp.innerHTML = `<div class="viewer-placeholder">
        <img src="/assets/icons/circle-info.svg" alt="" />
        Click the tab to initialise 3D viewer.
      </div>`;

      // If this tab is currently active, init now
      if (activeTab === sheet.tab) initIfcPane(sheet.tab);
    }

  } catch (err) {
    showStatus(`Load Files error: ${err.message}`, 'error');
  } finally {
    loadFilesBtn.disabled = false;
    loadFilesBtn.innerHTML = '<img src="/assets/icons/elevator-group.svg" alt="" class="btn-icon" /> Load Files';
    updateLoadFilesBtnState();
  }
});
