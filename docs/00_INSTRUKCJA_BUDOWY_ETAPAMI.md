# Tapventory — instrukcja budowy, etap po etapie

Jak korzystać z tego dokumentu:

* Wykonuj etapy **po kolei** — każdy kończy się polem ✅ **CHECKPOINT**
  (po czym poznać, że etap zaliczony). Nie przechodź dalej bez checkpointu.
* Niczego nie musisz rozumieć na zapas. Gdzie trzeba, jest jedno zdanie
  wyjaśnienia w nawiasie — reszta to konkret: co kliknąć, co wpisać.
* Coś poszło nie tak? Zajrzyj do **Ratownika** na końcu, a jeśli błędu tam
  nie ma — skopiuj **cały** komunikat z terminala i wyślij mi w rozmowie.

Legenda: `taki tekst` = wpisz w terminalu i wciśnij Enter •
**pogrubienie** = przycisk/opcja do kliknięcia • 📁 = pliki z paczki
używane w tym etapie.

---

## ETAP 0 — Paczka staje się projektem (5 minut)

📁 używasz: całej paczki `tapventory_krok1_fundament.zip`

1. Pobrany plik `tapventory_krok1_fundament.zip` znajdziesz w **Pobrane**.
2. Wypakuj go:
   * Windows: prawy klik na pliku → **Wyodrębnij wszystkie…** → **Wyodrębnij**;
   * macOS: podwójny klik.
   Powstanie folder `tapventory`.
3. Przenieś cały folder `tapventory` w docelowe miejsce na projekty:
   * Windows: np. `C:\projekty\tapventory`
   * macOS: np. `~/projekty/tapventory`
   Ten folder to od teraz **folder projektu**. Paczka *jest* projektem —
   niczego nie tworzymy obok, będziemy tylko do niej dokładać.
4. Naucz się otwierać **terminal w folderze projektu** (będziesz to robić
   codziennie):
   * Windows 11: otwórz folder w Eksploratorze → prawy klik na pustym
     obszarze → **Otwórz w terminalu**;
   * Windows 10: kliknij pasek adresu Eksploratora, wpisz `cmd`, Enter;
   * macOS: Finder → prawy klik na folderze → **Nowy Terminal w folderze**
     (jeśli nie widzisz tej opcji: Ustawienia systemowe → Klawiatura →
     Skróty klawiszowe → Usługi → włącz „Nowy Terminal w folderze").
5. Sprawdzenie: w otwartym terminalu wpisz `dir` (Windows) lub `ls` (macOS).

> ✅ **CHECKPOINT 0:** terminal wypisuje zawartość folderu i widzisz na
> liście: `app-src`, `docs`, `supabase`, `README.md`.

---

## ETAP 1 — Narzędzia na komputerze (30–60 minut, jednorazowo)

📁 używasz: niczego z paczki — same instalacje.

| # | Narzędzie | Skąd | Jak zainstalować | Jak sprawdzić |
|---|---|---|---|---|
| 1 | Node.js **LTS** | nodejs.org | zielony przycisk **LTS**, instalator z domyślnymi opcjami (Next → Next); ekran **„Tools for Native Modules"** zostaw ODZNACZONY — to opcjonalne narzędzia C++, które potrafią uruchomić ogromny instalator Visual Studio, a nam są zbędne | `node --version` → np. `v22…` |
| 2 | Git | git-scm.com | **Download**, wszystkie opcje domyślne | `git --version` |
| 3 | Docker Desktop | docker.com | **Download Docker Desktop** → zainstaluj → **uruchom program** i poczekaj, aż ikona wieloryba przestanie się „ładować". Windows może poprosić o WSL2 — zgódź się, dokończ, zrestartuj komputer | `docker --version` |
| 4 | Supabase CLI | — (przez npm; masz już Node) | teraz NIC nie instalujesz — zrobisz to jednym poleceniem w **Etapie 3 pkt 3**. Strona z dokumentacją Supabase nie wymaga logowania i niczego z niej nie kopiujesz | `npx supabase --version` (po Etapie 3 pkt 3) |
| 5 | GitHub Desktop | desktop.github.com | **Download** → zainstaluj (użyjemy w Etapie 6 — Git bez terminala) | uruchamia się |

Po **każdej** instalacji zamknij terminal i otwórz nowy — świeżo
zainstalowane programy nie są widoczne w starym oknie.

> ✅ **CHECKPOINT 1:** cztery polecenia `--version` (node, git, docker,
> supabase) zwracają numery wersji, żadne nie mówi „nie rozpoznano".

---

## ETAP 2 — Konta i zaklepanie nazwy (20 minut + sprawy „w tle")

📁 używasz: niczego z paczki.

**Załóż teraz** (zwykła rejestracja e-mailem, darmowe):

1. **GitHub** — github.com (kopia kodu w chmurze),
2. **Supabase** — supabase.com (najwygodniej: przycisk **Continue with GitHub**),
3. **Expo** — expo.dev (budowanie aplikacji w chmurze).

**Uruchom w tle** (dojrzewają tygodniami — dlatego już dziś):

4. **D-U-N-S** (numer identyfikacyjny firmy, wymagany do konta Google Play
   jako organizacja): wejdź na **dnb.com/pl-pl** → wyszukiwarka D-U-N-S →
   sprawdź, czy Twoja firma już ma numer → jeśli nie, wypełnij **bezpłatny
   wniosek**. Odpowiedź: od kilku dni do kilku tygodni.
5. **Apple Developer** — developer.apple.com → **Enroll** (99 USD/rok,
   płatne przy publikacji na iPhone'y).
6. **Google Play Console** — play.google.com/console → konto **organizacji**
   (25 USD jednorazowo; w formularzu poda się D-U-N-S z pkt 4).

**Zaklep nazwę** (15 minut, ważniejsze niż wygląda — identyfikatory paczki
po pierwszej publikacji są niezmienialne na zawsze):

7. ✔ **Domena: masz już `tapventory.com`** — to wystarcza; identyfikatory
   aplikacji (`com.tapventory.app`) są z nią zgodne. Opcjonalnie, kiedyś:
   jeśli `tapventory.pl` będzie wolna i tania, warto ją dokupić dla
   polskich klientów i ustawić przekierowanie na `.com` — ale to dodatek,
   nie warunek.
8. **Sprawdź, czy nazwa „Tapventory" jest wolna w sklepach** (5 minut,
   stan na dziś: sprawdzone — wolna; powtórz sam tuż przed publikacją):
   * **Google Play:** na telefonie z Androidem otwórz **Sklep Play** →
     lupka → wpisz `Tapventory` → przejrzyj wyniki. Bez telefonu:
     w przeglądarce wejdź na `play.google.com` → pole wyszukiwania →
     `Tapventory` → zakładka **Aplikacje**. Szukasz aplikacji o dokładnie
     tej nazwie. Ważne: Google **nie blokuje** powtarzających się nazw —
     unikalny musi być tylko identyfikator paczki (nasz
     `com.tapventory.app` będzie unikalny automatycznie), więc tu chodzi
     o to, żeby klient nie mylił nas z kimś innym.
   * **App Store:** na iPhonie otwórz **App Store** → **Szukaj** →
     `Tapventory`. Bez iPhone'a: w Google wpisz `tapventory app store` —
     karty aplikacji z App Store wyświetlają się w wynikach.
   * **Różnica, którą warto znać:** Apple — w przeciwieństwie do Google —
     **wymaga unikalnej nazwy** aplikacji. Ostateczny, twardy test odbywa
     się w momencie rezerwacji: po aktywacji konta Apple Developer
     wchodzimy w **App Store Connect → Moje aplikacje → ＋ → Nowa
     aplikacja**, wpisujemy nazwę `Tapventory` — jeśli ktoś ją zajął,
     formularz od razu odmówi. Dlatego tę rezerwację zrobimy **od razu**
     po założeniu konta Apple (Etap sklepów), nie czekając na gotową
     aplikację — rezerwacja nic nie kosztuje ponad opłacone konto.

> ✅ **CHECKPOINT 2:** logujesz się na github.com, supabase.com i expo.dev;
> domena `tapventory.com` kupiona ✔; wniosek D-U-N-S wysłany (lub numer
> już jest); wiesz, jak sprawdzić nazwę w sklepach (pkt 8).

---

## ETAP 3 — Backend na Twoim komputerze (30 minut)

📁 używasz: `supabase/migrations/0001_init.sql`,
`supabase/migrations/0002_rls.sql`, `supabase/seed.sql` — **już są na
swoich miejscach w paczce**, niczego nie kopiujesz. Dołożymy tylko
narzędzie CLI i brakujący plik konfiguracyjny.

⚠️ Ten etap wymaga Dockera. Komputer, na którym Docker jest zabroniony
lub niemożliwy (np. służbowy)? Przeskocz do ramki **WARIANT B** na końcu
etapu. (Na komputerze służbowym w ogóle nie buduj własnego projektu —
polityki IT i umowy o pracę to nie miejsce na Twój produkt.)

1. Upewnij się, że **Docker Desktop jest uruchomiony** (ikona wieloryba
   spokojna, bez kręcącego się paska).
2. Otwórz terminal **w folderze projektu** (Etap 0, pkt 4).
3. **Instalacja Supabase CLI** (jednorazowo, przez npm — masz już Node):

   ```
   npm init -y
   npm install supabase --save-dev
   ```

   * w folderze projektu pojawią się `package.json`, `package-lock.json`
     i `node_modules` — to normalne (narzędzie mieszka w projekcie);
   * **od teraz żelazna zasada:** każde polecenie `supabase …` z tej
     instrukcji wpisujesz jako `npx supabase …` (`npx` = „uruchom
     narzędzie zainstalowane w tym projekcie");
   * uwaga: `npm install -g supabase` (globalnie) celowo NIE działa —
     twórcy to zablokowali, więc nie próbuj tej drogi;
   * sprawdzenie: `npx supabase --version` → numer wersji.
4. `npx supabase init`
   * jeśli zapyta o generowanie ustawień do VS Code / IntelliJ — wpisz `n`, Enter;
   * efekt: w folderze `supabase` przybędzie plik `config.toml` **obok**
     naszych migracji (gdyby napisał, że config już istnieje — jeszcze
     lepiej, idź dalej).
5. `npx supabase start`
   * pierwszy raz pobiera obrazy — spokojnie **5–15 minut**;
   * na końcu wypisze tabelkę adresów i kluczy.
6. Z tej tabelki zapisz w notatniku dwie rzeczy (przydadzą się w Etapie 4):
   * `API URL` → `http://127.0.0.1:54321`
   * `anon key` → bardzo długi ciąg znaków.
   Zgubisz — nic straconego: `npx supabase status` wypisze je ponownie.
7. **Najważniejsze polecenie tego etapu:** `npx supabase db reset`
   (buduje bazę od zera z plików w `supabase/migrations` + dosypuje
   `seed.sql`). Prawidłowy przebieg kończą linie w stylu:

   ```
   Applying migration 0001_init.sql...
   Applying migration 0002_rls.sql...
   Seeding data from supabase/seed.sql...
   Finished supabase db reset
   ```

   Bez ani jednego słowa `ERROR`.
8. Obejrzyj bazę na własne oczy: przeglądarka →
   **http://127.0.0.1:54323** (to „Studio" — panel bazy) → menu
   **Table Editor** → na liście są m.in. `tenants`, `memberships`,
   `products`, `stock_movements`, `requests`.

> ✅ **CHECKPOINT 3:** `npx supabase db reset` kończy się czysto, a Studio
> pokazuje tabele. Jeśli w kroku 7 wyskoczył `ERROR` — skopiuj cały
> komunikat i wyślij mi: poprawiam plik migracji, Ty uruchamiasz
> `db reset` ponownie. To normalna pętla pracy, nie katastrofa.

---

### 🅱️ WARIANT B — Etap 3 bez Dockera (plan awaryjny)

Zamiast bazy lokalnej używasz **darmowego projektu w chmurze** jako
środowiska deweloperskiego. Działa, bo `db push` łączy się bezpośrednio
z bazą w chmurze — Docker nie jest do tego potrzebny. Wykonaj pkt 2–3
z Wariantu A (terminal + instalacja CLI), a potem:

1. supabase.com → zaloguj się → **New project** → Name: `tapventory-dev`
   → **Generate a password** (zapisz w menedżerze haseł) → Region:
   **Central EU (Frankfurt)** → **Create new project**.
2. **Project Settings → General** → skopiuj `Reference ID`.
3. W terminalu projektu:
   `npx supabase login` (otworzy przeglądarkę → **Authorize**),
   `npx supabase link --project-ref TWOJ_REFERENCE_ID` (poda hasło z pkt 1),
   `npx supabase db push` → lista migracji → `y`.
   To polecenie **zastępuje `db reset`** — jeśli w migracji jest błąd,
   pokaże się właśnie tutaj (skopiuj całość i wyślij mi).
4. Dashboard projektu → **Authentication** → ustawienia e-mail →
   **Confirm email = OFF** (wygoda na dev; na TEST/PROD będzie ON).
5. W Etapie 4 pkt 6 do pliku `.env` wpisujesz zamiast adresów lokalnych:
   `Project URL` i klucz `anon` TEGO projektu (Project Settings → API).

Minusy wariantu: nie ma lokalnej skrzynki maili (54324) ani szybkiego
resetu; gdy migracja padnie w połowie, najprościej **usunąć projekt
i założyć nowy** (2 minuty). Dlatego przy pierwszej okazji wróć do
Wariantu A na komputerze z Dockerem.

---

## ETAP 4 — Aplikacja mobilna (45 minut)

📁 używasz: **całego folderu `app-src`** z paczki.

Dlaczego najpierw „kreator", a potem nasze pliki: świat React Native zmienia
wersje pakietów co kilka tygodni, więc szkielet projektu tworzy oficjalne
narzędzie Expo (zawsze dobierze świeże, zgodne wersje), a nasze pliki —
niezależne od numerów wersji — wstawiamy do środka. Kreator stawia
rusztowanie, my wnosimy mieszkanie.

1. Terminal **w folderze projektu** →
   `npx create-expo-app@latest tapventory-app`
   * na pytanie „Ok to proceed?" → `y`;
   * powstanie folder `tapventory-app` obok `app-src` (potrwa kilka minut).
2. `cd tapventory-app`
3. `npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill`
   (trzy pakiety: rozmowa z Supabase, pamięć sesji, poprawka adresów URL).
4. **Sprzątanie szablonu** — z folderu `tapventory-app` usuń przykładowe
   pliki kreatora. Najprościej w Eksploratorze/Finderze: zaznacz i skasuj
   * foldery: `app`, `components`, `constants`, `hooks`, `scripts`
   * plik: `app.json`
   Wersja terminalowa (macOS/Linux, z folderu `tapventory-app`):
   `rm -rf app components constants hooks scripts app.json`
   Windows PowerShell:
   `Remove-Item app, components, constants, hooks, scripts, app.json -Recurse -Force`
   ⚠️ **Nie usuwaj:** `assets` (ikony!), `node_modules`, `package.json`,
   `package-lock.json`, `tsconfig.json`.
5. **Wklej nasze pliki**: skopiuj z `app-src` do `tapventory-app`
   dokładnie wg tabeli:

   | Z paczki: `app-src/...` | Do: `tapventory-app/...` | Co to jest |
   |---|---|---|
   | `app/` (cały folder) | `app/` | ekrany aplikacji |
   | `components/` (cały) | `components/` | przyciski, pola, listy (styl iOS) |
   | `lib/` (cały) | `lib/` | połączenie z Supabase i sesja |
   | `theme/` (cały) | `theme/` | kolory, pismo, odstępy |
   | `app.config.ts` | `app.config.ts` | konfiguracja aplikacji |
   | `eas.json` | `eas.json` | profile budowania (dev/test/prod) |
   | `.env.example` | `.env.example` | wzór pliku ustawień |

   Najprościej: dwa okna Eksploratora/Findera obok siebie i przeciągnij.
   Wersja terminalowa **z folderu projektu** (nie z tapventory-app):
   * macOS/Linux:
     `cp -r app-src/app app-src/components app-src/lib app-src/theme tapventory-app/ && cp app-src/app.config.ts app-src/eas.json app-src/.env.example tapventory-app/`
   * Windows PowerShell:
     `Copy-Item app-src\app, app-src\components, app-src\lib, app-src\theme -Destination tapventory-app -Recurse; Copy-Item app-src\app.config.ts, app-src\eas.json, app-src\.env.example -Destination tapventory-app`
6. **Plik ustawień `.env`:** w folderze `tapventory-app` skopiuj
   `.env.example` i zmień nazwę kopii na `.env` (Windows ostrzeże przed
   zmianą rozszerzenia — potwierdź). Otwórz `.env` w Notatniku/VS Code
   i w linii `EXPO_PUBLIC_SUPABASE_ANON_KEY=` wklej **anon key**
   zapisany w Etapie 3 pkt 5. Zapisz.
7. **Start:** (w folderze `tapventory-app`) `npx expo start -c`
   → w terminalu pojawi się duży kod QR.
8. **Telefon:** zainstaluj ze sklepu aplikację **Expo Go**. Telefon
   i komputer muszą być **w tej samej sieci Wi-Fi**. Zeskanuj QR
   (Android: z poziomu Expo Go; iPhone: zwykłym aparatem → dymek).
   * Masz zamiast tego emulator Androida (Android Studio)? Wciśnij `a`
     w terminalu. Symulator iOS (tylko macOS z Xcode)? Wciśnij `i`.
9. **Telefon fizyczny a lokalna baza:** adres `127.0.0.1` na telefonie
   oznacza… telefon. Jeśli aplikacja nie łączy się z bazą: sprawdź adres
   IP komputera (Windows: `ipconfig` → pozycja *IPv4*; macOS:
   `ipconfig getifaddr en0`), wpisz go w `.env`, np.
   `EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.20:54321`,
   po czym zatrzymaj (`Ctrl+C`) i uruchom ponownie `npx expo start -c`.

> ✅ **CHECKPOINT 4:** na telefonie widzisz ekran **Tapventory** z polami
> „E-mail" i „Hasło" na jasnoszarym tle w stylu iOS.

---

## ETAP 5 — Pierwsze przejście = Definition of Done Kroku 1 (10 minut)

📁 używasz: niczego nowego — klikasz w aplikacji.

1. **Nie masz konta? Załóż je** → imię i nazwisko, e-mail, hasło
   (min. 8 znaków) → **Załóż konto**.
   (Lokalnie potwierdzanie e-maili jest wyłączone, więc wchodzisz od razu;
   gdyby aplikacja poprosiła o potwierdzenie — wszystkie „maile" lokalnego
   środowiska lądują w skrzynce testowej: **http://127.0.0.1:54324**.)
2. Ekran **Twoja firma** → nazwa np. `Salon Test`, NIP zostaw pusty →
   **Utwórz firmę**.
3. Jesteś na **Pulpicie**: nazwa firmy u góry, karta **Produkty: 0**,
   **Otwarte zgłoszenia: 0**, sekcja *Poniżej minimum* z komunikatem,
   że wszystkie stany są w porządku.
4. Dowód w bazie: Studio (**http://127.0.0.1:54323**) → **Table Editor** →
   tabela `tenants` ma Twój wiersz; `memberships` — wiersz z rolą `owner`;
   `referral_codes` — kod w formacie `TV-XXXXXX`.
5. **Test bezpieczeństwa (RLS w akcji, 3 minuty):** w aplikacji
   **Wyloguj się** → załóż **drugie** konto → utwórz **drugą** firmę →
   pulpit drugiej firmy pokazuje zera i nic z firmy pierwszej. Dwie firmy
   w jednej bazie, zero podglądania się nawzajem — to jest dokładnie ta
   warstwa, której brakowało w starym projekcie.

> ✅ **CHECKPOINT 5 = KONIEC KROKU 1.** Napisz mi w rozmowie:
> „Krok 1 działa" — i przechodzę do kodowania Kroku 2 (zespół
> i zaproszenia). Coś nie zagrało? Wklej pełny komunikat błędu.

---

## ETAP 6 — Kopia kodu w chmurze: GitHub (15 minut)

📁 używasz: całego folderu projektu; plik `.gitignore` z paczki już
pilnuje, żeby sekrety (`.env`) i śmieci (`node_modules`) nie wypłynęły —
nie zmieniaj go.

Ścieżka bez terminala (polecam na start):

1. Otwórz **GitHub Desktop** → zaloguj się kontem z Etapu 2.
2. **File → Add local repository…** → **Choose…** → wskaż folder projektu
   `tapventory` → jeśli zapyta „would you like to create a repository?" →
   **create a repository** → **Create Repository**.
3. Lewy dolny róg: w polu *Summary* wpisz `Krok 1: fundament` →
   **Commit to main**.
4. Górny pasek: **Publish repository** → zostaw zaznaczone
   **Keep this code private** → **Publish**.

> ✅ **CHECKPOINT 6:** po zalogowaniu na github.com widzisz repozytorium
> `tapventory` z folderami `app-src`, `docs`, `supabase`, `tapventory-app`.

---

## ETAP 7 — Środowisko TEST w chmurze (45 minut)

📁 używasz: `tapventory-app/eas.json` (uzupełnisz dwa pola).

**A. Projekt bazy:**

1. supabase.com → **New project** → Name: `tapventory-test` →
   **Database Password:** kliknij **Generate a password** i **zapisz je
   w menedżerze haseł** (będzie potrzebne za chwilę) → Region:
   **Central EU (Frankfurt)** → **Create new project** → odczekaj 1–2 min.
2. Zbierz trzy wartości (menu projektu → **Project Settings**):
   * zakładka **General** → `Reference ID` (krótki identyfikator),
   * sekcja z kluczami **API** → `Project URL` oraz klucz **anon public**
     (nazwy zakładek w panelu bywają przestawiane — szukaj słowa „API").

**B. Wgranie naszej bazy na projekt testowy** (terminal w folderze projektu):

3. `npx supabase login` → otworzy przeglądarkę → **Authorize**.
4. `npx supabase link --project-ref TU_WKLEJ_REFERENCE_ID`
   → poprosi o Database Password z pkt 1.
5. `npx supabase db push` → pokaże listę migracji do wykonania → `y` →
   na końcu `Finished supabase db push`.
6. W dashboardzie projektu: **Authentication** → ustawienia logowania
   e-mail → włącz **Confirm email** → **Save** (na środowiskach
   chmurowych potwierdzanie adresu ma być włączone).

**C. Testowa aplikacja na telefon (Android — najprostszy start):**

7. Otwórz w edytorze `tapventory-app/eas.json` → w profilu **preview**
   podmień `WKLEJ_URL_PROJEKTU_TEST` na `Project URL` i
   `WKLEJ_KLUCZ_ANON_TEST` na klucz anon z pkt 2 → zapisz.
8. `npm install -g eas-cli` → `eas login` (konto Expo z Etapu 2).
9. W folderze `tapventory-app`:
   `eas build --profile preview --platform android`
   * „create a new project?" → `y`;
   * pytanie o **keystore** (podpis aplikacji) → wybierz
     **Generate new keystore** (Enter).
   Budowanie odbywa się w chmurze Expo, trwa zwykle 10–20 minut;
   postęp widać też na expo.dev po zalogowaniu.
10. Po zakończeniu terminal poda **link** — otwórz go na telefonie
    z Androidem → pobierz → **Zainstaluj** (zgódź się na instalację spoza
    sklepu). Na telefonie pojawia się **Tapventory (Test)** — może stać
    obok wersji developerskiej, to osobna aplikacja.
11. Przejdź w niej rejestrację jak w Etapie 5 — tym razem mail
    potwierdzający przyjdzie na **prawdziwą skrzynkę**, a dane lądują
    w bazie we Frankfurcie.

(iPhone testowo: wymaga aktywnego konta Apple Developer i TestFlight —
zrobimy przy etapie sklepów.)

> ✅ **CHECKPOINT 7:** Tapventory (Test) na telefonie działa na bazie
> w chmurze; w dashboardzie `tapventory-test` → Table Editor widzisz
> swoją testową firmę.

---

## ETAP 8 — PROD i strona www (na później; zapisane, żebyś znał kierunek)

* **PROD** = dokładna powtórka Etapu 7 z projektem `tapventory-prod`
  i profilem `production` w eas.json + przed startem komercyjnym: płatny
  plan Supabase i włączenie **PITR** (przywracanie bazy do dowolnej
  minuty). Wchodzi dopiero przy publikacji do sklepów (Krok 9 kolejki).
* **WWW (cennik, rejestracja, panel właściciela):** gdy dostaniesz ode
  mnie folder `www/` (Krok 8 kolejki): vercel.com → **Add New… →
  Project** → **Import** repozytorium z GitHuba → Vercel sam wykryje
  Next.js → **Deploy**. Zmienne: **Settings → Environment Variables** —
  środowisko *Preview* dostaje klucze projektu TEST, *Production* — PROD.
* **Domena (Hostinger zostaje jako DNS):** w Vercel: **Settings →
  Domains** → dodaj `tapventory.com` → Vercel wyświetli, jakie rekordy
  ustawić → w panelu Hostingera (strefa DNS domeny) **przepisz dokładnie
  wartości z ekranu Vercel** (nie z pamięci, nie z poradników — wartości
  bywają różne per konto) → poczekaj na zielony status i kłódkę SSL.

---

## Codzienny rytm pracy (ściąga na lodówkę)

```
rano:      Docker on → `npx supabase start` → w tapventory-app: `npx expo start`
zmiana bazy: NOWY plik supabase/migrations/000X_nazwa.sql → `npx supabase db reset`
koniec dnia: GitHub Desktop → Summary → Commit to main → Push
wydanie na TEST: `npx supabase db push` → `eas build --profile preview`
```

Żelazna zasada: migracja raz wypchnięta na TEST/PROD jest nietykalna —
poprawka to zawsze **nowy** plik z kolejnym numerem.

---

## RATOWNIK — częste błędy i co znaczą

| Objaw | Przyczyna | Lek |
|---|---|---|
| terminal: „supabase" nie jest rozpoznawalne / `command not found` | pominięty Etap 3 pkt 3 albo brak przedrostka `npx` | w folderze projektu: `npm install supabase --save-dev`, potem zawsze `npx supabase …` |
| `npx supabase start` wisi / „Cannot connect to the Docker daemon" | Docker Desktop nie działa | uruchom Dockera, poczekaj na wieloryba, powtórz |
| `port is already allocated` | poprzednia sesja nie zeszła | `npx supabase stop`, odczekaj chwilę, `npx supabase start` |
| `db reset` → `ERROR` w 0001/0002 | usterka w migracji | wyślij mi cały komunikat — odsyłam poprawiony plik |
| aplikacja: „Brak konfiguracji Supabase" | nie ma `.env` albo stary cache | Etap 4 pkt 6, potem `npx expo start -c` |
| telefon: `Network request failed` | `127.0.0.1` = telefon, nie komputer; inna sieć Wi-Fi | Etap 4 pkt 9 (adres IP) + ta sama sieć |
| „Unable to resolve module @supabase/…" | pominięty Etap 4 pkt 3 lub 5 | powtórz instalację pakietów i kopiowanie plików |
| rejestracja mówi o mailu, mail nie przychodzi (lokalnie) | lokalne maile idą do skrzynki testowej | otwórz http://127.0.0.1:54324 |
| `db push` odrzuca hasło | inne hasło niż przy tworzeniu projektu | dashboard → Project Settings → Database → **Reset database password** |
| `eas build` kończy się błędem | różne | wyślij mi link do logów builda z expo.dev |
| Windows: „skrypty są wyłączone" przy poleceniach PowerShell | polityka wykonywania | użyj wersji „w Eksploratorze" danego kroku albo terminala `cmd` |

---

*Mapa dalszej budowy: `docs/01_KOLEJKA_BUDOWY.md`. Pełna koncepcja
produktu: `docs/Tapventory_dokument_koncepcyjny_v1.md`.*
