import test from 'node:test';
import assert from 'node:assert/strict';
import { gs1ChecksumOk, isValidNip, round2 } from '../../supabase/functions/_shared/validate.ts';
import { normalizeExtraction, verifyExtraction } from '../../supabase/functions/_shared/invoice.ts';
import { buildAllCases, makeEan13, makeNip, rng } from '../cases.ts';
import { pdfHtml, renderPages, fmtNum, fmtDate } from '../render.ts';
import { failedRunScore, nameSimilarity, scoreCase } from '../score.ts';
import { aggregate, buildReport, type RunResult } from '../report.ts';
import { DryProvider, toModelJson } from '../dry.ts';
import { DEFAULT_CONFIGS, runEval, type LoadedCase } from '../runner.ts';
import type { PageInput } from '../../supabase/functions/_shared/provider.ts';

const TODAY = new Date('2026-10-08T12:00:00Z');
const cases = buildAllCases();

// --- przypadki ------------------------------------------------------------------------------------------

test('zestaw: unikalne identyfikatory, kategorie i powtarzalność (to samo ziarno = ten sam dokument)', () => {
  assert.equal(cases.length, 28);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  assert.ok(new Set(cases.map((c) => c.category)).size >= 10);
  assert.deepEqual(buildAllCases(), cases);
});

test('zestaw: wygenerowane NIP-y i EAN-y mają poprawne sumy kontrolne', () => {
  const r = rng(1);
  for (let i = 0; i < 200; i++) {
    assert.ok(isValidNip(makeNip(r)));
    assert.ok(gs1ChecksumOk(makeEan13(r)));
  }
  for (const c of cases) {
    assert.ok(isValidNip(c.seller.nip), c.id);
    assert.ok(isValidNip(c.buyer.nip), c.id);
    for (const l of c.expected.lines) if (l.ean) assert.ok(gs1ChecksumOk(l.ean), `${c.id}: ${l.ean}`);
  }
});

test('zestaw: wartości wzorcowe są spójne wewnętrznie (sumy, ilość × cena, daty)', () => {
  for (const c of cases) {
    const e = c.expected;
    assert.match(e.issue_date ?? '2000-01-01', /^\d{4}-\d{2}-\d{2}$/, c.id);
    if (c.id === 'non-document') {
      assert.deepEqual([e.doc_kind, e.lines.length], ['other', 0]);
      continue;
    }
    assert.ok(e.lines.length >= 3, c.id);
    if (e.doc_kind === 'invoice' || e.doc_kind === 'correction') {
      const net = round2(e.lines.reduce((a, l) => a + (l.total_net ?? 0), 0));
      assert.equal(net, e.total_net, `${c.id}: suma netto`);
      for (const l of e.lines) if (l.unit_price_net !== null && l.total_net !== null && e.doc_kind === 'invoice') {
        assert.ok(Math.abs(round2(l.qty * l.unit_price_net) - l.total_net) < 0.011, `${c.id}: ${l.name}`);
      }
    }
    if (e.doc_kind === 'receipt') {
      assert.equal(e.invoice_number, null);
      assert.equal(e.total_net, null);
      const gross = round2(e.lines.reduce((a, l) => a + (l.total_net ?? 0), 0));
      assert.ok(Math.abs(gross - (e.total_gross as number)) < 0.02, `${c.id}: suma paragonu ${gross} vs ${e.total_gross}`);
    }
    if (e.doc_kind === 'delivery_note') assert.deepEqual([e.total_net, e.total_gross, e.lines[0].unit_price_net], [null, null, null]);
    if (e.doc_kind === 'correction') assert.ok(e.lines.every((l) => l.qty < 0 && (l.total_net as number) < 0), `${c.id}: korekta = różnice ujemne`);
  }
});

test('zestaw: pokrycie trudnych sytuacji (rabaty, waluta, PDF, wiele stron, korekty, wstrzyknięcie, zdjęcia)', () => {
  const has = (f: (c: (typeof cases)[number]) => boolean) => cases.some(f);
  assert.ok(has((c) => c.discountMode === 'after') && has((c) => c.discountMode === 'listed'));
  assert.ok(has((c) => c.currency === 'EUR') && has((c) => c.seller.nipPrefix === 'PL'));
  assert.ok(has((c) => c.asPdf) && has((c) => c.pages > 1 && !c.asPdf));
  assert.ok(has((c) => c.layout === 'correction') && has((c) => c.layout === 'receipt') && has((c) => c.layout === 'delivery'));
  assert.ok(has((c) => c.extraNote !== null));
  assert.ok(has((c) => (c.degrade.rotate ?? 0) !== 0 && c.degrade.shadow === true) && has((c) => c.degrade.perspective === true));
  assert.ok(has((c) => c.expected.lines.some((l) => l.skip)) && has((c) => c.expected.lines.some((l) => l.vat_rate === null)));
  assert.ok(has((c) => c.expected.lines.some((l) => l.vat_rate === 8)) && has((c) => c.expected.lines.some((l) => l.vat_rate === 5)));
});

// --- szablony HTML ----------------------------------------------------------------------------------------

test('szablony: każdy dokument zawiera dane wzorcowe i żadnych śladów błędów formatowania', () => {
  for (const c of cases) {
    const pages = renderPages(c);
    assert.equal(pages.length, c.id === 'non-document' ? 1 : c.layout === 'receipt' || c.layout === 'delivery' || c.layout === 'correction' ? 1 : c.pages, c.id);
    const all = pages.map((p) => p.html).join('\n');
    assert.ok(!/undefined|NaN|\[object/.test(all), `${c.id}: w HTML jest „undefined/NaN”`);
    if (c.id === 'non-document') continue;
    assert.ok(all.includes(c.seller.nip.slice(0, 3)), `${c.id}: brak NIP`);
    for (const l of c.printLines) assert.ok(all.includes(l.name.toUpperCase().slice(0, 30).replace(/&/g, '&amp;')) || all.includes(l.name.replace(/&/g, '&amp;')), `${c.id}: brak pozycji ${l.name}`);
    if (c.layout !== 'receipt') assert.ok(all.includes(c.invoiceNumber.replace(/^(FV|FS|FA)/, c.layout === 'delivery' ? 'WZ' : '$1')), `${c.id}: brak numeru`);
  }
  assert.ok(renderPages(cases.find((c) => c.id === 'clean-pdf')!).length === 1);
  const two = cases.find((c) => c.id === 'two-page-pdf')!;
  assert.equal(pdfHtml(renderPages(two)).split('class="sheet"').length - 1, 2);
});

test('formaty liczb i dat', () => {
  assert.equal(fmtNum(12345.6, 'space-comma'), '12 345,60');
  assert.equal(fmtNum(12345.6, 'dot-comma'), '12.345,60');
  assert.equal(fmtNum(12345.6, 'plain-comma'), '12345,60');
  assert.equal(fmtNum(-5, 'plain-comma', 0), '-5');
  assert.equal(fmtNum(7, 'space-comma', 0), '7');
  assert.equal(fmtDate('2026-10-05', 'dotted'), '05.10.2026');
  assert.equal(fmtDate('2026-10-05', 'long-pl'), '5 października 2026 r.');
  assert.equal(fmtDate('2026-10-05', 'iso'), '2026-10-05');
});

// --- ocena --------------------------------------------------------------------------------------------------

const clean = cases.find((c) => c.id === 'clean-classic')!;
const modelOf = (c: (typeof cases)[number], mutate?: (j: ReturnType<typeof toModelJson> & Record<string, any>) => void) => {
  const j = toModelJson(c.expected) as ReturnType<typeof toModelJson> & Record<string, any>;
  mutate?.(j);
  const n = normalizeExtraction(j, TODAY);
  return { n, issues: verifyExtraction(n) };
};

test('oczekiwania zgadzają się z potokiem: poprawny odczyt KAŻDEGO przypadku jest oceniany jako w całości poprawny', () => {
  for (const c of cases) {
    const { n, issues } = modelOf(c);
    const s = scoreCase(c.expected, n, issues);
    assert.ok(s.fullyCorrect, `${c.id}: ${s.failed.join('; ')}`);
    assert.equal(s.silentError, false);
  }
});

test('ocena: pojedyncze błędy są wykrywane i nazwane', () => {
  const run = (mutate: Parameters<typeof modelOf>[1]) => {
    const { n, issues } = modelOf(clean, mutate);
    return scoreCase(clean.expected, n, issues);
  };
  let s = run((j) => { j.supplier.nip = '5260250996'; });
  assert.deepEqual([s.fullyCorrect, s.flagged], [false, true]);                 // zła suma kontrolna NIP → zgłoszone
  assert.ok(s.failed.includes('nagłówek: nip'));
  s = run((j) => { j.invoice.issue_date = j.invoice.issue_date.replace(/-\d\d$/, '-01'); });
  assert.deepEqual([s.fullyCorrect, s.flagged, s.silentError], [false, false, true]);   // zła data → CICHY błąd
  s = run((j) => { j.lines[1].quantity += 1; });
  assert.ok(s.failed.some((f) => f.includes('qty')));
  s = run((j) => { j.lines.pop(); });
  assert.ok(s.failed.some((f) => f.startsWith('pozycja pominięta')));
  assert.equal(s.lines.matched, clean.expected.lines.length - 1);
  s = run((j) => { j.lines.push({ name: 'Razem do zapłaty', quantity: 1, unit: null, unit_price_net: null, total_net: null, vat_rate: null, ean: null, is_stock_item: true, confidence: 50 }); });
  assert.equal(s.lines.extraStock, 1);
  assert.equal(s.fullyCorrect, false);
  s = run((j) => { j.lines.push({ name: 'Razem do zapłaty', quantity: 1, unit: null, unit_price_net: null, total_net: null, vat_rate: null, ean: null, is_stock_item: false, confidence: 50 }); });
  assert.equal(s.fullyCorrect, true, 'nadmiarowa pozycja oznaczona jako pomijana nie psuje stanu magazynu');
  s = run((j) => { j.lines[0].ean = '5901234123457'; j.lines[2].ean = null; });
  assert.ok(s.failed.some((f) => f.includes('ean')));
  s = run((j) => { j.lines[0].vat_rate = 8; });
  assert.ok(s.failed.some((f) => f.includes('vat')));
  s = run((j) => { j.document_kind = 'receipt'; });
  assert.ok(s.failed.includes('nagłówek: kind'));
});

test('ocena: kolejność pozycji bez znaczenia, tolerancje groszowe, skrócone nazwy z paragonu', () => {
  let { n, issues } = modelOf(clean, (j) => { j.lines.reverse(); });
  assert.equal(scoreCase(clean.expected, n, issues).fullyCorrect, true);
  ({ n, issues } = modelOf(clean, (j) => { j.lines[0].unit_price_net = j.lines[0].unit_price_net + 0.004; j.totals.net = j.totals.net + 0.01; }));
  assert.equal(scoreCase(clean.expected, n, issues).fullyCorrect, true);
  const receipt = cases.find((c) => c.id === 'receipt-a')!;
  ({ n, issues } = modelOf(receipt, (j) => { for (const l of j.lines) l.name = l.name.toUpperCase().slice(0, 24); }));
  assert.equal(scoreCase(receipt.expected, n, issues).fullyCorrect, true, 'paragon: wielkie litery i skrócenie nazwy');
  ({ n, issues } = modelOf(receipt, (j) => { j.invoice.number = '00263'; }));
  assert.equal(scoreCase(receipt.expected, n, issues).header.number, null, 'numer paragonu nie jest oceniany');
});

test('podobieństwo nazw', () => {
  assert.equal(nameSimilarity('Filtr oleju Bosch P 7032', 'FILTR OLEJU BOSCH P 7032'), 1);
  assert.ok(nameSimilarity('Płyn do szyb', 'Plyn do szyb') === 1);
  assert.ok(nameSimilarity('Olej silnikowy Castrol Edge 5W-30 4L', 'OLEJ SILNIKOWY CASTROL EDGE 5W') >= 0.9);
  assert.ok(nameSimilarity('Filtr oleju', 'Klocki hamulcowe') < 0.3);
  assert.equal(nameSimilarity(null, null), 1);
  assert.equal(nameSimilarity('abc', null), 0);
});

test('ocena: nieudany odczyt = zero poprawnych pól, ale nie „cichy błąd"', () => {
  const s = failedRunScore(clean.expected);
  assert.deepEqual([s.fullyCorrect, s.flagged, s.silentError, s.lines.matched], [false, true, false, 0]);
});

// --- atrapa, runner, raport -------------------------------------------------------------------------------

const asLoaded = (c: (typeof cases)[number]): LoadedCase => ({ id: c.id, category: c.category, note: c.note, files: [], dir: '', expected: c.expected });
const fakePages = (): PageInput[] => [{ kind: 'image', mediaType: 'image/png', base64: 'AAAA' }];

test('runner (atrapa): bez szumu wszystko poprawne; z szumem pojawiają się błędy zgłoszone i ciche; mocniejsze modele mylą się rzadziej', async () => {
  const all = cases.map(asLoaded);
  const perfect = await runEval({ cases: all, configs: DEFAULT_CONFIGS, providerFor: (c) => new DryProvider(c.expected, 0, 1), pagesFor: fakePages, today: TODAY, dry: true });
  assert.equal(perfect.runs.length, all.length * DEFAULT_CONFIGS.length);
  assert.ok(perfect.runs.every((r) => r.score.fullyCorrect), perfect.runs.filter((r) => !r.score.fullyCorrect).map((r) => `${r.config}/${r.caseId}`).join(', '));
  assert.ok(perfect.runs.every((r) => !r.escalated), 'poprawne odczyty nie powinny wywoływać drugiego odczytu');
  assert.equal(aggregate(perfect.runs.filter((r) => r.config === 'pipeline')).escalated, 0);

  const noisy = await runEval({ cases: all, configs: DEFAULT_CONFIGS, providerFor: (c) => new DryProvider(c.expected, 0.9, c.id.length * 31), pagesFor: fakePages, today: TODAY, dry: true });
  const a = (cfg: string) => aggregate(noisy.runs.filter((r) => r.config === cfg));
  assert.ok(a('haiku').fullyCorrect < a('opus').fullyCorrect, `tani model myli się częściej (${a('haiku').fullyCorrect} vs ${a('opus').fullyCorrect})`);
  assert.ok(a('haiku').silentErrors + a('haiku').flagged > 0);
  assert.ok(a('pipeline').escalated > 0, 'przy błędach potok sięga po mocniejszy model');
  assert.ok(a('pipeline').fullyCorrect >= a('haiku').fullyCorrect, 'drugi odczyt nie pogarsza wyniku');
  assert.ok(a('pipeline').costUsd > a('haiku').costUsd && a('pipeline').costUsd < a('opus').costUsd);
  assert.ok(noisy.runs.every((r) => r.costMicroUsd > 0 && r.inputTokens > 0));
});

test('runner: awaria dostawcy to wynik „brak odczytu", a nie przerwanie całego uruchomienia', async () => {
  const boom = { extract: async () => { throw new Error('sieć padła'); } };
  const { runs } = await runEval({ cases: [asLoaded(clean)], configs: [DEFAULT_CONFIGS[0]], providerFor: () => boom, pagesFor: fakePages, today: TODAY });
  assert.equal(runs.length, 1);
  assert.deepEqual([runs[0].ok, runs[0].score.fullyCorrect, runs[0].score.silentError, runs[0].costMicroUsd], [false, false, false, 0]);
  assert.match(runs[0].error ?? '', /sieć padła/);
});

test('raport: zawiera wszystkie sekcje, liczby i ostrzeżenie trybu próbnego; działa też dla pustych i nieudanych wyników', async () => {
  const all = cases.slice(0, 6).map(asLoaded);
  const { meta, runs } = await runEval({ cases: all, configs: DEFAULT_CONFIGS, providerFor: (c) => new DryProvider(c.expected, 0.8, 5), pagesFor: fakePages, today: TODAY, dry: true });
  const md = buildReport(meta, runs);
  for (const h of ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', 'TRYB PRÓBNY', 'pipeline', 'czyste A4', 'Koszt / 1000 dok.']) assert.ok(md.includes(h), h);
  assert.ok(!/NaN|undefined|Infinity/.test(md));
  const live = buildReport({ ...meta, dry: false }, runs);
  assert.ok(!live.includes('TRYB PRÓBNY'));
  assert.doesNotThrow(() => buildReport(meta, []));
  const failedRun: RunResult = { ...runs[0], ok: false, error: 'refusal', score: failedRunScore(all[0].expected), costMicroUsd: 0 };
  assert.match(buildReport(meta, [failedRun]), /odczyt nie powiódł się \(refusal\)/);
  assert.equal(aggregate([]).n, 0);
});
