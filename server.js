'use strict';

const express = require('express');
const path    = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Environment base URLs ───────────────────────────────────────────────────
const BASE_URLS = {
  dev:     'https://dev-operations.elevatorarchitect.com',
  staging: 'https://staging-operations.elevatorarchitect.com',
  prod:    'https://operations.elevatorarchitect.com',
};

// ─── Token cache: "env:email" → { token, expiresAt } ─────────────────────────
const tokenCache     = new Map();
const tokenInflight  = new Map();

async function fetchNewToken(base, email, password) {
  const res = await fetch(`${base}/api/User/Login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password }),
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Login failed HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const raw   = await res.text();
  const token = raw.startsWith('"') ? JSON.parse(raw) : raw.trim();
  if (!token?.startsWith('ey')) throw new Error('Invalid JWT response from login');

  // Parse exp claim
  const payload    = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const expiresAt  = (payload.exp * 1000) - 60_000;   // 60-s safety buffer
  return { token, expiresAt };
}

async function getToken(env, email, password) {
  const key    = `${env}:${email}`;
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  // Deduplicate concurrent requests
  if (tokenInflight.has(key)) return (await tokenInflight.get(key)).token;

  const base = BASE_URLS[env];
  const p    = fetchNewToken(base, email, password);
  tokenInflight.set(key, p);
  try {
    const result = await p;
    tokenCache.set(key, result);
    return result.token;
  } finally {
    tokenInflight.delete(key);
  }
}

// Invalidate cache when credentials change
app.post('/api/invalidate', (req, res) => {
  const { env, email } = req.body;
  if (env && email) tokenCache.delete(`${env}:${email}`);
  res.json({ ok: true });
});

// ─── Main data loader ─────────────────────────────────────────────────────────
app.post('/api/load', async (req, res) => {
  const { env, email, password, groupId } = req.body;

  if (!env || !email || !password || !groupId) {
    return res.status(400).json({ error: 'env, email, password, groupId are required' });
  }
  if (!BASE_URLS[env]) {
    return res.status(400).json({ error: `Unknown environment: ${env}` });
  }

  try {
    const token  = await getToken(env, email, password);
    const base   = BASE_URLS[env];
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
    };

    const eaoFetch = (url, timeoutMs = 15_000) =>
      fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
        .then(async r => {
          if (!r.ok) {
            const b = await r.text().catch(() => '');
            throw new Error(`EAO HTTP ${r.status} ${url.split('?')[0].split('/').pop()}: ${b.slice(0, 200)}`);
          }
          return r.json();
        });

    // ── 1. ElevatorGroup (hierarchy nav) ──────────────────────────────────────
    const group  = await eaoFetch(`${base}/api/ElevatorGroup/Get?elevatorGroupId=${encodeURIComponent(groupId)}`);
    const sbId   = group.parentSiteBuilding ?? group.siteBuildingId ?? group.buildingId;
    if (!sbId) throw new Error('Cannot resolve parentSiteBuilding from ElevatorGroup/Get response');

    // ── 2. SiteBuilding ────────────────────────────────────────────────────────
    const building = await eaoFetch(`${base}/api/SiteBuilding/Get?siteBuildingId=${encodeURIComponent(sbId)}`);
    const siteId   = building.parentSiteId ?? building.siteId ?? building.parentId;
    if (!siteId) throw new Error('Cannot resolve parentSiteId from SiteBuilding/Get response');

    // ── 3. Site ────────────────────────────────────────────────────────────────
    const site = await eaoFetch(`${base}/api/Site/Get?siteId=${encodeURIComponent(siteId)}`);

    // ── 4. ElevatorGroup extended (with units[]) ───────────────────────────────
    const groupEx = await eaoFetch(`${base}/api/ElevatorGroup/GetInformationEx?elevatorGroupId=${encodeURIComponent(groupId)}`);

    // ── 5. Floor levels — taken from SiteBuilding/Get response ───────────────
    //       Keep the id so the frontend can match against unit floor level flags.
    const rawFLs = building.floorLevels ?? building.FloorLevels ?? [];
    const floorLevels = rawFLs.map(f => ({
      id:   f.id    ?? f.ID,
      ix:   f.ix    ?? f.IX    ?? f.index ?? 0,
      desc: f.desc  ?? f.DESC  ?? f.description ?? '',
      dz:   f.dz    ?? f.DZ    ?? 0,
      zPot: f.z_POT ?? f.Z_POT ?? f.zPot ?? 0,
    }));

    // ── 6. All units via GetAll (dimensions + per-floor service flags) ─────────
    const allUnitsRaw = await eaoFetch(`${base}/api/ElevatorUnit/GetAll?parentElevatorGroupId=${encodeURIComponent(groupId)}`);
    const allUnits    = Array.isArray(allUnitsRaw) ? allUnitsRaw : (allUnitsRaw?.units ?? []);

    // Build floorFlags map per unit: { floorLevelId → bitmask }
    // Matched to building floor levels by ID. flags[0] & 0x1 = front, & 0x2 = rear.
    const units = allUnits.map(u => {
      const { requirements, ...rest } = u;
      const floorReq  = (requirements ?? []).find(r => Array.isArray(r.floorLevels));
      const floorFlags = {};
      for (const fl of (floorReq?.floorLevels ?? [])) {
        const id = fl.id ?? fl.ID;
        if (id) {
          const bits = Array.isArray(fl.flags) ? (fl.flags[0] ?? 0) : (fl.flags ?? 0);
          floorFlags[id] = bits;
        }
      }
      return { ...rest, floorFlags };
    });

    // ── 7. Parse bank settings from ElevatorGroup settings JSON ──────────────
    //       settings is a JSON string, e.g. {"SHAFTS_MODE":1,"BANK_2_START_SX":3,...}
    //       BANK_2_START_SX = first sx (shaft index) that belongs to Bank 2.
    let bank2StartSx = null;
    const settingsRaw = groupEx.settings ?? group.settings;
    if (settingsRaw) {
      try {
        const s = typeof settingsRaw === 'string' ? JSON.parse(settingsRaw) : settingsRaw;
        if (s.BANK_2_START_SX != null) bank2StartSx = s.BANK_2_START_SX;
      } catch { /* non-fatal */ }
    }

    // ── 8. Resolve supplier name via contract ──────────────────────────────────
    let supplierName = null;
    const contractId = groupEx.supplierId ?? group.supplierId;
    if (contractId) {
      try {
        const contract = await eaoFetch(`${base}/api/Contract/Get?contractId=${encodeURIComponent(contractId)}`, 10_000);
        supplierName   = contract?.title ?? null;
      } catch {
        // non-fatal — just skip supplier name
      }
    }

    res.json({ site, building, group, groupEx, units, floorLevels, bank2StartSx, supplierName });

  } catch (err) {
    // If the token we cached is stale, drop it so next call re-authenticates
    const key = `${env}:${email}`;
    if (err.message.includes('401') || err.message.includes('Login failed')) {
      tokenCache.delete(key);
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = 5182;
app.listen(PORT, () => {
  console.log(`EAO Viewer running at http://localhost:${PORT}`);
});
