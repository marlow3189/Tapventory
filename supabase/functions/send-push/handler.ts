// Wysyłka powiadomień push (Expo Push API) dla wpisów z tabeli notifications.
// Wywołuje ją harmonogram (co minutę) albo webhook bazy po dodaniu powiadomienia. Zabezpieczenie: sekret w nagłówku.
// Dokumentacja Expo: https://docs.expo.dev/push-notifications/sending-notifications/

import { HttpError, errorResponse, json, preflight } from '../_shared/http.ts';

export type NotificationRow = { id: string; user_id: string; kind: string; title: string; body: string | null; data: Record<string, unknown> };
export type TokenRow = { user_id: string; token: string };

export interface PushDeps {
  db: {
    fetchUnsent(limit: number): Promise<NotificationRow[]>;
    tokensFor(userIds: string[]): Promise<TokenRow[]>;
    markSent(ids: string[]): Promise<void>;
    deleteTokens(tokens: string[]): Promise<void>;
  };
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  expoAccessToken?: string;
}

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;   // limit Expo: do 100 wiadomości w jednym żądaniu

type Ticket = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } };

export async function sendPendingPushes(deps: PushDeps, limit = 200): Promise<{ notifications: number; messages: number; removedTokens: number }> {
  const rows = await deps.db.fetchUnsent(limit);
  if (rows.length === 0) return { notifications: 0, messages: 0, removedTokens: 0 };

  const tokens = await deps.db.tokensFor([...new Set(rows.map((r) => r.user_id))]);
  const byUser = new Map<string, string[]>();
  for (const t of tokens) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token]);

  const messages = rows.flatMap((n) =>
    (byUser.get(n.user_id) ?? []).map((to) => ({
      to, title: n.title, body: n.body ?? undefined, sound: 'default', channelId: 'default', priority: 'high',
      data: { ...n.data, kind: n.kind, notification_id: n.id },
    }))
  );

  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    const res = await deps.fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json',
        ...(deps.expoAccessToken ? { Authorization: `Bearer ${deps.expoAccessToken}` } : {}),
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new HttpError(502, 'expo_unavailable', `Expo Push zwrócił błąd ${res.status}.`);
    const payload = (await res.json()) as { data?: Ticket[] };
    (payload.data ?? []).forEach((t, idx) => {
      if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') dead.push(chunk[idx].to);
    });
  }

  // Oznaczamy jako wysłane także powiadomienia bez żadnego urządzenia — inaczej wracałyby w nieskończoność.
  await deps.db.markSent(rows.map((r) => r.id));
  if (dead.length) await deps.db.deleteTokens([...new Set(dead)]);
  return { notifications: rows.length, messages: messages.length, removedTokens: new Set(dead).size };
}

/** Wspólny „strażnik" funkcji wywoływanych przez harmonogram: sekret w nagłówku x-cron-secret. */
export function requireCronSecret(req: Request, secret: string | undefined): void {
  if (!secret || secret.length < 16) throw new HttpError(500, 'not_configured', 'Brak skonfigurowanego sekretu CRON_SECRET (min. 16 znaków).');
  const given = req.headers.get('x-cron-secret') ?? '';
  // porównanie w stałym czasie (bez wczesnego wyjścia), by nie zdradzać długości wspólnego prefiksu
  let diff = given.length ^ secret.length;
  for (let i = 0; i < Math.max(given.length, secret.length); i++) diff |= (given.charCodeAt(i) || 0) ^ (secret.charCodeAt(i) || 0);
  if (diff !== 0) throw new HttpError(401, 'unauthorized', 'Brak uprawnień.');
}

export async function handleSendPush(req: Request, deps: PushDeps, secret: string | undefined): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    requireCronSecret(req, secret);
    return json({ ok: true, ...(await sendPendingPushes(deps)) });
  } catch (e) {
    return errorResponse(e);
  }
}
