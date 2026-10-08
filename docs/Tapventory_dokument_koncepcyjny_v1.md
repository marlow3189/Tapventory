# Tapventory — dokument koncepcyjny v1.1

Data: 18.08.2026 · Status: zaakceptowany kierunek, przed rozpoczęciem budowy
Zmiany v1.1: atrybucja ruchów do kont (nie urządzeń), konfigurowalne mini-spisy z pytaniem przy "Zdejmij", flaga billing (np. dla księgowej), procedura administracyjna zmiany właściciela, edycja i storno przy skanach, asystent AI, ochrona darmowych okresów przed nadużyciami
Zakres: Etap 1 (aplikacja magazynowo-zakupowa) + założenia Etapu 2 (marketplace B2B) + zaparkowany side project (rolnik)

---

## 1. Wizja i zakres

**Produkt:** mobilna aplikacja (iOS + Android z jednego kodu) dla małych firm usługowych do 10 osób — salony beauty, warsztaty samochodowe, gabinety, mała gastronomia — która ogarnia cały proces magazynowo-zakupowy: od zgłoszenia braku przez pracownika, przez zamówienie, po automatyczne przyjęcie faktury na magazyn.

**Etap 1 (budujemy teraz):** narzędzie dla firmy. Etap 2 (po zdobyciu bazy klientów): odwrócony marketplace B2B — klient wystawia zapytanie, dostawcy konkurują o zamówienie. **Poza zakresem:** aplikacja B2C dla konsumentów (osobna marka, decyzja 2027+; koncept "Zagroda" w rozdz. 15).

**Trzy filary produktu:** prostota (działa w 10 minut od instalacji, zero wdrożeniowca), bezpieczeństwo (izolacja danych firm na poziomie bazy, 2FA, audyt), automatyzacja przyjęć (KSeF + AI).

**Klin rynkowy:** nikt na rynku nie łączy: (1) zgłaszania braków zdjęciem przez pracownika, (2) automatycznego wciągania polskich faktur zakupowych z KSeF, (3) mobile-first po polsku w cenie dla mikrofirmy. Zagraniczni gracze (Sortly, BoxHero) nie wejdą w KSeF; polscy (Subiekt, WAPRO, Comarch) to desktopowe systemy księgowo-magazynowe wymagające wdrożenia.

---

## 2. Rynek i pozycjonowanie

| Konkurent | Cena | Co bierzemy | Czego unikamy |
|---|---|---|---|
| Sortly | Advanced 49 USD/mc (2 użytkowników, 500 pozycji), Ultra 149 USD | foto-centryczna prostota | cennik karzący małe zespoły |
| BoxHero | Business od 20 USD/mc (3 os.), +5 USD/user | skaner kodów jako funkcja nr 1 | brak lokalizacji PL |
| Zoho/Odoo | od ~59 USD | — (kontrprzykład) | złożoność wymagająca wdrożenia |
| Subiekt/WAPRO/Comarch | licencje + wdrożenie | — | desktop, ciężar księgowy |

Pozycjonowanie: 2–4× taniej niż Sortly, po polsku, z KSeF, na telefonie.

---

## 3. Kluczowa poprawka logiki: "sama inwentaryzacja"

Faktura daje "weszło". Nic w pierwotnej wizji nie rejestrowało "zeszło" — bez tego stan = fikcja. Rozwiązanie trzywarstwowe (wszystko w Etapie 1):

1. **Akcja "Zdejmij"** — 2 tapnięcia (produkt → ilość) albo skan EAN z opakowania. Musi być szybsza niż karteczka. **Każdy ruch przypisany do konta konkretnego użytkownika** (identyfikator z tokenu podpisanego serwerowo — nigdy z urządzenia; telefon to tylko nośnik, tożsamość niesie konto). Konta imienne; limit w planie liczy osoby, więc współdzielenie loginu się nie opłaca i psuje audyt.
2. **Mini-inwentaryzacje cykliczne** — częstotliwość ustawia kierownik przy konfiguracji (co tydzień / co dwa); aplikacja rotacyjnie prosi o policzenie ~5 produktów. Dodatkowo **pytanie przy okazji**: gdy pracownik robi "Zdejmij" na produkcie z minionym terminem weryfikacji, pojawia się jedno pytanie "ile zostało na półce?" (maks. 1–2 dziennie na osobę — bez męczenia). Różnica księguje się jako korekta/zużycie. Cały magazyn zweryfikowany w miesiąc, po ~3 minuty na raz.
3. **Zgłoszenie braku jako punkt kontrolny** — zgłaszający może podać, ile realnie zostało.

Formuła: przyjęcia automatyzujemy (KSeF/AI), rozchody upraszczamy do 2 tapnięć, prawdę weryfikują mini-spisy.

---

## 4. Specyfikacja funkcjonalna Etapu 1

**Konta i firma:** rejestracja firmy (NIP, adres + geolokalizacja — furtka pod marketplace), zaproszenia mailem, role (rozdz. 6), wielu właścicieli, panel www właściciela (billing, użytkownicy, cennik).

**Magazyn:** katalog produktów (zdjęcie, jednostka, szt./opakowanie zbiorcze, próg minimalny, domyślny dostawca, EAN), skaner kodów EAN (natywny, darmowy, bez limitu na każdym planie), akcja "Zdejmij", mini-inwentaryzacje, alerty push o stanie poniżej progu, obsługa korekt i zwrotów (ruchy ujemne).

**Przyjęcia — kanał 1 (główny): KSeF** — automatyczne pobieranie faktur zakupowych (rozdz. 8). **Kanał 2: foto/AI** — skan wielostronicowy i wielofakturowy (rozdz. 9): paragony, faktury zagraniczne, dostawcy zwolnieni z KSeF do 2027, WZ.

**Zgłoszenia braków i zamówienia:** zgłoszenie = opis / zdjęcie / wybór z katalogu + ilość + opcjonalny projekt; cykl statusów: zgłoszone → zaakceptowane → zamówione → dostarczone → przyjęte (każdy status: kto, kiedy); czat wątkiem przy każdym zgłoszeniu (nie osobny komunikator).

**Projekty/Zlecenia:** typ (pojazd/zlecenie/impreza/klient), numer referencyjny (VIN, rejestracja, nr zlecenia); podpinane opcjonalnie do zgłoszeń, ruchów i pozycji faktur → raport "koszt materiałów na zlecenie"; fundament pod RFQ w Etapie 2.

**Pozostałe:** powiadomienia push, dziennik zdarzeń (audit log, tylko dopisywanie), eksport CSV, RODO (eksport danych, usunięcie konta), ekran weryfikacji faktury (najważniejszy ekran aplikacji — rozdz. 9), **asystent AI w aplikacji** — start (Etap 1): pomocnik/onboarding odpowiadający na pytania "jak to zrobić w aplikacji" (model + nasza dokumentacja, koszt groszowy); Etap 1.5: pytania o własne dane firmy ("ile wydaliśmy w lipcu u dostawcy X?"), wykonywane serwerowo **w granicach uprawnień pytającego** (RLS obowiązuje też asystenta).

**Etap 1.5 (po pierwszych klientach):** tryb offline przez PowerSync (lokalna kopia SQLite synchronizowana z chmurą). Architektura (UUID + log ruchów) jest pod to gotowa od dnia 1.

---

## 5. Model danych

Zasady: każde ID to **UUID v7 generowane na kliencie** (warunek przyszłego offline). Każda tabela biznesowa ma `tenant_id` (identyfikator firmy) + regułę **RLS** (Row Level Security — baza sama pilnuje, że firma widzi tylko swoje wiersze). **Stan magazynowy nie jest kolumną** — jest sumą tabeli ruchów (zmaterializowany widok): dopisywanie wierszy nie konfliktuje przy pracy wielu urządzeń, edycja jednej liczby — zawsze.

| Tabela | Rola | Kluczowe pola |
|---|---|---|
| `tenants` | firma | nazwa, NIP, branża, adres, geo |
| `memberships` | kto należy do firmy | user_id, tenant_id, rola (owner/manager/employee), `can_manage_managers` bool, `can_manage_billing` bool, UNIQUE(user,tenant) |
| `suppliers` | dostawcy | nazwa, NIP, kontakt — w Etapie 2 dostają konta |
| `catalog_items` | katalog GLOBALNY | nazwa, producent, EAN — wspólny język produktów pod marketplace |
| `products` | produkt u firmy | tenant_id, catalog_item_id?, jednostka, szt./opak., próg min., zdjęcie, domyślny dostawca |
| `stock_movements` | log ruchów (serce) | product_id, typ (przyjęcie/rozchód/korekta/zwrot), ilość ±, źródło, project_id?, kto, kiedy |
| `documents` | faktury | źródło (ksef/foto), status (szkic/zweryfikowany/zaksięgowany), NIP+numer (kontrola duplikatów), plik |
| `document_lines` | pozycje faktur | nazwa źródłowa, ilość, cena, dopasowany product_id, pewność AI %, project_id? |
| `requests` | zgłoszenia/zamówienia | product_id lub opis+zdjęcie, ilość, status cyklu, project_id?, kto |
| `request_messages` | czat wątkiem | request_id, autor, treść |
| `projects` | zlecenia | typ, numer referencyjny (VIN/rej./nr), status |
| `audit_log` | dziennik zdarzeń | kto, akcja, obiekt, kiedy — append-only |
| `referral_codes` / `referrals` / `reward_ledger` | polecenia | rozdz. 13 |

---

## 6. Role i uprawnienia

| Uprawnienie | Pracownik | Kierownik | Kierownik z flagą | Właściciel |
|---|---|---|---|---|
| Zgłoszenia, "Zdejmij", czat | ✅ | ✅ | ✅ | ✅ |
| Akceptacja/składanie zamówień | ❌ | ✅ | ✅ | ✅ |
| Faktury (skan, weryfikacja, księgowanie) | ❌ | ✅ | ✅ | ✅ |
| Katalog produktów, progi | ❌ | ✅ | ✅ | ✅ |
| Zarządzanie pracownikami | ❌ | ✅ | ✅ | ✅ |
| Zarządzanie kierownikami | ❌ | ❌ | ✅ | ✅ |
| Konta właścicieli | ❌ | ❌ | ❌ | ✅ |
| Subskrypcja i płatności (billing) | ❌* | ❌* | ❌* | ✅ |
| Usunięcie firmy, zarządzanie kontami właścicieli | ❌ | ❌ | ❌ | ✅ |

\* chyba że członek (dowolna rola — np. księgowa jako "pracownik") ma flagę `can_manage_billing`: widzi wtedy panel billingowy na www (zmiana planu, karta, faktury) bez żadnych dodatkowych praw w magazynie.

**Wielu właścicieli: TAK.** Rola w `memberships`, więc owner może być wielokrotny (wspólnicy). Reguły: (1) constraint chroniący ostatniego ownera przed usunięciem/degradacją; (2) ownera dodaje/usuwa tylko owner; (3) akcje nieodwracalne — audyt + mail do pozostałych ownerów. Zamiast nowych ról — **flagi uprawnień** (kolumny boolean w `memberships`, ustawia wyłącznie właściciel): `can_manage_managers` — kierownik zarządza innymi kierownikami; `can_manage_billing` — dowolny członek (np. księgowa) zarządza subskrypcją i płatnościami. Układ docelowy: **3 role + 2 flagi**.

**Zmiana/odzyskanie dostępu właścicielskiego (procedura administracyjna, back-office):** dedykowana poufna skrzynka (osobny adres, obsługa wyłącznie przez administratorów portalu — poza ogólnym supportem i systemem ticketów). Wymagane: aktualny odpis KRS/CEIDG + dokument tożsamości wnioskującego + podpisane oświadczenie o zmianie udziałów / odejściu wspólnika. Bezpieczniki: (1) powiadomienie wszystkich obecnych właścicieli i **72-godzinne okno sprzeciwu** przed wykonaniem zmiany (ochrona przed socjotechniką); (2) każda zmiana w audit_log z podpisem wykonującego administratora; (3) RODO — kopie dokumentów przechowywane tylko na czas procedury i kasowane po jej zamknięciu (minimalizacja danych).

---

## 7. Bezpieczeństwo

- **Logowanie:** e-mail + hasło (Supabase Auth, bcrypt), obowiązkowa weryfikacja maila.
- **2FA:** SMS **tylko przy nowym urządzeniu** (zaufana sesja 30 dni) — ekonomia: bez tej reguły 10 osób × codzienne logowanie ≈ 300 SMS/mc/firmę; z regułą 10–20. TOTP (Google Authenticator) jako darmowa alternatywa odporna na przejęcie karty SIM. **10 kodów zapasowych**: pokazane raz, w bazie tylko hashe; logowanie kodem przy utracie telefonu.
- **Alerty:** mail przy logowaniu z nowego urządzenia i zmianie hasła/numeru, z przyciskiem "to nie ja — zablokuj".
- **Dane:** RLS na każdej tabeli; rola + tenant_id w tokenie **ustawiane wyłącznie serwerowo**; Storage prywatny, ścieżki `tenant_id/…`, dostęp przez podpisane wygasające linki.
- **Higiena:** rate limiting na kody, captcha przy rejestracji, zdalne wylogowanie urządzeń, natychmiastowe odcięcie po usunięciu membership, backupy dzienne + PITR (odtwarzanie do sekundy), region **UE-Frankfurt** + umowa powierzenia (DPA) — RODO.
- **Tokeny KSeF klientów:** szyfrowane w spoczynku, dostęp tylko z funkcji serwerowych, każde użycie w audit_log.
- **Ochrona darmowych okresów przed nadużyciami:** tożsamość firmy kotwiczymy w sygnałach twardych — NIP (trial 1× na NIP), odcisk karty płatniczej (fingerprint Stripe), zweryfikowany e-mail/telefon; metadane urządzenia to tylko sygnał pomocniczy. Wymiana telefonu niczego nie resetuje: "zaufane urządzenie" wyłącznie pomija SMS przy logowaniu — nie daje żadnych dni gratis; nagroda z polecenia wyłącznie po opłaconej fakturze.

---

## 8. Moduł e-fakturowania: KSeF + architektura UE

### 8.1 KSeF (Polska) — kanał główny przyjęć

Kontekst prawny: od 1.02.2026 każdy podatnik odbiera faktury w KSeF; od 1.04.2026 MŚP i JDG wystawiają obowiązkowo; najmniejsi (≤450 zł/faktura i ≤10 tys. zł/mc) od 1.01.2027; sankcje od 1.01.2027.

**Mechanika integracji (API KSeF 2.0):**
- Środowiska: TEST → DEMO (przedprodukcja) → PROD. Dokumentacja OpenAPI + SDK (Java/.NET) + przykłady: GitHub CIRFMF.
- Uwierzytelnienie: podpis XAdES (kwalifikowany/pieczęć/certyfikat KSeF) **lub token KSeF** → accessToken (JWT, kilkanaście minut) + refreshToken (do 7 dni).
- **Onboarding klienta — ścieżka A (MVP):** właściciel generuje w Aplikacji Podatnika token KSeF z uprawnieniem TYLKO "przeglądanie faktur" i wkleja go do Tapventory (kreator z instrukcją krok po kroku). Token bez daty ważności, odwoływalny natychmiast. Tapventory technicznie nie może niczego wystawić — argument bezpieczeństwa i sprzedażowy.
- **Ścieżka B (później):** klient nadaje uprawnienia podmiotowi (NIP Tapventory) jak biuru rachunkowemu; my uwierzytelniamy się własnym certyfikatem w kontekście klienta. Wymaga pieczęci kwalifikowanej po naszej stronie.
- Pobieranie: proces w tle co 15–30 min pyta o nowe faktury zakupowe → XML FA(3) → parser → `documents` + `document_lines` (status szkic) → ekran weryfikacji → księgowanie.
- Szczegóły techniczne: obowiązkowe szyfrowanie AES-256-CBC + RSAES-OAEP (klucz publiczny KSeF); limit 1 MB (3 MB z załącznikami); system sam pilnuje duplikatów po NIP+numer przez 10 lat.
- **Punkt decyzyjny:** SDK MF są w Java/.NET, nasze funkcje w TypeScript. Opcja (a) REST bezpośrednio z TS (preferowana; API to REST, krypto standardowe), opcja (b) mikroserwis .NET tylko do KSeF. Decyzja po tygodniu prototypu na TEST. Budżet czasu: **3 tygodnie**.

### 8.2 Architektura na całą UE

Wspólny mianownik: norma **EN 16931** (jednolita semantyka e-faktury). Projektujemy **kanoniczny model faktury** wewnątrz Tapventory + wymienne adaptery per kraj (interfejs `EInvoiceProvider`: `fetchNewInvoices()`, `parseToCanonical()`). Reszta aplikacji nie wie, skąd przyszła faktura.

| Kraj | Kanał | Format | Terminy |
|---|---|---|---|
| PL | API KSeF | FA(3) | obowiązuje (jw.) |
| DE | e-mail/Peppol | XRechnung, ZUGFeRD | odbiór obowiązkowy od 1.01.2025; wystawianie 2027–2028 |
| BE | Peppol | Peppol BIS | B2B od 1.01.2026 |
| FR | Plateformes Agréées | UBL/CII/Factur-X | 1.09.2026 odbiór wszyscy + wystawianie duzi/średni; 1.09.2027 mali |
| UE | ViDA | EN 16931 | transgranicznie do 2030 |

Decyzje: parser EN 16931 (UBL+CII) pokrywa DE/BE/FR jednym kodem; FA(3) osobno. Dostęp do sieci Peppol kupujemy u operatora (Access Point as a service) — nie budujemy własnego.

---

## 9. Skan foto/AI — kanał drugi

1. Tryb skanera dokumentów (VisionKit/ML Kit przez Expo): auto-wykrywanie krawędzi, prostowanie, kontrast.
2. Grupowanie stron przez człowieka: przyciski "następna strona tej faktury" / "nowa faktura"; AI dodatkowo alarmuje, gdy w jednej grupie widzi różne numery faktur.
3. Kompresja do ~0,3–0,5 MB/strona → prywatny Storage → rekord dokumentu "przetwarzanie" (użytkownik nie czeka).
4. **Kolejka zadań:** 1 dokument = 1 zadanie; wszystkie strony jednego dokumentu w jednym zapytaniu do modelu wizyjnego; wynik: JSON (dostawca, NIP, numer, data, pozycje, suma).
5. Kontrola duplikatów po NIP+numer (także krzyżowo z KSeF!).
6. Push "faktura gotowa do sprawdzenia" → **ekran weryfikacji**: dopasowanie pozycji (EAN → historia nazw → podobieństwo), zielone/żółte, nic nie księguje się automatycznie → "Zatwierdź" → ruchy typu przyjęcie.
7. **Edycja i korekty pomyłek.** Przed zaksięgowaniem (szkic): każde pole edytowalne (dostawca, numer, data; pozycje: nazwa/ilość/cena/jednostka/dopasowany produkt), dodawanie i usuwanie pozycji, powtórne zdjęcie strony, rozdzielanie/scalanie źle zgrupowanych stron. Po zaksięgowaniu: **zasada "nie gumkujemy — stornujemy"** — "Cofnij księgowanie" tworzy ruchy odwrotne (storno) i przywraca dokument do szkicu do poprawy; pojedynczą pozycję można skorygować punktowym ruchem korekty bez cofania całości; wszystko w audit_log. Każda ręczna poprawka dopasowania zapisuje się w słowniku aliasów ("Lakier hybr. czerw. 15ml" → Lakier OPI Red 15 ml) — system uczy się i następnym razem trafia sam.

Koszt: Gemini 2.5 Flash 0,15/1,25 USD za mln tokenów (wej./wyj.) → strona faktury < 1 gr; wielostronicowe — pojedyncze grosze.

---

## 10. Architektura techniczna

- **Aplikacja:** Expo (React Native, TypeScript), EAS Build (buildy iOS/Android w chmurze, Mac niepotrzebny). Design: własne komponenty w stylu iOS, drobne adaptacje Android.
- **Backend:** Supabase, region eu-central-1 (Frankfurt), jeden projekt multi-tenant: Postgres+RLS, Auth, Storage (prywatny), Realtime (czat, żywe listy), Edge Functions + kolejka (skany, KSeF, webhooki Stripe).
- **Usługi:** Gemini Flash (OCR/parsowanie), bramka SMS (Sendly ~0,075 zł/SMS pay-as-you-go lub SMSAPI 49 zł/mc abonament), Stripe (karty 1,5%+1 zł EOG; BLIK 1,6%+1 zł; P24 1,9%+1 zł), Resend/Postmark (mail), Sentry (błędy).
- **WWW:** landing + cennik + rejestracja + panel właściciela (billing) — Cloudflare Pages/Vercel + Stripe Checkout.
- **Offline (Etap 1.5):** PowerSync (SQLite lokalnie, synchronizacja dwukierunkowa). Warunki spełnione od dnia 1: UUID klienckie + append-only log ruchów.

---

## 11. Dystrybucja i płatności

- **Model "Netflixa":** subskrypcje sprzedajemy na www (Stripe Checkout), aplikacja tylko loguje. W aplikacji: zablokowane funkcje pokazujemy bez ceny i bez linku ("dostępne w wyższym planie"). Maile z rejestracji w aplikacji nie promują zakupu poza sklepem; maile z rejestracji na www — mogą.
- Podstawa: Apple 3.1.3(c) Enterprise Services (sprzedaż wyłącznie organizacjom → można poza IAP; sprzedaż konsumencka musiałaby przez IAP — dlatego Solo darmowe, rejestracja zawsze jako firma). Google lustrzanie (zmiany po Epic dotyczą tylko USA). UE po DMA: linki zewnętrzne możliwe na warunkach Apple — nie opieramy na tym modelu, weryfikacja przy submisji. **Plan B** przy odrzuceniu: dodać IAP (15% w Small Business Program) obok tańszej ceny www.
- **Lejek:** reklama/treści → www (cennik + rejestracja) → pobranie aplikacji. Panel właściciela na www (faktury!) jako naturalne miejsce cennika.
- **Konta:** Apple Developer 99 USD/rok. Google Play jako **organizacja** → wymagany **D-U-N-S**: sprawdź w wyszukiwarce D&B; jeśli brak (JDG nie są widoczne w wyszukiwarce) — bezpłatny formularz na dnb.com/pl-pl, nadanie ~5 dni roboczych wg PL oddziału (Google każe planować do 30 dni). Dane konta = dane w D&B co do znaku. **Wniosek w 1. tygodniu projektu.**

---

## 12. Cennik i ekonomia

### 12.1 Plany (netto; +23% VAT; rocznie −20%; trial 14 dni planu Zespół bez karty)

| Plan | PL | UE | Użytkownicy | Produkty | Skany foto AI | KSeF | Inne |
|---|---|---|---|---|---|---|---|
| Solo | 0 zł | 0 € | 1 | 150 | 5/mc (+paczka 20 szt./9 zł) | **bez limitu** | EAN bez limitu, projekty, CSV, TOTP, historia 12 mc |
| Start | 49 zł | 19 € | 3 | 1000 | 30/mc | bez limitu | SMS-2FA |
| Zespół | 99 zł | 39 € | 10 | bez limitu | 150/mc | bez limitu | priorytet wsparcia |

Benchmark: Sortly Advanced 49 USD (2 os./500 pozycji), Ultra 149 USD; BoxHero 20 USD/3 os. + 5 USD/user. VAT UE: odwrotne obciążenie dla firm z VAT-UE; Stripe Tax automatyzuje.

### 12.2 Koszty dostawców przy 1000 firm (~5000 userów; kurs ~3,75 zł/USD)

**Stałe ~110–290 USD ≈ 400–1100 zł/mc:** Supabase Pro 25 USD + compute (realnie 30–75 USD przy Small/Medium) + PITR 100 USD + środowisko testowe 0–25; Expo EAS 0–19; Sentry 0–26; e-mail ~20; www 0–20; Apple ~8.

**Zmienne ~2400–3600 zł/mc:** AI 100–300 zł (przy 25 tys. stron; KSeF = 0 zł); SMS 400–1200 zł (5–15 tys. × ~0,075 zł dzięki regule "tylko nowe urządzenie"); Stripe ~1900–2000 zł (prowizja od ~73 tys. zł brutto obrotu); nadwyżki Storage 0–100 zł.

**Suma: 3000–4700 zł/mc = 3–5 zł/firmę = 5–8% przychodu** (~59 tys. zł netto przy mixie 15% Solo / 50% Start / 35% Zespół). Nie obejmuje: ludzi, księgowości, prawnika, marketingu.

---

## 13. Program poleceń

Tabele: `referral_codes` (tenant, kod UNIQUE np. SALON-ANIA-7K2) · `referrals` (kod, polecony tenant, status registered→activated→rewarded) · `reward_ledger` (append-only: komu, ile dni, za co).

Przepływ: link `tapventory.com/r/KOD` prowadzi na **www** (spójne z lejkiem, prostsze niż atrybucja mobilna) → rejestracja zapisuje powiązanie → **żelazna zasada: nagroda dopiero po pierwszej OPŁACONEJ fakturze poleconego** (webhook Stripe) → obie strony +30 dni → realizacja: Stripe customer balance (kredyt na następną fakturę) lub kupon 100%/1 okres.

Antyfraud: ten sam NIP/karta/odcisk urządzenia = odrzut; limit nagród/mc; kod nie działa na własny tenant.

---

## 14. Etap 2 — marketplace B2B (założenia)

**Model:** odwrócony — kupujący publikuje zapytanie (RFQ; z `projects` dziedziczy kontekst: VIN, rejestracja, zlecenie), dostawcy składają oferty. **Rola: wyłącznie platformodawca** — umowa sprzedaży między stronami, fakturę wystawia sprzedawca (w KSeF), my fakturujemy tylko usługę pośrednictwa. **Wariant płatności A:** kupujący płaci dostawcy poza platformą (przelew na jego fakturę) — zero obowiązków instytucji płatniczej. Wariant B (później): Stripe Connect; własnego escrow nigdy.

**Przychody (3 strumienie):**
1. Abonament dostawcy: Podgląd 0 zł (RFQ z opóźnieniem 3 h, 5 odpowiedzi/mc) · **Handlowiec ~299 zł** (push w sekundę od publikacji zapytania z jego asortymentu/regionu — "wykupienie leadu" jako płacenie za szybkość, nie za kontakt; bez limitu) · Priorytet ~699 zł (wielu handlowców, statystyki, wyróżnienie).
2. Success fee: 1–3% netto wygranego zamówienia, cap ~400 zł (marże hurtowni 5–15% wykluczają model Allegro). Start: deklaratywnie przez status "wybieram ofertę".
3. Pay-per-unlock: 15–30 zł za pojedyncze zapytanie bez abonamentu.

**Anty-wzorzec (Oferteo):** nie sprzedajemy tego samego kontaktu 5–15 firmom w ciemno (kilkanaście–kilkaset zł/kontakt bez gwarancji) — to model zarabiający na frustracji dostawców.

**Transport:** parametr oferty (koszt, czas, dostawa własna w promieniu X km, odbiór, gratis od kwoty); porównywarka liczy cenę Z dostawą. Faza 2.1: broker kurierski (Furgonetka/Apaczka — etykieta z wygranej oferty). Nigdy: własna flota/magazyn.

**Prawo (do prawnika PRZED startem Etapu 2):** P2B (jawność kryteriów rankingu — abonament wpływający na szybkość dostępu opisujemy w regulaminie), DSA (punkt kontaktowy, zgłoszenia), DAC7 (raportowanie przychodów sprzedawców), RODO. W Etapie 1 wystarczy: nie budować niczego, co czyni nas sprzedawcą.

**Furtki zostawione w Etapie 1:** globalny `catalog_items` z EAN, encja `suppliers`, `projects` z numerami referencyjnymi, adres+geo firmy, statusy `requests`.

---

## 15. Side project (zaparkowany): "Zagroda" — sprzedaż z gospodarstwa

Zasada: **narzędzie najpierw, marketplace z gęstości.** Wersja 1 działa dla jednego rolnika bez żadnych kupujących w systemie: profil gospodarstwa = mini-sklep (link + QR na stoisko przy drodze), lista "dziś dostępne" edytowana w 30 s, zamówienia z okienkami odbioru/dowozem lokalnym, przycisk "udostępnij na grupie FB" (popyt już tam jest), SMS do stałych klientów, **ewidencja sprzedaży pod RHD z pilnowaniem limitów** (killer feature). Mapa "co dostępne w okolicy" dopiero przy 30+ gospodarstwach w powiecie; kotwiczni kupujący: restauracje i kooperatywy. Model: darmowe do ~30 zamówień/mc, potem ~29 zł; zero prowizji od żywności. Dlaczego poprzednicy padali: marketplace od razu (obie strony naraz), własna logistyka, zasięg ogólnopolski zamiast gęstości lokalnej. Osobna marka i aplikacja; wspólny silnik backendu. Decyzja: 2027+.

---

## 16. Harmonogram budowy (Etap 1)

| Tygodnie | Zakres |
|---|---|
| 1–2 | Fundament: Supabase (schemat + RLS od pierwszej tabeli), auth, rejestracja firmy, zaproszenia, role. **Równolegle: wniosek D-U-N-S, konta Apple/Google/Stripe/SMS.** |
| 3–4 | Katalog produktów, skaner EAN, "Zdejmij", progi + push |
| 5–6 | Zgłoszenia braków, cykl statusów, czat (Realtime) |
| 7–9 | Skan foto/AI: kolejka → model → ekran weryfikacji → księgowanie |
| 10–12 | **KSeF (3 tyg.):** prototyp na TEST → decyzja TS vs mikroserwis → kreator tokenu → pobieranie + parser FA(3) |
| 13 | Mini-inwentaryzacje (częstotliwość w konfiguracji + pytanie przy "Zdejmij"), CSV, audit, 2FA SMS + kody zapasowe, flagi uprawnień (managers/billing) |
| 14–16 | Asystent AI (wersja pomocowa), EAS Build → TestFlight/internal → 2–3 firmy pilotażowe → poprawki → publikacja (polityka prywatności, data safety, privacy labels) |

Realistycznie: **14–16 tygodni** do publicznej wersji dla jednej sprawnej osoby wspieranej AI.

---

## 17. Ryzyka i otwarte decyzje

1. **Recenzja Apple (3.1.3(c))** — możliwe odbicia; plan B: IAP 15% obok ceny www.
2. **KSeF: TS vs mikroserwis .NET** — decyzja po tygodniu prototypu (tydz. 10).
3. **Stabilność API KSeF 2.0** — system świeży; monitorować komunikaty MF, obsłużyć opóźnienia/awarie po ich stronie.
4. **Ceny leadów Etapu 2 (299/699 zł, 1–3%)** — hipotezy do walidacji na pierwszych 10 dostawcach.
5. **Koszt SMS przy nadużyciach** — rate limiting + monitoring od dnia 1.
6. **Nazwa aplikacji** — "Tapventory" traktujemy jako nazwę roboczą; właściciel projektu planuje nazwę docelową (do podania). Po ustaleniu: sprawdzenie domen (.pl/.com), znaku towarowego (UPRP/EUIPO) i kolizji nazw w App Store / Google Play — przed publikacją.

---

## 18. Słownik

**tenant_id** — identyfikator firmy w wielofirmowej bazie ("numer piętra w biurowcu"). **RLS** — reguły w samej bazie: firma widzi tylko swoje wiersze. **UUID v7** — losowy identyfikator generowany na telefonie (warunek offline), sortowalny po czasie. **TOTP** — kody jednorazowe z aplikacji (Google Authenticator), darmowe, odporne na podmianę SIM. **scaffold** — szkielet kodu z szablonu bez logiki produktu. **KSeF** — państwowy system, przez który przechodzą faktury B2B w Polsce. **FA(3)** — struktura XML polskiej e-faktury. **EN 16931** — europejska norma semantyki e-faktury. **Peppol** — europejska sieć wymiany e-dokumentów. **RFQ** — zapytanie ofertowe. **IAP** — zakupy w aplikacji (prowizja Apple/Google 15–30%). **PITR** — odtwarzanie bazy do dowolnej sekundy. **Edge Function** — mała funkcja uruchamiana na serwerze (klucze API nigdy na telefonie). **Append-only** — tabela, do której się tylko dopisuje. **D-U-N-S** — światowy 9-cyfrowy identyfikator firmy (Dun & Bradstreet), wymagany do konta organizacji Google Play.
