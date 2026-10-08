// Pole zdjęcia: aparat albo galeria, z podglądem i usuwaniem. Zdjęcie jest zmniejszane
// i kompresowane jeszcze na urządzeniu (patrz lib/images.ts), wysyłamy je dopiero przy zapisie formularza.

import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Icon, SignedImage, Sheet, Text, Touchable, useDialogs } from '@/components/ui';
import { pickFromLibrary, takePhoto, PRODUCT_PHOTO, type PickedImage, type PickResult } from '@/lib/images';
import type { Bucket } from '@/lib/storage';
import { radius, useColors } from '@/theme';

export type LocalPhoto = Pick<PickedImage, 'uri' | 'base64'> | null;

export function PhotoPicker({ value, existingPath, bucket = 'product-photos', onChange, label = 'Dodaj zdjęcie', aspectRatio = 1 }: {
  value: LocalPhoto;
  /** zdjęcie już zapisane w bazie (gdy edytujemy) — pokazujemy je, dopóki nie wybierzesz nowego */
  existingPath?: string | null;
  bucket?: Bucket;
  /** null = usuń zdjęcie */
  onChange: (photo: LocalPhoto, removed: boolean) => void;
  label?: string;
  aspectRatio?: number;
}) {
  const c = useColors();
  const { alert, fail } = useDialogs();
  const [open, setOpen] = useState(false);
  const hasAny = Boolean(value) || Boolean(existingPath);

  async function run(kind: 'camera' | 'library') {
    setOpen(false);
    try {
      const res: PickResult = kind === 'camera' ? await takePhoto(PRODUCT_PHOTO) : await pickFromLibrary(PRODUCT_PHOTO);
      if (res.status === 'denied') {
        await alert('Brak dostępu', kind === 'camera' ? 'Włącz dostęp do aparatu w ustawieniach telefonu lub przeglądarki.' : 'Włącz dostęp do zdjęć w ustawieniach telefonu lub przeglądarki.');
      } else if (res.status === 'ok') {
        onChange({ uri: res.images[0].uri, base64: res.images[0].base64 }, false);
      }
    } catch (e) {
      fail(e);
    }
  }

  return (
    <>
      <Touchable
        onPress={() => setOpen(true)}
        accessibilityLabel={hasAny ? 'Zmień zdjęcie' : label}
        style={[styles.box, { aspectRatio, borderColor: c.border, backgroundColor: c.bgSecondary }]}
      >
        {value ? (
          <Image source={{ uri: value.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Wybrane zdjęcie" />
        ) : existingPath ? (
          <SignedImage bucket={bucket} path={existingPath} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={styles.empty}>
            <Icon name="camera-outline" size={40} color={c.textSecondary} />
            <Text color="secondary" bold>
              {label}
            </Text>
          </View>
        )}
        {hasAny ? (
          <View style={[styles.edit, { backgroundColor: c.overlay }]}>
            <Icon name="camera" size={16} color="#FFFFFF" />
          </View>
        ) : null}
      </Touchable>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Zdjęcie">
        <View style={styles.list}>
          <Option icon="camera-outline" text="Zrób zdjęcie" onPress={() => void run('camera')} />
          <Option icon="images-outline" text="Wybierz z galerii" onPress={() => void run('library')} />
          {hasAny ? (
            <Option
              icon="trash-outline"
              text="Usuń zdjęcie"
              danger
              onPress={() => {
                setOpen(false);
                onChange(null, true);
              }}
            />
          ) : null}
        </View>
      </Sheet>
    </>
  );
}

function Option({ icon, text, onPress, danger }: { icon: 'camera-outline' | 'images-outline' | 'trash-outline'; text: string; onPress: () => void; danger?: boolean }) {
  const c = useColors();
  return (
    <Touchable onPress={onPress} accessibilityLabel={text} style={styles.option}>
      <Icon name={icon} size={24} color={danger ? c.danger : c.text} />
      <Text variant="body" style={danger ? { color: c.danger } : undefined}>
        {text}
      </Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', borderRadius: radius.l, borderWidth: 1, borderStyle: 'dashed', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 6 },
  edit: { position: 'absolute', right: 10, bottom: 10, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
});
