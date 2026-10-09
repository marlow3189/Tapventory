import {
  CSV_BOM, buildCsv, csvNumber, documentsRows, exportFilename, localDateTime, movementsRows, neutralizeFormula, productsRows,
  DOCUMENTS_HEADER, MOVEMENTS_HEADER, PRODUCTS_HEADER,
} from '../csv';
import type { DocumentRow, ProductRow } from '../types';
import type { MovementExportRow } from '../csv';

describe('csvNumber', () => {
  it('używa przecinka dziesiętnego i obcina zbędne zera', () => {
    expect(csvNumber(12.5)).toBe('12,5');
    expect(csvNumber('12.500')).toBe('12,5');
    expect(csvNumber(100)).toBe('100');
    expect(csvNumber(0.1 + 0.2)).toBe('0,3');
    expect(csvNumber(-3)).toBe('-3');
    expect(csvNumber(-0.00001)).toBe('0');
  });
  it('puste i nieliczbowe wartości dają pusty tekst', () => {
    expect(csvNumber(null)).toBe('');
    expect(csvNumber(undefined)).toBe('');
    expect(csvNumber('')).toBe('');
    expect(csvNumber('abc')).toBe('');
    expect(csvNumber(Infinity)).toBe('');
  });
});

describe('neutralizeFormula', () => {
  it('dopisuje apostrof przed znakami uruchamiającymi formułę w Excelu', () => {
    for (const bad of ['=HYPERLINK("http://zlo")', '+48 600 100 200', '-cmd|x', '@SUM(A1)', '\tx', '\rx']) {
      expect(neutralizeFormula(bad)).toBe(`'${bad}`);
    }
  });
  it('zwykły tekst zostaje bez zmian', () => {
    expect(neutralizeFormula('Rękawice nitrylowe L')).toBe('Rękawice nitrylowe L');
    expect(neutralizeFormula('5900000000017')).toBe('5900000000017');
    expect(neutralizeFormula('')).toBe('');
  });
});

describe('buildCsv', () => {
  it('BOM + nagłówek + wiersze rozdzielone CRLF, separator ;', () => {
    const csv = buildCsv(['A', 'B'], [['x', 1.5], ['y', null]]);
    expect(csv).toBe(`${CSV_BOM}A;B\r\nx;1,5\r\ny;\r\n`);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
  it('cytuje komórki z separatorem, cudzysłowem i końcem linii; cudzysłów podwaja', () => {
    const csv = buildCsv(['Nazwa'], [['Rękawice; L'], ['Ma "cudzysłów"'], ['Dwie\nlinie']]);
    expect(csv).toContain('"Rękawice; L"');
    expect(csv).toContain('"Ma ""cudzysłów"""');
    expect(csv).toContain('"Dwie\nlinie"');
  });
  it('liczby ujemne nie są „neutralizowane”, ale teksty zaczynające się od minusa — tak', () => {
    const csv = buildCsv(['x'], [[-5], ['-5% rabat']]);
    expect(csv).toContain('\r\n-5\r\n');
    expect(csv).toContain("'-5% rabat");
  });
  it('wartości logiczne jako TAK/NIE; przecinek w tekście nie wymaga cytowania przy separatorze „;”', () => {
    const csv = buildCsv(['a', 'b', 'c'], [[true, false, '1,5 kg']]);
    expect(csv).toContain('TAK;NIE;1,5 kg');
  });
  it('inny separator działa (np. przecinek) i cytuje wtedy komórki z przecinkiem', () => {
    expect(buildCsv(['a', 'b'], [['x,y', 'z']], ',')).toContain('"x,y",z');
  });
});

describe('localDateTime i nazwa pliku', () => {
  it('formatuje czas lokalny jako RRRR-MM-DD GG:MM', () => {
    const iso = new Date(2026, 9, 8, 14, 5, 30).toISOString();
    expect(localDateTime(iso)).toBe('2026-10-08 14:05');
  });
  it('puste i błędne wartości → pusty tekst', () => {
    expect(localDateTime(null)).toBe('');
    expect(localDateTime(undefined)).toBe('');
    expect(localDateTime('nie-data')).toBe('');
  });
  it('nazwa pliku: tapventory-<rodzaj>-<data>.csv', () => {
    expect(exportFilename('stany', new Date(2026, 9, 8))).toBe('tapventory-stany-2026-10-08.csv');
    expect(exportFilename('faktury', new Date(2026, 0, 2))).toBe('tapventory-faktury-2026-01-02.csv');
  });
});

const product = (over: Partial<ProductRow> = {}): ProductRow => ({
  id: 'p1', tenant_id: 't', name: 'Rękawice nitrylowe L', ean: '5900000000017', unit: 'op.', pack_size: '1.000', min_stock: '2.000',
  photo_path: null, active: true, default_supplier_id: null, default_supplier_name: 'Hurtownia ABC', stock: '1.500', below_min: true,
  last_movement_at: new Date(2026, 9, 8, 9, 30).toISOString(), created_at: new Date(2026, 8, 1).toISOString(), ...over,
});

describe('zestawienie stanów', () => {
  it('wiersz ma tyle kolumn co nagłówek; liczby z bazy (teksty) stają się liczbami z przecinkiem', () => {
    const rows = productsRows([product()]);
    expect(rows[0]).toHaveLength(PRODUCTS_HEADER.length);
    const csv = buildCsv(PRODUCTS_HEADER, rows);
    expect(csv).toContain('Rękawice nitrylowe L;5900000000017;op.;1,5;2;TAK;Hurtownia ABC;1;TAK;2026-10-08 09:30');
  });
  it('nazwa produktu z formułą jest neutralizowana', () => {
    const csv = buildCsv(PRODUCTS_HEADER, productsRows([product({ name: '=HYPERLINK("http://zlo")' })]));
    expect(csv).toContain(`"'=HYPERLINK(""http://zlo"")"`);
  });
});

describe('zestawienie ruchów', () => {
  const mv = (over: Partial<MovementExportRow> = {}): MovementExportRow => ({
    id: 'm1', product_id: 'p1', product_name: 'Rękawice nitrylowe L', product_unit: 'op.', movement_type: 'issue', qty: '-1.000', reason: 'use', note: null,
    author_name: 'Marek Nowak', author_deleted: false, created_at: new Date(2026, 9, 8, 14, 5).toISOString(), project_name: 'Audi A4 WX 12345', ...over,
  });
  it('tłumaczy rodzaj i powód, zachowuje znak ilości', () => {
    const rows = movementsRows([mv(), mv({ movement_type: 'receipt', qty: 5, reason: null, note: 'Faktura FV/1' })]);
    expect(rows[0]).toHaveLength(MOVEMENTS_HEADER.length);
    expect(buildCsv(MOVEMENTS_HEADER, rows)).toContain('2026-10-08 14:05;Rękawice nitrylowe L;op.;Rozchód;-1;Zużycie;;Audi A4 WX 12345;Marek Nowak');
    expect(buildCsv(MOVEMENTS_HEADER, rows)).toContain('Przyjęcie;5;;Faktura FV/1;Audi A4 WX 12345;Marek Nowak');
  });
  it('usunięty użytkownik jest oznaczony jawnie', () => {
    expect(movementsRows([mv({ author_deleted: true })])[0][8]).toBe('Usunięty użytkownik');
  });
});

describe('zestawienie faktur', () => {
  const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
    id: 'd1', tenant_id: 't', source: 'photo', status: 'posted', doc_kind: 'invoice', supplier_id: null, supplier_name: 'Hurtownia ABC Sp. z o.o.',
    supplier_nip: '5260250995', invoice_number: 'FV/2026/10/0451', ksef_number: null, issue_date: '2026-10-05', currency: 'PLN', total_net: '160.50',
    total_gross: '197.42', file_paths: [], page_count: 1, error_message: null, ai_model: 'claude-haiku-5-5', ai_confidence: 91, ai_warnings: [], revision: 1,
    created_by_name: 'Anna', posted_at: new Date(2026, 9, 6, 8, 0).toISOString(), created_at: new Date(2026, 9, 5, 18, 2).toISOString(),
    line_count: 3, unmatched_count: 0, ...over,
  });
  it('mapuje rodzaje, źródła i statusy na polskie nazwy; kwoty z przecinkiem', () => {
    const rows = documentsRows([doc(), doc({ source: 'ksef', status: 'draft', doc_kind: 'correction', total_net: null, total_gross: null, ksef_number: '5265877635-20250826-0100001AF629-AF' })]);
    expect(rows[0]).toHaveLength(DOCUMENTS_HEADER.length);
    const csv = buildCsv(DOCUMENTS_HEADER, rows);
    expect(csv).toContain('2026-10-05;Hurtownia ABC Sp. z o.o.;5260250995;FV/2026/10/0451;;Faktura;Zdjęcie / PDF;Zaksięgowana;PLN;160,5;197,42;3;0;2026-10-06 08:00;2026-10-05 18:02');
    expect(csv).toContain('5265877635-20250826-0100001AF629-AF;Korekta;KSeF;Do sprawdzenia;PLN;;;');
  });
});
