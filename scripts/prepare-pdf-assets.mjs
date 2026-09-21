import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const target = new URL(`public/pdfjs/${folder}/`, root);
  mkdirSync(target, { recursive: true });
  cpSync(fileURLToPath(new URL(`node_modules/pdfjs-dist/${folder}/`, root)), fileURLToPath(target), { recursive: true });
}
