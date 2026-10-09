# 12 — Budowanie aplikacji (Android, iPhone) i publikacja w sklepach

> **Status uczciwie:** konfiguracja (`mobile/app.config.ts`, `mobile/eas.json`) jest zgodna z oficjalną dokumentacją Expo (odczytaną z repozytorium Expo na GitHubie) i przechodzi eksport pakietów
> (`expo export` dla web, Android i iOS — to robi też CI). **Nie zbudowałem natywnej aplikacji ani nie wysłałem niczego do sklepów** (brak kont i dostępu do expo.dev, Apple, Google).
> Kroki poniżej są więc instrukcją, nie relacją z przebiegu. Gdzie czegoś nie mogłem sprawdzić, jest znacznik ❓.

## 1. Jak to działa: EAS w trzech zdaniach

**Expo Application Services (EAS)** budują aplikację na serwerach Expo (nie potrzebujesz Maca ani Android Studio), podpisują ją i wysyłają do sklepów (`eas submit`).
W planie **Free** dostajesz ograniczoną liczbę budowań o niskim priorytecie (limit odnawia się 1. dnia miesiąca; po wyczerpaniu nowe budowania są niedostępne — nie ma dopłat; można budować lokalnie) ✅.
Plan **Starter** kosztuje 19 USD/mc i zawiera 45 USD kredytu na budowania priorytetowe ✅ (aktualne ceny: expo.dev/pricing; liczba darmowych budowań ok. 15 Android + 15 iOS miesięcznie 🟡).

## 2. Konfiguracja, która już jest w repozytorium

| Plik | Co robi |
|---|---|
| `mobile/app.config.ts` | nazwa, identyfikatory paczki, uprawnienia, ikony, wtyczki (kamera, zdjęcia, powiadomienia, bezpieczne przechowywanie) |
| `mobile/eas.json` | trzy profile budowania: `development`, `preview`, `production` + `appVersionSource: remote` |
| `mobile/assets/images/*` | ikona, ikona adaptacyjna Androida (3 warstwy), ekran startowy, favicon — generowane skryptem `npm run assets` |

Trzy warianty aplikacji (zmienna `APP_ENV` ustawiana przez profil EAS) mogą stać na jednym telefonie:

| Profil | `APP_ENV` | Nazwa | Identyfikator paczki | Do czego |
|---|---|---|---|---|
| `development` | development | Tapventory (Dev) | `com.tapventory.app.dev` | wersja deweloperska z menu debugowania (`expo-dev-client`) |
| `preview` | staging | Tapventory (Test) | `com.tapventory.app.staging` | testerzy: APK na Androida / TestFlight-ad hoc |
| `production` | production | Tapventory | `com.tapventory.app` | sklepy (Android: paczka **AAB**; iOS: **IPA** do App Store/TestFlight) |

> ⚠️ **Identyfikatory paczki są niezmienialne po pierwszej publikacji.** Konwencja: odwrócona domena, którą posiadasz (`tapventory.com` → `com.tapventory.app`). Sprawdź w sklepach dostępność nazwy „Tapventory” tuż przed publikacją
> (Apple wymaga unikalnej nazwy — najpewniej sprawdzisz ją, tworząc rekord aplikacji w App Store Connect; Google nazw nie blokuje).

### 2.1 Jednorazowo: konto Expo i identyfikator projektu

```powershell
npm install --global eas-cli
eas login
cd C:\projekty\tapventory\mobile
eas init
```

`eas init` tworzy projekt na expo.dev i wypisuje jego **Project ID**. Ponieważ używamy `app.config.ts` (konfiguracja w kodzie), narzędzie nie wpisze go samo: otwórz `mobile\app.config.ts`, znajdź

```ts
extra: { appEnv: APP_ENV, eas: { projectId: process.env.EAS_PROJECT_ID } },
```

i zamień `process.env.EAS_PROJECT_ID` na identyfikator w apostrofach (`'xxxxxxxx-xxxx-…'`). Jest jawny (nie tajny); bez niego nie zadziała rejestracja tokenów push ani `eas build`. ❓ dokładny komunikat narzędzia może się różnić w nowszej wersji.

### 2.2 Wartości środowiska w `eas.json`

W profilach `development`, `preview` i `production` zamień `WKLEJ_URL_PROJEKTU_*` i `WKLEJ_KLUCZ_ANON_*` na **publiczne** wartości odpowiednich projektów Supabase (URL i klucz anon/publishable). Klucza `service_role`/`secret` **nigdy** tam nie wpisuj.
Zmienne `EXPO_PUBLIC_*` są wklejane do aplikacji przy budowaniu.

### 2.3 Wersje

* `version` w `app.config.ts` (np. `0.1.0` → `0.2.0`) to wersja widoczna dla użytkownika — podbijasz ją przy każdym wydaniu.
* Numer budowania (`versionCode`/`buildNumber`) zwiększa EAS automatycznie (`appVersionSource: remote` + `"autoIncrement": true` w profilu `production`).

## 3. Android

### 3.1 Szybki test na telefonie: APK z profilu `preview`

```powershell
cd C:\projekty\tapventory\mobile
eas build --profile preview --platform android
```

* Pytanie o *keystore* → **Generate new keystore** (Enter). Keystore przechowuje Expo; **nie usuwaj projektu EAS** bez kopii (`eas credentials`).
* Po zakończeniu dostajesz link i kod QR → otwórz na telefonie → pobierz APK → zainstaluj (zgoda na instalację z nieznanych źródeł).
* Instalacja z linku działa też dla testerów — wyślij im link.

### 3.2 Wersja deweloperska (debug z Twojego komputera)

```powershell
eas build --profile development --platform android
```

Zainstaluj APK, potem w `mobile` uruchom `npx expo start --dev-client` — aplikacja połączy się z serwerem na Twoim komputerze (ta sama sieć Wi‑Fi). Konieczna do testów powiadomień push (w Expo Go nie działają).

### 3.3 Produkcja: paczka AAB i Google Play

Wymagania (✅ Google/Expo; ❓ szczegóły panelu):

1. Konto **Google Play Console** (25 USD jednorazowo ✅). Dla firm: konto **organizacji** z numerem D‑U‑N‑S (`dnb.com/pl-pl`, wniosek wcześniej!). Konta osobiste założone po 13.11.2023 muszą przed produkcją przeprowadzić **test zamknięty: 12 testerów przez 14 dni** 🟡 — sprawdź w Play Console, co dotyczy Twojego konta.
2. **Docelowe API 36** — od 31.08.2026 wymóg dla nowych aplikacji i aktualizacji ✅. React Native 0.86 i `expo-modules-core` domyślnie celują w 36 ✅ (w kodzie pakietów); po pierwszym budowaniu sprawdź w Play Console → *App bundle explorer* / ostrzeżenia, że `targetSdkVersion` to 36.
3. Zbuduj paczkę AAB: `eas build --profile production --platform android`.
4. W Play Console: **Create app** (nazwa, język polski, aplikacja, bezpłatna), potem wypełnij **wszystkie** sekcje z lewego menu — Play nie pozwoli wydać bez nich (rozdz. 5).
5. **Pierwszą wersję** wgraj w Play Console ręcznie (**Testing → Internal testing → Create new release → Upload** plik AAB pobrany z expo.dev); kolejne możesz wysyłać `eas submit --platform android` po utworzeniu **klucza konta usługi Google** i wgraniu go do EAS (`eas credentials --platform android`; opis ✅: „Creating a Google Service Account key”).
   ❓ czy pierwsze wydanie można wysłać przez API — Google bywa tu restrykcyjny; ręczny upload jest bezpieczną drogą.
6. Ścieżka wydania: **Internal testing** (do 100 testerów, natychmiast) → **Closed testing** → **Production** (opcjonalnie wdrożenie etapowe, np. 20%).

### 3.4 Uprawnienia Androida w aplikacji

Prosimy tylko o to, czego używamy: **aparat** (skaner kodów i zdjęcia), **zdjęcia** (wybór z galerii przez systemowy selektor), **powiadomienia** (Android 13+), internet. Mikrofon i zapis na karcie są **zablokowane** (`blockedPermissions` w `app.config.ts`); `SYSTEM_ALERT_WINDOW` (nakładka menu deweloperskiego) jest blokowane w produkcji.
Każde uprawnienie w manifeście trzeba w Play Console uzasadnić — im krótsza lista, tym łatwiejsza recenzja.

### 3.5 Powiadomienia push na Androidzie ❓

Push do aplikacji natywnej na Androidzie wymaga **Firebase Cloud Messaging**: projekt Firebase → dodaj aplikacje Android dla `com.tapventory.app` (oraz `.staging`, `.dev`) → pobierz `google-services.json` → wskaż go w `app.config.ts` (`android.googleServicesFile: './google-services.json'`) → wgraj do EAS klucz konta usługi FCM V1 (`eas credentials`).
Bez tego aplikacja działa normalnie, tylko `enablePush()` zwróci błąd i użytkownik nie dostanie push (powiadomienia w zakładce Aktywność działają zawsze). Na iOS klucze APNs obsługuje EAS automatycznie przy pierwszym budowaniu. Szczegółowy opis: `docs/13_PWA_I_POWIADOMIENIA.md`.

## 4. iPhone / iOS

### 4.1 Warunki

* Konto **Apple Developer Program** (99 USD/rok ✅; organizacja wymaga D‑U‑N‑S 🟡). **Mac nie jest potrzebny** — `eas build` i `eas submit` działają na Windows ✅.
* W **App Store Connect** (appstoreconnect.apple.com) → **Moje aplikacje** → **＋ Nowa aplikacja**: platforma iOS, nazwa **Tapventory**, język podstawowy polski, Bundle ID `com.tapventory.app`, SKU dowolny. To też **rezerwuje nazwę** (nazwa musi być unikalna w App Store).
  `eas submit` potrafi utworzyć rekord aplikacji automatycznie przy pierwszym wysłaniu ✅, ale ręczne utworzenie pozwala wcześniej zająć nazwę.

### 4.2 Budowanie i wysyłka do TestFlight

```powershell
cd C:\projekty\tapventory\mobile
eas build --profile production --platform ios
eas submit --platform ios --latest
```

Albo jednym poleceniem: `eas build --platform ios --profile production --auto-submit`. Przy pierwszym uruchomieniu EAS zapyta o Apple ID (i kod dwuskładnikowy) oraz sam utworzy certyfikaty i profil podpisu ✅.
Do `eas.json` → `submit.production.ios` możesz dopisać `"ascAppId": "<Apple ID aplikacji z App Store Connect>"` — wtedy wysyłka nie pyta o aplikację ✅.

**TestFlight** (✅ dokumentacja Expo):

| | Testy wewnętrzne | Testy zewnętrzne |
|---|---|---|
| kto | użytkownicy Twojego zespołu w App Store Connect (do 100) | każdy z linkiem/e‑mailem (do 10 000) |
| Beta App Review | nie | **tak**, przy pierwszej wersji każdej wersji aplikacji; wymagany opis testowy i e‑mail zwrotny |
| kiedy | zaraz po przetworzeniu (kilkanaście minut) | po akceptacji Apple |
| ważność wersji | 90 dni od wysłania | 90 dni |

Uwaga: do TestFlight nadaje się wyłącznie profil `production` (`distribution: store`). Profil `preview` z iOS wymagałby rejestracji urządzeń (ad hoc) — dlatego dla iPhone’ów testerów używaj TestFlight lub PWA.

### 4.3 Manifest prywatności (privacy manifest) ❓

Apple wymaga deklaracji powodów użycia „wrażliwych” API (UserDefaults, znaczniki czasu plików, czas uruchomienia systemu, miejsce na dysku). Biblioteki Expo/React Native dostarczają własne pliki `PrivacyInfo.xcprivacy`,
ale — według dokumentacji Expo ✅ — Apple nie zawsze poprawnie je odczytuje. **Po pierwszym wysłaniu** sprawdź skrzynkę: jeśli Apple wyśle e‑mail o brakujących powodach, dopisz je w `app.config.ts`:

```ts
ios: {
  // ...
  privacyManifests: {
    NSPrivacyAccessedAPITypes: [
      { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
      // kolejne kategorie i kody dokładnie takie, jak w e-mailu od Apple
    ],
  },
},
```

Nie dopisujemy kodów „na zapas” — deklaracje mają być zgodne z prawdą.

### 4.4 Inne ustawienia iOS, które już są

* Teksty próśb o dostęp do aparatu i zdjęć — po polsku, w `app.config.ts` (wtyczki `expo-camera`, `expo-image-picker`).
* `ITSAppUsesNonExemptEncryption: false` — aplikacja używa wyłącznie standardowego HTTPS, więc nie trzeba odpowiadać na pytanie o szyfrowanie przy każdym wysłaniu ✅.
* Brak Face ID (`faceIDPermission: false`) — nie dodajemy zbędnych opisów uprawnień.
* `supportsTablet: false` — aplikacja jest przygotowana na telefon w pionie.

## 5. Strona sklepu: co trzeba wypełnić

### 5.1 Materiały

| Element | Wymagania | Gdzie wziąć |
|---|---|---|
| Ikona | 1024×1024 px, bez przezroczystości (iOS) | `mobile/assets/images/icon.png` |
| Zrzuty ekranu | iPhone 6,9″ (i 6,5″), telefon z Androidem (min. 2) | `node mobile/scripts/ui-smoke/run.mjs mobile/dist ui-smoke-out` robi zrzuty ekranów z przeglądarki (na makiecie backendu) — przydatne jako baza; docelowo zrób ze zwykłej aplikacji |
| Grafika funkcji (Google) | 1024×500 px | do przygotowania |
| Opis krótki / długi, słowa kluczowe | po polsku | z `README.md` i koncepcji; **bez obietnic, których nie ma** |
| Kategoria | Biznes / Produktywność | |
| Adresy | Polityka prywatności (`tapventory.com/prywatnosc`), Regulamin (`/regulamin`), Usuń konto (`/usun-konto`), Wsparcie (`kontakt@tapventory.com`) | szablony: `docs/prawne/` — **musisz je opublikować na stronie** (adresy są zaszyte w `mobile/src/lib/links.ts`) |
| Ocena wiekowa / treści | kwestionariusze w obu sklepach | aplikacja biznesowa, bez treści wrażliwych |

### 5.2 Prywatność: co zadeklarować (Apple „App Privacy”, Google „Bezpieczeństwo danych”)

Dane faktycznie przetwarzane przez aplikację (stan kodu na 9.10.2026 — **zweryfikuj przed wysłaniem**, jeśli dodasz SDK analityczne lub reklamy):

| Dane | Zbieramy? | Cel | Powiązane z użytkownikiem | Udostępniane podmiotom zewn. |
|---|:-:|---|:-:|---|
| Imię/nazwa wyświetlana, e‑mail | tak | konto, logowanie | tak | Supabase (hosting, przetwarzanie na zlecenie) |
| Telefon (opcjonalnie) | opcjonalnie | profil | tak | Supabase |
| Zdjęcia produktów, zdjęcia/PDF faktur | tak | działanie aplikacji (magazyn, odczyt faktur) | tak | Supabase; **Anthropic** (odczyt AI — za zgodą użytkownika) |
| Dane firmy: nazwa, NIP, branża | tak | działanie aplikacji | tak | Supabase |
| Dane z faktur (dostawcy, kwoty, pozycje) | tak | działanie aplikacji | tak | Supabase; Anthropic (jak wyżej) |
| Token KSeF (zaszyfrowany) | tak, jeśli właściciel połączy KSeF | pobieranie faktur zakupu | tak | Supabase (szyfrogram); dane trafiają do KSeF MF |
| Identyfikator urządzenia do push (token Expo/FCM), nazwa urządzenia | jeśli włączysz powiadomienia | wysyłanie powiadomień | tak | Expo (usługa push), Google/Apple |
| Lokalizacja | **nie** | — | — | — |
| Kontakty, kalendarz, zdrowie, finanse osobiste | **nie** | — | — | — |
| Analityka, reklamy, śledzenie (ATT) | **nie** (brak SDK) | — | — | — |

Pozostałe odpowiedzi: dane szyfrowane w tranzycie (HTTPS) — tak; użytkownik może zażądać usunięcia — tak (w aplikacji: Ustawienia → Usuń konto; na stronie: `/usun-konto`).
Wymóg Apple 5.1.2(i) (ujawnienie i zgoda na przekazanie danych zewnętrznej AI) spełnia arkusz zgody przed pierwszym skanem i asystentem.

### 5.3 Konto testowe dla recenzenta (Apple i Google tego wymagają przy aplikacjach z logowaniem)

1. Załóż w środowisku produkcyjnym konto `recenzent@…` i firmę „Demo — Warsztat” z kilkunastoma produktami, kilkoma zgłoszeniami i jedną zaksięgowaną fakturą.
2. W polach „Notatki dla recenzenta” (App Store Connect) i „Dostęp do aplikacji” (Play Console) podaj e‑mail, hasło oraz krótki opis: *„Aplikacja dla małych firm usługowych. Skan faktur działa po wyrażeniu zgody na AI (okno przy pierwszym użyciu). Integracja z KSeF wymaga tokenu polskiego podatnika — nie jest dostępna dla konta demo; opis ekranu w załączonym nagraniu.”*
3. Upewnij się, że backend produkcyjny działa w dniu recenzji (nie jest „uśpiony”, ma środki na AI i sekrety funkcji).

### 5.4 Płatności i planów — uwaga dla iOS (wytyczna 3.1.3)

Model: subskrypcję kupuje się **na stronie** (Stripe), aplikacja tylko loguje. Apple dopuszcza to dla usług sprzedawanych **organizacjom** (3.1.3(c)), ale „sprzedaż konsumencka, jednoosobowa lub rodzinna musi używać zakupów w aplikacji” ✅.
Dlatego: (1) rejestracja zawsze jako **firma**; (2) w aplikacji na iOS **nie ma cen ani odesłań do płatności** (stopka planu i asystent już to uwzględniają); (3) przygotuj **plan B** — zakupy w aplikacji (IAP, prowizja 15% w programie małych deweloperów) obok ceny na stronie, gdyby recenzent uznał plan Start za sprzedaż jednoosobową.
Google ma lustrzane zasady dotyczące płatności w aplikacji ❓ — przeczytaj „Payments policy” przed wydaniem.

## 6. Lista kontrolna przed wysłaniem do recenzji

**Dla obu sklepów**

- [ ] `version` podbity; build z profilu `production`; wartości w `eas.json` wskazują projekt PROD (nie dev!)
- [ ] strona `tapventory.com` z politykami opublikowana (3 adresy działają, bez logowania)
- [ ] polityka prywatności wymienia: Supabase, Anthropic, Expo (push), KSeF/MF (dane z faktur), okresy przechowywania, kontakt, prawa RODO
- [ ] konto recenzenta działa, backend PROD i harmonogram `cron-tasks` działają
- [ ] usuwanie konta działa w aplikacji (Ustawienia) i istnieje strona `/usun-konto`
- [ ] zgoda na AI wyskakuje przed pierwszym skanem; bez zgody nic nie jest wysyłane
- [ ] żadnych cen ani linków do płatności w aplikacji na iOS
- [ ] zrzuty ekranów i opisy bez obietnic spoza zakresu (np. „offline”, „Stripe”, „marketplace”)

**Google Play**

- [ ] AAB, `targetSdk` 36, uprawnienia uzasadnione, formularz „Bezpieczeństwo danych” zgodny z rozdz. 5.2
- [ ] ocena treści, grupa docelowa (dorośli), deklaracja reklam (brak)
- [ ] test zamknięty zaliczony, jeśli dotyczy Twojego konta; w razie potrzeby wniosek o przedłużenie terminu API ❓

**Apple**

- [ ] rekord aplikacji, kategoria, ocena wiekowa, „App Privacy” zgodne z rozdz. 5.2
- [ ] brak ostrzeżeń o manifestach prywatności (rozdz. 4.3) po wysłaniu do TestFlight
- [ ] notatki dla recenzenta i konto demo (rozdz. 5.3)

## 7. Najczęstsze powody odrzuceń (i jak ich uniknąć)

| Sklep | Powód | Jak uniknąć |
|---|---|---|
| Apple 2.1 | awarie, niedziałające konto demo, funkcje „w budowie” | konto recenzenta, żadnych ekranów „wkrótce” |
| Apple 3.1.1 / 3.1.3 | odsyłanie do płatności poza aplikacją, sprzedaż jednoosobowa | rozdz. 5.4 |
| Apple 5.1.1(v) | brak usuwania konta w aplikacji | jest; opisz w notatkach, gdzie |
| Apple 5.1.2(i) | dane do zewnętrznej AI bez wyraźnej zgody | arkusz zgody |
| Apple 4.2 / 4.0 | aplikacja „tylko opakowanie strony” lub niedopracowany interfejs | natywne aparat/skaner/powiadomienia, spójny interfejs |
| Google | niezgodność „Bezpieczeństwa danych” z rzeczywistością, zbędne uprawnienia, brak URL usuwania konta | rozdz. 3.4 i 5.2 |
| Google | docelowe API poniżej wymaganego | rozdz. 3.3 |

## 8. Aktualizacje po wydaniu

* Nowa wersja = zmiana kodu → podbicie `version` → `eas build --profile production` → `eas submit` → (iOS) wysłanie do recenzji / (Android) nowe wydanie na wybranej ścieżce.
* **Aktualizacje „w powietrzu” (EAS Update)** nie są skonfigurowane (brak biblioteki `expo-updates`) — każda zmiana kodu w aplikacji natywnej wymaga nowej wersji w sklepie. Zmiana w **PWA** jest natychmiastowa po wdrożeniu na hosting.
* Zmiany w bazie i funkcjach (Supabase) nie wymagają aktualizacji aplikacji — ale muszą być **wstecznie zgodne** z wersjami aplikacji, które użytkownicy mają jeszcze zainstalowane (zasada: dodawaj, nie usuwaj; migracje nietykalne).
