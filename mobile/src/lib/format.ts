// Formatowanie po polsku: ilości, odmiana, czas względny, pieniądze, inicjały.

/** 1 → „1", 2.5 → „2,5", 1000 → „1 000", ułamki do 3 miejsc, bez zbędnych zer. */
export function formatQty(value: number | string | null | undefined, maxDecimals = 3): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('pl-PL', { maximumFractionDigits: maxDecimals });
}

export function formatQtyUnit(value: number | string | null | undefined, unit?: string | null): string {
  return unit ? `${formatQty(value)} ${unit}` : formatQty(value);
}

/** Polska odmiana: 1 → one; 2–4 (poza 12–14) → few; reszta → many. */
export function plural(n: number, forms: readonly [one: string, few: string, many: string]): string {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 1) return forms[0];
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return forms[1];
  return forms[2];
}

export function countLabel(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${plural(n, forms)}`;
}

/** Czas względny: „przed chwilą", „5 min temu", „3 godz. temu", „wczoraj", „4 dni temu", data. */
export function timeAgo(input: string | Date, now: Date = new Date()): string {
  const then = typeof input === 'string' ? new Date(input) : input;
  const sec = Math.round((now.getTime() - then.getTime()) / 1000);
  if (Number.isNaN(sec)) return '';
  if (sec < 45) return 'przed chwilą';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min temu`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} godz. temu`;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days === 1) return 'wczoraj';
  if (days < 7) return `${days} ${plural(days, ['dzień', 'dni', 'dni'])} temu`;
  return then.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatMoney(amount: number | string | null | undefined, currency = 'PLN'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  return Number(amount).toLocaleString('pl-PL', { style: 'currency', currency });
}

/** „Jan Kowalski" → „JK"; pusty ciąg → „?" */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Stabilny kolor awatara z ciągu (ten sam użytkownik = zawsze ten sam odcień). */
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
