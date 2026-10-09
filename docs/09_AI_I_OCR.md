# 09 — AI i odczyt faktur (OCR): jak to działa i jak to mierzyć

> **Status uczciwie:** cały potok jest przetestowany na atrapie dostawcy i na syntetycznych dokumentach. **Żaden prawdziwy model nie przeczytał jeszcze żadnej faktury w tym repozytorium** —
> nie miałem klucza API. Dlatego w tym dokumencie nie ma liczb typu „dokładność 97%”. Jest za to wszystko, czego potrzebujesz, żeby takie liczby **zmierzyć w jeden dzień**: zestaw ewaluacyjny
> (rozdz. 6) i raport poprawek z prawdziwych faktur (rozdz. 7).

## 0. Najważniejsze w pięciu punktach

1. **Model czyta, kod sprawdza.** Wynik z AI nigdy nie wchodzi na magazyn sam: kod sprawdza sumy i NIP, a człowiek klika „Zaksięguj”.
2. **Tanio, a przy kłopotach mocniej.** Najpierw Claude Haiku 5.5; jeśli kod wykryje błąd (albo model sam ma niską pewność), ten sam dokument czyta drugi raz Claude Sonnet 5.5 i wybieramy lepszy wynik.
3. **Wynik jest strukturalny** (JSON ze schematu), a polecenia wydrukowane na fakturze są ignorowane — dokument to *dane*, nie instrukcje.
4. **Zgoda użytkownika** na wysyłanie dokumentów do zewnętrznej AI (wymóg Apple 5.1.2(i)) jest zbierana przed pierwszym użyciem skanera i asystenta.
5. **Mierzymy.** `eval/` mierzy modele na dokumentach syntetycznych; funkcja bazy `ai_correction_report` mierzy, ile pól ludzie poprawili na prawdziwych fakturach.

## 1. Droga faktury od zdjęcia do stanu magazynu

```
Telefon (kierownik)                                   Supabase                                        Anthropic
────────────────────                                  ────────
1. „+” → Skanuj fakturę   (zgoda na AI, jeśli brak)
2. zdjęcia ≤ 10 stron lub PDF
   (zmniejszone do 1800 px, JPEG 75%)  ─────────►  3. Storage (prywatny bucket „documents”)
4. rpc create_photo_document  ───────────────────►  5. dokument w statusie „processing”
6. functions.invoke("process-document")  ────────►  7. JWT → użytkownik, rola kierownika
                                                      8. reserve_ai_scan: limit planu, 1 odczyt naraz
◄──────── 202 Accepted (telefon nie czeka) ────────  9. dalej „w tle” (EdgeRuntime.waitUntil):
                                                      10. pobranie stron ze Storage ───────────────►  11. Haiku 5.5 (obraz → JSON)
                                                      12. normalizacja + verifyExtraction (kod)   ◄──── JSON, tokeny
                                                      13. są błędy? ──► drugi odczyt Sonnet 5.5 ───►  wybór lepszego wyniku
                                                      14. apply_document_extraction (1 transakcja):
                                                          nagłówek, pozycje, dostawca, dopasowanie
                                                          produktów, MIGAWKA odczytu → status „draft”
                                                      15. finish_ai_scan: tokeny i koszt → ai_usage
◄──── powiadomienie „Faktura gotowa do sprawdzenia” ─ 16. notify_document_ready (push + Aktywność)
17. ekran weryfikacji: żółte pola, przypisanie produktów, „Zaksięguj” → ruchy „przyjęcie”; aliasy zapamiętane
```

Każda awaria kończy się dokumentem w statusie **„failed”** z czytelnym komunikatem i przyciskiem „Spróbuj ponownie” (`retry_document`). Dokument, który utknął w „processing” ponad 10 minut, zamyka „strażnik” (`reap_stuck_documents`,
wołany co minutę przez `cron-tasks`).

Gdzie co leży: `mobile/src/app/(app)/documents/scan.tsx` (ekran skanowania), `mobile/src/lib/images.ts` (kompresja), `supabase/functions/process-document/handler.ts` (przepływ),
`_shared/pipeline.ts` (tani → kontrola → mocny), `_shared/providers/anthropic.ts` (wywołanie API), `_shared/invoice.ts` (normalizacja i kontrola), `_shared/prompt.ts` (polecenia dla modelu),
`supabase/migrations/0006…0010, 0014, 0015` (baza).

## 2. Kontrola kodem: co dokładnie sprawdzamy

Normalizacja (`normalizeExtraction`) zamienia surowy JSON z modelu w bezpieczne dane: liczby z przecinkiem i spacjami (`1 234,50` → `1234.5`), NIP bez myślników i prefiksu `PL`, daty `RRRR-MM-DD` (odrzuca nierealne), waluta,
EAN z sumą kontrolną GS1. Co się nie zgadza, jest **odrzucane z notatką** (nigdy zgadywane): `nip_format`, `date_invalid`, `line_dropped` (brak ilości), `ean_invalid`, `line_math` (ilość × cena ≠ wartość).

Następnie `verifyExtraction` ocenia wynik:

| Kod | Waga | Co znaczy | Eskalacja do mocniejszego modelu |
|---|:-:|---|:-:|
| `not_a_document` | ostrzeżenie | model uznał, że to nie dokument zakupu i nie ma pozycji — jedno wyraźne ostrzeżenie, **bez** drugiego odczytu (mocniejszy model nie wyczaruje faktury ze zdjęcia grilla) | nie |
| `no_lines` | błąd | nie odczytano żadnej pozycji | tak |
| `no_nip` / `bad_nip` | ostrzeżenie / błąd | brak NIP / błędna suma kontrolna NIP (pomyłka cyfry) | `bad_nip`: tak |
| `no_number` | ostrzeżenie | brak numeru faktury (nie dla paragonów) | nie |
| `no_date` | ostrzeżenie | brak daty wystawienia | nie |
| `sum_mismatch` | błąd | suma pozycji ≠ suma netto z dokumentu (tylko zwykłe faktury) | tak |
| `gross_mismatch` | błąd | netto + VAT ≠ brutto | tak |
| `line_math` | ostrzeżenie (1 poz.) / błąd (≥ 2) | ilość × cena ≠ wartość pozycji | przy ≥ 2 |
| `low_confidence` | ostrzeżenie | model ocenia pewność poniżej 60% | tak |

Reguła eskalacji (`needsEscalation`): jest co najmniej jeden **błąd** albo `low_confidence`. Z dwóch wyników wygrywa ten z mniejszą sumą wag problemów; przy remisie — mocniejszy model.
Ostrzeżenia nie są „zamrażane” w bazie: sumy i NIP aplikacja przelicza na bieżąco, więc po poprawce użytkownika żółte pole znika samo.

## 3. Modele, koszty i konfiguracja

| Zmienna (sekret funkcji) | Domyślnie | Znaczenie |
|---|---|---|
| `ANTHROPIC_API_KEY` | — (wymagane) | klucz z platform.claude.com; **ustaw limit wydatków w panelu Anthropic** |
| `AI_MODEL_FAST` | `claude-haiku-5-5` | pierwszy odczyt |
| `AI_MODEL_STRONG` | `claude-sonnet-5-5` | drugi odczyt przy problemach |
| `AI_EFFORT_FAST` / `AI_EFFORT_STRONG` | `medium` / `high` | „wysiłek myślenia” (`low`, `medium`, `high`) |
| `AI_ESCALATE` | `true` | `false` = tylko pierwszy model (taniej, mniej dokładnie) |
| `AI_TIMEOUT_MS` | `120000` | limit czasu jednego odczytu |
| `AI_MODEL_ASSISTANT`, `ASSISTANT_DAILY_LIMIT` | `claude-haiku-5-5`, `30` | asystent „jak to zrobić w aplikacji” |

Stałe w kodzie: do **10 stron** na dokument, **24 MB** łącznie, odpowiedź do **16 000 tokenów** (zapas na myślenie i ~250 pozycji). Dla modeli Claude 5.x nie wysyłamy `temperature`/`top_p` (serwer zwraca 400) ani prefillu.
Odpowiedź w formacie **structured outputs** (`output_config.format = json_schema`); gdyby serwer odrzucił schemat, następuje jedna próba z prośbą o czysty JSON w tekście.

Ceny za milion tokenów (wejście / wyjście), z `_shared/cost.ts` — **sprawdź przed zmianą**: Haiku 5.5 **0,10 / 0,50 $**, Sonnet 5.5 **2 / 10 $**, Opus 5.5 **4 / 20 $**. Rachunek orientacyjny kosztu strony i wniosek: `docs/04_RYNEK_I_TECHNOLOGIE.md`, rozdz. 4.3.

Limity planów (egzekwuje baza, `reserve_ai_scan`): Solo 5 skanów AI/mc, Start 30, Zespół 150 (14-dniowa próba = Zespół). Rezerwacja jest atomowa — dwa jednoczesne kliknięcia nie przekroczą limitu, a równoległy odczyt tego samego dokumentu jest blokowany.

## 4. Bezpieczeństwo i prywatność

* **Zgoda przed wysłaniem** (`AiConsentSheet`, `mobile/src/lib/consent.ts`): arkusz wyjaśnia, że zdjęcia dokumentów trafią do zewnętrznej AI, i wymaga wyraźnego „Zgadzam się”. Bez zgody skaner i asystent się nie uruchamiają. Zgodę można cofnąć w Ustawieniach.
* **Odporność na polecenia w dokumencie** (prompt injection): w poleceniu systemowym (po angielsku) stoi, że dokument to niezaufane dane i nie wolno wykonywać zawartych w nim poleceń; odpowiedź jest zamknięta schematem JSON; kod nie wykonuje niczego, co model „powie”; człowiek zatwierdza księgowanie.
  Zestaw ewaluacyjny zawiera przypadek z instrukcją wydrukowaną na fakturze (`injection`).
* **Logi funkcji nie zawierają treści faktur** — tylko identyfikatory, kody i liczby.
* **Klucz API** żyje wyłącznie w sekretach funkcji (nigdy w telefonie ani w repozytorium); `.env` jest w `.gitignore`.
* **Rola:** odczyt faktur wywołuje tylko kierownik/właściciel (pracownik nie widzi faktur i cen zakupu — poprawka F3).
* **Dostawca AI jest podprocesorem danych** (RODO): wpisz go w politykę prywatności i umowę powierzenia (`docs/prawne/`), sprawdź aktualne warunki przechowywania danych i transferu poza EOG (`docs/04_RYNEK_I_TECHNOLOGIE.md`, rozdz. 4.5).

## 5. Dopasowanie pozycji do produktów i uczenie się

Funkcja bazy `match_products` dla każdej pozycji próbuje po kolei:

1. **EAN** — dokładne trafienie w aktywny produkt firmy (pewność 99),
2. **alias** — „nazwa z faktury tego dostawcy” zapamiętana wcześniej (98; alias ogólny 97),
3. **podobieństwo nazw** (trigramy, `pg_trgm`) — przypisanie tylko przy podobieństwie ≥ 0,45, pewność maks. 90.

Produkt przypisuje się automatycznie od pewności **60**; poniżej człowiek wybiera sam. Przy **księgowaniu** każde przypisanie zapisuje się jako alias (`product_aliases`) i licznik użyć rośnie — następna faktura od tego dostawcy trafia sama.
Pozycje oznaczone `skip` (transport, usługi, kaucje, rabaty) nie wpływają na stan.

## 6. Zestaw ewaluacyjny (`eval/`) — pomiar na dokumentach syntetycznych

* 28 zmyślonych polskich dokumentów (faktury, paragony, korekty, WZ, zdjęcia pod kątem i w cieniu, EUR, stawki 23/8/5/zw, wiele stron, **polecenie wydrukowane na fakturze**) z wartościami wzorcowymi.
* Uruchomienie krok po kroku (Windows): `eval/README.md`. W skrócie: `npm install` → `npx playwright install chromium` → `npm run eval:generate` → `npm run eval:dry` (bez kosztów) → `npm run eval:run` (z kluczem; **1–3 $**).
* Raport (`eval/results/<data>/report.md`): „w całości poprawne”, **błędy ciche** (dokument zły, a kontrola nic nie zgłosiła — najgroźniejsze), drugi odczyt, koszt na 1000 dokumentów, wynik wg kategorii, lista błędów.
* **Czego to NIE jest:** gwarancji jakości na Twoich prawdziwych fakturach. To test regresji (czy zmiana polecenia nie pogorszyła) i porównanie modeli. Tryb próbny pokazuje 100% **tylko dla atrapy**, która zwraca wzorzec — sprawdza rurę, nie model.
* Zasada: **każda zmiana** `prompt.ts`, schematu, modeli albo progów `needsEscalation` → `npm run eval:run` przed wdrożeniem.

## 7. Mierz jakość w produkcji

Od migracji 0014 każdy odczyt (AI **i** parser KSeF) zostawia w `documents.ai_extraction` **migawkę** tego, co przeczytała maszyna (nagłówek + pozycje z identyfikatorami, także automatyczne dopasowanie produktów).
Człowiek poprawia dokument w miejscu, więc różnica między migawką a stanem **po zaksięgowaniu** mówi wprost, ile i czego musiał poprawić. Migawki nie da się edytować z aplikacji (trigger), a raport jest dostępny
tylko dla właściciela projektu i backendu.

Gdzie uruchomić: panel Supabase → **SQL Editor** (działasz jako administrator projektu). Wklej, kliknij **Run**.

```sql
-- 1) Raport poprawek: dokumenty ze zdjęć zaksięgowane w ostatnich 30 dniach
select jsonb_pretty(public.ai_correction_report(now() - interval '30 days', 'photo'));

-- 2) To samo dla faktur z KSeF (jakość parsera i dopasowania produktów)
select jsonb_pretty(public.ai_correction_report(now() - interval '30 days', 'ksef'));
```

**Jak czytać wynik** (`documents` = ile dokumentów weszło do raportu):

| Pole | Co znaczy | Na co zwrócić uwagę |
|---|---|---|
| `documents_untouched` | dokumenty zatwierdzone **bez żadnej poprawki** | to Twój „odsetek w całości poprawnych” na prawdziwych danych; po zmianach śledź trend |
| `header_changed.*` | ile razy poprawiono NIP, numer, datę, sumy, walutę, rodzaj dokumentu | `supplier_nip`, `invoice_number`, `total_*` > 5% → patrz zdjęcia (jakość? ostrość?) i wymuś mocniejszy model |
| `lines.read_by_machine` | pozycje odczytane przez maszynę | mianownik dla pozostałych liczb |
| `lines.deleted`, `lines.added_manually` | pozycje urojone / pominięte przez model | wiele `deleted` = model dokleja wiersze (np. sumy); wiele `added_manually` = pomija wiersze |
| `lines.qty_changed`, `unit_price_changed`, `total_net_changed`, `vat_rate_changed` | błędy w liczbach | najdroższe w skutkach — wchodzą na stan i do kosztów |
| `lines.product_auto_matched` / `product_auto_changed` | ile pozycji dopasowano automatycznie i ile razy człowiek **zmienił** takie dopasowanie | `product_auto_changed` / `product_auto_matched` to odsetek *błędnych* auto-dopasowań (cel: poniżej 5%) |
| `lines.product_matched_by_human` | pozycje bez auto-dopasowania, które człowiek przypisał | maleje z czasem, bo aliasy się uczą |
| `by_model` | dokumenty i „bez poprawek” wg modelu, który dał wynik końcowy | porównaj `claude-haiku-5-5` z `claude-sonnet-5-5` (drugi odczyt) |

Pozostałe zapytania pomiarowe (też do SQL Editor):

```sql
-- 3) Koszt AI w tym miesiącu wg rodzaju i modelu (kind = document | assistant)
select kind, model, count(*) as wywolania, sum(input_tokens) as tokeny_wej, sum(output_tokens) as tokeny_wyj,
       round(sum(cost_micro_usd) / 1e6, 4) as usd, round(avg(cost_micro_usd) / 1e6, 5) as usd_na_wywolanie
  from public.ai_usage
 where created_at >= date_trunc('month', now()) and status = 'ok'
 group by kind, model
 order by usd desc;

-- 4) Jak często potrzebny był drugi odczyt (dokumenty ze zdjęć, 30 dni)
select count(*) filter (where ai_warnings @> '[{"code":"second_pass"}]') as drugi_odczyt, count(*) as razem
  from public.documents
 where source = 'photo' and status in ('draft', 'posted') and processed_at >= now() - interval '30 days';

-- 5) Najczęstsze powody nieudanych odczytów
select left(error_message, 90) as komunikat, count(*) as ile
  from public.documents
 where status = 'failed' and created_at >= now() - interval '30 days'
 group by 1 order by 2 desc limit 10;

-- 6) Jak długo użytkownik czeka na wynik (sekundy: mediana i 95. percentyl)
select round((percentile_cont(0.5)  within group (order by extract(epoch from processed_at - created_at)))::numeric, 1) as mediana_s,
       round((percentile_cont(0.95) within group (order by extract(epoch from processed_at - created_at)))::numeric, 1) as p95_s
  from public.documents
 where source = 'photo' and processed_at is not null and created_at >= now() - interval '30 days';
```

**Ile dokumentów potrzeba, żeby wnioski miały sens?** Przy 30 dokumentach widać tylko grube błędy; przy 100+ odsetki zaczynają być wiarygodne; porównanie dwóch modeli wymaga setek. Dlatego zacznij od 20–30 faktur własnej firmy
(zanonimizuj je i dodaj do `eval/`, patrz `eval/README.md`).

## 8. Gdy jakość jest za niska — kolejność działań

1. **Zdjęcia.** Najczęstsza przyczyna: cień, kąt, rozmyte cyfry. Dodaj w aplikacji wskazówkę „zrób zdjęcie na wprost, przy świetle” (kategoria „zdjęcia” w raporcie `eval` pokazuje skalę problemu).
2. **Mocniejszy pierwszy model:** `AI_MODEL_FAST=claude-sonnet-5-5` (koszt ×~20 — policz w `04_RYNEK_I_TECHNOLOGIE.md`, rozdz. 4.3).
3. **Wyższy wysiłek:** `AI_EFFORT_FAST=high`.
4. **Progi eskalacji** (`needsEscalation` w `_shared/invoice.ts`): obniżenie progu `low_confidence` lub eskalacja także przy `warn` = więcej drugich odczytów.
5. **Polecenie** (`_shared/prompt.ts`): dopisz regułę dla błędu, który powtarza się w raporcie (np. „rabat podany w procentach…”), uruchom `eval:run` i porównaj.
6. **Inny dostawca:** adapter `ExtractionProvider` + ten sam zestaw `eval` (rozdz. 6). Decyzję podejmuj na podstawie liczb z rozdz. 7, nie opinii.

## 9. Asystent AI w aplikacji („jak to zrobić?”)

* Funkcja `assistant`: odpowiada **wyłącznie** na podstawie instrukcji zaszytej w `_shared/app-manual.ts` (nie zmyśla funkcji), nie ma dostępu do danych firmy i niczego nie zmienia.
  Limit: 30 pytań dziennie na osobę, do 10 wiadomości historii, 1000 znaków na wiadomość.
* **Utrzymanie:** gdy zmieniasz ekran lub nazwę przycisku, popraw odpowiedni akapit w `app-manual.ts` (asystent zna tylko ten tekst).
* **iOS:** na iPhonie asystent dostaje wariant bez cen i bez odesłań do płatności poza App Store (wytyczna Apple 3.1.3) — aplikacja przekazuje platformę, a test `assistant.test.ts` pilnuje różnicy.
* Etap 1.5 z koncepcji (pytania o dane firmy, np. „ile wydaliśmy w lipcu?”) **nie jest zbudowany**; wymagałby narzędzi serwerowych działających w granicach uprawnień pytającego (RLS).

## 10. Znane ograniczenia

| Temat | Stan |
|---|---|
| prawdziwe wywołania modeli | **nie testowane** — brak klucza; sprawdź `npm run eval:run` |
| pismo odręczne, bardzo zły skan | model może się mylić; kod złapie sumy, ale nie każdy błąd (stąd *błędy ciche* w raporcie) |
| kilka faktur na jednym zdjęciu | model dodaje ostrzeżenie; użytkownik rozdziela strony ręcznie |
| PDF z tekstem | przekazywany modelowi jako dokument; limit 10 stron / 24 MB |
| faktury w obcych językach | polecenie jest ukierunkowane na polskie dokumenty; angielskie powinny działać, inne — niesprawdzone |
| zagraniczne faktury i VAT (odwrotne obciążenie, WDT) | VAT jest odczytywany jako liczba; interpretacja podatkowa nie jest naszym zadaniem |
| dokładność dopasowania produktów | zależy od jakości katalogu; patrz `product_auto_changed` w raporcie |
| asystent i język | odpowiada po polsku; instrukcja zawiera funkcje bieżącej wersji |

## 11. Lista kontrolna przed publikacją funkcji AI

- [ ] klucz Anthropic ustawiony jako sekret funkcji, **limit wydatków** ustawiony w panelu Anthropic,
- [ ] `npm run eval:run` wykonany, wynik zapisany (liczba „w całości poprawnych” i „błędów cichych”),
- [ ] 20+ prawdziwych, zanonimizowanych faktur przetestowanych ręcznie,
- [ ] zgoda na AI działa (nowe konto → skaner → arkusz zgody → bez zgody nie ruszy),
- [ ] polityka prywatności wymienia dostawcę AI i cel przetwarzania (`docs/prawne/`),
- [ ] harmonogram `cron-tasks` działa (bez niego dokumenty „utknięte” nie zostaną zamknięte),
- [ ] tabela `ai_usage` rośnie i koszty zgadzają się z panelem Anthropic (±kilka %).
