// Kryptografia potrzebna do logowania tokenem KSeF.
// KSeF publikuje certyfikat X.509 (DER, Base64) z kluczem RSA przeznaczonym do szyfrowania tokenów.
// Token szyfrujemy tak jak oficjalne SDK Ministerstwa Finansów: RSA-OAEP z SHA-256 (także w MGF1),
// treść „token|znacznik_czasu_ms" w UTF-8, wynik w Base64.
// WebCrypto (crypto.subtle) działa identycznie w Deno (Supabase) i w Node (testy).
// Problem: WebCrypto nie czyta certyfikatów, tylko same klucze (format SPKI) — dlatego niżej
// jest niewielki czytnik DER, który wycina ze certyfikatu pole SubjectPublicKeyInfo.

import { base64ToBytes, bytesToBase64 } from '../base64.ts';

/** Czyta jeden element DER (tag, długość) od pozycji `pos`. */
function readDer(buf: Uint8Array, pos: number): { tag: number; start: number; end: number } {
  if (pos + 2 > buf.length) throw new Error('DER: ucięte dane');
  const tag = buf[pos];
  let len = buf[pos + 1];
  let start = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || start + n > buf.length) throw new Error('DER: niepoprawna długość');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[start + i];
    start += n;
  }
  const end = start + len;
  if (end > buf.length) throw new Error('DER: element wychodzi poza dane');
  return { tag, start, end };
}

/**
 * Z certyfikatu X.509 (DER) wycina klucz publiczny w formacie SPKI.
 * Certificate ::= SEQUENCE { tbsCertificate SEQUENCE { [0] version?, serial, signature, issuer,
 *                 validity, subject, subjectPublicKeyInfo, ... }, signatureAlgorithm, signature }
 */
export function spkiFromCertificate(der: Uint8Array): Uint8Array<ArrayBuffer> {
  const cert = readDer(der, 0);
  if (cert.tag !== 0x30) throw new Error('To nie jest certyfikat X.509');
  const tbs = readDer(der, cert.start);
  if (tbs.tag !== 0x30) throw new Error('Certyfikat: brak części tbsCertificate');
  let pos = tbs.start;
  const first = readDer(der, pos);
  if (first.tag === 0xa0) pos = first.end;                 // pole [0] version (opcjonalne)
  // serialNumber, signature, issuer, validity, subject — pomijamy po kolei
  for (let i = 0; i < 5; i++) pos = readDer(der, pos).end;
  const spki = readDer(der, pos);
  if (spki.tag !== 0x30) throw new Error('Certyfikat: brak klucza publicznego');
  return new Uint8Array(der.subarray(pos, spki.end));      // kopia na własnym ArrayBuffer (wymóg WebCrypto)
}

export async function importKsefPublicKey(certificateBase64: string): Promise<CryptoKey> {
  const spki = spkiFromCertificate(base64ToBytes(certificateBase64));
  return crypto.subtle.importKey('spki', spki, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
}

/** Szyfrowanie „token|timestampMs" kluczem KSeF — wartość pola `encryptedToken` w POST /auth/ksef-token. */
export async function encryptKsefToken(token: string, timestampMs: number, key: CryptoKey): Promise<string> {
  const plain = new TextEncoder().encode(`${token}|${timestampMs}`);
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, plain);
  return bytesToBase64(new Uint8Array(encrypted));
}

/** SHA-256 jako małe litery HEX (do kontroli skrótu przechowywanego XML-a). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
