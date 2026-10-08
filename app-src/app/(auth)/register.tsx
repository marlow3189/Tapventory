// Rejestracja konta. display_name wysyłamy w metadanych — trigger
// handle_new_user w bazie (migracja 0001) tworzy z tego profil.
//
// Dwa możliwe zachowania Supabase (oba obsługujemy):
//  * potwierdzanie e-maila WYŁĄCZONE (domyślnie lokalnie) → sesja od razu,
//    bramka przenosi na pulpit;
//  * potwierdzanie WŁĄCZONE (tak ustawimy test/prod) → sesji brak,
//    pokazujemy prośbę o klik w link z maila.
//    Lokalnie wszystkie maile lądują w skrzynce testowej: http://127.0.0.1:54324

import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Screen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';
import { spacing } from '../../theme/tokens';

export default function RegisterScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function signUp() {
    if (displayName.trim().length < 2) {
      Alert.alert('Uzupełnij dane', 'Podaj imię i nazwisko (min. 2 znaki).');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Za krótkie hasło', 'Hasło musi mieć co najmniej 8 znaków.');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() } },
    });
    setBusy(false);

    if (error) {
      Alert.alert('Nie udało się założyć konta', error.message);
      return;
    }
    if (!data.session) {
      Alert.alert(
        'Potwierdź adres e-mail',
        'Wysłaliśmy link aktywacyjny na ' + email.trim() + '. Kliknij go, a potem zaloguj się.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    }
    // Gdy sesja istnieje — bramka w _layout sama przeniesie na pulpit.
  }

  return (
    <Screen title="Nowe konto" subtitle="Zajmie to pół minuty" scroll={false}>
      <TextField
        label="Imię i nazwisko"
        placeholder="Jan Kowalski"
        autoComplete="name"
        value={displayName}
        onChangeText={setDisplayName}
      />
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
        label="Hasło (min. 8 znaków)"
        placeholder="••••••••"
        secureTextEntry
        autoComplete="new-password"
        value={password}
        onChangeText={setPassword}
      />

      <Button title="Załóż konto" onPress={signUp} loading={busy} />
      <View style={{ height: spacing.m }} />
      <Button title="Mam już konto" variant="plain" onPress={() => router.back()} />
    </Screen>
  );
}
