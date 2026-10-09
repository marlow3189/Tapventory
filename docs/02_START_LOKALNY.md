# 02 — Środowiska: lokalnie, w chmurze, test i produkcja

Ten dokument tłumaczy **gdzie** działa baza i funkcje (na Twoim komputerze czy na supabase.com), jak przełączać aplikację między środowiskami i jak naprawić „telefon nie widzi bazy”.
Kolejność prac krok po kroku jest w `docs/00_INSTRUKCJA_BUDOWY_ETAPAMI.md`; tu jest tło i rozwiązywanie problemów.

## 1. Lokalnie vs serwer (najważniejsza tabela)

| | **Chmura (zalecane na start)** | **Lokalnie (Docker)** |
|---|---|---|
| Co to | projekt `tapventory-dev` na supabase.com | komplet usług Supabase w kontenerach na Twoim komputerze |
| Docker | **niepotrzebny** | **wymagany** (Docker Desktop + WSL2) |
| Baza budujesz poleceniem | `npx supabase db push` (dokłada nowe migracje) | `npx supabase db reset` (kasuje i buduje od zera + dane z `seed.sql`) |
| Skrzynka maili | prawdziwa poczta (albo wyłącz „Confirm email”) | wbudowana skrzynka testowa pod `http://127.0.0.1:54324` — nic nie wychodzi do internetu |
| Funkcje (AI, KSeF) | `functions deploy` + sekrety w panelu/CLI | `functions serve` (wymaga Dockera) |
| Panel bazy (Studio) | supabase.com → Table Editor | `http://127.0.0.1:54323` |
| Reset do zera | usunięcie projektu i założenie nowego (2 min) albo ręczne czyszczenie | `db reset` (kilkanaście sekund) |
| Internet | wymagany | wymagany tylko do pierwszego pobrania obrazów |
| Koszt | 0 zł (limity w rozdz. 2) | 0 zł |
| Kiedy wybrać | zawsze, gdy nie masz Dockera albo nie chcesz się z nim męczyć | gdy często robisz „resety” bazy albo pracujesz bez internetu |

Ustawienia logowania (Site URL, Redirect URLs, „Confirm email”) w chmurze zmieniasz **w panelu**; lokalnie czyta je plik `supabase/config.toml` (sekcja `[auth]`) — dlatego wartości w obu miejscach mają być spójne.

## 2. Projekt w chmurze: limity i pułapki (plan Free) 🟡

* Plan Free pozwala na **2 aktywne projekty** i **pauzuje projekt po 7 dniach bez aktywności** (wznowienie jednym kliknięciem w panelu). Dla deweloperskiego `tapventory-dev` to nie problem; dla produkcji **użyj planu Pro** (bez pauzowania, kopie zapasowe).
* Plan Free nie daje kopii zapasowych w panelu; **PITR** (przywracanie do wybranej sekundy) to płatny dodatek do Pro i wymaga obliczeń co najmniej „Small”.
* Źródła i stopień pewności tych faktów: `docs/04_RYNEK_I_TECHNOLOGIE.md`, rozdz. 6. Ceny sprawdź w panelu.

## 3. Wariant B: lokalny Supabase przez Docker (Windows)

> Na komputerze służbowym, gdzie Docker jest zabroniony, **nie buduj** własnego projektu — używaj wariantu z chmurą na komputerze prywatnym.

1. **Docker Desktop** (docker.com) → instalator → zgódź się na WSL 2 → restart → uruchom program i poczekaj, aż ikona wieloryba przestanie „się ładować”. Sprawdź: `docker --version`.
   Docker Desktop bywa płatny dla większych firm — dla jednoosobowej działalności zwykle jest bezpłatny; sprawdź aktualną licencję na stronie Dockera. Zamiast niego CLI Supabase współpracuje też z innymi środowiskami zgodnymi z Dockerem (np. Podman, Rancher Desktop) — niesprawdzone przeze mnie.
2. W folderze głównym projektu (`C:\projekty\tapventory`):

   ```powershell
   npx supabase start
   ```

   Pierwszy raz pobiera obrazy: **5–15 minut**. Na końcu wypisuje tabelkę adresów i kluczy. Zapamiętaj:
   * **API URL** → `http://127.0.0.1:54321`
   * klucz publiczny (**anon key** albo **Publishable key**) — długi ciąg znaków.
   Zgubisz? `npx supabase status` wypisze je ponownie.
3. Zbuduj bazę z naszych plików i dosyp dane przykładowe:

   ```powershell
   npx supabase db reset
   ```

   Prawidłowy przebieg wymienia kolejno migracje `0001_init.sql` … `0015_audit_without_snapshot.sql`, potem `Seeding data from supabase/seed.sql…` i `Finished supabase db reset` — bez słowa `ERROR`.
4. Obejrzyj bazę: **http://127.0.0.1:54323** (Studio) → **Table Editor**.
5. W `mobile\.env` ustaw adres i klucz lokalne (rozdz. 5), uruchom `npm run web`, przejdź ścieżkę z etapu 4 instrukcji.
6. Zatrzymanie: `npx supabase stop`. „Port is already allocated” → poprzednia sesja nie zeszła: `npx supabase stop`, odczekaj chwilę, `npx supabase start`.

Plik konfiguracyjny `supabase/config.toml` jest napisany ręcznie i sprawdzony parserem CLI 2.120 (`npx supabase status` bez Dockera kończy się błędem o Dockerze, a nie o konfiguracji — to dobry znak).
Gdy po aktualizacji CLI zobaczysz „failed to read config”: przenieś plik w bok, uruchom `npx supabase init` (świeży szablon) i przepisz `project_id`, sekcję `[auth]`, `[db.seed]` i `[functions.*]`.
Dane seed (`supabase/seed.sql`) to tylko kilka pozycji katalogu produktów z marką DEMO; konta i firmy zakładasz w aplikacji. **Seed nigdy nie jedzie na test/prod.**

## 4. Lokalne funkcje (opcjonalnie)

```powershell
Copy-Item supabase\functions\.env.example supabase\functions\.env     # uzupełnij klucze
npx supabase functions serve --env-file supabase/functions/.env
```

Funkcje są wtedy pod `http://127.0.0.1:54321/functions/v1/<nazwa>`; aplikacja woła je sama przez `supabase.functions.invoke`. Logi widać w tym samym terminalu.
Wymaga Dockera. Bez Dockera testuj funkcje wdrożeniem na projekt dev (rozdz. 7) i **testami automatycznymi** (`npm run fn:test`).

## 5. Plik `mobile\.env` — adres bazy zależy od tego, skąd patrzysz

`localhost` / `127.0.0.1` oznacza „to samo urządzenie, na którym działa aplikacja”. Dlatego:

| Skąd uruchamiasz aplikację | `EXPO_PUBLIC_SUPABASE_URL` |
|---|---|
| przeglądarka na tym samym komputerze (PWA) | `http://127.0.0.1:54321` (lokalnie) albo `https://xxxx.supabase.co` (chmura) |
| symulator iOS (Mac) | `http://127.0.0.1:54321` |
| emulator Androida | `http://10.0.2.2:54321` (tak emulator widzi komputer) |
| **prawdziwy telefon** w tej samej sieci Wi‑Fi | `http://<IP-komputera>:54321`, np. `http://192.168.1.20:54321` |
| projekt w chmurze (dowolne urządzenie) | `https://xxxx.supabase.co` — **najprostsze** |

IP komputera: `ipconfig` → pozycja **Adres IPv4** (sieć Wi‑Fi). Po każdej zmianie `.env` zatrzymaj serwer (**Ctrl+C**) i uruchom ponownie `npm run web -- --clear` (czyści pamięć podręczną).

**Dlaczego prawdziwy telefon z siecią lokalną bywa kłopotliwy:**

* Zapora Windows musi pozwolić na ruch do portów 54321 (i 8081 dla Expo). Przy pytaniu systemu — **Zezwól** w sieci prywatnej.
* Telefon i komputer **w tej samej sieci** (nie „gość”, nie VPN).
* Aparat i powiadomienia w przeglądarce telefonu wymagają **HTTPS**; po zwykłym `http://192.168…` przeglądarka ich nie udostępni. Dla telefonu użyj wdrożonej PWA (etap 6 instrukcji).
* Wersje „produkcyjne” aplikacji na Androidzie blokują nieszyfrowane połączenia `http://` — dla lokalnego Supabase służy wersja deweloperska/PWA, nie APK ze sklepu.

Zmienne `EXPO_PUBLIC_…` są **wklejane do aplikacji przy budowaniu**, więc zmiana `.env` wymaga ponownego uruchomienia serwera (a przy PWA i APK — nowego budowania).

## 6. Testy bazy na własnym Postgresie

`npm run db:test` potrzebuje działającego PostgreSQL (z rozszerzeniami standardowymi — `pg_trgm`) i uprawnień superużytkownika; każdy plik testowy tworzy własną, tymczasową bazę `tv_test_…` i usuwa ją na koniec.
Trzy drogi:

1. **GitHub Actions (bez instalowania czegokolwiek):** wypchnij gałąź na GitHub → zakładka **Actions** → zielony krzyżyk przy zadaniu „Baza” = wszystkie testy bazy (118 w chwili pisania) przeszły na PostgreSQL 17.
2. **Lokalny Supabase** (rozdz. 3): domyślny adres testów to właśnie jego baza (`postgres://postgres:postgres@127.0.0.1:54322/postgres`), więc wystarczy `npm run db:test`.
3. **PostgreSQL zainstalowany w Windows** (instalator od EDB, wersja 16 lub 17; zapamiętaj hasło użytkownika `postgres`):

   ```powershell
   $env:TEST_DATABASE_URL = "postgres://postgres:TWOJE_HASLO@127.0.0.1:5432/postgres"
   npm run db:test
   ```

   (W `cmd`: `set TEST_DATABASE_URL=postgres://postgres:TWOJE_HASLO@127.0.0.1:5432/postgres`.)

Więcej o testach: `docs/06_TESTY_I_JAKOSC.md`.

## 7. Wdrożenie funkcji

Funkcje (`supabase/functions/*`) wdrażasz na projekt w chmurze po każdej zmianie ich kodu. Kolejność jest ważna:

1. **Migracje najpierw:** `npx supabase db push` (funkcje wołają funkcje bazy; nowa wersja funkcji bez nowej migracji da błędy).
2. **Sekrety** (raz i po każdej zmianie): `npx supabase secrets set --env-file supabase/functions/.env`. Lista i objaśnienia: `supabase/functions/.env.example`. Klucz serwisowy Supabase funkcje dostają same (rozdz. „Klucz serwisowy” w `supabase/functions/README.md`).
3. **Wdrożenie:** `npx supabase functions deploy --use-api` (`--use-api`: pakowanie po stronie Supabase, bez Dockera; jeśli CLI nie zna flagi — pomiń ją).
   Ustawienia `verify_jwt = false` są w `config.toml` — zamiast bramki Supabase każda funkcja sama sprawdza sesję (`auth.getUser`) i odrzuca żądanie bez ważnego logowania (kod 401). Powód: nowe projekty używają asymetrycznych kluczy JWT.
4. **Harmonogram** wołający `cron-tasks` co minutę (panel Supabase albo GitHub Actions) — instrukcja w `supabase/functions/README.md`.
5. **Sprawdzenie:** panel → **Edge Functions** → lista siedmiu funkcji ze statusem *Active*; w aplikacji: skan faktury, asystent (Profil → Asystent AI albo ikona ✨ na ekranie Start), Ustawienia → KSeF.
6. **Logi:** panel → Edge Functions → wybrana funkcja → **Logs**. Logi zawierają kody i identyfikatory, **nie** treść faktur ani tokeny.

*Uwaga:* polecenia CLI w tym dokumencie zapisałem według dokumentacji; **nie wykonałem ich na żywym projekcie** (brak dostępu).

## 8. Trzy środowiska: dev → test → prod

| | **dev** | **test** | **prod** |
|---|---|---|---|
| Po co | praca codzienna | testerzy, sprawdzenie przed wydaniem | prawdziwi klienci |
| Supabase | `tapventory-dev` (Free) | `tapventory-test` (Free) | `tapventory-prod` (**Pro**, region Frankfurt, PITR przed startem komercyjnym) |
| Aplikacja | PWA lokalnie / `Tapventory (Dev)` | `Tapventory (Test)` (profil `preview`) | `Tapventory` (profil `production`) |
| Identyfikator paczki | `com.tapventory.app.dev` | `com.tapventory.app.staging` | `com.tapventory.app` |
| „Confirm email” | wyłączone | **włączone** | **włączone** |
| Seed | tak (lokalnie) | nie | nie |
| Klucze AI/KSeF | wymyślone/testowe, niski limit wydatków | testowe | produkcyjne, **inny** `KSEF_TOKEN_KEY` niż w dev i test |

Zasady:

* Identyfikatory paczki (`bundleIdentifier`/`package`) po pierwszej publikacji w sklepie są **niezmienialne**; trzy warianty różnią się końcówką (`app.config.ts`, zmienna `APP_ENV` z `eas.json`), więc mogą stać na jednym telefonie.
* Migracje wgrywasz do każdego projektu tym samym poleceniem `db push` po wskazaniu go przez `npx supabase link --project-ref …` (przełączanie między projektami = kolejny `link`).
* Każdy projekt ma **własne** sekrety funkcji (`secrets set` po `link`). Nie używaj tego samego `KSEF_TOKEN_KEY` w dev i prod.
* Przed pierwszym klientem na PROD: plan Pro, PITR, „Confirm email” włączone, limity wydatków u dostawcy AI, kopie kluczy w menedżerze haseł, test odtwarzania kopii.
* **Własny serwer poczty (SMTP)** dla test i prod (np. Resend lub Postmark; panel Authentication → SMTP): domyślny serwer Supabase jest tylko do prób, ma niskie limity wysyłki i bywa ograniczony do adresów członków zespołu 🟡 — bez własnego SMTP zaproszeni testerzy mogą nie dostać maila z potwierdzeniem.

## 9. Ręczne operacje administracyjne (do czasu płatności i panelu na www)

Plan firmy zmienia dziś administrator ręcznie. Panel Supabase → **SQL Editor** (działasz jako administrator projektu), wklej i kliknij **Run**:

```sql
-- 1) znajdź firmę
select id, name, plan, trial_ends_at, created_at from public.tenants order by created_at desc;

-- 2) zmień plan (solo | start | team) — wstaw prawdziwy identyfikator w miejsce UUID_FIRMY
select public.set_tenant_plan('UUID_FIRMY', 'start');

-- 3) przedłuż okres próbny o 14 dni (w próbie obowiązują limity planu Zespół)
select public.set_tenant_plan('UUID_FIRMY', (select plan from public.tenants where id = 'UUID_FIRMY'), now() + interval '14 days');

-- 4) ile skanów AI zużyła firma w tym miesiącu
select count(*) as skany from public.ai_usage where tenant_id = 'UUID_FIRMY' and kind = 'document' and created_at >= date_trunc('month', now());
```

Funkcje `set_tenant_plan` i spółka są **dostępne tylko dla administratora i backendu** — aplikacja (zalogowany użytkownik) nie ma do nich dostępu (test `01_invariants`). Nie edytuj tabel ręcznie przez „Table Editor”, jeśli istnieje funkcja robiąca to samo — funkcje pilnują spójności.
