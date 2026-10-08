import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { RequireSession } from '@/components/RequireSession';
import { Button, Chips, Screen, Text, TextField, useDialogs } from '@/components/ui';
import { createTenant } from '@/lib/api/misc';
import { INDUSTRIES } from '@/lib/industries';
import { formatNip, isValidNip, normalizeNip } from '@/lib/nip';
import { useTenant } from '@/lib/tenant';

export default function CreateCompany() {
  return (
    <RequireSession returnTo="/create-company">
      <Form />
    </RequireSession>
  );
}

function Form() {
  const router = useRouter();
  const { refetch, setActiveTenant } = useTenant();
  const { fail, toast } = useDialogs();
  const [name, setName] = useState('');
  const [nip, setNip] = useState('');
  const [industry, setIndustry] = useState<string>(INDUSTRIES[0]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; nip?: string }>({});

  async function submit() {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Podaj nazwę firmy (min. 2 znaki).';
    const digits = normalizeNip(nip);
    if (digits && !isValidNip(digits)) next.nip = 'NIP ma błędną sumę kontrolną — sprawdź cyfry.';
    setErrors(next);
    if (next.name || next.nip) return;

    setBusy(true);
    try {
      const id = await createTenant(name.trim(), digits || null, industry);
      await refetch();
      setActiveTenant(id);
      toast('Firma utworzona. Witamy!', 'success');
      router.replace('/');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Nowa firma" scroll footer={<Button title="Utwórz firmę" onPress={submit} loading={busy} fullWidth />}>
      <Text color="secondary">
        Dane firmy możesz później zmienić w ustawieniach. NIP jest opcjonalny — przyda się do automatycznego rozpoznawania faktur
        (a w przyszłości do odbioru z KSeF).
      </Text>
      <TextField label="Nazwa firmy" value={name} onChangeText={setName} error={errors.name} placeholder="np. Warsztat u Marka" returnKeyType="next" />
      <TextField
        label="NIP (opcjonalnie)"
        value={nip}
        onChangeText={(t) => setNip(normalizeNip(t).length === 10 ? formatNip(t) : t)}
        error={errors.nip}
        keyboardType="number-pad"
        placeholder="000-000-00-00"
      />
      <View style={styles.block}>
        <Text variant="subhead" color="secondary" bold>
          Branża
        </Text>
        <View style={styles.chipsBleed}>
          <Chips options={INDUSTRIES.map((i) => ({ value: i, label: i }))} value={industry} onChange={setIndustry} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: 4 },
  chipsBleed: { marginHorizontal: -16 },
});
