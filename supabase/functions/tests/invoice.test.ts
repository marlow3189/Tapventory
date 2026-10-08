import test from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_JSON_SCHEMA, needsEscalation, normalizeExtraction, scoreIssues, verifyExtraction } from '../_shared/invoice.ts';

const TODAY = new Date('2026-10-08T12:00:00Z');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const good = (): any => ({
  document_kind: 'invoice',
  supplier: { name: '  Hurtownia   ABC Sp. z o.o. ', nip: 'PL 526-025-09-95' },
  invoice: { number: 'FV/2026/10/0451', issue_date: '05.10.2026', currency: 'pln' },
  totals: { net: '160,50', vat: 36.92, gross: 197.42 },
  lines: [
    { name: 'Rękawice nitrylowe L', quantity: 3, unit: 'OP', unit_price_net: 24.5, total_net: 73.5, vat_rate: 23, ean: '5901234123457', is_stock_item: true, confidence: 96 },
    { name: 'Płyn do szyb', quantity: '4', unit: 'szt', unit_price_net: '18,00', total_net: '72,00', vat_rate: '23%', ean: null, is_stock_item: true, confidence: 88 },
    { name: 'Transport', quantity: 1, unit: 'usł.', unit_price_net: 15, total_net: 15, vat_rate: 23, ean: null, is_stock_item: false, confidence: 70 },
  ],
  warnings: [{ code: 'x', text: 'Uwaga modelu' }],
  overall_confidence: 91,
});

test('czyszczenie: NIP, data, waluta, liczby tekstowe, jednostki, VAT, EAN, „pomijana”', () => {
  const n = normalizeExtraction(good(), TODAY);
  assert.equal(n.supplier_name, 'Hurtownia ABC Sp. z o.o.');
  assert.equal(n.supplier_nip, '5260250995');
  assert.equal(n.issue_date, '2026-10-05');
  assert.equal(n.currency, 'PLN');
  assert.equal(n.total_net, 160.5);
  assert.equal(n.lines.length, 3);
  assert.deepEqual(n.lines.map((l) => l.unit), ['op.', 'szt.', 'usł.']);
  assert.equal(n.lines[1].qty, 4);
  assert.equal(n.lines[1].unit_price_net, 18);
  assert.equal(n.lines[1].vat_rate, 23);
  assert.equal(n.lines[0].ean, '5901234123457');
  assert.equal(n.lines[2].skip, true);
  assert.equal(n.lines[0].skip, false);
  assert.equal(n.ai_confidence, 91);
  assert.deepEqual(n.model_warnings, [{ code: 'x', text: 'Uwaga modelu' }]);
  assert.deepEqual(n.notes, []);
});

test('czyszczenie odrzuca nonsens, ale nie wywala się: zły NIP, EAN, data, ilość 0, brak nazwy', () => {
  const n = normalizeExtraction({
    document_kind: 'zażółć', supplier: { name: 'A', nip: '12345' }, invoice: { number: null, issue_date: '31.02.2026', currency: 'złotych' },
    totals: { net: 'abc', vat: null, gross: null },
    lines: [
      { name: 'Z błędnym EAN', quantity: 2, unit: 'szt.', unit_price_net: 5, total_net: 10, ean: '5901234123458', is_stock_item: true, confidence: 90 },
      { name: 'Zerowa ilość', quantity: 0 },
      { name: '', quantity: 3 },
      { name: 'Bez ilości' },
      { name: 'Za duża ilość', quantity: 1e12 },
      'śmieć', null,
    ],
  }, TODAY);
  assert.equal(n.doc_kind, 'invoice');
  assert.equal(n.supplier_name, null, 'jednoznakowa nazwa to nie nazwa');
  assert.equal(n.supplier_nip, null);
  assert.equal(n.issue_date, null);
  assert.equal(n.currency, 'PLN');
  assert.equal(n.total_net, null);
  assert.equal(n.lines.length, 1);
  assert.equal(n.lines[0].ean, null);
  const codes = n.notes.map((x) => x.code).sort();
  assert.deepEqual(codes, ['date_invalid', 'ean_invalid', 'line_dropped', 'line_dropped', 'line_dropped', 'nip_format']);
  assert.doesNotThrow(() => normalizeExtraction(null, TODAY));
  assert.doesNotThrow(() => normalizeExtraction('tekst', TODAY));
  assert.equal(normalizeExtraction({}, TODAY).lines.length, 0);
});

test('pozycja: ilość × cena ≠ wartość obniża pewność i dodaje uwagę', () => {
  const raw = good();
  raw.lines[0].total_net = 99.99;   // powinno być 73,50
  const n = normalizeExtraction(raw, TODAY);
  assert.equal(n.lines[0].ai_confidence, 55);
  assert.ok(n.notes.some((x) => x.code === 'line_math' && /73\.50/.test(x.text)));
});

test('kontrola: poprawna faktura nie ma problemów i nie wymaga drugiego odczytu', () => {
  const n = normalizeExtraction(good(), TODAY);
  const issues = verifyExtraction(n);
  assert.deepEqual(issues, []);
  assert.equal(needsEscalation(issues), false);
});

test('kontrola: błędny NIP, rozbieżna suma, zła suma brutto → błędy i drugi odczyt', () => {
  const raw = good();
  raw.supplier.nip = '5260250996';
  raw.totals = { net: 999, vat: 36.92, gross: 197.42 };
  const issues = verifyExtraction(normalizeExtraction(raw, TODAY));
  const codes = issues.map((i) => i.code).sort();
  assert.deepEqual(codes, ['bad_nip', 'gross_mismatch', 'sum_mismatch']);
  assert.equal(needsEscalation(issues), true);
  assert.ok(scoreIssues(issues) >= 19);
});

test('kontrola: paragon i korekta nie są porównywane sumami netto; brak pozycji to błąd', () => {
  const receipt = { ...good(), document_kind: 'receipt', totals: { net: 1, vat: null, gross: null } };
  assert.deepEqual(verifyExtraction(normalizeExtraction(receipt, TODAY)).map((i) => i.code), []);
  const empty = verifyExtraction(normalizeExtraction({ ...good(), lines: [] }, TODAY));
  assert.ok(empty.some((i) => i.code === 'no_lines' && i.severity === 'error'));
});

test('kontrola: brak numeru/daty/NIP to ostrzeżenia, niska pewność wywołuje drugi odczyt', () => {
  const raw = good();
  raw.invoice = { number: null as unknown as string, issue_date: null as unknown as string, currency: 'PLN' };
  raw.supplier.nip = null as unknown as string;
  raw.overall_confidence = 40;
  const issues = verifyExtraction(normalizeExtraction(raw, TODAY));
  assert.deepEqual(issues.map((i) => i.code).sort(), ['low_confidence', 'no_date', 'no_nip', 'no_number']);
  assert.ok(issues.every((i) => i.severity === 'warn'));
  assert.equal(needsEscalation(issues), true);
});

test('schemat odpowiedzi: wszystkie pola wymagane, brak dodatkowych, wartości puste jako null', () => {
  const s = INVOICE_JSON_SCHEMA;
  assert.equal(s.additionalProperties, false);
  assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
  const line = s.properties.lines.items;
  assert.equal(line.additionalProperties, false);
  assert.deepEqual([...line.required].sort(), Object.keys(line.properties).sort());
  assert.ok(JSON.stringify(s).includes('"type":"null"'));
  assert.doesNotThrow(() => JSON.stringify(s));
});
