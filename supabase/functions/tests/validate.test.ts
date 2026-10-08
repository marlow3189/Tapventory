import test from 'node:test';
import assert from 'node:assert/strict';
import { amountsMatch, gs1ChecksumOk, isValidNip, normalizeDate, normalizeEan, normalizeNip, normalizeUnit, normalizeVat, parseNumber, round2 } from '../_shared/validate.ts';

test('NIP: sumy kontrolne, prefiks PL, kreski', () => {
  assert.equal(isValidNip('5260250995'), true);
  assert.equal(isValidNip('PL 526-025-09-95'), true);
  assert.equal(isValidNip('5260250996'), false);
  assert.equal(isValidNip('0000000000'), false);
  assert.equal(isValidNip('123'), false);
  assert.equal(normalizeNip(' PL 526-025-09-95 '), '5260250995');
  assert.equal(normalizeNip(null), '');
});

test('EAN: poprawne, UPC-A, błędna suma, śmieci', () => {
  assert.equal(gs1ChecksumOk('5901234123457'), true);
  assert.equal(normalizeEan('5901234123457'), '5901234123457');
  assert.equal(normalizeEan('590 1234 123457'), '5901234123457');
  assert.equal(normalizeEan('012345678905'), '0012345678905');   // UPC-A → EAN-13
  assert.equal(normalizeEan('96385074'), '96385074');            // EAN-8
  assert.equal(normalizeEan('5901234123458'), null);
  assert.equal(normalizeEan('abc'), null);
  assert.equal(normalizeEan(null), null);
});

test('liczby: polskie, angielskie, mieszane, ujemne', () => {
  const cases: [unknown, number | null][] = [
    [12.5, 12.5], ['12,5', 12.5], ['12.5', 12.5], ['1 234,50', 1234.5], ['1 234,50', 1234.5],
    ['1.234,50', 1234.5], ['1,234.50', 1234.5], ['1.234.567', 1234567], ['1,234,567', 1234567],
    ['12,50 zł', 12.5], ['PLN 99', 99], ['(15,00)', -15], ['-3,2', -3.2], ['+4', 4], ['1,234', 1.234],
    ['', null], ['abc', null], [null, null], [undefined, null], [NaN, null], ['--1', null], ['1,2,3x', null], [{}, null],
  ];
  for (const [input, want] of cases) assert.equal(parseNumber(input), want, `parseNumber(${JSON.stringify(input)})`);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
});

test('daty: ISO, polskie zapisy, nierealne i spoza zakresu', () => {
  const today = new Date('2026-10-08T12:00:00Z');
  assert.equal(normalizeDate('2026-10-05', today), '2026-10-05');
  assert.equal(normalizeDate('05.10.2026', today), '2026-10-05');
  assert.equal(normalizeDate('5/10/2026', today), '2026-10-05');
  assert.equal(normalizeDate('2026-10-05T10:20:30Z', today), '2026-10-05');
  assert.equal(normalizeDate('31.02.2026', today), null);
  assert.equal(normalizeDate('1999-01-01', today), null);
  assert.equal(normalizeDate('2030-01-01', today), null, 'faktura z odległej przyszłości to pomyłka odczytu');
  assert.equal(normalizeDate('wczoraj', today), null);
  assert.equal(normalizeDate(20261005 as unknown, today), null);
});

test('VAT i jednostki', () => {
  for (const [input, want] of [[23, 23], ['8%', 8], ['5', 5], ['0', 0], ['zw', null], ['np', null], [22, null], [null, null]] as [unknown, number | null][]) {
    assert.equal(normalizeVat(input), want, `normalizeVat(${JSON.stringify(input)})`);
  }
  for (const [input, want] of [['SZT', 'szt.'], ['szt.', 'szt.'], ['sztuk', 'szt.'], ['Opak.', 'op.'], ['mb', 'm'], ['m2', 'm²'], ['litr', 'l'], ['KPL', 'kpl.'], ['moja-miara', 'moja-miara'], ['', null], [5, null]] as [unknown, string | null][]) {
    assert.equal(normalizeUnit(input), want, `normalizeUnit(${JSON.stringify(input)})`);
  }
  assert.equal(normalizeUnit('x'.repeat(40))?.length, 20);
});

test('tolerancja kwot: 2 grosze albo 0,5%', () => {
  assert.equal(amountsMatch(100, 100.4), true);     // 0,4% — OK
  assert.equal(amountsMatch(100, 100.6), false);
  assert.equal(amountsMatch(1, 1.02), true);
  assert.equal(amountsMatch(1, 1.03), false);
  assert.equal(amountsMatch(-50, -50.2), true);
});

test('liczby: litery w środku liczby to śmieć, a nie liczba', () => {
  assert.equal(parseNumber('12x34'), null);
  assert.equal(parseNumber('1,2,3'), null);
  assert.equal(parseNumber('12,50 zł'), 12.5);
  assert.equal(parseNumber('PLN 99'), 99);
  assert.equal(parseNumber('1 234,50 PLN'), 1234.5);
});
