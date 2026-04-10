'use strict';

// LDWorker instances use self-signed TLS certificates on raw IP addresses.
// This must be set before any HTTPS requests are made.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const path    = require('path');

const app = express();
app.use(express.json());

// ─── COOP / COEP headers ─────────────────────────────────────────────────────
// Required for SharedArrayBuffer (used by web-ifc WASM in the IFC viewer).
// Must be set on all responses served to the browser.
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

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

// ─── Viewer file loader (LDWorker orchestration) ──────────────────────────────
//
// Flow:
//   1. Download LD3 from EAO  →  GET /api/ElevatorGroup/PrepareFileDownload
//   2. Open LDWorker slot     →  POST {dispatcherUrl}/api/Slot/Open
//   3. Upload LD3 to worker   →  POST {workerBaseURI}/api/Document/Load?slotId=
//   4. Export each sheet      →  GET  {workerBaseURI}/api/Sheet/Export?...
//   5. Close slot             →  DELETE {dispatcherUrl}/api/Slot/Close?...
//
// Returns base64-encoded file data for each requested sheet.
//
// NOTE: The EAO LD3 download endpoint is /api/ElevatorGroup/PrepareFileDownload.
//       Adjust if the actual endpoint differs in your environment.
//
app.post('/api/viewer/load', async (req, res) => {
  const { env, email, password, groupId, dispatcherUrl, sheets } = req.body;

  if (!env || !email || !password || !groupId || !dispatcherUrl || !Array.isArray(sheets)) {
    return res.status(400).json({ error: 'env, email, password, groupId, dispatcherUrl, sheets are required' });
  }
  if (!BASE_URLS[env]) {
    return res.status(400).json({ error: `Unknown environment: ${env}` });
  }

  // ── Stream NDJSON so the client receives log lines in real-time ───────────
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  function logTime() {
    return new Date().toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  function log(msg, level = 'info') {
    res.write(JSON.stringify({ type: 'log', time: logTime(), msg, level }) + '\n');
  }
  function finish(payload) {
    res.write(JSON.stringify({ type: 'result', ...payload }) + '\n');
    res.end();
  }

  let slotId       = null;
  let workerUri    = null;
  let ldAuthHdr    = null;
  const dispatchBase = dispatcherUrl.replace(/\/$/, '');

  try {
    // ── 1. Authenticate ───────────────────────────────────────────────────────
    log('Authenticating with EAO…');
    const token = await getToken(env, email, password);
    const base  = BASE_URLS[env];
    const authHdr = { Authorization: `Bearer ${token}` };
    ldAuthHdr = authHdr;
    log('✓ Authenticated', 'success');

    // ── 2. Download LD3 from EAO (two-step: token → binary) ──────────────────
    //
    // Step 2a — request a one-time download token
    //   sheetType=8  → full LD3 elevator-group bundle
    //   fileType=0   → LD3 binary format
    log(`Requesting LD3 download token from EAO (${env.toUpperCase()})…`);
    const tokenRes = await fetch(
      `${base}/api/elevatorgroup/preparefiledownload` +
      `?elevatorGroupId=${encodeURIComponent(groupId)}&sheetType=8&fileType=0`,
      { headers: authHdr, signal: AbortSignal.timeout(90_000) }
    );
    if (!tokenRes.ok) {
      const b = await tokenRes.text().catch(() => '');
      throw new Error(`preparefiledownload HTTP ${tokenRes.status}: ${b.slice(0, 200)}`);
    }
    const tokenJson = await tokenRes.json();
    const oneTimeToken = tokenJson.oneTimeToken ?? tokenJson.OneTimeToken ?? tokenJson.token;
    if (!oneTimeToken) throw new Error('preparefiledownload: no oneTimeToken in response');
    log('✓ Download token received', 'success');

    // Step 2b — fetch the binary file using the one-time token
    log('Downloading LD3 binary…');
    const ld3Res = await fetch(
      `${base}/api/elevatorgroup/downloadfile?accessId=${encodeURIComponent(oneTimeToken)}`,
      { headers: { ...authHdr, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(90_000) }
    );
    if (!ld3Res.ok) {
      const b = await ld3Res.text().catch(() => '');
      throw new Error(`downloadfile HTTP ${ld3Res.status}: ${b.slice(0, 200)}`);
    }
    const ld3Buffer = Buffer.from(await ld3Res.arrayBuffer());
    log(`✓ LD3 downloaded  (${(ld3Buffer.length / 1024).toFixed(1)} KB)`, 'success');

    // ── 3. Open dispatcher slot ───────────────────────────────────────────────
    log('Opening dispatcher slot…');
    const slotRes = await fetch(`${dispatchBase}/api/Slot/Open`, {
      method:  'POST',
      headers: { ...ldAuthHdr, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ region: 'eu-central-1', forHumanUser: true, killAfterIdleSeconds: 240 }),
      signal:  AbortSignal.timeout(15_000),
    });
    if (!slotRes.ok) {
      const b = await slotRes.text().catch(() => '');
      throw new Error(`Slot/Open HTTP ${slotRes.status}: ${b.slice(0, 200)}`);
    }
    const slotJson = await slotRes.json();
    slotId    = slotJson.slotId   ?? slotJson.SlotId;
    workerUri = (slotJson.workerBaseURI ?? slotJson.workerUri ?? slotJson.WorkerBaseURI ?? '').replace(/\/$/, '');

    if (!slotId)    throw new Error('Slot/Open: no slotId in response');
    if (!workerUri) throw new Error('Slot/Open: no workerBaseURI in response');

    log(`✓ Slot opened  →  ${slotId}`, 'success');
    log(`Worker URI  →  ${workerUri}`);

    // ── 4. Upload LD3 to worker ────────────────────────────────────────────────
    log('Uploading LD3 to worker…');
    const formData = new FormData();
    formData.append('file', new Blob([ld3Buffer], { type: 'application/octet-stream' }), 'model.ld3');

    const loadRes = await fetch(`${workerUri}/api/Document/Load?slotId=${encodeURIComponent(slotId)}`, {
      method:  'POST',
      headers: ldAuthHdr,
      body:    formData,
      signal:  AbortSignal.timeout(60_000),
    });
    if (!loadRes.ok) {
      const b = await loadRes.text().catch(() => '');
      throw new Error(`Document/Load HTTP ${loadRes.status}: ${b.slice(0, 200)}`);
    }
    // Document/Load returns { id: documentId, slotId } — documentId is required for Sheet/Export
    const loadJson  = await loadRes.json().catch(() => ({}));
    const documentId = loadJson.id ?? loadJson.documentId ?? loadJson.Id ?? loadJson.DocumentId;
    if (!documentId) throw new Error(`Document/Load: no documentId in response — got: ${JSON.stringify(loadJson).slice(0, 200)}`);
    log(`✓ Document loaded on worker  (docId: ${documentId})`, 'success');

    // ── 4b. List available sheets ─────────────────────────────────────────────
    try {
      const sheetsListRes = await fetch(
        `${workerUri}/api/Sheet/Get?slotId=${encodeURIComponent(slotId)}&documentId=${encodeURIComponent(documentId)}`,
        { headers: ldAuthHdr, signal: AbortSignal.timeout(15_000) }
      );
      if (sheetsListRes.ok) {
        const sheetsList = await sheetsListRes.json();
        const arr = Array.isArray(sheetsList) ? sheetsList : sheetsList.sheets ?? sheetsList.value ?? [];
        const names = arr.map(s => s.designation ?? s.zb_DESC ?? s.ZB_DESC ?? s.sheeT_NAME ?? s.name ?? JSON.stringify(s)).join(', ');
        log(`Available sheets: ${names || '(none listed)'}`);
      } else {
        const b = await sheetsListRes.text().catch(() => '');
        log(`Sheet/Get HTTP ${sheetsListRes.status}: ${b.slice(0, 200)}`, 'warning');
      }
    } catch (e) {
      log(`Sheet listing skipped: ${e.message}`, 'warning');
    }

    // ── 5. Export each sheet ──────────────────────────────────────────────────
    const results = {};

    for (const sheet of sheets) {
      const fileType = sheet.type === 'ifc' ? 20 : 18;
      log(`Exporting  ${sheet.name}  (${sheet.type.toUpperCase()})…`);

      const url = `${workerUri}/api/Sheet/Export` +
        `?slotId=${encodeURIComponent(slotId)}` +
        `&documentId=${encodeURIComponent(documentId)}` +
        `&ZB_DESCs=${encodeURIComponent(sheet.name)}` +
        `&options.fileType=${fileType}` +
        `&options.primaryLCID=2057` +
        `&options.options=0`;

      const exportRes = await fetch(url, { headers: ldAuthHdr, signal: AbortSignal.timeout(60_000) });
      if (!exportRes.ok) {
        const errBody = await exportRes.text().catch(() => '');
        log(`  ${sheet.name}  — HTTP ${exportRes.status}: ${errBody.slice(0, 300)}`, 'warning');
        results[sheet.name] = null;
        continue;
      }
      const buf = Buffer.from(await exportRes.arrayBuffer());

      const snippet = buf.slice(0, 512).toString('utf8');
      const isSvg   = snippet.trimStart().startsWith('<') && snippet.includes('<svg');
      const isIfc   = snippet.trimStart().startsWith('ISO-10303');

      if ((sheet.type === 'svg' && !isSvg) || (sheet.type === 'ifc' && !isIfc && buf.length < 1000)) {
        log(`  ${sheet.name}  — empty or wrong format`, 'warning');
        results[sheet.name] = null;
      } else {
        results[sheet.name] = buf.toString('base64');
        log(`✓ ${sheet.name}  (${(buf.length / 1024).toFixed(1)} KB)`, 'success');
      }
    }

    // ── 6. Close slot ─────────────────────────────────────────────────────────
    log('Closing dispatcher slot…');
    await fetch(
      `${dispatchBase}/api/Slot/Close?slotId=${encodeURIComponent(slotId)}&workerBaseURI=${encodeURIComponent(workerUri)}`,
      { method: 'DELETE', headers: ldAuthHdr, signal: AbortSignal.timeout(15_000) }
    ).catch(e => { log(`  Slot/Close warning: ${e.message}`, 'warning'); });
    log('✓ Slot closed', 'success');

    finish({ ok: true, results });

  } catch (err) {
    log(`✗ ${err.message}`, 'error');

    // Best-effort slot cleanup
    if (slotId && workerUri && ldAuthHdr) {
      fetch(
        `${dispatchBase}/api/Slot/Close?slotId=${encodeURIComponent(slotId)}&workerBaseURI=${encodeURIComponent(workerUri)}`,
        { method: 'DELETE', headers: ldAuthHdr }
      ).catch(() => {});
    }

    const key = `${env}:${email}`;
    if (err.message.includes('401') || err.message.includes('Login failed')) tokenCache.delete(key);

    finish({ ok: false, error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = 5182;
app.listen(PORT, () => {
  console.log(`EAO Viewer running at http://localhost:${PORT}`);
});
