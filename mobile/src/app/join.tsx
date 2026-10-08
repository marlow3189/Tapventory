import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RequireSession } from '@/components/RequireSession';
import { Button, Screen, Text, TextField, useDialogs } from '@/components/ui';
import { acceptInviteCode } from '@/lib/api/team';
import { formatInviteCode, isCompleteInviteCode } from '@/lib/invite';
import { useTenant } from '@/lib/tenant';

export default function Join() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return (
    <RequireSession returnTo={code ? `/join?code=${encodeURIComponent(code)}` : '/join'}>
      <JoinForm initial={code} />
    </RequireSession>
  );
}

function JoinForm({ initial }: { initial?: string }) {
  const router = useRouter();
  const { refetch, setActiveTenant } = useTenant();
  const { fail, toast } = useDialogs();
  const [code, setCode] = useState(formatInviteCode(initial ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!isCompleteInviteCode(code)) return setError('Kod ma 8 znaków, np. ABCD-EFGH.');
    setError(null);
    setBusy(true);
    try {
      const tenantId = await acceptInviteCode(code);
      await refetch();
      setActiveTenant(tenantId);
      toast('Dołączono do firmy!', 'success');
      router.replace('/');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Dołącz do firmy" scroll footer={<Button title="Dołącz" onPress={submit} loading={busy} fullWidth />}>
      <Text color="secondary">
        Wpisz kod z zaproszenia, które dostałeś od szefa (e-mail, SMS albo wiadomość). Zaproszenie jest przypisane do adresu e-mail —
        zaloguj się tym samym adresem, na który je wysłano.
      </Text>
      <TextField
        label="Kod zaproszenia"
        value={code}
        onChangeText={(t) => setCode(formatInviteCode(t))}
        error={error}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABCD-EFGH"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
    </Screen>
  );
}
