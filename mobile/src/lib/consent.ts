// Zgoda na przetwarzanie dokumentów przez AI. Apple (wytyczna 5.1.2(i)) wymaga, by przed
// pierwszym wysłaniem danych do zewnętrznej usługi AI użytkownik wyraźnie się zgodził i wiedział,
// KOMU i PO CO dane trafiają. Zgodę zapisujemy lokalnie (z datą i wersją tekstu) i można ją wycofać.

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Nazwa dostawcy pokazywana użytkownikowi — zmień razem z funkcją process-document. */
export const AI_PROVIDER_LABEL = 'Anthropic (USA)';
export const CONSENT_VERSION = 1;
const KEY = `tv.aiConsent.v${CONSENT_VERSION}`;

export function useAiConsent() {
  const [consented, setConsented] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((v) => alive && setConsented(Boolean(v)))
      .catch(() => alive && setConsented(false));
    return () => {
      alive = false;
    };
  }, []);

  const give = useCallback(async () => {
    await AsyncStorage.setItem(KEY, new Date().toISOString());
    setConsented(true);
  }, []);
  const revoke = useCallback(async () => {
    await AsyncStorage.removeItem(KEY);
    setConsented(false);
  }, []);

  return { consented, give, revoke };
}
