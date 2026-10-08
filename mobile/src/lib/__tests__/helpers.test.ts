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
