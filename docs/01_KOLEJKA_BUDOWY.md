# Kolejka budowy Tapventory

Stan na **9.10.2026**. Numeracja kroków jak w dokumencie koncepcyjnym (rozdz. 16). Szczegółowa tabela „koncepcja → stan” jest w `docs/Tapventory_dokument_koncepcyjny_v1.md`, rozdz. 19; wyniki weryfikacji — w `docs/05_RAPORT_WERYFIKACJI.md`.

Legenda: ✅ zrobione i przetestowane automatycznie · ◐ częściowo · ❌ nie zrobione · ⏳ czeka na Ciebie.
**Uwaga:** „zrobione” oznacza testy automatyczne (baza na PostgreSQL 16/17, funkcje, interfejs w Chromium na makiecie). **Żywe usługi (Supabase, KSeF, Anthropic, sklepy) i telefony nie były sprawdzane.**

## 1. Co jest zbudowane

- [x] **Krok 1 — Fundament:** schemat bazy + RLS, logowanie, rejestracja, firma, pulpit. Poprawione luki bezpieczeństwa F1–F10 (`0003`).
- [x] **Krok 2 — Zespół:** ekran zespołu, zaproszenia kodem (`ABCD-EFGH`), role, flagi uprawnień, wiele firm na koncie.
- [x] **Krok 3 — Produkty i magazyn:** katalog, siatka, skaner EAN (natywny i w przeglądarce), „Zdejmij” w 2 dotknięcia, historia ruchów, minima, korekty, mini‑spisy, **eksport CSV** (stany, ruchy, faktury — otwiera się w polskim Excelu).
- [x] **Krok 4 — Zgłoszenia braków + czat:** feed w stylu Instagrama, statusy z historią, serce „ja też tego potrzebuję”, komentarze na żywo (Realtime), powiadomienia.
- [x] **Krok 5 — Dokumenty foto + AI:** skan do 10 stron/PDF, odczyt Claude z kontrolą kodem, ekran weryfikacji, dopasowanie produktów i aliasy, księgowanie, storno, limity planów, zgoda na AI, asystent „jak to zrobić”.
- [x] **Krok 6 — KSeF:** klient API 2.0, parser FA(2)/FA(3), sejf na token, synchronizacja z limitami MF, ekran połączenia. ⏳ **Weryfikacja na żywo** (`docs/10_KSEF.md`, rozdz. 7).
- [◐] **Krok 7 — Inwentaryzacje + bezpieczeństwo:** mini‑spisy ✅; **TOTP, SMS przy nowym urządzeniu, kody zapasowe, alert nowego urządzenia ❌**.
- [ ] **Krok 8 — WWW + płatności:** strona, cennik, Stripe, panel właściciela, program poleceń ❌ (tabele poleceń w bazie są). Do czasu wdrożenia płatności plan zmieniasz ręcznie (`docs/02_*`, rozdz. 9).
- [◐] **Krok 9 — Sklepy:** konfiguracja EAS, ikony, listy kontrolne, szablony prawne ✅; konta, zrzuty, publikacja ⏳.

Dodatki ponad pierwotny plan: zestaw ewaluacyjny AI (`eval/`), pętla zwrotna jakości (`ai_correction_report`), PWA, CI, testy bazy na PostgreSQL 16 i 17, dokumentacja (ten katalog).

## 2. Co dalej — w kolejności

Szacunki czasu to **moje zgadywanie** dla jednej osoby z pomocą AI; traktuj jako rząd wielkości.

### P0 — zanim pokażesz aplikację pierwszemu klientowi

| # | Zadanie | Czas | Jak |
|---|---|---|---|
| 1 | Wdrożyć bazę i funkcje na projekt Supabase, przejść etapy 3–5 instrukcji | pół dnia | `docs/00_*` |
| 2 | **Żywy test KSeF** (ścieżka A: produkcja, własny token tylko do odczytu) | pół–1 dzień | `docs/10_KSEF.md`, rozdz. 7 |
| 3 | **Pomiar jakości AI:** `npm run eval:run` + 20 zanonimizowanych prawdziwych faktur | pół dnia + 1–3 USD | `docs/09_*`, rozdz. 6–7 |
| 4 | Własny serwer poczty (SMTP), „Confirm email”, Redirect URLs | 1–2 godz. | `docs/02_*`, rozdz. 8 |
| 5 | Polityka prywatności, regulamin, strona usuwania konta na `tapventory.com` + przegląd prawnika | 1–3 dni | `docs/prawne/` |
| 6 | Monitoring błędów (np. Sentry) i alerty kosztów AI; **po dodaniu SDK zaktualizuj deklaracje prywatności** | pół–1 dzień | `docs/12_*`, rozdz. 5.2 |
| 7 | Plan Pro, PITR, kopie kluczy w menedżerze haseł, test odtworzenia | 1–2 godz. | `docs/02_*`, rozdz. 8 |
| 8 | Test PWA na prawdziwych telefonach (Android, iPhone) i wdrożenie na hosting | pół dnia | `docs/13_*` |

### P1 — zanim ktokolwiek zapłaci

| # | Zadanie | Czas |
|---|---|---|
| 9 | **Stripe + strona www** (cennik, rejestracja, panel właściciela, faktury; webhooki ustawiają plan funkcją `set_tenant_plan`; nagroda za polecenie dopiero po opłaconej fakturze) | 1–2 tygodnie |
| 10 | **2FA:** TOTP (MFA Supabase) + kody zapasowe; SMS przy nowym urządzeniu; alert e‑mail; zdalne wylogowanie | ok. tygodnia |
| 11 | Budowa natywna, TestFlight i testy wewnętrzne Google Play, test na urządzeniach; push (APNs automatycznie, Android: Firebase) | 2–3 dni + czekanie na konta |
| 12 | **Web Push** dla PWA (projekt w `docs/13_*`, rozdz. 5.2) | 1–2 dni |
| 13 | Ekran dziennika zdarzeń, raport „koszt materiałów na zlecenie” (eksport CSV stanów, ruchów i faktur jest już zrobiony) | 2–4 dni |
| 14 | Eksport danych użytkownika (RODO) | ok. 2 dni |
| 15 | Rozstrzygnięcie ryzyka Apple 3.1.3(c): rozmowa o modelu płatności / plan B z zakupami w aplikacji | zależnie od recenzji |

### P2 — rozwój

| # | Zadanie | Uwagi |
|---|---|---|
| 16 | **Tryb offline** (PowerSync) — Etap 1.5 | architektura (UUID klienckie, księga ruchów) gotowa |
| 17 | KSeF: eksport paczek `/invoices/exports` dla dużych wolumenów, stały adres wychodzący, „ścieżka B” (uprawnienia dla podmiotu), biuro rachunkowe z wieloma NIP | po pierwszych klientach z dużym wolumenem |
| 18 | Peppol / EN 16931 (DE, BE, FR) | koncepcja rozdz. 8.2 |
| 19 | **Marketplace B2B** — Etap 2 | prawnik **przed** startem (P2B, DSA, DAC7) |
| 20 | Pytania asystenta o dane firmy (Etap 1.5 asystenta) | w granicach RLS pytającego |

### P3 — pomysły z badania rynku i interfejsu

Druk etykiet z kodami, ciągły skan wielu kodów, integracje z programami do faktur (Fakturownia, wFirma, iFirma — odczyt kontrahentów), przegląd dostępności z czytnikiem ekranu, animacje. Szczegóły: `docs/07_UI_I_STYL.md`, rozdz. 7, i `docs/04_*`, rozdz. 2.

## 3. Zadania po Twojej stronie (równolegle, dziś)

- [ ] wniosek o **D‑U‑N‑S** (`dnb.com/pl-pl`) — czeka się od dni do tygodni;
- [ ] konto **Apple Developer** (99 USD/rok) i **Google Play Console** (25 USD) — gdy dojdziesz do etapów 8–9 instrukcji;
- [ ] konta: Supabase, Expo, Anthropic (limit wydatków!), hosting PWA, poczta transakcyjna;
- [ ] domena `tapventory.com` ✅ kupiona — ustaw DNS pod `app.tapventory.com` (`docs/13_*`);
- [ ] sprawdzenie nazwy „Tapventory” w sklepach i w UPRP/EUIPO (znak towarowy) przed publikacją;
- [ ] weryfikacja cen i warunków z listy ❓ w `docs/04_*`, rozdz. 7;
- [ ] przegląd prawny dokumentów z `docs/prawne/`.

## 4. Zasady pracy (żeby nie zepsuć tego, co działa)

1. **Migracje są nietykalne po wgraniu** na wspólny projekt — poprawka to nowy plik.
2. **Nowa funkcja/tabela** → lista kontrolna z `docs/03_*`, rozdz. 5 + aktualizacja testu inwariantów.
3. **Zmiana polecenia AI, modeli, progów** → `npm run eval:run` przed wdrożeniem.
4. **Zmiana tekstu w aplikacji** (nazwa przycisku, ekran) → popraw instrukcję asystenta (`supabase/functions/_shared/app-manual.ts`).
5. **Zmiana planu/cennika** → trzy miejsca naraz: `plan_limits()` w bazie, `mobile/src/lib/plans.ts`, instrukcja asystenta + koncepcja rozdz. 12.
6. Przed commitem: zestaw z `docs/06_*`, rozdz. 2.
