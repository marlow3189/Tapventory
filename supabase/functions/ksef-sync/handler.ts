// ============================================================================
// ksef-sync: ręczne „Synchronizuj teraz" (kierownictwo). Automat działa z harmonogramu (cron-tasks).
// ============================================================================
// Miejsce na synchronizację zajmujemy OD RAZU (baza pilnuje: jedna naraz, nie częściej niż co 2 minuty),
// a samą pracę z KSeF wykonujemy w tle — telefon dostaje odpowiedź 202 i pokazuje postęp z get_ksef_status.

import { HttpError, UUID_RE, bearerToken, errorResponse, json, preflight, readJsonBody } from '../_shared/http.ts';
import { claimSync, executeSync, type ClaimRefusal, type SyncDeps } from '../_shared/ksef/sync.ts';

export interface KsefSyncDeps {
  auth: { getUserId(token: string): Promise<string | null> };
  db: { isManager(tenantId: string, userId: string): Promise<boolean> };
  sync: SyncDeps;
  waitUntil(p: Promise<unknown>): void;
}

const REFUSALS: Record<Exclude<ClaimRefusal, 'already_running'>, { status: number; message: string }> = {
  not_connected: { status: 409, message: 'KSeF nie jest połączony. Połącz go w Ustawieniach.' },
  needs_reconnect: { status: 409, message: 'Połączenie z KSeF wymaga odnowienia — wklej nowy token w Ustawieniach → KSeF.' },
  too_soon: { status: 429, message: 'Synchronizację uruchomiono przed chwilą. Spróbuj za kilka minut.' },
};

export async function handleKsefSync(req: Request, deps: KsefSyncDeps): Promise<Response> {
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
    if (!(await deps.db.isManager(tenantId, userId))) throw new HttpError(403, 'forbidden', 'Synchronizację KSeF uruchamia kierownictwo firmy.');

    const claim = await claimSync(deps.sync, tenantId, 'manual');
    if (!claim.claimed) {
      if (claim.reason === 'already_running') return json({ ok: true, status: 'running' }, 202);
      const r = REFUSALS[claim.reason];
      throw new HttpError(r.status, claim.reason, r.message);
    }
    deps.waitUntil(executeSync(deps.sync, tenantId, claim));
    return json({ ok: true, status: 'started' }, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
