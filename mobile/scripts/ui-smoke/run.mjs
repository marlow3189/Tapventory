// ============================================================================
// Test dymny interfejsu (przeglądarka Chromium + atrapa Supabase).
//   1)  npm run build:web          (zbuduj aplikację z  EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321)
//   2)  node scripts/ui-smoke/run.mjs [katalog-dist] [katalog-zrzutów]
// Otwiera najważniejsze ekrany w widoku telefonu, robi zrzuty i zgłasza błędy z konsoli.
// Wymaga pakietu "playwright" (npm i -D playwright && npx playwright install chromium).
// ============================================================================

import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDS, installMock, sessionPayload } from './mock-backend.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] ?? path.join(here, '../../dist'));
const outDir = path.resolve(process.argv[3] ?? path.join(here, '../../ui-smoke-out'));
mkdirSync(outDir, { recursive: true });

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const c of candidates) {
    try {
      return await import(c);
    } catch {
      // próbujemy następnej lokalizacji
    }
  }
  throw new Error('Brak pakietu playwright. Zainstaluj: npm i -D playwright && npx playwright install chromium');
}
const { chromium } = await loadPlaywright();

// ---- prosty serwer plików statycznych z „SPA fallback" ------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.join(dist, urlPath);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
});

const problems = [];
let shot = 0;

async function newPage({ role = 'owner', loggedIn = true, scheme = 'light', width = 390, height = 844 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: width < 600,
    hasTouch: width < 600,
    locale: 'pl-PL',
    colorScheme: scheme,
    permissions: ['camera'],
  });
  const page = await context.newPage();
  const calls = [];
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|Failed to load resource.*(404|net::ERR)|realtime|WebSocket/i.test(t)) return;
    problems.push(`[console.error] ${t.slice(0, 300)}`);
  });
  await installMock(page, { role, calls });
  if (loggedIn) {
    await page.addInitScript((s) => {
      localStorage.setItem('tapventory-auth', JSON.stringify(s));
      localStorage.setItem('tv.aiConsent.v1', new Date().toISOString());
    }, sessionPayload());
  }
  return { page, context, calls };
}

async function snap(page, name) {
  shot += 1;
  const file = path.join(outDir, `${String(shot).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log('  📸', path.basename(file));
}

async function visit(page, route, waitText) {
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
  if (waitText) await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
}

async function step(title, fn) {
  console.log(`▶ ${title}`);
  try {
    await fn();
  } catch (e) {
    problems.push(`[${title}] ${e.message.split('\n')[0]}`);
    console.log('  ✗', e.message.split('\n')[0]);
  }
}

// ---- 1. niezalogowany -------------------------------------------------------------------------
{
  const { page, context } = await newPage({ loggedIn: false });
  await step('logowanie', async () => {
    await visit(page, '/', 'Zaloguj się');
    await snap(page, 'login');
  });
  await step('rejestracja', async () => {
    await visit(page, '/register', 'Załóż konto');
    await page.getByRole('button', { name: 'Załóż konto' }).click();
    await page.getByText('Podaj imię').waitFor();
    await snap(page, 'register-validation');
  });
  await step('reset hasła', async () => {
    await visit(page, '/forgot', 'Reset hasła');
    await snap(page, 'forgot');
  });
  await step('link /join bez logowania → logowanie', async () => {
    await visit(page, '/join?code=ABCD-EFGH', 'Zaloguj się');
  });
  await context.close();
}

// ---- 2. właściciel (telefon, jasny) -----------------------------------------------------------
{
  const { page, context, calls } = await newPage();
  await step('start: stories + feed', async () => {
    await visit(page, '/', 'Rękawice nitrylowe L');
    await snap(page, 'home');
  });
  await step('menu „+"', async () => {
    await page.getByRole('button', { name: 'Dodaj' }).click();
    await page.getByText('Co chcesz zrobić?').waitFor();
    await page.waitForTimeout(700);   // animacja wysuwania arkusza
    await snap(page, 'create-sheet');
    await page.keyboard.press('Escape');
    await page.mouse.click(195, 60);
  });
  await step('story: braki', async () => {
    await visit(page, '/story/low', 'Zgłoś brak');
    await snap(page, 'story-low');
  });
  await step('story: zgłoszenia do decyzji', async () => {
    await visit(page, '/story/requests', 'Zaakceptuj');
    await snap(page, 'story-requests');
  });
  await step('magazyn (siatka)', async () => {
    await visit(page, '/explore', 'Rękawice');
    await snap(page, 'explore');
  });
  await step('aktywność', async () => {
    await visit(page, '/activity', 'Aktywność');
    await page.getByText('Nowe zgłoszenie od Marek Nowak').waitFor();
    await snap(page, 'activity');
  });
  await step('profil', async () => {
    await visit(page, '/profile', 'Anna Kowalska');
    await snap(page, 'profile');
  });
  await step('produkt + „Zdejmij"', async () => {
    await visit(page, `/product/66666666-6666-4666-8666-666666666661`, 'Rękawice nitrylowe L');
    await snap(page, 'product');
    await page.getByRole('button', { name: 'Zdejmij', exact: true }).click();
    await page.getByText('Zdejmij: Rękawice nitrylowe L').waitFor();
    await page.waitForTimeout(700);
    await snap(page, 'take-sheet');
  });
  await step('edycja produktu', async () => {
    await visit(page, `/product/edit?id=66666666-6666-4666-8666-666666666661`, 'Edytuj produkt');
    await snap(page, 'product-edit');
  });
  await step('zgłoszenie: szczegóły + czat', async () => {
    await visit(page, `/request/${IDS.req1}`, 'Wziąłbym czarne');
    await snap(page, 'request-detail');
  });
  await step('nowe zgłoszenie', async () => {
    await visit(page, '/request/new', 'Zgłoś brak');
    await page.getByPlaceholder('np. rękawice nitrylowe L').fill('Rękaw');
    await page.getByText('Z magazynu').waitFor();
    await snap(page, 'request-new');
  });
  await step('faktury: lista', async () => {
    await visit(page, '/documents', 'Hurtownia ABC');
    await snap(page, 'documents');
  });
  await step('faktura: weryfikacja', async () => {
    await visit(page, `/documents/${IDS.doc}`, 'RĘKAWICE NITRYL');
    await snap(page, 'document-detail');
    await page.getByText('Płyn do szyb zimowy 5L').click();
    await page.getByText('Edytuj pozycję').waitFor();
    await page.waitForTimeout(700);
    await snap(page, 'document-line-editor');
  });
  await step('faktura: czytanie przez AI', async () => {
    await visit(page, `/documents/${IDS.docProcessing}`, 'AI czyta fakturę');
    await snap(page, 'document-processing');
  });
  await step('skan faktury', async () => {
    await visit(page, '/documents/scan', 'Skanuj fakturę');
    await snap(page, 'document-scan');
  });
  await step('skaner kodów', async () => {
    await visit(page, '/scan?mode=find', 'Zeskanuj kod produktu');
    await page.waitForTimeout(800);
    await snap(page, 'scanner');
  });
  await step('mini-spis', async () => {
    await visit(page, '/count', 'do policzenia');
    await snap(page, 'count-intro');
    await page.getByRole('button', { name: /Zaczynamy/ }).click();
    await page.getByText('Ile zostało:').waitFor();
    await snap(page, 'count-prompt');
  });
  await step('zespół', async () => {
    await visit(page, '/team', 'Anna Kowalska');
    await snap(page, 'team');
  });
  await step('zaproszenie', async () => {
    await visit(page, '/team/invite', 'Zaproś osobę');
    await snap(page, 'invite');
  });
  await step('ustawienia', async () => {
    await visit(page, '/settings', 'Plan i limity');
    await snap(page, 'settings');
  });
  await step('asystent AI', async () => {
    await visit(page, '/assistant', 'Asystent AI');
    await page.getByText('Jak zdjąć towar z magazynu?').click();
    await page.getByText('Aby zdjąć towar').waitFor();
    await snap(page, 'assistant');
  });
  await step('dołącz kodem', async () => {
    await visit(page, '/join?code=ABCD-EFGH', 'Dołącz do firmy');
    await snap(page, 'join');
  });
  await step('nieistniejąca strona', async () => {
    await visit(page, '/nie-ma-takiej', 'Tej strony nie ma');
  });
  console.log(`  (żądań do atrapy backendu: ${calls.length})`);
  await context.close();
}

// ---- 3. pracownik: brak funkcji kierownika ---------------------------------------------------
{
  const { page, context } = await newPage({ role: 'employee' });
  await step('pracownik: faktury przekierowują na start', async () => {
    await visit(page, '/documents', 'Rękawice nitrylowe L');
    if (page.url().includes('/documents')) throw new Error('pracownik nie powinien widzieć listy faktur');
  });
  await step('pracownik: magazyn bez przycisku dodawania', async () => {
    await visit(page, '/explore', 'Rękawice');
    if ((await page.getByRole('button', { name: 'Dodaj produkt' }).count()) > 0) throw new Error('przycisk „Dodaj produkt” widoczny dla pracownika');
    await snap(page, 'employee-explore');
  });
  await context.close();
}

// ---- 4. tryb ciemny + komputer ---------------------------------------------------------------
{
  const { page, context } = await newPage({ scheme: 'dark' });
  await step('ciemny: start', async () => {
    await visit(page, '/', 'Rękawice nitrylowe L');
    await snap(page, 'dark-home');
  });
  await step('ciemny: faktura', async () => {
    await visit(page, `/documents/${IDS.doc}`, 'RĘKAWICE NITRYL');
    await snap(page, 'dark-document');
  });
  await context.close();
}
{
  const { page, context } = await newPage({ width: 1280, height: 800 });
  await step('komputer: kolumna wyśrodkowana', async () => {
    await visit(page, '/', 'Rękawice nitrylowe L');
    await snap(page, 'desktop-home');
  });
  await context.close();
}

await browser.close();
server.close();

console.log('\n=== PODSUMOWANIE ===');
console.log(`Zrzuty: ${outDir}`);
if (problems.length) {
  console.log(`Problemy (${problems.length}):`);
  for (const p of problems) console.log('  -', p);
  process.exit(1);
}
console.log('Brak błędów w konsoli i na ekranach.');
