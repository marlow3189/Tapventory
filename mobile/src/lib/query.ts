// Pamięć podręczna zapytań (TanStack Query): ładowanie, błędy, odświeżanie po
// powrocie do aplikacji i po odzyskaniu sieci — bez ręcznego pisania tego w każdym ekranie.

import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnReconnect: true,
    },
    mutations: { retry: 0 },
  },
});

let started = false;
/** Podpina sieć i „powrót do aplikacji" do mechanizmów odświeżania. Wołane raz, na starcie. */
export function startQueryManagers(): () => void {
  if (started) return () => {};
  started = true;
  const unsubNet = NetInfo.addEventListener((state) => {
    onlineManager.setOnline(state.isConnected !== false);
  });
  let unsubApp: { remove(): void } | undefined;
  if (Platform.OS !== 'web') {
    unsubApp = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
  }
  return () => {
    started = false;
    unsubNet();
    unsubApp?.remove();
  };
}
