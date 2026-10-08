// „Sejf" na token KSeF: szyfrowanie AES-256-GCM kluczem, którego baza danych NIE zna.
// Dlaczego nie samo szyfrowanie bazy? Token KSeF to klucz do wszystkich faktur firmy. Gdyby kopia
// zapasowa albo zrzut bazy wyciekły, szyfrogram bez klucza (trzymanego w sekretach Edge Functions)
// jest bezużyteczny. Dodatkowo AAD (dane uwierzytelniane) wiąże szyfrogram z firmą: skopiowanie
// szyfrogramu do wiersza innej firmy nie pozwoli go odczytać.
//
// Format zapisu: v1.<IV Base64Url>.<szyfrogram+tag Base64Url>
// Rotacja klucza: nowy klucz dajemy jako pierwszy na liście (do szyfrowania), stare zostają na liście
// (do odczytu) — patrz docs/10_KSEF.md.

import { base64ToBytes, bytesToBase64Url } from '../base64.ts';

export class VaultError extends Error {
  code: 'bad_key' | 'bad_format' | 'cannot_decrypt';
  constructor(code: VaultError['code'], message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = base64ToBytes(keyBase64);
  } catch {
    throw new VaultError('bad_key', 'Klucz KSEF_TOKEN_KEY nie jest poprawnym base64.');
  }
  if (raw.length !== 32) throw new VaultError('bad_key', 'Klucz KSEF_TOKEN_KEY musi mieć dokładnie 32 bajty (256 bitów).');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const aadBytes = (aad: string) => new TextEncoder().encode(`tapventory:ksef:${aad}`);

export async function sealToken(plain: string, keysBase64: string[], aad: string): Promise<string> {
  if (keysBase64.length === 0) throw new VaultError('bad_key', 'Brak klucza KSEF_TOKEN_KEY.');
  const key = await importKey(keysBase64[0]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadBytes(aad) }, key, new TextEncoder().encode(plain));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(sealed))}`;
}

export async function openToken(sealed: string, keysBase64: string[], aad: string): Promise<string> {
  const parts = sealed.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new VaultError('bad_format', 'Nieznany format zapisanego tokenu.');
  let iv: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>;
  try {
    iv = base64ToBytes(parts[1]);
    data = base64ToBytes(parts[2]);
  } catch {
    throw new VaultError('bad_format', 'Uszkodzony zapis tokenu.');
  }
  if (iv.length !== 12 || data.length < 17) throw new VaultError('bad_format', 'Uszkodzony zapis tokenu.');
  for (const k of keysBase64) {
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aadBytes(aad) }, await importKey(k), data);
      return new TextDecoder().decode(plain);
    } catch (e) {
      if (e instanceof VaultError) throw e;           // zły klucz w konfiguracji to błąd konfiguracji, nie „próbuj dalej"
    }
  }
  throw new VaultError('cannot_decrypt', 'Nie można odszyfrować zapisanego tokenu (zmieniony klucz lub uszkodzone dane).');
}

/** Klucze z sekretu środowiskowego: „aktualny" lub „aktualny,poprzedni" (rozdzielone przecinkiem). */
export const parseKeyList = (value: string): string[] => value.split(',').map((s) => s.trim()).filter(Boolean);
