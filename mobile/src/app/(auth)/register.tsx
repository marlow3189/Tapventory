import { useState } from 'react';
import { Linking as RNLinking, Platform, StyleSheet, View } from 'react-native';
import * as Linking from 'expo-linking';
import { Link, useRouter } from 'expo-router';
import { AuthShell } from '@/components/AuthShell';
import { Button, Icon, Text, TextField, Touchable, useDialogs } from '@/components/ui';
import { LINKS } from '@/lib/links';
import { supabase } from '@/lib/supabase';
import { MIN_PASSWORD, isEmail } from '@/lib/validation';
import { useColors } from '@/theme';

export default function Register() {
  const c = useColors();
  const router = useRouter();
  const { fail, alert } = useDialogs();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    const e = email.trim().toLowerCase();
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = 'Podaj imię (min. 2 znaki).';
    if (!isEmail(e)) next.email = 'Wpisz poprawny adres e-mail.';
    if (password.length < MIN_PASSWORD) next.password = `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.`;
    if (!accepted) next.accepted = 'Zaakceptuj regulamin i politykę prywatności.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: e,
      password,
      options: {
        data: { display_name: name.trim() },
        emailRedirectTo: Platform.OS === 'web' ? window.location.origin : Linking.createURL('/'),
      },
    });
    setBusy(false);
    if (error) return fail(error);

    if (!data.session) {
      // projekt Supabase wymaga potwierdzenia adresu e-mail
      await alert('Sprawdź skrzynkę', `Wysłaliśmy link potwierdzający na ${e}. Kliknij go, a potem zaloguj się.`);
      router.replace('/login');
      return;
    }
    router.replace('/');
  }

  return (
    <AuthShell
      title="Załóż konto"
      subtitle="Zajmie to minutę. Firmę dodasz w następnym kroku."
      footer={
        <Text color="secondary">
          Masz już konto?{' '}
          <Link href="/login">
            <Text color="accent" bold>
              Zaloguj się
            </Text>
          </Link>
        </Text>
      }
    >
      <TextField label="Imię i nazwisko" value={name} onChangeText={setName} error={errors.name} autoComplete="name" textContentType="name" returnKeyType="next" />
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
        hint={`Minimum ${MIN_PASSWORD} znaków.`}
        secret
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />

      <View style={{ gap: 6 }}>
        <Touchable onPress={() => setAccepted((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} style={styles.check}>
          <Icon name={accepted ? 'checkbox' : 'square-outline'} size={24} color={accepted ? c.primary : c.textSecondary} />
          <Text variant="callout" style={{ flex: 1 }}>
            Akceptuję{' '}
            <Text variant="callout" color="accent" onPress={() => RNLinking.openURL(LINKS.terms)}>
              regulamin
            </Text>{' '}
            i{' '}
            <Text variant="callout" color="accent" onPress={() => RNLinking.openURL(LINKS.privacy)}>
              politykę prywatności
            </Text>
            .
          </Text>
        </Touchable>
        {errors.accepted ? (
          <Text variant="footnote" color="danger">
            {errors.accepted}
          </Text>
        ) : null}
      </View>

      <Button title="Załóż konto" onPress={submit} loading={busy} fullWidth />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
});
