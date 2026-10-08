import { makeUuidV7, UUID_RE } from '../uuid';
import { isValidNip, normalizeNip, formatNip } from '../nip';
import { gs1ChecksumOk, normalizeBarcode } from '../ean';
import { base64ToBytes } from '../base64';
import { formatQty, formatQtyUnit, plural, countLabel, timeAgo, initials, formatMoney } from '../format';
import { friendlyError } from '../errors';
import { nextActions, isClosed } from '../status';
import { buildStories, type DashboardSummary } from '../stories';
import { lineNet, sumNet, totalsMatch, validateDocument } from '../document-math';

describe('uuid v7', () => {
  const fixed = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
  it('ma poprawny format, wersję 7 i wariant RFC 4122', () => {
    const id = makeUuidV7(fixed, Date.UTC(2026, 9, 8, 12, 0, 0));
    expect(id).toMatch(UUID_RE);
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]);
  });
  it('koduje czas w pierwszych 48 bitach i sortuje się chronologicznie', () => {
    const a = makeUuidV7(fixed, 1_700_000_000_000);
    const b = makeUuidV7(fixed, 1_700_000_000_001);
    const c = makeUuidV7(fixed, 1_800_000_000_000);
    expect(a < b && b < c).toBe(true);
    expect(parseInt(a.replace(/-/g, '').slice(0, 12), 16)).toBe(1_700_000_000_000);
  });
});

describe('NIP', () => {
  it.each(['1234563218', '5260250995', '7740001454', 'PL 526-025-09-95'])('akceptuje %s', (n) => expect(isValidNip(n)).toBe(true));
  it.each(['1234567890', '123456321', '0000000000', '', 'abcdefghij', '12345632188'])('odrzuca %s', (n) => expect(isValidNip(n)).toBe(false));
  it('normalizuje i formatuje', () => {
    expect(normalizeNip('PL 526-025-09-95')).toBe('5260250995');
    expect(formatNip('5260250995')).toBe('526-025-09-95');
  });
});

describe('kody kreskowe', () => {
  it('liczy sumę kontrolną EAN-13, EAN-8 i UPC-A', () => {
    expect(gs1ChecksumOk('5901234123457')).toBe(true);
    expect(gs1ChecksumOk('5901234123458')).toBe(false);
    expect(gs1ChecksumOk('96385074')).toBe(true);
    expect(gs1ChecksumOk('036000291452')).toBe(true);
  });
  it('normalizuje do formy z bazy (8 lub 13 cyfr)', () => {
    expect(normalizeBarcode('5901234123457')).toBe('5901234123457');
    expect(normalizeBarcode('036000291452')).toBe('0036000291452');
    expect(normalizeBarcode('96385074')).toBe('96385074');
    expect(normalizeBarcode('590 1234 123457')).toBe('5901234123457');
    expect(normalizeBarcode('5901234123458')).toBeNull();
    expect(normalizeBarcode('12345')).toBeNull();
  });
});

describe('base64', () => {
  it('dekoduje poprawnie z paddingiem i bez', () => {
    expect(Array.from(base64ToBytes('SGVsbG8='))).toEqual([72, 101, 108, 108, 111]);
    expect(Array.from(base64ToBytes('SGVsbG8'))).toEqual([72, 101, 108, 108, 111]);
    expect(Array.from(base64ToBytes('data:image/jpeg;base64,/9j/'))).toEqual([255, 216, 255]);
    expect(base64ToBytes('').length).toBe(0);
  });
  it('rzuca na śmieciach', () => expect(() => base64ToBytes('@@@@')).toThrow());
});

describe('formatowanie', () => {
  it('ilości po polsku', () => {
    expect(formatQty(2.5)).toBe('2,5');
    expect(formatQty('3.000')).toBe('3');
    expect(formatQty(12345.5)).toBe('12 345,5'); // reguły pl: grupowanie dopiero od 5 cyfr
    expect(formatQty(1234.567)).toBe('1234,567');
    expect(formatQtyUnit(2, 'szt.')).toBe('2 szt.');
    expect(formatQty(null)).toBe('0');
  });
  it('odmiana liczebników', () => {
    const f = ['produkt', 'produkty', 'produktów'] as const;
    expect([0, 1, 2, 4, 5, 12, 13, 14, 21, 22, 25, 112].map((n) => plural(n, f))).toEqual([
      'produktów', 'produkt', 'produkty', 'produkty', 'produktów', 'produktów', 'produktów', 'produktów',
      'produktów', 'produkty', 'produktów', 'produktów',
    ]);
    expect(countLabel(3, f)).toBe('3 produkty');
  });
  it('czas względny', () => {
    const now = new Date('2026-10-08T12:00:00');
    expect(timeAgo(new Date('2026-10-08T11:59:40'), now)).toBe('przed chwilą');
    expect(timeAgo(new Date('2026-10-08T11:55:00'), now)).toBe('5 min temu');
    expect(timeAgo(new Date('2026-10-08T09:00:00'), now)).toBe('3 godz. temu');
    expect(timeAgo(new Date('2026-10-07T20:00:00'), now)).toBe('16 godz. temu');
    expect(timeAgo(new Date('2026-10-07T04:00:00'), now)).toBe('wczoraj');
    expect(timeAgo(new Date('2026-10-04T10:00:00'), now)).toBe('4 dni temu');
  });
  it('inicjały i pieniądze', () => {
    expect(initials('Jan Kowalski')).toBe('JK');
    expect(initials('  ')).toBe('?');
    expect(initials('Ścibor')).toBe('Ś');
    expect(formatMoney(1234.5)).toMatch(/1\s?234,50\s?zł/);
    expect(formatMoney(null)).toBe('—');
  });
});

describe('friendlyError', () => {
  it('przepuszcza polskie komunikaty z naszych funkcji w bazie (P0001)', () => {
    expect(friendlyError({ code: 'P0001', message: 'Firma musi mieć co najmniej jednego właściciela.' })).toBe('Firma musi mieć co najmniej jednego właściciela.');
  });
  it('tłumaczy typowe błędy', () => {
    expect(friendlyError({ message: 'Failed to fetch' })).toMatch(/Brak połączenia/);
    expect(friendlyError({ code: '42501', message: 'new row violates row-level security policy' })).toBe('Brak uprawnień do tej operacji.');
    expect(friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "documents_duplicate_guard"' })).toMatch(/faktura/i);
    expect(friendlyError({ code: '23505', message: 'x', details: 'products_tenant_ean_unique' })).toMatch(/kodem kreskowym/);
    expect(friendlyError({ message: 'Invalid login credentials' })).toBe('Nieprawidłowy e-mail lub hasło.');
    expect(friendlyError({ message: 'AI_QUOTA_EXCEEDED', code: 'P0001' })).toBe('AI_QUOTA_EXCEEDED');
    expect(friendlyError({ message: 'AI_QUOTA_EXCEEDED' })).toMatch(/limit skanów/);
  });
  it('nigdy nie pokazuje surowego błędu technicznego', () => {
    expect(friendlyError({ message: 'relation "x" does not exist', code: '42P01' })).toBe('Coś poszło nie tak. Spróbuj ponownie.');
    expect(friendlyError(null, 'Własny')).toBe('Własny');
  });
});

describe('cykl statusów zgłoszeń (lustro bazy)', () => {
  const names = (s: Parameters<typeof nextActions>[0], who: Parameters<typeof nextActions>[1]) => nextActions(s, who).map((a) => a.to);
  it('kierownictwo prowadzi cykl do przodu i może odrzucić', () => {
    const m = { isManager: true, isReporter: false };
    expect(names('reported', m)).toEqual(['accepted', 'rejected']);
    expect(names('accepted', m)).toEqual(['ordered', 'rejected']);
    expect(names('ordered', m)).toEqual(['delivered', 'rejected']);
    expect(names('delivered', m)).toEqual(['received']);
    expect(names('received', m)).toEqual([]);
    expect(names('rejected', m)).toEqual([]);
  });
  it('pracownik: tylko wycofanie własnego i potwierdzenie odbioru własnego', () => {
    const e = { isManager: false, isReporter: true };
    expect(names('reported', e)).toEqual(['rejected']);
    expect(names('accepted', e)).toEqual([]);
    expect(names('delivered', e)).toEqual(['received']);
    expect(names('reported', { isManager: false, isReporter: false })).toEqual([]);
  });
  it('zamknięte statusy', () => {
    expect(isClosed('received') && isClosed('rejected') && !isClosed('ordered')).toBe(true);
  });
});

const base: DashboardSummary = {
  role: 'manager', plan: 'team', trial_days_left: 10, products_total: 40, below_min: 3, below_min_top: [],
  requests_open: 4, requests_to_accept: 2, requests_to_confirm: 1, requests_mine_open: 0,
  documents_to_verify: 1, documents_processing: 1, documents_failed: 1, count_stale: 12, count_batch_size: 5,
  count_frequency: 'weekly', unread_notifications: 0,
};
describe('stories (zadania na dziś)', () => {
  it('kierownik widzi 4 kółka z licznikami', () => {
    const s = buildStories(base);
    expect(s.map((x) => [x.id, x.count, x.urgent])).toEqual([
      ['low', 3, true], ['requests', 3, true], ['invoices', 2, true], ['count', 5, true],
    ]);
  });
  it('pracownik nie ma faktur, a zgłoszenia liczy bez akceptacji', () => {
    const s = buildStories({ ...base, role: 'employee', requests_to_accept: 0, requests_to_confirm: 1 });
    expect(s.map((x) => x.id)).toEqual(['low', 'requests', 'count']);
    expect(s[1].count).toBe(1);
  });
  it('wszystko zrobione = szare pierścienie; spisy wyłączone = brak kółka', () => {
    const s = buildStories({ ...base, below_min: 0, requests_to_accept: 0, requests_to_confirm: 0, documents_to_verify: 0, documents_failed: 0, count_stale: 0 });
    expect(s.every((x) => !x.urgent)).toBe(true);
    expect(buildStories({ ...base, count_frequency: 'off' }).some((x) => x.id === 'count')).toBe(false);
    expect(buildStories(undefined)).toEqual([]);
  });
});

describe('walidacja faktury', () => {
  const line = (over: Partial<Parameters<typeof lineNet>[0] & { id: string; raw_name: string; product_id: string | null; skip: boolean }> = {}) => ({
    id: 'l', raw_name: 'Towar', qty: 2, unit_price_net: 10, product_id: 'p', skip: false, ...over,
  });
  it('liczy wartość netto z ilości i ceny lub z jawnej kwoty', () => {
    expect(lineNet({ qty: 3, unit_price_net: 1.1, total_net: null })).toBe(3.3);
    expect(lineNet({ qty: 3, unit_price_net: 1.1, total_net: 3.5 })).toBe(3.5);
    expect(lineNet({ qty: 3, unit_price_net: null, total_net: null })).toBeNull();
    expect(sumNet([line(), line({ qty: 1, unit_price_net: 5 })])).toBe(25);
  });
  it('tolerancja sum', () => {
    expect(totalsMatch(100, 100.02)).toBe(true);
    expect(totalsMatch(1000, 1004)).toBe(true);
    expect(totalsMatch(1000, 1010)).toBe(false);
  });
  it('wskazuje problemy', () => {
    const w = validateDocument(
      { supplier_nip: '1234567890', invoice_number: '', issue_date: '2099-01-01', total_net: 50 },
      [line(), line({ product_id: null, ai_confidence: 40 } as never)],
      new Date('2026-10-08')
    ).map((x) => x.code);
    expect(w).toEqual(expect.arrayContaining(['no_number', 'bad_nip', 'future_date', 'unmatched', 'total_mismatch', 'low_confidence']));
  });
  it('czysta faktura nie ma ostrzeżeń', () => {
    expect(validateDocument(
      { supplier_nip: '5260250995', invoice_number: 'FV/1', issue_date: '2026-10-01', total_net: 20 },
      [line()], new Date('2026-10-08'))).toEqual([]);
  });
});
