// ============================================================================
// ksef-connect: właściciel wkleja token KSeF → sprawdzamy go NA ŻYWO w KSeF → zapisujemy zaszyfrowany.
// ============================================================================
// Przepływ:
//   1. kto pyta?        — JWT → użytkownik, który MUSI być właścicielem firmy (token = klucz do faktur)
//   2. dane wejściowe   — token (bez spacji), środowisko (domyślnie prod), NIP firmy, od kiedy pobierać faktury
//   3. próba logowania  — challenge → szyfrowanie → ksef-token → status → redeem (prawdziwy KSeF)
//   4. próba odczytu    — jedno zapytanie o listę faktur: dowodzi, że token MA uprawnienie do przeglądania
//   5. zapis            — AES-256-GCM (klucz tylko w sekretach funkcji) → save_ksef_connection
//   6. pierwsza synchronizacja startuje w tle; aplikacja pokazuje postęp z get_ksef_status
// Token nie trafia do logów ani do odpowiedzi — nigdy.

import { HttpError, UUID_RE, bearerToken, errorResponse, json, preflight, readJsonBody } from '../_shared/http.ts';
import { isValidNip, normalizeNip } from '../_shared/validate.ts';
import type { KsefApi } from '../_shared/ksef/sync.ts';
import { KsefError, isKsefEnvironment, type KsefEnvironment } from '../_shared/ksef/types.ts';

export interface ConnectDeps {
  auth: { getUserId(token: string): Promise<string | null> };
  db: {
    getTenant(id: string): Promise<{ id: string; nip: string | null } | null>;
    isOwner(tenantId: string, userId: string): Promise<boolean>;
    saveConnection(a: { tenantId: string; userId: string; environment: KsefEnvironment; nip: string; ciphertext: string; hint: string; importFrom: string | null }): Promise<void>;
  };
  sealToken(plain: string, tenantId: string): Promise<string>;
  makeApi(environment: KsefEnvironment): KsefApi;
  /** zajmuje miejsce na pierwszą synchronizację i uruchamia ją w tle; zwraca false, gdy nie wystartowała */
  startFirstSync(tenantId: string): Promise<boolean>;
  now(): number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

const TOKEN_RE = /^[\x21-\x7e]{20,2000}$/;          // widoczne znaki ASCII, bez spacji — tak wyglądają tokeny KSeF
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Błąd rozmowy z KSeF → odpowiedź HTTP z czytelnym komunikatem. */
export function toHttpError(e: unknown): HttpError {
  if (!(e instanceof KsefError)) return new HttpError(500, 'internal', 'Wystąpił błąd serwera. Spróbuj ponownie za chwilę.');
  switch (e.code) {
    case 'token_rejected': return new HttpError(400, 'token_rejected', e.message);
    case 'no_permission': return new HttpError(400, 'no_permission', e.message);
    case 'invalid_input': return new HttpError(400, 'bad_request', e.message);
    case 'rate_limited': return new HttpError(429, 'ksef_rate_limited', 'KSeF chwilowo ogranicza liczbę zapytań. Spróbuj ponownie za kilka minut.');
    default: return new HttpError(503, 'ksef_unavailable', 'KSeF chwilowo nie odpowiada. Spróbuj ponownie za kilka minut.');
  }
}

export function resolveImportFrom(value: unknown, nowMs: number): string | null {
  if (value === undefined || value === null || value === '') return new Date(nowMs - 30 * 86_400_000).toISOString().slice(0, 10);
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, 'bad_request', 'Data początkowa pobierania faktur jest niepoprawna.');
  }
  const t = Date.parse(`${value}T00:00:00Z`);
  if (t > nowMs + 86_400_000) throw new HttpError(400, 'bad_request', 'Data początkowa nie może być z przyszłości.');
  if (t < nowMs - 5 * 365 * 86_400_000) throw new HttpError(400, 'bad_request', 'Data początkowa jest zbyt odległa (maksymalnie 5 lat wstecz).');
  return value;
}

export async function handleKsefConnect(req: Request, deps: ConnectDeps): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method', 'Użyj metody POST.');
    const bearer = bearerToken(req);
    const userId = bearer ? await deps.auth.getUserId(bearer) : null;
    if (!userId) throw new HttpError(401, 'unauthorized', 'Zaloguj się ponownie.');

    const body = await readJsonBody(req);
    const tenantId = String(body.tenant_id ?? '');
    if (!UUID_RE.test(tenantId)) throw new HttpError(400, 'bad_request', 'Brak poprawnego identyfikatora firmy.');
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!TOKEN_RE.test(token)) throw new HttpError(400, 'bad_token_format', 'Token KSeF wygląda niepoprawnie. Skopiuj go w całości z Aplikacji Podatnika KSeF (bez spacji i końców wierszy).');
    const environment = body.environment === undefined ? 'prod' : body.environment;
    if (!isKsefEnvironment(environment)) throw new HttpError(400, 'bad_request', 'Nieznane środowisko KSeF.');
    const importFrom = resolveImportFrom(body.import_from, deps.now());

    const tenant = await deps.db.getTenant(tenantId);
    if (!tenant) throw new HttpError(404, 'not_found', 'Nie znaleziono firmy.');
    if (!(await deps.db.isOwner(tenantId, userId))) throw new HttpError(403, 'forbidden', 'Połączenie z KSeF konfiguruje właściciel firmy.');

    const nip = normalizeNip(tenant.nip ?? (typeof body.nip === 'string' ? body.nip : ''));
    if (!isValidNip(nip)) throw new HttpError(400, 'nip_required', 'Podaj poprawny NIP firmy (w Ustawieniach firmy) — KSeF loguje się w kontekście NIP-u.');

    // próba logowania + próba odczytu listy (dowód uprawnienia „przeglądanie faktur")
    const api = deps.makeApi(environment);
    try {
      const session = await api.authenticate(token, nip);
      await api.queryMetadata(session, { from: new Date(deps.now() - 86_400_000).toISOString() }, 0, 10);
    } catch (e) {
      deps.log?.('ksef-connect refused', { tenantId, code: e instanceof KsefError ? e.code : 'internal', status: e instanceof KsefError ? e.status : undefined, detail: e instanceof KsefError ? e.detail?.slice(0, 200) : undefined });
      throw toHttpError(e);
    }

    const ciphertext = await deps.sealToken(token, tenantId);
    await deps.db.saveConnection({ tenantId, userId, environment, nip, ciphertext, hint: token.slice(-4), importFrom });
    deps.log?.('ksef-connect ok', { tenantId, environment });

    let sync = false;
    try {
      sync = await deps.startFirstSync(tenantId);
    } catch (e) {
      deps.log?.('ksef-connect first sync not started', { tenantId, error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
    return json({ ok: true, status: 'connected', sync: sync ? 'started' : 'pending' });
  } catch (e) {
    return errorResponse(e);
  }
}
