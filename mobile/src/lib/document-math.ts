// Kontrole poprawności faktury po stronie aplikacji (ekran weryfikacji).
// Nie zastępują bazy (ta pilnuje spójności), tylko podpowiadają człowiekowi,
// gdzie AI mogło się pomylić — „żółte pola" z dokumentu koncepcyjnego, rozdz. 9.

import { isValidNip } from './nip';

export type DocLine = {
  id: string;
  raw_name: string;
  qty: number | string;
  unit_price_net: number | string | null;
  total_net?: number | string | null;
  product_id: string | null;
  skip: boolean;
  ai_confidence?: number | null;
};

export type DocHeader = {
  supplier_nip: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  total_net: number | string | null;
  total_gross?: number | string | null;
};

export type Warning = { code: string; text: string; severity: 'error' | 'warn' };

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Wartość netto pozycji: jawna total_net, a gdy brak — ilość × cena. */
export function lineNet(l: Pick<DocLine, 'qty' | 'unit_price_net' | 'total_net'>): number | null {
  const explicit = num(l.total_net);
  if (explicit !== null) return round2(explicit);
  const q = num(l.qty), p = num(l.unit_price_net);
  return q !== null && p !== null ? round2(q * p) : null;
}

export function sumNet(lines: DocLine[]): number {
  return round2(lines.reduce((acc, l) => acc + (lineNet(l) ?? 0), 0));
}

/** Tolerancja: 2 grosze albo 0,5% (większa z nich) — zaokrąglenia VAT i rabaty. */
export function totalsMatch(expected: number, actual: number): boolean {
  const tol = Math.max(0.02, Math.abs(expected) * 0.005);
  return Math.abs(expected - actual) <= tol + 1e-9;   // błąd zmiennoprzecinkowy nie może odrzucić różnicy równej tolerancji
}

export function validateDocument(doc: DocHeader, lines: DocLine[], today: Date = new Date()): Warning[] {
  const w: Warning[] = [];
  if (!doc.invoice_number?.trim()) w.push({ code: 'no_number', severity: 'error', text: 'Brak numeru faktury — bez niego nie wykryjemy duplikatu.' });
  if (!doc.supplier_nip) w.push({ code: 'no_nip', severity: 'warn', text: 'Brak NIP dostawcy.' });
  else if (!isValidNip(doc.supplier_nip)) w.push({ code: 'bad_nip', severity: 'warn', text: 'NIP dostawcy ma błędną sumę kontrolną — sprawdź cyfry ze zdjęciem.' });

  if (doc.issue_date) {
    const d = new Date(doc.issue_date);
    if (d.getTime() > today.getTime() + 86_400_000) w.push({ code: 'future_date', severity: 'warn', text: 'Data wystawienia jest z przyszłości.' });
    if (d.getTime() < today.getTime() - 3 * 365 * 86_400_000) w.push({ code: 'old_date', severity: 'warn', text: 'Data wystawienia jest sprzed ponad 3 lat.' });
  } else {
    w.push({ code: 'no_date', severity: 'warn', text: 'Brak daty wystawienia.' });
  }

  const active = lines.filter((l) => !l.skip);
  if (active.length === 0) w.push({ code: 'no_lines', severity: 'warn', text: 'Wszystkie pozycje są pomijane — dokument niczego nie przyjmie na magazyn.' });
  const unmatched = active.filter((l) => !l.product_id).length;
  if (unmatched > 0) w.push({ code: 'unmatched', severity: 'error', text: `Pozycje bez produktu: ${unmatched}. Przypisz produkt albo oznacz pozycję jako pomijaną.` });

  const expectedNet = num(doc.total_net);
  if (expectedNet !== null && lines.length > 0) {
    const sum = sumNet(lines);
    if (!totalsMatch(expectedNet, sum)) {
      w.push({ code: 'total_mismatch', severity: 'warn', text: `Suma pozycji (${sum.toFixed(2).replace('.', ',')}) różni się od sumy na fakturze (${expectedNet.toFixed(2).replace('.', ',')}). Możliwa pomyłka odczytu.` });
    }
  }
  const low = active.filter((l) => (l.ai_confidence ?? 100) < 60).length;
  if (low > 0) w.push({ code: 'low_confidence', severity: 'warn', text: `AI nie jest pewne ${low} ${low === 1 ? 'pozycji' : 'pozycji'} — sprawdź je ze zdjęciem.` });
  return w;
}

// ---------------------------------------------------------------------------------------------
// Opakowania: faktura mówi „2 op.", a w magazynie liczymy sztuki. Przeliczenie jest PODPOWIEDZIĄ
// (nigdy cichą zmianą): użytkownik klika „Przelicz", widząc wynik.
// ---------------------------------------------------------------------------------------------

const PACK_UNIT_RE = /^(op|opak|opakowanie|opakowania|karton|kartony|kart|krt|zgrz|zgrzewka|paczka|pacz|box|pack|set|zestaw)\.?$/i;

/** Czy jednostka z faktury wygląda na opakowanie zbiorcze (a nie sztukę, kilogram, litr)? */
export function isPackUnit(unit: string | null | undefined): boolean {
  return PACK_UNIT_RE.test((unit ?? '').trim());
}

/** 2 op. po 12 szt. za 60 zł/op. → 24 szt. po 5 zł/szt. (wartość wiersza się nie zmienia). */
export function convertToStockUnits(
  line: { qty: number; unit_price_net: number | null },
  packSize: number
): { qty: number; unit_price_net: number | null } {
  if (!(packSize > 0)) return line;
  const qty = Math.round(line.qty * packSize * 1000) / 1000;
  const price = line.unit_price_net === null ? null : Math.round((line.unit_price_net / packSize) * 10000) / 10000;
  return { qty, unit_price_net: price };
}
