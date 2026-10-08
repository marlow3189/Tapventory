// PWA (aplikacja instalowana z przeglądarki): rejestracja service workera i
// obsługa „Zainstaluj aplikację". Na telefonie (iOS/Android) ten plik nic nie robi.

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** Service worker rejestrujemy tylko w wersji produkcyjnej — w trybie deweloperskim cache by przeszkadzał. */
export function registerServiceWorker() {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (process.env.NODE_ENV !== 'production') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // aplikacja działa także bez service workera (tylko bez trybu offline)
    });
  });
}

/** Czy aplikacja jest już uruchomiona jako zainstalowana (ikona na ekranie głównym). */
export function isStandalone(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
}

export function isIosSafari(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  return ios;
}

export type InstallState = {
  /** przeglądarka pozwala wywołać systemowe okno instalacji (Chrome/Edge/Android) */
  canPrompt: boolean;
  /** iPhone/iPad: instalacja tylko ręcznie (Udostępnij → Do ekranu początkowego) */
  needsManualIos: boolean;
  installed: boolean;
  install: () => Promise<void>;
};

export function useInstallPrompt(): InstallState {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return {
    canPrompt: Boolean(evt) && !installed,
    needsManualIos: Platform.OS === 'web' && isIosSafari() && !installed,
    installed,
    install: async () => {
      if (!evt) return;
      await evt.prompt();
      await evt.userChoice;
      setEvt(null);
    },
  };
}
