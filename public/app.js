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

// Interpret service flag bits: 0x1=front, 0x2=rear
function serviceFlag(flags) {
  // flags may be: null, [], [number], [obj], number
  let bits = null;

  if (flags == null) return '<span class="flag-none">—</span>';
  if (typeof flags === 'number') {
    bits = flags;
  } else if (Array.isArray(flags)) {
    if (flags.length === 0) return '<span class="flag-none">—</span>';
    const first = flags[0];
    if (typeof first === 'number') bits = first;
    else if (typeof first === 'object' && first !== null) {
      // Try common field names
      bits = first.value ?? first.flags ?? first.mask ?? first.flag ?? null;
    }
  }

  if (bits == null) return `<span class="flag-raw" title="${esc(JSON.stringify(flags))}">?</span>`;

  const front = !!(bits & 0x1);
  const rear  = !!(bits & 0x2);

  if (front && rear)  return '<span class="flag-badge flag-both">F+R</span>';
  if (front)          return '<span class="flag-badge flag-front">F</span>';
  if (rear)           return '<span class="flag-badge flag-rear">R</span>';
  return '<span class="flag-none">—</span>';
}

// Normalize floor level from EAO .NET format
function normalizeFL(fl) {
  return {
    id:   fl.id   ?? fl.ID,
    ix:   fl.IX   ?? fl.ix   ?? 0,
    desc: fl.DESC ?? fl.desc ?? '',
    dz:   fl.DZ   ?? fl.dz   ?? 0,
    zPot: fl.Z_POT ?? fl.z_POT ?? 0,
    flags: fl.Flags ?? fl.flags ?? null,
  };
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
// ═══════════════════════════════════════════════════════════════════════════

function renderFloorLevels(units) {
  const el = $('floors-content');

  // Collect all floor levels from all units and build an index by ix
  // Master list from unit 0; align others by ix
  if (!units || units.length === 0) {
    el.innerHTML = '<p class="expander-placeholder">No unit data available.</p>';
    return;
  }

  // Build per-unit floor level maps: ix → normalised FL
  const unitFLMaps = units.map(u => {
    const fls = (u.floorLevels ?? []).map(normalizeFL);
    const map = new Map();
    fls.forEach(fl => map.set(fl.ix, fl));
    return map;
  });

  // Master floor list = union of all ix values, sorted ascending
  const allIx = new Set();
  unitFLMaps.forEach(m => m.forEach((_, ix) => allIx.add(ix)));
  const sortedIx = [...allIx].sort((a, b) => a - b);

  if (sortedIx.length === 0) {
    el.innerHTML = '<p class="expander-placeholder">No floor level data available.</p>';
    return;
  }

  // Desc from first unit that has this ix
  const masterDesc = ix => {
    for (const m of unitFLMaps) {
      const fl = m.get(ix);
      if (fl?.desc) return fl.desc;
    }
    return '';
  };
  const masterDZ = ix => {
    for (const m of unitFLMaps) {
      const fl = m.get(ix);
      if (fl?.dz != null) return fl.dz;
    }
    return 0;
  };

  // Header
  const unitHeaders = units
    .map((u, i) => `<th class="fl-unit-header">${esc(u.title ?? u.elevatorUnitId ?? `Unit ${i + 1}`)}</th>`)
    .join('');

  // Rows
  const rows = sortedIx.map(ix => {
    const desc = masterDesc(ix);
    const dz   = masterDZ(ix);
    const unitCells = units.map((_, i) => {
      const fl   = unitFLMaps[i].get(ix);
      const html = fl ? serviceFlag(fl.flags) : '<span class="flag-none">—</span>';
      return `<td class="fl-flag-cell">${html}</td>`;
    }).join('');

    return `<tr>
      <td class="fl-desc">${esc(desc)}</td>
      <td class="fl-dz">${esc(dz)}</td>
      <td class="fl-ix">${esc(ix)}</td>
      ${unitCells}
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="fl-table-wrap">
      <table class="fl-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>DZ</th>
            <th>Level (IX)</th>
            ${unitHeaders}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="fl-legend">
      <span class="flag-badge flag-front">F</span> Front (0x1) &nbsp;
      <span class="flag-badge flag-rear">R</span> Rear (0x2) &nbsp;
      <span class="flag-badge flag-both">F+R</span> Both (0x3)
    </p>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RENDER — Elevator Group & Units
// ═══════════════════════════════════════════════════════════════════════════

function renderGroupAndUnits(groupEx, units, supplierName) {
  const el = $('group-content');

  // ── Group summary ────────────────────────────────────────────────────────
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

  // ── Unit columns ─────────────────────────────────────────────────────────
  const unitCards = units.map((u, i) => {
    const unitRows = [
      row('Unit ID',      u.elevatorUnitId ?? u.id),
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
  }).join('');

  el.innerHTML = `
    ${groupHtml}
    <div class="unit-columns">${unitCards}</div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RENDER ALL
// ═══════════════════════════════════════════════════════════════════════════

function renderAll(data) {
  renderSiteBuilding(data.site, data.building);
  renderFloorLevels(data.units);
  renderGroupAndUnits(data.groupEx, data.units, data.supplierName);

  // Make sure all expanders are open after loading
  document.querySelectorAll('.expander-header').forEach(btn => {
    btn.setAttribute('aria-expanded', 'true');
    const bodyId = btn.getAttribute('aria-controls');
    document.getElementById(bodyId).style.maxHeight = 'none';
  });
}
