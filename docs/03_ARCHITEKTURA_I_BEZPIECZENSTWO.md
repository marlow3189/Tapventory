# 03 — Architektura i bezpieczeństwo

Dla kogo: dla osoby, która ma zmieniać kod. Wyjaśniam **dlaczego** coś jest zrobione tak, a nie inaczej, żebyś nie „naprawił” zabezpieczenia, które wygląda na zbędne.
Wszystko tu opisane jest sprawdzone testami (PostgreSQL 16 i 17; patrz `docs/06_TESTY_I_JAKOSC.md`), o ile nie napisano inaczej.

## 1. Obraz całości

```
┌────────────────────── Jeden kod (Expo / React Native / TypeScript) ──────────────────────┐
│  iPhone (IPA)        Android (AAB/APK)        Przeglądarka = PWA (statyczne pliki)       │
└──────────────────────────────────────────┬────────────────────────────────────────────────┘
                                           │ HTTPS: tylko klucz PUBLICZNY (anon/publishable) + JWT użytkownika
┌──────────────────────────────────────────▼────────────────────────────────────────────────┐
│ SUPABASE (region UE, Frankfurt)                                                           │
│  Auth (e-mail+hasło)  ·  Postgres + RLS + funkcje  ·  Storage (prywatny)  ·  Realtime     │
│  Edge Functions (Deno): process-document · assistant · barcode-lookup · ksef-connect ·    │
│                         ksef-sync · send-push · cron-tasks   ← tu żyją TAJNE klucze        │
└────────────┬───────────────────────┬───────────────────────┬──────────────────┬───────────┘
             ▼                       ▼                       ▼                  ▼
     Anthropic (odczyt faktur,   KSeF (MF): faktury    Open Food Facts     Expo Push
     asystent)                   zakupu, token         (nazwa po EAN)      (powiadomienia)
```

Kluczowe decyzje:

| Decyzja | Powód |
|---|---|
| **Bezpieczeństwo w bazie (RLS), nie w aplikacji** | aplikacja może mieć błędy, a ktoś może wołać API poza aplikacją; baza odmawia niezależnie od klienta |
| **Jeden projekt, wiele firm (multi‑tenant)**: każda tabela biznesowa ma `tenant_id` | prostsze i tańsze niż baza na firmę; izolacja wymuszona regułami, nie konwencją |
| **Stan magazynu = suma ruchów** (`stock_movements`), nie kolumna | dwa telefony dopisujące ruchy się nie nadpisują; pełna historia; gotowość pod tryb offline |
| **„Nie gumkujemy — stornujemy”** | księga ruchów jest tylko‑do‑dopisywania; cofnięcie to ruch odwrotny |
| **UUID generowane na kliencie** (v7) | warunek przyszłej pracy offline |
| **Tajne klucze tylko w Edge Functions** | klucz AI i klucz szyfrujący KSeF nie mogą być w telefonie ani w repozytorium |
| **Migracje nietykalne po wgraniu** | poprawka = nowy plik (porządek historii; baza produkcyjna nie może „zmienić przeszłości”) |

## 2. Migracje — co wnosi każda

| Plik | Zakres |
|---|---|
| `0001_init` | schemat: profile, firmy (`tenants`), członkostwa, zaproszenia, dostawcy, katalog globalny, produkty, projekty, dokumenty i pozycje, ruchy, zgłoszenia, czat, dziennik zdarzeń, polecenia, KSeF (szkielet) |
| `0002_rls` | włączenie RLS na **każdej** tabeli + polityki + prywatne buckety Storage |
| `0003_security_hardening` | poprawki z weryfikacji F1–F10 (`docs/05_RAPORT_WERYFIKACJI.md`) |
| `0004_requests_and_feeds` | cykl statusów zgłoszeń pilnowany triggerem, historia zmian, widoki dla feedu |
| `0005_document_statuses` | statusy `processing`, `failed` (osobny plik — ograniczenie enumów w Postgresie) |
| `0006_documents_posting_and_matching` | księgowanie / storno faktur, aliasy produktów, dopasowanie (`match_products`), widok listy dokumentów |
| `0007_counts_notifications_plans` | mini‑spisy, powiadomienia, plany i limity (Solo/Start/Zespół, próba 14 dni), użycie AI, pulpit (`dashboard_summary`) |
| `0008_votes_and_ledger_rules` | „ja też potrzebuję”; pracownik zapisuje tylko rozchód (przyjęcia to faktury) |
| `0009_storage_limits_and_service_tables` | limity i typy plików, cache EAN, limit asystenta, strażnik zawieszonych dokumentów |
| `0010_ai_pipeline` | zapis wyniku odczytu AI jedną transakcją, rezerwacja limitu, `fail_document` |
| `0011_ksef_integration` | połączenie z KSeF, blokada synchronizacji, import faktury bez duplikatów |
| `0012_pg17_maintain_privilege` | PostgreSQL 17 odbiera nowe uprawnienie `MAINTAIN` rolom aplikacji |
| `0013_ksef_honor_retry_after` | przerwa po 429 nie krótsza niż `Retry-After` |
| `0014_ai_feedback_snapshot` | migawka odczytu maszynowego i `ai_correction_report` |

## 3. Role i uprawnienia

Trzy role + dwie flagi (`memberships`):

| Co | Pracownik | Kierownik | Kierownik + flaga zarządzania kierownikami | Właściciel |
|---|:-:|:-:|:-:|:-:|
| Zdejmowanie towaru, zgłoszenia, komentarze, „ja też”, mini‑spis | ✅ | ✅ | ✅ | ✅ |
| Przyjęcia magazynowe (ręczne i z faktur), korekty stanu | ❌ | ✅ | ✅ | ✅ |
| Produkty, progi, dostawcy, zlecenia | ❌ | ✅ | ✅ | ✅ |
| Faktury (skan, KSeF, księgowanie, ceny zakupu) | ❌ — nie widzi ich nawet w API | ✅ | ✅ | ✅ |
| Zaproszenia pracowników | ❌ | ✅ | ✅ | ✅ |
| Zaproszenia kierowników / zmiana ich uprawnień | ❌ | ❌ | ✅ | ✅ |
| Połączenie KSeF (token) | ❌ | ❌ (widzi stan i może wymusić synchronizację) | ❌ | ✅ |
| Właściciele, NIP firmy, usunięcie firmy | ❌ | ❌ | ❌ | ✅ |
| Flaga `can_manage_billing` (np. księgowa) | niezależnie od roli, nadaje tylko właściciel | | | ✅ |

Zasady wymuszone w bazie: ostatniego właściciela nie da się usunąć ani zdegradować; właściciela dodaje tylko właściciel; jedno konto może być właścicielem najwyżej 5 firm; limity planu (osoby, produkty, skany AI) egzekwują triggery, nie aplikacja.

## 4. Jak działa RLS w praktyce

* Funkcje pomocnicze `is_member(t)`, `can_manage(t)`, `is_owner(t)`, `can_manage_managers(t)`, `can_manage_billing(t)` zwracają **zawsze `true`/`false`, nigdy `NULL`**. To lekcja z błędu F1: w SQL `if not NULL then raise …` **nie rzuca wyjątku**, więc nieczłonek przechodził kontrolę. Każda nowa funkcja uprawnień musi mieć tę samą własność (test w `02_security_regressions`).
* Polityki są napisane na `authenticated`; `anon` (niezalogowany) nie ma w ogóle żadnych uprawnień do tabel ani funkcji (poprawka F10).
* `service_role` (backend) omija RLS — dlatego jego klucz mieszka wyłącznie w sekretach Edge Functions. Funkcje rozpoznają wywołanie z backendu po tym, że `auth.uid()` jest `NULL` (token service_role nie ma `sub`).
* Złożone klucze obce `(tenant_id, id)` gwarantują, że rekord firmy A nie wskaże rekordu firmy B (poprawka F6).
* Kolumny, których klient nie może zmieniać, chronią uprawnienia kolumnowe i triggery: `plan`, `trial_ends_at`, `ksef_number`, `ai_extraction`, status zgłoszeń (tylko dozwolone przejścia), status `posted` (tylko `post_document`/`unpost_document`).

### 4.1 Powierzchnia API (jedyne funkcje wołane przez aplikację)

`accept_invite`, `accept_invite_code`, `ai_quota`, `create_invite`, `create_photo_document`, `create_tenant`, `dashboard_summary`, `delete_account`, `delete_tenant`, `disconnect_ksef`, `get_invite_preview`, `get_ksef_status`, `match_products`,
`next_count_candidates`, `post_document`, `record_stock_check`, `register_push_token`, `retry_document`, `revoke_invite`, `set_billing_flag`, `set_manager_flag`, `set_tenant_nip`, `should_ask_count`, `unpost_document`
— plus funkcje pomocnicze używane w politykach (`is_member`, `can_manage`, …).
**Test `01_invariants` porównuje tę listę z rzeczywistością bazy** i czerwienieje, jeśli pojawi się jakakolwiek nowa funkcja dostępna dla zalogowanych. Dodanie funkcji do listy ma być **świadomą decyzją**.

Funkcje tylko dla backendu (REVOKE od `public`, `anon`, `authenticated`; GRANT do `service_role`): `apply_document_extraction`, `fail_document`, `reserve_ai_scan`, `finish_ai_scan`, `reap_stuck_documents`, `queue_count_reminders`, `notify_*`, `claim_ksef_sync`, `finish_ksef_sync`, `save_ksef_connection`,
`due_ksef_tenants`, `ksef_known_numbers`, `import_ksef_invoice`, `ai_correction_report`, `bump_assistant_usage` i inne.

### 4.2 Macierz uprawnień do tabel

Test `01_invariants` zawiera dokładną listę „która tabela — jakie operacje — dla zalogowanych”. Przykłady: `stock_movements` — tylko `INSERT, SELECT` (nie ma `UPDATE`/`DELETE`: księga jest tylko‑do‑dopisywania);
`requests` — bez `DELETE`; tabele `ksef_*`, `barcode_cache`, `assistant_usage` — **żadnych** uprawnień dla aplikacji. Zmiana macierzy zawsze wymaga zmiany testu, więc nie zdarzy się przypadkiem.

## 5. Reguły pisania funkcji w bazie (lista kontrolna)

1. `language plpgsql` (lub `sql`) + `security definer` **tylko gdy trzeba**; zawsze `set search_path = public` (bez tego ktoś mógłby podłożyć własny obiekt o tej samej nazwie).
2. Pierwsza linia: sprawdzenie uprawnień przez `can_manage(…)`/`is_owner(…)`; komunikat błędu po polsku, kod `P0001`.
3. **`revoke execute … from public, anon, authenticated`**, a potem jawny `grant` tylko dla tych ról, które mają wołać. (Postgres domyślnie daje `EXECUTE` wszystkim — to źródło wielu wycieków.)
4. Nowa tabela: `enable row level security`, polityki, `revoke` zbędnych uprawnień, wpis w teście macierzy; jeśli tabela tylko‑dopisywana — trigger `forbid_change()`.
5. Funkcja, która zmienia dane wielu tabel, robi to w jednej transakcji (funkcja = transakcja) — np. `post_document`, `apply_document_extraction`, `import_ksef_invoice`.
6. Test: sukces, odmowa dla innej firmy, odmowa dla roli, powtórne wywołanie (idempotencja).
7. **Nie edytuj starej migracji** — nowy plik z kolejnym numerem; sprawdź na PostgreSQL 16 **i** 17 (`0012` powstała, bo 17 odebrał uprawnienie `MAINTAIN`).

## 6. Pliki (Storage)

* Dwa prywatne buckety: `documents` (faktury, do 10 MB; JPEG/PNG/WebP/PDF) i `product-photos` (produkty i zgłoszenia, do 5 MB; JPEG/PNG/WebP).
* Ścieżka zawsze zaczyna się od `tenant_id/…`; polityki na `storage.objects` sprawdzają członkostwo i rolę po ścieżce. Aplikacja pokazuje pliki przez **podpisane, wygasające linki**.
* Aplikacja zmniejsza zdjęcia przed wysłaniem (dokument: 1800 px, JPEG 75%; produkt: 1280 px, 70%).

## 7. Edge Functions

Szczegóły i wdrożenie: `supabase/functions/README.md`. Wspólne zasady:

* `verify_jwt = false` w `config.toml` — **każda** funkcja użytkownika w pierwszej instrukcji wywołuje `auth.getUser(token)` i odrzuca żądanie bez ważnej sesji (401). Powód: nowe projekty używają asymetrycznych kluczy JWT, których stara bramka nie obsługuje.
  `send-push` i `cron-tasks` chroni nagłówek `x-cron-secret` (sekret `CRON_SECRET`).
* Architektura: `*/handler.ts` (logika z wstrzykiwanymi zależnościami → testy w Node), `*/index.ts` (cienkie podpięcie `Deno.serve`), `_shared/runtime.ts` (jedyne miejsce z prawdziwymi klientami Supabase i Anthropic).
* Odpowiedzi błędów są czytelne po polsku, bez szczegółów technicznych; logi **nie zawierają** treści faktur ani tokenów.
* Limity: odczyt faktur — limit planu (`reserve_ai_scan`) + jeden odczyt naraz; asystent — 30 pytań dziennie na osobę; KSeF — jedna synchronizacja naraz, odstępy między próbami, wycofanie po błędzie.

## 8. Bezpieczeństwo — co jest, a czego brakuje

| Zagrożenie | Obrona | Stan |
|---|---|:-:|
| Dostęp do cudzych danych | RLS na każdej tabeli, złożone klucze obce, testy przeciwko F1–F10 | ✅ |
| Podniesienie uprawnień (np. pracownik → właściciel) | funkcje uprawnień bez `NULL`, triggery na rolę/flagi, ochrona ostatniego właściciela | ✅ |
| Wyciek klucza service_role | tylko w sekretach funkcji; `.env` w `.gitignore`; włącz na GitHubie *secret scanning* (Settings → Code security) | ✅ (proces) |
| Wyciek tokenu KSeF | AES‑256‑GCM z AAD firmy, klucz poza bazą; token tylko do odczytu | ✅ |
| Wstrzyknięcie poleceń w dokumencie (prompt injection) | dokument = dane niezaufane, odpowiedź zamknięta schematem, kod sprawdza, człowiek zatwierdza | ✅ |
| XML‑owe ataki (XXE, „bomby”) przy fakturach KSeF | własny, ścisły parser: odrzuca DOCTYPE, instrukcje przetwarzania, nieznane encje, limity głębokości/rozmiaru | ✅ |
| Nadużycie kosztów (AI) | limity planu, atomowa rezerwacja, limit asystenta, limit wydatków u dostawcy | ✅ |
| Nadmiar plików | limity rozmiaru/typu na poziomie bucketów | ✅ |
| Usunięcie danych (RODO, Apple 5.1.1(v)) | `delete_account`, `delete_tenant` (po wpisaniu nazwy) — testy F4; profil anonimizowany, ślad w księdze zostaje | ✅ |
| Atak siłowy na hasła | limity Supabase Auth (`config.toml` → `[auth.rate_limit]`), hasło ≥ 8 znaków | ✅ (domyślne) |
| Dwuskładnikowe logowanie (TOTP, SMS przy nowym urządzeniu), kody zapasowe | koncepcja rozdz. 7 | ❌ **nie zbudowane** |
| Alert „logowanie z nowego urządzenia”, zdalne wylogowanie urządzeń | koncepcja rozdz. 7 | ❌ |
| Captcha przy rejestracji | | ❌ (rozważ przy pierwszych nadużyciach) |
| Ochrona darmowych okresów przed nadużyciem (NIP, odcisk karty) | koncepcja rozdz. 7 — częściowo: NIP firmy jest chroniony przed zmianą przez kierownika; reszta wymaga Stripe | ◐ |
| Kopie zapasowe i odtwarzanie | Supabase Pro (dzienne, 7 dni) + PITR jako dodatek | ❓ do włączenia na PROD |
| Dziennik zdarzeń (`audit_log`) | tabela tylko‑do‑dopisywania, wpisy z kluczowych operacji; **brak ekranu** w aplikacji | ◐ |
| Monitoring błędów (Sentry itp.) | | ❌ (brak SDK; patrz `docs/01_KOLEJKA_BUDOWY.md`) |
| Pentest / przegląd zewnętrzny | | ❌ |

> Jeśli dodasz SDK analityczne, reklamowe lub monitorujące, **zaktualizuj** deklaracje prywatności w sklepach i politykę prywatności (`docs/12_*`, rozdz. 5.2).

## 9. Wydajność (krótko)

* Listy w aplikacji pobierają dane stronami (PostgREST zwraca maks. 1000 wierszy — `api.max_rows`; `fetchAll` dociąga resztę), widoki (`request_feed`, `product_overview`, `document_overview`) zastępują kilka zapytań jednym.
* Pulpit = jedno wywołanie `dashboard_summary`. Realtime tylko tam, gdzie widać „na żywo” (zgłoszenia, czat, powiadomienia, faktury).
* Indeksy na `(tenant_id, …)` w tabelach; unikalne indeksy częściowe pilnują duplikatów faktur (`documents_duplicate_guard`, `documents_ksef_number_key`).
* Nie mierzyłem obciążenia (brak środowiska); pierwszy test: 10 firm × 5 użytkowników na projekcie Pro.
