// ============================================================================
// Ocena odczytu: porównanie tego, co zwrócił potok, z wartościami wzorcowymi.
// ============================================================================
// Najważniejsza miara to NIE „średnia dokładność pól", tylko dwa pytania z życia:
//   1. Ile faktur jest w CAŁOŚCI poprawnych? (nagłówek + każda pozycja: ilość, cena, VAT, kod EAN)
//   2. Ile błędów jest CICHYCH — dokument zły, a aplikacja niczego nie zasygnalizowała?
// Błąd zgłoszony (suma się nie zgadza → ostrzeżenie, drugi odczyt) kosztuje człowieka 10 sekund.
// Błąd cichy kończy się złym stanem magazynu — dlatego raport liczy je osobno.

import type { Issue, Normalized, NormalizedLine } from '../supabase/functions/_shared/invoice.ts';
import { normalizeNip, normalizeUnit } from '../supabase/functions/_shared/validate.ts';
import type { Expected, ExpectedLine } from './cases.ts';

const normText = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();

const bigrams = (s: string) => {
  const t = s.replace(/\s+/g, ' ');
  const out = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
  return out;
};

/** Podobieństwo nazw 0–1: współczynnik Dice’a na bigramach; skrócona nazwa (paragon) jest prefiksem pełnej → też zgodna. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = normText(a);
  const y = normText(b);
  if (!x || !y) return x === y ? 1 : 0;
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 8 && long.startsWith(short) && short.length >= long.length * 0.55) return 0.95;
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  for (const [k, v] of bx) inter += Math.min(v, by.get(k) ?? 0);
  const total = [...bx.values()].reduce((s, v) => s + v, 0) + [...by.values()].reduce((s, v) => s + v, 0);
  return total === 0 ? 0 : (2 * inter) / total;
}

const money = (a: number | null, b: number | null, rel = 0) => (a === null || b === null ? a === b : Math.abs(a - b) <= Math.max(0.011, rel * Math.abs(b)));
const sameText = (a: string | null, b: string | null) => (a === null && b === null) || (a !== null && b !== null && normText(a).replace(/ /g, '') === normText(b).replace(/ /g, ''));

export interface LineScore {
  expectedName: string;
  matchedName: string | null;
  similarity: number;
  qty: boolean;
  unit: boolean;
  price: boolean;
  net: boolean;
  vat: boolean;
  ean: boolean;
  skip: boolean;
  exact: boolean;
}

export interface CaseScore {
  header: { kind: boolean; supplier: boolean; nip: boolean; number: boolean | null; date: boolean; currency: boolean; net: boolean | null; gross: boolean | null };
  lines: { expected: number; got: number; matched: number; extras: number; extraStock: number; perLine: LineScore[] };
  failed: string[];
  fullyCorrect: boolean;
  flagged: boolean;
  silentError: boolean;
}

export const MATCH_THRESHOLD = 0.5;

export function scoreCase(expected: Expected, got: Normalized, issues: readonly Pick<Issue, 'code'>[]): CaseScore {
  const failed: string[] = [];
  const header = {
    kind: got.doc_kind === expected.doc_kind,
    supplier: expected.supplier_name === null ? got.supplier_name === null : nameSimilarity(got.supplier_name, expected.supplier_name) >= 0.6,
    nip: (normalizeNip(got.supplier_nip) || null) === expected.supplier_nip,
    number: expected.invoice_number === null ? null : sameText(got.invoice_number, expected.invoice_number),
    date: got.issue_date === expected.issue_date,
    currency: got.currency === expected.currency,
    net: expected.total_net === null ? null : money(got.total_net, expected.total_net),
    gross: expected.total_gross === null ? null : money(got.total_gross, expected.total_gross),
  };
  for (const [k, v] of Object.entries(header)) if (v === false) failed.push(`nagłówek: ${k}`);

  // dopasowanie pozycji: zachłannie po najwyższym podobieństwie nazw
  const pairs: { e: number; g: number; s: number }[] = [];
  expected.lines.forEach((el, e) => got.lines.forEach((gl, g) => {
    const s = nameSimilarity(gl.raw_name, el.name);
    if (s >= MATCH_THRESHOLD) pairs.push({ e, g, s });
  }));
  pairs.sort((a, b) => b.s - a.s || a.e - b.e || a.g - b.g);
  const usedE = new Set<number>();
  const usedG = new Set<number>();
  const match = new Map<number, { g: number; s: number }>();
  for (const p of pairs) {
    if (usedE.has(p.e) || usedG.has(p.g)) continue;
    usedE.add(p.e);
    usedG.add(p.g);
    match.set(p.e, { g: p.g, s: p.s });
  }

  const perLine: LineScore[] = expected.lines.map((el: ExpectedLine, e) => {
    const m = match.get(e);
    if (!m) {
      failed.push(`pozycja pominięta: ${el.name}`);
      return { expectedName: el.name, matchedName: null, similarity: 0, qty: false, unit: false, price: false, net: false, vat: false, ean: false, skip: false, exact: false };
    }
    const gl: NormalizedLine = got.lines[m.g];
    const ls: LineScore = {
      expectedName: el.name, matchedName: gl.raw_name, similarity: m.s,
      qty: Math.abs(gl.qty - el.qty) < 0.0005,
      unit: el.unit === null ? true : normalizeUnit(gl.unit)?.toLowerCase() === normalizeUnit(el.unit)?.toLowerCase(),
      price: money(gl.unit_price_net, el.unit_price_net, 0.005),
      net: money(gl.total_net, el.total_net),
      vat: gl.vat_rate === el.vat_rate,
      ean: (gl.ean ?? null) === (el.ean ?? null),
      skip: gl.skip === el.skip,
      exact: false,
    };
    ls.exact = ls.qty && ls.price && ls.net && ls.vat && ls.ean && ls.skip;
    for (const k of ['qty', 'price', 'net', 'vat', 'ean', 'skip'] as const) if (!ls[k]) failed.push(`pozycja „${el.name}”: ${k}`);
    return ls;
  });

  const extras = got.lines.filter((_l, g) => !usedG.has(g));
  const extraStock = extras.filter((l) => !l.skip).length;
  if (extraStock > 0) failed.push(`pozycje urojone/nadmiarowe: ${extraStock}`);

  const headerOk = header.kind && header.nip && header.date && header.number !== false && header.net !== false && header.gross !== false;
  const fullyCorrect = headerOk && perLine.every((l) => l.exact) && extraStock === 0;
  const flagged = issues.length > 0;
  return {
    header,
    lines: { expected: expected.lines.length, got: got.lines.length, matched: match.size, extras: extras.length, extraStock, perLine },
    failed, fullyCorrect, flagged, silentError: !fullyCorrect && !flagged,
  };
}

/** Wynik dla przypadku, w którym potok w ogóle nie zwrócił odczytu (odmowa, ucięcie, awaria). */
export const failedRunScore = (expected: Expected): CaseScore => ({
  header: { kind: false, supplier: false, nip: false, number: expected.invoice_number === null ? null : false, date: false, currency: false, net: expected.total_net === null ? null : false, gross: expected.total_gross === null ? null : false },
  lines: { expected: expected.lines.length, got: 0, matched: 0, extras: 0, extraStock: 0, perLine: [] },
  failed: ['brak odczytu'], fullyCorrect: false, flagged: true, silentError: false,
});
