// ============================================================================
// Weryfikacja i czyszczenie danych z faktury — „LLM czyta, KOD sprawdza".
// ============================================================================
// Model może się pomylić w cyfrze NIP-u albo w przecinku ceny. Ten plik zawiera
// WYŁĄCZNIE czyste funkcje (bez sieci, bez bazy), więc da się je testować w sekundę
// i działają tak samo w Deno (Supabase) i w Node (testy).

/** Polski NIP: 10 cyfr, waga 6,5,7,2,3,4,5,6,7, suma mod 11 = ostatnia cyfra (lustro is_valid_nip z bazy). */
export function isValidNip(input: string): boolean {
  const nip = normalizeNip(input);
  if (!/^[1-9]\d{9}$/.test(nip)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((acc, weight, i) => acc + weight * Number(nip[i]), 0);
  return sum % 11 === Number(nip[9]);
}

/** Same cyfry; ucina prefiks „PL" (np. „PL 526-025-09-95"). */
export function normalizeNip(input: string | null | undefined): string {
  return String(input ?? '').replace(/^\s*PL/i, '').replace(/\D/g, '');
}

/** Suma kontrolna GS1 (EAN-8 / UPC-A / EAN-13). */
export function gs1ChecksumOk(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

/** Kod w formie przyjmowanej przez bazę (8 lub 13 cyfr) albo null, gdy to nie poprawny EAN. */
export function normalizeEan(input: unknown): string | null {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (!gs1ChecksumOk(digits)) return null;
  if (digits.length === 12) return `0${digits}`;
  return digits.length === 8 || digits.length === 13 ? digits : null;
}

/**
 * Liczba z różnych zapisów: 1234.5, "1 234,50", "1.234,50", "1,234.50", "12,5 zł", "(15,00)" (ujemna).
 * Zwraca null, gdy nie da się jednoznacznie odczytać.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // symbol waluty / jednostka tylko na początku lub końcu („12,50 zł", „PLN 99"); litery w środku = śmieć
  s = s.replace(/^[^\d(+\-.,]+/, '').replace(/[^\d]+$/, '').replace(/[\s\u00a0]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // oba separatory: ten, który występuje później, jest dziesiętnym
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    if (parts.length > 2) {
      // wiele separatorów = tysiące; poprawne tylko grupy po 3 cyfry (1.234.567), inaczej to śmieć
      if (!/^\d{1,3}$/.test(parts[0]) || !parts.slice(1).every((g) => /^\d{3}$/.test(g))) return null;
      s = parts.join('');
    } else {
      s = `${parts[0]}.${parts[1]}`;            // pojedynczy separator = dziesiętny („1,234" kg to 1,234 kg)
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Data → RRRR-MM-DD albo null. Rozumie ISO i polskie zapisy; odrzuca daty nierealne dla faktury. */
export function normalizeDate(value: unknown, today: Date = new Date()): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 2000 || date.getTime() > today.getTime() + 366 * 86_400_000) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Stawka VAT: liczba z listy stawek obowiązujących w Polsce albo null („zw", „np", „oo" itd.). */
export function normalizeVat(value: unknown): number | null {
  const n = parseNumber(typeof value === 'string' ? value.replace('%', '') : value);
  if (n === null) return null;
  return [0, 5, 8, 23].includes(n) ? n : null;
}

const UNIT_ALIASES: Record<string, string> = {
  szt: 'szt.', sztuk: 'szt.', sztuka: 'szt.', pcs: 'szt.', pc: 'szt.',
  op: 'op.', opak: 'op.', opakowanie: 'op.', opakowania: 'op.',
  kg: 'kg', g: 'g', l: 'l', ltr: 'l', litr: 'l', ml: 'ml', m: 'm', mb: 'm', m2: 'm²', 'm²': 'm²', m3: 'm³', 'm³': 'm³',
  kpl: 'kpl.', komplet: 'kpl.', zestaw: 'kpl.', para: 'para', par: 'para', pary: 'para',
  karton: 'karton', krt: 'karton', paleta: 'paleta', pal: 'paleta', zgrzewka: 'zgrzewka', usł: 'usł.', usl: 'usł.', usługa: 'usł.',
};

/** Ujednolica jednostkę miary („SZT", „szt", „sztuk" → „szt."). Nieznane zostawia bez zmian (do 20 znaków). */
export function normalizeUnit(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[key] ?? raw.slice(0, 20);
}

/** Tolerancja porównań kwot: 2 grosze albo 0,5% (większa z nich) — zaokrąglenia VAT i rabaty. */
export function amountsMatch(expected: number, actual: number): boolean {
  // 1e-9: błąd zmiennoprzecinkowy (1.02 - 1 = 0.020000000000000018) nie może odrzucić różnicy dokładnie 2 groszy
  return Math.abs(expected - actual) <= Math.max(0.02, Math.abs(expected) * 0.005) + 1e-9;
}
