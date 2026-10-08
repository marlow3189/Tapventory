// Pliki w Supabase Storage. Konwencja ścieżki KAŻDEGO pliku (patrz migracja 0002):
//   <tenant_id>/<podfolder>/<nazwa>      np. 3f2b…/products/0192….jpg
// Pierwszy segment to firma — na nim opiera się dostęp (RLS na storage.objects).

import { Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { base64ToBytes } from './base64';

export type Bucket = 'product-photos' | 'documents';

export async function uploadJpeg(bucket: Bucket, path: string, base64: string): Promise<void> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, base64ToBytes(base64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
}

export async function uploadBytes(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
}

/** Odczyt pliku z adresu zwróconego przez selektor plików (telefon: file://, web: blob:). */
export async function readUriAsBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return new Uint8Array(await res.arrayBuffer());
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  return new Uint8Array(await new File(uri).arrayBuffer());
}

/** Podpisany, wygasający link do prywatnego pliku (ważny godzinę; cache 50 min). */
export function useSignedUrl(bucket: Bucket, path: string | null | undefined) {
  return useQuery({
    queryKey: ['signed-url', bucket, path],
    enabled: Boolean(path),
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path as string, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
