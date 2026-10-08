// Kopiuje plik WebAssembly skanera kodów kreskowych do folderu public/.
//
// Po co: przeglądarki bez wbudowanego skanera (iPhone/Safari, Firefox) używają biblioteki
// zxing-wasm, która domyślnie dociąga ~1 MB ze sklepu CDN jsDelivr. My hostujemy ten plik
// SAMI (ta sama domena co aplikacja): działa w trybie offline (PWA), nie łączy użytkownika
// z cudzym serwerem i pozwala na restrykcyjną politykę CSP.
// Uruchamia się automatycznie po `npm install` oraz przed `npm run build:web`.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm');
const to = path.join(root, 'public', 'zxing_reader.wasm');

if (!existsSync(from)) {
  console.warn('[copy-wasm] Nie znaleziono zxing_reader.wasm (jeszcze nie zainstalowano zależności?). Pomijam.');
  process.exit(0);
}
mkdirSync(path.dirname(to), { recursive: true });
copyFileSync(from, to);
console.log('[copy-wasm] public/zxing_reader.wasm gotowy.');
