# 14 — Ratownik: objaw → przyczyna → lek

Jak używać: znajdź **dokładny komunikat** (Ctrl+F). Jeśli go nie ma, skopiuj **cały** tekst błędu z terminala (od pierwszej czerwonej linii) i wyślij osobie, która Ci pomaga — razem z informacją, **który etap** instrukcji robisz i co wpisałeś.
Tabele zakładają Windows (PowerShell). „Folder główny” = `C:\projekty\tapventory`.

## 1. Instalacja i terminal

| Objaw | Przyczyna | Lek |
|---|---|---|
| `node` / `npm` / `git` „nie jest rozpoznawane” | stary terminal albo program niezainstalowany | zamknij **wszystkie** okna terminala, otwórz nowe; jeśli dalej — zainstaluj ponownie (etap 0) |
| `npm : File ...npm.ps1 cannot be loaded because running scripts is disabled` | polityka wykonywania PowerShella | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` albo użyj `cmd` |
| `EPERM` / `EBUSY` / `EACCES` podczas `npm install` | projekt w folderze synchronizowanym (OneDrive, Pulpit), antywirus blokuje pliki | przenieś projekt do `C:\projekty\tapventory`; wyklucz folder w antywirusie; zamknij VS Code i spróbuj ponownie |
| `ENAMETOOLONG`, „path too long” | zbyt długa ścieżka | trzymaj projekt blisko korzenia dysku (`C:\projekty`); w razie czego `git config --global core.longpaths true` |
| `npm error code ERESOLVE` (konflikt zależności) | niezgodne wersje pakietów | w folderze, gdzie to wystąpiło: `npm install --legacy-peer-deps` (w `mobile` jest to domyślne dzięki `.npmrc`) |
| `npm error network` / `ETIMEDOUT` / `ECONNRESET` | sieć, VPN, proxy firmowe | powtórz; wyłącz VPN; na komputerze służbowym często blokowane — pracuj na prywatnym |
| `engine "node" is incompatible` | Node starszy niż 22.18 | zainstaluj Node 24 LTS (nodejs.org) |
| `Unknown file extension ".ts"` przy `npm run fn:test` | Node starszy niż 22.18 | jak wyżej |
| Notatnik zapisał `.env.txt` | ukryte rozszerzenia | Eksplorator → Widok → Pokaż → *Rozszerzenia nazw plików*; zmień nazwę na `.env`; lub `Copy-Item .env.example .env` |
| ostrzeżenie `LF will be replaced by CRLF` | normalna różnica końców linii Gita w Windows | ignoruj |
| `git clone` prosi o hasło / `Authentication failed` | GitHub nie przyjmuje haseł; potrzebne logowanie przeglądarką lub token | zainstaluj Git z domyślnymi opcjami (Git Credential Manager) i zaloguj się w oknie przeglądarki; albo użyj GitHub Desktop |

## 2. Aplikacja w przeglądarce (`npm run web`)

| Objaw | Przyczyna | Lek |
|---|---|---|
| `expo` nie jest rozpoznawane | uruchomiono poza `mobile` albo brak `npm install` | `cd mobile`, `npm install`, `npm run web` |
| `Port 8081 is being used` | poprzednia sesja nie zeszła | zamknij okno terminala z poprzednim serwerem; albo `npm run web -- --port 8082`; albo `netstat -ano | findstr :8081` → `taskkill /PID <numer> /F` |
| biała strona / „Unable to resolve module …” | nieaktualny cache lub brak pakietów | **Ctrl+C**, `npm install`, `npm run web -- --clear` |
| ekran „Brak konfiguracji Supabase” | brak `mobile\.env`, literówka w nazwach zmiennych, albo klucz zaczyna się od `wklej…` | popraw `.env` (etap 4), zrestartuj serwer (zmienne są wczytywane przy starcie) |
| „Invalid API key” / 401 przy logowaniu | wklejony zły klucz (ze spacją/końcem linii), klucz `service_role` zamiast publicznego, albo wklejony URL innego projektu | skopiuj klucz **publiczny** (`anon`/`publishable`) ponownie; URL z tego samego projektu |
| `Failed to fetch` / `Network request failed` | zły URL, projekt wstrzymany (Free po 7 dniach bez ruchu), brak internetu, lokalny Supabase nie działa | sprawdź URL w przeglądarce (`https://TWOJ.supabase.co/rest/v1/` ma zwrócić odpowiedź JSON/401, nie błąd DNS); **wznów** projekt w panelu; dla lokalnego: `npx supabase status` |
| po rejestracji „sprawdź skrzynkę”, a maila nie ma | „Confirm email” włączone; domyślny serwer pocztowy Supabase ma niskie limity i bywa tylko do testów 🟡 | na projekcie dev wyłącz „Confirm email” (etap 3C); dla test/prod skonfiguruj **własny serwer SMTP** (np. Resend/Postmark) w panelu Authentication |
| link z maila prowadzi na `localhost:3000` | Site URL w Supabase ma wartość domyślną | etap 3C: Site URL `http://localhost:8081` + Redirect URLs |
| `Email rate limit exceeded` | zbyt wiele maili w krótkim czasie | poczekaj; wyłącz potwierdzanie na dev; własny SMTP |
| po zalogowaniu „Nie masz jeszcze firmy” w pętli | konto bez firmy | wybierz **Zakładam firmę** (albo kod zaproszenia) |
| „Osiągnięto limit … w Twoim planie” | limit planu (np. Solo: 1 osoba/150 produktów) | nowa firma ma 14 dni planu Zespół; po tym czasie plan zmienia właściciel (obecnie ręcznie: `set_tenant_plan` w SQL Editor) |
| aparat/skaner nie działa w przeglądarce | brak HTTPS (poza `localhost`), odmowa zgody | użyj `localhost` na komputerze albo wdrożonej PWA (HTTPS); sprawdź zgodę w ustawieniach witryny (kłódka w pasku adresu) |
| skaner kodów w przeglądarce nie wykrywa | słabe światło, zbyt mały kod | zbliż, oświetl; plik `zxing_reader.wasm` musi być w `mobile\public` (uruchom `npm install` albo `node scripts/copy-wasm.mjs`) |

## 3. Supabase: CLI, migracje, baza

| Objaw | Przyczyna | Lek |
|---|---|---|
| `npx supabase` pyta o instalację pakietu | nie zrobiono `npm install` w folderze głównym | `npm install` w `C:\projekty\tapventory` (CLI jest w `devDependencies`) |
| `supabase link`: „Invalid access token” / nie jesteś zalogowany | brak `login` | `npx supabase login` |
| `db push`: `password authentication failed` | hasło bazy inne niż przy tworzeniu projektu | panel → Project Settings → Database → **Reset database password**; `npx supabase link` ponownie |
| `db push`: `timeout` / `no route to host` / połączenie z `db.<ref>.supabase.co` się nie udaje | bezpośrednie połączenie z bazą bywa tylko na IPv6 🟡 | użyj połączenia przez **Session pooler (IPv4)** z panelu (Connect): `npx supabase db push --db-url "postgresql://…"` |
| `db push`: `relation … already exists` | w projekcie wykonano już część SQL ręcznie, albo historia migracji się rozjechała | na projekcie **dev** najprościej usunąć projekt i założyć nowy (2 minuty); na projekcie ze zmianami użytkowników — `npx supabase migration list` i `migration repair` (poproś o pomoc, to operacja delikatna) |
| migracja kończy się `ERROR` | usterka w pliku SQL | skopiuj **cały** komunikat; plików już wgranych nie poprawiamy — dodajemy nowy z kolejnym numerem |
| `supabase start`: „Cannot connect to the Docker daemon” | Docker Desktop nie działa | uruchom go, poczekaj na wieloryba (wariant lokalny — `docs/02_*`) |
| `port is already allocated` | poprzednia sesja `supabase start` nie zeszła | `npx supabase stop`, odczekaj, `npx supabase start` |
| `failed to read config` | nowsza wersja CLI nie zna pola w `config.toml` | `docs/02_*`, rozdz. 3 (przenieś plik, `supabase init`, przepisz sekcje) |
| w panelu brak tabel po `db push` | push do innego projektu niż oglądasz | `npx supabase link --project-ref …` z właściwym ID; sprawdź nazwę projektu w panelu |

## 4. Funkcje serwerowe, AI, harmonogram

| Objaw | Przyczyna | Lek |
|---|---|---|
| skan faktury od razu „błąd”: *Brak zmiennej środowiskowej …* (`not_configured`) | brak sekretu | `npx supabase secrets set --env-file supabase/functions/.env`; sprawdź listę: `npx supabase secrets list` |
| *Brak klucza serwisowego Supabase …* | platforma nazwała klucz inaczej | `docs/02_*`, rozdz. 7 / `supabase/functions/README.md`: ustaw `TV_SERVICE_KEY` |
| `401 unauthorized` z funkcji | sesja wygasła | wyloguj i zaloguj; funkcja wymaga zalogowania (`verify_jwt` wyłączone, sprawdzamy sami) |
| `403 forbidden` przy skanie | konto jest pracownikiem (faktury tylko kierownictwo) | zaloguj się jako kierownik/właściciel |
| „Wykorzystano miesięczny limit skanów AI w Twoim planie” | limit planu (Solo 5, Start 30, Zespół 150) | poczekaj do początku miesiąca albo zmień plan (SQL: `set_tenant_plan`) |
| „Asystent jest chwilowo niedostępny” (502) | brak środków/klucza u Anthropic, limit wydatków, awaria | panel Anthropic → klucz, saldo, limity; logi funkcji `assistant` |
| faktura wisi w „AI czyta…” > 10 min | harmonogram `cron-tasks` nie działa (strażnik nie zamyka) | skonfiguruj harmonogram (`supabase/functions/README.md`), sprawdź nagłówek `x-cron-secret` = `CRON_SECRET` |
| faktura „nie udało się odczytać” | zdjęcie nieczytelne, to nie faktura, duplikat | komunikat jest w dokumencie; **Spróbuj ponownie** albo wpisz ręcznie; duplikat — usuń nowy dokument |
| `functions deploy` zgłasza Dockera | CLI próbuje pakować lokalnie | dodaj `--use-api` (jeśli Twoja wersja CLI zna tę flagę) |
| funkcje wdrożone, a aplikacja ich nie widzi (404) | wdrożone na inny projekt | `npx supabase link --project-ref …` właściwego projektu i `functions deploy` |
| koszty AI rosną | zbyt wiele skanów / droższy model | tabela `ai_usage`; zapytania w `docs/09_*`, rozdz. 7; limit wydatków u dostawcy |

## 5. KSeF

Pełna tabela komunikatów: `docs/10_KSEF.md`, rozdz. 8. Najczęstsze:

| Objaw | Lek |
|---|---|
| „Token jest jeszcze nieaktywny…” | odczekaj minutę (świeży token aktywuje się po chwili) i spróbuj ponownie |
| „Ten token należy do innej firmy…” | NIP w Tapventory musi być NIP‑em firmy, w której wygenerowano token |
| „Token nie ma żadnych uprawnień…” | nowy token z uprawnieniem **Przeglądanie faktur** |
| po połączeniu „Brak nowych faktur”, a powinny być | zakres dat (domyślnie 30 dni), albo w tym okresie nie było faktur zakupu na ten NIP; sprawdź środowisko (Produkcja/Test) |
| pobieranie „częściowe”, powtarza się | normalne przy dużej zaległości: limit KSeF to 64 faktury/godz.; poczekaj, kolejne porcje przyjdą same |
| nic się nie pobiera automatycznie | harmonogram `cron-tasks` nie działa (rozdz. 4) lub `KSEF_TOKEN_KEY` zmieniony |

## 6. PWA na telefonie

| Objaw | Przyczyna | Lek |
|---|---|---|
| iPhone: nie ma opcji instalacji | otwarto w innej przeglądarce niż Safari (starsze iOS) | w Safari: **Udostępnij → Do ekranu początkowego** |
| po wdrożeniu nowej wersji telefon pokazuje starą | pamięć podręczna service workera | zamknij i otwórz aplikację 2 razy; w razie potrzeby usuń ikonę i zainstaluj ponownie; w razie zmiany shellu zwiększ `CACHE_VERSION` w `public/sw.js` |
| strona na hostingu pokazuje 404 po odświeżeniu podstrony | brak „przepisania” ścieżek na `index.html` | Netlify/Cloudflare: plik `_redirects` jest w `dist`; Vercel: dodaj `vercel.json` (`docs/13_*`, rozdz. 2.2) |
| aplikacja z hostingu łączy się z bazą lokalną / nie łączy się | `EXPO_PUBLIC_*` wklejone przy budowaniu wskazywały `127.0.0.1` | zbuduj ponownie z `.env` projektu w chmurze i wdróż nowy `dist` |
| aparat odmawia | brak HTTPS albo wcześniejsza odmowa zgody | HTTPS; ustawienia witryny/Safari → Aparat: Pozwól |
| brak powiadomień push w PWA | Web Push nie jest zbudowany | `docs/13_*`, rozdz. 5; powiadomienia czekają w zakładce Aktywność |

## 7. EAS, Android, iOS

| Objaw | Przyczyna | Lek |
|---|---|---|
| `eas build`: „Not logged in” | brak logowania | `eas login`; sprawdź `eas whoami` |
| błąd o `projectId` / „EAS project not configured” | brak identyfikatora w `app.config.ts` | `docs/12_*`, rozdz. 2.1 (`eas init`, wpisz ID do `app.config.ts`) |
| budowanie w kolejce bardzo długo | plan Free = niski priorytet | poczekaj; albo plan Starter; albo `eas build --local` (wymaga środowiska Androida/Maca) |
| budowanie nieudane, „Run gradlew failed” / „Install pods failed” | błąd zależności lub konfiguracji | otwórz log budowania na expo.dev → faza, która zgłosiła błąd; skopiuj pierwszy błąd |
| APK: „Aplikacja nie została zainstalowana” | konflikt podpisów (wcześniej zainstalowana inna wersja) lub brak miejsca | odinstaluj starą aplikację (wariant `.staging`/`.dev` jest osobną aplikacją, więc zwykle nie koliduje); zwolnij miejsce |
| „Zablokowano instalację z nieznanych źródeł” | ustawienie Androida | zezwól przeglądarce/menedżerowi plików na instalację aplikacji |
| TestFlight: „Brak zgodności eksportowej” | pytanie o szyfrowanie | w aplikacji jest `ITSAppUsesNonExemptEncryption: false` — jeśli pytanie nadal się pojawia, odpowiedz „tylko standardowe HTTPS” |
| e‑mail od Apple o brakujących deklaracjach API (np. *ITMS-91053*) | manifest prywatności | `docs/12_*`, rozdz. 4.3 |
| Apple odrzuca: zakup/cena/odesłanie do płatności (3.1.1/3.1.3) | rozdz. 5.4 w `docs/12_*` | usuń odniesienia do płatności w widoku iOS albo dodaj zakupy w aplikacji |
| Google Play: „Your app targets an outdated API level” | docelowe API poniżej wymogu | sprawdź `targetSdkVersion` w AAB (powinno być 36); `docs/12_*`, rozdz. 3.3 |
| push nie dociera (Android) | brak konfiguracji Firebase | `docs/12_*`, rozdz. 3.5 |

## 8. Testy

| Objaw | Przyczyna | Lek |
|---|---|---|
| `db:test`: `ECONNREFUSED 127.0.0.1:54322` | nie ma PostgreSQL pod domyślnym adresem | `docs/02_*`, rozdz. 6 (`TEST_DATABASE_URL` albo GitHub Actions) |
| `permission denied to create database` | połączenie nie jest superużytkownikiem | użyj użytkownika `postgres` |
| `extension "pg_trgm" is not available` | PostgreSQL bez dodatków (contrib) | zainstaluj wersję z dodatkami (instalator EDB je zawiera) |
| `Cannot find module 'pg'` | brak `npm install` w folderze głównym | `npm install` |
| test zawiesza się | stara, niezakończona baza lub proces | `Ctrl+C`; usuń bazy `tv_test_*` (`DROP DATABASE … WITH (FORCE)`); `createTestDb` sprząta po sobie przy błędzie migracji |
| `fn:deno-check` nie działa | brak internetu przy pierwszym pobraniu Deno | spróbuj ponownie z dostępem do sieci |
| ui-smoke: „Executable doesn't exist” | brak przeglądarki Playwright | `npx playwright install chromium` |
| `npm run lint` zgłasza dziesiątki błędów po nowej wersji Expo | zmiana reguł | `npx expo install --fix`; sprawdź `mobile/eslint.config.js` |
