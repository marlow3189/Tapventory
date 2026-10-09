# 13 — PWA (aplikacja w przeglądarce) i powiadomienia

> **Status uczciwie:** PWA zbudowałem, wyeksportowałem (`expo export --platform web`) i **przeszedłem w prawdziwym Chromium** testem dymnym (8 ścieżek, zrzuty ekranów, brak błędów w konsoli) — ale na makiecie backendu, nie na żywym Supabase.
> **Nie wdrażałem** jej na żaden hosting i nie sprawdzałem na prawdziwym iPhonie ani Androidzie. **Web Push (powiadomienia w przeglądarce) NIE jest zbudowany** — opis w rozdz. 5 to projekt, nie gotowy kod.

## 1. Co to jest PWA i co ma Tapventory

PWA (Progressive Web App) to ta sama aplikacja uruchamiana w przeglądarce, którą użytkownik może **„zainstalować”** na ekranie głównym i otwierać w osobnym oknie bez paska adresu.

| Element | Gdzie jest | Po co |
|---|---|---|
| Manifest | `mobile/public/manifest.webmanifest` | nazwa, kolory, ikony (zwykła 192/512 + **maskable** 512), tryb `standalone`, język `pl`, skróty (**Zgłoś brak**, **Zdejmij z magazynu**, **Skanuj fakturę**) |
| Szablon strony | `mobile/public/index.html` | `viewport-fit=cover` (iPhone z wycięciem), `theme-color` dla trybu jasnego i ciemnego, tagi `apple-mobile-web-app-*`, ikona `apple-touch-icon` |
| Service worker | `mobile/public/sw.js` | zapamiętuje „szkielet” aplikacji i pliki statyczne; **nie** jest pełnym trybem offline |
| Skaner kodów | `mobile/public/zxing_reader.wasm` + biblioteka `barcode-detector` | Safari nie ma wbudowanego skanera kodów (tylko za ukrytą flagą) — skaner działa z naszego pliku, bez zewnętrznego CDN, także offline ✅ |
| Nagłówki hostingu | `mobile/public/_headers`, `_redirects` | brak cache dla `sw.js` i manifestu, długi cache dla plików z hashem, `nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self)`; każda ścieżka zwraca `index.html` (aplikacja jednostronicowa) |
| Baner offline | `mobile/src/components/ui/OfflineBanner.tsx` | „Brak połączenia” — dane zawsze z serwera, zapis wymaga internetu |
| Przycisk instalacji | `mobile/src/lib/pwa.ts` (Ustawienia) | na Androidzie/Chrome pokazuje natywny monit; na iPhonie — instrukcja „Udostępnij → Do ekranu początkowego” |

**Co robi service worker:** nawigacja (HTML) — najpierw sieć, a gdy jej brak — zapamiętany szkielet; `/_expo/static/*`, ikony, `wasm` — najpierw pamięć podręczna (nazwy z hashem się nie zmieniają); **wszystko inne, w tym API Supabase, idzie prosto do sieci**.
Efekt: aplikacja otwiera się natychmiast i nie wywala się przy słabym zasięgu, ale **bez internetu nic nie zapiszesz** (pełny tryb offline z synchronizacją to osobny etap, patrz `docs/01_KOLEJKA_BUDOWY.md`).
Nowa wersja shellu: zmień `CACHE_VERSION` w `sw.js`.

## 2. Zbudowanie i wdrożenie

```powershell
cd C:\projekty\tapventory\mobile
npm run build:web          # wynik: folder dist\
npm run serve:web          # (opcjonalnie) podgląd: http://localhost:3000
```

* `EXPO_PUBLIC_SUPABASE_URL` i `EXPO_PUBLIC_SUPABASE_ANON_KEY` są **wklejane do aplikacji w chwili budowania**. Upewnij się, że `.env` wskazuje na właściwy projekt (nie na `127.0.0.1`!) — albo ustaw te zmienne w panelu hostingu, jeśli buduje on aplikację za Ciebie.
* Aplikacja wymaga **HTTPS** (kamera, instalacja, service worker). Wszystkie poniższe hostingi dają go automatycznie.

### 2.1 Najszybciej: Netlify — przeciągnij folder (bez Gita) ❓ nie testowane

1. Wejdź na **app.netlify.com/drop** (konto Netlify jest darmowe) i przeciągnij folder `dist` na okno.
2. Dostajesz adres `https://cos-losowego.netlify.app` → otwórz go na telefonie.
3. Pliki `_headers` i `_redirects` w `dist` są w formacie Netlify — działają bez dodatkowej konfiguracji.

Aktualizacja = ponowne przeciągnięcie nowego `dist` (**Deploys → Drag and drop**).

### 2.2 Docelowo: hosting podpięty do repozytorium

| Hosting | Ustawienia projektu | Uwagi |
|---|---|---|
| **Netlify** | Base directory `mobile` • Build `npm run build:web` • Publish `mobile/dist` • zmienne `EXPO_PUBLIC_*` • `NODE_VERSION=24` | `_headers`, `_redirects` czytane automatycznie |
| **Cloudflare Pages** (lub Workers z zasobami statycznymi) | Root `mobile` • Build `npm run build:web` • Output `dist` • zmienne jak wyżej | te same pliki `_headers`/`_redirects`; panel Cloudflare zmienia się — szukaj „Pages” / „Workers & Pages” ❓ |
| **Vercel** | Root `mobile` • Framework „Other” • Build `npm run build:web` • Output `dist` | Vercel **nie czyta** `_redirects` — dodaj `mobile/vercel.json` z `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}` oraz własne nagłówki ❓ |

### 2.3 Domena `app.tapventory.com`

1. W panelu hostingu: **Domains / Custom domain** → dodaj `app.tapventory.com`. Hosting pokaże, jaki rekord DNS ustawić (zwykle **CNAME** `app` → adres hostingu).
2. U rejestratora domeny (Hostinger — strefa DNS `tapventory.com`) dodaj dokładnie ten rekord, z ekranu hostingu (nie z pamięci i nie z poradników — wartości bywają różne dla każdego konta).
3. Poczekaj na zielony status i kłódkę HTTPS (od minut do kilku godzin).
4. W Supabase (Authentication → URL Configuration) dodaj `https://app.tapventory.com/**` do Redirect URLs.
5. Strona marketingowa i polityki prywatności (`tapventory.com`) to osobna witryna; adresy są zaszyte w `mobile/src/lib/links.ts`.

## 3. Instalacja na urządzeniach

| Urządzenie | Jak |
|---|---|
| **Android (Chrome)** | wejdź na adres → menu ⋮ → **Zainstaluj aplikację** (lub przycisk w Ustawieniach aplikacji) |
| **iPhone / iPad (Safari)** | **Udostępnij** → **Do ekranu początkowego** → Dodaj. Od iOS 16.4 inne przeglądarki też mogą oferować „Dodaj do ekranu początkowego” z menu Udostępnij ✅ (notatki wydania Safari 16.4) |
| **Komputer (Chrome/Edge)** | ikona instalacji w pasku adresu |

Sprawdzenie poprawności: Chrome → **F12** → karta **Application** → *Manifest* (ikony, instalowalność) i *Service Workers*; karta **Lighthouse** → kategoria *Progressive Web App*.

## 4. Ograniczenia PWA względem aplikacji natywnej (powiedz o nich klientom)

| Temat | PWA | Natywna |
|---|---|---|
| Powiadomienia push | iPhone: **dopiero od iOS 16.4**, tylko po instalacji na ekranie początkowym ✅; w Tapventory Web Push **jeszcze nie działa** (rozdz. 5) | działa (po konfiguracji FCM/APNs, rozdz. 5 i `docs/12_*`) |
| Skaner kodów | działa (zxing‑wasm) — wolniej niż natywny, gorsze światło = więcej prób | natywny, szybki |
| Aparat | prosi o zgodę; w iPhone’ie okno `standalone` może pytać częściej | stabilnie |
| Praca w tle, synchronizacja po zamknięciu | ograniczona | ograniczona, ale lepsza |
| Aktualizacje | natychmiast po wdrożeniu | przez sklep |
| Dane na urządzeniu | Safari może usuwać dane stron nieużywanych dłuższy czas; zainstalowane aplikacje są chronione ❓ (zasady WebKit) | pewne (Keychain/Keystore) |
| Sesja logowania | przeglądarka: `localStorage` (mniej bezpieczne) | Keychain/Keystore (`expo-secure-store`) |
| Sklepy | brak | tak |

Wniosek: PWA to świetne **pierwsze wejście** (zero instalacji, zero sklepów, natychmiastowe poprawki). Dla zespołu, który codziennie skanuje i dostaje powiadomienia, docelowo warto mieć aplikację natywną.

## 5. Powiadomienia

### 5.1 Co działa dziś

| Kanał | Stan |
|---|---|
| Zakładka **Aktywność** (w aplikacji, na każdej platformie) | ✅ działa — powiadomienia zapisują się w tabeli `notifications` (RLS: każdy widzi swoje) i odświeżają przez Realtime |
| Push na iOS/Android (aplikacja natywna) | kod jest (`mobile/src/lib/push.ts`, funkcja `send-push`, usługa Expo Push) — **wymaga** zbudowanej aplikacji (nie Expo Go), `eas init` i, na Androidzie, konfiguracji Firebase (`docs/12_*`, rozdz. 3.5) ❓ nie testowane na urządzeniu |
| Web Push (PWA) | ❌ nie zbudowane |

Rodzaje powiadomień wysyłanych przez bazę: nowe zgłoszenie, zmiana statusu zgłoszenia, komentarz, niski stan, faktura gotowa do sprawdzenia, przypomnienie o mini‑spisie, KSeF (nowe faktury / problem z połączeniem).
Kliknięcie otwiera właściwy ekran (`mobile/src/lib/notification-target.ts`, pole `data.screen`).

### 5.2 Jak dodać Web Push (projekt, ok. 1–2 dni pracy) — NIE zrobione

1. **Klucze VAPID** (para kluczy serwera push): wygeneruj raz; klucz publiczny trafia do aplikacji (`EXPO_PUBLIC_VAPID_PUBLIC_KEY`), prywatny do sekretów funkcji.
2. **Tabela** `web_push_subscriptions` (użytkownik, firma, `endpoint`, klucze `p256dh` i `auth`, user‑agent, data) + RPC rejestrujące subskrypcję — analogicznie do `push_tokens`; wpis do testu inwariantów (`01_invariants`) i macierzy uprawnień.
3. **Klient:** przycisk „Włącz powiadomienia” w Ustawieniach (na PWA), wywołujący `Notification.requestPermission()` **z kliknięcia** (wymóg iOS ✅), potem `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` i zapis subskrypcji.
4. **Service worker:** zdarzenie `push` → `showNotification(title, { body, data })`; `notificationclick` → otwarcie `data.url` (ekran z `notification-target`).
5. **Serwer:** rozszerz `send-push` o wysyłkę Web Push (protokół RFC 8030 + szyfrowanie `aes128gcm` RFC 8291 + nagłówek VAPID RFC 8292). W Deno najprościej użyć biblioteki `web-push` (`npm:web-push`) — ❓ nie sprawdzone pod Edge Runtime; w razie kłopotów własna implementacja na WebCrypto (~200 linii).
6. **Testy:** jednostkowe (kształt ładunku), integracyjne z atrapą endpointu, test bazy dla nowej tabeli; ręcznie: Chrome na Androidzie i zainstalowana PWA na iPhonie (iOS ≥ 16.4).
7. Sprzątanie: subskrypcje, które zwracają 404/410, usuwaj z bazy.

Dopóki tego nie ma, **klientom PWA mów, że powiadomienia czekają w zakładce Aktywność** (jest też licznik nieprzeczytanych na dolnym pasku).

### 5.3 Push w aplikacji natywnej — skrót konfiguracji

* **iOS:** po `eas build --profile production --platform ios` EAS tworzy klucz APNs i zapisuje go w poświadczeniach. Nic nie robisz ręcznie ❓.
* **Android:** Firebase (FCM V1) — `docs/12_BUDOWANIE_I_PUBLIKACJA.md`, rozdz. 3.5.
* Opcjonalnie włącz w koncie Expo „Enhanced Security for Push Notifications” i ustaw sekret funkcji `EXPO_ACCESS_TOKEN` (`supabase/functions/.env.example`).
* Test: zainstaluj wersję deweloperską/preview na prawdziwym telefonie → Ustawienia → **Włącz powiadomienia** → wywołaj zdarzenie (np. zgłoś brak z drugiego konta) → po kilku–kilkunastu sekundach (harmonogram `cron-tasks` co minutę) przychodzi push.
