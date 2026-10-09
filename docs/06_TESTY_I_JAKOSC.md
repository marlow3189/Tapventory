# 06 — Testy i jakość

## 1. Filozofia: gdzie testujemy, bo tam mieszka ryzyko

| Ryzyko | Gdzie leży | Jak testujemy |
|---|---|---|
| bezpieczeństwo danych i reguły biznesowe | **baza** (RLS, funkcje, triggery) | testy na **prawdziwym PostgreSQL** (Node + `pg`): każdy plik dostaje świeżą bazę zbudowaną z migracji — to samo, co `supabase db reset` |
| odczyt faktur, KSeF, asystent, push, harmonogram | **funkcje serwerowe** | logika w `handler.ts` z wstrzykiwanymi zależnościami → testy w Node bez sieci i bez kluczy; te same testy pod Deno |
| rachunki, formaty, walidacje w aplikacji | **czyste moduły** `mobile/src/lib` | Jest (sekundy) |
| „czy ekrany w ogóle działają” | **interfejs** | test dymny w prawdziwym Chromium na makiecie backendu |
| jakość odczytu faktur | **model AI** | zestaw `eval/` (syntetyczne dokumenty) + raport poprawek z produkcji (`docs/09_*`) |

Zasada: **błąd bezpieczeństwa wykrywa test na bazie, nie recenzja „na oko”.** Usterki F1–F10 były niewidoczne w lekturze kodu, a test je pokazał (`docs/05_RAPORT_WERYFIKACJI.md`).

## 2. Wszystkie polecenia w jednym miejscu

Polecenia uruchamiasz w **folderze głównym** (`C:\projekty\tapventory`), chyba że napisano inaczej.

| Polecenie | Co sprawdza | Czas | Wymaga |
|---|---|---|---|
| `npm run db:test` | **testy bazy**: migracje 0001…0015, RLS, role, funkcje, KSeF end‑to‑end, pętla zwrotna AI (118 testów) | kilka sekund | działający PostgreSQL (rozdz. 3) |
| `npm run api:contract` | **kontrakt aplikacja ↔ baza**: czyta kod aplikacji kompilatorem TypeScript, wyciąga każde `supabase.from(…)` i `supabase.rpc(…)` i sprawdza je z prawdziwym schematem (tabele, kolumny, uprawnienia, argumenty funkcji, klucze obce, cele `upsert`); ma własne testy z celowo błędnym kodem | ~5 s | PostgreSQL jak dla `db:test` + `npm install` w `mobile` |
| `npm run fn:test` | **funkcje serwerowe** w Node (154 testy): potok AI, KSeF (klient, parser, synchronizacja), asystent, push, harmonogram | ~10 s | tylko Node |
| `npm run fn:typecheck` | typy TypeScript funkcji | ~15 s | `mobile` po `npm install` |
| `npm run fn:deno-check` | **te same funkcje pod prawdziwym Deno** (typy wszystkich siedmiu `index.ts`) | ~1 min (pierwszy raz pobiera Deno) | internet |
| `npm run fn:deno-test` | testy funkcji uruchomione przez Deno | ~30 s | internet |
| `npm run eval:test` | spójność zestawu ewaluacyjnego AI (14 testów) | kilka sekund | Node |
| `npm run eval:typecheck` | typy zestawu `eval/` | kilka sekund | |
| `npm run eval:dry` | rura odczytu na **atrapie** (bez kluczy i kosztów) | ~10 s | po `npm run eval:generate` |
| `npm run eval:run` | prawdziwy pomiar modeli (**kosztuje 1–3 USD**) | minuty | klucz Anthropic |
| `cd mobile` → `npm test` | testy jednostkowe aplikacji (Jest, 78 testów) | ~2 s | |
| `cd mobile` → `npm run typecheck` | typy TypeScript aplikacji | ~30 s | |
| `cd mobile` → `npm run lint` | ESLint (Expo) | ~30 s | |
| `cd mobile` → `npx expo export --platform web` (i `android`, `ios`) | pakowanie aplikacji dla trzech platform bez budowania natywnego — łapie błędne importy i brakujące zasoby | ~1–2 min każde | |
| `node mobile/scripts/ui-smoke/run.mjs mobile/dist ui-smoke-out` | test dymny interfejsu w Chromium (po `npm run build:web`) | ~1 min | `npx playwright install chromium` |

Liczby testów rosną z czasem — ważne, żeby było **zero niepowodzeń**.

### Zestaw „przed commitem” (5 minut)

```powershell
npm run fn:test
npm run api:contract        # gdy ruszałeś zapytania do bazy w aplikacji albo schemat (wymaga PostgreSQL)
npm run fn:typecheck
cd mobile
npm run typecheck
npm run lint
npm test
cd ..
```

Testy bazy odpal, gdy ruszałeś `supabase/migrations` lub funkcje SQL (albo zostaw to CI — rozdz. 4).

## 3. Testy bazy: skąd wziąć PostgreSQL

Szczegółowo w `docs/02_START_LOKALNY.md`, rozdz. 6. Skrót:

* **GitHub Actions** (bez instalowania czegokolwiek): wypchnij gałąź, zakładka **Actions** → zadanie „Baza”.
* **PostgreSQL w Windows** (instalator EDB, wersja 16 lub 17) i zmienna `TEST_DATABASE_URL` (PowerShell: `$env:TEST_DATABASE_URL = "postgres://postgres:HASLO@127.0.0.1:5432/postgres"`).
* **Lokalny Supabase** (Docker): domyślny adres testów to jego baza (port 54322).

Każdy plik testowy tworzy tymczasową bazę `tv_test_…` (wymaga uprawnień superużytkownika) i usuwa ją na koniec; przy błędzie migracji `createTestDb` sam po sobie sprząta.
Testy przechodzą na **PostgreSQL 16.15 i 17.5** — gdy testujesz na wersji 17+, pamiętaj o migracji `0012` (uprawnienie `MAINTAIN`).

### Pokaż, że usterki były prawdziwe: zatrzymaj bazę na wybranej migracji

```powershell
$env:TEST_MIGRATE_UP_TO = "0002"
node --test supabase/tests/02_security_regressions.test.mjs      # 18 z 19 czerwonych — to fundament z paczki
Remove-Item Env:TEST_MIGRATE_UP_TO
node --test supabase/tests/02_security_regressions.test.mjs      # wszystkie zielone
```

## 4. CI (GitHub Actions)

Plik `.github/workflows/ci.yml`, uruchamiany przy każdym pushu i pull requeście. Sześć zadań:

| Zadanie | Co robi |
|---|---|
| **Baza** | usługa PostgreSQL 17 → `npm ci` → `npm run db:test` |
| **Kontrakt** | usługa PostgreSQL 17 → `npm run api:contract` (zapytania aplikacji vs schemat bazy) |
| **Funkcje + eval** | `fn:test`, `fn:typecheck`, `eval:test`, `eval:typecheck` |
| **Deno** | `fn:deno-check`, `fn:deno-test` |
| **Aplikacja** | `typecheck`, `lint`, `test`, eksport web, Android i iOS |
| **Interfejs** | build web + test dymny w Chromium, zrzuty ekranów jako artefakt (7 dni) |

Czerwony krzyżyk przy commicie = któryś krok się nie powiódł → kliknij, rozwiń krok, przeczytaj pierwszy błąd (zwykle pierwszy czerwony wiersz jest przyczyną, reszta to skutki).
**Uwaga:** workflow nigdy nie był uruchomiony w prawdziwym GitHub Actions (poprawny YAML, polecenia sprawdzone lokalnie) — pierwszy przebieg może wymagać drobnych poprawek.

## 5. Jak napisać test

### Test bazy (`supabase/tests/NN_nazwa.test.mjs`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, ownerWithTenant, addMember, asUser, signUp, expectError } from './helpers.mjs';

let db;
test.before(async () => { db = await createTestDb(); });
test.after(async () => { await db.drop(); });

test('obcy użytkownik nie może … ', async () => {
  const A = await ownerWithTenant(db, 'XYZ');              // użytkownik + firma, sesja właściciela w A.session
  const intruder = await signUp(db, { name: 'Intruz' });
  await expectError(asUser(db, intruder).query(`select public.moja_funkcja($1)`, [A.tenantId]), /Brak uprawnień/);
});
```

Pomocniki (`supabase/tests/helpers.mjs`): `createTestDb` (świeża baza + `bootstrap.sql` udający Supabase + migracje + seed), `signUp` (konto jak przy rejestracji), `asUser` (zapytania jako zalogowany — odtwarza to, co robi PostgREST: `SET LOCAL ROLE authenticated` + token JWT, więc **RLS działa jak dla aplikacji**),
`asAnon`, `asService` (jak funkcja serwerowa z kluczem service_role), `ownerWithTenant`, `addMember`, `insertProduct`, `expectError`. Połączenie `db.admin` jest superużytkownikiem — tylko do przygotowania danych i sprawdzania skutków ubocznych.

**Zawsze testuj:** sukces • odmowę dla obcej firmy • odmowę dla niższej roli • powtórne wywołanie (idempotencja) • przypadki brzegowe (puste dane, `NULL`).
**Nowa funkcja lub tabela?** Zaktualizuj `01_invariants.test.mjs` (lista funkcji dostępnych dla zalogowanych, macierz uprawnień, tabele „tylko backend”) — test celowo czerwienieje, dopóki tego nie zrobisz.

### Test funkcji serwerowej (`supabase/functions/tests/*.test.ts`)

Funkcje mają wstrzykiwane zależności (`deps`), więc test podaje atrapy (baza, model, KSeF): zobacz `tests/helpers.ts` i `tests/ksef-fixtures.ts` (symulator serwera KSeF z prawdziwym odszyfrowaniem). Uruchamiasz go zwykłym `node --test` (Node ≥ 22.18 uruchamia pliki `.ts` bez dodatkowych narzędzi).

### Test aplikacji (`mobile/src/lib/__tests__/*.test.ts`)

Piszemy je dla czystej logiki (formaty, rachunki, walidacja NIP/EAN, statusy, KSeF). Ekrany sprawdza test dymny.

### Kontrakt aplikacja ↔ baza — po co i jak czytać wynik

Aplikacja i baza łączą się wyłącznie **nazwami** (tabel, kolumn, funkcji, argumentów). Literówka nie wywala kompilacji — wywala się u klienta. Dlatego `supabase/contract/` czyta kod aplikacji (AST kompilatora TypeScript, razem z typami argumentów — np. `Partial<TenantSettings>`) i porównuje go ze schematem zbudowanym z migracji.
Wynik wypisuje liczby sprawdzonych elementów i **listę „niezweryfikowanych”** (zapytania zbudowane dynamicznie, których nie da się odczytać statycznie) — przeczytaj ją przy każdej większej zmianie. Plik `checker.test.mjs` zawiera celowo błędny kod i dowodzi, że sprawdzacz wykrywa literówki, brak uprawnień, zły cel `upsert` i brak klucza obcego.
Czego nie sprawdza: logiki RLS (robią to testy w `supabase/tests`) ani zachowania prawdziwego PostgREST/Supabase (patrz rozdz. 7).

## 6. Test dymny interfejsu

Opis, uruchomienie i ograniczenia: `docs/07_UI_I_STYL.md`, rozdz. 6. Pamiętaj: działa na **makiecie** backendu (`mock-backend.mjs`) — gdy zmieniasz zapytania do bazy w aplikacji, zaktualizuj makietę.

## 7. Co NIE jest testowane (jawna lista)

| Obszar | Jak to nadrobić |
|---|---|
| prawdziwy Supabase (Auth, Storage, Realtime, Edge Runtime) | ręczny przebieg z `docs/00_*`, etap 4–5; baza jest testowana na zwykłym PostgreSQL z „udawanym Supabase” (`bootstrap.sql`) |
| prawdziwy KSeF | `docs/10_KSEF.md`, rozdz. 7 |
| prawdziwe modele AI | `npm run eval:run`, `ai_correction_report` |
| natywne iOS/Android, push na urządzeniu, aparat, skaner natywny | testy ręczne na telefonach (`docs/12_*`) |
| dostępność (czytniki ekranu) | przegląd ręczny |
| wydajność pod obciążeniem | test na projekcie Pro z kilkoma firmami |
| bezpieczeństwo „z zewnątrz” (pentest) | zlecić przed publikacją dla płatnych klientów |

## 8. Lista kontrolna wydania

- [ ] CI zielone na gałęzi wydania (wszystkie sześć zadań)
- [ ] `npm run eval:run` wykonany po ostatniej zmianie polecenia/modeli, wyniki zapisane
- [ ] migracje wgrane na projekt TEST, przebieg ręczny z `docs/00_*` (etapy 4–5) bez czerwonych komunikatów
- [ ] sekrety funkcji ustawione (`ANTHROPIC_API_KEY`, `CRON_SECRET`, `KSEF_TOKEN_KEY`), harmonogram działa
- [ ] lista kontrolna sklepów z `docs/12_*`, rozdz. 6
- [ ] kopia kluczy w menedżerze haseł, PITR włączony na PROD
