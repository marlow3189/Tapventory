# 04 — Rynek i technologie: co sprawdziłem, co z tego wynika, czego nie wiem

Stan na **9 października 2026**. Dokument odpowiada na pięć pytań: z kim konkurujemy, co wolno w sklepach z aplikacjami,
jaki system OCR/AI wybrać do faktur, co z KSeF i skąd bierzemy pewność (albo jej brak).

> **Uczciwość przede wszystkim.** Badanie robiłem z kontenera, z którego wiele serwisów (supabase.com, expo.dev, strony producentów)
> było **niedostępnych**. Dlatego każdy fakt ma znacznik wiarygodności. Liczby oznaczone 🟡 lub ❓ **sprawdź sam**, zanim
> oprzesz o nie cennik, umowę albo budżet.

| Znacznik | Znaczenie |
|:-:|---|
| ✅ | odczytane **bezpośrednio** ze źródła pierwotnego (dokumentacja MF na GitHubie, wytyczne Apple, dokumentacja Android, dokumentacja Expo i Supabase na GitHubie, blog WebKit, dane przeglądarek MDN) |
| 🔷 | oficjalna strona producenta/regulatora, ale znana tylko ze **streszczenia wyszukiwarki** ograniczonej do jej domeny (strony nie dało się otworzyć) |
| 🟡 | źródła wtórne: blogi, porównywarki cen, resellerzy — orientacyjnie |
| ❓ | nie udało się sprawdzić albo źródła są sprzeczne |

---

## 1. Streszczenie decyzji

| # | Decyzja | Dlaczego | Jak ją zmienić |
|---|---|---|---|
| 1 | **Odczyt faktur: model wizyjny (Claude) + kontrola kodem**, a nie klasyczny OCR z szablonami | polskie faktury mają setki układów; potrzebne jest rozumienie, a nie tylko tekst; kod i tak sprawdza sumy i NIP | interfejs `ExtractionProvider` (`supabase/functions/_shared/provider.ts`) — dopisujesz klasę innego dostawcy |
| 2 | Tani model najpierw (Haiku 5.5), mocniejszy (Sonnet 5.5) **tylko gdy kod wykryje problem** | płacisz grosze za typową fakturę, a za trudną — więcej | zmienne `AI_MODEL_FAST`, `AI_MODEL_STRONG`, `AI_ESCALATE` (`supabase/functions/.env.example`) |
| 3 | **KSeF jako kanał główny przyjęć**, zdjęcia jako kanał drugi | od 1.02.2026 każdy podatnik **odbiera** faktury przez KSeF; drobni dostawcy do końca 2026 mogą jeszcze wysyłać papier/PDF | rozdz. 3 |
| 4 | Pozycjonowanie: **„magazyn dla ludzi z hali, nie dla księgowej”** — nie „jedyny z KSeF” | KSeF→magazyn mają już pakiety księgowe (rozdz. 2.3); my wygrywamy szybkością zdejmowania towaru, neutralnością wobec programu księgowego i ceną dla ≤10 osób | rozdz. 2.4 |
| 5 | iOS: **żadnych cen ani odesłań do płatności poza App Store w aplikacji** | wytyczna Apple 3.1.3 (rozdz. 5.1) — zmieniono stopkę planu i asystenta | `PLAN_FOOTER` w `mobile/src/app/(app)/settings/index.tsx`, `assistantSystemPrompt()` |
| 6 | Android: cel `targetSdk 36` | Google Play wymaga API 36 od 31.08.2026 (rozdz. 5.2) | domyślne w React Native 0.86 / Expo SDK 57 ✅ w kodzie pakietów; sprawdź po `expo prebuild` |
| 7 | Supabase **Pro** na produkcji (nie Free) | Free pauzuje projekt po tygodniu bez ruchu 🟡 i nie daje kopii zapasowych w panelu; PITR to dodatek do Pro ✅ | rozdz. 6 |

---

## 2. Konkurencja

### 2.1 Aplikacje magazynowe z zagranicy

| Produkt | Plany (ceny z cennika producenta, USD) | Co bierzemy | Czego unikamy |
|---|---|---|---|
| **Sortly** 🔷 | Free: 100 pozycji, 1 użytkownik · Advanced: cena katalogowa 49 $/mc (strona pokazuje promocyjnie 24 $/mc przy płatności rocznej), 500 pozycji, 2 użytkowników · Ultra: 149 $ (promo 74 $), 2000 pozycji, 5 użytkowników · Premium: 299 $ (promo 149 $), 5000 pozycji | prostota „zdjęcie + ilość”, skan kodów, alerty niskiego stanu | limity pozycji i osób, które karzą małe zespoły; brak KSeF i języka polskiego w obiegu faktur |
| **BoxHero** 🔷 | Free: 1 członek, 100 pozycji · Business: 24 $/zespół/mc wg cennika (FAQ: „od 20 $”), 3 członków, 1000 pozycji; dodatki: 5 $/członek, 10 $/1000 pozycji | skaner kodów jako funkcja nr 1 | brak lokalizacji PL |
| **Zoho Inventory** 🔷 | Free: 50 zamówień/mc, 1 użytkownik · Standard 29 $ (rocznie) / 39 $ · Premium 79 $ / 99 $ | — | złożoność, wdrożenie, model „zamówieniowy” |
| **inFlow** 🔷 | od 129 $/mc (roczne) — 2 osoby; 349 $ — 5 osób | — | cena i zakres dla dużo większych firm |
| **Katana** 🔷 | od 299 $/mc | — | produkcja (MRP), nie usługi |

*Uwaga do dokumentu koncepcyjnego v1.1:* tezę „2–4× taniej niż Sortly” podano wobec **cen katalogowych**; przy promocyjnych 24 $/mc (Advanced) różnica
to raczej ~2× (Start 49 zł netto ≈ 13 $ za 3 osoby i 1000 pozycji). Nadal taniej, ale komunikuj to ostrożnie.

### 2.2 Polskie programy do faktur i magazynu

| Produkt | Cena netto 🔷 | KSeF → magazyn | Mobilnie / pracownik |
|---|---|---|---|
| **Subiekt 123** (InsERT, chmura) | pakiet podstawowy 19,90 zł/mc + moduł Magazyn 18,90 zł/mc | wystawianie, UPO, pobieranie dokumentów zakupu | brak potwierdzonej aplikacji mobilnej (działa w przeglądarce) |
| **Subiekt nexo PRO** | licencja ok. 1 535 zł za stanowisko (promocja wrzesień 2026: 767,50 zł; okres niejasny) 🟡; wymaga MS SQL | tak; za pobranie faktury naliczany „InsPunkt” (wg forum) 🟡 | desktop |
| **WAPRO Mag** | Desktop BIZNES 229 zł/mc, Anywhere 169 zł/mc; KSeF przez Businesslink od 99 zł za 2000 punktów | tak | desktop / „Anywhere” |
| **Comarch ERP Optima** | moduły od 59 zł/mc; chmura od 167 zł/mc; KSeF jako subskrypcja zależna od liczby dokumentów (od 15 zł/mc przy 200 dok./rok do 600 zł/mc) + pakiet Comarch OCR&KSeF | tak, z OCR | ciężkie, dla księgowych |
| **Symfonia eBiuro Magazyn** | Sprzedaż i Magazyn 539 zł/rok; KSeF: 60 operacji/rok w cenie, więcej: „KSeF Plus” od 690 zł/rok | **„PZ z faktury z KSeF/OCR jednym kliknięciem”** | web |
| **Firmino** | plan 0 zł; Konto Podstawowe 14,50 zł | **auto-mapowanie pozycji faktur zakupu z KSeF** po nazwie, kodzie, SKU i EAN; magazyn (do 3) | aplikacja mobilna do fakturowania |
| **wFirma** | pakiety z magazynem (ceny z forum 2021: ok. 49–79 zł — nieaktualne ❓) | import zakupów z KSeF tylko w pakietach z księgowością, raz na dobę; pozycje → magazyn przy „zakupie towarów handlowych”; dopasowanie po nazwie, potem po EAN | web |
| **iFirma** | Faktura+ 12,50 zł; księgowość 49 zł | aplikacja mobilna **pobiera faktury kosztowe z KSeF**; magazyn w pakietach | tak |
| **Fakturownia** | Micro 0 zł (3 faktury/mc), wyższe plany; magazyn od planu Standard | KSeF bez dopłaty | aplikacja mobilna |
| **inFakt** | KSeF bezpłatny; pakiety od 4,99 zł | — | brak informacji o magazynie |
| **Warsztat24** | 350 / 450 / 650 zł brutto (okres rozliczeniowy niejasny) | KSeF bez limitów | **pionowy produkt dla warsztatów**: magazyn części, w przeglądarce |

### 2.3 Co z tego wynika — korekta tezy rynkowej

Dokument koncepcyjny v1.1 twierdził, że „nikt na rynku nie łączy” zgłaszania braków zdjęciem, wciągania faktur z KSeF i mobilności po polsku.
**Część tej tezy jest nieprawdziwa.** Przynajmniej Symfonia, Firmino, wFirma, iFirma i Comarch (z OCR) potrafią utworzyć przyjęcie magazynowe z faktury z KSeF.
Nie oznacza to, że Tapventory nie ma sensu, ale **nie jest dziś jedyne w „KSeF → stan”**.

*Czego nie sprawdziłem:* nie przeszedłem polskiego rynku wyczerpująco (np. małe, wyspecjalizowane SaaS-y dla salonów beauty czy gastronomii). Przed kampanią zrób
godzinę ręcznego przeglądu i 10 rozmów z klientami docelowymi.

### 2.4 Jak więc pozycjonować Tapventory (propozycja)

1. **Wyjście towaru, nie tylko wejście.** Pakiety księgowe świetnie przyjmują fakturę, ale nikt nie pyta pracownika „co zużyłeś?”. Nasze „Zdejmij” w 2 tapnięcia, skan EAN, zgłoszenia braków z czatem i mini-spisy
   robią z magazynu **prawdę**, a nie księgowy zapis.
2. **Neutralność.** Klient może fakturować w Fakturowni/wFirmie/iFirmie i księgować u biura rachunkowego — Tapventory czyta KSeF **własnym tokenem tylko do odczytu** i nie wchodzi w drogę żadnemu systemowi.
3. **Cena i limity pod ≤10 osób**, KSeF bez limitu dokumentów (Comarch i Symfonia liczą KSeF osobno).
4. **Foto-faktury z kontrolą kodem** dla tego, co KSeF jeszcze nie obejmuje: paragony, dostawcy zagraniczni, drobni dostawcy poza KSeF do końca 2026.
5. **Ryzyko:** pakiety księgowe mogą dodać mobilne „zdejmij z magazynu”. Obrona: tempo rozwoju, prostota, integracja neutralna.

---

## 3. KSeF: kalendarz i konsekwencje

| Data | Co się dzieje | Wiarygodność |
|---|---|:-:|
| **1.02.2026** | obowiązek wystawiania faktur w KSeF dla największych podatników (sprzedaż > 200 mln zł w 2024 r.); **wszyscy podatnicy mogą/muszą odbierać faktury przez KSeF** | 🔷 (strona `ksef.podatki.gov.pl/etapy-wdrozenia-ksef/`) |
| **1.04.2026** | obowiązek wystawiania dla pozostałych podatników | 🔷 |
| **1.01.2027** | obowiązek wystawiania dla najmniejszych (sprzedaż udokumentowana fakturami do 10 000 zł brutto miesięcznie) i **początek sankcji finansowych**; w 2026 r. brak kar | 🔷 + 🟡 (źródła różnią się w szczegółach) |
| 2.0 API | środowiska **TEST / DEMO / PROD**, token KSeF z niezmiennym zestawem uprawnień (np. tylko `InvoiceRead`), limity zapytań na parę „NIP + adres IP” | ✅ (przewodnik integratora MF z 5.05.2026, limity z 14.09.2026) |

**Poprawka w dokumencie koncepcyjnym:** skrót „najmniejsi (≤450 zł/faktura i ≤10 tys. zł/mc)” był mylący. Limit dla najmniejszych to **10 000 zł brutto miesięcznie**; kwota 450 zł dotyczy
faktur uproszczonych/paragonów z NIP, które nie wliczają się do tego limitu 🟡. Dokładne brzmienie przepisów potwierdź na `gov.pl/ksef` i u doradcy podatkowego — to nie jest porada prawna.

**Konsekwencje dla produktu:**

* Skoro *każdy* odbiera faktury przez KSeF, import faktur **zakupu** przydaje się wszystkim naszym klientom, także tym, którzy sami jeszcze nie wystawiają.
* Dostawcy, którzy do końca 2026 r. nie muszą wystawiać w KSeF, nadal przyślą papier/PDF → **kanał foto/AI zostaje niezbędny**.
* Oficjalne limity pobierania (produkcja, liczone osobno dla pary NIP + IP) ✅: lista metadanych **20 zapytań/h**, pobranie faktury po numerze **64/h** (oraz 16/min). MF zaleca odpytywanie nie częściej niż co 15 min
  na podmiot, a dla małych wolumenów — na żądanie + raz na dobę. Nasz automat odpytuje co ≥3 h, a pierwszy import dużej zaległości **z założenia trwa godziny** (patrz `docs/10_KSEF.md`).
* MF zastrzega, że systematyczne używanie wielu adresów IP w jednym kontekście może zostać uznane za zagrożenie ✅. Funkcje Supabase wychodzą z różnych adresów — przy skali rozważ stały adres wychodzący (decyzja po pierwszych klientach).

---

## 4. OCR i AI do faktur — wybór technologii

### 4.1 Zasada: „model czyta, kod sprawdza”

Model językowy z obrazem potrafi odczytać pozycje z faktury o dowolnym układzie, ale **może się pomylić po cichu** (inna cyfra w cenie, pominięty wiersz, doklejona instrukcja z dokumentu).
Dlatego wynik **nigdy nie księguje się sam**. Kod w `supabase/functions/_shared/invoice.ts` sprawdza:

* sumę kontrolną NIP, EAN (GS1), datę, walutę,
* ilość × cena = wartość pozycji, suma pozycji = suma netto, netto + VAT = brutto,
* ostrzeżenia zgłoszone przez sam model,

a człowiek na ekranie weryfikacji widzi pola oznaczone żółto. Szczegóły: `docs/09_AI_I_OCR.md`.

### 4.2 Porównanie opcji

| Opcja | Jak działa | Cena | Ocena dla Tapventory |
|---|---|---|---|
| **Claude Haiku 5.5 → Sonnet 5.5 (nasz potok)** | obraz → JSON ze schematu; drugi odczyt mocniejszym modelem przy błędach kodu | Haiku 0,10 / 0,50 $, Sonnet 2 / 10 $, Opus 4 / 20 $ za mln tokenów (wej./wyj.) ✅ (cennik dołączony do narzędzi sesji; sprawdź `platform.claude.com/docs/en/about-claude/pricing`) | **wybór domyślny**: rozumie układy bez szablonów, wynik strukturalny, dobre PL |
| AWS Textract (AnalyzeExpense) | gotowy parser faktur/paragonów | ok. 10 $/1000 stron 🟡 (jedno źródło: 1,50 $ — sprzeczne ❓) | dobry w polach nagłówka; pozycje i polskie nazwy wymagają dopracowania; dane do USA/UE zależnie od regionu |
| Google Document AI (Invoice Parser) | wyspecjalizowany parser | ❓ cennik nieodczytany (oficjalna strona nie zwróciła cen) | do rozważenia przy teście porównawczym |
| Azure Document Intelligence (prebuilt invoice) | jak wyżej | ❓ (jeden serwis: ok. 10 $/1000 stron 🟡) | jw. |
| Mindee | API do dokumentów | ok. 44 / 179 / 584 €/mc 🟡 | miesięczny abonament niezależny od wolumenu — drogo na starcie |
| Gemini / modele GPT | modele wizyjne ogólnego zastosowania | ❓ — **nie znalazłem niezależnego, aktualnego benchmarku** dokładności odczytu pozycji faktur | koncept v1.1 zakładał Gemini 2.5 Flash (0,15 / 1,25 $) 🟡; nie odrzucamy, trzeba **zmierzyć** (rozdz. 4.4) |

**Dlaczego nie „najlepszy OCR” jako jeden produkt?** Bo nie ma na to wiarygodnego dowodu. Zamiast zgadywać, zbudowaliśmy: (1) architekturę niezależną od dostawcy, (2) kontrolę kodem, która łapie typowe błędy
niezależnie od modelu, (3) **zestaw ewaluacyjny** (`eval/`, 28 syntetycznych polskich dokumentów z wartościami wzorcowymi), (4) pomiar jakości w produkcji (poprawki użytkowników). To uczciwsza droga niż deklaracja „najlepszy”.

### 4.3 Rachunek kosztów (orientacyjny — **to nie jest pomiar**)

Założenia: strona ≈ 2 000–3 000 tokenów wejścia (obraz + instrukcja; Haiku 5.5 liczy ok. 30% więcej tokenów niż starsze modele), odpowiedź ≈ 1 000–1 500 tokenów, kurs 3,75 zł/$.

| Konfiguracja | Koszt strony | Uwagi |
|---|---|---|
| tylko Haiku 5.5 | ≈ 0,001 $ ≈ **0,4 gr** | tani, ale więcej cichych błędów (patrz eval) |
| tylko Sonnet 5.5 | ≈ 0,02 $ ≈ **8 gr** | |
| potok (Haiku + Sonnet przy ~20% dokumentów) | ≈ **1–3 gr** | to realizujemy |

Przy planie Zespół (150 skanów/mc) najgorszy przypadek to kilka złotych miesięcznie na firmę — kilka procent ceny planu. **Prawdziwy koszt** zobaczysz w tabeli `ai_usage` (kolumna `cost_micro_usd`) oraz w raporcie
`npm run eval:run`.

### 4.4 Co zrobić, żeby wybrać model na podstawie danych

1. `npm run eval:dry` — sprawdza rurę bez kosztów (liczby z atrapy nie opisują żadnego modelu).
2. `npm run eval:run` z kluczem Anthropic — koszt ok. 1–3 $; raport: ile dokumentów odczytano w całości poprawnie, ile razy model pomylił się **po cichu**, koszt na 1000 dokumentów.
3. Dołóż 20–30 **zanonimizowanych** prawdziwych faktur (zamaż dane osobowe; `eval/README.md`, „Jak dodać własny przypadek”).
4. Chcesz porównać z innym dostawcą? Napisz adapter `ExtractionProvider` i uruchom ten sam zestaw. Nie dodaliśmy gotowych adapterów Gemini/GPT, bo **nie dało się ich przetestować na żywo** — nie dajemy niesprawdzonego kodu.

### 4.5 Dane osobowe i AI

* Apple (5.1.2(i)) wymaga **jasnego ujawnienia i wyraźnej zgody**, zanim dane trafią do zewnętrznej AI ✅ — w aplikacji robi to arkusz zgody (`AiConsentSheet`) przed pierwszym użyciem skanera i asystenta; zgodę można cofnąć w Ustawieniach.
* Anthropic: zgodnie ze streszczeniami, dane z API **domyślnie nie służą do trenowania modeli** 🟡; okres przechowywania — źródła podają 7 lub 30 dni ❓, a „zero data retention” jest dostępne za zgodą. **Przed publikacją** przeczytaj aktualną politykę i umowę
  (DPA) na stronie Anthropic i wpisz dostawcę jako podprocesora w politykę prywatności (`docs/prawne/`). Przetwarzanie poza EOG wymaga podstawy transferu — omów z prawnikiem.
* Logi funkcji **nie zawierają treści faktur** (tylko identyfikatory, kody, liczby) — patrz `process-document/handler.ts`.

---

## 5. Sklepy i platformy

### 5.1 Apple (App Store) ✅

| Wytyczna | Treść (fragment) | Stan w Tapventory |
|---|---|---|
| **3.1.3(c)** Enterprise Services | „If your app is only sold directly by you to organizations or groups for their employees … you may allow enterprise users to access previously-purchased content or subscriptions. **Consumer, single user, or family sales must use in-app purchase.**” | Model „Netflixa” (sprzedaż na www) jest dopuszczalny tylko dla organizacji. **Ryzyko:** jednoosobowa firma kupująca plan Start „dla siebie” może być uznana za „single user”. Plan B: dodać IAP obok ceny www |
| **3.1.3** wstęp | aplikacje z tej sekcji „cannot, within the app, encourage users to use a purchasing method other than in-app purchase” (poza USA) | **Zmienione w tej wersji:** na iOS stopka planu i asystent nie wspominają o stronie płatności ani cenach |
| **3.1.1** | funkcji nie odblokowuje się własnymi kodami licencyjnymi | plany ustawia serwer po płatności na www; aplikacja tylko wyświetla limity |
| **5.1.1(v)** | jeśli można założyć konto, trzeba oferować **usunięcie konta w aplikacji** | zrobione: Ustawienia → usunięcie konta/firmy (RPC `delete_account`, `delete_tenant`; testy F4) |
| **5.1.2(i)** | „clearly disclose where personal data will be shared with third parties, **including with third-party AI**, and obtain explicit permission” | zrobione: `AiConsentSheet` |
| **4.8** Login Services | dotyczy aplikacji z logowaniem przez konta zewnętrzne | nie dotyczy: tylko e-mail + hasło |

Konto Apple Developer: 99 USD/rok; organizacja potrzebuje numeru D-U-N-S 🟡 (strony pomocy Apple widoczne w wyszukiwarce, nieotwarte).

### 5.2 Google Play

* **Docelowe API:** od **31.08.2026** nowe aplikacje i aktualizacje muszą celować w Androida 16 (**API 36**); istniejące aplikacje muszą mieć co najmniej API 35, żeby pozostać widoczne dla nowych użytkowników; możliwe przedłużenie do **1.11.2026** ✅ (`developer.android.com/google/play/requirements/target-sdk`).
  W naszym kodzie: React Native 0.86.3 (`react-native/gradle/libs.versions.toml`: `targetSdk = "36"`, `compileSdk = "36"`, `minSdk = "24"`) i `expo-modules-core` (domyślnie 36) ✅ — **ale nie zbudowałem projektu Android** (brak SDK), więc po pierwszym `eas build` sprawdź w logu/manifeście `targetSdkVersion=36`.
* **Test zamknięty dla nowych kont osobistych:** konta *osobiste* założone po 13.11.2023 muszą przed produkcją przeprowadzić test zamknięty z **12 testerami przez 14 dni** 🟡 (kilka blogów; część pomocy Google); konta **organizacji** mają być z tego wyłączone 🟡 — **zweryfikuj w Play Console**, zanim zaplanujesz kalendarz.
* Konto organizacji wymaga D-U-N-S (w Polsce: bezpłatny wniosek na `dnb.com/pl-pl`, czas od kilku dni do kilku tygodni) — dlatego wniosek składa się **od razu**.
* Opłata jednorazowa 25 USD (Google Play Console) 🟡.
* Wymagane na stronie sklepu: polityka prywatności (adres w `LINKS.privacy`), formularz „Bezpieczeństwo danych”, informacja o usuwaniu konta (`LINKS.deleteAccount`). Szablony: `docs/prawne/`.

### 5.3 Expo EAS (budowanie w chmurze)

| Fakt | Wiarygodność |
|---|:-:|
| Plan **Free**: ograniczona liczba budowań o niskim priorytecie; limit odnawia się 1. dnia miesiąca; po wyczerpaniu nowe budowania są niedostępne (brak dopłat) — alternatywa: budowanie lokalne | ✅ (docs Expo: billing/faq) |
| liczba budowań w Free: ok. 15 Android + 15 iOS miesięcznie | 🟡 |
| Plan **Starter: 19 $/mc**, w tym **45 $** kredytu na budowania priorytetowe; EAS Update: 3 000 aktywnych użytkowników miesięcznie (Free: 1 000) | ✅ (docs Expo: billing/plans, billing/faq) |
| Cena planu Production | ❓ (źródła podają 99 $ albo 199 $) |
| koszt budowania priorytetowego (przykłady z dokumentacji): Android medium 1 $, large 2 $; iOS medium 2 $, large 4 $ | ✅ |

### 5.4 PWA i iPhone

* Powiadomienia **Web Push na iOS** działają od iOS/iPadOS **16.4**, tylko dla aplikacji **zainstalowanej na ekranie początkowym** („Dodaj do ekranu początkowego”), a zgoda musi być poproszona po **geście użytkownika** ✅ (blog WebKit „Web Push for Web Apps on iOS and iPadOS”).
  Dlatego w aplikacji przycisk „Włącz powiadomienia” jest osobnym działaniem w Ustawieniach.
* Skaner kodów w przeglądarce: interfejs `BarcodeDetector` jest w Chrome na Androidzie, ale w **Safari tylko za ukrytą flagą** (od wersji 17) i **nie ma go w Firefoksie** ✅ (dane MDN/browser-compat-data). Dlatego używamy biblioteki `barcode-detector` z modułem `zxing-wasm`, który hostujemy sami (`mobile/public/zxing_reader.wasm`).
* Ograniczenia PWA (brak pełnej obsługi w tle itd.) opisuje `docs/13_PWA_I_POWIADOMIENIA.md`.

### 5.5 Node.js

Na 9.10.2026: **Node 24 = aktywna wersja LTS**; Node 26 (wydany w maju 2026) ma dostać status LTS ok. 28.10.2026; Node 22 jest w trybie „maintenance” 🟡 (`endoflife.date/nodejs`, `nodejs.org/about/releases`).
Zalecenie dla juniora: instaluj **Node 24 LTS** (po 28.10 możesz 26 LTS). Projekt (`package.json` → `engines`) wymaga `>=22`; testowałem na **Node 22.22**.

---

## 6. Supabase

| Fakt | Wiarygodność |
|---|:-:|
| Plan **Free**: 2 aktywne projekty; projekt **pauzowany po 7 dniach bez aktywności** (wznowienie jednym kliknięciem w panelu) | 🟡 (kilka niezależnych zestawień cen; oficjalna strona niedostępna) |
| Plan **Pro**: ok. 25 $/mc bez pauzowania; kopie dzienne z ostatnich **7 dni** | ✅ (dokumentacja „Backups”) / 🟡 (cena) |
| **PITR** (przywracanie do dowolnej sekundy) to **dodatek** do planów Pro/Team/Enterprise i wymaga co najmniej obliczeń „Small”; po włączeniu PITR kopie dzienne nie są już robione | ✅ |
| Nowe projekty mają klucze `sb_publishable_…` (zamiast „anon”) i `sb_secret_…` (zamiast „service_role”); Funkcje dostają `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` jako mapy JSON; dla wywołań serwer–serwer zaleca się `verify_jwt = false` i własną weryfikację w funkcji | 🟡 (dokumentacja „Securing Edge Functions” i README `@supabase/server` widoczne w wyszukiwarce) |
| Region UE (Frankfurt) i zgodność z RODO | ✅ (dokumentacja: regions, gdpr-compliance) |

**Co zrobiliśmy z tą niepewnością:** funkcje szukają klucza serwisowego w obu formatach (`supabase/functions/_shared/service-key.ts`, 7 testów); `verify_jwt = false` jest ustawione w `config.toml`, a każda funkcja sama waliduje sesję (`auth.getUser`).
Brakuje jednego: **nie wdrożyłem funkcji na żywy projekt Supabase**, więc kroki z `docs/02_START_LOKALNY.md` (sekcja „Wdrożenie funkcji”) są sprawdzone tylko na poziomie składni i testów.

---

## 7. Czego NIE sprawdziłem (i jak to zrobić)

| # | Luka | Jak domknąć | Kto |
|---|---|---|---|
| 1 | żywe wywołania API KSeF (TEST/DEMO) — kształt żądań wzięty z oficjalnego OpenAPI i SDK, a serwer MF zasymulowałem w testach | `docs/10_KSEF.md`, rozdz. „Co sprawdzić na TEST” | Ty, ok. 1 dzień |
| 2 | dokładność odczytu faktur (żadnych żywych wywołań modeli; tryb próbny pokazuje 100% tylko dla atrapy) | `npm run eval:run` (1–3 $) + 20 prawdziwych faktur | Ty |
| 3 | `supabase start` / `db reset` / `functions deploy` na prawdziwym Supabase | `docs/02_START_LOKALNY.md`; migracje przetestowałem na PostgreSQL 16 i 17 | Ty |
| 4 | budowa natywna iOS/Android, powiadomienia push na urządzeniu | `docs/12_BUDOWANIE_I_PUBLIKACJA.md` | Ty |
| 5 | ceny konkurencji i usług OCR (🔷🟡❓ powyżej) | strony producentów | Ty, przed cennikiem |
| 6 | oficjalne brzmienie przepisów o KSeF | `gov.pl/ksef`, doradca podatkowy | Ty |
| 7 | czy organizacja jest zwolniona z testu 12 testerów w Google Play | Play Console → pomoc | Ty |
| 8 | warunki przechowywania danych przez Anthropic i podstawa transferu poza EOG | umowa/DPA Anthropic, prawnik | Ty |
| 9 | wyczerpujący przegląd polskich konkurentów | 1 godzina + 10 rozmów z klientami | Ty |
| 10 | akceptacja przez Apple modelu płatności (3.1.3(c)) | pierwsza wersja do recenzji; plan B: IAP | Ty |

---

## 8. Źródła

**Odczytane bezpośrednio (✅):**
* Ministerstwo Finansów — przewodnik integratora KSeF 2.0 i limity: [github.com/CIRFMF/ksef-docs](https://github.com/CIRFMF/ksef-docs); specyfikacja API: [api-test.ksef.mf.gov.pl/docs/v2](https://api-test.ksef.mf.gov.pl/docs/v2)
* Apple — [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
* Android — [Target API level requirements for Google Play](https://developer.android.com/google/play/requirements/target-sdk)
* Expo — dokumentacja billing/EAS (repozytorium [expo/expo](https://github.com/expo/expo), katalog `docs`); Supabase — dokumentacja backups/regions/GDPR (repozytorium [supabase/supabase](https://github.com/supabase/supabase), katalog `apps/docs`)
* WebKit — [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
* MDN — dane zgodności przeglądarek dla `BarcodeDetector` ([mdn/browser-compat-data](https://github.com/mdn/browser-compat-data))
* Anthropic — [cennik](https://platform.claude.com/docs/en/about-claude/pricing) (ceny za mln tokenów skopiowane do `supabase/functions/_shared/cost.ts`; **sprawdź przed zmianą modelu**)

**Streszczenia wyszukiwarki z domen producentów (🔷):** [ksef.podatki.gov.pl — etapy wdrożenia](https://ksef.podatki.gov.pl/etapy-wdrozenia-ksef/), [Sortly](https://www.sortly.com/pricing/), [BoxHero](https://www.boxhero.io/pricing),
[Zoho Inventory](https://www.zoho.com/us/inventory/pricing/), [inFlow](https://www.inflowinventory.com/software-pricing), [Subiekt 123](https://subiekt123.pl/cennik/), [WAPRO](https://wapro.pl/cennik/),
[Comarch Optima](https://www.comarch.pl/erp/comarch-optima/cennik/), [Firmino](https://www.firmino.pl/cennik/), [wFirma — import z KSeF](https://pomoc.wfirma.pl/-import-faktur-zakupu-z-ksef-w-systemie-wfirma-pl),
[iFirma](https://www.ifirma.pl/cennik/), [Fakturownia](https://fakturownia.pl/cennik), [Warsztat24](https://warsztat24.com/).

**Źródła wtórne (🟡):** [JetAdmin — Supabase pricing 2026](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/),
[Automation Atlas — Supabase free tier](https://automationatlas.io/answers/supabase-free-tier-limits-2026/), [Choicely — reguła 12 testerów](https://www.choicely.com/blog/google-play-12-tester-rule),
[ExtendsClass — test zamknięty Google Play](https://extendsclass.com/blog/google-plays-closed-testing-requirement-what-developers-need-to-know-in-2026), [endoflife.date — Node.js](https://endoflife.date/nodejs).
