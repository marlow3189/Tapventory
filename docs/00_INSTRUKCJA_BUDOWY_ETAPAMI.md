# Tapventory — instrukcja krok po kroku (Windows, bez Dockera)

Dla kogo: dla osoby, która dopiero zaczyna z programowaniem. Zakładam komputer z **Windows 10/11**, brak Dockera, brak Android Studio i brak Maca.
Wszystko, co jest tu opisane, da się zrobić **z przeglądarką, terminalem i kontem e‑mail**.

Jak korzystać z tego dokumentu:

* Idź **po kolei**. Każdy etap kończy się polem ✅ **CHECKPOINT** („po czym poznać, że etap zaliczony”). Nie przechodź dalej bez checkpointu.
* `taki tekst w ramce` = **wpisz w terminalu i wciśnij Enter**. **Pogrubienie** = coś do kliknięcia. Gdzie trzeba, jest jedno zdanie wyjaśnienia „po co”.
* Coś nie działa? Najpierw `docs/14_RATOWNIK.md` (tabela „objaw → przyczyna → lek”). Jeśli błędu tam nie ma: skopiuj **cały** komunikat z terminala (nie zdjęcie fragmentu) i wyślij osobie, która Ci pomaga.
* Nazwy przycisków w panelach internetowych (Supabase, Expo, Apple, Google) **zmieniają się** — szukaj słów kluczowych, nie dokładnych etykiet. Tam, gdzie nie mogłem sprawdzić, jest dopisek „(menu może się nazywać inaczej)”.

## Mapa: co budujemy i którą drogą pójść

| Cel | Najszybsza droga | Potrzebujesz | Etap |
|---|---|---|---|
| zobaczyć aplikację działającą u siebie | **przeglądarka** (to jest wersja PWA) | Node, Git, projekt w Supabase | 0–4 |
| AI czyta faktury, KSeF pobiera faktury | funkcje serwerowe w Supabase | klucz Anthropic, klucz szyfrujący | 5 |
| aplikacja „jak na telefonie” bez sklepów | **PWA w internecie** (HTTPS) + „Dodaj do ekranu głównego” | konto hostingu (darmowe) | 6 |
| aplikacja natywna na **Androida** | plik APK zbudowany w chmurze Expo | konto Expo (darmowe) | 7 |
| aplikacja natywna na **iPhone’a** | TestFlight | konto Apple Developer (99 USD/rok) | 8 |
| publikacja w sklepach | listy kontrolne | konta sklepów, strona z polityką prywatności | 9 |

> **Rada:** nie zaczynaj od sklepów. Najpierw etapy 0–4 (całość w przeglądarce), potem 5–6. Android i iPhone to dodatki, które dochodzą, gdy rdzeń działa.

---

## ETAP 0 — Przygotowanie komputera (30–45 min, jednorazowo)

1. **Pokaż rozszerzenia plików.** Eksplorator plików → **Widok** → **Pokaż** → zaznacz **Rozszerzenia nazw plików**. Bez tego nie zauważysz, że `.env` stał się `.env.txt` (najczęstszy błąd początkujących).
2. **Node.js (LTS).** Wejdź na **nodejs.org**, pobierz zielony przycisk **LTS** (obecnie **24**), uruchom instalator, klikaj **Next**. Na ekranie z napisem *Tools for Native Modules* zostaw pole **odznaczone** (to ogromny, niepotrzebny instalator Visual Studio).
3. **Git.** **git-scm.com** → Download for Windows → instalator → wszystkie opcje domyślne (**Next** do końca).
4. **Edytor:** **Visual Studio Code** (code.visualstudio.com) — do czytania i poprawiania plików. Notatnik też wystarczy, ale VS Code podświetla składnię.
5. **Zamknij wszystkie okna terminala** i otwórz nowe — świeżo zainstalowane programy nie są widoczne w starym oknie.
6. Otwórz terminal: **Start** → wpisz `Terminal` (albo `PowerShell`) → Enter. Sprawdź:

   ```powershell
   node --version
   npm --version
   git --version
   ```

   Oczekiwane: `v24.x.x`, `10.x.x` lub `11.x.x`, `git version 2.x`. (Minimum dla projektu: Node 22.18.)
7. **Jeśli PowerShell krzyczy „skrypty są wyłączone / running scripts is disabled”** przy `npm` albo `npx`, wpisz raz:

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```

   i potwierdź `T` / `Y`. (Bezpieczna zmiana, dotyczy tylko Twojego konta.) Alternatywa: używaj zwykłego `cmd` zamiast PowerShella.

> ✅ **CHECKPOINT 0:** trzy polecenia `--version` zwracają numery wersji; Eksplorator pokazuje rozszerzenia plików.

---

## ETAP 1 — Pobranie projektu i instalacja pakietów (15 min)

1. Utwórz **krótką** ścieżkę (długie ścieżki w Windows psują narzędzia JavaScript):

   ```powershell
   mkdir C:\projekty
   cd C:\projekty
   ```
2. Pobierz projekt z GitHuba, od razu na właściwą gałąź (zapyta o zalogowanie do GitHuba — okno przeglądarki → **Authorize**):

   ```powershell
   git clone -b claude/tapventory-completion-6e1k9f https://github.com/marlow3189/Tapventory.git tapventory
   cd tapventory
   ```

   *Dlaczego ta gałąź?* Na niej leży cała praca opisana w tym dokumencie. Gdy ją zatwierdzisz, scalisz ją z główną gałęzią na GitHubie (**Compare & pull request** → **Merge**) — wtedy `git clone` bez `-b` da to samo.
3. Zobacz, co jest w środku: `dir`. Oczekiwane foldery: `docs`, `eval`, `mobile`, `supabase` oraz plik `README.md`.
4. Zainstaluj pakiety **narzędziowe** (testy, Supabase CLI, zestaw ewaluacyjny) — w folderze głównym:

   ```powershell
   npm install
   ```

   (1–2 minuty. Ostrzeżenia `npm warn` są normalne; błędy `npm error` nie.)
5. Zainstaluj pakiety **aplikacji**:

   ```powershell
   cd mobile
   npm install
   ```

   (3–8 minut, pobiera się kilkaset pakietów. Skrypt `postinstall` skopiuje plik skanera kodów `zxing_reader.wasm` — komunikat `[copy-wasm] ... gotowy` jest dobrą wiadomością.)
6. Sprawdź, że kod jest zdrowy — testy aplikacji:

   ```powershell
   npm test
   ```

> ✅ **CHECKPOINT 1:** `npm test` kończy się linijkami w stylu `Tests: 61 passed` (liczba może być nieco inna po kolejnych zmianach), bez `failed`.

---

## ETAP 2 — Konta (20 min + sprawy „w tle”)

Załóż (zwykła rejestracja e‑mailem, wszystko darmowe na start):

1. **GitHub** — masz.
2. **Supabase** — supabase.com → **Sign up** (najwygodniej: **Continue with GitHub**).
3. **Expo** — expo.dev → **Sign up** (potrzebne dopiero w etapach 7–8).

**Uruchom w tle** (dojrzewają tygodniami — dlatego od razu):

4. **D‑U‑N‑S** (numer identyfikacyjny firmy; wymagany do konta Google Play jako organizacja i do konta Apple jako organizacja): **dnb.com/pl-pl** → sprawdź, czy Twoja firma ma numer; jeśli nie — **bezpłatny wniosek**. Odpowiedź: od kilku dni do kilku tygodni.
5. **Apple Developer** (developer.apple.com → **Enroll**, 99 USD/rok) oraz **Google Play Console** (play.google.com/console, 25 USD jednorazowo) — **dopiero gdy dojdziesz do etapów 8–9**; kupowanie ich „na zapas” nie ma sensu.
6. Domena **tapventory.com** — masz. Adresy, które zakładamy: `app.tapventory.com` (aplikacja w przeglądarce), `tapventory.com` (strona z polityką prywatności i regulaminem).

> ✅ **CHECKPOINT 2:** logujesz się na github.com i supabase.com (expo.dev — później); wniosek D‑U‑N‑S złożony lub numer już jest.

---

## ETAP 3 — Baza danych w chmurze (Wariant A, bez Dockera) (30 min)

**Po co:** cała logika i bezpieczeństwo danych mieszka w bazie (reguły RLS). Zamiast stawiać bazę u siebie (to wymaga Dockera), używasz darmowego projektu Supabase w chmurze jako środowiska deweloperskiego.
Wariant z lokalną bazą (Docker) jest opisany w `docs/02_START_LOKALNY.md` — nie jest potrzebny.

### 3A. Utwórz projekt

1. supabase.com → **New project** (jeśli poprosi o organizację — utwórz „Moja firma”).
2. **Name:** `tapventory-dev` • **Database Password:** kliknij **Generate a password** i **zapisz je w menedżerze haseł** (przyda się za chwilę) • **Region:** **Central EU (Frankfurt)** • **Create new project**. Poczekaj 1–2 minuty.
3. Zbierz **dwie wartości publiczne** (menu projektu → **Project Settings** → **API** / **API Keys** — menu może się nazywać inaczej):
   * **Project URL**, np. `https://abcdxyz.supabase.co`,
   * klucz **publiczny**: `anon` (stary format, zaczyna się `eyJ…`) **albo** `publishable` (nowy format, `sb_publishable_…`). Weź ten, który widzisz.
   * Zapisz też **Reference ID** (krótki identyfikator projektu; widać go w adresie panelu i w ustawieniach ogólnych).

   ⚠️ **Nigdy** nie kopiuj klucza `service_role` / `secret` do aplikacji ani na czat. Klucz publiczny jest bezpieczny, bo o dostępie decydują reguły w bazie.

### 3B. Wgraj naszą bazę (migracje)

W terminalu, w **folderze głównym projektu** (`C:\projekty\tapventory`, nie w `mobile`):

```powershell
npx supabase login
npx supabase link --project-ref TU_WKLEJ_REFERENCE_ID
npx supabase db push
```

* `login` otwiera przeglądarkę → **Authorize**.
* `link` pyta o **Database Password** z kroku 3A.2.
* `db push` pokazuje listę migracji do wykonania (`0001_init.sql` … `0014_ai_feedback_snapshot.sql`) → wpisz `Y`. Prawidłowy koniec: brak słowa `ERROR`.
  To polecenie **tworzy całą bazę**: tabele, reguły dostępu, funkcje, magazyn plików na zdjęcia i faktury. Jeśli migracja zgłosi błąd — skopiuj **cały** komunikat i zgłoś; plików już wgranych nie poprawiamy, dodajemy nowe.

### 3C. Ustawienia logowania (Authentication)

W panelu: **Authentication** (menu może się nazywać inaczej — szukaj słów *URL Configuration* / *Sign In / Providers* / *Email*):

1. **Site URL:** `http://localhost:8081` (adres serwera deweloperskiego aplikacji w przeglądarce).
2. **Redirect URLs** — dodaj trzy wpisy (linki z maili wracają do aplikacji):
   * `http://localhost:8081/**`
   * `tapventory://**`
   * `https://app.tapventory.com/**`
3. **Confirm email (potwierdzanie adresu):** na projekcie **deweloperskim** wyłącz — wygoda (konto działa od razu po rejestracji). Na projektach **test** i **prod** zostaw **włączone**.
4. Zapisz (**Save**).

> ✅ **CHECKPOINT 3:** `npx supabase db push` zakończył się bez błędów, a w panelu **Table Editor** widzisz tabele: `tenants`, `memberships`, `products`, `stock_movements`, `requests`, `documents`, `ksef_integrations`…

---

## ETAP 4 — Aplikacja w przeglądarce (PWA) i pierwsze przejście (20 min)

1. W folderze `mobile` utwórz plik ustawień z szablonu:

   ```powershell
   cd C:\projekty\tapventory\mobile
   Copy-Item .env.example .env
   notepad .env
   ```

   W Notatniku ustaw dwie linie (resztę zostaw):

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://TWOJ_PROJEKT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=TU_KLUCZ_PUBLICZNY_ZE_SUPABASE
   ```

   Zapisz (**Ctrl+S**). Plik `.env` jest w `.gitignore` — nie trafi do repozytorium.
   Uwaga: w Notatniku wybierz „Zapisz jako” → **Typ: Wszystkie pliki**, kodowanie **UTF‑8**, jeśli Notatnik próbuje dopisać `.txt`.
2. Uruchom serwer deweloperski w przeglądarce:

   ```powershell
   npm run web
   ```

   Po kilkunastu sekundach otworzy się **http://localhost:8081** (przy pierwszym pytaniu Zapory Windows o dostęp sieci prywatnej — **Zezwól**). Przy pierwszym uruchomieniu budowanie trwa dłużej.
3. Przejdź **pierwszą ścieżkę** (to jest też „Definition of Done”):

   | # | Zrób | Powinieneś zobaczyć |
   |---|---|---|
   | 1 | **Załóż konto** (imię, e‑mail, hasło ≥ 8 znaków) | wejście od razu (Confirm email wyłączone) |
   | 2 | Ekran „Witaj w Tapventory” → **Zakładam firmę** | formularz firmy |
   | 3 | Nazwa np. `Warsztat Test`, NIP zostaw pusty (albo wpisz poprawny), branża → **Utwórz firmę** | ekran **Start**: baner „14 dni pełnej wersji”, pasek *stories* |
   | 4 | Środkowy przycisk **＋** → **Dodaj produkt** → nazwa `Rękawice L`, jednostka `op.`, minimum `2`, stan początkowy `5` | produkt na liście **Magazyn** |
   | 5 | Wejdź w produkt → **Zdejmij** → ilość `4`, powód *Zużycie* | stan `1`, produkt „poniżej minimum” (w Start story **Braki**) |
   | 6 | **＋** → **Zgłoś brak** → wybierz produkt, ilość, notatka | zgłoszenie w feedzie na Start |
   | 7 | Profil → **Zespół** → **Zaproś osobę** (e‑mail + rola) | kod zaproszenia `ABCD-EFGH` do wysłania |
   | 8 | Wyloguj się, załóż **drugie konto**, utwórz **drugą firmę** | pusty Start; **nic** z pierwszej firmy |

   Punkt 8 to dowód działania RLS: dwie firmy w jednej bazie, zero podglądania się nawzajem.
4. Dowód w bazie: panel Supabase → **Table Editor** → `tenants` (Twoje firmy), `memberships` (wiersz z rolą `owner`), `stock_movements` (ruchy: stan początkowy, zdjęcie).

> ✅ **CHECKPOINT 4 = rdzeń działa.** Przeszedłeś punkty 1–8 bez czerwonych komunikatów błędów. Zatrzymaj serwer klawiszami **Ctrl+C**.

**Wygląd (styl Instagrama):** dolny pasek z pięcioma pozycjami (Start, Magazyn, ＋, Aktywność, Profil), pasek *stories* z zadaniami na dziś, karty zgłoszeń jak posty (zdjęcie, serduszko „ja też tego potrzebuję”, komentarze), ciemny tryb zgodnie z systemem. Opis: `docs/07_UI_I_STYL.md`.

---

## ETAP 5 — Funkcje serwerowe: AI czyta faktury, KSeF je pobiera (45 min)

Bez tego etapu aplikacja działa, ale **skanowanie faktur i KSeF nie ruszą** (te funkcje potrzebują tajnych kluczy, których nie wolno trzymać w telefonie).

1. **Klucz do AI.** Załóż konto na **platform.claude.com** → **API keys** → utwórz klucz (`sk-ant-…`). Doładuj kilka dolarów i **ustaw limit wydatków** w panelu. Koszt jednej faktury to grosze (`docs/04_RYNEK_I_TECHNOLOGIE.md`, rozdz. 4.3).
2. **Klucze lokalne.** W folderze głównym:

   ```powershell
   cd C:\projekty\tapventory
   Copy-Item supabase\functions\.env.example supabase\functions\.env
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   notepad supabase\functions\.env
   ```

   W Notatniku wpisz: `ANTHROPIC_API_KEY=` (klucz z pkt 1), `CRON_SECRET=` (pierwszy wygenerowany ciąg), `KSEF_TOKEN_KEY=` (drugi wygenerowany ciąg — **zrób jego kopię w menedżerze haseł**; zgubienie = klienci muszą ponownie połączyć KSeF). Resztę linii zostaw.
3. **Wyślij sekrety i funkcje na serwer** (projekt jest już „podlinkowany” z etapu 3):

   ```powershell
   npx supabase secrets set --env-file supabase/functions/.env
   npx supabase functions deploy --use-api
   ```

   `--use-api` każe pakować funkcje po stronie Supabase (bez Dockera). Jeśli Twoja wersja CLI nie zna tej flagi, usuń ją. Powinno pojawić się siedem funkcji: `process-document`, `assistant`, `barcode-lookup`, `ksef-connect`, `ksef-sync`, `send-push`, `cron-tasks`.
   *(Te polecenia opisałem według dokumentacji CLI — nie mogłem ich wykonać na żywym projekcie; patrz `docs/04_RYNEK_I_TECHNOLOGIE.md`, rozdz. 7.)*
4. **Harmonogram** (bez niego nie działają: strażnik zawieszonych faktur, przypomnienia o spisie, automat KSeF, wysyłka push): panel Supabase → **Integrations → Cron** (menu może się nazywać inaczej) → nowe zadanie typu *Edge Function* wołające `cron-tasks` co minutę, z nagłówkiem `x-cron-secret`. Szczegóły i wariant z GitHub Actions: `supabase/functions/README.md`.
5. **Test faktury:** uruchom `npm run web` (w `mobile`), zaloguj się jako właściciel → **＋** → **Skanuj fakturę** → zgoda na AI → wybierz zdjęcie faktury (albo PDF). Po kilkunastu–kilkudziesięciu sekundach dokument zmienia status na „do sprawdzenia”: żółte pola to ostrzeżenia. Przypisz produkty i **Zaksięguj** — stan magazynu rośnie.
6. **Test KSeF:** Ustawienia → Integracje → **KSeF** — kreator tokenu; pełna procedura i lista kontrolna pierwszego żywego uruchomienia: `docs/10_KSEF.md`.

> ✅ **CHECKPOINT 5:** zeskanowana faktura trafiła na stan magazynu; w tabeli `ai_usage` (Table Editor) widać wiersz z kosztem w `cost_micro_usd`. Pomiar jakości na kilkudziesięciu fakturach: `docs/09_AI_I_OCR.md`.

---

## ETAP 6 — Aplikacja na telefonie jako PWA (najszybciej, bez sklepów) (30 min)

PWA = ta sama aplikacja, otwierana w przeglądarce telefonu i „instalowana” na ekranie głównym. Wymaga **HTTPS** (aparat i powiadomienia nie działają na zwykłym http w sieci domowej).

1. W folderze `mobile` zbuduj wersję produkcyjną (wartości z `.env` zostaną „wpisane” w aplikację — upewnij się, że wskazują na **projekt w chmurze**):

   ```powershell
   cd C:\projekty\tapventory\mobile
   npm run build:web
   ```

   Powstanie folder `dist` (aplikacja + `manifest.webmanifest`, `sw.js`, ikony, `_headers`, `_redirects`).
2. Wystaw `dist` w internecie. Najprościej (bez konta Git i bez konfiguracji): **app.netlify.com/drop** → przeciągnij folder `dist` na okno przeglądarki. Dostajesz adres `https://cos-losowego.netlify.app`.
   Inne hostingi (Cloudflare Pages, Vercel) i podpięcie domeny `app.tapventory.com`: `docs/13_PWA_I_POWIADOMIENIA.md`.
3. Na telefonie otwórz ten adres:
   * **Android (Chrome):** menu ⋮ → **Zainstaluj aplikację** / **Dodaj do ekranu głównego**.
   * **iPhone (Safari):** przycisk **Udostępnij** → **Do ekranu początkowego** (musi być Safari; powiadomienia push wymagają iOS 16.4+ i zainstalowanej aplikacji).
4. W Supabase dopisz ten adres do **Redirect URLs** (etap 3C), żeby linki z maili wracały na właściwą stronę.

> ✅ **CHECKPOINT 6:** aplikacja otwiera się z ikony na ekranie głównym telefonu i pozwala się zalogować; skaner kodu kreskowego prosi o dostęp do aparatu.

---

## ETAP 7 — Android: plik APK z chmury Expo (45–90 min, głównie czekanie)

Nie potrzebujesz Android Studio ani emulatora: Expo zbuduje aplikację na swoich serwerach.

1. W folderze `mobile` zainstaluj narzędzie i zaloguj się:

   ```powershell
   npm install --global eas-cli
   eas login
   eas init
   ```

   `eas init` wypisze **Project ID** (UUID). Otwórz `mobile\app.config.ts`, znajdź linię `eas: { projectId: process.env.EAS_PROJECT_ID }` i zamień `process.env.EAS_PROJECT_ID` na ten identyfikator w apostrofach (identyfikator nie jest tajny).
2. Uzupełnij `mobile\eas.json`: w profilu **preview** zamień `WKLEJ_URL_PROJEKTU_TEST` i `WKLEJ_KLUCZ_ANON_TEST` na wartości **projektu testowego** (utwórz drugi projekt Supabase `tapventory-test` i wgraj mu bazę jak w etapie 3 — albo na początek użyj wartości projektu deweloperskiego).
3. Zbuduj:

   ```powershell
   eas build --profile preview --platform android
   ```

   * Pytanie o *keystore* (podpis aplikacji) → **Generate new keystore** (Enter). **Keystore jest nie do odzyskania, jeśli go zgubisz** — Expo przechowuje go dla Ciebie; nie usuwaj projektu EAS.
   * Kolejka w planie darmowym bywa długa; postęp widać też na expo.dev po zalogowaniu.
4. Po zakończeniu terminal poda **link** (i kod QR). Otwórz go na telefonie z Androidem → pobierz **APK** → **Zainstaluj** (zgódź się na instalację z nieznanych źródeł dla przeglądarki). Pojawi się **Tapventory (Test)**.
5. Dla produkcji (Google Play) buduje się **paczkę AAB**: `eas build --profile production --platform android`. Wymagania sklepu: `docs/12_BUDOWANIE_I_PUBLIKACJA.md`.

> ✅ **CHECKPOINT 7:** na Androidzie działa **Tapventory (Test)** i pozwala się zalogować (mail z potwierdzeniem przychodzi na prawdziwą skrzynkę, jeśli „Confirm email” jest włączone).

---

## ETAP 8 — iPhone: TestFlight (po założeniu konta Apple Developer)

Bez konta Apple Developer (99 USD/rok) nie zainstalujesz natywnej aplikacji na cudzym iPhonie — do tego czasu używaj PWA (etap 6).

1. Załóż konto: developer.apple.com → **Enroll** (organizacja wymaga D‑U‑N‑S; zatwierdzanie trwa od kilku dni).
2. W **App Store Connect** (appstoreconnect.apple.com) → **Moje aplikacje** → **＋ Nowa aplikacja** → nazwa **Tapventory**, język polski, identyfikator pakietu **`com.tapventory.app`**, SKU dowolny. To też **rezerwuje nazwę** (Apple wymaga, by była unikalna).
3. Zbuduj i wyślij do TestFlight:

   ```powershell
   eas build --profile production --platform ios
   eas submit --platform ios --latest
   ```

   EAS zapyta o dane konta Apple i sam zadba o certyfikaty (zaloguj się swoim Apple ID; włączone dwuskładnikowe uwierzytelnianie jest wymagane).
4. W App Store Connect → **TestFlight** → dodaj testerów (e‑mail) → dostają zaproszenie i instalują aplikację TestFlight.

Pełna lista (opisy ekranów, wymagane zrzuty, formularze prywatności, uwaga o płatnościach 3.1.3): `docs/12_BUDOWANIE_I_PUBLIKACJA.md`. Cały proces jest **niesprawdzony na żywo** (nie miałem dostępu do kont Apple/Expo).

> ✅ **CHECKPOINT 8:** tester instaluje aplikację z TestFlight i loguje się.

---

## ETAP 9 — Publikacja w sklepach (tygodnie; zaczyna się wcześniej, niż myślisz)

Lista kontrolna jest w `docs/12_BUDOWANIE_I_PUBLIKACJA.md`. Najważniejsze długie wątki, które możesz uruchomić już dziś:

* D‑U‑N‑S (etap 2), konto Google Play jako organizacja,
* strona `tapventory.com` z polityką prywatności, regulaminem i stroną „Usuń konto” (szablony: `docs/prawne/`) — sklepy wymagają adresów URL,
* test zamknięty Androida (dla niektórych typów kont: 12 testerów przez 14 dni) — zacznij zbierać testerów wcześnie.

---

## Codzienny rytm pracy (ściąga)

```
rano:         cd C:\projekty\tapventory\mobile  →  npm run web
zmiana bazy:  NOWY plik w supabase\migrations\00NN_nazwa.sql  →  npx supabase db push
zmiana funkcji: npx supabase functions deploy --use-api
przed commitem: npm test (w mobile)  oraz  npm run fn:test (w głównym folderze)
koniec dnia:  git add -A  →  git commit -m "opis"  →  git push
```

**Żelazna zasada:** migracja raz wgrana na jakikolwiek wspólny projekt jest **nietykalna** — poprawka to zawsze **nowy** plik z kolejnym numerem.
Reguły pracy i testów: `docs/06_TESTY_I_JAKOSC.md`. Architektura i bezpieczeństwo: `docs/03_ARCHITEKTURA_I_BEZPIECZENSTWO.md`.

---

## Pięć najczęstszych kłopotów (reszta w `docs/14_RATOWNIK.md`)

| Objaw | Przyczyna | Lek |
|---|---|---|
| `npx` / `npm` → „skrypty są wyłączone” | polityka PowerShella | Etap 0, pkt 7 |
| aplikacja pokazuje „Brak konfiguracji Supabase” | brak `.env` albo `.env.txt` | Etap 4, pkt 1; zrestartuj `npm run web` |
| rejestracja prosi o potwierdzenie maila, którego nie ma | „Confirm email” włączone na projekcie dev | Etap 3C, pkt 3 |
| `db push` odrzuca hasło | inne hasło niż przy tworzeniu projektu | panel → Project Settings → Database → **Reset database password** |
| telefon nie łączy się z `localhost` | `localhost` na telefonie to telefon | używaj PWA z HTTPS (etap 6) albo `docs/02_START_LOKALNY.md` |

---

*Dalsze lektury:* `docs/01_KOLEJKA_BUDOWY.md` (co zrobione, co dalej), `docs/Tapventory_dokument_koncepcyjny_v1.md` (koncepcja produktu, wersja 1.2).
