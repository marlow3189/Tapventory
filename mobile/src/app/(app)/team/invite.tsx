// Zapraszanie osoby: e-mail + rola → kod ABCD-EFGH i gotowa wiadomość do wysłania (SMS / WhatsApp / e-mail).

import { useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Chips, ListRow, Screen, Section, Text, TextField, useDialogs } from '@/components/ui';
import { useCreateInvite, type CreatedInvite } from '@/lib/api/team';
import { formatDate } from '@/lib/format';
import { formatInviteCode } from '@/lib/invite';
import { LINKS } from '@/lib/links';
import { useTenant } from '@/lib/tenant';
import { isEmail } from '@/lib/validation';
import { radius, useColors } from '@/theme';

export default function InvitePerson() {
  const c = useColors();
  const { isOwner, canBilling, tenantName } = useTenant();
  const { fail, toast } = useDialogs();
  const create = useCreateInvite();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'employee' | 'manager'>('employee');
  const [manageManagers, setManageManagers] = useState(false);
  const [manageBilling, setManageBilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  async function submit() {
    const e = email.trim().toLowerCase();
    if (!isEmail(e)) return setError('Wpisz poprawny adres e-mail.');
    setError(null);
    try {
      const res = await create.mutateAsync({ email: e, role, manageManagers: role === 'manager' && manageManagers, manageBilling: role === 'manager' && manageBilling });
      setCreated(res);
    } catch (err) {
      fail(err);
    }
  }

  if (created) {
    const code = formatInviteCode(created.code);
    const link = `${LINKS.app}/join?code=${code}`;
    const message = `Zapraszam Cię do firmy „${tenantName}” w aplikacji Tapventory.\n1) Załóż konto na adres ${created.email}\n2) Wpisz kod: ${code}\nLub otwórz: ${link}\nKod ważny do ${formatDate(created.expires_at)}.`;
    return (
      <Screen
        title="Zaproszenie gotowe"
        scroll
        footer={
          <>
            <Button
              title="Udostępnij zaproszenie"
              icon="share-outline"
              fullWidth
              onPress={async () => {
                try {
                  if (Platform.OS === 'web' && !(navigator as Navigator & { share?: unknown }).share) {
                    await Clipboard.setStringAsync(message);
                    toast('Skopiowano treść zaproszenia', 'success');
                  } else await Share.share({ message });
                } catch {
                  // użytkownik zamknął okno udostępniania
                }
              }}
            />
            <Button title="Gotowe" variant="secondary" onPress={() => setCreated(null)} fullWidth />
          </>
        }
      >
        <Text color="secondary">
          Wyślij to zaproszenie osobie {created.email}. Musi założyć konto na ten sam adres e-mail.
        </Text>
        <View style={[styles.codeBox, { backgroundColor: c.fill }]}>
          <Text variant="caption" color="secondary">
            KOD ZAPROSZENIA
          </Text>
          <Text style={styles.code} selectable accessibilityLabel={`Kod zaproszenia ${code.split('').join(' ')}`}>
            {code}
          </Text>
          <Button
            title="Kopiuj kod"
            size="s"
            variant="secondary"
            icon="copy-outline"
            onPress={async () => {
              await Clipboard.setStringAsync(code);
              toast('Skopiowano kod', 'success');
            }}
          />
        </View>
        <Text variant="footnote" color="secondary">
          Ważne do {formatDate(created.expires_at)}. Kod działa tylko raz.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen title="Zaproś osobę" scroll footer={<Button title="Utwórz zaproszenie" onPress={submit} loading={create.isPending} fullWidth />}>
      <TextField label="E-mail osoby" value={email} onChangeText={setEmail} error={error} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="jan@firma.pl" />
      <View style={{ gap: 4 }}>
        <Text variant="subhead" color="secondary" bold>
          Rola
        </Text>
        <View style={{ marginHorizontal: -16 }}>
          <Chips
            options={[{ value: 'employee', label: 'Pracownik' }, ...(isOwner ? [{ value: 'manager' as const, label: 'Kierownik' }] : [])]}
            value={role}
            onChange={setRole}
          />
        </View>
        <Text variant="footnote" color="secondary">
          {role === 'employee'
            ? 'Pracownik zdejmuje towar, zgłasza braki i komentuje. Nie widzi faktur ani nie edytuje produktów.'
            : 'Kierownik dodaje produkty, akceptuje zgłoszenia i księguje faktury.'}
        </Text>
      </View>
      {role === 'manager' && isOwner ? (
        <Section title="Dodatkowe uprawnienia" footer="Domyślnie wyłączone. Możesz je zmienić później.">
          <ListRow title="Może zarządzać innymi kierownikami" switchValue={manageManagers} onSwitch={setManageManagers} />
          {canBilling ? <ListRow title="Dostęp do płatności i planu" switchValue={manageBilling} onSwitch={setManageBilling} last /> : null}
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeBox: { alignItems: 'center', gap: 8, padding: 20, borderRadius: radius.l },
  code: { fontSize: 36, fontWeight: '800', letterSpacing: 4 },
});
