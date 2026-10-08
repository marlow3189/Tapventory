// ============================================================================
// Połączenie aplikacji z Supabase (iOS, Android i przeglądarka/PWA)
// ============================================================================
// Dla juniora:
//  * "Klient" to obiekt, przez który rozmawiamy z backendem:
//    supabase.auth (logowanie), supabase.from('tabela') (dane),
//    supabase.rpc('funkcja') (nasze funkcje z migracji), supabase.storage (pliki).
//  * Klucz ANON jest PUBLICZNY z założenia — sam w sobie nie daje dostępu do
//    niczego. O tym, co wolno, decyduje RLS w bazie + zalogowany użytkownik.
//    Klucza service_role NIGDY tu nie wklejamy.
//  * Zmienne EXPO_PUBLIC_... Expo wkleja do aplikacji podczas budowania —
//    wartości bierzemy z pliku .env (dev) albo z profilu EAS (test/prod).
// ============================================================================

import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { secureSessionStorage } from './secure-storage';

if (Platform.OS !== 'web') {
  // Poprawka adresów URL dla silnika JS w telefonie (w przeglądarce niepotrzebna).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-url-polyfill/auto');
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const SUPABASE_CONFIGURED = Boolean(
  supabaseUrl && supabaseAnonKey && !supabaseAnonKey.startsWith('wklej')
);

export const AUTH_STORAGE_KEY = 'tapventory-auth';

// Brak konfiguracji nie wywala aplikacji białym ekranem — ekran startowy pokaże
// czytelną instrukcję (patrz src/app/index.tsx). Klient dostaje atrapę adresu,
// żeby import się nie wysypał.
export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? 'http://127.0.0.1:54321',
  supabaseAnonKey ?? 'brak-klucza',
  {
    auth: {
      // telefon: Keychain/Keystore; przeglądarka: domyślny localStorage
      storage: Platform.OS === 'web' ? undefined : secureSessionStorage,
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      // w przeglądarce czytamy sesję z linku z maila (potwierdzenie, reset hasła)
      detectSessionInUrl: Platform.OS === 'web',
    },
  }
);

/**
 * iOS zostawia wpisy Keychain po odinstalowaniu aplikacji. Flaga w AsyncStorage
 * (kasowana razem z aplikacją) pozwala wykryć świeżą instalację i wyczyścić
 * „odziedziczoną" sesję — inaczej po reinstalacji ktoś byłby nadal zalogowany.
 */
export async function wipeSessionOnFreshInstall(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const seen = await AsyncStorage.getItem('tv.installed');
    if (!seen) {
      await secureSessionStorage.removeItem(AUTH_STORAGE_KEY);
      await AsyncStorage.setItem('tv.installed', '1');
    }
  } catch {
    // brak dostępu do pamięci nie może blokować startu
  }
}

// Odświeżanie tokenów tylko, gdy aplikacja jest na ekranie (oszczędza baterię i łącze).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
