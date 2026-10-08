// ============================================================================
// Połączenie aplikacji z Supabase (wzorzec z oficjalnej dokumentacji RN)
// ============================================================================
// Dla juniora:
//  * "Klient" to obiekt, przez który rozmawiamy z backendem:
//    supabase.auth (logowanie), supabase.from('tabela') (dane),
//    supabase.rpc('funkcja') (nasze RPC z migracji 0001).
//  * Klucz ANON jest PUBLICZNY z założenia — sam w sobie nie daje dostępu
//    do niczego. O tym, co wolno, decyduje RLS w bazie + tożsamość
//    zalogowanego użytkownika. Klucza service_role NIGDY tu nie wklejamy.
//  * Zmienne EXPO_PUBLIC_... Expo wkleja do aplikacji podczas budowania —
//    wartości bierzemy z pliku .env (dev) albo z profilu EAS (test/prod).
// ============================================================================

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Głośny błąd zamiast cichej awarii — najczęstsza wpadka przy montażu
  // to brak pliku .env. Ten komunikat oszczędzi godzinę szukania.
  throw new Error(
    'Brak konfiguracji Supabase. Utwórz plik .env na wzór .env.example ' +
      'i zrestartuj `npx expo start` z flagą -c (czyszczenie cache).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,     // sesja przeżywa zamknięcie aplikacji
    autoRefreshToken: true,    // tokeny odświeżają się same w tle
    persistSession: true,
    detectSessionInUrl: false, // to mechanizm webowy — w aplikacji mobilnej: wył.
  },
});

// Odświeżanie tokenów tylko, gdy aplikacja jest na ekranie —
// oszczędza baterię i łącze (wzorzec z dokumentacji Supabase).
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
