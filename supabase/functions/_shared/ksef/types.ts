// Wspólne typy i stałe integracji z KSeF 2.0 (źródło prawdy: oficjalny OpenAPI Ministerstwa Finansów,
// https://api-test.ksef.mf.gov.pl/docs/v2/ oraz repozytorium https://github.com/CIRFMF/ksef-docs).

export type KsefEnvironment = 'test' | 'demo' | 'prod';

/** Adresy API. TEST = dane testowe (można wymyślać NIP-y), DEMO = przedprodukcja, PROD = prawdziwe faktury. */
export const KSEF_BASE_URL: Record<KsefEnvironment, string> = {
  test: 'https://api-test.ksef.mf.gov.pl/v2',
  demo: 'https://api-demo.ksef.mf.gov.pl/v2',
  prod: 'https://api.ksef.mf.gov.pl/v2',
};

export const isKsefEnvironment = (v: unknown): v is KsefEnvironment => v === 'test' || v === 'demo' || v === 'prod';

/** 35 znaków: NIP sprzedawcy - data przyjęcia - 12 znaków HEX - suma kontrolna CRC-8. */
export const KSEF_NUMBER_RE = /^[0-9]{10}-[0-9]{8}-[0-9A-F]{12}-[0-9A-F]{2}$/;

/** Suma kontrolna CRC-8 numeru KSeF (wielomian 0x07, wartość początkowa 0x00) — opis w docs KSeF „numer-ksef.md". */
export function isValidKsefNumber(value: string): boolean {
  if (!KSEF_NUMBER_RE.test(value)) return false;
  const data = value.slice(0, 32);
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i);
    for (let b = 0; b < 8; b++) crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc.toString(16).toUpperCase().padStart(2, '0') === value.slice(33);
}

/** Rekord z POST /invoices/query/metadata (pola, których używamy; reszta jest ignorowana). */
export interface KsefInvoiceMeta {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;                 // RRRR-MM-DD
  permanentStorageDate: string;      // ISO date-time — według niej sortujemy i wyznaczamy kursor
  seller: { nip: string; name?: string | null };
  buyer?: { identifier?: { type?: string; value?: string | null }; name?: string | null };
  netAmount: number;
  grossAmount: number;
  vatAmount: number;
  currency: string;
  invoiceType: string;               // Vat, Zal, Kor, Roz, Upr, KorZal, KorRoz, VatPef, VatPefSp, KorPef, VatRr, KorVatRr
  formCode?: { systemCode?: string; schemaVersion?: string; value?: string };
  hasAttachment?: boolean;
}

export interface KsefMetadataPage {
  hasMore: boolean;
  isTruncated: boolean;
  /** Punkt, do którego KSeF gwarantuje kompletność danych (High Water Mark). Stały dla wszystkich stron zapytania. */
  permanentStorageHwmDate: string | null;
  invoices: KsefInvoiceMeta[];
}

export interface KsefSession {
  accessToken: string;
  validUntil: string;
}

export type KsefErrorCode =
  | 'token_rejected'      // KSeF odrzucił token (zły, unieważniony, nie ten NIP)
  | 'no_permission'       // token nie ma uprawnienia do przeglądania faktur
  | 'rate_limited'        // 429
  | 'unavailable'         // 5xx, brak sieci, przekroczony czas
  | 'bad_response'        // odpowiedź niezgodna z oczekiwaniami (zmiana API?)
  | 'rejected'            // inne odrzucenie żądania (4xx)
  | 'invalid_input';      // błąd po naszej stronie (np. zły numer KSeF)

/** Błąd rozmowy z KSeF. `message` jest po polsku i nadaje się do pokazania użytkownikowi; `detail` tylko do logów. */
export class KsefError extends Error {
  code: KsefErrorCode;
  status?: number;
  retryAfterSec?: number;
  detail?: string;
  constructor(code: KsefErrorCode, message: string, extra: { status?: number; retryAfterSec?: number; detail?: string } = {}) {
    super(message);
    this.name = 'KsefError';
    this.code = code;
    this.status = extra.status;
    this.retryAfterSec = extra.retryAfterSec;
    this.detail = extra.detail;
  }
  /** Błędy, po których token jest do wymiany — automatyczne pobieranie wstrzymujemy do ponownego połączenia. */
  get isAuthFailure(): boolean {
    return this.code === 'token_rejected' || this.code === 'no_permission';
  }
}
