// ============================================================================
// Klient API KSeF 2.0 — tylko to, czego potrzebujemy do ODBIORU faktur zakupu:
//   1. logowanie tokenem KSeF (challenge → szyfrowanie RSA-OAEP → ksef-token → status → redeem),
//   2. lista metadanych faktur (POST /invoices/query/metadata, podmiot 2 = nabywca),
//   3. pobranie XML faktury po numerze KSeF.
// Nie umiemy niczego wystawić ani wysłać — i dobrze: token ma uprawnienie wyłącznie do odczytu.
//
// Zasady dobrego obywatela (z oficjalnej dokumentacji limitów):
//   * 429 → czekamy Retry-After (do kilkunastu sekund), a gdy trzeba dłużej — oddajemy błąd
//     z informacją, kiedy wrócić; nie „młócimy" API.
//   * 5xx/sieć → dwie ponowne próby z rosnącą przerwą.
//   * Klucz publiczny do szyfrowania tokenu pobieramy raz na godzinę (certyfikaty rotują rzadko);
//     gdy KSeF odpowie błędem 21470 („nieznany klucz"), odświeżamy i próbujemy jeszcze raz.
// Wszystko wstrzykiwane (fetch, sleep, zegar) — dzięki temu test podstawia „fałszywy KSeF" i nie czeka.
// ============================================================================

import { encryptKsefToken, importKsefPublicKey } from './crypto.ts';
import {
  KSEF_BASE_URL, KSEF_NUMBER_RE, KsefError,
  type KsefEnvironment, type KsefInvoiceMeta, type KsefMetadataPage, type KsefSession,
} from './types.ts';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface KsefClientOptions {
  environment: KsefEnvironment;
  fetch: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
  /** Najdłuższe oczekiwanie na Retry-After, jakie zniesiemy w trakcie jednego żądania. */
  maxRateLimitWaitSec?: number;
  authPollIntervalMs?: number;
  authTimeoutMs?: number;
  userAgent?: string;
}

interface CallOptions {
  token?: string;
  body?: unknown;
  query?: Record<string, string | number>;
  accept?: string;
}

type CertCache = { key: CryptoKey; publicKeyId: string; fetchedAt: number } | null;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value.trim());
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

export class KsefClient {
  readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRateLimitWaitSec: number;
  private readonly authPollIntervalMs: number;
  private readonly authTimeoutMs: number;
  private readonly userAgent: string;
  private cert: CertCache = null;

  constructor(opts: KsefClientOptions) {
    this.baseUrl = KSEF_BASE_URL[opts.environment];
    this.fetchFn = opts.fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.maxRateLimitWaitSec = opts.maxRateLimitWaitSec ?? 20;
    this.authPollIntervalMs = opts.authPollIntervalMs ?? 1500;
    this.authTimeoutMs = opts.authTimeoutMs ?? 45_000;
    this.userAgent = opts.userAgent ?? 'Tapventory/1.0 (+https://tapventory.com)';
  }

  // --- warstwa HTTP ------------------------------------------------------------

  private async call(method: 'GET' | 'POST', path: string, opts: CallOptions = {}): Promise<{ json: unknown; text: string }> {
    const qs = opts.query ? '?' + Object.entries(opts.query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
    const url = `${this.baseUrl}${path}${qs}`;
    const headers: Record<string, string> = {
      Accept: opts.accept ?? 'application/json',
      'X-Error-Format': 'problem-details',
      'User-Agent': this.userAgent,
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    let attempt = 0;
    let rateWaits = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method, headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        if (attempt < this.maxRetries) {
          attempt++;
          await this.sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        throw new KsefError('unavailable', 'KSeF nie odpowiada. Spróbujemy ponownie za kilka minut.', { detail: e instanceof Error ? e.message : String(e) });
      }

      if (res.status === 429) {
        const wait = parseRetryAfter(res.headers.get('retry-after')) ?? 30;
        await res.body?.cancel().catch(() => {});
        if (wait <= this.maxRateLimitWaitSec && rateWaits < 3) {
          rateWaits++;
          await this.sleep(wait * 1000);
          continue;
        }
        throw new KsefError('rate_limited', 'KSeF chwilowo ogranicza liczbę zapytań. Spróbujemy ponownie automatycznie.', { status: 429, retryAfterSec: wait });
      }

      if (res.status >= 500) {
        const body = await safeText(res);
        if (attempt < this.maxRetries) {
          attempt++;
          await this.sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        throw new KsefError('unavailable', 'KSeF chwilowo nie działa. Spróbujemy ponownie za kilka minut.', { status: res.status, detail: body.slice(0, 300) });
      }

      const text = await safeText(res);
      if (res.ok) {
        if (text.length > 6_000_000) throw new KsefError('bad_response', 'Odpowiedź KSeF jest nieoczekiwanie duża.', { status: res.status });
        let json: unknown = null;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('json') && text) {
          try { json = JSON.parse(text); } catch { throw new KsefError('bad_response', 'KSeF zwrócił niepoprawną odpowiedź.', { status: res.status, detail: text.slice(0, 200) }); }
        }
        return { json, text };
      }
      throw mapClientError(res.status, text);
    }
  }

  // --- klucz publiczny do szyfrowania tokenu --------------------------------------

  private async publicKey(force: boolean): Promise<NonNullable<CertCache>> {
    if (!force && this.cert && this.now() - this.cert.fetchedAt < 3_600_000) return this.cert;
    const { json } = await this.call('GET', '/security/public-key-certificates');
    if (!Array.isArray(json)) throw new KsefError('bad_response', 'KSeF zwrócił niepoprawną listę kluczy.');
    const t = this.now();
    const usable = (json as Record<string, unknown>[])
      .filter((c) => Array.isArray(c.usage) && (c.usage as unknown[]).includes('KsefTokenEncryption')
        && typeof c.certificate === 'string' && typeof c.publicKeyId === 'string'
        && Date.parse(String(c.validFrom)) <= t && t < Date.parse(String(c.validTo)))
      .sort((a, b) => Date.parse(String(b.validFrom)) - Date.parse(String(a.validFrom)));
    if (usable.length === 0) throw new KsefError('bad_response', 'KSeF nie udostępnił aktualnego klucza do szyfrowania tokenów.');
    try {
      this.cert = { key: await importKsefPublicKey(String(usable[0].certificate)), publicKeyId: String(usable[0].publicKeyId), fetchedAt: t };
    } catch (e) {
      throw new KsefError('bad_response', 'Nie udało się odczytać klucza publicznego KSeF.', { detail: e instanceof Error ? e.message : String(e) });
    }
    return this.cert;
  }

  // --- logowanie tokenem -------------------------------------------------------------

  async authenticate(token: string, nip: string): Promise<KsefSession> {
    if (!/^[0-9]{10}$/.test(nip)) throw new KsefError('invalid_input', 'NIP firmy jest nieprawidłowy.');
    if (!token || /\s/.test(token)) throw new KsefError('invalid_input', 'Token KSeF jest pusty lub zawiera spacje.');

    const submit = async (forceCert: boolean) => {
      const challenge = (await this.call('POST', '/auth/challenge')).json as { challenge?: string; timestampMs?: number } | null;
      if (!challenge || typeof challenge.challenge !== 'string' || typeof challenge.timestampMs !== 'number') {
        throw new KsefError('bad_response', 'KSeF zwrócił niepoprawne wyzwanie logowania.');
      }
      const cert = await this.publicKey(forceCert);
      const encryptedToken = await encryptKsefToken(token, challenge.timestampMs, cert.key);
      return (await this.call('POST', '/auth/ksef-token', {
        body: { challenge: challenge.challenge, contextIdentifier: { type: 'Nip', value: nip }, encryptedToken, publicKeyId: cert.publicKeyId },
      })).json as { referenceNumber?: string; authenticationToken?: { token?: string } } | null;
    };

    let init;
    try {
      init = await submit(false);
    } catch (e) {
      // 21470 = „identyfikator klucza nieznany lub wycofany" → pobierz certyfikaty od nowa i spróbuj raz jeszcze
      if (e instanceof KsefError && e.detail?.includes('21470')) init = await submit(true);
      else throw e;
    }
    const ref = init?.referenceNumber;
    const authToken = init?.authenticationToken?.token;
    if (typeof ref !== 'string' || typeof authToken !== 'string') throw new KsefError('bad_response', 'KSeF zwrócił niepoprawną odpowiedź logowania.');

    const deadline = this.now() + this.authTimeoutMs;
    for (;;) {
      const st = (await this.call('GET', `/auth/${encodeURIComponent(ref)}`, { token: authToken })).json as
        { status?: { code?: number; description?: string; details?: string[] } } | null;
      const code = st?.status?.code;
      if (code === 200) break;
      if (code === 100) {
        if (this.now() >= deadline) throw new KsefError('unavailable', 'KSeF zbyt długo potwierdza logowanie. Spróbuj ponownie.', { detail: 'timeout statusu uwierzytelniania' });
        await this.sleep(this.authPollIntervalMs);
        continue;
      }
      throw authFailure(code, st?.status?.description, st?.status?.details);
    }

    const redeemed = (await this.call('POST', '/auth/token/redeem', { token: authToken })).json as
      { accessToken?: { token?: string; validUntil?: string } } | null;
    const access = redeemed?.accessToken;
    if (!access || typeof access.token !== 'string') throw new KsefError('bad_response', 'KSeF nie wydał tokenu dostępu.');
    return { accessToken: access.token, validUntil: String(access.validUntil ?? '') };
  }

  // --- faktury ---------------------------------------------------------------------------

  /**
   * Strona metadanych faktur ZAKUPU (podmiot 2), rosnąco po dacie trwałego zapisu (PermanentStorage).
   * `restrictToPermanentStorageHwmDate` = pytamy tylko o to, co KSeF uznaje za kompletne (HWM) — dzięki temu
   * kolejne zapytanie „od ostatniego HWM" niczego nie pominie (scenariusz 1 z dokumentacji „hwm.md").
   * `page` to NUMER STRONY (0, 1, 2 …), nie przesunięcie rekordów.
   */
  async queryMetadata(session: KsefSession, range: { from: string; to?: string }, page: number, pageSize = 100): Promise<KsefMetadataPage> {
    const body = {
      subjectType: 'Subject2',
      dateRange: {
        dateType: 'PermanentStorage',
        from: range.from,
        ...(range.to ? { to: range.to } : {}),
        restrictToPermanentStorageHwmDate: true,
      },
    };
    const { json } = await this.call('POST', '/invoices/query/metadata', {
      token: session.accessToken, body, query: { sortOrder: 'Asc', pageOffset: page, pageSize: Math.min(250, Math.max(10, pageSize)) },
    });
    return normalizeMetadataPage(json);
  }

  /** XML faktury (FA) o podanym numerze KSeF. */
  async downloadInvoice(session: KsefSession, ksefNumber: string): Promise<string> {
    if (!KSEF_NUMBER_RE.test(ksefNumber)) throw new KsefError('invalid_input', 'Nieprawidłowy numer KSeF.');
    const { text } = await this.call('GET', `/invoices/ksef/${ksefNumber}`, { token: session.accessToken, accept: 'application/xml' });
    if (!text.trim()) throw new KsefError('bad_response', 'KSeF zwrócił pustą fakturę.');
    return text;
  }
}

// --- pomocnicze ----------------------------------------------------------------------------

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** Błędy 4xx → czytelne komunikaty. Szczegóły techniczne zostają w `detail` (tylko do logów). */
export function mapClientError(status: number, body: string): KsefError {
  const detail = body.slice(0, 400);
  if (status === 401) return new KsefError('token_rejected', 'KSeF odrzucił dostęp — token mógł wygasnąć lub zostać unieważniony. Wygeneruj nowy token i połącz ponownie.', { status, detail });
  if (status === 403) return new KsefError('no_permission', 'Token nie ma uprawnienia do przeglądania faktur. Wygeneruj nowy token z uprawnieniem „Przeglądanie faktur”.', { status, detail });
  if (status === 404) return new KsefError('rejected', 'KSeF nie znalazł żądanego zasobu.', { status, detail });
  return new KsefError('rejected', 'KSeF odrzucił zapytanie.', { status, detail });
}

/** Status 4xx/5xx z operacji uwierzytelniania (kody z dokumentacji OpenAPI: 415, 425, 450, 460, 470, 480, 500, 550). */
export function authFailure(code: number | undefined, description?: string, details?: string[]): KsefError {
  const text = [description, ...(details ?? [])].filter(Boolean).join(' | ');
  const has = (re: RegExp) => re.test(text);
  const extra = { detail: `kod ${code ?? '?'}: ${text}`.slice(0, 400) };
  switch (code) {
    case 415:
      return new KsefError('no_permission', 'Token nie ma żadnych uprawnień. Wygeneruj nowy token z uprawnieniem „Przeglądanie faktur”.', extra);
    case 425:
      return new KsefError('token_rejected', 'Token został unieważniony w KSeF. Wygeneruj nowy token i połącz ponownie.', extra);
    case 450:
      if (has(/kontek/i)) return new KsefError('token_rejected', 'Ten token należy do innej firmy. Sprawdź, czy NIP w Tapventory zgadza się z NIP-em, dla którego wygenerowano token.', extra);
      if (has(/unieważnion/i)) return new KsefError('token_rejected', 'Token został unieważniony w KSeF. Wygeneruj nowy token i połącz ponownie.', extra);
      if (has(/nieaktywn/i)) return new KsefError('token_rejected', 'Token jest nieaktywny (jeszcze się nie aktywował albo wygasł). Wygeneruj nowy token.', extra);
      if (has(/czas tokena|wyzwanie/i)) return new KsefError('unavailable', 'Chwilowy błąd logowania do KSeF. Spróbuj ponownie za chwilę.', extra);
      if (has(/szyfrowani/i)) return new KsefError('bad_response', 'KSeF nie przyjął zaszyfrowanego tokenu — to błąd po naszej stronie, zgłoś go nam.', extra);
      return new KsefError('token_rejected', 'KSeF nie rozpoznał tokenu. Skopiuj go ponownie w całości (bez spacji na końcach).', extra);
    case 460:
    case 470:
    case 480:
      return new KsefError('token_rejected', 'KSeF zablokował to uwierzytelnienie. Skontaktuj się z pomocą KSeF (ksef.podatki.gov.pl).', extra);
    case 500:
    case 550:
      return new KsefError('unavailable', 'KSeF przerwał logowanie z przyczyn wewnętrznych. Spróbujemy ponownie.', extra);
    default:
      return new KsefError('rejected', 'KSeF odrzucił logowanie.', extra);
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Sprawdza kształt odpowiedzi; pojedyncze wadliwe rekordy pomija, a przy złym szkielecie zgłasza błąd. */
export function normalizeMetadataPage(json: unknown): KsefMetadataPage {
  if (!isObj(json) || !Array.isArray(json.invoices) || typeof json.hasMore !== 'boolean' || typeof json.isTruncated !== 'boolean') {
    throw new KsefError('bad_response', 'KSeF zwrócił niepoprawną listę faktur.');
  }
  const invoices: KsefInvoiceMeta[] = [];
  for (const raw of json.invoices) {
    if (!isObj(raw) || typeof raw.ksefNumber !== 'string' || !KSEF_NUMBER_RE.test(raw.ksefNumber)) continue;
    if (typeof raw.permanentStorageDate !== 'string' || Number.isNaN(Date.parse(raw.permanentStorageDate))) continue;
    const seller = isObj(raw.seller) ? raw.seller : {};
    invoices.push({
      ksefNumber: raw.ksefNumber,
      invoiceNumber: String(raw.invoiceNumber ?? ''),
      issueDate: String(raw.issueDate ?? ''),
      permanentStorageDate: raw.permanentStorageDate,
      seller: { nip: String(seller.nip ?? ''), name: typeof seller.name === 'string' ? seller.name : null },
      buyer: isObj(raw.buyer) ? (raw.buyer as KsefInvoiceMeta['buyer']) : undefined,
      netAmount: Number(raw.netAmount ?? 0),
      grossAmount: Number(raw.grossAmount ?? 0),
      vatAmount: Number(raw.vatAmount ?? 0),
      currency: String(raw.currency ?? 'PLN'),
      invoiceType: String(raw.invoiceType ?? ''),
      formCode: isObj(raw.formCode) ? (raw.formCode as KsefInvoiceMeta['formCode']) : undefined,
      hasAttachment: raw.hasAttachment === true,
    });
  }
  return {
    hasMore: json.hasMore,
    isTruncated: json.isTruncated,
    permanentStorageHwmDate: typeof json.permanentStorageHwmDate === 'string' ? json.permanentStorageHwmDate : null,
    invoices,
  };
}
