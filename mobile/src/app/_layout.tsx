// Główny układ aplikacji: tu "zakładamy" wszystkie wspólne usługi (dane, sesja, firma,
// okna dialogowe), a pod spodem nawigacja podzielona na trzy grupy:
//   (auth)        — logowanie, rejestracja, reset hasła
//   (onboarding)  — założenie firmy albo dołączenie kodem z zaproszenia
//   (app)         — właściwa aplikacja (zakładki, produkty, zgłoszenia, faktury…)

import { useEffect, type PropsWithChildren } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { DialogsProvider } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { handleAuthUrl } from '@/lib/auth-links';
import { setupNotificationHandler } from '@/lib/push';
import { registerServiceWorker } from '@/lib/pwa';
import { queryClient, startQueryManagers } from '@/lib/query';
import { TenantProvider } from '@/lib/tenant';
import { layout, useColors } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  useEffect(() => {
    setupNotificationHandler();
    registerServiceWorker();
    return startQueryManagers();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TenantProvider>
            <AuthLinkListener />
            <ThemedApp />
          </TenantProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** Link z maila (reset hasła / potwierdzenie) otwarty w aplikacji na telefonie. */
function AuthLinkListener() {
  const url = Linking.useLinkingURL();
  const { beginRecovery } = useAuth();
  useEffect(() => {
    if (Platform.OS === 'web' || !url) return;
    void handleAuthUrl(url).then((r) => {
      if (r === 'recovery') beginRecovery();
    });
  }, [url, beginRecovery]);
  return null;
}

function ThemedApp() {
  const c = useColors();
  const base = c.isDark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, border: c.border, primary: c.primary },
  };
  return (
    <ThemeProvider value={theme}>
      <DialogsProvider>
        <WebFrame>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />
        </WebFrame>
      </DialogsProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

/**
 * W przeglądarce na komputerze aplikacja nie rozciąga się na cały ekran — jest wyśrodkowaną
 * kolumną jak Instagram w sieci (na telefonie ta ramka jest niewidoczna).
 */
function WebFrame({ children }: PropsWithChildren) {
  const c = useColors();
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={[styles.outer, { backgroundColor: c.bgSecondary }]}>
      <View style={[styles.inner, { backgroundColor: c.bg, borderColor: c.border }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, alignItems: 'center' },
  inner: { flex: 1, width: '100%', maxWidth: layout.maxContent, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
});
