// Szczegóły zgłoszenia: oś statusów, zdjęcie, akcje kierownika i czat („komentarze").

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { requestTitle } from '@/components/RequestCard';
import {
  Avatar, Button, Chips, ErrorState, Icon, PhotoPlaceholder, Pill, RowSkeleton, Screen, Sheet, SignedImage, Text, TextField, Touchable, useDialogs,
} from '@/components/ui';
import { useSuppliers } from '@/lib/api/products';
import { useRequest, useRequestEvents, useRequestMessages, useSendMessage, useSetRequestStatus, useToggleVote } from '@/lib/api/requests';
import { useAuth } from '@/lib/auth';
import { formatDate, formatQty, plural, timeAgo } from '@/lib/format';
import { STATUS_LABEL, STATUS_TONE, nextActions, type RequestStatus } from '@/lib/status';
import { useTenant } from '@/lib/tenant';
import { spacing, useColors } from '@/theme';

const STEPS: { status: RequestStatus; label: string; at: 'created_at' | 'accepted_at' | 'ordered_at' | 'delivered_at' | 'received_at' }[] = [
  { status: 'reported', label: 'Zgłoszone', at: 'created_at' },
  { status: 'accepted', label: 'Zaakceptowane', at: 'accepted_at' },
  { status: 'ordered', label: 'Zamówione', at: 'ordered_at' },
  { status: 'delivered', label: 'Dostarczone', at: 'delivered_at' },
  { status: 'received', label: 'Przyjęte', at: 'received_at' },
];

export default function RequestDetail() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { isManager } = useTenant();
  const { confirm, fail, toast } = useDialogs();
  const request = useRequest(id);
  const messages = useRequestMessages(id);
  const events = useRequestEvents(id);
  const suppliers = useSuppliers();
  const setStatus = useSetRequestStatus();
  const send = useSendMessage();
  const vote = useToggleVote();

  const [draft, setDraft] = useState('');
  const [orderOpen, setOrderOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('none');

  const r = request.data;

  const thread = useMemo(() => {
    const items = [
      ...(messages.data ?? []).map((m) => ({ kind: 'msg' as const, at: m.created_at, key: `m-${m.id}`, m })),
      ...(events.data ?? []).filter((e) => e.from_status !== null).map((e) => ({ kind: 'evt' as const, at: e.created_at, key: `e-${e.id}`, e })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [messages.data, events.data]);

  if (request.isError && !r) {
    return (
      <Screen title="Zgłoszenie">
        <ErrorState error={request.error} onRetry={() => void request.refetch()} />
      </Screen>
    );
  }
  if (!r) {
    return (
      <Screen title="Zgłoszenie">
        <RowSkeleton />
      </Screen>
    );
  }

  const title = requestTitle(r);
  const mine = r.reporter_id === user?.id;
  const actions = nextActions(r.status, { isManager, isReporter: mine });
  const stepIndex = r.status === 'rejected' ? -1 : STEPS.findIndex((s) => s.status === r.status);
  const reporter = r.reporter_deleted ? 'Usunięty użytkownik' : r.reporter_name;

  async function run(to: RequestStatus, label: string, destructive: boolean, supplier?: string | null) {
    if (destructive) {
      const ok = await confirm({ title: `${label}?`, message: 'Tej zmiany nie można cofnąć — historia zgłoszenia zachowa wpis.', confirmLabel: label, destructive: true });
      if (!ok) return;
    }
    try {
      await setStatus.mutateAsync({ id: r!.id, to, supplierId: supplier });
      toast(`Status: ${STATUS_LABEL[to]}`, 'success');
    } catch (e) {
      fail(e);
    }
  }

  return (
    <Screen
      title={title}
      scroll
      padded={false}
      refreshing={request.isRefetching}
      onRefresh={() => {
        void request.refetch();
        void messages.refetch();
        void events.refetch();
      }}
      footer={
        <View style={styles.composer}>
          <View style={{ flex: 1 }}>
            <TextField value={draft} onChangeText={setDraft} placeholder="Napisz komentarz…" returnKeyType="send" onSubmitEditing={() => void submit()} />
          </View>
          <Touchable
            onPress={() => void submit()}
            disabled={!draft.trim() || send.isPending}
            accessibilityLabel="Wyślij komentarz"
            style={[styles.send, { backgroundColor: c.primary }]}
          >
            <Icon name="arrow-up" size={22} color="#FFFFFF" />
          </Touchable>
        </View>
      }
      contentStyle={{ gap: 0 }}
    >
      <View style={[styles.photo, { backgroundColor: c.fill }]}>
        <SignedImage path={r.photo_path ?? r.product_photo_path} style={StyleSheet.absoluteFill} fallback={<PhotoPlaceholder name={title} />} label={title} />
      </View>

      <View style={styles.block}>
        <View style={styles.titleRow}>
          <Text variant="title" style={{ flex: 1 }}>
            {title}
          </Text>
          <Pill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
        </View>
        <View style={styles.meta}>
          <Avatar name={reporter} size={22} />
          <Text variant="callout" color="secondary" style={{ flex: 1 }}>
            {mine ? 'Ty' : reporter} · {timeAgo(r.created_at)}
          </Text>
          {!mine ? (
            <Touchable
              haptic
              onPress={() => vote.mutate({ requestId: r.id, voted: r.voted_by_me })}
              accessibilityLabel={r.voted_by_me ? 'Cofnij: też tego potrzebuję' : 'Też tego potrzebuję'}
              style={styles.voteBtn}
            >
              <Icon name={r.voted_by_me ? 'heart' : 'heart-outline'} size={26} color={r.voted_by_me ? c.danger : c.text} />
            </Touchable>
          ) : null}
        </View>
        {r.vote_count > 0 ? (
          <Text variant="subhead" color="secondary">
            {r.vote_count} {plural(r.vote_count, ['osoba też potrzebuje', 'osoby też potrzebują', 'osób też potrzebuje'])} tego
          </Text>
        ) : null}

        <View style={{ gap: 6 }}>
          {r.qty !== null ? <Info icon="layers-outline" text={`Ilość: ${formatQty(r.qty)}${r.product_unit ? ` ${r.product_unit}` : ''}`} /> : null}
          {r.project_name ? <Info icon="briefcase-outline" text={`Zlecenie: ${r.project_name}`} /> : null}
          {r.supplier_name ? <Info icon="storefront-outline" text={`Dostawca: ${r.supplier_name}`} /> : null}
          {r.note ? <Info icon="document-text-outline" text={r.note} /> : null}
        </View>

        {r.status === 'rejected' ? (
          <View style={[styles.rejected, { backgroundColor: c.fill }]}>
            <Icon name="close-circle" size={20} color={c.danger} />
            <Text color="secondary">Zgłoszenie zostało odrzucone lub wycofane.</Text>
          </View>
        ) : (
          <View style={styles.steps}>
            {STEPS.map((s, i) => {
              const done = i <= stepIndex;
              const when = r[s.at];
              return (
                <View key={s.status} style={styles.step}>
                  <View style={[styles.dot, { backgroundColor: done ? c.success : c.fill, borderColor: done ? c.success : c.border }]}>
                    {done ? <Icon name="checkmark" size={12} color="#FFFFFF" /> : null}
                  </View>
                  <Text variant="footnote" align="center" color={done ? 'primary' : 'tertiary'} numberOfLines={2}>
                    {s.label}
                  </Text>
                  {when && done ? (
                    <Text variant="caption" color="tertiary">
                      {formatDate(when).slice(0, 5)}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {actions.length > 0 ? (
          <View style={{ gap: 8 }}>
            {actions.map((a) => (
              <Button
                key={a.to}
                title={a.label}
                variant={a.kind === 'primary' ? 'primary' : a.kind === 'danger' ? 'outline' : 'secondary'}
                loading={setStatus.isPending}
                onPress={() => {
                  if (a.to === 'ordered') {
                    setSupplierId(r.supplier_id ?? 'none');
                    setOrderOpen(true);
                  } else void run(a.to, a.label, a.kind === 'danger');
                }}
                fullWidth
              />
            ))}
          </View>
        ) : null}
      </View>

      <View style={[styles.thread, { borderTopColor: c.border }]}>
        <Text variant="headline">Komentarze{messages.data?.length ? ` (${messages.data.length})` : ''}</Text>
        {messages.isPending ? (
          <RowSkeleton count={2} />
        ) : thread.length === 0 ? (
          <Text color="secondary">Brak komentarzy. Napisz pierwszy — np. jaką markę kupić albo że już jest w drodze.</Text>
        ) : (
          thread.map((t) =>
            t.kind === 'msg' ? (
              <View key={t.key} style={styles.msg}>
                <Avatar name={t.m.author_deleted ? 'Usunięty użytkownik' : t.m.author_name} size={30} />
                <View style={{ flex: 1 }}>
                  <Text>
                    <Text bold>{t.m.author_deleted ? 'Usunięty użytkownik' : t.m.author_name}</Text>
                    {'  '}
                    {t.m.body}
                  </Text>
                  <Text variant="footnote" color="tertiary">
                    {timeAgo(t.m.created_at)}
                  </Text>
                </View>
              </View>
            ) : (
              <View key={t.key} style={styles.evt}>
                <Icon name="swap-horizontal" size={14} color={c.textTertiary} />
                <Text variant="footnote" color="secondary" style={{ flex: 1 }}>
                  {t.e.actor_name ?? 'System'} zmienił status na „{STATUS_LABEL[t.e.to_status]}” · {timeAgo(t.e.created_at)}
                </Text>
              </View>
            )
          )
        )}
      </View>

      <Sheet visible={orderOpen} onClose={() => setOrderOpen(false)} title="U kogo zamówiono?">
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Chips
            options={[{ value: 'none', label: 'Nie wybieram' }, ...(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
            value={supplierId}
            onChange={setSupplierId}
          />
          <View style={{ paddingHorizontal: 16 }}>
            <Button
              title="Oznacz jako zamówione"
              loading={setStatus.isPending}
              fullWidth
              onPress={async () => {
                setOrderOpen(false);
                await run('ordered', 'Oznacz jako zamówione', false, supplierId === 'none' ? null : supplierId);
              }}
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  );

  async function submit() {
    const body = draft.trim();
    if (!body || !r) return;
    setDraft('');
    try {
      await send.mutateAsync({ requestId: r.id, body });
    } catch (e) {
      setDraft(body);
      fail(e);
    }
  }
}

function Info({ icon, text }: { icon: 'layers-outline' | 'briefcase-outline' | 'storefront-outline' | 'document-text-outline'; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <Icon name={icon} size={18} color={c.textSecondary} />
      <Text variant="callout" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 1, overflow: 'hidden' },
  block: { padding: spacing.l, gap: spacing.m },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voteBtn: { padding: 4 },
  rejected: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12 },
  steps: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  thread: { borderTopWidth: StyleSheet.hairlineWidth, padding: spacing.l, gap: spacing.m },
  msg: { flexDirection: 'row', gap: 10 },
  evt: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingLeft: 4 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
