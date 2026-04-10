/**
 * build.mjs
 * Bundles src/ifc-viewer.js into public/ifc-viewer.bundle.js using esbuild.
 * Run via: node scripts/build.mjs
 */
import { build } from 'esbuild';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const entry = join(root, 'src/ifc-viewer.js');

if (!existsSync(entry)) {
  console.error('src/ifc-viewer.js not found — skipping bundle build');
  process.exit(0);
}

// Check that the required packages are installed
const obcPath = join(root, 'node_modules/@thatopen/components');
if (!existsSync(obcPath)) {
  console.warn('@thatopen/components not installed — skipping IFC bundle build');
  console.warn('Run: npm install');
  process.exit(0);
}

console.log('Building IFC viewer bundle…');

await build({
  entryPoints: [entry],
  bundle:      true,
  outfile:     join(root, 'public/ifc-viewer.bundle.js'),
  format:      'esm',           // ES module — loaded as <script type="module">
  platform:    'browser',
  sourcemap:   false,
  minify:      false,
  // Let import.meta.url resolve correctly in the browser bundle
  define: {},
  // Don't process .wasm binary files — they are served as static assets
  // and loaded at runtime via SetWasmPath('/', true)
  loader: {
    '.wasm': 'empty',           // replace any direct WASM imports with undefined
  },
  // Suppress warnings about dynamic require / import in @thatopen packages
  logLevel: 'warning',
});

console.log('Built: public/ifc-viewer.bundle.js');
