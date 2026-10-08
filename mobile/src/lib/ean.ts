// Kody kreskowe produktów. Skaner potrafi zwrócić EAN-13, EAN-8, UPC-A (12 cyfr),
// a baza przyjmuje wyłącznie 8 lub 13 cyfr — tu normalizujemy i sprawdzamy sumę.

/** Suma kontrolna GS1: od prawej, bez cyfry kontrolnej, wagi 3,1,3,1,... */
export function gs1ChecksumOk(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Zwraca kod w formie akceptowanej przez bazę (EAN-8 lub EAN-13) albo null.
 * UPC-A (12 cyfr) = EAN-13 z zerem z przodu. GTIN-14 (kartony) pomijamy.
 */
export function normalizeBarcode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!gs1ChecksumOk(digits)) return null;
  if (digits.length === 12) return `0${digits}`;
  if (digits.length === 8 || digits.length === 13) return digits;
  return null;
}
