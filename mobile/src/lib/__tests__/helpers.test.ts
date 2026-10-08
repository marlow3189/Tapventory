import { formatInviteCode, isCompleteInviteCode } from '../invite';
import { notificationHref } from '../notification-target';
import { parseQty, qtyToInput, stepQty } from '../qty';
import { peekDestination, rememberDestination, takeDestination } from '../redirect';
import { isEmail } from '../validation';

describe('ilości (przecinek i kropka)', () => {
  it('parsuje oba zapisy dziesiętne i spacje', () => {
    expect(parseQty('2,5')).toBe(2.5);
    expect(parseQty('2.5')).toBe(2.5);
    expect(parseQty(' 3 ')).toBe(3);
    expect(parseQty('1 000')).toBe(1000);
    expect(parseQty('.5')).toBe(0.5);
    expect(parseQty(7)).toBe(7);
  });
  it('odrzuca puste, ujemne i nieliczbowe', () => {
    for (const bad of ['', '   ', 'abc', '-1', '1,2,3', '1..2', null, undefined, -3, NaN]) {
      expect(parseQty(bad as never)).toBeNull();
    }
  });
  it('formatuje do pola i dodaje krok z dolnym limitem 0', () => {
    expect(qtyToInput(2.5)).toBe('2,5');
    expect(qtyToInput(3)).toBe('3');
    expect(qtyToInput(0.1 + 0.2)).toBe('0,3');
    expect(stepQty('2', 1)).toBe('3');
    expect(stepQty('0,5', -1)).toBe('0');
    expect(stepQty('', 1)).toBe('1');
    expect(stepQty('abc', 2)).toBe('2');
  });
});

describe('kod zaproszenia', () => {
  it('formatuje jako ABCD-EFGH i ucina nadmiar', () => {
    expect(formatInviteCode('abcd')).toBe('ABCD');
    expect(formatInviteCode('abcde')).toBe('ABCD-E');
    expect(formatInviteCode('ab cd-ef gh ij')).toBe('ABCD-EFGH');
    expect(formatInviteCode('')).toBe('');
  });
  it('rozpoznaje komplet', () => {
    expect(isCompleteInviteCode('ABCD-EFGH')).toBe(true);
    expect(isCompleteInviteCode('ABCD-EFG')).toBe(false);
  });
});

describe('powrót po zalogowaniu', () => {
  it('pamięta tylko wewnętrzne ścieżki, raz', () => {
    rememberDestination('/join?code=ABCD-EFGH');
    expect(peekDestination()).toBe('/join?code=ABCD-EFGH');
    expect(takeDestination()).toBe('/join?code=ABCD-EFGH');
    expect(takeDestination()).toBeNull();
  });
  it('blokuje adresy zewnętrzne i ekrany logowania', () => {
    rememberDestination('https://evil.example/phish');
    expect(takeDestination()).toBeNull();
    rememberDestination('//evil.example');
    expect(takeDestination()).toBeNull();
    rememberDestination('/login');
    expect(takeDestination()).toBeNull();
    rememberDestination('/');
    expect(takeDestination()).toBeNull();
    rememberDestination('javascript:alert(1)');
    expect(takeDestination()).toBeNull();
  });
});

describe('cel powiadomienia', () => {
  it('prowadzi do zgłoszenia, faktury, produktu lub listy', () => {
    expect(notificationHref('request_status', { request_id: 'r1' })).toBe('/request/r1');
    expect(notificationHref('document_ready', { document_id: 'd1' })).toBe('/documents/d1');
    expect(notificationHref('low_stock', { product_id: 'p1' })).toBe('/product/p1');
    expect(notificationHref('count_due', {})).toBe('/count');
    expect(notificationHref('system', null)).toBe('/activity');
  });
});

describe('walidacja e-mail', () => {
  it('akceptuje poprawne i odrzuca błędne', () => {
    expect(isEmail(' jan@firma.pl ')).toBe(true);
    for (const bad of ['', 'jan', 'jan@', '@firma.pl', 'jan@firma', 'jan firma@x.pl']) expect(isEmail(bad)).toBe(false);
  });
});

describe('wyszukiwanie po polsku', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fold, matchesQuery } = require('../search') as typeof import('../search');
  it('ignoruje ogonki i wielkość liter', () => {
    expect(fold('Żółć GĘŚLA')).toBe('zolc gesla');
    expect(matchesQuery('Rękawice nitrylowe L', 'rekawice')).toBe(true);
    expect(matchesQuery('Rękawice nitrylowe L', 'NITRYL rek')).toBe(true);
    expect(matchesQuery('Rękawice nitrylowe L', 'mydło')).toBe(false);
    expect(matchesQuery('cokolwiek', '   ')).toBe(true);
  });
});

describe('liczby ze znakiem i opakowania', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseSigned } = require('../qty') as typeof import('../qty');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isPackUnit, convertToStockUnits } = require('../document-math') as typeof import('../document-math');

  it('parsuje ilości ujemne z korekt', () => {
    expect(parseSigned('-2,5')).toBe(-2.5);
    expect(parseSigned('3')).toBe(3);
    expect(parseSigned('-')).toBeNull();
    expect(parseSigned('')).toBeNull();
    expect(parseSigned('--1')).toBeNull();
  });
  it('rozpoznaje jednostki-opakowania', () => {
    for (const u of ['op.', 'OP', 'opak.', 'karton', 'zgrzewka', 'pack', ' op ']) expect(isPackUnit(u)).toBe(true);
    for (const u of ['szt.', 'kg', 'l', 'm', '', null, undefined]) expect(isPackUnit(u)).toBe(false);
  });
  it('przelicza opakowania na sztuki z zachowaniem wartości wiersza', () => {
    const r = convertToStockUnits({ qty: 2, unit_price_net: 60 }, 12);
    expect(r).toEqual({ qty: 24, unit_price_net: 5 });
    expect(r.qty * (r.unit_price_net as number)).toBeCloseTo(120, 6);
    expect(convertToStockUnits({ qty: 1, unit_price_net: null }, 6)).toEqual({ qty: 6, unit_price_net: null });
    expect(convertToStockUnits({ qty: 3, unit_price_net: 10 }, 0)).toEqual({ qty: 3, unit_price_net: 10 });
  });
});

describe('daty wpisywane ręcznie', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseDateInput, todayIso } = require('../dates') as typeof import('../dates');
  it('rozumie polskie zapisy i ISO', () => {
    expect(parseDateInput('2026-10-08')).toBe('2026-10-08');
    expect(parseDateInput('08.10.2026')).toBe('2026-10-08');
    expect(parseDateInput('8-10-2026')).toBe('2026-10-08');
    expect(parseDateInput(' 8/1/2026 ')).toBe('2026-01-08');
  });
  it('odrzuca daty nieistniejące i śmieci', () => {
    for (const bad of ['31.02.2026', '2026-13-01', '00.01.2026', 'wczoraj', '', '2026/10', '8.10.26']) expect(parseDateInput(bad)).toBeNull();
    expect(parseDateInput('29.02.2024')).toBe('2024-02-29');   // rok przestępny
    expect(parseDateInput('29.02.2025')).toBeNull();
  });
  it('dzisiejsza data ma format ISO', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('tolerancja sum — granica', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { totalsMatch } = require('../document-math') as typeof import('../document-math');
  it('różnica dokładnie 2 grosze mieści się w tolerancji mimo błędów zmiennoprzecinkowych', () => {
    expect(totalsMatch(1, 1.02)).toBe(true);
    expect(totalsMatch(10, 10.02)).toBe(true);
    expect(totalsMatch(1, 1.03)).toBe(false);
    expect(totalsMatch(100, 100.5)).toBe(true);    // 0,5% z 100
    expect(totalsMatch(100, 100.51)).toBe(false);
  });
});
