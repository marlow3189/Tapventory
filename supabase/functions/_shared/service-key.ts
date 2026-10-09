// ============================================================================
// Skąd funkcja bierze klucz serwisowy Supabase (czysty moduł — testowany w Node)
// ============================================================================
// Dla juniora: klucz „service role" daje pełny dostęp do bazy z pominięciem RLS, więc wolno go mieć
// WYŁĄCZNIE w Edge Function (nigdy w aplikacji ani w repozytorium). Supabase wstrzykuje go funkcjom
// samo, ale nazwa zmiennej zależy od wieku projektu:
//   • starsze projekty (klucze JWT „anon"/„service_role"): SUPABASE_SERVICE_ROLE_KEY,
//   • nowsze projekty (klucze „sb_secret_…"): mapa JSON SUPABASE_SECRET_KEYS, np. {"default":"sb_secret_…"}.
// Nie mogliśmy sprawdzić na żywo, która wersja dotyczy Twojego projektu — dlatego obsługujemy obie,
// a gdyby platforma znów zmieniła nazwy, możesz ustawić własny sekret TV_SERVICE_KEY:
//   npx supabase secrets set TV_SERVICE_KEY=<klucz secret/service_role z Project Settings → API Keys>
// (nazwy zaczynające się od SUPABASE_ są zarezerwowane, więc własna ma inny przedrostek).

/** Kolejność: jawnie ustawiony TV_SERVICE_KEY → SUPABASE_SERVICE_ROLE_KEY → SUPABASE_SECRET_KEYS. */
export function resolveServiceKey(get: (name: string) => string | undefined): string | undefined {
  const explicit = get('TV_SERVICE_KEY')?.trim();
  if (explicit) return explicit;

  const legacy = get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (legacy) return legacy;

  const raw = get('SUPABASE_SECRET_KEYS')?.trim();
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const map = parsed as Record<string, unknown>;
      if (typeof map.default === 'string' && map.default.trim() !== '') return map.default.trim();
      const first = Object.values(map).find((v): v is string => typeof v === 'string' && v.trim() !== '');
      if (first) return first.trim();
    }
    if (typeof parsed === 'string' && parsed.trim() !== '') return parsed.trim();
  } catch {
    // nie JSON — niektóre środowiska podają pojedynczy klucz jako zwykły tekst
  }
  return /^sb_secret_/.test(raw) ? raw : undefined;
}
