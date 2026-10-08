// ============================================================================
// Kontekst sesji: "czy ktoś jest zalogowany?" dostępne z każdego ekranu
// ============================================================================
// Dla juniora: Context w React to "wspólna tablica ogłoszeń" — zamiast
// podawać sesję z ekranu do ekranu przez parametry, każdy komponent
// czyta ją hookiem useAuth(). Nasłuch onAuthStateChange sprawia, że po
// zalogowaniu/wylogowaniu cała aplikacja reaguje natychmiast.
// ============================================================================

import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

type AuthContextValue = {
  session: Session | null;
  loading: boolean; // true, dopóki nie sprawdzimy zapisanej sesji z pamięci
};

const AuthContext = createContext<AuthContextValue>({ session: null, loading: true });

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1) Na starcie: wczytaj sesję zapisaną na urządzeniu (jeśli jest).
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // 2) Potem: reaguj na każde zalogowanie / wylogowanie / odświeżenie tokenu.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
