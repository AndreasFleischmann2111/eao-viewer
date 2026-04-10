/**
 * copy-assets.mjs
 * Copies WASM and Web Worker files from node_modules to public/.
 * Run via: node scripts/copy-assets.mjs
 * Also executed automatically as part of postinstall.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public');

mkdirSync(publicDir, { recursive: true });

// ── web-ifc WASM (both ST and MT must exist even if only ST is used) ─────────
const wasmSrc = join(root, 'node_modules/web-ifc');
if (existsSync(join(wasmSrc, 'web-ifc.wasm'))) {
  copyFileSync(join(wasmSrc, 'web-ifc.wasm'),    join(publicDir, 'web-ifc.wasm'));
  copyFileSync(join(wasmSrc, 'web-ifc-mt.wasm'), join(publicDir, 'web-ifc-mt.wasm'));
  console.log('Copied web-ifc WASM files → public/');
} else {
  console.warn('web-ifc not found in node_modules — skipping WASM copy');
}

// ── fragments.worker.js — strip ES module export so classic Worker works ─────
// Workaround #1: the file ends with `export { ... }` which breaks classic Workers
const workerSrc = join(root, 'node_modules/@thatopen/fragments/dist/Worker/worker.mjs');
if (existsSync(workerSrc)) {
  const src = readFileSync(workerSrc, 'utf8');
  // Strip trailing `export { ... }` (handles both newline-separated and minified)
  const stripped = src.replace(/;?export\s*\{[^}]*\}\s*;?\s*$/, '');
  writeFileSync(join(publicDir, 'fragments.worker.js'), stripped, 'utf8');
  console.log('Copied fragments.worker.js → public/ (ES export stripped)');
} else {
  console.warn('@thatopen/fragments not found — skipping worker copy');
}

console.log('copy-assets done.');
