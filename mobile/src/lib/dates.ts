// Daty wpisywane ręcznie (data wystawienia faktury). W bazie trzymamy RRRR-MM-DD;
// ludzie piszą po polsku: 08.10.2026, 8-10-2026, 8/10/2026 albo od razu 2026-10-08.

/** Zwraca RRRR-MM-DD albo null, gdy to nie jest prawdziwa data (np. 31.02.2026). */
export function parseDateInput(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Dzisiejsza data lokalna jako RRRR-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
