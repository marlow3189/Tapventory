// Ekran faktury: od „AI czyta…" przez weryfikację („żółte pola") po księgowanie i storno.
// Zasada z dokumentu koncepcyjnego: LLM odczytuje, KOD sprawdza (NIP, sumy), CZŁOWIEK zatwierdza.

import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LineEditorSheet, type LinePatch } from '@/components/documents/LineEditorSheet';
import { ProductPickerSheet } from '@/components/documents/ProductPickerSheet';
import {
  Button, ErrorState, HeaderButton, Icon, Pill, RowSkeleton, Screen, Section, SignedImage, Text, TextField, Touchable, useDialogs,
} from '@/components/ui';
import {
  useAddLine, useDeleteDocument, useDeleteLine, useDocument, useDocumentLines, usePostDocument, useRematchLines, useRetryDocument,
  useUnpostDocument, useUpdateDocument, useUpdateLine,
} from '@/lib/api/documents';
import { saveProduct, useProducts } from '@/lib/api/products';
import { parseDateInput, todayIso } from '@/lib/dates';
import { useNow } from '@/lib/use-now';
import { DOC_STATUS } from '@/lib/doc-status';
import { lineNet, sumNet, validateDocument, type Warning } from '@/lib/document-math';
import { formatDate, formatMoney, formatQty, plural, timeAgo } from '@/lib/format';
import { normalizeNip } from '@/lib/nip';
import { parseMoney } from '@/lib/qty';
import { useSignedUrl } from '@/lib/storage';
import { useTenant } from '@/lib/tenant';
import type { DocumentLineRow, DocumentRow } from '@/lib/types';
import { radius, spacing, useColors } from '@/theme';

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isManager, loading } = useTenant();
  const doc = useDocument(id);
  const lines = useDocumentLines(id);

  if (!loading && !isManager) return <Redirect href="/home" />;
  if (doc.isError && !doc.data) {
    return (
      <Screen title="Faktura">
        <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
      </Screen>
    );
  }
  if (!doc.data) {
    return (
      <Screen title="Faktura">
        <RowSkeleton />
      </Screen>
    );
  }
  const d = doc.data;
  if (d.status === 'processing') return <Processing doc={d} />;
  if (d.status === 'failed') return <Failed doc={d} />;
  return <Editor key={d.id} doc={d} lines={lines.data ?? []} linesLoading={lines.isPending} />;
}

// ---------------------------------------------------------------------------------------------
// AI czyta dokument
// ---------------------------------------------------------------------------------------------
function Processing({ doc }: { doc: DocumentRow }) {
  const c = useColors();
  const router = useRouter();
  const { confirm, fail } = useDialogs();
  const del = useDeleteDocument();
  const now = useNow(15_000);
  const waitedMin = (now - new Date(doc.created_at).getTime()) / 60000;
  const tooLong = waitedMin > 3;

  return (
    <Screen title="Faktura" scroll>
      <View style={styles.centerBox}>
        <ActivityIndicator size="large" color={c.primary} />
        <Text variant="title" align="center">
          AI czyta fakturę…
        </Text>
        <Text color="secondary" align="center">
          Zwykle trwa to od kilkunastu sekund do minuty. Możesz wyjść z tego ekranu — dostaniesz powiadomienie, gdy będzie gotowe, a faktura pojawi się na liście.
        </Text>
        <Text variant="footnote" color="tertiary">
          Wysłano {timeAgo(doc.created_at)}
        </Text>
        {tooLong ? (
          <View style={{ gap: 8, alignItems: 'center' }}>
            <Text color="warning" align="center" bold>
              To trwa dłużej niż zwykle.
            </Text>
            <Button
              title="Usuń i spróbuj jeszcze raz"
              variant="secondary"
              loading={del.isPending}
              onPress={async () => {
                if (!(await confirm({ title: 'Usunąć ten dokument?', message: 'Zdjęcia zostaną odłączone od faktury. Możesz zeskanować ją ponownie.', confirmLabel: 'Usuń', destructive: true }))) return;
                try {
                  await del.mutateAsync(doc.id);
                  router.replace('/documents');
                } catch (e) {
                  fail(e);
                }
              }}
            />
          </View>
        ) : null}
        <Button title="Wróć do listy" variant="ghost" onPress={() => router.replace('/documents')} />
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------
// Odczyt się nie udał
// ---------------------------------------------------------------------------------------------
function Failed({ doc }: { doc: DocumentRow }) {
  const c = useColors();
  const router = useRouter();
  const { confirm, fail, toast } = useDialogs();
  const retry = useRetryDocument();
  const update = useUpdateDocument();
  const del = useDeleteDocument();

  return (
    <Screen title="Faktura" scroll>
      <View style={styles.centerBox}>
        <Icon name="alert-circle-outline" size={64} color={c.danger} />
        <Text variant="title" align="center">
          Nie udało się odczytać
        </Text>
        <Text color="secondary" align="center">
          {doc.error_message ?? 'AI nie odczytało tego dokumentu.'}
        </Text>
        <Text variant="callout" color="secondary" align="center">
          Spróbuj ponownie (czasem to chwilowa usterka), zrób wyraźniejsze zdjęcie albo wpisz pozycje ręcznie.
        </Text>
        <Button
          title="Spróbuj ponownie"
          icon="refresh-outline"
          loading={retry.isPending}
          fullWidth
          onPress={async () => {
            try {
              await retry.mutateAsync(doc.id);
              toast('Wysłano ponownie do odczytu', 'success');
            } catch (e) {
              fail(e);
            }
          }}
        />
        <Button
          title="Wpiszę pozycje ręcznie"
          variant="secondary"
          fullWidth
          onPress={async () => {
            try {
              await update.mutateAsync({ id: doc.id, patch: { status: 'draft' } });
            } catch (e) {
              fail(e);
            }
          }}
        />
        <Button
          title="Usuń dokument"
          variant="ghost"
          loading={del.isPending}
          onPress={async () => {
            if (!(await confirm({ title: 'Usunąć dokument?', confirmLabel: 'Usuń', destructive: true }))) return;
            try {
              await del.mutateAsync(doc.id);
              router.replace('/documents');
            } catch (e) {
              fail(e);
            }
          }}
        />
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------
// Weryfikacja i księgowanie
// ---------------------------------------------------------------------------------------------
const toText = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
/** Kwota do pola tekstowego po polsku: 160.5 → "160,50". */
const moneyText = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));

function Editor({ doc, lines, linesLoading }: { doc: DocumentRow; lines: DocumentLineRow[]; linesLoading: boolean }) {
  const c = useColors();
  const router = useRouter();
  const { confirm, prompt, fail, toast } = useDialogs();
  const products = useProducts();
  const update = useUpdateDocument();
  const updateLine = useUpdateLine();
  const addLine = useAddLine();
  const delLine = useDeleteLine();
  const rematch = useRematchLines();
  const post = usePostDocument();
  const unpost = useUnpostDocument();
  const del = useDeleteDocument();

  const posted = doc.status === 'posted';

  const [supplier, setSupplier] = useState(doc.supplier_name ?? '');
  const [nip, setNip] = useState(doc.supplier_nip ?? '');
  const [number, setNumber] = useState(doc.invoice_number ?? '');
  const [date, setDate] = useState(doc.issue_date ? formatDate(doc.issue_date) : '');
  const [net, setNet] = useState(moneyText(doc.total_net));
  const [gross, setGross] = useState(moneyText(doc.total_gross));
  const [errors, setErrors] = useState<{ date?: string; nip?: string; net?: string; gross?: string }>({});

  const [editing, setEditing] = useState<DocumentLineRow | null>(null);
  const [picking, setPicking] = useState<DocumentLineRow | null>(null);
  const [viewer, setViewer] = useState(false);
  const [creating, setCreating] = useState(false);

  const productById = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);

  const isoDate = date.trim() ? parseDateInput(date) : null;
  const netN = parseMoney(net);
  const warnings: Warning[] = useMemo(
    () =>
      validateDocument(
        { supplier_nip: nip ? normalizeNip(nip) : null, invoice_number: number, issue_date: isoDate, total_net: netN },
        lines
      ),
    [nip, number, isoDate, netN, lines]
  );
  const blockers = warnings.filter((w) => w.severity === 'error');
  const sum = sumNet(lines.filter((l) => !l.skip));
  const active = lines.filter((l) => !l.skip).length;

  const dirty =
    supplier.trim() !== (doc.supplier_name ?? '') ||
    normalizeNip(nip) !== (doc.supplier_nip ?? '') ||
    number.trim() !== (doc.invoice_number ?? '') ||
    (isoDate ?? '') !== (doc.issue_date ?? '') ||
    toText(netN) !== toText(doc.total_net === null ? '' : Number(doc.total_net)) ||
    toText(parseMoney(gross)) !== toText(doc.total_gross === null ? '' : Number(doc.total_gross));

  async function saveHeader(): Promise<boolean> {
    const next: typeof errors = {};
    if (date.trim() && !isoDate) next.date = 'Wpisz datę jako 08.10.2026 lub 2026-10-08.';
    const digits = normalizeNip(nip);
    if (nip.trim() && digits.length !== 10) next.nip = 'NIP ma 10 cyfr.';
    if (net.trim() && parseMoney(net) === null) next.net = 'Podaj kwotę, np. 1230,50.';
    if (gross.trim() && parseMoney(gross) === null) next.gross = 'Podaj kwotę, np. 1513,52.';
    setErrors(next);
    if (Object.keys(next).length) return false;
    try {
      await update.mutateAsync({
        id: doc.id,
        patch: {
          supplier_name: supplier.trim() || null,
          supplier_nip: digits || null,
          invoice_number: number.trim() || null,
          issue_date: isoDate,
          total_net: net.trim() ? parseMoney(net) : null,
          total_gross: gross.trim() ? parseMoney(gross) : null,
        },
      });
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  async function doPost() {
    if (dirty && !(await saveHeader())) return;
    if (blockers.length > 0) return fail({ message: blockers[0].text });
    const ok = await confirm({
      title: 'Zaksięgować fakturę?',
      message: `Na magazyn trafi ${active} ${plural(active, ['pozycja', 'pozycje', 'pozycji'])}. Zaksięgowanej faktury nie edytuje się — w razie pomyłki użyj „Cofnij księgowanie” (storno).`,
      confirmLabel: 'Zaksięguj',
    });
    if (!ok) return;
    try {
      const n = await post.mutateAsync(doc.id);
      toast(`Przyjęto na magazyn: ${n} ${plural(n, ['pozycję', 'pozycje', 'pozycji'])}`, 'success');
    } catch (e) {
      fail(e);
    }
  }

  async function doUnpost() {
    const reason = await prompt({ title: 'Cofnąć księgowanie?', message: 'Zapiszemy ruchy odwrotne (storno), a faktura wróci do szkicu. Podaj powód — trafi do historii.', placeholder: 'np. błędny dostawca', confirmLabel: 'Cofnij' });
    if (!reason) return;
    try {
      await unpost.mutateAsync({ id: doc.id, reason });
      toast('Cofnięto księgowanie. Faktura jest znów szkicem.', 'success');
    } catch (e) {
      fail(e);
    }
  }

  async function createProductFor(line: DocumentLineRow) {
    setCreating(true);
    try {
      const id = await saveProduct(doc.tenant_id, {
        name: line.raw_name, ean: line.ean, unit: line.unit?.trim() || 'szt.', pack_size: 1, min_stock: 0, photo_path: null, default_supplier_id: doc.supplier_id,
      });
      await updateLine.mutateAsync({ id: line.id, patch: { product_id: id, match_confidence: 100 } });
      setPicking(null);
      toast('Utworzono produkt i przypisano do pozycji', 'success');
    } catch (e) {
      fail(e);
    } finally {
      setCreating(false);
    }
  }

  const st = DOC_STATUS[doc.status];

  return (
    <Screen
      title={doc.invoice_number ? `Faktura ${doc.invoice_number}` : 'Faktura'}
      scroll
      headerRight={
        <>
          <HeaderButton icon="image-outline" label="Pokaż zdjęcie faktury" onPress={() => setViewer(true)} />
          {!posted ? (
            <HeaderButton
              icon="trash-outline"
              label="Usuń dokument"
              onPress={async () => {
                if (!(await confirm({ title: 'Usunąć dokument?', message: 'Tej operacji nie można cofnąć.', confirmLabel: 'Usuń', destructive: true }))) return;
                try {
                  await del.mutateAsync(doc.id);
                  router.replace('/documents');
                } catch (e) {
                  fail(e);
                }
              }}
            />
          ) : null}
        </>
      }
      footer={
        posted ? (
          <Button title="Cofnij księgowanie (storno)" variant="outline" onPress={doUnpost} loading={unpost.isPending} fullWidth />
        ) : (
          <>
            {dirty ? <Button title="Zapisz zmiany w nagłówku" variant="secondary" onPress={() => void saveHeader()} loading={update.isPending} fullWidth /> : null}
            <Button
              title={blockers.length ? `Do poprawy: ${blockers.length}` : `Zaksięguj (${active} poz.)`}
              icon="checkmark-done-outline"
              onPress={doPost}
              loading={post.isPending}
              disabled={blockers.length > 0 && !dirty}
              fullWidth
            />
          </>
        )
      }
    >
      <View style={styles.statusRow}>
        <Pill label={st.label} tone={st.tone} />
        {doc.ai_model ? (
          <Text variant="footnote" color="tertiary">
            Odczyt AI{doc.ai_confidence !== null ? ` · pewność ${doc.ai_confidence}%` : ''}
          </Text>
        ) : (
          <Text variant="footnote" color="tertiary">
            Wpisana ręcznie
          </Text>
        )}
        {posted && doc.posted_at ? (
          <Text variant="footnote" color="success">
            Zaksięgowana {timeAgo(doc.posted_at)}
          </Text>
        ) : null}
      </View>

      {!posted && (warnings.length > 0 || doc.ai_warnings.length > 0) ? (
        <View style={[styles.warnBox, { backgroundColor: c.fill }]}>
          {warnings.map((w) => (
            <View key={w.code} style={styles.warnRow}>
              <Icon name={w.severity === 'error' ? 'alert-circle' : 'warning-outline'} size={18} color={w.severity === 'error' ? c.danger : c.warning} />
              <Text variant="callout" style={{ flex: 1 }}>
                {w.text}
              </Text>
            </View>
          ))}
          {doc.ai_warnings.map((w, i) => (
            <View key={`ai-${i}`} style={styles.warnRow}>
              <Icon name="sparkles-outline" size={18} color={c.violet} />
              <Text variant="callout" style={{ flex: 1 }}>
                AI: {w.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Section title="Dane faktury">
        <View style={styles.fields}>
          <TextField label="Dostawca" value={supplier} onChangeText={setSupplier} editable={!posted} />
          <TextField label="NIP dostawcy" value={nip} onChangeText={setNip} error={errors.nip} editable={!posted} keyboardType="number-pad" placeholder="0000000000" />
          <TextField label="Numer faktury" value={number} onChangeText={setNumber} editable={!posted} autoCapitalize="characters" />
          <TextField
            label="Data wystawienia"
            value={date}
            onChangeText={setDate}
            error={errors.date}
            editable={!posted}
            placeholder="DD.MM.RRRR"
            keyboardType="numbers-and-punctuation"
            right={!posted ? <Touchable onPress={() => setDate(formatDate(todayIso()))} accessibilityLabel="Wstaw dzisiejszą datę"><Text color="accent" bold>Dziś</Text></Touchable> : undefined}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <TextField label="Suma netto" value={net} onChangeText={setNet} error={errors.net} editable={!posted} keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="Suma brutto" value={gross} onChangeText={setGross} error={errors.gross} editable={!posted} keyboardType="decimal-pad" />
            </View>
          </View>
        </View>
      </Section>

      <View style={{ gap: 8 }}>
        <View style={styles.linesHead}>
          <Text variant="headline" style={{ flex: 1 }}>
            Pozycje ({lines.length})
          </Text>
          <Text variant="footnote" color="secondary">
            Suma netto: {formatMoney(sum, doc.currency)}
          </Text>
        </View>

        {linesLoading ? (
          <RowSkeleton count={3} />
        ) : lines.length === 0 ? (
          <Text color="secondary">Brak pozycji. Dodaj je ręcznie.</Text>
        ) : (
          lines.map((l) => {
            const product = l.product_id ? productById.get(l.product_id) : undefined;
            const net = lineNet(l);
            const weak = !l.skip && ((l.ai_confidence ?? 100) < 60 || (l.match_confidence !== null && l.match_confidence < 70 && !!l.product_id));
            return (
              <Touchable
                key={l.id}
                onPress={() => setEditing(l)}
                accessibilityLabel={`Pozycja ${l.line_no}: ${l.raw_name}`}
                style={[styles.line, { borderColor: !l.product_id && !l.skip ? c.danger : weak ? c.warning : c.border, backgroundColor: c.bgSecondary, opacity: l.skip ? 0.55 : 1 }]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text bold numberOfLines={2}>
                    {l.raw_name}
                  </Text>
                  <Text variant="callout" color="secondary">
                    {formatQty(l.qty)} {l.unit ?? ''}
                    {l.unit_price_net !== null ? ` × ${formatMoney(l.unit_price_net, doc.currency)}` : ''}
                    {net !== null ? ` = ${formatMoney(net, doc.currency)}` : ''}
                  </Text>
                  {l.skip ? (
                    <Text variant="footnote" color="tertiary">
                      Pomijana (bez wpływu na magazyn)
                    </Text>
                  ) : product ? (
                    <View style={styles.match}>
                      <Icon name="cube-outline" size={14} color={weak ? c.warning : c.success} />
                      <Text variant="footnote" style={{ color: weak ? c.warning : c.success }} numberOfLines={1}>
                        {product.name}
                        {l.match_confidence ? ` · ${l.match_confidence}%` : ''}
                      </Text>
                    </View>
                  ) : (
                    <Touchable onPress={() => setPicking(l)} accessibilityLabel="Przypisz produkt" style={styles.match}>
                      <Icon name="alert-circle" size={14} color={c.danger} />
                      <Text variant="footnote" color="danger" bold>
                        Przypisz produkt
                      </Text>
                    </Touchable>
                  )}
                </View>
                <Icon name="chevron-forward" size={18} color={c.textTertiary} />
              </Touchable>
            );
          })
        )}

        {!posted ? (
          <View style={{ gap: 8 }}>
            <Button
              title="Dodaj pozycję"
              icon="add-circle-outline"
              variant="secondary"
              loading={addLine.isPending}
              onPress={async () => {
                try {
                  await addLine.mutateAsync({ documentId: doc.id, lineNo: (lines[lines.length - 1]?.line_no ?? 0) + 1 });
                } catch (e) {
                  fail(e);
                }
              }}
              fullWidth
            />
            {lines.some((l) => !l.product_id && !l.skip) ? (
              <Button
                title="Dopasuj pozycje automatycznie"
                icon="sparkles-outline"
                variant="secondary"
                loading={rematch.isPending}
                onPress={async () => {
                  try {
                    const n = await rematch.mutateAsync({ supplierNip: doc.supplier_nip, lines });
                    toast(n > 0 ? `Dopasowano ${n} ${plural(n, ['pozycję', 'pozycje', 'pozycji'])}` : 'Nie znaleziono pewnych dopasowań — przypisz ręcznie', n > 0 ? 'success' : 'info');
                  } catch (e) {
                    fail(e);
                  }
                }}
                fullWidth
              />
            ) : null}
          </View>
        ) : null}
      </View>

      {editing ? (
        <LineEditorSheet
          key={editing.id}
          line={editing}
          product={editing.product_id ? productById.get(editing.product_id) ?? null : null}
          visible
          readOnly={posted}
          onClose={() => setEditing(null)}
          onPickProduct={() => {
            setPicking(editing);
          }}
          onSave={async (patch: LinePatch) => {
            try {
              await updateLine.mutateAsync({ id: editing.id, patch });
              setEditing(null);
            } catch (e) {
              fail(e);
            }
          }}
          onDelete={async () => {
            if (!(await confirm({ title: 'Usunąć pozycję?', confirmLabel: 'Usuń', destructive: true }))) return;
            try {
              await delLine.mutateAsync(editing.id);
              setEditing(null);
            } catch (e) {
              fail(e);
            }
          }}
        />
      ) : null}

      <ProductPickerSheet
        visible={Boolean(picking)}
        onClose={() => setPicking(null)}
        suggestion={picking?.raw_name}
        selectedId={picking?.product_id}
        creating={creating}
        onCreate={picking ? () => void createProductFor(picking) : undefined}
        onPick={async (productId) => {
          if (!picking) return;
          try {
            await updateLine.mutateAsync({ id: picking.id, patch: { product_id: productId, match_confidence: 100, skip: false } });
            setPicking(null);
            setEditing(null);
          } catch (e) {
            fail(e);
          }
        }}
      />

      <PagesViewer doc={doc} visible={viewer} onClose={() => setViewer(false)} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------
// Podgląd zdjęć / PDF faktury (żeby porównać odczyt z oryginałem)
// ---------------------------------------------------------------------------------------------
function PagesViewer({ doc, visible, onClose }: { doc: DocumentRow; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width, 640);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.viewer, { paddingTop: insets.top }]}>
        <View style={styles.viewerBar}>
          <Text bold style={{ color: '#FFFFFF', flex: 1 }}>
            {doc.page_count && doc.page_count > 1 ? `Dokument (${doc.page_count} stron)` : 'Dokument'}
          </Text>
          <Touchable onPress={onClose} accessibilityLabel="Zamknij podgląd" style={{ padding: 8 }}>
            <Icon name="close" size={28} color="#FFFFFF" />
          </Touchable>
        </View>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'stretch' }}>
          {doc.file_paths.map((path, i) => (
            <View key={path} style={{ width: pageWidth, flex: 1, alignSelf: 'center', height: '100%', paddingBottom: insets.bottom }}>
              {path.toLowerCase().endsWith('.pdf') ? <PdfPage path={path} /> : <SignedImage bucket="documents" path={path} contentFit="contain" style={{ flex: 1 }} label={`Strona ${i + 1}`} />}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function PdfPage({ path }: { path: string }) {
  const url = useSignedUrl('documents', path);
  return (
    <View style={styles.pdfBox}>
      <Icon name="document-text" size={72} color="#FFFFFF" />
      <Text style={{ color: '#FFFFFF' }} align="center">
        Plik PDF otworzy się w przeglądarce lub czytniku.
      </Text>
      <Button title="Otwórz PDF" disabled={!url.data} onPress={() => url.data && void Linking.openURL(url.data)} />
    </View>
  );
}

const styles = StyleSheet.create({
  centerBox: { alignItems: 'center', gap: 14, paddingVertical: 32 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  warnBox: { padding: 12, borderRadius: radius.m, gap: 8 },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  fields: { padding: spacing.m, gap: 12 },
  linesHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.m, borderWidth: 1 },
  match: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewer: { flex: 1, backgroundColor: '#000000' },
  viewerBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 4 },
  pdfBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
});
