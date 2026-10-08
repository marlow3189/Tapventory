import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useTenant } from '@/lib/tenant';
import { useColors } from '@/theme';

export default function OnboardingLayout() {
  const c = useColors();
  const { session, loading } = useAuth();
  const { tenantId, loading: tenantLoading } = useTenant();
  if (!loading && !session) return <Redirect href="/login" />;
  if (!loading && !tenantLoading && tenantId) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />;
}
