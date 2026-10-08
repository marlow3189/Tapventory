import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LINES, headerOnlyPayload, parseKsefInvoice, parseVatRate, type KsefInvoicePayload } from '../_shared/ksef/fa-parser.ts';
import { faLineXml, faXml, makeKsefNumber, metaFor } from './ksef-fixtures.ts';

const TODAY = new Date('2026-02-01T12:00:00Z');

function ok(xml: string): KsefInvoicePayload {
  const r = parseKsefInvoice(xml, TODAY);
  assert.equal(r.ok, true, r.ok ? '' : r.message);
  return (r as { ok: true; payload: KsefInvoicePayload }).payload;
}
const codes = (p: KsefInvoicePayload) => p.ai_warnings.map((w) => w.code);

test('zwykła faktura VAT: nagłówek, sprzedawca, sumy i pozycje', () => {
  const p = ok(faXml({
    lines: [
      { name: 'Rękawice nitrylowe L', unit: 'op.', qty: 3, unitNet: 24.5, net: 73.5, gtin: '5901234123457' },
      { name: 'Płyn do szyb zimowy 5L', unit: 'SZT', qty: '4', unitNet: '18,00', net: '72.00', rate: '23' },
      { name: 'Transport', unit: 'usł.', qty: 1, unitNet: 15, net: 15 },
    ],
    net23: 160.5, vat23: 36.92, gross: 197.42,
  }));
  assert.equal(p.doc_kind, 'invoice');
  assert.equal(p.supplier_nip, '1234563218');
  assert.equal(p.supplier_name, 'Hurtownia ABC Sp. z o.o.');
  assert.equal(p.invoice_number, 'FV/2026/01/0451');
  assert.equal(p.issue_date, '2026-01-05');
  assert.equal(p.currency, 'PLN');
  assert.equal(p.total_net, 160.5);
  assert.equal(p.total_gross, 197.42);
  assert.equal(p.lines.length, 3);
  assert.deepEqual(p.lines[0], { raw_name: 'Rękawice nitrylowe L', qty: 3, unit: 'op.', unit_price_net: 24.5, total_net: 73.5, vat_rate: 23, ean: '5901234123457', skip: false });
  assert.deepEqual(p.lines[1], { raw_name: 'Płyn do szyb zimowy 5L', qty: 4, unit: 'szt.', unit_price_net: 18, total_net: 72, vat_rate: 23, ean: null, skip: false });
  assert.equal(p.lines[2].skip, true, 'transport/usługa jest pomijany');
  assert.deepEqual(codes(p), ['ksef_skipped_lines']);
});

test('sumy netto: wszystkie stawki są dodawane (23%, 8% i 0%)', () => {
  const xml = faXml({ net23: 100, net8: 50.25, gross: 191.5 }).replace('</P_13_2>', '</P_13_2><P_13_6_1>10</P_13_6_1><P_13_7>5.5</P_13_7>');
  assert.equal(ok(xml).total_net, 165.75);
});

test('prefiks przestrzeni nazw, FA(2) i drobne różnice w zapisie nie przeszkadzają', () => {
  const a = ok(faXml({ prefix: 'tns' }));
  assert.equal(a.invoice_number, 'FV/2026/01/0451');
  assert.equal(a.lines.length, 1);
  const b = ok(faXml({ system: 'FA (2)' }));
  assert.equal(b.supplier_nip, '1234563218');
  const spaced = faXml({ nip: '123-456-32-18' });
  assert.equal(ok(spaced).supplier_nip, '1234563218');
});

test('nazwa sprzedawcy: Nazwa → PelnaNazwa → imię i nazwisko', () => {
  const base = faXml();
  const full = base.replace('<Nazwa>Hurtownia ABC Sp. z o.o.</Nazwa>', '<PelnaNazwa>Pełna Nazwa SA</PelnaNazwa>');
  assert.equal(ok(full).supplier_name, 'Pełna Nazwa SA');
  const person = base.replace('<Nazwa>Hurtownia ABC Sp. z o.o.</Nazwa>', '<ImiePierwsze>Jan</ImiePierwsze><Nazwisko>Kowalski</Nazwisko>');
  assert.equal(ok(person).supplier_name, 'Jan Kowalski');
});

test('rabat (P_10): cena jednostkowa wynika z wartości pozycji, nie z ceny katalogowej', () => {
  const p = ok(faXml({ lines: [{ name: 'Olej 5W30 4L', qty: 10, unitNet: 100, discount: 100, net: 900 }] }));
  assert.equal(p.lines[0].unit_price_net, 90);
  assert.equal(p.lines[0].total_net, 900);
});

test('pozycja tylko z cenami brutto (P_9B/P_11A) — netto wyliczone ze stawki', () => {
  const p = ok(faXml({ lines: [{ name: 'Filtr', qty: 2, unitGross: 123, gross: 246, rate: '23' }, { name: 'Książka', qty: 1, unitGross: 10.8, gross: 10.8, rate: '8' }] }));
  assert.equal(p.lines[0].unit_price_net, 100);
  assert.equal(p.lines[0].total_net, 200);
  assert.equal(p.lines[1].unit_price_net, 10);
  assert.equal(p.lines[1].total_net, 10);
});

test('wartość pozycji bez ceny jednostkowej: cena = wartość / ilość', () => {
  const p = ok(faXml({ lines: [{ name: 'Śruba M8', qty: 7, net: 21 }] }));
  assert.equal(p.lines[0].unit_price_net, 3);
});

test('stawki VAT: liczby, 0 KR/WDT/EX, zw / oo / np → null', () => {
  assert.equal(parseVatRate('23'), 23);
  assert.equal(parseVatRate('8'), 8);
  assert.equal(parseVatRate('5'), 5);
  assert.equal(parseVatRate('0 KR'), 0);
  assert.equal(parseVatRate('0 WDT'), 0);
  assert.equal(parseVatRate('0 ex'), 0);
  assert.equal(parseVatRate('zw'), null);
  assert.equal(parseVatRate('oo'), null);
  assert.equal(parseVatRate('np I'), null);
  assert.equal(parseVatRate('np II'), null);
  assert.equal(parseVatRate(undefined), null);
  assert.equal(parseVatRate('7,5'), 7.5);
});

test('EAN: poprawny GTIN trafia do pozycji, błędna suma kontrolna jest odrzucana, EAN w Indeks też działa', () => {
  const p = ok(faXml({ lines: [
    { name: 'A', gtin: '5901234123457' },
    { name: 'B', gtin: '5901234123456' },                       // zła cyfra kontrolna
    { name: 'C', index: '4006381333931' },                      // EAN-13 w polu Indeks
    { name: 'D', index: 'SKU-123', gtin: '40170725' },          // EAN-8
    { name: 'E', gtin: '012345678905' },                        // UPC-A → EAN-13 z zerem
  ] }));
  assert.deepEqual(p.lines.map((l) => l.ean), ['5901234123457', null, '4006381333931', '40170725', '0012345678905']);
});

test('brak ilości → 1 z ostrzeżeniem; ilość 0 i absurdalne liczby → pozycja pominięta z ostrzeżeniem', () => {
  const xml = faXml({ lines: [{ name: 'Usługa montażu', net: 100, unit: 'kpl.', qty: 1 }, { name: 'Bez ilości', net: 50 }, { name: 'Zero', qty: 0, net: 0 }, { name: 'Gigant', qty: '99999999999999', unitNet: 1, net: 99999999999999 }] })
    .replace('<P_8A>szt.</P_8A><P_8B>1</P_8B><P_11>50</P_11>', '<P_11>50</P_11>');
  const p = ok(xml);
  assert.deepEqual(p.lines.map((l) => [l.raw_name, l.qty]), [['Usługa montażu', 1], ['Bez ilości', 1]]);
  assert.deepEqual(codes(p).sort(), ['ksef_lines_dropped', 'ksef_qty_defaulted']);
});

test('pozycje niebędące towarem: transport, rabat, opłata, usługa — oznaczone jako pomijane', () => {
  const p = ok(faXml({ lines: [
    { name: 'Transport krajowy' }, { name: 'Koszt wysyłki' }, { name: 'Rabat handlowy', qty: 1, net: -20, unitNet: -20 }, { name: 'Opłata paliwowa' },
    { name: 'Dostawa towaru' }, { name: 'Oleje i filtry', unit: 'usł.' }, { name: 'Zestaw do transportu rowerów' }, { name: 'Filtr oleju', qty: 2, unitNet: 10, net: 20 },
  ] }));
  assert.deepEqual(p.lines.map((l) => l.skip), [true, true, true, true, true, true, false, false]);
});

test('waluta obca: ostrzeżenie, że kwoty nie są w złotych', () => {
  const p = ok(faXml({ currency: 'eur' }));
  assert.equal(p.currency, 'EUR');
  assert.ok(codes(p).includes('ksef_foreign_currency'));
});

test('faktura zaliczkowa → rodzaj „other” z ostrzeżeniem; ROZ i UPR → zwykła faktura', () => {
  const z = ok(faXml({ type: 'ZAL' }));
  assert.equal(z.doc_kind, 'other');
  assert.ok(codes(z).includes('ksef_advance'));
  assert.equal(ok(faXml({ type: 'ROZ' })).doc_kind, 'invoice');
  assert.equal(ok(faXml({ type: 'UPR' })).doc_kind, 'invoice');
});

test('faktura bez pozycji: sam nagłówek i ostrzeżenie', () => {
  const p = ok(faXml({ rawLines: '' }));
  assert.equal(p.lines.length, 0);
  assert.ok(codes(p).includes('ksef_no_lines'));
});

test('korekta: do magazynu trafia RÓŻNICA (po − przed); dodane i usunięte pozycje; korekta samej ceny jest pomijana', () => {
  const p = ok(faXml({
    type: 'KOR', net23: -86, vat23: -19.78, gross: -105.78,
    lines: [
      { name: 'Płyn do szyb', qty: 10, unitNet: 18, net: 180, before: true },
      { name: 'Płyn do szyb', qty: 8, unitNet: 18, net: 144 },
      { name: 'Rękawice L', qty: 5, unitNet: 10, net: 50, before: true },        // usunięta w korekcie
      { name: 'Rękawice L', qty: 0, unitNet: 10, net: 0 },
      { name: 'Smar', qty: 3, unitNet: 20, net: 60 },                              // dodana w korekcie
      { name: 'Szczotki', qty: 4, unitNet: 10, net: 40, before: true },           // tylko cena
      { name: 'Szczotki', qty: 4, unitNet: 12, net: 48 },
    ],
  }));
  assert.equal(p.doc_kind, 'correction');
  const by = Object.fromEntries(p.lines.map((l) => [l.raw_name, l]));
  assert.equal(by['Płyn do szyb'].qty, -2);
  assert.equal(by['Płyn do szyb'].total_net, -36);
  assert.equal(by['Płyn do szyb'].unit_price_net, 18);
  assert.equal(by['Rękawice L'].qty, -5);
  assert.equal(by['Rękawice L'].total_net, -50);
  assert.equal(by['Smar'].qty, 3);
  assert.equal(by['Szczotki'], undefined, 'zmiana samej ceny nie ma wpływu na stan');
  assert.ok(codes(p).includes('ksef_correction_price_only'));
  assert.equal(p.lines.every((l) => l.qty !== 0), true, 'baza nie przyjmie pozycji o ilości 0');
  assert.equal(p.total_gross, -105.78);
});

test('korekta bez wierszy „przed”: nie zgadujemy — pozycje pomijane + ostrzeżenie', () => {
  const p = ok(faXml({ type: 'KOR', lines: [{ name: 'Płyn', qty: 8, unitNet: 18, net: 144 }] }));
  assert.equal(p.lines.length, 1);
  assert.equal(p.lines[0].skip, true);
  assert.deepEqual(codes(p), ['ksef_correction_no_before']);
});

test('treść od sprzedawcy to zwykły tekst: encje, CDATA, znaki specjalne i długie nazwy', () => {
  const xml = faXml({ lines: [{ name: 'Płyn <b>"A&B"</b> 5L' }] })
    .replace('<Nazwa>Hurtownia ABC Sp. z o.o.</Nazwa>', `<Nazwa><![CDATA[Firma <script>alert(1)</script> & Syn]]></Nazwa>`);
  const p = ok(xml);
  assert.equal(p.supplier_name, 'Firma <script>alert(1)</script> & Syn');
  assert.equal(p.lines[0].raw_name, 'Płyn <b>"A&B"</b> 5L');
  const long = ok(faXml({ lines: [{ name: 'x'.repeat(2000) }], sellerName: 'N'.repeat(500), number: 'F'.repeat(400) }));
  assert.equal(long.lines[0].raw_name.length, 500);
  assert.equal(long.supplier_name?.length, 160);
  assert.equal(long.invoice_number?.length, 256);
});

test('nieobsługiwane i wadliwe dokumenty: czytelne powody zamiast wyjątków', () => {
  const pef = parseKsefInvoice('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>1</ID></Invoice>', TODAY);
  assert.deepEqual([pef.ok, !pef.ok && pef.reason], [false, 'unsupported_form']);
  const rr = parseKsefInvoice(faXml({ system: 'FA_RR (1)' }).replace('>FA</KodFormularza>', '>FA_RR</KodFormularza>'), TODAY);
  assert.deepEqual([rr.ok, !rr.ok && rr.reason], [false, 'unsupported_form']);
  const broken = parseKsefInvoice('<Faktura><Fa>', TODAY);
  assert.deepEqual([broken.ok, !broken.ok && broken.reason], [false, 'xml']);
  const evil = parseKsefInvoice('<!DOCTYPE x [<!ENTITY a "b">]><Faktura/>', TODAY);
  assert.deepEqual([evil.ok, !evil.ok && evil.reason], [false, 'xml']);
  const noNumber = parseKsefInvoice(faXml({ omitNumber: true }), TODAY);
  assert.deepEqual([noNumber.ok, !noNumber.ok && noNumber.reason], [false, 'structure']);
  for (const r of [pef, rr, broken, evil, noNumber]) assert.ok(!r.ok && r.message.length > 10);
});

test('zbyt wiele pozycji → odmowa (zapis samego nagłówka), z limitem na granicy', () => {
  const many = (n: number) => faXml({ rawLines: Array.from({ length: n }, (_v, i) => faLineXml({ name: `P${i}` }, i + 1)).join('') });
  assert.equal(parseKsefInvoice(many(MAX_LINES), TODAY).ok, true);
  const r = parseKsefInvoice(many(MAX_LINES + 1), TODAY);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, 'too_many_lines']);
});

test('nierealna data wystawienia nie przechodzi; poprawna zostaje', () => {
  assert.equal(ok(faXml({ date: '2026-02-30' })).issue_date, null);
  assert.equal(ok(faXml({ date: '2031-01-01' })).issue_date, null);
  assert.equal(ok(faXml({ date: '2026-01-31' })).issue_date, '2026-01-31');
});

test('headerOnlyPayload: nagłówek z metadanych listy KSeF, bez pozycji', () => {
  const meta = metaFor(makeKsefNumber(7), { invoiceType: 'KorPef', invoiceNumber: 'KOR/PEF/1', netAmount: -10.004, grossAmount: -12.3, seller: { nip: '123-456-32-18', name: 'Sprzedawca' } });
  const p = headerOnlyPayload(meta, 'Format PEF nie jest obsługiwany.', TODAY);
  assert.deepEqual(
    { kind: p.doc_kind, nip: p.supplier_nip, name: p.supplier_name, no: p.invoice_number, net: p.total_net, gross: p.total_gross, lines: p.lines.length, w: p.ai_warnings[0].code },
    { kind: 'correction', nip: '1234563218', name: 'Sprzedawca', no: 'KOR/PEF/1', net: -10, gross: -12.3, lines: 0, w: 'ksef_header_only' });
  assert.equal(headerOnlyPayload(metaFor(makeKsefNumber(8), { invoiceType: 'Zal' }), 'x', TODAY).doc_kind, 'other');
  assert.equal(headerOnlyPayload(metaFor(makeKsefNumber(9), { invoiceType: 'Nieznany' }), 'x', TODAY).doc_kind, 'invoice');
});

test('ostrzeżeń jest najwyżej 10, a wynik zawsze nadaje się do wysłania do bazy jako JSON', () => {
  const p = ok(faXml({ type: 'KOR' }));
  assert.ok(p.ai_warnings.length <= 10);
  const roundTrip = JSON.parse(JSON.stringify(p));
  assert.deepEqual(roundTrip, p);
  for (const l of p.lines) assert.ok(Number.isFinite(l.qty) && l.qty !== 0);
});
