// Wyszukiwanie po polsku: "zolty" ma znaleźć "Żółty", wielkość liter bez znaczenia.

/** małe litery, bez ogonków i akcentów (NFD nie rozkłada "ł", więc osobno) */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Czy tekst zawiera KAŻDE słowo z zapytania (kolejność dowolna). Puste zapytanie pasuje do wszystkiego. */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = fold(query).trim();
  if (!q) return true;
  const h = fold(haystack);
  return q.split(/\s+/).every((word) => h.includes(word));
}
