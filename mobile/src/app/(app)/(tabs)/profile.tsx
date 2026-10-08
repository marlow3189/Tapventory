// Profil w stylu Instagrama: awatar, liczby, szybkie przyciski i lista narzędzi firmy.

import { useQueryClient } from '@tanstack/react-query';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Chips, ListRow, OfflineBanner, Pill, Section, Text, useDialogs } from '@/components/ui';
import { updateDisplayName, useDashboard } from '@/lib/api/misc';
import { useTeam } from '@/lib/api/team';
import { useAuth } from '@/lib/auth';
import { formatQty } from '@/lib/format';
import { useTenant } from '@/lib/tenant';
import { spacing, useColors } from '@/theme';

const ROLE_LABEL = { owner: 'Właściciel', manager: 'Kierownik', employee: 'Pracownik' } as const;

export default function Profile() {
  const c = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { tenantName, memberships, tenantId, setActiveTenant, role, isManager } = useTenant();
  const { confirm, prompt, fail, toast } = useDialogs();
  const team = useTeam();
  const dashboard = useDashboard();

  const me = team.data?.find((m) => m.user_id === user?.id);
  const name = me?.display_name ?? (user?.user_metadata?.display_name as string | undefined) ?? user?.email ?? '';
  const d = dashboard.data;

  async function rename() {
    const next = await prompt({ title: 'Twoje imię w zespole', initial: name, placeholder: 'Imię i nazwisko', confirmLabel: 'Zapisz' });
    if (!next || !user) return;
    try {
      await updateDisplayName(user.id, next);
      for (const k of ['team', 'requests', 'request', 'messages', 'movements']) qc.invalidateQueries({ queryKey: [k] });
      toast('Zapisano', 'success');
    } catch (e) {
      fail(e);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
      <OfflineBanner />
      <View style={styles.head}>
        <Avatar name={name} size={84} />
        <View style={styles.stats}>
          <Stat n={d?.products_total} label="Produkty" />
          <Stat n={d?.requests_open} label="Zgłoszenia" />
          <Stat n={d?.below_min} label="Braki" />
        </View>
      </View>

      <View style={styles.who}>
        <Text variant="headline">{name}</Text>
        <Text color="secondary" variant="callout">
          {user?.email}
        </Text>
        <View style={styles.badges}>
          {role ? <Pill label={ROLE_LABEL[role]} tone={role === 'employee' ? 'neutral' : 'violet'} /> : null}
          <Text variant="callout" color="secondary">
            {tenantName}
          </Text>
        </View>
      </View>

      <View style={styles.buttons}>
        <Button title="Edytuj imię" variant="secondary" size="s" onPress={() => void rename()} style={{ flex: 1 }} />
        <Button title="Zespół" variant="secondary" size="s" onPress={() => router.push('/team')} style={{ flex: 1 }} />
      </View>

      {memberships.length > 1 ? (
        <View style={{ marginTop: spacing.m }}>
          <Text variant="footnote" color="secondary" bold style={{ paddingHorizontal: spacing.l }}>
            AKTYWNA FIRMA
          </Text>
          <Chips
            options={memberships.map((m) => ({ value: m.tenant_id, label: m.tenants?.name ?? 'Firma' }))}
            value={tenantId ?? ''}
            onChange={(id) => {
              setActiveTenant(id);
              qc.clear();
            }}
          />
        </View>
      ) : null}

      <View style={styles.sections}>
        <Section title="Narzędzia">
          <ListRow icon="checkmark-done-outline" title="Mini-spis" subtitle="Policz kilka produktów" onPress={() => router.push('/count')} />
          {isManager ? <ListRow icon="document-text-outline" title="Faktury" subtitle="Skanowanie i księgowanie" onPress={() => router.push('/documents')} /> : null}
          <ListRow icon="sparkles-outline" title="Asystent AI" subtitle="Zapytaj, jak coś zrobić w aplikacji" onPress={() => router.push('/assistant')} last />
        </Section>

        <Section title="Konto i firma">
          <ListRow icon="people-outline" title="Zespół i zaproszenia" onPress={() => router.push('/team')} />
          <ListRow icon="settings-outline" title="Ustawienia" onPress={() => router.push('/settings')} />
          <ListRow icon="key-outline" title="Dołącz do innej firmy kodem" onPress={() => router.push('/join')} />
          <ListRow icon="add-circle-outline" title="Załóż nową firmę" onPress={() => router.push('/create-company')} last />
        </Section>

        <Section>
          <ListRow
            icon="log-out-outline"
            title="Wyloguj"
            danger
            chevron={false}
            last
            onPress={async () => {
              if (await confirm({ title: 'Wylogować się?', confirmLabel: 'Wyloguj' })) await signOut();
            }}
          />
        </Section>
        <Text variant="footnote" color="tertiary" align="center">
          {d ? `Stan magazynu: ${formatQty(d.products_total)} produktów` : ' '}
        </Text>
      </View>
    </ScrollView>
  );
}

function Stat({ n, label }: { n: number | undefined; label: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="title">{n ?? '–'}</Text>
      <Text variant="footnote" color="secondary">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, paddingHorizontal: spacing.l, paddingTop: spacing.l },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  who: { paddingHorizontal: spacing.l, paddingTop: spacing.m, gap: 2 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 },
  buttons: { flexDirection: 'row', gap: spacing.s, paddingHorizontal: spacing.l, paddingTop: spacing.m },
  sections: { padding: spacing.l, gap: spacing.l },
});
