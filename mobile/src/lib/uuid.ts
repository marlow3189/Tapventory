// UUID v7 generowany NA KLIENCIE (wymóg koncepcji: warunek przyszłego trybu offline
// i idempotentnych zapisów). 48 bitów to czas w ms, więc identyfikatory sortują
// się chronologicznie — przyjazne dla indeksów bazy.

/** Czysta funkcja (testowalna): źródło losowości i czasu podajemy z zewnątrz. */
export function makeUuidV7(randomBytes: (n: number) => Uint8Array, nowMs: number): string {
  const b = new Uint8Array(16);
  let t = nowMs;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b.set(randomBytes(10), 6);
  b[6] = (b[6] & 0x0f) | 0x70; // wersja 7
  b[8] = (b[8] & 0x3f) | 0x80; // wariant RFC 4122
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidv7(): string {
  // wymagane dopiero w momencie użycia (testy jednostkowe nie ładują modułu natywnego)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getRandomBytes } = require('expo-crypto') as typeof import('expo-crypto');
  return makeUuidV7(getRandomBytes, Date.now());
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
