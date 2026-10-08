// Polski NIP: 10 cyfr, ostatnia to suma kontrolna (wagi 6,5,7,2,3,4,5,6,7; mod 11).
// Lustro funkcji public.is_valid_nip z bazy (migracja 0003) — ta sama reguła
// daje użytkownikowi natychmiastowy komunikat, zanim poleci zapytanie.

const WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

/** Zostawia same cyfry; ucina prefiks „PL" (np. z faktur: PL 526-025-09-95). */
export function normalizeNip(input: string): string {
  return input.replace(/^\s*PL/i, '').replace(/\D/g, '');
}

export function isValidNip(input: string): boolean {
  const nip = normalizeNip(input);
  if (!/^[1-9]\d{9}$/.test(nip)) return false; // pierwsza cyfra: kod urzędu 101–999
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(nip[i]), 0);
  return sum % 11 === Number(nip[9]);
}

export function formatNip(input: string): string {
  const n = normalizeNip(input);
  return n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6, 8)}-${n.slice(8)}` : input;
}
