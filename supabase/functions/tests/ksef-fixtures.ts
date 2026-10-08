// Wspólne atrapy do testów KSeF: budowniczy faktury FA(3), sztuczny certyfikat X.509 i „fałszywy KSeF".
import { createPrivateKey, privateDecrypt, constants as cryptoConstants } from 'node:crypto';
import { bytesToBase64 } from '../_shared/base64.ts';
import type { KsefInvoiceMeta } from '../_shared/ksef/types.ts';

// --- DER / sztuczny certyfikat ----------------------------------------------------------------

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const lenBytes = (n: number) => {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
};
export const der = (tag: number, ...parts: Uint8Array[]) => {
  const body = concat(...parts);
  return concat(Uint8Array.of(tag), lenBytes(body.length), body);
};
const ascii = (s: string) => new TextEncoder().encode(s);

/** Certyfikat X.509 „na niby" wokół prawdziwego klucza publicznego (SPKI): wystarcza do testów wycinania klucza. */
export function fakeCertificateDer(spki: Uint8Array, opts: { v1?: boolean; longSerial?: boolean } = {}): Uint8Array {
  const sigAlg = der(0x30, der(0x06, Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b)), Uint8Array.of(0x05, 0x00));
  const name = der(0x30, der(0x31, der(0x30, der(0x06, Uint8Array.of(0x55, 0x04, 0x03)), der(0x0c, ascii('KSeF Test')))));
  const validity = der(0x30, der(0x17, ascii('250101000000Z')), der(0x17, ascii('350101000000Z')));
  const serial = der(0x02, opts.longSerial ? new Uint8Array(300).fill(0x11).map((b, i) => (i === 0 ? 0x01 : b)) : Uint8Array.of(0x01));
  const tbs = der(0x30, ...(opts.v1 ? [] : [der(0xa0, der(0x02, Uint8Array.of(0x02)))]), serial, sigAlg, name, validity, name, spki);
  return der(0x30, tbs, sigAlg, der(0x03, Uint8Array.of(0x00, 0xde, 0xad, 0xbe, 0xef)));
}

// --- faktura FA(3) ---------------------------------------------------------------------------------

export interface FaLine {
  name?: string; unit?: string; qty?: string | number; unitNet?: string | number; unitGross?: string | number;
  discount?: string | number; net?: string | number; gross?: string | number; rate?: string; gtin?: string; index?: string; before?: boolean;
}
export interface FaOptions {
  nip?: string; sellerName?: string; number?: string; date?: string; currency?: string; type?: string;
  lines?: FaLine[]; net23?: string | number; net8?: string | number; vat23?: string | number; gross?: string | number;
  system?: string; prefix?: string; rawLines?: string; omitNumber?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const el = (tag: string, v: unknown) => (v === undefined || v === null ? '' : `<${tag}>${esc(String(v))}</${tag}>`);

export function faLineXml(l: FaLine, n: number): string {
  return `<FaWiersz>${el('NrWierszaFa', n)}${el('P_7', l.name ?? `Towar ${n}`)}${el('Indeks', l.index)}${el('GTIN', l.gtin)}${el('P_8A', l.unit ?? 'szt.')}${el('P_8B', l.qty ?? 1)}${el('P_9A', l.unitNet)}${el('P_9B', l.unitGross)}${el('P_10', l.discount)}${el('P_11', l.net)}${el('P_11A', l.gross)}${el('P_12', l.rate ?? '23')}${l.before ? '<StanPrzed>1</StanPrzed>' : ''}</FaWiersz>`;
}

export function faXml(o: FaOptions = {}): string {
  const lines = o.lines ?? [{ name: 'Rękawice nitrylowe L', unit: 'op.', qty: 3, unitNet: 24.5, net: 73.5, gtin: '5901234123457' }];
  const body = o.rawLines ?? lines.map((l, i) => faLineXml(l, i + 1)).join('');
  const system = o.system ?? 'FA (3)';
  const p = o.prefix ? `${o.prefix}:` : '';
  const nsAttr = o.prefix ? `xmlns:${o.prefix}="http://crd.gov.pl/wzor/2025/06/25/13775/"` : 'xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"';
  // wewnętrzne elementy dziedziczą przestrzeń nazw; przy prefiksie dopisujemy go do każdego znacznika
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura ${nsAttr} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Naglowek><KodFormularza kodSystemowy="${system}" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza><DataWytworzeniaFa>2026-01-05T10:00:00Z</DataWytworzeniaFa><SystemInfo>Test</SystemInfo></Naglowek>
  <Podmiot1><DaneIdentyfikacyjne>${el('NIP', o.nip ?? '1234563218')}${el('Nazwa', o.sellerName ?? 'Hurtownia ABC Sp. z o.o.')}</DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>ul. Testowa 1</AdresL1></Adres></Podmiot1>
  <Podmiot2><DaneIdentyfikacyjne><NIP>5260250995</NIP><Nazwa>Warsztat Kowalski</Nazwa></DaneIdentyfikacyjne></Podmiot2>
  <Fa>${el('KodWaluty', o.currency ?? 'PLN')}${el('P_1', o.date ?? '2026-01-05')}${o.omitNumber ? '' : el('P_2', o.number ?? 'FV/2026/01/0451')}${el('P_13_1', o.net23 ?? 160.5)}${el('P_14_1', o.vat23 ?? 36.92)}${el('P_13_2', o.net8)}${el('P_15', o.gross ?? 197.42)}<Adnotacje><P_16>2</P_16></Adnotacje>${el('RodzajFaktury', o.type ?? 'VAT')}${body}<Platnosc><Zaplacono>1</Zaplacono></Platnosc></Fa>
</Faktura>`;
  if (!o.prefix) return xml;
  return xml.replace(/<(\/?)([A-Za-z_][\w]*)/g, (_m, slash: string, name: string) => `<${slash}${p}${name}`);
}

export const metaFor = (ksefNumber: string, over: Partial<KsefInvoiceMeta> = {}): KsefInvoiceMeta => ({
  ksefNumber, invoiceNumber: `FV/${ksefNumber.slice(-8)}`, issueDate: '2026-01-05', permanentStorageDate: '2026-01-05T10:00:00.000Z',
  seller: { nip: '1234563218', name: 'Hurtownia ABC Sp. z o.o.' }, netAmount: 160.5, grossAmount: 197.42, vatAmount: 36.92, currency: 'PLN',
  invoiceType: 'Vat', formCode: { systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' }, ...over,
});

/** Poprawny numer KSeF (z sumą kontrolną CRC-8) dla podanego NIP-u, daty i licznika. */
export function makeKsefNumber(n: number, nip = '1234563218', date = '20260105'): string {
  const data = `${nip}-${date}-${n.toString(16).toUpperCase().padStart(12, '0')}`;
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i);
    for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return `${data}-${crc.toString(16).toUpperCase().padStart(2, '0')}`;
}

// --- „fałszywy KSeF" ---------------------------------------------------------------------------------------

export interface FakeKsefOptions {
  token?: string;
  nip?: string;
  pollsBeforeSuccess?: number;
  invoices?: KsefInvoiceMeta[];
  xml?: Record<string, string>;
  hwm?: string | null;
}

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/**
 * Minimalna atrapa API KSeF 2.0: prawdziwe RSA-OAEP (odszyfrowuje token jak serwer MF), kolejka odpowiedzi
 * do wymuszania błędów (429, 5xx, kody statusu logowania) i zapis wszystkich żądań.
 */
export class FakeKsef {
  calls: { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: unknown }[] = [];
  token: string;
  nip: string;
  pollsBeforeSuccess: number;
  invoices: KsefInvoiceMeta[];
  xml: Record<string, string>;
  hwm: string | null;
  /** następne odpowiedzi dla wskazanej ścieżki (np. '/auth/challenge') — zużywane po jednej, zanim zadziała normalna obsługa */
  forced = new Map<string, Response[]>();
  authStatusCode: number | null = null;
  authStatusDetails: string[] = [];
  rejectKeyId: string | null = null;           // symuluje wycofany klucz (kod 21470)
  decrypted: string[] = [];
  private polls = 0;
  private challengeTs = 0;
  certs: { certificate: string; certificateId: string; publicKeyId: string; validFrom: string; validTo: string; usage: string[] }[] = [];
  private privateKeyPem = '';
  currentKeyId = 'A'.repeat(43) + '=';
  now = () => Date.parse('2026-02-01T12:00:00Z');

  constructor(opts: FakeKsefOptions = {}) {
    this.token = opts.token ?? '20260105-EC-0123456789-ABCDEF0123-45|nip-5260250995|0a1b2c3d4e5f60718293a4b5c6d7e8f9';
    this.nip = opts.nip ?? '5260250995';
    this.pollsBeforeSuccess = opts.pollsBeforeSuccess ?? 1;
    this.invoices = opts.invoices ?? [];
    this.xml = opts.xml ?? {};
    this.hwm = opts.hwm === undefined ? '2026-02-01T11:59:00.000Z' : opts.hwm;
  }

  /** Generuje parę kluczy RSA i certyfikaty (jeden aktualny do tokenów, jeden do kluczy symetrycznych, jeden wygasły). */
  async init(): Promise<this> {
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']) as CryptoKeyPair;
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    this.privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8)}\n-----END PRIVATE KEY-----`;
    const cert = bytesToBase64(fakeCertificateDer(spki));
    const other = bytesToBase64(fakeCertificateDer(spki, { v1: true }));
    this.certs = [
      { certificate: other, certificateId: 'old', publicKeyId: 'O'.repeat(43) + '=', validFrom: '2024-01-01T00:00:00Z', validTo: '2025-01-01T00:00:00Z', usage: ['KsefTokenEncryption'] },
      { certificate: other, certificateId: 'sym', publicKeyId: 'S'.repeat(43) + '=', validFrom: '2025-01-01T00:00:00Z', validTo: '2030-01-01T00:00:00Z', usage: ['SymmetricKeyEncryption'] },
      { certificate: cert, certificateId: 'tok', publicKeyId: this.currentKeyId, validFrom: '2025-01-01T00:00:00Z', validTo: '2030-01-01T00:00:00Z', usage: ['KsefTokenEncryption'] },
    ];
    return this;
  }

  force(path: string, ...responses: Response[]) {
    this.forced.set(path, [...(this.forced.get(path) ?? []), ...responses]);
  }
  calledPaths = () => this.calls.map((c) => `${c.method} ${c.path}`);

  fetch = async (rawUrl: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(rawUrl);
    const path = url.pathname.replace(/^\/v2/, '');
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const method = (init.method ?? 'GET').toUpperCase();
    this.calls.push({ method, path, query: Object.fromEntries(url.searchParams), headers, body });

    const queue = this.forced.get(path);
    if (queue && queue.length > 0) return queue.shift() as Response;

    if (headers['x-error-format'] !== 'problem-details') return jsonRes({ title: 'brak nagłówka X-Error-Format' }, 400);
    const route: Record<string, Handler> = {
      'POST /auth/challenge': () => {
        this.challengeTs = this.now();
        return jsonRes({ challenge: '20260201-CR-ABCDEF0123-0123456789-AB', timestamp: new Date(this.challengeTs).toISOString(), timestampMs: this.challengeTs, clientIp: '203.0.113.7' });
      },
      'GET /security/public-key-certificates': () => jsonRes(this.certs),
      'POST /auth/ksef-token': () => this.authToken(body as Record<string, unknown>),
      'POST /auth/token/redeem': () => (headers.authorization === 'Bearer AUTH-JWT'
        ? jsonRes({ accessToken: { token: 'ACCESS-JWT', validUntil: '2026-02-01T12:15:00Z' }, refreshToken: { token: 'REFRESH-JWT', validUntil: '2026-02-08T12:00:00Z' } })
        : jsonRes({ title: 'Unauthorized' }, 401)),
      'POST /invoices/query/metadata': () => this.queryMetadata(headers, url, body as Record<string, unknown>),
    };
    if (method === 'GET' && path.startsWith('/auth/') && !path.startsWith('/auth/token')) {
      if (headers.authorization !== 'Bearer AUTH-JWT') return jsonRes({ title: 'Unauthorized' }, 401);
      this.polls++;
      const code = this.authStatusCode ?? (this.polls > this.pollsBeforeSuccess ? 200 : 100);
      return jsonRes({ startDate: '2026-02-01T12:00:00Z', authenticationMethod: 'Token', status: { code, description: code === 200 ? 'Uwierzytelnianie zakończone sukcesem' : code === 100 ? 'Uwierzytelnianie w toku' : 'Uwierzytelnianie zakończone niepowodzeniem', details: this.authStatusDetails } });
    }
    if (method === 'GET' && path.startsWith('/invoices/ksef/')) {
      if (headers.authorization !== 'Bearer ACCESS-JWT') return jsonRes({ title: 'Unauthorized' }, 401);
      const xml = this.xml[path.split('/').pop() as string];
      return xml === undefined ? jsonRes({ title: 'Not found' }, 404) : new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } });
    }
    const h = route[`${method} ${path}`];
    return h ? h(url, init) : jsonRes({ title: `nieobsługiwane: ${method} ${path}` }, 404);
  };

  private authToken(b: Record<string, unknown>): Response {
    if (this.rejectKeyId !== null && b.publicKeyId === this.rejectKeyId) {
      return jsonRes({ exception: { exceptionDetailList: [{ exceptionCode: 21470, exceptionDescription: 'Przesłany identyfikator klucza jest nieznany lub wskazuje na wycofany klucz.' }] } }, 400);
    }
    if (b.publicKeyId !== this.currentKeyId) return jsonRes({ title: 'nieznany klucz', detail: '21470' }, 400);
    let plain: string;
    try {
      plain = privateDecrypt(
        { key: createPrivateKey(this.privateKeyPem), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(String(b.encryptedToken), 'base64')
      ).toString('utf8');
    } catch {
      return jsonRes({ title: 'Nieprawidłowe szyfrowanie tokena' }, 400);
    }
    this.decrypted.push(plain);
    const cut = plain.lastIndexOf('|');
    const token = plain.slice(0, cut);
    const ts = Number(plain.slice(cut + 1));
    const ctx = b.contextIdentifier as { type?: string; value?: string };
    if (ts !== this.challengeTs || b.challenge !== '20260201-CR-ABCDEF0123-0123456789-AB') return jsonRes({ title: 'Nieprawidłowe wyzwanie' }, 400);
    if (ctx?.type !== 'Nip' || ctx.value !== this.nip) return jsonRes({ title: 'zły kontekst' }, 400);
    if (token !== this.token) {
      // prawdziwy KSeF odpowiada 202 i dopiero status operacji ujawnia błąd tokenu (kod 450)
      this.authStatusCode = 450;
      this.authStatusDetails = ['Nieprawidłowy token'];
    }
    return jsonRes({ referenceNumber: '20260201-AU-0123456789-ABCDEF0123-01', authenticationToken: { token: 'AUTH-JWT', validUntil: '2026-02-01T12:10:00Z' } }, 202);
  }

  private queryMetadata(headers: Record<string, string>, url: URL, body: Record<string, unknown>): Response {
    if (headers.authorization !== 'Bearer ACCESS-JWT') return jsonRes({ title: 'Unauthorized' }, 401);
    const range = (body.dateRange ?? {}) as { dateType?: string; from?: string; to?: string; restrictToPermanentStorageHwmDate?: boolean };
    if (body.subjectType !== 'Subject2' || range.dateType !== 'PermanentStorage' || !range.from) return jsonRes({ title: 'złe filtry' }, 400);
    const page = Number(url.searchParams.get('pageOffset') ?? 0);
    const size = Number(url.searchParams.get('pageSize') ?? 10);
    if (size < 10 || size > 250) return jsonRes({ title: 'zły rozmiar strony' }, 400);
    const from = Date.parse(range.from);
    const to = range.to ? Date.parse(range.to) : Number.POSITIVE_INFINITY;
    const hwm = this.hwm ? Date.parse(this.hwm) : Number.POSITIVE_INFINITY;
    const upper = Math.min(to, hwm);
    const all = this.invoices
      .filter((i) => { const t = Date.parse(i.permanentStorageDate); return t >= from && t <= upper; })
      .sort((a, b) => Date.parse(a.permanentStorageDate) - Date.parse(b.permanentStorageDate));
    const slice = all.slice(page * size, (page + 1) * size);
    return jsonRes({
      hasMore: (page + 1) * size < all.length, isTruncated: false,
      permanentStorageHwmDate: range.to && to < hwm ? range.to : this.hwm, invoices: slice,
    });
  }
}
