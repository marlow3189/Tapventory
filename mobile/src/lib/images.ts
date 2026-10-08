// Zdjęcia: aparat / galeria → zmniejszenie i kompresja → base64 do wysyłki.
// Dlaczego kompresujemy: zdjęcie z telefonu to 3–8 MB; produkt czy faktura w pełni
// czytelne są przy ~1600 px. Mniejszy plik = szybsze wysyłanie, taniej w Storage
// i taniej w AI (koszt zależy od rozmiaru obrazu).

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export type PickedImage = { uri: string; base64: string; width: number; height: number };
export type PickResult =
  | { status: 'ok'; images: PickedImage[] }
  | { status: 'cancelled' }
  | { status: 'denied' };

export const PRODUCT_PHOTO = { maxSide: 1280, quality: 0.7 } as const;
export const DOCUMENT_PAGE = { maxSide: 1800, quality: 0.75 } as const;   // tekst musi pozostać czytelny

/** Docelowe wymiary po przeskalowaniu (długi bok ≤ maxSide, bez powiększania). */
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest === 0) return { width, height };
  const k = maxSide / longest;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

async function shrink(
  asset: { uri: string; width: number; height: number },
  opts: { maxSide: number; quality: number }
): Promise<PickedImage> {
  const target = fitSize(asset.width, asset.height, opts.maxSide);
  const needsResize = target.width !== asset.width || target.height !== asset.height;
  const out = await ImageManipulator.manipulateAsync(
    asset.uri,
    needsResize ? [{ resize: target }] : [],
    { compress: opts.quality, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  return { uri: out.uri, base64: out.base64 ?? '', width: out.width, height: out.height };
}

export async function takePhoto(opts: { maxSide: number; quality: number } = PRODUCT_PHOTO): Promise<PickResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { status: 'denied' };
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (res.canceled || res.assets.length === 0) return { status: 'cancelled' };
  return { status: 'ok', images: [await shrink(res.assets[0], opts)] };
}

export async function pickFromLibrary(
  opts: { maxSide: number; quality: number; multiple?: boolean } = PRODUCT_PHOTO
): Promise<PickResult> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted && perm.accessPrivileges !== 'limited') return { status: 'denied' };
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: Boolean(opts.multiple),
    selectionLimit: opts.multiple ? 10 : 1,
  });
  if (res.canceled || res.assets.length === 0) return { status: 'cancelled' };
  const images: PickedImage[] = [];
  for (const a of res.assets) images.push(await shrink(a, opts));
  return { status: 'ok', images };
}
