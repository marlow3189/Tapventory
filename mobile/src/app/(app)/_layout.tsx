// Właściwa aplikacja — dostępna wyłącznie po zalogowaniu i wybraniu firmy.
// Tu też uruchamiamy usługi "w tle": synchronizację na żywo i obsługę dotknięcia powiadomienia.

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, Stack, usePathname } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useNotificationTaps } from '@/lib/notification-taps';
import { useRealtimeSync } from '@/lib/realtime';
import { rememberDestination } from '@/lib/redirect';
import { useTenant } from '@/lib/tenant';
import { useColors } from '@/theme';

export default function AppLayout() {
  const c = useColors();
  const pathname = usePathname();
  const { session, loading, user } = useAuth();
  const { tenantId, loading: tenantLoading } = useTenant();

  useRealtimeSync(tenantId, user?.id ?? null);
  useNotificationTaps();

  // niezalogowany wszedł na konkretny ekran (np. z linku) — zapamiętujemy, by po logowaniu tam wrócić
  const signedOut = !loading && !session;
  useEffect(() => {
    if (signedOut) rememberDestination(pathname);
  }, [signedOut, pathname]);

  if (loading || tenantLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.textSecondary} />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;
  if (!tenantId) return <Redirect href="/onboarding" />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="story/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
    </Stack>
  );
}
