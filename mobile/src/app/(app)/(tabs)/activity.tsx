// Aktywność: powiadomienia (jak serduszko w Instagramie) — nowe zgłoszenia, zmiany statusów,
// gotowe faktury, braki i przypomnienia o mini-spisie.

import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, ErrorState, HeaderButton, Icon, OfflineBanner, RowSkeleton, Text, Touchable, useDialogs, type IconName } from '@/components/ui';
import { useMarkNotificationsRead, useNotifications } from '@/lib/api/misc';
import { timeAgo } from '@/lib/format';
import { notificationHref } from '@/lib/notification-target';
import { enablePush, getPushStatus, type PushStatus } from '@/lib/push';
import type { NotificationRow } from '@/lib/types';
import { spacing, useColors } from '@/theme';

const ICON: Record<NotificationRow['kind'], IconName> = {
  low_stock: 'alert-circle-outline',
  request_new: 'chatbubbles-outline',
  request_status: 'swap-horizontal-outline',
  document_ready: 'document-text-outline',
  count_due: 'checkmark-done-outline',
  system: 'information-circle-outline',
};

export default function Activity() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useDialogs();
  const list = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [push, setPush] = useState<PushStatus>('unsupported');

  useEffect(() => {
    void getPushStatus().then(setPush);
  }, []);

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const unreadIds = useMemo(() => rows.filter((n) => !n.read_at).map((n) => n.id), [rows]);

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={styles.top}>
        <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
          Aktywność
        </Text>
        {unreadIds.length > 0 ? <HeaderButton icon="checkmark-done" label="Oznacz wszystkie jako przeczytane" onPress={() => markRead.mutate(unreadIds)} /> : null}
      </View>
      <OfflineBanner />

      {push === 'undetermined' ? (
        <View style={[styles.banner, { backgroundColor: c.fill }]}>
          <Icon name="notifications-outline" size={22} />
          <Text variant="callout" style={{ flex: 1 }}>
            Włącz powiadomienia, by wiedzieć o brakach i zgłoszeniach, nawet gdy aplikacja jest zamknięta.
          </Text>
          <Button
            title="Włącz"
            size="s"
            onPress={async () => {
              const r = await enablePush();
              setPush(await getPushStatus());
              toast(r === 'enabled' ? 'Powiadomienia włączone' : 'Nie udało się włączyć powiadomień', r === 'enabled' ? 'success' : 'error');
            }}
          />
        </View>
      ) : null}

      {list.isPending ? (
        <RowSkeleton count={6} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => (
            <Touchable
              onPress={() => {
                if (!item.read_at) markRead.mutate([item.id]);
                router.push(notificationHref(item.kind, item.data) as Href);
              }}
              accessibilityLabel={item.title}
              style={[styles.row, !item.read_at ? { backgroundColor: c.bgSecondary } : null]}
            >
              <View style={[styles.icon, { backgroundColor: c.fill }]}>
                <Icon name={ICON[item.kind]} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text bold={!item.read_at}>{item.title}</Text>
                {item.body ? (
                  <Text variant="callout" color="secondary" numberOfLines={2}>
                    {item.body}
                  </Text>
                ) : null}
                <Text variant="footnote" color="tertiary">
                  {timeAgo(item.created_at)}
                </Text>
              </View>
              {!item.read_at ? <View style={[styles.dot, { backgroundColor: c.primary }]} /> : null}
            </Touchable>
          )}
          ListEmptyComponent={<EmptyState icon="heart-outline" title="Na razie spokojnie" message="Tu pojawią się powiadomienia: braki, nowe zgłoszenia, zmiany statusów i gotowe faktury." />}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={c.textSecondary} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.l, paddingVertical: spacing.s },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: spacing.l, padding: 12, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.l, paddingVertical: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
