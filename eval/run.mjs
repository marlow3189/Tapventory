// ============================================================================
// Uruchamia zestaw ewaluacyjny odczytu faktur i zapisuje raport.
//   1) npm run eval:generate                       (raz: zdjęcia i PDF-y z wartościami wzorcowymi)
//   2) ANTHROPIC_API_KEY=... npm run eval:run      (prawdziwe modele; KOSZT ok. 1–3 USD za komplet)
//      npm run eval:dry                            (atrapa dostawcy: sprawdza samą rurę, bez kluczy i kosztów)
// Opcje:  --configs=haiku,pipeline  --cases=clean-classic,receipt-a  --category="paragony"
//         --concurrency=3  --usd-pln=3.75  --noise=0.3 (tylko --dry)  --out=eval/results/moj-test
// Windows (PowerShell):  $env:ANTHROPIC_API_KEY="sk-ant-..."; npm run eval:run
// ============================================================================

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIGS, loadCases, runEval } from './runner.ts';
import { buildReport } from './report.ts';
import { DryProvider } from './dry.ts';
import { rng } from './cases.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback = '') => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split('=').slice(1).join('=');
const flag = (name) => process.argv.includes(`--${name}`);

const dry = flag('dry');
const dataDir = path.join(here, 'data');
if (!existsSync(path.join(dataDir, 'manifest.json'))) {
  console.error('Brak zestawu danych. Najpierw uruchom:  npm run eval:generate');
  process.exit(1);
}

let cases = loadCases(dataDir);
const only = arg('cases').split(',').filter(Boolean);
const category = arg('category');
if (only.length) cases = cases.filter((c) => only.includes(c.id));
if (category) cases = cases.filter((c) => c.category === category);
const wanted = arg('configs', DEFAULT_CONFIGS.map((c) => c.name).join(',')).split(',').filter(Boolean);
const configs = DEFAULT_CONFIGS.filter((c) => wanted.includes(c.name));
if (cases.length === 0 || configs.length === 0) {
  console.error('Nic do uruchomienia: sprawdź --cases / --category / --configs.');
  process.exit(1);
}

let providerFor;
if (dry) {
  const noise = Number(arg('noise', '0'));
  providerFor = (c) => new DryProvider(c.expected, noise, Math.floor(rng(c.id.length * 7919)() * 1e9));
} else {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error('Brak klucza API. Ustaw ANTHROPIC_API_KEY (patrz docs/09_AI_I_OCR.md) albo użyj trybu próbnego: npm run eval:dry');
    process.exit(1);
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { AnthropicExtractor } = await import('../supabase/functions/_shared/providers/anthropic.ts');
  const provider = new AnthropicExtractor(new Anthropic({ apiKey: key, maxRetries: 3, timeout: 240_000 }));
  providerFor = () => provider;
  const est = cases.length * configs.length;
  console.log(`Uruchamiam ${est} odczytów na prawdziwych modelach (ok. ${(est * 0.012).toFixed(1)} USD). Ctrl+C przerywa.`);
}

const started = Date.now();
const { meta, runs } = await runEval({
  cases, configs, providerFor, dry, usdPln: Number(arg('usd-pln', '3.75')), concurrency: Number(arg('concurrency', dry ? '8' : '3')),
  today: new Date('2026-10-08T12:00:00Z'),
  onProgress: (done, total, r) => process.stdout.write(`\r  ${done}/${total}  ${r.config.padEnd(9)} ${r.caseId.padEnd(20)} ${r.score.fullyCorrect ? '✔' : r.ok ? '✘' : '⚠'}   `),
});
console.log(`\nGotowe w ${((Date.now() - started) / 1000).toFixed(0)} s.`);

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const out = path.resolve(arg('out', path.join(here, 'results', `${dry ? 'dry-' : ''}${stamp}`)));
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'results.json'), JSON.stringify({ meta, runs }, null, 2));
const report = buildReport(meta, runs);
writeFileSync(path.join(out, 'report.md'), report);
console.log(`Wyniki:  ${path.join(out, 'results.json')}\nRaport:  ${path.join(out, 'report.md')}\n`);
console.log(report.split('\n').slice(0, 14).join('\n'));
