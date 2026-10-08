import { useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { AuthShell } from '@/components/AuthShell';
import { Button, Text, TextField, useDialogs } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { isEmail } from '@/lib/validation';

export default function Login() {
  const router = useRouter();
  const { fail } = useDialogs();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  async function submit() {
    const e = email.trim().toLowerCase();
    const next: typeof errors = {};
    if (!isEmail(e)) next.email = 'Wpisz poprawny adres e-mail.';
    if (!password) next.password = 'Wpisz hasło.';
    setErrors(next);
    if (next.email || next.password) return;

    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: e, password });
    setBusy(false);
    if (error) return fail(error);
    router.replace('/');
  }

  return (
    <AuthShell
      title="Zaloguj się"
      subtitle="Magazyn Twojej firmy w kieszeni."
      footer={
        <>
          <Link href="/forgot" asChild>
            <Text color="accent" bold accessibilityRole="link">
              Nie pamiętasz hasła?
            </Text>
          </Link>
          <Text color="secondary">
            Nie masz konta?{' '}
            <Link href="/register">
              <Text color="accent" bold>
                Załóż konto
              </Text>
            </Link>
          </Text>
        </>
      }
    >
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        returnKeyType="next"
      />
      <TextField
        label="Hasło"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secret
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Button title="Zaloguj się" onPress={submit} loading={busy} fullWidth />
    </AuthShell>
  );
}
