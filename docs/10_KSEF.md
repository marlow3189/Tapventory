# 10 — KSeF w Tapventory: jak działa, jak go uruchomić, jak sprawdzić na żywo

> **Status uczciwie:** cały kod (baza, funkcje, parser, ekran w aplikacji) jest przetestowany **na symulowanym serwerze KSeF**
> (prawdziwe szyfrowanie RSA‑OAEP, prawdziwy PostgreSQL 16 i 17). **Nie rozmawiał jeszcze z prawdziwym serwerem Ministerstwa Finansów** — nie miałem
> do niego dostępu. Kształty żądań i odpowiedzi wziąłem z oficjalnego OpenAPI i dokumentacji MF (GitHub: `CIRFMF/ksef-docs`, wersje z 5.05.2026 i 14.09.2026).
> Rozdział 7 to lista kontrolna pierwszego żywego uruchomienia — **zrób ją, zanim obiecasz funkcję klientom**.

---

## 1. Co to robi (po ludzku)

* Właściciel firmy raz **wkleja token KSeF** (nadany wyłącznie z uprawnieniem *przeglądanie faktur*) w Tapventory: Ustawienia → Integracje → **KSeF**.
* Co kilka godzin Tapventory loguje się tym tokenem do KSeF, pobiera **nowe faktury zakupu** (te, w których Twoja firma jest nabywcą) i zamienia je w **szkice dokumentów** z pozycjami.
* Kierownik sprawdza szkic (pozycje, przypisanie do produktów) i klika **Zaksięguj** — towar wchodzi na stan. Nic nie księguje się samo.
* Tapventory **nie umie niczego wystawić ani wysłać** w KSeF: token nie ma takiego uprawnienia. To argument bezpieczeństwa i sprzedażowy.
* Ta sama faktura nie wejdzie dwa razy: jeśli ktoś wcześniej zrobił jej zdjęcie, Tapventory **dopina numer KSeF** do istniejącego dokumentu (ten sam NIP dostawcy + numer faktury).

## 2. Słowniczek

| Pojęcie | Znaczenie |
|---|---|
| **KSeF** | Krajowy System e‑Faktur — państwowy system, przez który przechodzą faktury ustrukturyzowane |
| **Token KSeF** | tajny ciąg znaków, którym można zalogować się do API zamiast podpisu elektronicznego; ma **niezmienny** zestaw uprawnień nadany przy tworzeniu (zmiana = nowy token) |
| **Kontekst** | NIP firmy, w imieniu której działamy; token jest wydany w kontekście konkretnego NIP‑u |
| **Środowiska** | `TEST` (dane próbne, wspólne dla wielu integratorów), `DEMO` (przedprodukcja), `PROD` (prawdziwe faktury) |
| **Numer KSeF** | unikalny numer faktury nadany przez system, np. `5260250995-20260105-ABCDEF123456-AF` (ostatnie 2 znaki to suma kontrolna CRC‑8 — sprawdzamy ją) |
| **FA(2) / FA(3)** | struktury XML polskiej e‑faktury; obsługujemy obie (starsze faktury bywają FA(2)) |
| **PermanentStorage / HWM** | data trwałego zapisu faktury w KSeF; „High Water Mark” to moment, poniżej którego lista jest kompletna i już się nie zmieni — nasz kursor |

## 3. Architektura

```
 telefon / PWA                    Supabase                                      KSeF (MF)
 ┌──────────────┐  JWT   ┌───────────────────────────┐
 │ Ustawienia → │───────►│ ksef-connect (właściciel) │──auth+test odczytu────►  api.ksef.mf.gov.pl/v2
 │ KSeF         │        │   • AES‑256‑GCM(token)    │
 │              │───────►│ ksef-sync (kierownik)     │──lista metadanych────►   POST /invoices/query/metadata
 └──────────────┘        │ cron-tasks (co minutę)    │──pobranie XML────────►   GET  /invoices/ksef/{numer}
                         │   → start_due_syncs       │
                         └──────────┬────────────────┘
                                    ▼
          baza: ksef_integrations (szyfrogram tokenu, kursor, status) · ksef_sync_runs (historia 50 przebiegów)
                ksef_raw_invoices (surowy XML ≤ 4 MB + SHA‑256) · documents / document_lines (szkice)
                import_ksef_invoice() = jedna transakcja: dokument + pozycje + dopasowanie produktów
```

Gdzie co leży w repozytorium:

| Warstwa | Pliki |
|---|---|
| baza | `supabase/migrations/0011_ksef_integration.sql`, `0013_ksef_honor_retry_after.sql` |
| klient API | `supabase/functions/_shared/ksef/client.ts` (uwierzytelnienie, lista, pobranie), `crypto.ts`, `types.ts` |
| parser faktur | `_shared/ksef/fa-parser.ts`, `_shared/xml.ts` (surowy, ostrożny parser XML) |
| synchronizacja | `_shared/ksef/sync.ts` |
| sejf tokenu | `_shared/ksef/token-vault.ts` |
| funkcje | `ksef-connect/`, `ksef-sync/`, `cron-tasks/` |
| ekran | `mobile/src/app/(app)/settings/ksef.tsx`, `mobile/src/lib/ksef.ts`, `mobile/src/lib/api/ksef.ts` |
| testy | `supabase/functions/tests/ksef-*.test.ts` (89 testów funkcji), `supabase/tests/09_ksef.test.mjs`, `10_ksef_end_to_end.test.mjs` (25 testów bazy) |

## 4. Instrukcja dla klienta (właściciela firmy): jak wygenerować token

> Nazwy menu w państwowej aplikacji mogą się zmieniać — szukaj słowa „token”. Ten sam opis jest w aplikacji (Ustawienia → KSeF → „Połącz KSeF”).

1. Wejdź na **ksef.podatki.gov.pl** (oficjalna strona Ministerstwa Finansów) i przejdź do **Aplikacji Podatnika KSeF** (przycisk logowania).
2. Zaloguj się jak do e‑urzędu: **Profil Zaufany**, podpis kwalifikowany, podpis osobisty lub certyfikat KSeF (to metody, które API KSeF wymienia: `TrustedProfile`, `QualifiedSignature`, `PersonalSignature`, `InternalCertificate`).
3. Wybierz **kontekst: swoją firmę** (NIP musi być ten sam, który wpisano w Tapventory).
4. Otwórz sekcję **Tokeny** (zwykle w menu uprawnień/dostępu) → **Generuj/Utwórz token**.
5. Zaznacz **wyłącznie „Przeglądanie faktur”** (w API: `InvoiceRead`). **Nie** zaznaczaj wystawiania faktur ani zarządzania uprawnieniami. W opisie wpisz „Tapventory”.
6. Skopiuj token **w całości** (KSeF pokazuje go **tylko raz**) i wklej w Tapventory. Świeży token aktywuje się po chwili — jeśli aplikacja go odrzuci, odczekaj minutę i spróbuj ponownie.
7. Wybierz, od kiedy pobierać faktury (domyślnie 30 dni wstecz; maks. 5 lat) i dotknij **Połącz**.

Uprawnienie do wygenerowania tokenu ma właściciel firmy w KSeF albo osoba, która sama ma uprawnienie do przeglądania faktur. Księgowa zwykle ma — poproś ją o wygenerowanie tokenu **w kontekście Twojej firmy**.

**Odłączenie:** w Tapventory (Ustawienia → KSeF → Odłącz) usuwamy zapisany szyfrogram i przestajemy pobierać. **Token nadal działa w KSeF**, dopóki go tam nie unieważnisz (Aplikacja Podatnika → Tokeny → unieważnij) — aplikacja przypomina o tym w oknie potwierdzenia.

## 5. Instrukcja dla Ciebie (administratora): uruchomienie po stronie serwera

Zakładam, że masz już projekt Supabase i działające migracje (`docs/02_START_LOKALNY.md`).

1. **Wygeneruj klucz szyfrowania tokenów** (raz; PowerShell lub cmd, w katalogu repozytorium):

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Wynik (44 znaki, kończy się zwykle `=`) wklej do `supabase/functions/.env` jako `KSEF_TOKEN_KEY=...`. **Zrób kopię w menedżerze haseł.**
   Zgubisz klucz = wszystkie zapisane tokeny przestaną działać (klienci wkleją je ponownie). Plik `.env` jest w `.gitignore` — nie trafi do repozytorium.
2. Wyślij sekrety i wdróż funkcje: `npx supabase secrets set --env-file supabase/functions/.env` oraz `npx supabase functions deploy` (szczegóły i harmonogram: `supabase/functions/README.md`).
3. Ustaw **harmonogram** wywołujący `cron-tasks` co minutę (bez niego nie ruszy automatyczne pobieranie). Panel Supabase albo GitHub Actions — opis w `supabase/functions/README.md`.
4. Sprawdź w aplikacji: Ustawienia → Integracje → KSeF → ma być widoczny kreator.

### Rotacja klucza `KSEF_TOKEN_KEY`

1. Wygeneruj nowy klucz (jak wyżej).
2. Ustaw sekret jako **`nowy,stary`** (przecinek, bez spacji): `KSEF_TOKEN_KEY=NOWY_BASE64,STARY_BASE64`. Nowe zapisy szyfrują pierwszym kluczem, odczyt próbuje wszystkich.
3. Stary klucz **musi zostać na liście**, dopóki istnieją tokeny zaszyfrowane nim. **Nie ma automatycznego przeszyfrowania** — token przejdzie na nowy klucz dopiero, gdy klient połączy KSeF ponownie. To świadome uproszczenie na start.
4. Jeśli podejrzewasz wyciek klucza: zmień klucz, poproś klientów o ponowne połączenie i **unieważnienie starych tokenów w KSeF** (sam klucz nie unieważnia tokenów w KSeF).

### Bezpieczeństwo tokenu (jak to jest zrobione)

* Szyfrowanie **AES‑256‑GCM**, format `v1.<IV>.<szyfrogram+tag>`, **AAD = identyfikator firmy**: skopiowanie szyfrogramu do wiersza innej firmy nic nie da.
* Klucz żyje tylko w sekretach Edge Functions — baza (i kopie zapasowe) widzą wyłącznie szyfrogram.
* Token nie trafia do logów ani do odpowiedzi funkcji. Aplikacja zna tylko „podpowiedź” (ostatnie znaki).
* Tabele `ksef_*` nie mają żadnych uprawnień dla ról `anon`/`authenticated` — dostęp tylko przez funkcje z kluczem serwisowym; testy `01_invariants` pilnują tej macierzy.
* Do logowania do KSeF token jest dodatkowo szyfrowany **kluczem publicznym MF** (RSA‑OAEP SHA‑256, certyfikat o przeznaczeniu `KsefTokenEncryption`) razem ze znacznikiem czasu.

## 6. Jak działa synchronizacja (algorytm)

1. **Zajęcie miejsca** (`claim_ksef_sync`): w jednej chwili pracuje najwyżej jedna synchronizacja na firmę. Odstępy: ręczna ≥ 2 min od poprzedniej próby, automatyczna ≥ 3 h (lub wycofanie po błędzie).
2. **Logowanie:** `GET /security/public-key-certificates` (certyfikat MF, pamiętany 1 h) → `POST /auth/challenge` → szyfrowanie `token|znacznik_czasu_ms` → `POST /auth/ksef-token` → odpytywanie statusu → `POST /auth/token/redeem` (token dostępowy).
3. **Lista faktur zakupu** (`subjectType: Subject2`) po dacie trwałego zapisu, **rosnąco**, okna po maks. 90 dni (limit API to 100), strony po 100.
4. **Dla każdej nowej faktury** (numeru KSeF jeszcze nie ma w bazie): pobranie XML → parser FA → `import_ksef_invoice` (jedna transakcja). Odstęp **4 s** między pobraniami (limit minutowy MF to 16).
5. **Kursor** (`cursor_at`): normalnie = High Water Mark z KSeF; przy przerwaniu = data ostatniej w pełni przetworzonej faktury; jeśli jakiejś nie dało się zapisać, kursor nie przekracza jej daty (następna próba ją znajdzie). Kursor **nigdy nie cofa się**; powtórne zobaczenie tej samej faktury jest nieszkodliwe.
6. **Budżet:** 100 s i 300 faktur na przebieg; po przekroczeniu przebieg kończy się jako „częściowy” i wraca po ≥ 2 min.
7. **Ograniczenie tempa (429):** klient czeka krótki `Retry-After` (≤ 20 s), dłuższy przerywa przebieg; **następna próba nie wcześniej niż po `Retry-After`** (maks. 2 h; migracja 0013).
8. **Odrzucony token** (unieważniony, innej firmy, bez uprawnień): status „Wymaga uwagi”, automat zatrzymany, **jedno** powiadomienie dla właściciela i kierowników.

### Oficjalne limity i co z nich wynika

| Zasób (PROD, na parę NIP + adres IP) | req/s | req/min | req/h |
|---|---:|---:|---:|
| `POST /invoices/query/metadata` (lista) | 8 | 16 | **20** |
| `GET /invoices/ksef/{numer}` (pobranie) | 8 | 16 | **64** |
| `POST /invoices/exports` (paczki) | 8 | 16 | 20 |

* **Pierwszy import dużej zaległości trwa godziny** (64 faktury/h). To nie błąd — dlatego domyślnie pobieramy tylko 30 dni, a kreator pozwala wybrać „tylko nowe”.
* MF zaleca odpytywać nie częściej niż co 15 minut na podmiot, a przy małym wolumenie — na żądanie i raz na dobę. Nasz automat: co ≥ 3 h.
* Wyższe limity obowiązują w nocy (20:00–06:00), wartości mają być dostrojone przez MF.
* Przy dużym wolumenie MF zaleca eksport paczek (`/invoices/exports`) — **jeszcze tego nie implementujemy** (rozdz. 9).
* Limity są liczone **osobno dla adresu IP**; funkcje Supabase mogą wychodzić z różnych adresów, a MF zastrzega, że systematyczne omijanie limitów wieloma adresami IP jest traktowane jako zagrożenie. Przy skali rozważ stały adres wychodzący.
* TEST ma limity 10× wyższe niż PROD, DEMO takie same jak PROD.

### Co dzieje się z fakturą

| Sytuacja | Efekt |
|---|---|
| zwykła faktura FA(2)/FA(3) | szkic z pozycjami; stawki VAT, EAN (jeśli jest w XML), ilości z przecinkiem dziesiętnym |
| pozycja bez ilości | ilość = 1 + ostrzeżenie |
| **korekta** | pozycje jako *różnica* (po − przed); korekta samej ceny bez zmiany ilości jest pomijana (nie zmienia stanu) |
| faktura zaliczkowa | typ „inny”, bez automatycznego wpływu na stan |
| pozycje niebędące towarem (transport, usługa) | oznaczone jako pomijane |
| PEF, FA_RR, uszkodzony XML, formularz niewspierany | dokument z samym nagłówkiem (dostawca, numer, kwoty) + ostrzeżenie, żeby uzupełnić ręcznie |
| ta sama faktura wcześniej zeskanowana zdjęciem | **dopięcie** numeru KSeF do istniejącego dokumentu (także zaksięgowanego) — zamiast duplikatu |
| ten sam numer KSeF drugi raz | pomijany (unikalny indeks `(tenant_id, ksef_number)`) |

Surowy XML każdej faktury zachowujemy w `ksef_raw_invoices` (do wglądu administratora i ewentualnego ponownego przetwarzania), razem z sumą SHA‑256.

## 7. Co sprawdzić na żywo (pierwsze uruchomienie) — lista kontrolna

### Ścieżka A (najprostsza, zalecana): produkcja z własnym tokenem tylko do odczytu

Bezpieczna, bo token ma wyłącznie `InvoiceRead` — niczego nie zmieni. Użyj **swojej** firmy (NIP w Tapventory = NIP, dla którego wygenerowano token).

1. Wdróż funkcje i ustaw `KSEF_TOKEN_KEY` (rozdz. 5).
2. W aplikacji: Ustawienia → KSeF → wygeneruj token wg rozdz. 4 → środowisko **Produkcja** → zakres **„Ostatnie 30 dni”** → **Połącz**.
3. Oczekiwany przebieg: „Trwa pobieranie…” → po kilkudziesięciu sekundach „Pobrano N nowych faktur” (albo „Brak nowych faktur”, jeśli w ostatnich 30 dniach nic nie kupowałeś).
4. Otwórz 2–3 faktury w Dokumentach: porównaj z podglądem w Aplikacji Podatnika KSeF — **dostawca, NIP, numer, data, kwoty, pozycje (ilość, cena, stawka VAT)**. Zapisz każdą rozbieżność, najlepiej z numerem KSeF.
5. Sprawdź **korektę** i fakturę w **EUR** (jeśli taka jest w zakresie) oraz fakturę z pozycją bez ilości.
6. Kliknij **Synchronizuj teraz** drugi raz: ma być „Brak nowych faktur”, a liczba dokumentów nie rośnie (test braku duplikatów).
7. Zrób zdjęcie papierowej faktury, która jest też w KSeF → po synchronizacji dokument ze zdjęcia dostaje numer KSeF (test dopięcia, `linked`).
8. Zaksięguj jedną fakturę, potem „Cofnij księgowanie” (storno) — stan wraca.
9. **Unieważnij token w KSeF** i kliknij Synchronizuj: ma pojawić się status „Wymaga uwagi” i powiadomienie; po wklejeniu nowego tokenu praca wraca.

W Supabase (Table Editor) zajrzyj do `ksef_sync_runs` (kolumny `listed/imported/linked/skipped/failed/error`) oraz do logów funkcji (Edge Functions → `ksef-sync` → Logs; zobaczysz kody błędów, nie treść faktur).

### Ścieżka B (dla ostrożnych / testów automatycznych): środowisko TEST

TEST zawiera dane próbne wspólne dla wszystkich integratorów — **używaj losowych NIP‑ów, nigdy prawdziwych**. Token na TEST uzyskuje się przez API po uwierzytelnieniu certyfikatem **samopodpisanym** (oficjalne biblioteki
[ksef-client-csharp](https://github.com/CIRFMF/ksef-client-csharp) / [ksef-client-java](https://github.com/CIRFMF/ksef-client-java) generują taki certyfikat) — to zadanie programistyczne na pół dnia. Skrócony przebieg:

1. Wylosuj poprawny NIP (jedna linia, wynik wklej do notatnika):

   ```powershell
   node -e "const w=[6,5,7,2,3,4,5,6,7];for(;;){const d=Array.from({length:9},()=>Math.floor(Math.random()*10));if(d[0]===0)continue;const s=d.reduce((a,x,i)=>a+x*w[i],0)%11;if(s===10)continue;console.log(d.join('')+s);break}"
   ```
2. Przykładami z bibliotek MF: utwórz osobę/podmiot (`/testdata/person` lub `/testdata/subject`), uwierzytelnij się certyfikatem samopodpisanym, wystaw kilka faktur sprzedaży **na ten NIP jako nabywcę** i wygeneruj token z `InvoiceRead` (`POST /tokens`).
3. W Tapventory wybierz środowisko **Test** (Zaawansowane), wpisz ten NIP i token.

Uwaga: na TEST trwają cykliczne prace serwisowe (16:00–18:00), a dozwolone formaty to FA(2) i FA(3).

### Kryteria „działa”

* bez błędów w `ksef_sync_runs` przy 3 kolejnych przebiegach,
* 0 duplikatów w `documents` (zapytanie: `select tenant_id, ksef_number, count(*) from documents where ksef_number is not null group by 1,2 having count(*) > 1;` → pusty wynik),
* kwoty netto/brutto faktur w Tapventory = kwoty w KSeF (do 1 gr),
* po unieważnieniu tokenu — komunikat i brak dalszego pukania do KSeF.

## 8. Błędy i co znaczą

| Komunikat w aplikacji | Przyczyna | Co zrobić |
|---|---|---|
| „Token nie ma żadnych uprawnień…” | token wygenerowany bez „Przeglądanie faktur” | wygeneruj nowy z `InvoiceRead` |
| „Token został unieważniony w KSeF” | ktoś go unieważnił | nowy token → Połącz ponownie |
| „Ten token należy do innej firmy…” | NIP w Tapventory ≠ kontekst tokenu | popraw NIP (Ustawienia) albo wygeneruj token w kontekście właściwej firmy |
| „Token jest jeszcze nieaktywny…” | świeży token (status *Pending*) albo wygasł | poczekaj minutę; jeśli nie pomoże — nowy token |
| „KSeF nie rozpoznał tokenu…” | skopiowano ze spacją / ucięty | skopiuj w całości (aplikacja usuwa białe znaki) |
| „KSeF chwilowo ogranicza liczbę zapytań” | HTTP 429 | nic — poczekamy zgodnie z `Retry-After` |
| „KSeF chwilowo nie odpowiada” | awaria po stronie MF | nic — ponowimy z wycofaniem 5 min → 6 h |
| „KSeF nie przyjął zaszyfrowanego tokenu — błąd po naszej stronie” | zmiana certyfikatu/algorytmu przez MF | sprawdź `docs/` MF i `_shared/ksef/crypto.ts`; zgłoś |
| „Nie można odszyfrować zapisanego tokenu” (w logu) | zmieniony `KSEF_TOKEN_KEY` | przywróć klucz albo poproś klienta o ponowne połączenie |
| status „Wymaga uwagi” bez komunikatu | auth odrzucone | otwórz ekran KSeF, przeczytaj „ostatni błąd” |

## 9. Ograniczenia i plan rozwoju

| Temat | Stan |
|---|---|
| Faktury **sprzedaży** (wystawianie) | **nie robimy** — świadomie; token tylko do odczytu |
| Eksport paczek `/invoices/exports` dla dużych wolumenów | nie zaimplementowane; potrzebne, jeśli klient ma tysiące faktur miesięcznie |
| Biuro rachunkowe z wieloma NIP‑ami (jeden login → wiele firm) | nie; jedna integracja = jeden NIP |
| „Ścieżka B”: nadanie uprawnień podmiotowi (NIP Tapventory) zamiast tokenu klienta | później; wymaga naszego certyfikatu/pieczęci |
| Załączniki do faktur | ignorowane (ostrzeżenie w dokumencie) |
| Przeszyfrowanie tokenów po rotacji klucza | brak (patrz rozdz. 5) |
| Stały adres wychodzący (IP) | do rozważenia przy skali |
| Inne kraje UE (Peppol, EN 16931) | koncept w `Tapventory_dokument_koncepcyjny_v1.md`, rozdz. 8.2 |
| Sprawdzenie „na żywo” | **do zrobienia** — rozdz. 7 |

## 10. Źródła

* Przewodnik integratora KSeF 2.0 (MF): <https://github.com/CIRFMF/ksef-docs> — m.in. *Uwierzytelnianie*, *Tokeny KSeF*, *Pobieranie faktur*, *Limity*, *Środowiska*, *Dane testowe*.
* Specyfikacja OpenAPI: <https://api-test.ksef.mf.gov.pl/docs/v2>.
* Biblioteki referencyjne MF: [ksef-client-csharp](https://github.com/CIRFMF/ksef-client-csharp), [ksef-client-java](https://github.com/CIRFMF/ksef-client-java).
* Strona informacyjna MF: <https://ksef.podatki.gov.pl> (etapy wdrożenia, aplikacja podatnika).
