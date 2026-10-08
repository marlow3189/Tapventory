// Zakładanie firmy. Wołamy RPC create_tenant (migracja 0001) — jedna
// transakcja tworzy firmę, członkostwo właściciela i kod poleceń.
// Nie wstawiamy nic "ręcznie" po stronie aplikacji: logika i uprawnienia
// mieszkają w bazie, aplikacja tylko naciska przycisk.

import { useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Screen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';

export default function CompanyScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [nip, setNip] = useState('');
  const [busy, setBusy] = useState(false);

  async function createCompany() {
    const trimmedName = name.trim();
    const trimmedNip = nip.trim();

    if (trimmedName.length < 2) {
      Alert.alert('Uzupełnij dane', 'Podaj nazwę firmy (min. 2 znaki).');
      return;
    }
    if (trimmedNip && !/^[0-9]{10}$/.test(trimmedNip)) {
      Alert.alert('Sprawdź NIP', 'NIP to dokładnie 10 cyfr, bez kresek.');
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc('create_tenant', {
      p_name: trimmedName,
      p_nip: trimmedNip || null,
    });
    setBusy(false);

    if (error) {
      Alert.alert('Nie udało się utworzyć firmy', error.message);
      return;
    }
    router.replace('/(app)');
  }

  return (
    <Screen
      title="Twoja firma"
      subtitle="Utwórz firmę, do której zaprosisz zespół"
      scroll={false}
    >
      <TextField
        label="Nazwa firmy"
        placeholder="Salon Beauty Anna"
        value={name}
        onChangeText={setName}
      />
      <TextField
        label="NIP (opcjonalnie)"
        placeholder="1234567890"
        keyboardType="number-pad"
        maxLength={10}
        value={nip}
        onChangeText={setNip}
      />
      <Button title="Utwórz firmę" onPress={createCompany} loading={busy} />
    </Screen>
  );
}
