// ============================================================================
// Generuje wszystkie ikony aplikacji z jednego wzoru (SVG) — jedno źródło prawdy.
//   npm run assets
// Dla juniora: nie rysujesz ikon w grafice. Zmieniasz kolory/kształt poniżej
// i uruchamiasz skrypt; powstają pliki dla iOS, Androida i PWA.
//
// Wymagane reguły sklepów:
//  * iOS: ikona 1024×1024, kwadrat PEŁNY (bez przezroczystości i bez zaokrągleń — system zaokrągla sam),
//  * Android adaptacyjna: tło + pierwszy plan 1024×1024; ważny rysunek musi mieścić się w środkowych
//    ~66% (system przycina kształt: koło, "squircle"...) oraz wariant jednokolorowy (monochrome),
//  * PWA: 192/512 + wersja "maskable" (rysunek w środkowych 80%), apple-touch-icon 180.
// ============================================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = path.join(root, 'assets', 'images');
const pub = path.join(root, 'public');
mkdirSync(images, { recursive: true });
mkdirSync(pub, { recursive: true });

// Gradient marki (ten sam co w aplikacji: src/theme/tokens.ts → brandGradient)
const STOPS = ['#FEC053', '#F5576C', '#8B3FD9'];

const gradient = (id = 'g') => `
  <linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0">
    <stop offset="0" stop-color="${STOPS[0]}"/><stop offset="0.5" stop-color="${STOPS[1]}"/><stop offset="1" stop-color="${STOPS[2]}"/>
  </linearGradient>`;

/** Pudełko (izometryczny sześcian) w układzie 0..100, kreska zaokrąglona. */
const cube = (stroke, width = 6) => `
  <g fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M50 12 L84 31 L84 69 L50 88 L16 69 L16 31 Z"/>
    <path d="M16 31 L50 50 L84 31"/>
    <path d="M50 50 L50 88"/>
  </g>`;

/** Rysunek wpisany w kwadrat `size`, przeskalowany do `scale` powierzchni i wycentrowany. */
const glyph = (size, scale, stroke, width) => {
  const s = (size * scale) / 100;
  const off = (size - size * scale) / 2;
  return `<g transform="translate(${off} ${off}) scale(${s})">${cube(stroke, width)}</g>`;
};

const svg = (size, body, defs = '') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${defs}</defs>${body}</svg>`);

async function png(file, buffer, size) {
  await sharp(buffer).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
  console.log('  ✓', path.relative(root, file));
}

async function main() {
  console.log('Generuję ikony…');

  // 1) iOS / ogólna ikona: pełny gradient + biały znak
  const full = svg(1024, `<rect width="1024" height="1024" fill="url(#g)"/>${glyph(1024, 0.62, '#FFFFFF', 5.2)}`, gradient());
  await png(path.join(images, 'icon.png'), full, 1024);

  // 2) Android adaptacyjna: tło, pierwszy plan (znak w ~60%), jednokolorowa
  await png(path.join(images, 'android-icon-background.png'), svg(1024, `<rect width="1024" height="1024" fill="url(#g)"/>`, gradient()), 1024);
  await png(path.join(images, 'android-icon-foreground.png'), svg(1024, glyph(1024, 0.5, '#FFFFFF', 6)), 1024);
  await png(path.join(images, 'android-icon-monochrome.png'), svg(1024, glyph(1024, 0.5, '#FFFFFF', 6)), 1024);

  // 3) Splash: zaokrąglony kwadrat z gradientem na przezroczystym tle
  const splash = svg(
    1024,
    `<rect x="112" y="112" width="800" height="800" rx="208" fill="url(#g)"/>${glyph(1024, 0.44, '#FFFFFF', 6)}`,
    gradient()
  );
  await png(path.join(images, 'splash-icon.png'), splash, 1024);

  // 4) Web: favicony, ikony PWA, apple-touch-icon
  await png(path.join(images, 'favicon.png'), full, 64);
  await png(path.join(pub, 'favicon-32.png'), full, 32);
  await png(path.join(pub, 'apple-touch-icon.png'), full, 180);
  await png(path.join(pub, 'icon-192.png'), full, 192);
  await png(path.join(pub, 'icon-512.png'), full, 512);
  // "maskable": znak w środkowych 80% (system może przyciąć do koła)
  const maskable = svg(1024, `<rect width="1024" height="1024" fill="url(#g)"/>${glyph(1024, 0.5, '#FFFFFF', 6)}`, gradient());
  await png(path.join(pub, 'icon-maskable-512.png'), maskable, 512);

  // 5) Logo wektorowe (do strony www, dokumentów)
  writeFileSync(
    path.join(pub, 'logo.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs>${gradient()}</defs><rect width="512" height="512" rx="132" fill="url(#g)"/>${glyph(512, 0.62, '#FFFFFF', 5.2)}</svg>\n`
  );
  console.log('  ✓ public/logo.svg\nGotowe.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
