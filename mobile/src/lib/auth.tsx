// ============================================================================
// Kontekst sesji: „czy ktoś jest zalogowany?" dostępne z każdego ekranu
// ============================================================================
// Dla juniora: Context w React to „wspólna tablica ogłoszeń" — zamiast podawać
// sesję z ekranu do ekranu, każdy komponent czyta ją hookiem useAuth().
// Nasłuch onAuthStateChange sprawia, że po zalogowaniu/wylogowaniu cała
// aplikacja reaguje natychmiast.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, wipeSessionOnFreshInstall } from './supabase';
import { queryClient } from './query';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** true, dopóki nie sprawdzimy zapisanej sesji z pamięci urządzenia */
  loading: boolean;
  /** użytkownik wszedł z linku „zresetuj hasło" (przeglądarka/PWA) */
  recovery: boolean;
  clearRecovery: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  session: null, user: null, loading: true, recovery: false, clearRecovery: () => {}, signOut: async () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await wipeSessionOnFreshInstall();
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setSession(data.session);
        setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(next);
      if (event === 'SIGNED_OUT') queryClient.clear();   // żadnych danych poprzedniego konta w pamięci
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    queryClient.clear();
  }, []);
  const clearRecovery = useCallback(() => setRecovery(false), []);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, loading, recovery, clearRecovery, signOut }),
    [session, loading, recovery, clearRecovery, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
