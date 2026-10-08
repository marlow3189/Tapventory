// Bramka startowa: decyduje, dokąd trafia użytkownik po uruchomieniu aplikacji.
//   brak konfiguracji   → instrukcja uzupełnienia pliku .env
//   niezalogowany       → /login
//   bez firmy           → /onboarding (załóż firmę albo dołącz kodem)
//   wszystko gotowe     → /home (albo miejsce, do którego chciał wejść przed logowaniem)

import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { Redirect, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { BrandMark } from '@/components/BrandMark';
import { Button, ErrorState, Screen, Text } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { takeDestination } from '@/lib/redirect';
import { SUPABASE_CONFIGURED } from '@/lib/supabase';
import { useTenant } from '@/lib/tenant';
import { useColors } from '@/theme';

export default function Gate() {
  const c = useColors();
  const { session, loading, recovery, signOut } = useAuth();
  const tenant = useTenant();

  const ready = !loading && (!session || !tenant.loading);
  useEffect(() => {
    if (ready || !SUPABASE_CONFIGURED) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!SUPABASE_CONFIGURED) return <SetupInstructions />;
  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <BrandMark size={84} />
        <ActivityIndicator color={c.textSecondary} />
      </View>
    );
  }
  if (recovery) return <Redirect href="/reset-password" />;
  if (!session) return <Redirect href="/login" />;
  if (tenant.error) {
    return (
      <Screen title="Tapventory" back={false} headerRight={<Button title="Wyloguj" variant="ghost" size="s" onPress={signOut} />}>
        <ErrorState error={tenant.error} onRetry={() => void tenant.refetch()} />
      </Screen>
    );
  }
  if (!tenant.tenantId) return <Redirect href="/onboarding" />;
  return <Redirect href={(takeDestination() ?? '/home') as Href} />;
}

/** Pokazywana, gdy brakuje pliku .env — zamiast białego ekranu mówi, co zrobić. */
function SetupInstructions() {
  const web = Platform.OS === 'web';
  return (
    <Screen title="Konfiguracja" back={false} scroll>
      <BrandMark size={64} withName />
      <Text variant="headline">Aplikacja nie zna jeszcze Twojej bazy danych</Text>
      <Text color="secondary">
        Brakuje adresu i klucza Supabase. To jednorazowa czynność — zajmie 2 minuty:
      </Text>
      <Text>1. W folderze mobile skopiuj plik .env.example jako .env.</Text>
      <Text>
        2. W pliku .env wpisz EXPO_PUBLIC_SUPABASE_URL oraz EXPO_PUBLIC_SUPABASE_ANON_KEY (klucze znajdziesz w panelu
        Supabase: Project Settings → API albo poleceniem npx supabase status).
      </Text>
      <Text>3. Zatrzymaj aplikację (Ctrl+C) i uruchom ponownie: npx expo start --clear.</Text>
      <Text color="secondary" variant="subhead">
        {web
          ? 'Pełna instrukcja krok po kroku: docs/02_START_LOKALNY.md w repozytorium.'
          : 'Telefon i emulator Androida nie widzą „127.0.0.1" komputera — w .env użyj adresu IP komputera (emulator Androida: 10.0.2.2). Szczegóły: docs/02_START_LOKALNY.md.'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
});
