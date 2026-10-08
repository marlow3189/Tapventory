// ============================================================================
// Konfiguracja aplikacji (zastępuje app.json) — iOS, Android i web (PWA)
// ============================================================================
// Sztuczka trzech środowisk: zmienna APP_ENV zmienia nazwę i identyfikator
// paczki, więc na jednym telefonie mogą stać obok siebie:
//   Tapventory (Dev)  → com.tapventory.app.dev      (praca lokalna)
//   Tapventory (Test) → com.tapventory.app.staging  (wersja dla testerów)
//   Tapventory        → com.tapventory.app          (App Store / Google Play)
// Wartość APP_ENV ustawiają profile w eas.json — lokalnie domyślnie "development".
//
// ⚠️ WAŻNE: bundleIdentifier (iOS) i package (Android) po pierwszej publikacji
// w sklepie są NIEZMIENIALNE na zawsze. Konwencja to odwrócona domena, którą
// POSIADASZ: mamy tapventory.com → com.tapventory.app.
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

const BRAND_COLOR = '#F5576C';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `Tapventory${nameSuffix[APP_ENV]}`,
  slug: 'tapventory',
  scheme: 'tapventory', // głębokie linki: tapventory://... (zaproszenia, powiadomienia)
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic', // jasny/ciemny tryb zgodnie z systemem

  ios: {
    bundleIdentifier: `com.tapventory.app${idSuffix[APP_ENV]}`,
    supportsTablet: false,
    infoPlist: {
      // Aplikacja używa wyłącznie standardowego HTTPS — odpowiada Apple na pytanie
      // o szyfrowanie raz na zawsze (bez tego każdy upload do TestFlight o nie pyta).
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: `com.tapventory.app${idSuffix[APP_ENV]}`,
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Zasada Google Play: prosimy tylko o to, czego naprawdę używamy. Wtyczki i szablon dokładają
    // domyślnie mikrofon i zapis na karcie — blokujemy je. SYSTEM_ALERT_WINDOW to „nakładka"
    // menu deweloperskiego: potrzebna tylko w wersjach developerskich, nie w sklepie.
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      ...(APP_ENV === 'production' ? ['android.permission.SYSTEM_ALERT_WINDOW'] : []),
    ],
  },

  web: {
    // "single" = jedna aplikacja SPA (index.html); ekrany są za logowaniem, więc
    // prerenderowanie każdej trasy ("static") nie ma sensu.
    output: 'single',
    bundler: 'metro',
    favicon: './assets/images/favicon.png',
    lang: 'pl',
    // Szablon strony (manifest PWA, ikony, kolory) leży w public/index.html — dla trybu "single"
    // Expo nie używa +html.tsx.
  },

  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFFFF',
        image: './assets/images/splash-icon.png',
        imageWidth: 160,
        dark: { backgroundColor: '#000000', image: './assets/images/splash-icon.png' },
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission:
          'Tapventory używa aparatu do skanowania kodów kreskowych produktów oraz faktur i do zdjęć zgłoszeń.',
        microphonePermission: false, // nie nagrywamy dźwięku
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Tapventory potrzebuje dostępu do zdjęć, aby dodać zdjęcie produktu lub faktury.',
        cameraPermission: 'Tapventory używa aparatu do zdjęć produktów, zgłoszeń i faktur.',
        microphonePermission: false, // nie nagrywamy wideo ani dźwięku
      },
    ],
    ['expo-notifications', { color: BRAND_COLOR }],
    // Tokeny logowania w Keychain/Keystore. faceIDPermission: false — nie używamy biometrii,
    // więc nie dodajemy NSFaceIDUsageDescription (Apple pyta o uzasadnienie każdego takiego wpisu).
    ['expo-secure-store', { faceIDPermission: false }],
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },

  extra: {
    appEnv: APP_ENV,
    // Identyfikator projektu EAS — uzupełni go `eas init` (patrz docs/12_*).
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
