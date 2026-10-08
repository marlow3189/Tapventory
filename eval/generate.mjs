// ============================================================================
// Generuje zestaw ewaluacyjny: zdjęcia / PDF-y faktur + plik z wartościami wzorcowymi.
//   npm run eval:generate            (wszystkie przypadki)
//   node eval/generate.mjs --only=clean-classic,receipt-a
// Wynik: eval/data/<id>/page-N.(jpg|png) lub document.pdf, eval/data/<id>/case.json, eval/data/manifest.json
// Wymaga Chromium dla Playwrighta:  npx playwright install chromium   (jednorazowo)
// ============================================================================

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAllCases } from './cases.ts';
import { pdfHtml, renderPages } from './render.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, 'data');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);

async function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try {
      return await import(c);
    } catch {
      // następna lokalizacja
    }
  }
  throw new Error('Brak pakietu playwright. W katalogu głównym repozytorium uruchom: npm install && npx playwright install chromium');
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const cases = buildAllCases().filter((c) => only.length === 0 || only.includes(c.id));
mkdirSync(dataDir, { recursive: true });

const manifest = [];
for (const c of cases) {
  const dir = path.join(dataDir, c.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const pages = renderPages(c);
  const files = [];

  if (c.asPdf) {
    // PDF: jeden dokument HTML, każda strona = osobna kartka A4
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(pdfHtml(pages), { waitUntil: 'load' });
    await page.pdf({ path: path.join(dir, 'document.pdf'), width: `${pages[0].width}px`, height: `${pages[0].height}px`, printBackground: true, preferCSSPageSize: true });
    files.push('document.pdf');
    await ctx.close();
  } else {
    const targetWidth = c.degrade.width ?? 1240;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const ctx = await browser.newContext({ viewport: { width: p.width, height: p.height }, deviceScaleFactor: Math.max(0.5, Math.min(3, targetWidth / p.width)) });
      const page = await ctx.newPage();
      await page.setContent(p.html, { waitUntil: 'load' });
      const photo = c.degrade.jpegQuality !== undefined || c.degrade.rotate || c.degrade.shadow || c.degrade.perspective;
      const name = photo ? `page-${i + 1}.jpg` : `page-${i + 1}.png`;
      await page.screenshot(photo ? { path: path.join(dir, name), type: 'jpeg', quality: c.degrade.jpegQuality ?? 80 } : { path: path.join(dir, name), type: 'png' });
      files.push(name);
      await ctx.close();
    }
  }

  writeFileSync(path.join(dir, 'case.json'), JSON.stringify({ id: c.id, category: c.category, note: c.note, files, expected: c.expected }, null, 2));
  manifest.push({ id: c.id, category: c.category, note: c.note, files });
  console.log(`✔ ${c.id.padEnd(20)} ${files.join(', ')}`);
}
writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`\nGotowe: ${manifest.length} przypadków w ${dataDir}`);
