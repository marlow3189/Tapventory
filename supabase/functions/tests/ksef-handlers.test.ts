import test from 'node:test';
import assert from 'node:assert/strict';
import { handleKsefConnect, resolveImportFrom, toHttpError, type ConnectDeps } from '../ksef-connect/handler.ts';
import { handleKsefSync, type KsefSyncDeps } from '../ksef-sync/handler.ts';
import { runCronTasks, type CronDeps } from '../cron-tasks/handler.ts';
import { KsefClient } from '../_shared/ksef/client.ts';
import { KsefError } from '../_shared/ksef/types.ts';
import type { ClaimResult, FinishArgs } from '../_shared/ksef/sync.ts';
import { FakeKsef, faXml, makeKsefNumber, metaFor } from './ksef-fixtures.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-02-01T12:00:00Z');
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const errorOf = async (r: Response) => ((await r.json()) as { error: { code: string; message: string } }).error;

// ---------------------------------------------------------------------------------------------
// ksef-connect
// ---------------------------------------------------------------------------------------------

interface ConnectCtx {
  deps: ConnectDeps; server: FakeKsef;
  saved: Parameters<ConnectDeps['db']['saveConnection']>[0][];
  sealed: string[]; firstSyncs: string[]; logs: string[];
}

async function connectSetup(over: { owner?: boolean; tenantNip?: string | null; tenant?: boolean; firstSync?: boolean | Error; server?: FakeKsef } = {}): Promise<ConnectCtx> {
  const server = over.server ?? (await new FakeKsef({ invoices: [metaFor(makeKsefNumber(1))] }).init());
  const saved: ConnectCtx['saved'] = [];
  const sealed: string[] = [];
  const firstSyncs: string[] = [];
  const logs: string[] = [];
  const deps: ConnectDeps = {
    auth: { getUserId: async (t) => (t === 'good' ? 'user-1' : null) },
    db: {
      getTenant: async (id) => (over.tenant === false ? null : { id, nip: over.tenantNip === undefined ? '5260250995' : over.tenantNip }),
      isOwner: async () => over.owner ?? true,
      saveConnection: async (a) => { saved.push(a); },
    },
    sealToken: async (plain, tenantId) => { sealed.push(plain); return `v1.SEALED.${tenantId.slice(0, 8)}`; },
    makeApi: (environment) => new KsefClient({ environment, fetch: server.fetch, sleep: async () => {}, now: server.now, authPollIntervalMs: 1 }),
    startFirstSync: async (id) => {
      if (over.firstSync instanceof Error) throw over.firstSync;
      firstSyncs.push(id);
      return over.firstSync ?? true;
    },
    now: () => NOW,
    log: (m, e) => { logs.push(JSON.stringify({ m, ...e })); },
  };
  return { deps, server, saved, sealed, firstSyncs, logs };
}

const callConnect = (ctx: ConnectCtx, body: unknown = {}, init: { method?: string; token?: string | null } = {}) =>
  handleKsefConnect(new Request('http://localhost/functions/v1/ksef-connect', {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? 'good'}` }) },
    body: init.method === 'GET' || init.method === 'OPTIONS' ? undefined : JSON.stringify({ tenant_id: TENANT, token: ctx.server.token, ...(body as object) }),
  }), ctx.deps);

test('connect: poprawny token → sprawdzenie w KSeF, zapis zaszyfrowany, pierwsza synchronizacja w tle', async () => {
  const ctx = await connectSetup();
  const r = await callConnect(ctx, { import_from: '2026-01-01' });
  assert.equal(r.status, 200);
  const raw = await r.text();
  assert.deepEqual(JSON.parse(raw), { ok: true, status: 'connected', sync: 'started' });

  assert.equal(ctx.saved.length, 1);
  assert.deepEqual({ ...ctx.saved[0] }, {
    tenantId: TENANT, userId: 'user-1', environment: 'prod', nip: '5260250995',
    ciphertext: `v1.SEALED.${TENANT.slice(0, 8)}`, hint: ctx.server.token.slice(-4), importFrom: '2026-01-01',
  });
  assert.deepEqual(ctx.sealed, [ctx.server.token]);
  assert.deepEqual(ctx.firstSyncs, [TENANT]);
  // sprawdzono i logowanie, i uprawnienie do listy faktur
  assert.ok(ctx.server.calledPaths().includes('POST /auth/token/redeem'));
  assert.ok(ctx.server.calledPaths().includes('POST /invoices/query/metadata'));
  const probe = ctx.server.calls.find((c) => c.path === '/invoices/query/metadata')!;
  assert.equal(probe.query.pageSize, '10');
  // nic wrażliwego w odpowiedzi ani w logach
  assert.ok(!raw.includes(ctx.server.token));
  assert.ok(!ctx.logs.join('\n').includes(ctx.server.token));
});

test('connect: środowisko testowe i domyślna data początkowa (30 dni wstecz)', async () => {
  const ctx = await connectSetup();
  const r = await callConnect(ctx, { environment: 'demo' });
  assert.equal(r.status, 200);
  assert.equal(ctx.saved[0].environment, 'demo');
  assert.equal(ctx.saved[0].importFrom, '2026-01-02');
  const bad = await callConnect(ctx, { environment: 'staging' });
  assert.equal(bad.status, 400);
});

test('connect: tylko właściciel; wymaga logowania, metody POST i poprawnych danych', async () => {
  assert.equal((await callConnect(await connectSetup(), {}, { token: null })).status, 401);
  assert.equal((await callConnect(await connectSetup(), {}, { token: 'zly' })).status, 401);
  const notOwner = await connectSetup({ owner: false });
  const r = await callConnect(notOwner);
  assert.equal(r.status, 403);
  assert.match((await errorOf(r)).message, /właściciel/);
  assert.equal(notOwner.server.calls.length, 0, 'nie-właściciel nie uruchamia żadnego ruchu do KSeF');
  assert.equal((await callConnect(await connectSetup(), {}, { method: 'GET' })).status, 405);
  assert.equal((await callConnect(await connectSetup(), {}, { method: 'OPTIONS' })).status, 204);
  assert.equal((await callConnect(await connectSetup(), { tenant_id: 'nie-uuid' })).status, 400);
  assert.equal((await callConnect(await connectSetup(), {}, {})).status, 200);
  assert.equal((await callConnect(await connectSetup({ tenant: false }))).status, 404);
});

test('connect: wygląd tokenu — spacje, zbyt krótki, zbyt długi, znaki spoza ASCII', async () => {
  for (const token of ['', 'krotki', 'ma spacje 0123456789012345', 'z\nnowa-linia-0123456789012', 'zażółć-gęślą-jaźń-0123456789', 'x'.repeat(2001), 123 as unknown as string]) {
    const ctx = await connectSetup();
    const r = await callConnect(ctx, { token });
    assert.equal(r.status, 400, JSON.stringify(token).slice(0, 40));
    assert.equal((await errorOf(r)).code, 'bad_token_format');
    assert.equal(ctx.saved.length, 0);
    assert.equal(ctx.server.calls.length, 0);
  }
  // białe znaki na brzegach (typowe przy kopiowaniu) są obcinane
  const ctx = await connectSetup();
  const r = await callConnect(ctx, { token: `  ${ctx.server.token}\n` });
  assert.equal(r.status, 200);
});

test('connect: NIP — z firmy, z formularza albo błąd; zła suma kontrolna odrzucona', async () => {
  const withBody = await connectSetup({ tenantNip: null });
  assert.equal((await callConnect(withBody, { nip: 'PL 526-025-09-95' })).status, 200);
  assert.equal(withBody.saved[0].nip, '5260250995');
  const none = await connectSetup({ tenantNip: null });
  const r = await callConnect(none);
  assert.equal(r.status, 400);
  assert.equal((await errorOf(r)).code, 'nip_required');
  const bad = await connectSetup({ tenantNip: '1234567890' });
  assert.equal((await callConnect(bad)).status, 400);
});

test('connect: data początkowa — format, przyszłość i zbyt odległa przeszłość', () => {
  assert.equal(resolveImportFrom('2026-01-15', NOW), '2026-01-15');
  assert.equal(resolveImportFrom(undefined, NOW), '2026-01-02');
  assert.equal(resolveImportFrom('', NOW), '2026-01-02');
  assert.equal(resolveImportFrom('2026-02-02', NOW), '2026-02-02', 'jutro jeszcze akceptujemy (strefy czasowe)');
  for (const bad of ['2026-13-40', 'wczoraj', '15.01.2026', '2026-02-05', '2019-01-01', 20260101, {}]) {
    assert.throws(() => resolveImportFrom(bad, NOW), /Data początkowa/, JSON.stringify(bad));
  }
});

test('connect: KSeF odrzuca token → czytelny błąd i brak zapisu', async () => {
  const ctx = await connectSetup();
  const r = await callConnect(ctx, { token: 'ZLY-TOKEN-0123456789ABCDEF' });
  assert.equal(r.status, 400);
  const e = await errorOf(r);
  assert.equal(e.code, 'token_rejected');
  assert.match(e.message, /nie rozpoznał tokenu/);
  assert.equal(ctx.saved.length, 0);
  assert.equal(ctx.firstSyncs.length, 0);
  assert.ok(!JSON.stringify(e).includes('ZLY-TOKEN'));
});

test('connect: token bez uprawnienia do przeglądania faktur (403 na liście) → osobny komunikat', async () => {
  const ctx = await connectSetup();
  ctx.server.force('/invoices/query/metadata', res({ title: 'Forbidden' }, 403));
  const r = await callConnect(ctx);
  assert.equal(r.status, 400);
  const e = await errorOf(r);
  assert.equal(e.code, 'no_permission');
  assert.match(e.message, /Przeglądanie faktur/);
  assert.equal(ctx.saved.length, 0);
});

test('connect: KSeF niedostępny / ogranicza tempo → 503 / 429 bez zapisu', async () => {
  const down = await connectSetup();
  down.server.force('/auth/challenge', res({}, 503), res({}, 503), res({}, 503));
  const r1 = await callConnect(down);
  assert.equal(r1.status, 503);
  assert.equal((await errorOf(r1)).code, 'ksef_unavailable');
  const slow = await connectSetup();
  slow.server.force('/auth/challenge', new Response('{}', { status: 429, headers: { 'retry-after': '300', 'content-type': 'application/json' } }));
  const r2 = await callConnect(slow);
  assert.equal(r2.status, 429);
  assert.equal(down.saved.length + slow.saved.length, 0);
});

test('connect: nieudany start pierwszej synchronizacji nie psuje połączenia (zrobi to harmonogram)', async () => {
  const failing = await connectSetup({ firstSync: new Error('baza padła') });
  const r = await callConnect(failing);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, status: 'connected', sync: 'pending' });
  assert.equal(failing.saved.length, 1);
  const refused = await connectSetup({ firstSync: false });
  assert.equal(((await (await callConnect(refused)).json()) as { sync: string }).sync, 'pending');
});

test('connect: mapowanie błędów KSeF na HTTP', () => {
  const cases: [KsefError, number, string][] = [
    [new KsefError('token_rejected', 'a'), 400, 'token_rejected'], [new KsefError('no_permission', 'a'), 400, 'no_permission'],
    [new KsefError('invalid_input', 'a'), 400, 'bad_request'], [new KsefError('rate_limited', 'a'), 429, 'ksef_rate_limited'],
    [new KsefError('unavailable', 'a'), 503, 'ksef_unavailable'], [new KsefError('bad_response', 'a'), 503, 'ksef_unavailable'],
    [new KsefError('rejected', 'a'), 503, 'ksef_unavailable'],
  ];
  for (const [err, status, code] of cases) {
    const h = toHttpError(err);
    assert.deepEqual([h.status, h.code], [status, code]);
  }
  assert.equal(toHttpError(new Error('x')).status, 500);
});

// ---------------------------------------------------------------------------------------------
// ksef-sync (ręczne „Synchronizuj teraz")
// ---------------------------------------------------------------------------------------------

async function syncSetup(over: { manager?: boolean; claim?: ClaimResult } = {}) {
  const n = makeKsefNumber(1);
  const server = await new FakeKsef({ invoices: [metaFor(n, { permanentStorageDate: '2026-01-20T00:00:00Z' })], xml: { [n]: faXml() } }).init();
  const jobs: Promise<unknown>[] = [];
  const finishes: FinishArgs[] = [];
  const claims: string[] = [];
  const deps: KsefSyncDeps = {
    auth: { getUserId: async (t) => (t === 'good' ? 'user-1' : null) },
    db: { isManager: async () => over.manager ?? true },
    sync: {
      db: {
        claim: async (_t, trigger) => {
          claims.push(trigger);
          return over.claim ?? { claimed: true, run_id: 9, environment: 'test', nip: server.nip, token_ciphertext: 'C', cursor_at: null, import_from: '2026-01-01' };
        },
        knownNumbers: async () => [],
        importInvoice: async () => ({ status: 'created', document_id: 'd1' }),
        finish: async (a) => { finishes.push(a); },
      },
      openToken: async () => server.token,
      makeApi: (environment) => new KsefClient({ environment, fetch: server.fetch, sleep: async () => {}, now: server.now, authPollIntervalMs: 1 }),
      now: () => NOW, sleep: async () => {}, limits: { downloadGapMs: 0 },
    },
    waitUntil: (p) => { jobs.push(p); },
  };
  return { deps, jobs, finishes, claims, server };
}

const callSync = (deps: KsefSyncDeps, init: { method?: string; token?: string | null; body?: unknown } = {}) =>
  handleKsefSync(new Request('http://localhost/functions/v1/ksef-sync', {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? 'good'}` }) },
    body: init.method === 'GET' ? undefined : JSON.stringify(init.body ?? { tenant_id: TENANT }),
  }), deps);

test('sync: miejsce zajmowane od razu, odpowiedź 202, praca w tle kończy się zapisem wyniku', async () => {
  const s = await syncSetup();
  const r = await callSync(s.deps);
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { ok: true, status: 'started' });
  assert.deepEqual(s.claims, ['manual']);
  assert.equal(s.jobs.length, 1);
  await Promise.all(s.jobs);
  assert.equal(s.finishes.length, 1);
  assert.equal(s.finishes[0].status, 'ok');
  assert.equal(s.finishes[0].imported, 1);
});

test('sync: wymaga logowania i roli kierownictwa; błędne dane wejściowe', async () => {
  const s = await syncSetup();
  assert.equal((await callSync(s.deps, { token: null })).status, 401);
  assert.equal((await callSync(s.deps, { token: 'zly' })).status, 401);
  assert.equal((await callSync(s.deps, { method: 'GET' })).status, 405);
  assert.equal((await callSync(s.deps, { body: { tenant_id: 'x' } })).status, 400);
  const emp = await syncSetup({ manager: false });
  const r = await callSync(emp.deps);
  assert.equal(r.status, 403);
  assert.deepEqual(emp.claims, [], 'pracownik nie zajmuje miejsca na synchronizację');
});

test('sync: odmowy bazy mają sensowne kody i komunikaty; „już trwa” jest idempotentne', async () => {
  const run = await callSync((await syncSetup({ claim: { claimed: false, reason: 'already_running' } })).deps);
  assert.equal(run.status, 202);
  assert.deepEqual(await run.json(), { ok: true, status: 'running' });

  const soon = await callSync((await syncSetup({ claim: { claimed: false, reason: 'too_soon' } })).deps);
  assert.equal(soon.status, 429);
  assert.match((await errorOf(soon)).message, /przed chwilą/);

  const not = await callSync((await syncSetup({ claim: { claimed: false, reason: 'not_connected' } })).deps);
  assert.equal(not.status, 409);
  assert.equal((await errorOf(not)).code, 'not_connected');

  const re = await callSync((await syncSetup({ claim: { claimed: false, reason: 'needs_reconnect' } })).deps);
  assert.equal(re.status, 409);
  assert.match((await errorOf(re)).message, /nowy token/);
});

// ---------------------------------------------------------------------------------------------
// harmonogram
// ---------------------------------------------------------------------------------------------

const cronBase = (over: Partial<CronDeps> = {}): CronDeps => ({
  push: { db: { fetchUnsent: async () => [], tokensFor: async () => [], markSent: async () => {}, deleteTokens: async () => {} }, fetch: async () => new Response('{}'), expoAccessToken: undefined },
  db: { rpc: async () => 0 },
  now: () => new Date('2026-02-01T12:00:00Z'),
  ...over,
});

test('harmonogram: krok KSeF uruchamiany, jego awaria nie blokuje pozostałych zadań', async () => {
  let started = 0;
  const ok = await runCronTasks(cronBase({ ksef: { startDue: async () => { started++; return { started: 2, skipped: 0 }; } } }));
  assert.equal(started, 1);
  assert.deepEqual(ok.ksef, { started: 2, skipped: 0 });
  assert.ok('push' in ok && 'reaped_documents' in ok);

  const broken = await runCronTasks(cronBase({ ksef: { startDue: async () => { throw new Error('rpc padło'); } } }));
  assert.deepEqual(broken.ksef, { error: 'rpc padło' });
  assert.ok('push' in broken, 'wysyłka push działa mimo awarii KSeF');

  const without = await runCronTasks(cronBase());
  assert.ok(!('ksef' in without));
});
