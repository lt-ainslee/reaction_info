// Copy the RDKit WASM build into public/ so it is served from our own domain
// (no dependency on a foreign CDN, which is slow or blocked for many users).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@rdkit', 'rdkit', 'dist');
const dest = join(root, 'public', 'rdkit');

if (!existsSync(src)) {
  console.warn('[copy-rdkit] @rdkit/rdkit not installed yet, skipping');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of ['RDKit_minimal.js', 'RDKit_minimal.wasm']) {
  copyFileSync(join(src, f), join(dest, f));
}
console.log('[copy-rdkit] copied RDKit to public/rdkit');
