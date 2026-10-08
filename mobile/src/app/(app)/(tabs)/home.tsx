// Ekran główny: „stories" (zadania na dziś) + feed zgłoszeń w stylu Instagrama.

import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RequestCard } from '@/components/RequestCard';
import { StoriesRow } from '@/components/StoriesRow';
import { Chips, EmptyState, ErrorState, FeedCardSkeleton, HeaderButton, OfflineBanner, Text, Touchable, Icon } from '@/components/ui';
import { useDashboard } from '@/lib/api/misc';
import { useRequestFeed, useToggleVote, type FeedFilter } from '@/lib/api/requests';
import { useAuth } from '@/lib/auth';
import { plural } from '@/lib/format';
import { useTenant } from '@/lib/tenant';
import { radius, spacing, useColors } from '@/theme';

const FILTERS: { value: FeedFilter; label: string }[] = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'open', label: 'Otwarte' },
  { value: 'mine', label: 'Moje' },
];

export default function Home() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { tenantName, isManager } = useTenant();
  const dashboard = useDashboard();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const feed = useRequestFeed(filter);
  const vote = useToggleVote();

  const rows = useMemo(() => feed.data?.pages.flat() ?? [], [feed.data]);
  const trial = dashboard.data?.trial_days_left;

  const header = (
    <View>
      <StoriesRow />
      {trial ? (
        <Touchable onPress={() => router.push('/settings')} accessibilityLabel="Plan i okres próbny" style={[styles.trial, { backgroundColor: c.fill }]}>
          <Icon name="sparkles-outline" size={18} />
          <Text variant="callout" style={{ flex: 1 }}>
            Okres próbny: pozostało {trial} {plural(trial, ['dzień', 'dni', 'dni'])} pełnej wersji
          </Text>
          <Icon name="chevron-forward" size={16} color={c.textTertiary} />
        </Touchable>
      ) : null}
      <View style={[styles.divider, { borderBottomColor: c.borderLight }]} />
      <Chips options={FILTERS} value={filter} onChange={setFilter} />
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text variant="title" style={styles.brand} numberOfLines={1} accessibilityRole="header">
            Tapventory
          </Text>
          <Text variant="footnote" color="secondary" numberOfLines={1}>
            {tenantName}
          </Text>
        </View>
        <HeaderButton icon="sparkles-outline" onPress={() => router.push('/assistant')} label="Asystent AI" />
        {isManager ? <HeaderButton icon="document-text-outline" onPress={() => router.push('/documents')} label="Faktury" /> : null}
      </View>
      <OfflineBanner />

      {feed.isPending ? (
        <View>
          {header}
          <FeedCardSkeleton />
        </View>
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          renderItem={({ item }) => (
            <RequestCard
              r={item}
              mine={item.reporter_id === user?.id}
              onOpen={() => router.push(`/request/${item.id}`)}
              onVote={() => vote.mutate({ requestId: item.id, voted: item.voted_by_me })}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubbles-outline"
              title={filter === 'mine' ? 'Nie zgłosiłeś jeszcze niczego' : 'Cisza w magazynie'}
              message="Gdy w firmie czegoś zabraknie, zgłoszenie pojawi się tutaj jak post — ze zdjęciem i komentarzami."
              actionLabel="Zgłoś brak"
              onAction={() => router.push('/request/new')}
            />
          }
          ListFooterComponent={feed.isFetchingNextPage ? <FeedCardSkeleton /> : <View style={{ height: spacing.l }} />}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching && !feed.isFetchingNextPage}
              onRefresh={() => {
                void feed.refetch();
                void dashboard.refetch();
              }}
              tintColor={c.textSecondary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.l, paddingVertical: spacing.s, gap: 2 },
  brand: { fontWeight: '800', letterSpacing: -0.5 },
  trial: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: spacing.l, padding: 12, borderRadius: radius.m },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, marginTop: spacing.s },
});
