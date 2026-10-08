import { useEffect, type PropsWithChildren } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { rememberDestination } from '@/lib/redirect';

/**
 * Ekrany dostępne tylko po zalogowaniu, ale spoza głównej aplikacji (np. /join z linku w mailu).
 * Niezalogowanego odsyłamy do logowania i pamiętamy, dokąd miał trafić.
 */
export function RequireSession({ returnTo, children }: PropsWithChildren<{ returnTo: string }>) {
  const { session, loading } = useAuth();
  const signedOut = !loading && !session;
  useEffect(() => {
    if (signedOut) rememberDestination(returnTo);
  }, [signedOut, returnTo]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;
  return <>{children}</>;
}
