// Skanowanie faktury: zdjęcia stron (do 10) albo PDF → wysyłka → AI czyta w tle.
// Użytkownik NIE czeka na model: od razu trafia na ekran dokumentu, który uzupełni się sam.

import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, useRouter } from 'expo-router';
import { AiConsentSheet } from '@/components/AiConsentSheet';
import { Button, Icon, Screen, Text, Touchable, useDialogs } from '@/components/ui';
import { submitDocument, type PageInput } from '@/lib/api/documents';
import { useAiQuota } from '@/lib/api/misc';
import { useAiConsent } from '@/lib/consent';
import { DOCUMENT_PAGE, pickFromLibrary, takePhoto } from '@/lib/images';
import { readUriAsBytes } from '@/lib/storage';
import { useTenant } from '@/lib/tenant';
import { radius, spacing, useColors } from '@/theme';

type Page = (PageInput & { id: number; label: string; preview?: string });

const MAX_PAGES = 10;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export default function ScanDocument() {
  const c = useColors();
  const router = useRouter();
  const { tenantId, isManager, loading } = useTenant();
  const { fail, alert } = useDialogs();
  const quota = useAiQuota();
  const consent = useAiConsent();

  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [seq, setSeq] = useState(1);

  if (!loading && !isManager) return <Redirect href="/home" />;

  const left = quota.data?.remaining;
  const limit = quota.data?.limit;
  const exhausted = limit !== null && limit !== undefined && left === 0;

  function add(p: PageInput & { label: string; preview?: string }) {
    setPages((cur) => {
      if (cur.length >= MAX_PAGES) return cur;
      return [...cur, { ...p, id: seq }];
    });
    setSeq((s) => s + 1);
  }

  async function capture() {
    if (pages.length >= MAX_PAGES) return fail({ message: `Dokument może mieć najwyżej ${MAX_PAGES} stron.` });
    const res = await takePhoto(DOCUMENT_PAGE);
    if (res.status === 'denied') return void alert('Brak dostępu do aparatu', 'Włącz aparat w ustawieniach telefonu lub przeglądarki.');
    if (res.status === 'ok') add({ kind: 'image', base64: res.images[0].base64, preview: res.images[0].uri, label: `Strona ${pages.length + 1}` });
  }

  async function fromLibrary() {
    const res = await pickFromLibrary({ ...DOCUMENT_PAGE, multiple: true });
    if (res.status === 'denied') return void alert('Brak dostępu do zdjęć', 'Włącz dostęp do zdjęć w ustawieniach.');
    if (res.status !== 'ok') return;
    const room = MAX_PAGES - pages.length;
    res.images.slice(0, room).forEach((im, i) => add({ kind: 'image', base64: im.base64, preview: im.uri, label: `Strona ${pages.length + i + 1}` }));
    if (res.images.length > room) fail({ message: `Dodano tylko ${room} stron — to limit jednego dokumentu.` });
  }

  async function pickPdf() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || res.assets.length === 0) return;
      const asset = res.assets[0];
      if ((asset.size ?? 0) > MAX_PDF_BYTES) return fail({ message: 'Plik PDF jest za duży (limit 10 MB).' });
      const bytes = await readUriAsBytes(asset.uri);
      if (bytes.byteLength > MAX_PDF_BYTES) return fail({ message: 'Plik PDF jest za duży (limit 10 MB).' });
      add({ kind: 'pdf', bytes, label: asset.name ?? 'dokument.pdf' });
    } catch (e) {
      fail(e);
    }
  }

  async function send() {
    if (consent.consented === false) return setConsentOpen(true);
    if (exhausted) return fail({ message: 'Wykorzystano miesięczny limit skanów AI w Twoim planie.' });
    setBusy(true);
    try {
      const id = await submitDocument(tenantId!, pages);
      router.replace(`/documents/${id}`);
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Skanuj fakturę"
      scroll
      footer={
        <>
          {limit !== null && limit !== undefined ? (
            <Text variant="footnote" color={exhausted ? 'danger' : 'secondary'} align="center">
              {exhausted ? 'Limit skanów AI w tym miesiącu wyczerpany.' : `Pozostało skanów AI w tym miesiącu: ${left} z ${limit}`}
            </Text>
          ) : null}
          <Button
            title={pages.length ? `Wyślij do odczytu (${pages.length})` : 'Dodaj stronę, aby kontynuować'}
            icon="sparkles-outline"
            onPress={send}
            loading={busy}
            disabled={pages.length === 0 || exhausted}
            fullWidth
          />
        </>
      }
    >
      <Text color="secondary">
        Zrób zdjęcie faktury (cała strona, równo, bez cieni) albo wybierz plik PDF. Wielostronicową fakturę dodaj stronami po kolei.
      </Text>

      <View style={styles.buttons}>
        <Button title="Zrób zdjęcie" icon="camera-outline" onPress={capture} style={{ flex: 1 }} />
        <Button title="Z galerii" icon="images-outline" variant="secondary" onPress={fromLibrary} style={{ flex: 1 }} />
      </View>
      <Button title="Wybierz PDF" icon="document-attach-outline" variant="secondary" onPress={pickPdf} disabled={pages.length >= MAX_PAGES} />

      {pages.length === 0 ? (
        <View style={[styles.empty, { borderColor: c.border, backgroundColor: c.bgSecondary }]}>
          <Icon name="document-text-outline" size={44} color={c.textTertiary} />
          <Text color="secondary" align="center">
            Tu pojawią się dodane strony.
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {pages.map((p, i) => (
            <View key={p.id} style={[styles.thumb, { backgroundColor: c.fill, borderColor: c.border }]}>
              {p.preview ? <Image source={{ uri: p.preview }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={`Strona ${i + 1}`} /> : (
                <View style={styles.pdf}>
                  <Icon name="document" size={32} color={c.danger} />
                  <Text variant="caption" numberOfLines={2} align="center">
                    {p.label}
                  </Text>
                </View>
              )}
              <View style={[styles.index, { backgroundColor: c.overlay }]}>
                <Text variant="caption" bold style={{ color: '#FFFFFF' }}>
                  {i + 1}
                </Text>
              </View>
              <Touchable onPress={() => setPages((cur) => cur.filter((x) => x.id !== p.id))} accessibilityLabel={`Usuń stronę ${i + 1}`} style={[styles.remove, { backgroundColor: c.overlay }]}>
                <Icon name="close" size={16} color="#FFFFFF" />
              </Touchable>
            </View>
          ))}
        </View>
      )}

      <AiConsentSheet
        visible={consentOpen}
        onClose={() => setConsentOpen(false)}
        onAccept={async () => {
          await consent.give();
          setConsentOpen(false);
          void send();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: spacing.s },
  empty: { alignItems: 'center', gap: 8, padding: 32, borderRadius: radius.l, borderWidth: 1, borderStyle: 'dashed' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  thumb: { width: 104, height: 136, borderRadius: radius.m, borderWidth: 1, overflow: 'hidden' },
  pdf: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6 },
  index: { position: 'absolute', left: 6, bottom: 6, minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  remove: { position: 'absolute', right: 6, top: 6, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
