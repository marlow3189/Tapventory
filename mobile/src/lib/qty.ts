// Wpisywanie ilości: Polacy piszą "1,5", telefony z angielską klawiaturą dają "1.5".
// Obsługujemy oba zapisy; wartości ujemne, puste i nieliczbowe odrzucamy.

/** "2,5" → 2.5; " 3 " → 3; "" / "abc" / "-1" → null. */
export function parseQty(input: string | number | null | undefined): number | null {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? input : null;
  const s = (input ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Wynik do pola tekstowego: 2.5 → "2,5" (bez zbędnych zer). */
export function qtyToInput(n: number): string {
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

/** Dodaje krok do tego, co jest w polu (z dolnym limitem 0). */
export function stepQty(input: string, delta: number): string {
  const base = parseQty(input) ?? 0;
  return qtyToInput(Math.max(0, base + delta));
}

/** Liczba ze znakiem (faktury korygujące mają ilości ujemne): "-2,5" → -2.5; puste/nieliczbowe → null. */
export function parseSigned(input: string | number | null | undefined): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const raw = (input ?? '').trim().replace(/\s+/g, '');
  if (raw.startsWith('-')) {
    const n = parseQty(raw.slice(1));
    return n === null ? null : -n;
  }
  return parseQty(raw);
}

/** Cena/kwota: "12,50" → 12.5, null dla pustego. Tylko wartości >= 0. */
export function parseMoney(input: string | number | null | undefined): number | null {
  return parseQty(input);
}
