// Właściwa aplikacja — dostępna wyłącznie po zalogowaniu i wybraniu firmy.
// Tu też uruchamiamy usługi "w tle": synchronizację na żywo i obsługę dotknięcia powiadomienia.

import { useEffect } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Redirect, Stack, useRouter, usePathname, type Href } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { notificationHref, type NotificationData } from '@/lib/notification-target';
import { useRealtimeSync } from '@/lib/realtime';
import { rememberDestination } from '@/lib/redirect';
import { useTenant } from '@/lib/tenant';
import { useColors } from '@/theme';

let lastHandledNotification: string | null = null;

/** Dotknięcie powiadomienia push (także to, które uruchomiło aplikację) → właściwy ekran. */
function useNotificationTaps() {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (Platform.OS === 'web' || !response) return;
    const id = response.notification.request.identifier;
    if (id === lastHandledNotification) return;
    lastHandledNotification = id;
    const data = (response.notification.request.content.data ?? {}) as NotificationData & { kind?: string };
    router.push(notificationHref(data.kind ?? '', data) as Href);
  }, [response, router]);
}

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
