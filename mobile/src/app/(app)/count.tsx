// Mini-spis: zamiast całodniowej inwentaryzacji — 5 produktów dziennie, 1–2 minuty.
// Liczymy „w ciemno" (bez podpowiadania stanu z systemu), a różnicę zapisujemy jako korektę.

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CountPrompt } from '@/components/CountPrompt';
import { Button, EmptyState, ErrorState, PhotoPlaceholder, RowSkeleton, Screen, SignedImage, Text, useDialogs } from '@/components/ui';
import { useCountCandidates, useDashboard, useRecordCount } from '@/lib/api/misc';
import { formatQty } from '@/lib/format';
import { useColors } from '@/theme';

type Result = { name: string; unit: string; diff: number };

export default function CountSession() {
  const c = useColors();
  const router = useRouter();
  const { fail } = useDialogs();
  const dashboard = useDashboard();
  const batch = dashboard.data?.count_batch_size ?? 5;
  const candidates = useCountCandidates(batch);
  const record = useRecordCount();

  // zamrażamy listę na czas sesji — odświeżenie po każdym zapisie nie może jej tasować
  const [frozen, setFrozen] = useState<NonNullable<typeof candidates.data> | null>(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<Result[]>([]);

  const list = frozen ?? candidates.data ?? [];
  const started = frozen !== null;
  const done = started && i >= list.length;

  const corrections = useMemo(() => results.filter((r) => r.diff !== 0), [results]);

  if (candidates.isPending && !started) {
    return (
      <Screen title="Mini-spis">
        <RowSkeleton count={3} />
      </Screen>
    );
  }
  if (candidates.isError && !started) {
    return (
      <Screen title="Mini-spis">
        <ErrorState error={candidates.error} onRetry={() => void candidates.refetch()} />
      </Screen>
    );
  }
  if (list.length === 0) {
    return (
      <Screen title="Mini-spis">
        <EmptyState icon="checkmark-done-outline" title="Wszystko policzone" message="Żaden produkt nie wymaga teraz liczenia. Wróć jutro — przypomnimy." actionLabel="Wróć" onAction={() => router.back()} />
      </Screen>
    );
  }

  if (!started) {
    return (
      <Screen title="Mini-spis" scroll footer={<Button title={`Zaczynamy (${list.length})`} onPress={() => setFrozen(list)} fullWidth />}>
        <View style={styles.intro}>
          <Text variant="title" align="center">
            {list.length} {list.length === 1 ? 'produkt' : 'produktów'} do policzenia
          </Text>
          <Text color="secondary" align="center">
            Pokażemy Ci po jednym produkcie. Policz, ile jest na półce, i wpisz wynik. Nie podpowiadamy stanu z systemu — dzięki temu spis jest rzetelny. To zajmie 1–2 minuty.
          </Text>
        </View>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen title="Gotowe" back={false} scroll footer={<Button title="Zamknij" onPress={() => router.replace('/home')} fullWidth />}>
        <EmptyState
          icon="checkmark-done-circle-outline"
          title="Mini-spis zakończony"
          message={corrections.length === 0 ? 'Wszystko się zgadzało — świetna robota!' : `Zapisaliśmy ${corrections.length} ${corrections.length === 1 ? 'korektę' : 'korekt'} stanu:`}
        />
        {corrections.map((r) => (
          <View key={r.name} style={styles.resRow}>
            <Text style={{ flex: 1 }} numberOfLines={1}>
              {r.name}
            </Text>
            <Text bold style={{ color: r.diff > 0 ? c.success : c.danger }}>
              {r.diff > 0 ? '+' : ''}
              {formatQty(r.diff)} {r.unit}
            </Text>
          </View>
        ))}
      </Screen>
    );
  }

  const cur = list[i];
  return (
    <Screen title={`Produkt ${i + 1} z ${list.length}`} scroll>
      <View style={[styles.photo, { backgroundColor: c.fill }]}>
        <SignedImage path={cur.photo_path} style={StyleSheet.absoluteFill} fallback={<PhotoPlaceholder name={cur.name} />} label={cur.name} />
      </View>
      <CountPrompt
        key={cur.product_id}
        name={cur.name}
        unit={cur.unit}
        expected={cur.expected_qty}
        blind
        busy={record.isPending}
        onSkip={() => setI(i + 1)}
        onSubmit={async (counted) => {
          try {
            const res = await record.mutateAsync({ productId: cur.product_id, counted, source: 'scheduled' });
            setResults((r) => [...r, { name: cur.name, unit: cur.unit, diff: Number(res.diff) }]);
            setI(i + 1);
          } catch (e) {
            fail(e);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 12, paddingVertical: 24 },
  photo: { width: '100%', aspectRatio: 1.5, borderRadius: 16, overflow: 'hidden' },
  resRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
});
