// Zapamiętuje, dokąd użytkownik chciał trafić, zanim kazaliśmy mu się zalogować
// (np. link z zaproszeniem /join?code=ABCD-EFGH albo powiadomienie o zgłoszeniu).
// Po zalogowaniu wracamy dokładnie tam, a nie na stronę główną.

let pending: string | null = null;

/** Zapisuje ścieżkę (tylko wewnętrzne adresy zaczynające się od "/" — brak otwartych przekierowań). */
export function rememberDestination(path: string | null | undefined) {
  if (!path) return;
  if (!path.startsWith('/') || path.startsWith('//')) return;
  if (/^\/(login|register|forgot|reset-password|onboarding)?$/.test(path.split('?')[0])) return;
  pending = path;
}

/** Zwraca zapamiętaną ścieżkę (raz) albo null. */
export function takeDestination(): string | null {
  const p = pending;
  pending = null;
  return p;
}

export function peekDestination(): string | null {
  return pending;
}
