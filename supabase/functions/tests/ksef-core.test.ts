import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey, privateDecrypt, constants as C } from 'node:crypto';
import { XmlError, child, childrenOf, parseXml, text } from '../_shared/xml.ts';
import { encryptKsefToken, importKsefPublicKey, sha256Hex, spkiFromCertificate } from '../_shared/ksef/crypto.ts';
import { VaultError, openToken, parseKeyList, sealToken } from '../_shared/ksef/token-vault.ts';
import { isValidKsefNumber } from '../_shared/ksef/types.ts';
import { base64ToBytes, bytesToBase64 } from '../_shared/base64.ts';
import { fakeCertificateDer, makeKsefNumber } from './ksef-fixtures.ts';

// --- XML --------------------------------------------------------------------------------------

test('xml: elementy, atrybuty, przestrzenie nazw, CDATA, encje, komentarze', () => {
  const root = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
  <!-- komentarz -->
  <tns:Faktura xmlns:tns="urn:x" xmlns:xsi="urn:y" tns:attr='a&amp;b'>
    <tns:Fa><P_2>FV/1 &lt;2&gt; &quot;q&quot; &apos;a&apos; &#65;&#x42;</P_2><Pusty/><Cdata><![CDATA[<b>&nie encja</b>]]></Cdata></tns:Fa>
    <Fa><P_2>drugi</P_2></Fa>
  </tns:Faktura>
  <!-- na końcu -->`);
  assert.equal(root.name, 'Faktura');
  assert.deepEqual(root.attrs, { attr: 'a&b' });
  assert.equal(childrenOf(root, 'Fa').length, 2);
  assert.equal(text(root, 'Fa', 'P_2'), 'FV/1 <2> "q" \'a\' AB');
  assert.equal(text(root, 'Fa', 'Cdata'), '<b>&nie encja</b>');
  assert.equal(text(root, 'Fa', 'Pusty'), undefined);
  assert.equal(child(root, 'Fa')?.children.length, 3);
  assert.equal(text(root, 'Brak', 'P_2'), undefined);
});

test('xml: BOM na początku jest tolerowany, kodowanie inne niż UTF-8 odrzucone', () => {
  assert.equal(parseXml('﻿<a>1</a>').text, '1');
  assert.throws(() => parseXml('<?xml version="1.0" encoding="ISO-8859-2"?><a/>'), /UTF-8/);
  assert.equal(parseXml('<?xml version="1.0" encoding="utf-8"?><a/>').name, 'a');
});

test('xml: odrzuca DOCTYPE, instrukcje przetwarzania, nieznane encje i gołe ampersandy', () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><a>&lol2;</a>`;
  assert.throws(() => parseXml(evil), /DOCTYPE/);
  assert.throws(() => parseXml('<a><?php echo 1 ?></a>'), /Instrukcje przetwarzania/);
  assert.throws(() => parseXml('<a>&lol;</a>'), /Nieznana encja/);
  assert.throws(() => parseXml('<a>AT&T</a>'), /Niepoprawny znak &/);
  assert.throws(() => parseXml('<a>&#0;</a>'), /Niedozwolony znak/);
  assert.throws(() => parseXml('<a>&#xD800;</a>'), /Niedozwolony znak/);
  assert.throws(() => parseXml('<a x="1<2"/>'), /Znak </);
  // „billion laughs" bez DOCTYPE po prostu nie ma jak zadziałać — encji własnych nie da się zdefiniować
  assert.equal(parseXml('<a>&amp;&amp;&amp;&amp;</a>').text, '&&&&');
});

test('xml: struktura — niedomknięte, niezgodne znaczniki, wiele korzeni, tekst poza korzeniem', () => {
  for (const bad of ['<a>', '<a><b></a>', '</a>', '<a/><b/>', 'tekst<a/>', '<a/>tekst', '', '   ', '<a b></a>', '<a b=1></a>', '<1a/>', '<a><!-- ', '<a><![CDATA[x</a>', '<a']) {
    assert.throws(() => parseXml(bad), XmlError, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => parseXml('<a/>   \n  '));
});

test('xml: limity rozmiaru, głębokości i liczby elementów', () => {
  assert.throws(() => parseXml('<a>' + 'x'.repeat(200) + '</a>', { maxChars: 100 }), /zbyt duży/);
  assert.throws(() => parseXml('<a>'.repeat(70) + '</a>'.repeat(70)), /głębokie/);
  assert.doesNotThrow(() => parseXml('<a>'.repeat(60) + '</a>'.repeat(60)));
  assert.throws(() => parseXml('<a>' + '<b/>'.repeat(50) + '</a>', { maxNodes: 10 }), /Zbyt wiele elementów/);
  const big = '<a>' + '<b>1</b>'.repeat(5000) + '</a>';
  assert.equal(parseXml(big).children.length, 5000);
});

test('xml: nic nie wykonuje się „po drodze” — wartości z <script>, javascript: i HTML to zwykły tekst', () => {
  const r = parseXml('<a><n>&lt;script&gt;alert(1)&lt;/script&gt;</n><m><![CDATA[<img src=x onerror=alert(1)>]]></m></a>');
  assert.equal(text(r, 'n'), '<script>alert(1)</script>');
  assert.equal(text(r, 'm'), '<img src=x onerror=alert(1)>');
});

// --- numer KSeF ---------------------------------------------------------------------------------

test('numer KSeF: suma kontrolna CRC-8 zgodna z przykładem z dokumentacji MF', () => {
  assert.equal(isValidKsefNumber('5265877635-20250826-0100001AF629-AF'), true);
  assert.equal(isValidKsefNumber('5265877635-20250826-0100001AF629-AE'), false);
  assert.equal(isValidKsefNumber('5265877635-20250826-0100001af629-AF'), false, 'małe litery niedozwolone');
  assert.equal(isValidKsefNumber('5265877635-20250826-0100001AF629'), false);
  assert.equal(isValidKsefNumber(''), false);
  for (let i = 1; i < 50; i++) assert.equal(isValidKsefNumber(makeKsefNumber(i)), true, makeKsefNumber(i));
});

// --- kryptografia ---------------------------------------------------------------------------------

async function rsaPair() {
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { spki, pem: `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8)}\n-----END PRIVATE KEY-----` };
}

test('certyfikat: wycinanie klucza publicznego (v3 i v1) zgodne z parserem OpenSSL', async () => {
  const { spki } = await rsaPair();
  for (const opts of [{}, { v1: true }, { longSerial: true }]) {
    const der = fakeCertificateDer(spki, opts);
    const cert = new X509Certificate(Buffer.from(der));        // OpenSSL musi uznać sztuczny certyfikat za poprawny
    const expected = new Uint8Array(cert.publicKey.export({ type: 'spki', format: 'der' }));
    assert.deepEqual(spkiFromCertificate(der), expected, JSON.stringify(opts));
    assert.deepEqual(spkiFromCertificate(der), spki);
  }
});

test('certyfikat: śmieci i ucięte dane kończą się błędem, a nie zawieszeniem', async () => {
  const { spki } = await rsaPair();
  const der = fakeCertificateDer(spki);
  assert.throws(() => spkiFromCertificate(new Uint8Array([1, 2, 3])), /To nie jest certyfikat|DER/);
  assert.throws(() => spkiFromCertificate(der.slice(0, 40)), /DER/);
  assert.throws(() => spkiFromCertificate(new Uint8Array(0)), /DER/);
  assert.throws(() => spkiFromCertificate(Uint8Array.of(0x30, 0x84, 0xff, 0xff, 0xff, 0xff)), /DER/);
});

test('token: „token|znacznik_ms” szyfrowany RSA-OAEP/SHA-256 daje się odszyfrować OpenSSL-em (jak po stronie MF)', async () => {
  const { spki, pem } = await rsaPair();
  const certB64 = bytesToBase64(fakeCertificateDer(spki));
  const key = await importKsefPublicKey(certB64);
  const token = '20260105-EC-0123456789-ABCDEF0123-45|nip-5260250995|a1b2c3';
  const encrypted = await encryptKsefToken(token, 1_767_607_200_123, key);
  const plain = privateDecrypt({ key: createPrivateKey(pem), padding: C.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(encrypted, 'base64')).toString('utf8');
  assert.equal(plain, `${token}|1767607200123`);
  assert.notEqual(await encryptKsefToken(token, 1_767_607_200_123, key), encrypted, 'OAEP jest losowy — dwa szyfrogramy się różnią');
  // SHA-1 jako funkcja skrótu OAEP NIE odszyfruje (to sprawdza, że użyliśmy SHA-256)
  assert.throws(() => privateDecrypt({ key: createPrivateKey(pem), padding: C.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(encrypted, 'base64')));
});

test('sha256Hex zgodny ze wzorcem', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('base64: obie odmiany, błędne znaki odrzucane', () => {
  assert.deepEqual(base64ToBytes('AQID'), Uint8Array.of(1, 2, 3));
  assert.deepEqual(base64ToBytes('-_8'), Uint8Array.of(0xfb, 0xff));
  assert.deepEqual(base64ToBytes('+/8='), Uint8Array.of(0xfb, 0xff));
  assert.throws(() => base64ToBytes('a$b'), /base64/);
  assert.throws(() => base64ToBytes('A'), /base64/);
});

// --- sejf na token ------------------------------------------------------------------------------------

const keyA = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
const keyB = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
const TENANT = '11111111-1111-4111-8111-111111111111';
const TENANT2 = '22222222-2222-4222-8222-222222222222';

test('sejf: zaszyfrowany token odczytuje się tylko z właściwym kluczem i właściwą firmą', async () => {
  const token = '20260105-EC-0123456789-ABCDEF0123-45|nip-5260250995|sekret';
  const sealed = await sealToken(token, [keyA], TENANT);
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
  assert.ok(!sealed.includes('sekret') && !sealed.includes('EC-0123'));
  assert.ok(sealed.length >= 20 && sealed.length < 4000, 'mieści się w ograniczeniu kolumny w bazie');
  assert.equal(await openToken(sealed, [keyA], TENANT), token);

  await assert.rejects(openToken(sealed, [keyA], TENANT2), (e: VaultError) => e.code === 'cannot_decrypt');   // inna firma
  await assert.rejects(openToken(sealed, [keyB], TENANT), (e: VaultError) => e.code === 'cannot_decrypt');    // zły klucz
  assert.notEqual(await sealToken(token, [keyA], TENANT), sealed, 'losowy IV');
});

test('sejf: rotacja klucza — stare zapisy czytelne dzięki liście kluczy, nowe szyfrowane pierwszym', async () => {
  const old = await sealToken('stary', [keyA], TENANT);
  assert.equal(await openToken(old, [keyB, keyA], TENANT), 'stary');
  const fresh = await sealToken('nowy', [keyB, keyA], TENANT);
  assert.equal(await openToken(fresh, [keyB], TENANT), 'nowy');
  await assert.rejects(openToken(fresh, [keyA], TENANT), (e: VaultError) => e.code === 'cannot_decrypt');
  assert.deepEqual(parseKeyList(` ${keyB} , ${keyA},, `), [keyB, keyA]);
});

test('sejf: manipulacja szyfrogramem, zły format i zły klucz w konfiguracji', async () => {
  const sealed = await sealToken('abc', [keyA], TENANT);
  const parts = sealed.split('.');
  const flipped = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}${parts[2].endsWith('AA') ? 'BB' : 'AA'}`;
  await assert.rejects(openToken(flipped, [keyA], TENANT), (e: VaultError) => e.code === 'cannot_decrypt');
  for (const bad of ['', 'v2.a.b', 'v1.a', 'v1.!!!.???', `v1.${parts[1]}.AAAA`]) {
    await assert.rejects(openToken(bad, [keyA], TENANT), (e: VaultError) => e instanceof VaultError && e.code === 'bad_format', JSON.stringify(bad));
  }
  await assert.rejects(sealToken('x', ['za-krotki-klucz'], TENANT), (e: VaultError) => e.code === 'bad_key');
  await assert.rejects(sealToken('x', ['@@@'], TENANT), (e: VaultError) => e.code === 'bad_key');
  await assert.rejects(sealToken('x', [], TENANT), (e: VaultError) => e.code === 'bad_key');
  await assert.rejects(openToken(sealed, ['za-krotki-klucz'], TENANT), (e: VaultError) => e.code === 'bad_key');
});
