import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useColors } from '@/theme';

export default function AuthLayout() {
  const c = useColors();
  const { session, loading, recovery } = useAuth();
  // zalogowany nie ma tu czego szukać — z wyjątkiem resetu hasła z linku w mailu
  if (!loading && session && !recovery) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />;
}
