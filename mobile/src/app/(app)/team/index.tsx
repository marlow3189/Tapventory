// Zespół: osoby w firmie, role i oczekujące zaproszenia.

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Button, Chips, ErrorState, Pill, RowSkeleton, Screen, Section, ListRow, Sheet, Text, Touchable, useDialogs } from '@/components/ui';
import { useInvites, useRemoveMember, useRevokeInvite, useTeam, useUpdateMember } from '@/lib/api/team';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PLANS, type PlanId } from '@/lib/plans';
import { useDashboard } from '@/lib/api/misc';
import { useTenant } from '@/lib/tenant';
import type { Role, TeamMember } from '@/lib/types';
import { spacing } from '@/theme';

const ROLE_LABEL: Record<Role, string> = { owner: 'Właściciel', manager: 'Kierownik', employee: 'Pracownik' };

export default function Team() {
  const router = useRouter();
  const { user } = useAuth();
  const { isOwner, isManager } = useTenant();
  const { confirm, fail, toast } = useDialogs();
  const team = useTeam();
  const invites = useInvites();
  const revoke = useRevokeInvite();
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const dashboard = useDashboard();
  const [selected, setSelected] = useState<TeamMember | null>(null);

  const plan = dashboard.data?.plan as PlanId | undefined;
  const limit = plan ? PLANS[plan]?.users : undefined;

  async function changeRole(m: TeamMember, role: Role) {
    try {
      await update.mutateAsync({ membershipId: m.membership_id, patch: { role } });
      toast('Zmieniono rolę', 'success');
      setSelected(null);
    } catch (e) {
      fail(e);
    }
  }

  async function removeMember(m: TeamMember) {
    const self = m.user_id === user?.id;
    const ok = await confirm({
      title: self ? 'Opuścić firmę?' : `Usunąć ${m.display_name}?`,
      message: 'Historia ruchów i zgłoszeń zostaje w firmie (podpisana jego/jej imieniem).',
      confirmLabel: self ? 'Opuść' : 'Usuń z firmy',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(m.membership_id);
      toast(self ? 'Opuszczono firmę' : 'Usunięto z firmy', 'success');
      setSelected(null);
    } catch (e) {
      fail(e);
    }
  }

  return (
    <Screen
      title="Zespół"
      scroll
      onRefresh={() => {
        void team.refetch();
        void invites.refetch();
      }}
      refreshing={team.isRefetching}
      footer={isManager ? <Button title="Zaproś osobę" icon="person-add-outline" onPress={() => router.push('/team/invite')} fullWidth /> : undefined}
    >
      {team.isPending ? (
        <RowSkeleton />
      ) : team.isError ? (
        <ErrorState error={team.error} onRetry={() => void team.refetch()} />
      ) : (
        <>
          <Section title={`Osoby (${team.data.length}${limit ? ` z ${limit}` : ''})`}>
            {team.data.map((m, i) => (
              <Touchable
                key={m.membership_id}
                onPress={() => setSelected(m)}
                accessibilityLabel={`${m.display_name}, ${ROLE_LABEL[m.role]}`}
                style={[styles.row, i < team.data.length - 1 ? styles.rowBorder : null]}
              >
                <Avatar name={m.display_name} size={44} />
                <View style={{ flex: 1 }}>
                  <Text bold numberOfLines={1}>
                    {m.display_name}
                    {m.user_id === user?.id ? ' (Ty)' : ''}
                  </Text>
                  <Text variant="footnote" color="secondary" numberOfLines={1}>
                    {m.email}
                  </Text>
                </View>
                <Pill label={ROLE_LABEL[m.role]} tone={m.role === 'employee' ? 'neutral' : 'violet'} />
              </Touchable>
            ))}
          </Section>

          {isManager && invites.data && invites.data.length > 0 ? (
            <Section title="Oczekujące zaproszenia" footer="Zaproszony zakłada konto na ten sam adres e-mail i wpisuje kod w aplikacji (Profil → Dołącz kodem).">
              {invites.data.map((inv, i) => (
                <ListRow
                  key={inv.id}
                  icon="mail-unread-outline"
                  title={inv.email}
                  subtitle={`${ROLE_LABEL[inv.role]} · ważne do ${formatDate(inv.expires_at)}`}
                  chevron={false}
                  last={i === invites.data.length - 1}
                  right={
                    <Button
                      title="Cofnij"
                      size="s"
                      variant="secondary"
                      onPress={async () => {
                        if (!(await confirm({ title: 'Cofnąć zaproszenie?', confirmLabel: 'Cofnij', destructive: true }))) return;
                        try {
                          await revoke.mutateAsync(inv.id);
                        } catch (e) {
                          fail(e);
                        }
                      }}
                    />
                  }
                />
              ))}
            </Section>
          ) : null}
        </>
      )}

      <Sheet visible={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.display_name} scroll>
        {selected ? (
          <View style={{ gap: 12, paddingHorizontal: 16, paddingBottom: 8 }}>
            <Text color="secondary" align="center">
              {selected.email} · {ROLE_LABEL[selected.role]}
            </Text>
            {isOwner && selected.role !== 'owner' ? (
              <>
                <Text variant="footnote" color="secondary" bold>
                  Rola
                </Text>
                <View style={{ marginHorizontal: -16 }}>
                  <Chips
                    options={[{ value: 'employee', label: 'Pracownik' }, { value: 'manager', label: 'Kierownik' }]}
                    value={selected.role as 'employee' | 'manager'}
                    onChange={(r) => void changeRole(selected, r as Role)}
                  />
                </View>
              </>
            ) : null}
            {selected.role === 'owner' && selected.user_id !== user?.id ? (
              <Text variant="callout" color="secondary" align="center">
                Właściciela może usunąć tylko on sam.
              </Text>
            ) : null}
            {(isManager && selected.role !== 'owner') || selected.user_id === user?.id ? (
              <Button
                title={selected.user_id === user?.id ? 'Opuść firmę' : 'Usuń z firmy'}
                variant="outline"
                onPress={() => void removeMember(selected)}
                loading={remove.isPending}
                fullWidth
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.l, paddingVertical: 10 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128,128,128,0.35)' },
});
