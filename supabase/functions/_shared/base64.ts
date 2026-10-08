/** Bajty → base64 (porcjami, żeby nie przepełnić stosu przy dużych plikach). Działa w Deno i w Node. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 (także wariant URL-safe, z lub bez „=") → bajty. Rzuca błąd przy niepoprawnych znakach. */
export function base64ToBytes(input: string): Uint8Array<ArrayBuffer> {
  const s = input.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 === 1) throw new Error('Niepoprawny base64');
  const binary = atob(s.padEnd(Math.ceil(s.length / 4) * 4, '='));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Bajty → base64 w wariancie URL-safe, bez dopełnienia „=" (do zapisu w jednym polu tekstowym). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
