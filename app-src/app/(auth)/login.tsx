// Ekran logowania. Po udanym logowaniu nie robimy nic ręcznie:
// bramka w (auth)/_layout.tsx sama wykryje sesję i przeniesie na pulpit.

import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Screen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';
import { spacing } from '../../theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    if (!email.trim() || !password) {
      Alert.alert('Uzupełnij dane', 'Podaj adres e-mail i hasło.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      Alert.alert('Nie udało się zalogować', error.message);
    }
  }

  return (
    <Screen title="Tapventory" subtitle="Magazyn i zakupy Twojej firmy" scroll={false}>
      <TextField
        label="E-mail"
        placeholder="jan@firma.pl"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextField
        label="Hasło"
        placeholder="••••••••"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />

      <Button title="Zaloguj się" onPress={signIn} loading={busy} />
      <View style={{ height: spacing.m }} />
      <Button
        title="Nie masz konta? Załóż je"
        variant="plain"
        onPress={() => router.push('/(auth)/register')}
      />
    </Screen>
  );
}
