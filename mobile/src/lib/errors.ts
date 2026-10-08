// Zamiana błędów (Supabase / PostgREST / sieć / nasze RPC) na zrozumiałe komunikaty.
// Zasada: użytkownik nigdy nie widzi surowego "violates check constraint ...".

type ErrLike = { message?: string; code?: string; details?: string; hint?: string; status?: number; name?: string };

const NETWORK_RE = /network request failed|failed to fetch|networkerror|load failed|timeout|timed out|fetch failed/i;

/** Czy to błąd naszej logiki w bazie (RAISE EXCEPTION z kodem P0001) — wtedy tekst jest już po polsku. */
export function isBusinessError(e: ErrLike): boolean {
  return e.code === 'P0001';
}

export function friendlyError(error: unknown, fallback = 'Coś poszło nie tak. Spróbuj ponownie.'): string {
  if (!error) return fallback;
  const e: ErrLike = typeof error === 'string' ? { message: error } : (error as ErrLike);
  const msg = e.message ?? '';

  if (NETWORK_RE.test(msg)) return 'Brak połączenia z internetem. Sprawdź sieć i spróbuj ponownie.';
  if (isBusinessError(e) && msg) return msg;

  switch (e.code) {
    case '23505': {
      const hay = `${msg} ${e.details ?? ''}`;
      if (hay.includes('documents_duplicate_guard')) return 'Taka faktura (ten dostawca i numer) już istnieje w systemie.';
      if (hay.includes('products_tenant_ean_unique')) return 'Produkt z tym kodem kreskowym już istnieje.';
      if (hay.includes('tenant_invites')) return 'To zaproszenie już istnieje.';
      return 'Taki wpis już istnieje.';
    }
    case '23514':
      if (msg.includes('qty_sign_matches_type')) return 'Nieprawidłowa ilość dla tego rodzaju ruchu.';
      if (msg.includes('nip')) return 'Nieprawidłowy NIP (sprawdź cyfry).';
      return 'Wartość nie spełnia wymagań. Sprawdź wprowadzone dane.';
    case '23503':
      return 'Nie można tego zrobić: wpis jest powiązany z innymi danymi.';
    case '42501':
      return 'Brak uprawnień do tej operacji.';
    case '23502':
      return 'Uzupełnij wymagane pola.';
    case 'PGRST301':
    case 'PGRST303':
      return 'Sesja wygasła. Zaloguj się ponownie.';
    default:
  }

  if (/invalid login credentials/i.test(msg)) return 'Nieprawidłowy e-mail lub hasło.';
  if (/email not confirmed/i.test(msg)) return 'Najpierw potwierdź adres e-mail (link w wiadomości od nas).';
  if (/user already registered/i.test(msg)) return 'Konto z tym adresem e-mail już istnieje. Zaloguj się.';
  if (/password should be at least/i.test(msg)) return 'Hasło jest za krótkie.';
  if (/rate limit|too many requests|over_email_send_rate_limit/i.test(msg)) return 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.';
  if (/jwt expired|invalid jwt|not authenticated/i.test(msg)) return 'Sesja wygasła. Zaloguj się ponownie.';
  if (msg === 'AI_QUOTA_EXCEEDED') return 'Wykorzystano miesięczny limit skanów AI w Twoim planie.';

  return fallback;
}
