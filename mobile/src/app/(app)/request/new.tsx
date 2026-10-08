// Nowe zgłoszenie braku — „publikowanie posta": zdjęcie, nazwa (z podpowiedziami z magazynu), ilość, notatka.
//   /request/new?productId=…   z karty produktu
//   /request/new?ean=…         po skanie nieznanego kodu (pracownik)

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PhotoPicker, type LocalPhoto } from '@/components/PhotoPicker';
import { Button, Chips, Icon, ListRow, QtyStepper, Screen, Section, Text, TextField, Touchable, useDialogs } from '@/components/ui';
import { useProducts, useProjects } from '@/lib/api/products';
import { useCreateRequest } from '@/lib/api/requests';
import { matchesQuery } from '@/lib/search';
import { parseQty } from '@/lib/qty';
import { uploadJpeg } from '@/lib/storage';
import { useTenant } from '@/lib/tenant';
import { uuidv7 } from '@/lib/uuid';
import { useColors } from '@/theme';

export default function NewRequest() {
  const c = useColors();
  const router = useRouter();
  const { tenantId } = useTenant();
  const { productId, ean } = useLocalSearchParams<{ productId?: string; ean?: string }>();
  const { fail, toast } = useDialogs();
  const products = useProducts();
  const projects = useProjects(true);
  const create = useCreateRequest();

  const [chosenId, setChosenId] = useState<string | null>(productId ?? null);
  const [text, setText] = useState('');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState(ean ? `Kod kreskowy: ${ean}` : '');
  const [projectId, setProjectId] = useState('none');
  const [photo, setPhoto] = useState<LocalPhoto>(null);
  const [busy, setBusy] = useState(false);

  const chosen = products.data?.find((p) => p.id === chosenId) ?? null;
  const suggestions = useMemo(() => {
    if (chosen || text.trim().length < 2) return [];
    return (products.data ?? []).filter((p) => p.active && matchesQuery(p.name, text)).slice(0, 5);
  }, [products.data, text, chosen]);

  async function submit() {
    const free = text.trim();
    if (!chosen && free.length < 2) return fail({ message: 'Napisz, czego brakuje (min. 2 znaki).' });
    const n = parseQty(qty);
    if (n === null || n <= 0) return fail({ message: 'Podaj ilość większą od zera.' });

    setBusy(true);
    try {
      const id = uuidv7();
      let photoPath: string | null = null;
      if (photo) {
        photoPath = `${tenantId}/requests/${id}.jpg`;
        await uploadJpeg('product-photos', photoPath, photo.base64);
      }
      await create.mutateAsync({
        id,
        product_id: chosen?.id ?? null,
        free_name: chosen ? null : free,
        qty: n,
        note,
        photo_path: photoPath,
        project_id: projectId === 'none' ? null : projectId,
      });
      toast('Zgłoszenie opublikowane. Kierownik dostał powiadomienie.', 'success');
      if (router.canGoBack()) router.back();
      else router.replace('/home');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Zgłoś brak" scroll footer={<Button title="Opublikuj zgłoszenie" onPress={submit} loading={busy} fullWidth />}>
      <PhotoPicker value={photo} onChange={(p) => setPhoto(p)} label="Dodaj zdjęcie (pomaga w zamówieniu)" aspectRatio={1.4} />

      {chosen ? (
        <View style={[styles.chosen, { backgroundColor: c.fill }]}>
          <Icon name="cube-outline" size={22} />
          <View style={{ flex: 1 }}>
            <Text bold numberOfLines={1}>
              {chosen.name}
            </Text>
            <Text variant="footnote" color="secondary">
              Na stanie: {chosen.stock} {chosen.unit}
            </Text>
          </View>
          <Touchable onPress={() => setChosenId(null)} accessibilityLabel="Wybierz inny produkt">
            <Icon name="close-circle" size={22} color={c.textSecondary} />
          </Touchable>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <TextField
            label="Czego brakuje?"
            value={text}
            onChangeText={setText}
            placeholder="np. rękawice nitrylowe L"
            autoCorrect
            returnKeyType="next"
          />
          {suggestions.length > 0 ? (
            <Section title="Z magazynu">
              {suggestions.map((p, i) => (
                <ListRow
                  key={p.id}
                  icon="cube-outline"
                  title={p.name}
                  subtitle={`Stan: ${p.stock} ${p.unit}`}
                  onPress={() => {
                    setChosenId(p.id);
                    setText('');
                  }}
                  last={i === suggestions.length - 1}
                />
              ))}
            </Section>
          ) : null}
        </View>
      )}

      <View style={{ gap: 6 }}>
        <Text variant="subhead" color="secondary" bold>
          Ile potrzeba?
        </Text>
        <QtyStepper value={qty} onChange={setQty} unit={chosen?.unit} />
      </View>

      <TextField label="Notatka (opcjonalnie)" value={note} onChangeText={setNote} multiline placeholder="np. na jutro, rozmiar M, konkretna marka…" />

      {projects.data && projects.data.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text variant="subhead" color="secondary" bold>
            Na które zlecenie? (opcjonalnie)
          </Text>
          <View style={styles.bleed}>
            <Chips options={[{ value: 'none', label: 'Bez zlecenia' }, ...projects.data.map((p) => ({ value: p.id, label: p.name }))]} value={projectId} onChange={setProjectId} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chosen: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12 },
  bleed: { marginHorizontal: -16 },
});
