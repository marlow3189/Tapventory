import { useRouter } from 'expo-router';
import { Button, EmptyState, Screen } from '@/components/ui';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen title="Nie znaleziono" back={false}>
      <EmptyState icon="compass-outline" title="Tej strony nie ma" message="Link może być nieaktualny albo strona została przeniesiona." />
      <Button title="Wróć na start" onPress={() => router.replace('/')} />
    </Screen>
  );
}
