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

// settings structure:
// {
//   lastEnv: 'prod',
//   lastGroupId: '...',
//   dev:     { email: '', password: '' },
//   staging: { email: '', password: '' },
//   prod:    { email: '', password: '' },
// }

// ═══════════════════════════════════════════════════════════════════════════
//  DOM REFS
// ═══════════════════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);
const groupIdInput = $('groupId');
const usernameInput = $('username');
const passwordInput = $('password');
const loadBtn = $('loadBtn');
const statusBar = $('statusBar');
const envButtons = document.querySelectorAll('.env-btn');

let currentEnv = 'prod';

// ═══════════════════════════════════════════════════════════════════════════
//  INIT — restore saved settings
// ═══════════════════════════════════════════════════════════════════════════

(function init() {
  const s = loadSettings();
  currentEnv = s.lastEnv || 'prod';
  groupIdInput.value = s.lastGroupId || '';

  setActiveEnv(currentEnv, false);

  const envCreds = s[currentEnv] || {};
  usernameInput.value = envCreds.email || '';
  passwordInput.value = envCreds.password || '';
})();

// ═══════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT SWITCHING
// ═══════════════════════════════════════════════════════════════════════════

function setActiveEnv(env, persist = true) {
  currentEnv = env;
  envButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.env === env);
  });

  // Restore credentials for this env
  const s = loadSettings();
  const envCreds = s[env] || {};
  usernameInput.value = envCreds.email || '';
  passwordInput.value = envCreds.password || '';

  if (persist) {
    s.lastEnv = env;
    saveSettings(s);
  }
}

envButtons.forEach(btn => {
  btn.addEventListener('click', () => setActiveEnv(btn.dataset.env));
});

// Save credentials on change
function persistCredentials() {
  const s = loadSettings();
  s[currentEnv] = { email: usernameInput.value, password: passwordInput.value };
  // Invalidate server token cache for this env when credentials change
  const prev = (s[currentEnv] || {});
  if (prev.email !== usernameInput.value || prev.password !== passwordInput.value) {
    fetch('/api/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: currentEnv, email: usernameInput.value }),
    }).catch(() => {});
  }
  s[currentEnv] = { email: usernameInput.value, password: passwordInput.value };
  saveSettings(s);
}

usernameInput.addEventListener('change', persistCredentials);
passwordInput.addEventListener('change', persistCredentials);
groupIdInput.addEventListener('change', () => {
  const s = loadSettings();
  s.lastGroupId = groupIdInput.value.trim();
  saveSettings(s);
});

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
  persistCredentials();
  const s = loadSettings();
  s.lastGroupId = groupId;
  saveSettings(s);

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
    if (!hasBanks) return `<div class="unit-columns">${cards}</div>`;
    return `
      <div class="bank-section">
        <div class="bank-label">BANK ${bankNum}</div>
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
}
