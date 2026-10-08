// Szczegóły produktu — układ jak post w Instagramie: duże zdjęcie, stan, akcje, historia „komentarzy".

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ManualMovementSheet } from '@/components/ManualMovementSheet';
import { TakeSheet } from '@/components/TakeSheet';
import {
  Avatar, Button, ErrorState, HeaderButton, Icon, PhotoPlaceholder, Pill, RowSkeleton, Screen, SignedImage, Text,
} from '@/components/ui';
import { useProduct, useProductMovements } from '@/lib/api/products';
import { formatQty, timeAgo } from '@/lib/format';
import { isIncoming, movementTitle } from '@/lib/movements';
import { useTenant } from '@/lib/tenant';
import { spacing, useColors } from '@/theme';

export default function ProductDetail() {
  const c = useColors();
  const router = useRouter();
  const { id, take } = useLocalSearchParams<{ id: string; take?: string }>();
  const { isManager } = useTenant();
  const product = useProduct(id);
  const movements = useProductMovements(id);
  const [takeOpen, setTakeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  // wejście ze skanera („Zdejmij") od razu otwiera arkusz
  useEffect(() => {
    if (take === '1' && product.data) setTakeOpen(true);
  }, [take, product.data]);

  const p = product.data;
  if (product.isError && !p) {
    return (
      <Screen title="Produkt">
        <ErrorState error={product.error} onRetry={() => void product.refetch()} />
      </Screen>
    );
  }
  if (!p) {
    return (
      <Screen title="Produkt">
        <RowSkeleton />
      </Screen>
    );
  }

  return (
    <Screen
      title={p.name}
      scroll
      padded={false}
      onRefresh={() => {
        void product.refetch();
        void movements.refetch();
      }}
      refreshing={product.isRefetching}
      headerRight={isManager ? <HeaderButton icon="create-outline" label="Edytuj produkt" onPress={() => router.push(`/product/edit?id=${p.id}`)} /> : undefined}
      contentStyle={{ gap: 0 }}
    >
      <View style={[styles.photo, { backgroundColor: c.fill }]}>
        <SignedImage path={p.photo_path} style={StyleSheet.absoluteFill} fallback={<PhotoPlaceholder name={p.name} />} label={p.name} />
      </View>

      <View style={styles.block}>
        <View style={styles.stockRow}>
          <View style={{ flex: 1 }}>
            <Text variant="largeTitle" style={p.below_min ? { color: c.danger } : undefined}>
              {formatQty(p.stock)} <Text variant="headline" color="secondary">{p.unit}</Text>
            </Text>
            <Text variant="callout" color="secondary">
              minimum: {formatQty(p.min_stock)} {p.unit}
            </Text>
          </View>
          {p.below_min ? <Pill label="Poniżej minimum" tone="danger" /> : <Pill label="Stan w normie" tone="success" />}
        </View>

        <View style={styles.actions}>
          <Button title="Zdejmij" icon="remove-circle-outline" onPress={() => setTakeOpen(true)} fullWidth />
          <View style={styles.row2}>
            <Button
              title="Zgłoś brak"
              icon="alert-circle-outline"
              variant="secondary"
              onPress={() => router.push(`/request/new?productId=${p.id}`)}
              style={{ flex: 1 }}
            />
            {isManager ? <Button title="Zmień stan" icon="swap-vertical-outline" variant="secondary" onPress={() => setMoveOpen(true)} style={{ flex: 1 }} /> : null}
          </View>
        </View>

        <View style={styles.facts}>
          <Fact icon="barcode-outline" label="Kod kreskowy" value={p.ean ?? 'brak'} />
          <Fact icon="storefront-outline" label="Dostawca" value={p.default_supplier_name ?? 'nie przypisano'} />
          {Number(p.pack_size) > 1 ? <Fact icon="cube-outline" label="W opakowaniu" value={`${formatQty(p.pack_size)} ${p.unit}`} /> : null}
          {p.last_movement_at ? <Fact icon="time-outline" label="Ostatni ruch" value={timeAgo(p.last_movement_at)} /> : null}
        </View>
      </View>

      <View style={[styles.history, { borderTopColor: c.border }]}>
        <Text variant="headline" style={{ paddingHorizontal: spacing.l, paddingTop: spacing.m }}>
          Historia
        </Text>
        {movements.isPending ? (
          <RowSkeleton count={3} />
        ) : movements.data && movements.data.length > 0 ? (
          movements.data.map((m) => (
            <View key={m.id} style={styles.move}>
              <Avatar name={m.author_deleted ? 'Usunięty użytkownik' : m.author_name} size={32} />
              <View style={{ flex: 1 }}>
                <Text variant="body">
                  <Text bold>{m.author_deleted ? 'Usunięty użytkownik' : m.author_name}</Text> · {movementTitle(m)}
                </Text>
                {m.note ? (
                  <Text variant="footnote" color="secondary">
                    {m.note}
                  </Text>
                ) : null}
                <Text variant="footnote" color="tertiary">
                  {timeAgo(m.created_at)}
                </Text>
              </View>
              <Text variant="headline" style={{ color: isIncoming(m) ? c.success : c.text }}>
                {isIncoming(m) ? '+' : '−'}
                {formatQty(Math.abs(Number(m.qty)))}
              </Text>
            </View>
          ))
        ) : (
          <View style={{ padding: spacing.l, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Icon name="time-outline" size={18} color={c.textTertiary} />
            <Text color="secondary">Brak ruchów — historia pojawi się po pierwszym „Zdejmij" lub przyjęciu.</Text>
          </View>
        )}
      </View>

      <TakeSheet product={p} visible={takeOpen} onClose={() => setTakeOpen(false)} />
      {isManager ? <ManualMovementSheet product={p} visible={moveOpen} onClose={() => setMoveOpen(false)} /> : null}
    </Screen>
  );
}

function Fact({ icon, label, value }: { icon: 'barcode-outline' | 'storefront-outline' | 'cube-outline' | 'time-outline'; label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={20} color={c.textSecondary} />
      <Text color="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text bold numberOfLines={1} style={{ maxWidth: '55%' }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 1, overflow: 'hidden' },
  block: { padding: spacing.l, gap: spacing.l },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  actions: { gap: spacing.s },
  row2: { flexDirection: 'row', gap: spacing.s },
  facts: { gap: 12 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  history: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.s },
  move: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.l, paddingVertical: 10 },
});
