import { useState } from 'react';
import { useRouter } from 'expo-router';
import { AuthShell } from '@/components/AuthShell';
import { Button, Text, TextField, useDialogs } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { MIN_PASSWORD } from '@/lib/validation';

export default function ResetPassword() {
  const router = useRouter();
  const { session, loading, clearRecovery } = useAuth();
  const { fail, toast } = useDialogs();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<{ password?: string; repeat?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next: typeof errors = {};
    if (password.length < MIN_PASSWORD) next.password = `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.`;
    if (repeat !== password) next.repeat = 'Hasła nie są takie same.';
    setErrors(next);
    if (next.password || next.repeat) return;

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return fail(error);
    clearRecovery();
    toast('Hasło zmienione. Witaj z powrotem!', 'success');
    router.replace('/');
  }

  if (!loading && !session) {
    return (
      <AuthShell title="Link wygasł" subtitle="Ten link do resetu hasła jest już nieważny. Poproś o nowy.">
        <Button title="Wyślij nowy link" onPress={() => router.replace('/forgot')} fullWidth />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Nowe hasło" subtitle="Wpisz nowe hasło do swojego konta.">
      <TextField label="Nowe hasło" value={password} onChangeText={setPassword} error={errors.password} secret autoCapitalize="none" autoComplete="new-password" />
      <TextField label="Powtórz hasło" value={repeat} onChangeText={setRepeat} error={errors.repeat} secret autoCapitalize="none" autoComplete="new-password" returnKeyType="go" onSubmitEditing={submit} />
      <Button title="Zapisz hasło" onPress={submit} loading={busy} fullWidth />
      <Text variant="footnote" color="secondary" align="center">
        Po zmianie hasła zostaniesz zalogowany.
      </Text>
    </AuthShell>
  );
}
