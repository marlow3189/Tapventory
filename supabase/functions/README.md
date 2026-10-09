# Edge Functions Tapventory

Edge Function to mały program (Deno/TypeScript) uruchamiany na serwerze Supabase. Mamy je po to, by **klucze (AI, KSeF) nigdy nie trafiały do telefonu** i by robić rzeczy, których nie wolno zaufać aplikacji (limity planu, zapis wyniku odczytu faktury, rozmowa z państwowym KSeF).

## Funkcje

| Funkcja | Kto wywołuje | Co robi | Potrzebne sekrety |
|---|---|---|---|
| `process-document` | aplikacja (kierownik) | czyta zdjęcia/PDF faktury modelem AI, kod sprawdza wynik, zapis do bazy; odpowiada od razu (202), pracuje w tle | `ANTHROPIC_API_KEY` |
| `assistant` | aplikacja (każdy członek) | asystent „jak coś zrobić w aplikacji" (dzienny limit pytań) | `ANTHROPIC_API_KEY` |
| `barcode-lookup` | aplikacja | nazwa produktu po kodzie EAN (Open Food Facts, z cache w bazie) | – |
| `ksef-connect` | aplikacja (właściciel) | sprawdza token KSeF na żywo, zapisuje go zaszyfrowany, startuje pierwszą synchronizację | `KSEF_TOKEN_KEY` |
| `ksef-sync` | aplikacja (kierownik) | ręczne „Synchronizuj teraz" | `KSEF_TOKEN_KEY` |
| `cron-tasks` | harmonogram co minutę | strażnik wiszących faktur, przypomnienia o spisie, **automatyczna synchronizacja KSeF**, wysyłka push | `CRON_SECRET`, `KSEF_TOKEN_KEY` |
| `send-push` | harmonogram / ręcznie | wysyła zaległe powiadomienia push (Expo) | `CRON_SECRET` |

Struktura kodu: `*/handler.ts` to logika (wstrzykiwane zależności → łatwe testy), `*/index.ts` to cienkie „podpięcie" do `Deno.serve`, `_shared/runtime.ts` to jedyne miejsce z prawdziwymi klientami (Supabase, Anthropic), a `_shared/ksef/` to klient KSeF, parser faktur FA i sejf na token.

## Sekrety

Wzór: [`.env.example`](.env.example). Lista i sposób generowania kluczy są w komentarzach tego pliku.

```powershell
# lokalnie (potrzebny Docker Desktop):
copy supabase\functions\.env.example supabase\functions\.env     # uzupełnij wartości
npx supabase functions serve --env-file supabase/functions/.env

# na serwerze (supabase.com) — raz, po utworzeniu projektu i zalogowaniu `npx supabase login`:
npx supabase link --project-ref TWOJ_REF
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy
```

`supabase functions deploy` (bez nazwy) wdraża wszystkie funkcje z tego katalogu, z ustawieniami z `supabase/config.toml` (sekcje `[functions.*]`).

## Harmonogram (obowiązkowy dla push, strażnika faktur i automatu KSeF)

`cron-tasks` musi być wołany **co minutę** metodą POST z nagłówkiem `x-cron-secret: <CRON_SECRET>`. Dwie drogi:

**A. Panel Supabase** (najprościej): *Integrations → Cron → Create job* (nazwy menu mogą się nieco różnić), typ „Supabase Edge Function", funkcja `cron-tasks`, metoda POST, harmonogram `* * * * *`, nagłówek `x-cron-secret`. Wartość sekretu trzymaj w Vault (Project Settings → Vault) i wskaż ją w zadaniu zamiast wpisywać na stałe.

**B. GitHub Actions** (gdy panel nie oferuje minutowego harmonogramu — GitHub uruchamia nie częściej niż co 5 minut i bywa spóźniony; dla push to zwykle wystarcza):

```yaml
# .github/workflows/cron.yml  (dodaj sekrety repozytorium: SUPABASE_FUNCTIONS_URL i CRON_SECRET)
name: cron
on:
  schedule: [{ cron: '*/5 * * * *' }]
  workflow_dispatch:
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - run: >
          curl -sS --fail-with-body -X POST "${{ secrets.SUPABASE_FUNCTIONS_URL }}/cron-tasks"
          -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" -H "content-type: application/json" -d '{}'
```
`SUPABASE_FUNCTIONS_URL` to `https://TWOJ_REF.supabase.co/functions/v1`.

Co robi jedno wywołanie, możesz zobaczyć w odpowiedzi JSON (`reaped_documents`, `count_reminders`, `ksef`, `push`). KSeF jest odpytywany nie częściej niż co 3 godziny na firmę (limit w bazie, funkcja `due_ksef_tenants`), niezależnie od częstotliwości harmonogramu.

## Testy i kontrole

```powershell
npm run fn:test          # 146 testów logiki (Node, bez sieci i bez Dockera)
npm run fn:typecheck     # TypeScript (tsc)
npm run fn:deno-check    # opcjonalnie: sprawdzenie typów w prawdziwym Deno, jak na serwerze (pobiera Deno przez npx)
npm run fn:deno-test     # opcjonalnie: te same testy uruchomione pod Deno
```

## Zasady, których nie wolno łamać

1. **Każda funkcja zwraca błędy w kształcie** `{ "error": { "code", "message" } }` (po polsku) — aplikacja je tak czyta (`mobile/src/lib/api/functions.ts`).
2. **Pierwszy krok każdej funkcji użytkownika to sprawdzenie sesji** (`auth.getUser`) — dlatego w `config.toml` jest `verify_jwt = false` (uzasadnienie w pliku).
3. **Logi bez treści faktur i bez tokenów** — wyłącznie identyfikatory, kody i liczby.
4. **Nowa funkcja SQL dla backendu = `revoke execute … from public, anon, authenticated` + `grant … to service_role`** (test `01_invariants` wymusza decyzję).
