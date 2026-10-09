// ============================================================================
// Synchronizacja faktur zakupu z KSeF dla jednej firmy.
// ============================================================================
// Przebieg (każdy krok ma swój powód):
//   1. claim      — baza przyznaje „miejsce" (jedna synchronizacja naraz, odstępy między próbami)
//   2. token      — odszyfrowanie zapisanego tokenu, logowanie do KSeF
//   3. lista      — metadane faktur od kursora (data trwałego zapisu, rosnąco), okna po maks. 90 dni
//                   (limit KSeF to 100 dni), strona po stronie
//   4. dla każdej nowej faktury: pobierz XML → parser FA → import_ksef_invoice (jedna transakcja w bazie)
//   5. finish     — zapis wyniku i NOWEGO KURSORA
//
// Kursor = „do tego momentu mamy wszystko". Zasady, które chronią przed gubieniem faktur:
//   * normalnie kursor = High Water Mark z KSeF (dane poniżej niego są kompletne i się nie zmienią),
//   * przy przerwaniu (limit czasu, 429, awaria) kursor = data ostatniej w pełni przetworzonej faktury,
//   * jeśli jakiejś faktury nie dało się zapisać, kursor nie przekracza jej daty — kolejna próba ją znajdzie,
//   * powtórne zobaczenie tej samej faktury jest nieszkodliwe (dedup po numerze KSeF w bazie).
// Logi nie zawierają treści faktur ani tokenu — wyłącznie identyfikatory, kody i liczby.
// ============================================================================

import { sha256Hex } from './crypto.ts';
import { headerOnlyPayload, parseKsefInvoice, type KsefInvoicePayload } from './fa-parser.ts';
import { VaultError } from './token-vault.ts';
import { KsefError, type KsefEnvironment, type KsefInvoiceMeta, type KsefMetadataPage, type KsefSession } from './types.ts';

export interface KsefApi {
  authenticate(token: string, nip: string): Promise<KsefSession>;
  queryMetadata(session: KsefSession, range: { from: string; to?: string }, page: number, pageSize?: number): Promise<KsefMetadataPage>;
  downloadInvoice(session: KsefSession, ksefNumber: string): Promise<string>;
}

export type SyncTrigger = 'connect' | 'manual' | 'auto';

export interface ClaimOk {
  claimed: true;
  run_id: number;
  environment: KsefEnvironment;
  nip: string;
  token_ciphertext: string;
  cursor_at: string | null;
  import_from: string | null;
}
export type ClaimRefusal = 'not_connected' | 'needs_reconnect' | 'already_running' | 'too_soon';
export type ClaimResult = ClaimOk | { claimed: false; reason: ClaimRefusal };

export interface FinishArgs {
  runId: number;
  status: 'ok' | 'partial' | 'error';
  listed: number;
  imported: number;
  linked: number;
  skipped: number;
  failed: number;
  error: string | null;
  cursor: string | null;
  authFailed: boolean;
  retryAfterSec: number | null;
}

export interface SyncLimits {
  pageSize: number;
  maxInvoicesPerRun: number;
  timeBudgetMs: number;
  downloadGapMs: number;
  windowDays: number;
  defaultLookbackDays: number;
}

export const DEFAULT_SYNC_LIMITS: SyncLimits = {
  pageSize: 100,
  maxInvoicesPerRun: 300,
  timeBudgetMs: 100_000,
  // Oficjalny limit KSeF (produkcja): pobranie faktury po numerze to 8/s, 16/min i 64/h na parę NIP + adres IP.
  // 4 s odstępu = 15 pobrań na minutę — nie dotykamy limitu minutowego (każde 429 jest rejestrowane przez MF).
  // Limit godzinowy (64) zostaje: większa zaległość schodzi w kilka godzin (patrz docs/10_KSEF.md).
  downloadGapMs: 4000,
  windowDays: 90,
  defaultLookbackDays: 30,
};

export interface SyncDeps {
  db: {
    claim(tenantId: string, trigger: SyncTrigger): Promise<ClaimResult>;
    knownNumbers(tenantId: string, numbers: string[]): Promise<string[]>;
    importInvoice(tenantId: string, ksefNumber: string, payload: KsefInvoicePayload, xml: string | null, sha256: string | null): Promise<{ status: 'created' | 'linked' | 'exists'; document_id: string }>;
    finish(args: FinishArgs): Promise<void>;
  };
  openToken(ciphertext: string, tenantId: string): Promise<string>;
  makeApi(environment: KsefEnvironment): KsefApi;
  now(): number;
  sleep(ms: number): Promise<void>;
  limits?: Partial<SyncLimits>;
  log?(message: string, extra?: Record<string, unknown>): void;
}

export interface SyncSummary {
  status: 'ok' | 'partial' | 'error';
  listed: number;
  imported: number;
  linked: number;
  skipped: number;
  failed: number;
  error: string | null;
  cursor: string | null;
}

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

class Stop extends Error {
  reason: 'budget' | 'transient' | 'auth';
  constructor(reason: Stop['reason'], message: string) {
    super(message);
    this.reason = reason;
  }
}

export async function claimSync(deps: SyncDeps, tenantId: string, trigger: SyncTrigger): Promise<ClaimResult> {
  return deps.db.claim(tenantId, trigger);
}

export async function executeSync(deps: SyncDeps, tenantId: string, claim: ClaimOk): Promise<SyncSummary> {
  const limits: SyncLimits = { ...DEFAULT_SYNC_LIMITS, ...deps.limits };
  const started = deps.now();
  const stats = { listed: 0, imported: 0, linked: 0, skipped: 0, failed: 0 };
  const failedNumbers: string[] = [];

  // Stan przebiegu (w obiekcie, bo zmieniają go funkcje zagnieżdżone):
  const st = {
    cursorCandidate: null as number | null,      // dokąd mamy komplet (ms)
    lastDone: null as number | null,             // data ostatniej w pełni przetworzonej faktury (ms)
    hold: null as number | null,                 // najwcześniejsza data faktury, której nie udało się zapisać
  };
  let stop: Stop | null = null;
  let fatal: unknown = null;

  try {
    let token: string;
    try {
      token = await deps.openToken(claim.token_ciphertext, tenantId);
    } catch (e) {
      // zły/brakujący klucz w konfiguracji serwera to NASZ problem (nie wstrzymujemy połączenia klienta);
      // uszkodzony lub niepasujący szyfrogram wymaga ponownego wklejenia tokenu
      if (e instanceof VaultError && e.code === 'bad_key') {
        throw new KsefError('unavailable', 'Szyfrowanie tokenów KSeF nie jest poprawnie skonfigurowane na serwerze (KSEF_TOKEN_KEY). Skontaktuj się z administratorem.');
      }
      throw new KsefError('token_rejected', 'Nie można odczytać zapisanego tokenu KSeF — połącz KSeF ponownie.');
    }
    const api = deps.makeApi(claim.environment);
    let session = await api.authenticate(token, claim.nip);
    let reauths = 0;

    // Token dostępu żyje kilkanaście minut; gdyby wygasł w trakcie, logujemy się raz jeszcze.
    // Jeśli KSeF odrzuca także ŚWIEŻO wydany token dostępu, to jego usterka, a nie wina tokenu klienta:
    // nie wstrzymujemy połączenia i nie alarmujemy właściciela — spróbujemy ponownie.
    const is401 = (e: unknown) => e instanceof KsefError && e.code === 'token_rejected' && e.status === 401;
    const freshTokenRejected = (e: KsefError) =>
      new KsefError('unavailable', 'KSeF odrzucił świeżo wydany token dostępu. Spróbujemy ponownie za chwilę.', { status: 401, detail: e.detail });
    const withSession = async <T>(fn: (s: KsefSession) => Promise<T>): Promise<T> => {
      try {
        return await fn(session);
      } catch (e) {
        if (!is401(e)) throw e;
        if (reauths >= 1) throw freshTokenRejected(e as KsefError);
        reauths++;
        session = await api.authenticate(token, claim.nip);
        try {
          return await fn(session);
        } catch (e2) {
          throw is401(e2) ? freshTokenRejected(e2 as KsefError) : e2;
        }
      }
    };

    const importOne = async (inv: KsefInvoiceMeta): Promise<'imported' | 'linked' | 'skipped'> => {
      const xml = await withSession((s) => api.downloadInvoice(s, inv.ksefNumber));
      const today = new Date(deps.now());
      const parsed = parseKsefInvoice(xml, today);
      const payload = parsed.ok ? parsed.payload : headerOnlyPayload(inv, parsed.message, today);
      const hash = await sha256Hex(xml);
      let res;
      try {
        res = await deps.db.importInvoice(tenantId, inv.ksefNumber, payload, xml, hash);
      } catch (e) {
        if (!parsed.ok) throw e;
        // pozycje nie weszły do bazy (np. nietypowa wartość) → zapisujemy chociaż nagłówek, człowiek dopisze resztę
        deps.log?.('ksef import fallback', { tenantId, ksefNumber: inv.ksefNumber, error: e instanceof Error ? e.message : String(e) });
        res = await deps.db.importInvoice(tenantId, inv.ksefNumber, headerOnlyPayload(inv, 'Nie udało się zapisać pozycji tej faktury — wpisz je ręcznie.', today), xml, hash);
      }
      return res.status === 'created' ? 'imported' : res.status === 'linked' ? 'linked' : 'skipped';
    };

    const processBatch = async (invoices: KsefInvoiceMeta[]) => {
      if (invoices.length === 0) return;
      const known = new Set(await deps.db.knownNumbers(tenantId, invoices.map((i) => i.ksefNumber)));
      for (const inv of invoices) {
        const date = Date.parse(inv.permanentStorageDate);
        if (known.has(inv.ksefNumber)) {
          stats.skipped++;
          st.lastDone = date;
          continue;
        }
        if (deps.now() - started > limits.timeBudgetMs || stats.imported + stats.linked + stats.failed >= limits.maxInvoicesPerRun) {
          throw new Stop('budget', 'Pobieranie przerwano po przekroczeniu limitu czasu — dokończymy przy następnej synchronizacji.');
        }
        try {
          stats[await importOne(inv)]++;
          st.lastDone = date;
        } catch (e) {
          if (e instanceof KsefError && (e.code === 'rate_limited' || e.code === 'unavailable')) throw e;
          if (e instanceof KsefError && e.isAuthFailure) throw e;
          stats.failed++;
          failedNumbers.push(inv.ksefNumber);
          st.hold = st.hold === null ? date : Math.min(st.hold, date);
          deps.log?.('ksef invoice failed', { tenantId, ksefNumber: inv.ksefNumber, code: e instanceof KsefError ? e.code : 'internal', detail: e instanceof Error ? e.message.slice(0, 200) : '' });
        }
        await deps.sleep(limits.downloadGapMs);
      }
    };

    // --- okna czasowe (KSeF: maks. 100 dni na zapytanie) ----------------------------------
    const nowMs = deps.now();
    let from = claim.cursor_at
      ? Date.parse(claim.cursor_at)
      : claim.import_from ? Date.parse(`${claim.import_from}T00:00:00Z`) : nowMs - limits.defaultLookbackDays * DAY_MS;
    if (!Number.isFinite(from)) from = nowMs - limits.defaultLookbackDays * DAY_MS;
    from = Math.min(Math.max(from, nowMs - 5 * 365 * DAY_MS), nowMs - 1000);

    for (let windows = 0; windows < 40; windows++) {
      const maxTo = from + limits.windowDays * DAY_MS;
      const last = maxTo >= deps.now() - 60_000;
      let rangeFrom = from;
      let page = 0;
      let windowHwm: string | null = null;
      let seenInWindow = 0;

      for (let guard = 0; guard < 2000; guard++) {
        const res = await withSession((s) => api.queryMetadata(s, { from: iso(rangeFrom), ...(last ? {} : { to: iso(maxTo) }) }, page, limits.pageSize));
        if (res.permanentStorageHwmDate) windowHwm = res.permanentStorageHwmDate;
        stats.listed += res.invoices.length;
        seenInWindow += res.invoices.length;
        await processBatch(res.invoices);
        if (!res.hasMore || res.invoices.length === 0) break;
        if (res.isTruncated) {
          // limit 10 000 rekordów na zestaw filtrów: zawężamy okno od daty ostatniego rekordu i zaczynamy od strony 0
          rangeFrom = Date.parse(res.invoices[res.invoices.length - 1].permanentStorageDate);
          page = 0;
        } else {
          page++;
        }
      }

      if (last) {
        st.cursorCandidate = windowHwm ? Date.parse(windowHwm) : st.lastDone;
        break;
      }
      st.cursorCandidate = windowHwm ? Math.max(Date.parse(windowHwm), maxTo) : maxTo;   // okno historyczne: HWM = górna granica okna
      from = st.cursorCandidate;
      deps.log?.('ksef window done', { tenantId, windows, seenInWindow });
    }
  } catch (e) {
    if (e instanceof Stop) stop = e;
    else fatal = e;
  }

  // --- wynik -----------------------------------------------------------------------------------
  let status: SyncSummary['status'] = 'ok';
  let error: string | null = null;
  let authFailed = false;
  let retryAfterSec: number | null = null;
  let cursor: number | null = st.cursorCandidate;

  if (stop) {
    status = 'partial';
    error = stop.message;
    cursor = st.lastDone;
  } else if (fatal) {
    const progressed = stats.imported + stats.linked + stats.skipped > 0;
    if (fatal instanceof KsefError) {
      error = fatal.message;
      authFailed = fatal.isAuthFailure;
      retryAfterSec = fatal.retryAfterSec ?? null;
      deps.log?.('ksef sync error', { tenantId, code: fatal.code, status: fatal.status, detail: fatal.detail?.slice(0, 200) });
    } else {
      error = 'Wystąpił nieoczekiwany błąd synchronizacji. Spróbujemy ponownie.';
      deps.log?.('ksef sync crash', { tenantId, error: fatal instanceof Error ? fatal.message.slice(0, 200) : String(fatal) });
    }
    status = progressed && !authFailed ? 'partial' : 'error';
    cursor = status === 'partial' ? st.lastDone : null;
  } else if (stats.failed > 0) {
    status = 'partial';
    error = `Nie udało się zapisać faktur: ${stats.failed} (np. ${failedNumbers.slice(0, 3).join(', ')}). Spróbujemy ponownie.`;
  }

  if (st.hold !== null && cursor !== null) cursor = Math.min(cursor, st.hold);

  const summary: SyncSummary = { status, ...stats, error, cursor: cursor === null ? null : iso(cursor) };
  try {
    await deps.db.finish({
      runId: claim.run_id, status, listed: stats.listed, imported: stats.imported, linked: stats.linked,
      skipped: stats.skipped, failed: stats.failed, error, cursor: summary.cursor, authFailed, retryAfterSec,
    });
  } catch (e) {
    deps.log?.('ksef finish failed', { tenantId, runId: claim.run_id, error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
  }
  deps.log?.('ksef sync done', { tenantId, status, ...stats, ms: deps.now() - started });
  return summary;
}

/**
 * Wołane z harmonogramu (co minutę): znajduje firmy, którym należy się synchronizacja, zajmuje dla nich miejsce
 * (szybko, po kolei) i uruchamia pracę w tle równolegle — odpowiedź harmonogramu nie czeka na KSeF.
 */
export async function startDueSyncs(
  deps: SyncDeps & { db: SyncDeps['db'] & { dueTenants(limit: number): Promise<string[]> } },
  waitUntil: (p: Promise<unknown>) => void,
  limit = 3
): Promise<{ started: number; skipped: number }> {
  const due = await deps.db.dueTenants(limit);
  let started = 0;
  let skipped = 0;
  for (const tenantId of due) {
    const claim = await claimSync(deps, tenantId, 'auto');
    if (!claim.claimed) { skipped++; continue; }
    started++;
    waitUntil(executeSync(deps, tenantId, claim));
  }
  return { started, skipped };
}
