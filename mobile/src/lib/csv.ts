// Eksport danych do CSV — plik ma się od razu poprawnie otwierać w POLSKIM Excelu:
//   * separator kolumn „;" (polski Excel nie rozumie przecinka jako separatora),
//   * przecinek dziesiętny (12,5 zamiast 12.5),
//   * BOM UTF-8 na początku (bez niego „ą", „ł", „ż" zamieniają się w krzaki),
//   * końce linii CRLF.
// Logika jest czysta (bez Reacta), więc testuje ją Jest w sekundę.

import { todayIso } from './dates';
import { REASON_LABEL } from './movements';
import { DOC_STATUS } from './doc-status';
import type { DocumentRow, MovementRow, ProductRow } from './types';

export type Cell = string | number | boolean | null | undefined;

/** Znacznik kolejności bajtów UTF-8 — Excel po nim rozpoznaje kodowanie pliku. */
export const CSV_BOM = '﻿';

/** Liczba → tekst z przecinkiem dziesiętnym, bez separatora tysięcy i bez zbędnych zer (12,500 → „12,5"). */
export function csvNumber(value: number | string | null | undefined, maxDecimals = 4): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const text = n.toFixed(maxDecimals).replace(/\.?0+$/, '');
  return (text === '-0' ? '0' : text).replace('.', ',');
}

/**
 * Obrona przed „wstrzyknięciem formuł": Excel traktuje tekst zaczynający się od = + - @ (albo tabulatora/CR)
 * jako formułę, więc złośliwa nazwa produktu „=HYPERLINK(...)" mogłaby coś wykonać u księgowej.
 * Dopisujemy apostrof — Excel pokaże wtedy zwykły tekst. Dotyczy TYLKO tekstów; liczby (też ujemne) są osobnym typem.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function encodeCell(cell: Cell, sep: string): string {
  let text: string;
  if (cell === null || cell === undefined) text = '';
  else if (typeof cell === 'number') text = csvNumber(cell);
  else if (typeof cell === 'boolean') text = cell ? 'TAK' : 'NIE';
  else text = neutralizeFormula(cell);
  const needsQuotes = text.includes(sep) || /["\r\n]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Składa plik CSV: BOM + nagłówek + wiersze, linie rozdzielone CRLF, na końcu pusta linia. */
export function buildCsv(header: string[], rows: Cell[][], sep = ';'): string {
  const lines = [header, ...rows].map((r) => r.map((c) => encodeCell(c, sep)).join(sep));
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → „2026-10-08 14:05" w czasie lokalnym użytkownika (puste, gdy brak/nieczytelne). */
export function localDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------------------------------
// Zestawienia
// ---------------------------------------------------------------------------------------------------

export const PRODUCTS_HEADER = ['Nazwa', 'EAN', 'Jednostka', 'Stan', 'Minimum', 'Poniżej minimum', 'Dostawca domyślny', 'Opakowanie zbiorcze', 'Aktywny', 'Ostatni ruch'];

export function productsRows(products: ProductRow[]): Cell[][] {
  return products.map((p) => [
    p.name, p.ean, p.unit, Number(p.stock), Number(p.min_stock), p.below_min, p.default_supplier_name, Number(p.pack_size), p.active, localDateTime(p.last_movement_at),
  ]);
}

export type MovementExportRow = MovementRow & { project_name?: string | null };

const MOVEMENT_TYPE_PL: Record<MovementRow['movement_type'], string> = {
  receipt: 'Przyjęcie', issue: 'Rozchód', adjustment: 'Korekta', return: 'Zwrot',
};

export const MOVEMENTS_HEADER = ['Data', 'Produkt', 'Jednostka', 'Rodzaj', 'Ilość', 'Powód', 'Notatka', 'Zlecenie', 'Osoba'];

export function movementsRows(movements: MovementExportRow[]): Cell[][] {
  return movements.map((m) => [
    localDateTime(m.created_at), m.product_name, m.product_unit, MOVEMENT_TYPE_PL[m.movement_type] ?? m.movement_type, Number(m.qty),
    m.reason ? REASON_LABEL[m.reason] : '', m.note, m.project_name, m.author_deleted ? 'Usunięty użytkownik' : m.author_name,
  ]);
}

const SOURCE_PL: Record<DocumentRow['source'], string> = { ksef: 'KSeF', photo: 'Zdjęcie / PDF', manual: 'Ręcznie' };
const KIND_PL: Record<string, string> = { invoice: 'Faktura', correction: 'Korekta', receipt: 'Paragon', delivery_note: 'WZ', other: 'Inny' };

export const DOCUMENTS_HEADER = [
  'Data wystawienia', 'Dostawca', 'NIP dostawcy', 'Numer faktury', 'Numer KSeF', 'Rodzaj', 'Źródło', 'Status', 'Waluta',
  'Suma netto', 'Suma brutto', 'Pozycje', 'Pozycje bez produktu', 'Zaksięgowano', 'Dodano',
];

export function documentsRows(docs: DocumentRow[]): Cell[][] {
  return docs.map((d) => [
    d.issue_date, d.supplier_name, d.supplier_nip, d.invoice_number, d.ksef_number, KIND_PL[d.doc_kind] ?? d.doc_kind, SOURCE_PL[d.source] ?? d.source,
    DOC_STATUS[d.status]?.label ?? d.status, d.currency,
    d.total_net === null ? null : Number(d.total_net), d.total_gross === null ? null : Number(d.total_gross),
    d.line_count, d.unmatched_count, localDateTime(d.posted_at), localDateTime(d.created_at),
  ]);
}

export type ExportKind = 'stany' | 'ruchy' | 'faktury';

/** Nazwa pliku: tapventory-stany-2026-10-08.csv (bez polskich znaków i spacji — działa w każdym systemie). */
export function exportFilename(kind: ExportKind, now: Date = new Date()): string {
  return `tapventory-${kind}-${todayIso(now)}.csv`;
}
