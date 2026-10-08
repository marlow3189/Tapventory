// ============================================================================
// Konfiguracja aplikacji (zastępuje app.json)
// ============================================================================
// Sztuczka trzech środowisk: zmienna APP_ENV zmienia nazwę i identyfikator
// paczki, więc na jednym telefonie mogą stać obok siebie:
//   Tapventory (Dev)  → com.tapventory.app.dev      (Twoja praca lokalna)
//   Tapventory (Test) → com.tapventory.app.staging  (wersja dla testerów)
//   Tapventory        → com.tapventory.app          (sklepy App Store / Google Play)
// Wartość APP_ENV ustawiają profile w eas.json — lokalnie domyślnie "development".
//
// ⚠️ WAŻNE, zanim cokolwiek trafi do sklepów: bundleIdentifier (iOS)
// i package (Android) po pierwszej publikacji są NIEZMIENIALNE na zawsze.
// Konwencja to odwrócona domena, którą POSIADASZ — mamy tapventory.com,
// stąd com.tapventory.app poniżej. Przed publikacją zostaje jeszcze
// rezerwacja nazwy „Tapventory" w App Store Connect (Apple wymaga
// unikalnej nazwy) — instrukcja: docs/00_INSTRUKCJA_BUDOWY_ETAPAMI.md, Etap 2.
// ============================================================================

import type { ConfigContext, ExpoConfig } from 'expo/config';

type Env = 'development' | 'staging' | 'production';
const APP_ENV = (process.env.APP_ENV ?? 'development') as Env;

const idSuffix: Record<Env, string> = {
  development: '.dev',
  staging: '.staging',
  production: '',
};
const nameSuffix: Record<Env, string> = {
  development: ' (Dev)',
  staging: ' (Test)',
  production: '',
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `Tapventory${nameSuffix[APP_ENV]}`,
  slug: 'tapventory',
  scheme: 'tapventory', // adres głębokich linków: tapventory://... (zaproszenia)
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',

  // Ikony i ekran startowy pochodzą z szablonu create-expo-app.
  // Jeśli w Twoim szablonie pliki nazywają się inaczej — popraw ścieżki.
  icon: './assets/images/icon.png',

  ios: {
    bundleIdentifier: `com.tapventory.app${idSuffix[APP_ENV]}`,
    supportsTablet: false,
  },
  android: {
    package: `com.tapventory.app${idSuffix[APP_ENV]}`,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#FFFFFF',
    },
  },

  plugins: ['expo-router'],
});
