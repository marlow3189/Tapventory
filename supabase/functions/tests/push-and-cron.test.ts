import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPO_PUSH_URL, handleSendPush, requireCronSecret, sendPendingPushes, type NotificationRow, type PushDeps, type TokenRow } from '../send-push/handler.ts';
import { handleCron, runCronTasks, type CronDeps } from '../cron-tasks/handler.ts';

const SECRET = 'sekret-testowy-1234567890';

function pushSetup(notifs: NotificationRow[], tokens: TokenRow[], tickets?: (chunk: { to: string }[]) => unknown) {
  const log: { sent: { to: string; title: string; data: Record<string, unknown>; body?: string }[][]; marked: string[]; deleted: string[]; auth: (string | undefined)[] } = { sent: [], marked: [], deleted: [], auth: [] };
  const deps: PushDeps = {
    db: {
      fetchUnsent: async () => notifs,
      tokensFor: async () => tokens,
      markSent: async (ids) => { log.marked.push(...ids); },
      deleteTokens: async (t) => { log.deleted.push(...t); },
    },
    fetch: async (url, init) => {
      assert.equal(url, EXPO_PUSH_URL);
      const chunk = JSON.parse(init.body) as { to: string; title: string; data: Record<string, unknown> }[];
      log.sent.push(chunk);
      log.auth.push(init.headers.Authorization);
      const data = tickets ? tickets(chunk) : chunk.map(() => ({ status: 'ok', id: 'x' }));
      return { ok: true, status: 200, json: async () => ({ data }) };
    },
    expoAccessToken: 'expo-token',
  };
  return { deps, log };
}

const n = (id: string, user: string): NotificationRow => ({ id, user_id: user, kind: 'low_stock', title: `T-${id}`, body: 'Treść', data: { product_id: 'p1' } });

test('push: wiadomość trafia na wszystkie urządzenia użytkownika, dane zawierają rodzaj i id powiadomienia', async () => {
  const { deps, log } = pushSetup([n('n1', 'u1')], [{ user_id: 'u1', token: 'ExponentPushToken[a]' }, { user_id: 'u1', token: 'ExponentPushToken[b]' }, { user_id: 'u2', token: 'ExponentPushToken[c]' }]);
  const r = await sendPendingPushes(deps);
  assert.deepEqual(r, { notifications: 1, messages: 2, removedTokens: 0 });
  assert.deepEqual(log.sent[0].map((m) => m.to), ['ExponentPushToken[a]', 'ExponentPushToken[b]']);
  assert.equal(log.sent[0][0].title, 'T-n1');
  assert.deepEqual(log.sent[0][0].data, { product_id: 'p1', kind: 'low_stock', notification_id: 'n1' });
  assert.equal(log.auth[0], 'Bearer expo-token');
  assert.deepEqual(log.marked, ['n1']);
});

test('push: porcje po 100, martwe tokeny są usuwane, a powiadomienia bez urządzeń oznaczane jako wysłane', async () => {
  const tokens = Array.from({ length: 150 }, (_, i) => ({ user_id: 'u1', token: `ExponentPushToken[${i}]` }));
  const { deps, log } = pushSetup([n('n1', 'u1'), n('n2', 'u-bez-urzadzen')], tokens, (chunk) =>
    chunk.map((m) => (m.to.endsWith('[7]') || m.to.endsWith('[120]') ? { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }))
  );
  const r = await sendPendingPushes(deps);
  assert.deepEqual(log.sent.map((c) => c.length), [100, 50]);
  assert.equal(r.removedTokens, 2);
  assert.deepEqual([...log.deleted].sort(), ['ExponentPushToken[120]', 'ExponentPushToken[7]']);
  assert.deepEqual(log.marked.sort(), ['n1', 'n2'], 'bez urządzeń też „wysłane” — inaczej wracałyby w nieskończoność');
});

test('push: brak powiadomień = brak żądań; awaria Expo nie oznacza powiadomień jako wysłane', async () => {
  const { deps, log } = pushSetup([], []);
  assert.deepEqual(await sendPendingPushes(deps), { notifications: 0, messages: 0, removedTokens: 0 });
  assert.equal(log.sent.length, 0);

  const broken = pushSetup([n('n1', 'u1')], [{ user_id: 'u1', token: 'ExponentPushToken[a]' }]);
  broken.deps.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(sendPendingPushes(broken.deps), /503/);
  assert.deepEqual(broken.log.marked, []);
});

test('sekret harmonogramu: wymagany, porównywany dokładnie, krótki sekret odrzucony', async () => {
  const req = (secret?: string) => new Request('http://x', { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} });
  assert.doesNotThrow(() => requireCronSecret(req(SECRET), SECRET));
  assert.throws(() => requireCronSecret(req(), SECRET), /Brak uprawnień/);
  assert.throws(() => requireCronSecret(req('zly-sekret-1234567890x'), SECRET), /Brak uprawnień/);
  assert.throws(() => requireCronSecret(req(SECRET + 'x'), SECRET), /Brak uprawnień/);
  assert.throws(() => requireCronSecret(req('krotki'), 'krotki'), /CRON_SECRET/);
  assert.throws(() => requireCronSecret(req(SECRET), undefined), /CRON_SECRET/);
  const { deps } = pushSetup([], []);
  assert.equal((await handleSendPush(req(), deps, SECRET)).status, 401);
  assert.equal((await handleSendPush(req(SECRET), deps, SECRET)).status, 200);
});

test('cron: strażnik i push działają zawsze, przypomnienia o spisie tylko rano (UTC 6–7); błąd jednego kroku nie blokuje reszty', async () => {
  const calls: string[] = [];
  const mk = (hour: number, failing?: string): CronDeps => ({
    push: pushSetup([], []).deps,
    db: { rpc: async (name) => { calls.push(name); if (name === failing) throw new Error('boom'); return 3; } },
    now: () => new Date(Date.UTC(2026, 9, 8, hour, 5)),
  });

  const noon = await runCronTasks(mk(12));
  assert.deepEqual(calls, ['reap_stuck_documents']);
  assert.equal(noon.reaped_documents, 3);
  assert.ok('push' in noon);

  calls.length = 0;
  const morning = await runCronTasks(mk(6));
  assert.deepEqual(calls, ['reap_stuck_documents', 'queue_count_reminders']);
  assert.equal(morning.count_reminders, 3);

  calls.length = 0;
  const failing = await runCronTasks(mk(7, 'reap_stuck_documents'));
  assert.deepEqual(failing.reaped_documents, { error: 'boom' });
  assert.equal(failing.count_reminders, 3, 'kolejne kroki wykonują się mimo błędu');

  const req = (s?: string) => new Request('http://x', { method: 'POST', headers: s ? { 'x-cron-secret': s } : {} });
  assert.equal((await handleCron(req(), mk(12), SECRET)).status, 401);
  assert.equal((await handleCron(req(SECRET), mk(12), SECRET)).status, 200);
});
