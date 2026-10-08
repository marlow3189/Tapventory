// Raport z uruchomienia zestawu ewaluacyjnego (Markdown, po polsku) + agregacja wyników.

import type { CaseScore } from './score.ts';

export interface RunResult {
  config: string;
  caseId: string;
  category: string;
  ok: boolean;
  error?: string;
  modelUsed?: string;
  escalated?: boolean;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  issueCodes: string[];
  score: CaseScore;
}

export interface EvalMeta {
  createdAt: string;
  usdPln: number;
  configs: Record<string, string>;
  dry: boolean;
  caseCount: number;
}

export interface Aggregate {
  n: number;
  runFailed: number;
  fullyCorrect: number;
  silentErrors: number;
  flagged: number;
  escalated: number;
  costUsd: number;
  avgCostUsd: number;
  medianMs: number;
  p95Ms: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  fields: Record<string, number>;
}

const pct = (a: number, b: number) => (b === 0 ? 0 : (100 * a) / b);
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export function aggregate(runs: RunResult[]): Aggregate {
  const n = runs.length;
  const scores = runs.map((r) => r.score);
  const hdr = (k: keyof CaseScore['header']) => {
    const vals = scores.map((s) => s.header[k]).filter((v): v is boolean => v !== null);
    return pct(vals.filter(Boolean).length, vals.length);
  };
  const lineVals = (k: 'qty' | 'price' | 'net' | 'vat' | 'ean' | 'skip' | 'unit') => {
    const all = scores.flatMap((s) => s.lines.perLine);
    return pct(all.filter((l) => l[k]).length, all.length);
  };
  const expectedLines = scores.reduce((a, s) => a + s.lines.expected, 0);
  const matched = scores.reduce((a, s) => a + s.lines.matched, 0);
  const got = scores.reduce((a, s) => a + s.lines.got, 0);
  const costUsd = runs.reduce((a, r) => a + r.costMicroUsd, 0) / 1_000_000;
  return {
    n,
    runFailed: runs.filter((r) => !r.ok).length,
    fullyCorrect: scores.filter((s) => s.fullyCorrect).length,
    silentErrors: scores.filter((s) => s.silentError).length,
    flagged: scores.filter((s) => s.flagged).length,
    escalated: runs.filter((r) => r.escalated).length,
    costUsd,
    avgCostUsd: n === 0 ? 0 : costUsd / n,
    medianMs: quantile(runs.map((r) => r.ms), 0.5),
    p95Ms: quantile(runs.map((r) => r.ms), 0.95),
    avgInputTokens: mean(runs.map((r) => r.inputTokens)),
    avgOutputTokens: mean(runs.map((r) => r.outputTokens)),
    fields: {
      'rodzaj dokumentu': hdr('kind'), 'dostawca (nazwa)': hdr('supplier'), NIP: hdr('nip'), 'numer faktury': hdr('number'), data: hdr('date'),
      waluta: hdr('currency'), 'suma netto': hdr('net'), 'suma brutto': hdr('gross'),
      'pozycje: kompletność': pct(matched, expectedLines), 'pozycje: bez urojonych': got === 0 ? 100 : pct(matched, got),
      ilość: lineVals('qty'), 'cena netto': lineVals('price'), 'wartość netto': lineVals('net'), 'stawka VAT': lineVals('vat'), 'kod EAN': lineVals('ean'),
      'pomijane (usługi/transport)': lineVals('skip'), jednostka: lineVals('unit'),
    },
  };
}

const f1 = (n: number) => n.toFixed(1).replace('.', ',');
const money = (usd: number, usdPln: number) => `${(usd * usdPln).toFixed(usd * usdPln < 0.1 ? 3 : 2).replace('.', ',')} zł`;

export function buildReport(meta: EvalMeta, runs: RunResult[]): string {
  const configs = [...new Set(runs.map((r) => r.config))];
  const by = (cfg: string) => runs.filter((r) => r.config === cfg);
  const agg = Object.fromEntries(configs.map((c) => [c, aggregate(by(c))]));
  const L: string[] = [];
  L.push(`# Wyniki zestawu ewaluacyjnego odczytu faktur`);
  L.push('');
  L.push(`Data: ${meta.createdAt} · przypadków: ${meta.caseCount} · kurs przeliczenia: 1 USD = ${meta.usdPln.toFixed(2).replace('.', ',')} zł${meta.dry ? ' · **TRYB PRÓBNY (atrapa dostawcy, nie prawdziwy model) — liczby poniżej NIE opisują żadnego modelu**' : ''}`);
  L.push('');
  L.push('Konfiguracje: ' + configs.map((c) => `**${c}** = ${meta.configs[c] ?? '?'}`).join(' · '));
  L.push('');
  L.push('## 1. Najważniejsze: poprawne w całości i błędy ciche');
  L.push('');
  L.push('| Konfiguracja | W całości poprawne | Błędy **ciche** | Zgłoszone ostrzeżeniem | Drugi odczyt | Koszt / dokument | Koszt / 1000 dok. | Czas (mediana / p95) |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const c of configs) {
    const a = agg[c];
    L.push(`| ${c} | ${f1(pct(a.fullyCorrect, a.n))}% (${a.fullyCorrect}/${a.n}) | ${f1(pct(a.silentErrors, a.n))}% (${a.silentErrors}) | ${f1(pct(a.flagged, a.n))}% | ${f1(pct(a.escalated, a.n))}% | ${money(a.avgCostUsd, meta.usdPln)} | ${money(a.avgCostUsd * 1000, meta.usdPln)} | ${(a.medianMs / 1000).toFixed(1).replace('.', ',')} s / ${(a.p95Ms / 1000).toFixed(1).replace('.', ',')} s |`);
  }
  L.push('');
  L.push('*Błąd cichy* = dokument jest zły, a kontrola kodu niczego nie zgłosiła — użytkownik zobaczyłby „zielony" szkic z błędnymi danymi. To jest najgroźniejszy rodzaj błędu; im bliżej 0%, tym lepiej.');
  L.push('');
  L.push('## 2. Dokładność pól (% poprawnych)');
  L.push('');
  const fieldNames = Object.keys(agg[configs[0]]?.fields ?? {});
  L.push(`| Pole | ${configs.join(' | ')} |`);
  L.push(`|---|${configs.map(() => '---:').join('|')}|`);
  for (const fn of fieldNames) L.push(`| ${fn} | ${configs.map((c) => f1(agg[c].fields[fn])).join(' | ')} |`);
  L.push('');
  L.push('## 3. Poprawne w całości — wg kategorii dokumentów');
  L.push('');
  const cats = [...new Set(runs.map((r) => r.category))];
  L.push(`| Kategoria | ${configs.join(' | ')} |`);
  L.push(`|---|${configs.map(() => '---:').join('|')}|`);
  for (const cat of cats) {
    const cells = configs.map((c) => {
      const rs = by(c).filter((r) => r.category === cat);
      return rs.length === 0 ? '—' : `${rs.filter((r) => r.score.fullyCorrect).length}/${rs.length}`;
    });
    L.push(`| ${cat} | ${cells.join(' | ')} |`);
  }
  L.push('');
  L.push('## 4. Co poszło źle (do 30 pierwszych przypadków)');
  L.push('');
  const bad = runs.filter((r) => !r.score.fullyCorrect).slice(0, 30);
  if (bad.length === 0) L.push('Wszystkie dokumenty odczytane w całości poprawnie.');
  for (const r of bad) {
    const why = r.ok ? r.score.failed.slice(0, 5).join('; ') : `odczyt nie powiódł się (${r.error ?? 'błąd'})`;
    L.push(`- **${r.config}** · \`${r.caseId}\` — ${why}${r.score.silentError ? ' — **CICHY**' : r.issueCodes.length ? ` — zgłoszono: ${[...new Set(r.issueCodes)].join(', ')}` : ''}`);
  }
  L.push('');
  L.push('## 5. Jak czytać wyniki i wybrać konfigurację');
  L.push('');
  L.push('1. Odrzuć konfiguracje z wyraźnie niższym odsetkiem „w całości poprawnych" — chyba że ich koszt jest o rząd wielkości niższy, a błędy są zgłaszane (nie ciche).');
  L.push('2. Spośród reszty wybierz tę z najmniejszą liczbą błędów **cichych**, potem z najniższym kosztem na 1000 dokumentów.');
  L.push('3. Konfiguracja `pipeline` (tani model → kontrola kodem → mocniejszy model tylko przy problemach) powinna dawać wynik zbliżony do najmocniejszego modelu przy kosztach zbliżonych do najtańszego. Jeśli tak nie jest, popraw progi w `needsEscalation` (supabase/functions/_shared/invoice.ts).');
  L.push('4. Zestaw jest syntetyczny — to test regresji i porównanie modeli, nie gwarancja jakości na Twoich prawdziwych fakturach. Po wdrożeniu mierz to samo na realnych poprawkach użytkowników (patrz docs/09_AI_I_OCR.md, rozdział „Mierz jakość w produkcji”).');
  L.push('');
  return L.join('\n');
}
