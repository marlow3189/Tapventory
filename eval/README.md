# Zestaw ewaluacyjny odczytu faktur (OCR + AI)

Ten katalog odpowiada na pytanie, które **musisz** zadać przed wyborem modelu i po każdej zmianie promptu:

> *Ile faktur z mojego zestawu model czyta w całości poprawnie, ile razy myli się „po cichu" i ile to kosztuje?*

Zestaw **nie wymaga żadnych danych klientów**: dokumenty są syntetyczne (zmyślone firmy, NIP-y i kody EAN z poprawnymi sumami kontrolnymi), ale odtwarzają to, co naprawdę sprawia kłopot: paragony, zdjęcia z telefonu pod kątem i w cieniu, rabaty, stawki 23/8/5/zw, liczby w formacie `12 345,67` i `12.345,67`, faktury w EUR, dwustronicowe PDF-y, korekty, dokumenty WZ, a nawet **polecenie dla AI wydrukowane na fakturze** (test odporności).

## Co jest w środku

| Plik | Do czego służy |
|---|---|
| `cases.ts` | definicje 28 dokumentów + **wartości wzorcowe** (co dokładnie model powinien odczytać) |
| `render.ts` | szablony HTML (faktura klasyczna / nowoczesna / zagęszczona, paragon, WZ, korekta) i „psucie" obrazu (obrót, perspektywa, cień, ziarno, JPEG) |
| `generate.mjs` | robi z szablonów zdjęcia/PDF-y w `eval/data/` (Chromium przez Playwright) |
| `runner.ts`, `run.mjs` | uruchamiają **prawdziwy kod produkcyjny** (`runPipeline` z `supabase/functions/_shared`) na każdym dokumencie i każdej konfiguracji modeli |
| `score.ts` | porównanie z wzorcem: pola nagłówka, każda pozycja (nazwa, ilość, cena, wartość, VAT, EAN, „pomijana"), pozycje urojone |
| `report.ts` | raport Markdown: tabele, koszty na 1000 dokumentów, lista błędów |
| `dry.ts` | **atrapa** dostawcy (bez kluczy i kosztów) — sprawdza samą rurę; jej liczb nie wolno traktować jak wyników modelu |
| `tests/eval.test.ts` | 14 testów samego zestawu (`npm run eval:test`) |

## Uruchomienie krok po kroku (Windows, PowerShell)

Wszystkie polecenia — w **katalogu głównym repozytorium** (tam, gdzie jest `package.json` z `eval:generate`).

1. **Jednorazowo** (jeśli jeszcze tego nie robiłeś): `npm install` oraz `npx playwright install chromium` (pobiera przeglądarkę ~150 MB, potrzebną do robienia zdjęć dokumentów).
2. **Wygeneruj dokumenty:** `npm run eval:generate` → powstaje `eval/data/` (ok. 4 MB; katalog jest w `.gitignore`, bo odtwarza się z kodu — to samo „ziarno" daje zawsze te same dokumenty).
3. **Sprawdź, że rura działa, nic nie płacąc:** `npm run eval:dry` → w konsoli zobaczysz tabelę z 100% (atrapa zwraca wzorzec). Raport z oznaczeniem „TRYB PRÓBNY" zapisze się w `eval/results/dry-…/report.md`.
4. **Prawdziwy test modeli** (kosztuje, patrz niżej):
   ```powershell
   $env:ANTHROPIC_API_KEY = "sk-ant-..."     # klucz z https://platform.claude.com (nie zapisuj go w repozytorium!)
   npm run eval:run
   ```
   Zobaczysz postęp, a na końcu ścieżkę do `eval/results/<data>/report.md` (i `results.json` z surowymi wynikami).

### Przydatne opcje

```powershell
npm run eval:run -- --configs=haiku,pipeline        # tylko wybrane konfiguracje
npm run eval:run -- --category="paragony"           # tylko jedna kategoria
npm run eval:run -- --cases=receipt-photo,photo-skew
npm run eval:run -- --concurrency=2                 # wolniej, łagodniej dla limitów API
npm run eval:run -- --usd-pln=4.00                  # inny kurs do przeliczeń kosztu
npm run eval:dry -- --noise=0.5                     # atrapa z losowymi błędami (test raportu)
```

## Konfiguracje (co jest porównywane)

| Nazwa | Co robi |
|---|---|
| `haiku` | sam najtańszy model (Claude Haiku 5.5, wysiłek `medium`) |
| `sonnet` | sam Claude Sonnet 5.5 (`high`) |
| `opus` | sam Claude Opus 5.5 (`high`) |
| `pipeline` | **to, co działa w aplikacji:** Haiku → kontrola kodem → drugi odczyt Sonnetem tylko gdy kod wykryje problem |

Zmienisz je w `runner.ts` (`DEFAULT_CONFIGS`). Pamiętaj, że nazwy modeli i ceny mogą się zmienić — ceny trzymamy w `supabase/functions/_shared/cost.ts` (sprawdź cennik przed zmianą).

## Koszt

Komplet (28 dokumentów × 4 konfiguracje = 112 odczytów) kosztuje według cennika z `cost.ts` rzędu **1–3 USD**; najwięcej zjada `opus`. Zacznij od `--configs=haiku,pipeline`, a pełny komplet puść raz — przed wyborem modelu i po większych zmianach promptu.

## Jak czytać raport

1. **„W całości poprawne"** — nagłówek i *każda* pozycja (ilość, cena, VAT, EAN) zgodne z wzorcem, bez urojonych pozycji. To najuczciwsza miara.
2. **„Błędy ciche"** — dokument zły, a kontrola kodu nic nie zgłosiła (np. pomylona data albo cyfra w cenie, która mieści się w sumach). To najgroźniejszy błąd — im bliżej zera, tym lepiej. Błąd *zgłoszony* (suma się nie zgadza → ostrzeżenie/drugi odczyt) kosztuje człowieka kilka sekund.
3. **„Drugi odczyt"** — jak często potok sięga po droższy model. Gdy to ≫ 30%, tani model nie wystarcza albo progi `needsEscalation` są zbyt czułe.
4. Tabela **wg kategorii** pokazuje, *gdzie* model się wykłada (np. tylko zdjęcia pod kątem albo korekty) — to podpowiedź, co poprawić w prompcie lub co zasugerować użytkownikowi (np. „zrób zdjęcie na wprost").

> **Ograniczenie:** to dokumenty syntetyczne. Dobrze nadają się do **porównań** i **testów regresji** (zmiana promptu → czy się nie pogorszyło), ale nie zastąpią obserwacji na prawdziwych fakturach. Po wdrożeniu mierz to samo na poprawkach, które wprowadzają użytkownicy (patrz `docs/09_AI_I_OCR.md`).

## Jak dodać własny przypadek

1. W `cases.ts`, w `buildAllCases()`, dopisz `c.push(buildCase({ id: 'moj-przypadek', category: '…', note: '…', layout: 'classic', seed: 999, … }))`. Opcje: `lines`, `pages`, `asPdf`, `degrade` (obrót/cień/rozdzielczość), `discountMode`, `currency`, `mixedVat`, `zwLine`, `transport`, `showEan`, `injection`, …
2. Uruchom `npm run eval:test` (sprawdza spójność wzorca) i `npm run eval:generate -- --only=moj-przypadek`.
3. Chcesz użyć **prawdziwej** zanonimizowanej faktury? Wrzuć jej obraz do `eval/data/<id>/page-1.jpg`, a obok `case.json` z polem `expected` (kształt jak w `cases.ts`, interfejs `Expected`) i dopisz wpis do `manifest.json`. Pamiętaj o RODO — zamaż dane osobowe.

## Porównanie z innym dostawcą (np. Gemini)

Potok jest zbudowany wokół interfejsu `ExtractionProvider` (`supabase/functions/_shared/provider.ts`): wystarczy napisać drugą klasę z metodą `extract()` i podać ją w `run.mjs`. Nie dodaliśmy gotowego adaptera innego dostawcy, bo **nie mogliśmy go przetestować na żywo** — nie chcemy dawać niesprawdzonego kodu. Wnioski z przeglądu rynku: `docs/04_RYNEK_I_TECHNOLOGIE.md`.
