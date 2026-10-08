// Przeglądarka „stories": zadania na dziś, jedno po drugim, jak relacje w Instagramie.
// Dotknięcie prawej strony = dalej, lewej = wstecz. Bez automatycznego przewijania —
// to są decyzje do podjęcia, nie film.

import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestTitle } from '@/components/RequestCard';
import { Button, Icon, PhotoPlaceholder, Pill, SignedImage, Text, Touchable, useDialogs } from '@/components/ui';
import { useDocuments } from '@/lib/api/documents';
import { useDashboard } from '@/lib/api/misc';
import { useRequestFeed, useSetRequestStatus } from '@/lib/api/requests';
import { useAuth } from '@/lib/auth';
import { formatMoney, formatQty, timeAgo } from '@/lib/format';
import { STATUS_LABEL, STATUS_TONE, nextActions } from '@/lib/status';
import { useTenant } from '@/lib/tenant';
import type { DocumentRow, RequestFeedRow } from '@/lib/types';
import { useColors } from '@/theme';

type Id = 'low' | 'requests' | 'invoices' | 'count';

export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: Id }>();
  if (id === 'count') return <Redirect href="/count" />;
  if (id === 'requests') return <RequestsStory />;
  if (id === 'invoices') return <InvoicesStory />;
  return <LowStory />;
}

// ---------------------------------------------------------------------------------------------
// Rama: pasek postępu, nagłówek, strefy dotyku
// ---------------------------------------------------------------------------------------------
function Shell({ title, icon, slides, empty }: { title: string; icon: 'alert-circle-outline' | 'chatbubbles-outline' | 'document-text-outline'; slides: ReactNode[]; empty: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const total = Math.max(slides.length, 1);
  const safeIndex = Math.min(index, total - 1);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const next = () => (safeIndex >= total - 1 ? close() : setIndex(safeIndex + 1));
  const prev = () => setIndex(Math.max(0, safeIndex - 1));

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill}>
        <Touchable onPress={prev} accessibilityLabel="Poprzednia" pressedOpacity={1} style={[styles.zone, { left: 0, width: '28%' }]} />
        <Touchable onPress={next} accessibilityLabel="Następna" pressedOpacity={1} style={[styles.zone, { right: 0, width: '72%' }]} />
      </View>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.bars} pointerEvents="none">
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={[styles.bar, { backgroundColor: i <= safeIndex ? '#FFFFFF' : 'rgba(255,255,255,0.3)' }]} />
          ))}
        </View>
        <View style={styles.head}>
          <View style={styles.headIcon}>
            <Icon name={icon} size={18} color="#FFFFFF" />
          </View>
          <Text bold style={{ color: '#FFFFFF', flex: 1 }}>
            {title}
          </Text>
          <Text variant="footnote" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {slides.length ? `${safeIndex + 1} / ${total}` : ''}
          </Text>
          <Touchable onPress={close} accessibilityLabel="Zamknij" style={styles.close}>
            <Icon name="close" size={28} color="#FFFFFF" />
          </Touchable>
        </View>
      </View>

      <View style={[styles.content, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {slides.length === 0 ? (
          <View style={styles.doneBox} pointerEvents="box-none">
            <Icon name="checkmark-circle" size={72} color="#FFFFFF" />
            <Text variant="title" align="center" style={{ color: '#FFFFFF' }}>
              {empty}
            </Text>
            <Button title="Zamknij" variant="secondary" onPress={close} />
          </View>
        ) : (
          slides[safeIndex]
        )}
      </View>
    </View>
  );
}

function SlideCard({ photoPath, name, children }: { photoPath?: string | null; name: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.slide} pointerEvents="box-none">
      <View style={[styles.photo, { backgroundColor: c.fill }]}>
        <SignedImage path={photoPath} style={StyleSheet.absoluteFill} fallback={<PhotoPlaceholder name={name} />} label={name} />
      </View>
      <View style={[styles.panel, { backgroundColor: c.surface }]}>{children}</View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Braki: produkty poniżej minimum
// ---------------------------------------------------------------------------------------------
function LowStory() {
  const router = useRouter();
  const { data } = useDashboard();
  const items = data?.below_min_top ?? [];
  const slides = items.map((p) => (
    <SlideCard key={p.id} photoPath={p.photo_path} name={p.name}>
      <Text variant="title">{p.name}</Text>
      <Text color="danger" bold>
        Na stanie: {formatQty(p.stock)} {p.unit} · minimum: {formatQty(p.min_stock)} {p.unit}
      </Text>
      <Button title="Zgłoś brak" icon="alert-circle-outline" fullWidth onPress={() => router.push(`/request/new?productId=${p.id}`)} />
      <Button title="Otwórz produkt" variant="secondary" fullWidth onPress={() => router.push(`/product/${p.id}`)} />
    </SlideCard>
  ));
  return <Shell title="Braki" icon="alert-circle-outline" slides={slides} empty="Wszystko na stanie. Brak braków!" />;
}

// ---------------------------------------------------------------------------------------------
// Zgłoszenia czekające na decyzję
// ---------------------------------------------------------------------------------------------
function RequestsStory() {
  const router = useRouter();
  const { user } = useAuth();
  const { isManager } = useTenant();
  const { confirm, fail, toast } = useDialogs();
  const feed = useRequestFeed('open');
  const setStatus = useSetRequestStatus();

  const waiting = useMemo(
    () =>
      (feed.data?.pages.flat() ?? []).filter((r: RequestFeedRow) => {
        const acts = nextActions(r.status, { isManager, isReporter: r.reporter_id === user?.id });
        return (r.status === 'reported' && isManager) || (r.status === 'delivered' && acts.length > 0);
      }),
    [feed.data, isManager, user?.id]
  );

  const slides = waiting.map((r) => {
    const acts = nextActions(r.status, { isManager, isReporter: r.reporter_id === user?.id });
    const primary = acts.find((a) => a.kind === 'primary');
    const danger = acts.find((a) => a.kind === 'danger');
    const title = requestTitle(r);
    const run = async (to: typeof r.status, label: string, destructive: boolean) => {
      if (destructive && !(await confirm({ title: `${label}?`, confirmLabel: label, destructive: true }))) return;
      try {
        await setStatus.mutateAsync({ id: r.id, to });
        toast(`Status: ${STATUS_LABEL[to]}`, 'success');
      } catch (e) {
        fail(e);
      }
    };
    return (
      <SlideCard key={r.id} photoPath={r.photo_path ?? r.product_photo_path} name={title}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="title" style={{ flex: 1 }} numberOfLines={2}>
            {title}
          </Text>
          <Pill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
        </View>
        <Text color="secondary">
          {r.reporter_name} · {timeAgo(r.created_at)}
          {r.qty !== null ? ` · ${formatQty(r.qty)}${r.product_unit ? ` ${r.product_unit}` : ''}` : ''}
        </Text>
        {r.note ? <Text numberOfLines={3}>{r.note}</Text> : null}
        {primary ? <Button title={primary.label} fullWidth loading={setStatus.isPending} onPress={() => void run(primary.to, primary.label, false)} /> : null}
        {danger && isManager ? <Button title={danger.label} variant="outline" fullWidth onPress={() => void run(danger.to, danger.label, true)} /> : null}
        <Button title="Otwórz i skomentuj" variant="secondary" fullWidth onPress={() => router.push(`/request/${r.id}`)} />
      </SlideCard>
    );
  });
  return <Shell title="Zgłoszenia do decyzji" icon="chatbubbles-outline" slides={slides} empty="Nic nie czeka na Twoją decyzję." />;
}

// ---------------------------------------------------------------------------------------------
// Faktury do sprawdzenia
// ---------------------------------------------------------------------------------------------
function InvoicesStory() {
  const router = useRouter();
  const docs = useDocuments();
  const todo = (docs.data ?? []).filter((d: DocumentRow) => d.status === 'draft' || d.status === 'verified' || d.status === 'failed');
  const slides = todo.map((d) => (
    <SlideCard key={d.id} photoPath={d.file_paths[0]?.endsWith('.pdf') ? null : d.file_paths[0]} name={d.supplier_name ?? 'Faktura'}>
      <Text variant="title" numberOfLines={2}>
        {d.supplier_name ?? 'Nieznany dostawca'}
      </Text>
      <Text color="secondary">
        {d.invoice_number ?? 'bez numeru'} · {d.line_count} poz. · {formatMoney(d.total_gross ?? d.total_net, d.currency)}
      </Text>
      {d.status === 'failed' ? (
        <Text color="danger">AI nie odczytało dokumentu. Spróbuj ponownie lub wprowadź pozycje ręcznie.</Text>
      ) : d.unmatched_count > 0 ? (
        <Text color="warning" bold>
          Pozycje bez produktu: {d.unmatched_count}
        </Text>
      ) : (
        <Text color="success" bold>
          Wszystkie pozycje dopasowane
        </Text>
      )}
      <Button title="Sprawdź fakturę" icon="document-text-outline" fullWidth onPress={() => router.push(`/documents/${d.id}`)} />
    </SlideCard>
  ));
  return <Shell title="Faktury do sprawdzenia" icon="document-text-outline" slides={slides} empty="Wszystkie faktury sprawdzone." />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0B' },
  zone: { position: 'absolute', top: 0, bottom: 0 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 10 },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 3, borderRadius: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, paddingTop: 96, paddingHorizontal: 12, justifyContent: 'flex-end' },
  slide: { flex: 1, gap: 12, justifyContent: 'flex-end' },
  photo: { flex: 1, borderRadius: 20, overflow: 'hidden', minHeight: 160 },
  panel: { borderRadius: 20, padding: 16, gap: 10 },
  doneBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
});
