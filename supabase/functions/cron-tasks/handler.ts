// Zadania cykliczne (harmonogram co minutę): strażnik wiszących faktur, przypomnienia o mini-spisie, wysyłka push.
// Jeden adres zamiast trzech harmonogramów — prościej dla juniora (jeden wpis w panelu Supabase → Cron).

import { errorResponse, json, preflight } from '../_shared/http.ts';
import { requireCronSecret, sendPendingPushes, type PushDeps } from '../send-push/handler.ts';

export interface CronDeps {
  push: PushDeps;
  db: { rpc(name: 'reap_stuck_documents' | 'queue_count_reminders'): Promise<unknown> };
  now: () => Date;
}

export async function runCronTasks(deps: CronDeps) {
  const result: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      result[name] = await fn();
    } catch (e) {
      result[name] = { error: e instanceof Error ? e.message : String(e) };   // jedno zadanie nie blokuje pozostałych
    }
  };
  await step('reaped_documents', () => deps.db.rpc('reap_stuck_documents'));
  // przypomnienia o spisie tylko raz dziennie w godzinach pracy (czas UTC; w PL to ok. 8–9 rano)
  const h = deps.now().getUTCHours();
  if (h === 6 || h === 7) await step('count_reminders', () => deps.db.rpc('queue_count_reminders'));
  await step('push', () => sendPendingPushes(deps.push));
  return result;
}

export async function handleCron(req: Request, deps: CronDeps, secret: string | undefined): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    requireCronSecret(req, secret);
    return json({ ok: true, ...(await runCronTasks(deps)) });
  } catch (e) {
    return errorResponse(e);
  }
}
