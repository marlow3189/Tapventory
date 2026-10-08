// „Magazyn": siatka produktów (jak Eksploruj w Instagramie) z wyszukiwarką i skanerem kodów.

import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProductTile } from '@/components/ProductTile';
import { Chips, EmptyState, ErrorState, HeaderButton, Icon, OfflineBanner, Skeleton, Text, Touchable } from '@/components/ui';
import { useProducts } from '@/lib/api/products';
import { matchesQuery } from '@/lib/search';
import { useTenant } from '@/lib/tenant';
import { layout, noOutline, radius, spacing, useColors } from '@/theme';

type Filter = 'all' | 'low';
const GAP = 2;
const COLUMNS = 3;

export default function Explore() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isManager } = useTenant();
  const products = useProducts();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const size = (Math.min(width, layout.maxContent) - GAP * (COLUMNS - 1)) / COLUMNS;
  const all = useMemo(() => products.data ?? [], [products.data]);
  const lowCount = useMemo(() => all.filter((p) => p.active && p.below_min).length, [all]);
  const rows = useMemo(
    () =>
      all
        .filter((p) => p.active)
        .filter((p) => (filter === 'low' ? p.below_min : true))
        .filter((p) => matchesQuery(`${p.name} ${p.ean ?? ''} ${p.default_supplier_name ?? ''}`, query)),
    [all, filter, query]
  );

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={styles.top}>
        <View style={[styles.search, { backgroundColor: c.fill }]}>
          <Icon name="search" size={18} color={c.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Szukaj produktu lub kodu"
            placeholderTextColor={c.textSecondary}
            accessibilityLabel="Szukaj produktu"
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.input, { color: c.text }, noOutline]}
          />
          {query ? (
            <Touchable onPress={() => setQuery('')} accessibilityLabel="Wyczyść wyszukiwanie">
              <Icon name="close-circle" size={18} color={c.textSecondary} />
            </Touchable>
          ) : null}
        </View>
        <HeaderButton icon="barcode-outline" onPress={() => router.push('/scan?mode=find')} label="Skanuj kod kreskowy" />
        {isManager ? <HeaderButton icon="add-circle-outline" onPress={() => router.push('/product/edit')} label="Dodaj produkt" /> : null}
      </View>
      <OfflineBanner />
      <Chips
        options={[
          { value: 'all', label: `Wszystkie${all.length ? ` (${all.filter((p) => p.active).length})` : ''}` },
          { value: 'low', label: `Braki${lowCount ? ` (${lowCount})` : ''}` },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {products.isPending ? (
        <View style={styles.skeletons}>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} width={size} height={size} round={0} />
          ))}
        </View>
      ) : products.isError ? (
        <ErrorState error={products.error} onRetry={() => void products.refetch()} />
      ) : (
        <FlatList
          key={`grid-${COLUMNS}`}
          data={rows}
          numColumns={COLUMNS}
          keyExtractor={(p) => p.id}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP }}
          renderItem={({ item }) => <ProductTile p={item} size={size} onPress={() => router.push(`/product/${item.id}`)} />}
          ListEmptyComponent={
            all.length === 0 ? (
              <EmptyState
                icon="cube-outline"
                title="Magazyn jest pusty"
                message={isManager ? 'Dodaj pierwszy produkt albo zeskanuj fakturę — AI wpisze pozycje za Ciebie.' : 'Kierownik jeszcze nie dodał produktów.'}
                actionLabel={isManager ? 'Dodaj produkt' : undefined}
                onAction={isManager ? () => router.push('/product/edit') : undefined}
              />
            ) : (
              <EmptyState icon="search-outline" title="Brak wyników" message="Spróbuj innego słowa lub zeskanuj kod kreskowy." />
            )
          }
          ListFooterComponent={rows.length ? <Text variant="footnote" color="secondary" align="center" style={styles.foot}>{rows.length} produktów</Text> : null}
          refreshControl={<RefreshControl refreshing={products.isRefetching} onRefresh={() => void products.refetch()} tintColor={c.textSecondary} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.l, paddingRight: spacing.s, paddingVertical: spacing.s, gap: 4 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, borderRadius: radius.m },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
  skeletons: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  foot: { paddingVertical: spacing.l },
});
