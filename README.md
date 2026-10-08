# Tapventory

Magazyn i zakupy dla firm usługowych do 10 osób. Aplikacja mobilna
(iOS + Android, styl iOS) na Expo/React Native, backend na Supabase.

## Start

1. Przeczytaj **`docs/00_INSTRUKCJA_BUDOWY_ETAPAMI.md`** — prowadzi od pustego
   komputera do działającego środowiska dev → test → prod.
2. Montaż aplikacji mobilnej: Etap 4 tej instrukcji.
3. Co dalej w budowie: **`docs/01_KOLEJKA_BUDOWY.md`**.

## Mapa katalogów

```
docs/                  instrukcja etapowa, kolejka budowy, dokument koncepcyjny
supabase/
  migrations/          schemat bazy + RLS (0001, 0002, ...)
  seed.sql             dane startowe wyłącznie dla DEV
app-src/               źródła aplikacji do wgrania w projekt Expo
  app/                 ekrany (Expo Router)
  components/ui/       komponenty w stylu iOS
  lib/                 klient Supabase, kontekst sesji
  theme/               design tokens (kolory, typografia, odstępy)
```

## Zasady, których pilnujemy

* Bezpieczeństwo danych mieszka w bazie (RLS), nie w kodzie aplikacji.
* Migracja raz wdrożona jest nietykalna — poprawki to nowe pliki.
* Ruchy magazynowe są tylko-do-dopisywania; stan to suma ruchów.
* Klucz `service_role` nigdy nie dotyka frontendu ani repozytorium.
