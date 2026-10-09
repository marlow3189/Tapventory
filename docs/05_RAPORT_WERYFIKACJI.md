# 05 — Raport weryfikacji: co sprawdziłem, co znalazłem, czego nie sprawdziłem

Data: 9 października 2026. Zakres: cały kod z paczki „Krok 1 — fundament” (baza `0001`/`0002`, szkielet aplikacji) oraz wszystko, co zbudowano na nim w tej wersji.
Zasada raportu: **każde twierdzenie ma dowód albo etykietę „niesprawdzone”.**

## 1. Wynik w jednej tabeli

| Obszar | Jak sprawdzone | Wynik |
|---|---|---|
| Baza danych — migracje `0001…0014` | skrypt `createTestDb()` buduje świeżą bazę z plików `supabase/migrations` + `seed.sql` (to samo, co `supabase db reset`) i uruchamia **117 testów** na prawdziwym PostgreSQL **16.15 i 17.5** | ✅ 117/117 na obu |
| Bezpieczeństwo (RLS, role, uprawnienia funkcji i tabel) | testy regresji **F1–F10**, test inwariantów (lista funkcji dostępnych dla zalogowanych, macierz uprawnień do tabel, tabele „tylko backend”) | ✅ |
| Edge Functions (siedem) | **154 testy** w Node z wstrzykiwanymi atrapami; te same testy pod **Deno 2.9.6**; `deno check` wszystkich siedmiu `index.ts`; start serwera i odrzucenie żądania bez logowania (401) | ✅ |
| KSeF | symulator serwera MF z **prawdziwym odszyfrowaniem RSA‑OAEP**; test end‑to‑end przez prawdziwy PostgreSQL | ✅ symulowany · ❌ **brak rozmowy z prawdziwym KSeF** |
| Zestaw ewaluacyjny `eval/` | 14 testów, tryb próbny (atrapa) daje 100% przy zerowym szumie = spójność wzorca | ✅ · ❌ **brak liczb z prawdziwych modeli** |
| Aplikacja — typy, lint, testy jednostkowe | `tsc --noEmit`, `expo lint`, Jest | patrz rozdz. 6 (wyniki końcowego przebiegu) |
| Aplikacja — pakiety web / Android / iOS | `expo export` dla trzech platform (to robi też CI) | patrz rozdz. 6 |
| Aplikacja — interfejs | test dymny w prawdziwym **Chromium**: 8 ścieżek, ~40 zrzutów ekranu obejrzanych wzrokowo, brak błędów w konsoli — na **makiecie backendu** | ✅ (makieta) |
| Budowa natywna iOS/Android, push na urządzeniu, sklepy | — | ❌ **niesprawdzone** (brak kont, Maca i dostępu do expo.dev) |
| Wdrożenie funkcji i migracji na żywy Supabase | — | ❌ **niesprawdzone**; `config.toml` sprawdzony parserem CLI 2.120 (`supabase status` kończy się błędem o Dockerze, nie o konfiguracji) |
| Workflow CI (GitHub Actions) | poprawny YAML | ❌ **nigdy nie uruchomiony** |

## 2. Usterki fundamentu (migracje `0001`/`0002`) — F1–F10, naprawione w `0003`

Każda ma test w `supabase/tests/02_security_regressions.test.mjs`. **Dowód, że to były prawdziwe usterki, nie teoria:** ten sam plik testów uruchomiony na **samym fundamencie** (0001+0002) kończy się wynikiem **18 czerwonych z 19**; po `0003` — wszystkie zielone.
Powtórz to sam:

```powershell
$env:TEST_MIGRATE_UP_TO = "0002"
node --test supabase/tests/02_security_regressions.test.mjs     # czerwone
Remove-Item Env:TEST_MIGRATE_UP_TO
node --test supabase/tests/02_security_regressions.test.mjs     # zielone
```

(Potrzebny PostgreSQL — patrz `docs/06_TESTY_I_JAKOSC.md`.)

| # | Usterka | Skutek (powaga) | Dowód na fundamencie | Naprawa w `0003` |
|---|---|---|---|---|
| **F1** | Autoryzacja w funkcjach RPC przepuszczała osoby spoza firmy. Przyczyna: logika trójwartościowa SQL — `is_owner()` dla nieczłonka zwracała `NULL`, a `if not NULL then raise` **nie rzuca wyjątku** | **krytyczna:** dowolny zalogowany mógł wystawić sobie zaproszenie na **WŁAŚCICIELA cudzej firmy** (znając jej UUID, np. były pracownik) | test: „Oczekiwano błędu, ale zapytanie zakończyło się sukcesem” | funkcje uprawnień zwracają zawsze `true`/`false`; test wszystkich funkcji RPC dla obcego użytkownika |
| **F2** | kierownik mógł zmienić rolę w istniejącym zaproszeniu (`UPDATE`) | wysoka: eskalacja uprawnień przez zaproszenie | ❓ test na fundamencie nie dał się uruchomić (inny kształt funkcji) — usterka wykryta z lektury polityk | zakaz zmiany roli w zaproszeniu |
| **F3** | pracownik widział faktury i ceny zakupu (macierz ról tego zabrania) | wysoka: wyciek danych finansowych wewnątrz firmy | `1 !== 0` — pracownik widzi 1 fakturę | polityki odczytu tylko dla kierownictwa (dokumenty, pozycje, pliki) |
| **F4** | usunięcie firmy było niemożliwe (tabele „tylko do dopisywania” blokowały kaskadę), usunięcie konta — niemożliwe, gdy użytkownik zostawił jakikolwiek ślad (klucze obce do `auth.users`) | **wymóg prawny i sklepowy:** RODO oraz Apple 5.1.1(v)/Google wymagają usuwania kont | testy usuwania czerwone | `delete_tenant` (po wpisaniu nazwy), `delete_account`, profil jako „znacznik” z anonimizacją; ostatni właściciel chroniony |
| **F5** | rejestracja wywalała się dla pustego imienia i dla kont bez e‑maila | średnia: nie da się założyć konta | zapisane imię `'   '` zamiast zastępczego | `handle_new_user` odporna na puste dane |
| **F6** | brak kontroli spójności między firmami (dokument firmy A w ruchu firmy C) | średnia: błąd aplikacji mógł „zmieszać” dane firm | test czerwony | złożone klucze obce `(tenant_id, id)` |
| **F7** | kierownik mógł zmienić NIP firmy (kotwica ochrony okresów próbnych); `create_tenant` przyjmował NIP bez sumy kontrolnej i dowolne nazwy; brak limitu firm na konto | średnia | test czerwony | `set_tenant_nip` tylko właściciel + `is_valid_nip`; walidacja; limit 5 firm |
| **F8** | dowolny użytkownik mógł zatruć **globalny** katalog produktów (nazwa pod cudzy EAN) | średnia: dane widoczne dla wszystkich firm | zapis do katalogu zakończył się sukcesem | katalog tylko do odczytu dla aplikacji |
| **F9** | brak flagi `can_manage_billing` z koncepcji v1.1 | brak funkcji (księgowa jako „pracownik” z dostępem do płatności) | brak funkcji | flaga + `set_billing_flag` (tylko właściciel) |
| **F10** | rola `anon` miała domyślnie dostęp do wszystkiego w schemacie `public` (domyślne uprawnienia Postgresa/Supabase) | **krytyczna zasada:** niezalogowany nie powinien mieć żadnych uprawnień | zapytanie jako `anon` zakończyło się sukcesem | `REVOKE` na tabelach i funkcjach dla `anon`, wyzerowanie domyślnych uprawnień |

Wspólna lekcja: **w Postgresie `EXECUTE` na funkcjach jest domyślnie nadane wszystkim** i **`NULL` w warunku nie jest fałszem**. Dlatego każdy nowy obiekt przechodzi przez listę z `docs/03_ARCHITEKTURA_I_BEZPIECZENSTWO.md`, rozdz. 5.

## 3. Usterki i ryzyka znalezione w trakcie dalszej budowy

| # | Problem | Skąd wiadomo | Naprawa |
|---|---|---|---|
| G1 | **PostgreSQL 17** nadaje rolom aplikacji nowe uprawnienie `MAINTAIN` na tabelach | test macierzy uprawnień zaczerwienił się dopiero na wersji 17 | migracja `0012` (odbiera `MAINTAIN` rolom `anon`/`authenticated`, tylko na PG ≥ 17) |
| G2 | kontrola odczytu faktur **fałszywie alarmowała**: brak numeru na paragonie traktowała jak błąd, a zdjęcie „nie‑dokumentu” kończyło się lawiną błędów i niepotrzebnym, drogim drugim odczytem | tryb próbny zestawu `eval/` (28 dokumentów) | `verifyExtraction`: paragon bez ostrzeżenia `no_number`, `not_a_document` jako jedno ostrzeżenie bez eskalacji (+ testy) |
| G3 | po ponownym uwierzytelnieniu drugie `401` obwiniało token klienta | test synchronizacji KSeF | błąd „świeży token odrzucony” traktowany jako niedostępność, nie wina tokenu |
| G4 | **ignorowany `Retry-After`** po błędzie 429 z KSeF (stałe wycofanie 5 min, ucięte do 30 min) — groziło pukaniem do KSeF za wcześnie i wydłużeniem blokady | przegląd oficjalnych limitów MF z 14.09.2026 (64 pobrania faktur na godzinę, 16/min) | migracja `0013` + odstęp 4 s między pobraniami (poniżej limitu minutowego) |
| G5 | funkcje czytały **tylko** `SUPABASE_SERVICE_ROLE_KEY`, a nowe projekty Supabase używają kluczy `sb_secret_…` w `SUPABASE_SECRET_KEYS` | dokumentacja Supabase (🟡, nie mogłem sprawdzić na żywo) | `_shared/service-key.ts` rozumie oba warianty + `TV_SERVICE_KEY` (7 testów) |
| G6 | stopka planu i asystent AI odsyłały na iOS do płatności poza App Store — **wytyczna Apple 3.1.3** | oficjalny tekst wytycznych (✅) | wariant bez cen i odesłań dla iOS (`PLAN_FOOTER`, `assistantSystemPrompt('ios')`, test) |
| G7 | **brak pomiaru jakości odczytu na prawdziwych fakturach** — poprawka użytkownika nadpisywała odczyt maszynowy, więc nie dało się policzyć błędów | analiza modelu danych | migracja `0014`: migawka `ai_extraction` + `ai_correction_report` (4 testy) |
| G8 | skrypty `fn:typecheck` i `eval:typecheck` używały ścieżki z ukośnikami (`mobile/node_modules/.bin/tsc`), co **w `cmd.exe` Windows się wywala** | przegląd pod kątem Windows | `node mobile/node_modules/typescript/bin/tsc …` |
| G9 | nieudana migracja w teście **zawieszała proces** i zostawiała śmieciową bazę `tv_test_*` | uruchomienie nowego testu z błędem w migracji | `createTestDb` sprząta po sobie przy błędzie |
| G10 | komunikat o „nieaktywnym” tokenie KSeF kazał generować nowy, choć świeży token aktywuje się po chwili | lektura OpenAPI (token ma status *Pending* → *Active*) | komunikat radzi odczekać minutę |
| G12 | pakiety `barcode-detector` i `zxing-wasm` były **zależnościami przechodnimi** (`expo-camera`), a kod skanera w przeglądarce i skrypt `copy-wasm` używały ich bezpośrednio | przegląd importów | zadeklarowane jawnie w `mobile/package.json` (`3.2.2` i `3.1.3`, ta sama wersja co wcześniej) |
| G11 | Supabase CLI nie było zależnością projektu — `npx supabase` pytałoby o instalację przy każdym uruchomieniu i mogło się różnić wersją | przegląd instrukcji dla juniora | `supabase@2.120.0` w `devDependencies` (config sprawdzony tą wersją) |

## 4. Ryzyka, których NIE usunąłem (jawna lista)

| # | Ryzyko | Co zrobić |
|---|---|---|
| R1 | **KSeF na żywo** — zgodność z prawdziwym API MF nie została potwierdzona (symulator oparty o oficjalne OpenAPI/SDK) | `docs/10_KSEF.md`, rozdz. 7 (ścieżka A: produkcja z tokenem tylko do odczytu) |
| R2 | **Jakość AI** — brak liczb z prawdziwych modeli | `npm run eval:run` + `ai_correction_report` na prawdziwych fakturach |
| R3 | **Apple 3.1.3(c)** — plan Start dla jednoosobowej firmy bywa „sprzedażą jednoosobową” | plan B: zakupy w aplikacji (`docs/12_*`, rozdz. 5.4) |
| R4 | **Push na Androidzie** wymaga Firebase (FCM) — nieskonfigurowane | `docs/12_*`, rozdz. 3.5 |
| R5 | **Web Push** (PWA) — niezbudowane | `docs/13_*`, rozdz. 5.2 |
| R6 | **2FA / TOTP / SMS / kody zapasowe / alert nowego urządzenia** z koncepcji — niezbudowane | `docs/01_KOLEJKA_BUDOWY.md` |
| R7 | **Stripe, strona www, panel płatności** — niezbudowane (plan zmienia się dziś ręcznie, funkcją `set_tenant_plan`) | `docs/01_KOLEJKA_BUDOWY.md` |
| R8 | **Tryb offline** (zapisy bez internetu) — niezbudowany; PWA ma tylko szkielet offline | koncepcja 1.5 (PowerSync) |
| R9 | **Brak monitoringu błędów** (Sentry itp.) i brak alertów kosztowych | dodać przed płatnymi klientami |
| R10 | **`npm audit` (aplikacja, zależności produkcyjne): 25 ostrzeżeń — 14 wysokich, 0 krytycznych** (stan 9.10.2026). Prawie wszystkie dotyczą **narzędzi budowania** Expo/Metro (`braces`, `micromatch`, `node-forge` w narzędziach podpisywania, `xcode`, `uuid`), które nie trafiają do aplikacji; jedno dotyczy działania aplikacji: `decode-uri-component` przez `expo-router` (atak DoS przez złośliwy adres) — niskie ryzyko | **nie uruchamiaj `npm audit fix --force`** — proponuje cofnięcie do Expo 44; zamiast tego aktualizuj SDK Expo (`npx expo install --fix`) i sprawdzaj audyt przy każdej aktualizacji |
| R11 | **Ceny i reguły sklepów** z badania (rozdz. 5 w `04_*`) — część 🟡/❓ | sprawdzić przed publikacją |
| R12 | **Wydajność** pod obciążeniem — nie mierzona | test na projekcie Pro z kilkoma firmami |
| R13 | Prawo: szablony `docs/prawne/` nie są opinią prawną | przegląd przez prawnika przed publikacją |

## 5. Co nowego zostało dodane względem paczki (przegląd)

* **Baza:** 12 nowych migracji (`0003…0014`): zabezpieczenia, cykl zgłoszeń, faktury z księgowaniem/storno/aliasami, plany i limity, mini‑spisy, powiadomienia, głosy, limity plików, potok AI, KSeF, zgodność z PG17, pętla zwrotna jakości.
* **Szkielet aplikacji z paczki (`app-src/`, 17 plików: logowanie, rejestracja, jeden ekran firmy, kilka komponentów iOS) został zastąpiony projektem `mobile/` i usunięty z drzewa** — pozostaje w historii Gita (commit `69bd90e`, „Import: Krok 1 — fundament”). Paczkę z `app-src` trzeba było i tak wgrywać w projekt wygenerowany kreatorem Expo (ryzykowny, ręczny krok z dawnej instrukcji); `mobile/` jest kompletnym, sprawdzonym projektem.
* **Aplikacja `mobile/`** (Expo SDK 57; iOS, Android, PWA): logowanie i rejestracja, wybór „zakładam firmę / mam kod”, **styl Instagrama** (stories z zadaniami, feed zgłoszeń z sercem i komentarzami, siatka magazynu, arkusz „＋”), „Zdejmij” w 2 dotknięcia i przez skaner EAN, zgłoszenia ze statusami i czatem, mini‑spisy, faktury (skan, ekran weryfikacji, księgowanie/storno), zespół i zaproszenia kodem, ustawienia (plan, spisy, zlecenia, zgoda na AI, usunięcie konta/firmy), asystent AI, ekran KSeF, ciemny tryb, PWA.
* **Funkcje serwerowe:** `process-document`, `assistant`, `barcode-lookup`, `ksef-connect`, `ksef-sync`, `send-push`, `cron-tasks`.
* **Zestaw ewaluacyjny AI**, **CI**, **dokumentacja** (ten katalog).

## 6. Wyniki końcowego przebiegu weryfikacji

*(uzupełnione po ostatnim uruchomieniu wszystkich sprawdzeń — patrz `docs/06_TESTY_I_JAKOSC.md` z listą poleceń)*

WYNIKI_KONCOWE_PLACEHOLDER
