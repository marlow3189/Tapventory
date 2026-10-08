// Magazyn sesji logowania: na telefonie — Keychain (iOS) / Keystore (Android)
// przez expo-secure-store, a nie zwykły AsyncStorage (tokeny w jawnym pliku).
//
// Ograniczenie: SecureStore trzyma ~2 KB na klucz, a sesja Supabase bywa większa,
// więc dzielimy wartość na kawałki: klucz.0, klucz.1, ... + klucz.n (liczba kawałków).
// Nazwy kluczy mogą zawierać tylko litery, cyfry, '.', '-' i '_'.

import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1800;

type KV = {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
};

/** Wstrzykiwalny rdzeń (testy podstawiają pamięć zamiast natywnego modułu). */
export function makeChunkedStorage(store: KV, chunkSize = CHUNK_SIZE): KV {
  const countKey = (k: string) => `${k}.n`;
  const partKey = (k: string, i: number) => `${k}.${i}`;

  async function removeItem(key: string) {
    const n = Number((await store.getItem(countKey(key))) ?? 0);
    for (let i = 0; i < n; i++) await store.removeItem(partKey(key, i));
    await store.removeItem(countKey(key));
  }

  return {
    async getItem(key) {
      try {
        const raw = await store.getItem(countKey(key));
        if (raw === null) return null;
        const parts: string[] = [];
        for (let i = 0; i < Number(raw); i++) {
          const part = await store.getItem(partKey(key, i));
          if (part === null) return null; // uszkodzony zapis → traktujemy jak brak sesji
          parts.push(part);
        }
        return parts.join('');
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      await removeItem(key);
      const chunks = value.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g')) ?? [];
      for (let i = 0; i < chunks.length; i++) await store.setItem(partKey(key, i), chunks[i]);
      await store.setItem(countKey(key), String(chunks.length));
    },
    removeItem,
  };
}

export const secureSessionStorage = makeChunkedStorage({
  getItem: (k) => SecureStore.getItemAsync(k),
  setItem: (k, v) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  removeItem: (k) => SecureStore.deleteItemAsync(k),
});
