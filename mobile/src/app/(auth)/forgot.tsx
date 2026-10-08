import { useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { AuthShell } from '@/components/AuthShell';
import { Button, Icon, Text, TextField, useDialogs } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { isEmail } from '@/lib/validation';
import { useColors } from '@/theme';

export default function Forgot() {
  const c = useColors();
  const { fail } = useDialogs();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    const e = email.trim().toLowerCase();
    if (!isEmail(e)) return setError('Wpisz poprawny adres e-mail.');
    setError(null);
    setBusy(true);
    const redirectTo = Platform.OS === 'web' ? `${window.location.origin}/reset-password` : Linking.createURL('/reset-password');
    const { error: err } = await supabase.auth.resetPasswordForEmail(e, { redirectTo });
    setBusy(false);
    if (err) return fail(err);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Sprawdź skrzynkę"
        subtitle={`Jeśli konto ${email.trim()} istnieje, wysłaliśmy na nie link do ustawienia nowego hasła.`}
        footer={
          <Link href="/login">
            <Text color="accent" bold>
              Wróć do logowania
            </Text>
          </Link>
        }
      >
        <Icon name="mail-open-outline" size={56} color={c.primary} style={{ alignSelf: 'center' }} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset hasła"
      subtitle="Podaj e-mail konta. Wyślemy link do ustawienia nowego hasła."
      footer={
        <Link href="/login">
          <Text color="accent" bold>
            Wróć do logowania
          </Text>
        </Link>
      }
    >
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        error={error}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Button title="Wyślij link" onPress={submit} loading={busy} fullWidth />
    </AuthShell>
  );
}
