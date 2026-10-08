// Dekoder base64 → bajty (do wysyłania zdjęć do Storage bez zależności od atob,
// którego dostępność różni się między silnikami JS).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Record<string, number> = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/^data:[^,]*,/, '').replace(/[\s=]+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean[i]], b = LOOKUP[clean[i + 1]];
    const c = i + 2 < clean.length ? LOOKUP[clean[i + 2]] : 0;
    const d = i + 3 < clean.length ? LOOKUP[clean[i + 3]] : 0;
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Error('Nieprawidłowe dane base64.');
    }
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}
