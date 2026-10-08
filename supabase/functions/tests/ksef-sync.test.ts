import test from 'node:test';
import assert from 'node:assert/strict';
import { KsefClient } from '../_shared/ksef/client.ts';
import { VaultError } from '../_shared/ksef/token-vault.ts';
import type { KsefInvoicePayload } from '../_shared/ksef/fa-parser.ts';
import { KsefError } from '../_shared/ksef/types.ts';
import { claimSync, executeSync, startDueSyncs, type ClaimOk, type ClaimResult, type FinishArgs, type SyncDeps, type SyncTrigger } from '../_shared/ksef/sync.ts';
import { FakeKsef, faXml, makeKsefNumber, metaFor } from './ksef-fixtures.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const HWM = '2026-02-01T11:59:00.000Z';
const hourly = (i: number, base = '2026-01-10T00:00:00Z') => new Date(Date.parse(base) + i * 3_600_000).toISOString();
const res = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

class FakeDb {
  known = new Set<string>();
  linkable = new Set<string>();
  failFull = new Set<string>();
  imports: { ksefNumber: string; payload: KsefInvoicePayload; xml: string | null; sha: string | null }[] = [];
  finishes: FinishArgs[] = [];
  knownCalls: string[][] = [];
  failFinish = false;
  claims: { tenant: string; trigger: SyncTrigger }[] = [];
  claim: (tenant: string, trigger: SyncTrigger) => ClaimResult = () => ({ claimed: false, reason: 'not_connected' });
  due: string[] = [];

  api = {
    claim: async (tenant: string, trigger: SyncTrigger) => { this.claims.push({ tenant, trigger }); return this.claim(tenant, trigger); },
    knownNumbers: async (_t: string, numbers: string[]) => { this.knownCalls.push(numbers); return numbers.filter((n) => this.known.has(n)); },
    importInvoice: async (_t: string, ksefNumber: string, payload: KsefInvoicePayload, xml: string | null, sha: string | null) => {
      if (this.failFull.has(ksefNumber) && payload.lines.length > 0) throw new Error('numeric field overflow');
      this.imports.push({ ksefNumber, payload, xml, sha });
      if (this.known.has(ksefNumber)) return { status: 'exists' as const, document_id: 'd0' };
      this.known.add(ksefNumber);
      return { status: this.linkable.has(ksefNumber) ? ('linked' as const) : ('created' as const), document_id: `d${this.imports.length}` };
    },
    finish: async (a: FinishArgs) => {
      if (this.failFinish) throw new Error('baza niedostępna');
      this.finishes.push(a);
    },
    dueTenants: async () => this.due,
  };
}

function claimOk(over: Partial<ClaimOk> = {}): ClaimOk {
  return { claimed: true, run_id: 42, environment: 'test', nip: '5260250995', token_ciphertext: 'CIPHER', cursor_at: null, import_from: '2026-01-01', ...over };
}

interface Ctx { server: FakeKsef; db: FakeDb; deps: SyncDeps & { db: SyncDeps['db'] & { dueTenants(l: number): Promise<string[]> } }; logs: string[]; clock: { t: number } }

async function setup(opts: { count?: number; hwm?: string | null; xml?: (i: number, n: string) => string; limits?: Partial<NonNullable<SyncDeps['limits']>>; open?: SyncDeps['openToken'] } = {}): Promise<Ctx & { numbers: string[] }> {
  const count = opts.count ?? 5;
  const numbers = Array.from({ length: count }, (_v, i) => makeKsefNumber(i + 1));
  const invoices = numbers.map((n, i) => metaFor(n, { permanentStorageDate: hourly(i), invoiceNumber: `FV/${i + 1}` }));
  const xml = Object.fromEntries(numbers.map((n, i) => [n, opts.xml ? opts.xml(i, n) : faXml({ number: `FV/${i + 1}` })]));
  const server = await new FakeKsef({ invoices, xml, hwm: opts.hwm === undefined ? HWM : opts.hwm }).init();
  const db = new FakeDb();
  const clock = { t: server.now() };
  const logs: string[] = [];
  const deps: Ctx['deps'] = {
    db: db.api,
    openToken: opts.open ?? (async (cipher) => { if (cipher !== 'CIPHER') throw new VaultError('cannot_decrypt', 'x'); return server.token; }),
    makeApi: (environment) => new KsefClient({ environment, fetch: server.fetch, sleep: async () => {}, now: server.now, authPollIntervalMs: 1 }),
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    limits: { downloadGapMs: 0, ...opts.limits },
    log: (m, e) => { logs.push(JSON.stringify({ m, ...e })); },
  };
  return { server, db, deps, logs, clock, numbers };
}

const metaCalls = (s: FakeKsef) => s.calls.filter((c) => c.path === '/invoices/query/metadata');
const downloads = (s: FakeKsef) => s.calls.filter((c) => c.path.startsWith('/invoices/ksef/'));

test('pierwsza synchronizacja: nowe, już znane i dopięte do istniejących; kursor = HWM z KSeF', async () => {
  const c = await setup({ count: 5 });
  c.db.known.add(c.numbers[1]);
  c.db.linkable.add(c.numbers[2]);
  const out = await executeSync(c.deps, TENANT, claimOk());

  assert.deepEqual({ ...out }, { status: 'ok', listed: 5, imported: 3, linked: 1, skipped: 1, failed: 0, error: null, cursor: HWM });
  assert.equal(downloads(c.server).length, 4, 'faktury już znanej nie pobieramy (oszczędność limitów KSeF)');
  assert.equal(c.db.imports.length, 4);
  assert.equal(c.db.imports[0].payload.invoice_number, 'FV/1');
  assert.equal(c.db.imports[0].payload.supplier_nip, '1234563218');
  assert.match(c.db.imports[0].sha ?? '', /^[0-9a-f]{64}$/);
  assert.ok(c.db.imports[0].xml?.includes('<Faktura'));

  const q = metaCalls(c.server)[0];
  assert.equal((q.body as { dateRange: { from: string; to?: string } }).dateRange.from, '2026-01-01T00:00:00.000Z', 'start od wybranej daty (UTC)');
  assert.equal((q.body as { dateRange: { to?: string } }).dateRange.to, undefined, 'ostatnie okno bez górnej granicy (KSeF sam ucina do HWM)');

  assert.equal(c.db.finishes.length, 1);
  assert.deepEqual({ ...c.db.finishes[0] }, { runId: 42, status: 'ok', listed: 5, imported: 3, linked: 1, skipped: 1, failed: 0, error: null, cursor: HWM, authFailed: false, retryAfterSec: null });
  const all = c.logs.join('\n');
  assert.ok(!all.includes(c.server.token), 'token nie trafia do logów');
  assert.ok(!all.includes('Hurtownia'), 'treść faktur nie trafia do logów');
});

test('kolejna synchronizacja startuje od kursora i nie robi nic, gdy nie ma nowych faktur', async () => {
  const c = await setup({ count: 5 });
  const out = await executeSync(c.deps, TENANT, claimOk({ cursor_at: HWM, import_from: '2020-01-01' }));
  assert.equal(out.status, 'ok');
  assert.equal(out.listed, 0);
  assert.equal(out.cursor, HWM);
  assert.equal((metaCalls(c.server)[0].body as { dateRange: { from: string } }).dateRange.from, HWM, 'kursor wygrywa z datą początkową');
  assert.equal(downloads(c.server).length, 0);
});

test('stronicowanie: kolejne numery stron 0, 1, 2 i komplet faktur', async () => {
  const c = await setup({ count: 25, limits: { pageSize: 10 } });
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.equal(out.imported, 25);
  assert.deepEqual(metaCalls(c.server).map((m) => m.query.pageOffset), ['0', '1', '2']);
  assert.equal(c.db.knownCalls.length, 3, 'jedno zapytanie o znane numery na stronę');
});

test('okna po 90 dni: stare zaległości pobierane etapami, każde następne okno zaczyna się tam, gdzie skończyło poprzednie', async () => {
  const c = await setup({ count: 0 });
  const dates = ['2025-06-15T00:00:00Z', '2025-09-15T00:00:00Z', '2025-12-15T00:00:00Z', '2026-01-20T00:00:00Z'];
  const numbers = dates.map((_d, i) => makeKsefNumber(100 + i));
  c.server.invoices = numbers.map((n, i) => metaFor(n, { permanentStorageDate: dates[i], invoiceNumber: `W${i}` }));
  c.server.xml = Object.fromEntries(numbers.map((n, i) => [n, faXml({ number: `W${i}` })]));

  const out = await executeSync(c.deps, TENANT, claimOk({ import_from: '2025-06-01' }));
  assert.equal(out.status, 'ok');
  assert.equal(out.imported, 4);
  const ranges = metaCalls(c.server).map((m) => (m.body as { dateRange: { from: string; to?: string } }).dateRange);
  assert.equal(ranges.length, 3);
  assert.equal(ranges[0].from, '2025-06-01T00:00:00.000Z');
  assert.equal(ranges[0].to, '2025-08-30T00:00:00.000Z');
  assert.equal(ranges[1].from, ranges[0].to);
  assert.equal(ranges[1].to, '2025-11-28T00:00:00.000Z');
  assert.equal(ranges[2].from, ranges[1].to);
  assert.equal(ranges[2].to, undefined);
  for (const r of ranges.slice(0, 2)) assert.ok(Date.parse(r.to as string) - Date.parse(r.from) <= 100 * 86_400_000, 'okno nie przekracza limitu KSeF (100 dni)');
  assert.equal(out.cursor, HWM);
});

test('obcięcie wyniku (isTruncated): zawężamy okno od daty ostatniego rekordu i zaczynamy od strony 0', async () => {
  const c = await setup({ count: 6 });
  const first = c.server.invoices.slice(0, 3);
  c.server.force('/invoices/query/metadata', res({ hasMore: true, isTruncated: true, permanentStorageHwmDate: HWM, invoices: first }));
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.equal(out.imported, 6, 'żadna faktura nie zginęła; granica powtórzona jest bezpieczna dzięki dedup');
  const calls = metaCalls(c.server);
  assert.equal((calls[1].body as { dateRange: { from: string } }).dateRange.from, first[2].permanentStorageDate);
  assert.equal(calls[1].query.pageOffset, '0');
});

test('KSeF ogranicza tempo (429, długie Retry-After): kończymy częściowo, kursor stoi na ostatniej gotowej fakturze', async () => {
  const c = await setup({ count: 5 });
  c.server.force(`/invoices/ksef/${c.numbers[2]}`, res({}, 429, { 'retry-after': '120' }));
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.equal(out.status, 'partial');
  assert.equal(out.imported, 2);
  assert.equal(out.failed, 0, 'ograniczenie tempa to nie błąd faktury');
  assert.equal(out.cursor, new Date(hourly(1)).toISOString(), 'kursor = data ostatniej w pełni przetworzonej faktury');
  assert.equal(c.db.finishes[0].retryAfterSec, 120);
  assert.equal(c.db.finishes[0].authFailed, false);
  assert.match(out.error ?? '', /ogranicza liczbę zapytań/);

  // następny przebieg (kursor w bazie) kończy robotę bez dubli
  const again = await executeSync(c.deps, TENANT, claimOk({ cursor_at: out.cursor }));
  assert.equal(again.status, 'ok');
  assert.equal(again.imported, 3);
  assert.equal(again.skipped, 1, 'granicę kursora widzimy drugi raz, ale nie importujemy jej ponownie');
  assert.equal(c.db.known.size, 5);
});

test('jedna nieudana faktura nie blokuje pozostałych, a kursor nie przeskakuje poza nią', async () => {
  const c = await setup({ count: 5 });
  delete c.server.xml[c.numbers[2]];                                    // KSeF odpowie 404 dla trzeciej
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.equal(out.status, 'partial');
  assert.deepEqual({ imported: out.imported, failed: out.failed }, { imported: 4, failed: 1 });
  assert.equal(out.cursor, hourly(2), 'kursor wstrzymany na dacie wadliwej faktury — następna próba ją znajdzie');
  assert.match(out.error ?? '', new RegExp(c.numbers[2]));
  assert.equal(c.db.finishes[0].authFailed, false);

  c.server.xml[c.numbers[2]] = faXml({ number: 'FV/3' });
  const retry = await executeSync(c.deps, TENANT, claimOk({ cursor_at: out.cursor }));
  assert.deepEqual({ status: retry.status, imported: retry.imported, skipped: retry.skipped }, { status: 'ok', imported: 1, skipped: 2 });
  assert.equal(retry.cursor, HWM);
});

test('token odrzucony przez KSeF: błąd z flagą authFailed (baza wstrzyma automat i powiadomi), kursor bez zmian', async () => {
  const c = await setup();
  c.deps.openToken = async () => 'INNY-TOKEN-0123456789ABCDEF';          // zapisany token nie jest tym, który zna KSeF
  const out = await executeSync(c.deps, TENANT, claimOk({ cursor_at: HWM }));
  assert.equal(out.status, 'error');
  assert.equal(out.cursor, null);
  assert.equal(c.db.finishes[0].authFailed, true);
  assert.match(out.error ?? '', /nie rozpoznał tokenu/);
  assert.equal(c.db.imports.length, 0);
});

test('chwilowa awaria KSeF przy logowaniu: błąd bez flagi authFailed', async () => {
  const c = await setup();
  c.server.force('/auth/challenge', res({}, 503), res({}, 503), res({}, 503));
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.equal(out.status, 'error');
  assert.equal(c.db.finishes[0].authFailed, false);
  assert.match(out.error ?? '', /nie działa/);
});

test('sejf: uszkodzony szyfrogram = ponowne połączenie; brak klucza w konfiguracji = problem serwera, nie klienta', async () => {
  const broken = await setup({ open: async () => { throw new VaultError('cannot_decrypt', 'x'); } });
  const a = await executeSync(broken.deps, TENANT, claimOk());
  assert.equal(a.status, 'error');
  assert.equal(broken.db.finishes[0].authFailed, true);
  assert.match(a.error ?? '', /połącz KSeF ponownie/);

  const noKey = await setup({ open: async () => { throw new VaultError('bad_key', 'x'); } });
  const b = await executeSync(noKey.deps, TENANT, claimOk());
  assert.equal(b.status, 'error');
  assert.equal(noKey.db.finishes[0].authFailed, false, 'to nie wina klienta — nie wstrzymujemy jego połączenia');
  assert.match(b.error ?? '', /KSEF_TOKEN_KEY/);
  assert.equal(noKey.server.calls.length, 0, 'bez klucza nie wołamy KSeF');
});

test('limit liczby faktur w jednym przebiegu: reszta w następnym', async () => {
  const c = await setup({ count: 5, limits: { maxInvoicesPerRun: 2 } });
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.deepEqual({ status: out.status, imported: out.imported }, { status: 'partial', imported: 2 });
  assert.equal(out.cursor, hourly(1));
  assert.match(out.error ?? '', /limitu czasu/);
  assert.equal(c.db.finishes[0].retryAfterSec, null);
});

test('budżet czasu: po przekroczeniu przerywamy z kursorem na ostatniej gotowej fakturze', async () => {
  const c = await setup({ count: 8, limits: { downloadGapMs: 1000, timeBudgetMs: 2500 } });
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.deepEqual({ status: out.status, imported: out.imported }, { status: 'partial', imported: 3 });
  assert.equal(out.cursor, hourly(2));
});

test('faktura w nieobsługiwanym formacie lub z uszkodzonym XML: zapis samego nagłówka z metadanych', async () => {
  const c = await setup({
    count: 3,
    xml: (i) => (i === 0 ? '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>1</ID></Invoice>' : i === 1 ? '<Faktura><Fa>' : faXml({ number: 'FV/3' })),
  });
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.deepEqual({ status: out.status, imported: out.imported, failed: out.failed }, { status: 'ok', imported: 3, failed: 0 });
  assert.deepEqual(c.db.imports.map((i) => i.payload.lines.length > 0), [false, false, true]);
  assert.equal(c.db.imports[0].payload.ai_warnings[0].code, 'ksef_header_only');
  assert.equal(c.db.imports[0].payload.invoice_number, 'FV/1');
  assert.equal(c.db.imports[0].payload.supplier_nip, '1234563218');
  assert.equal(c.db.imports[0].payload.total_gross, 197.42);
});

test('baza odrzuca pełne dane faktury: zapisujemy chociaż nagłówek zamiast gubić fakturę', async () => {
  const c = await setup({ count: 2 });
  c.db.failFull.add(c.numbers[0]);
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.deepEqual({ status: out.status, imported: out.imported, failed: out.failed }, { status: 'ok', imported: 2, failed: 0 });
  const first = c.db.imports.find((i) => i.ksefNumber === c.numbers[0])!;
  assert.equal(first.payload.lines.length, 0);
  assert.match(first.payload.ai_warnings[0].text, /wpisz je ręcznie/);
  assert.ok(c.logs.some((l) => l.includes('ksef import fallback')));
});

test('wygasły token dostępu w trakcie pracy: jedno ponowne logowanie i kontynuacja', async () => {
  const c = await setup({ count: 3 });
  c.server.force(`/invoices/ksef/${c.numbers[1]}`, res({ title: 'Unauthorized' }, 401));
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.deepEqual({ status: out.status, imported: out.imported }, { status: 'ok', imported: 3 });
  assert.equal(c.server.calls.filter((x) => x.path === '/auth/challenge').length, 2);

  const c2 = await setup({ count: 3 });
  c2.server.force(`/invoices/ksef/${c2.numbers[1]}`, res({}, 401), res({}, 401));
  const out2 = await executeSync(c2.deps, TENANT, claimOk());
  assert.equal(out2.status, 'partial');
  assert.equal(c2.db.finishes[0].authFailed, false, 'po drugim 401 nie oskarżamy tokenu — logowanie przeszło');
});

test('brak HWM w odpowiedzi: kursor = data ostatniej przetworzonej faktury', async () => {
  const c = await setup({ count: 3, hwm: null });
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.equal(out.status, 'ok');
  assert.equal(out.cursor, hourly(2));
});

test('zły lub przyszły kursor i bardzo stara data początkowa są ograniczane do rozsądnego zakresu', async () => {
  const c = await setup({ count: 0 });
  await executeSync(c.deps, TENANT, claimOk({ cursor_at: '2099-01-01T00:00:00Z' }));
  const from1 = Date.parse((metaCalls(c.server)[0].body as { dateRange: { from: string } }).dateRange.from);
  assert.ok(from1 < c.clock.t, 'kursor z przyszłości nie wychodzi poza „teraz”');

  const c2 = await setup({ count: 0 });
  await executeSync(c2.deps, TENANT, claimOk({ cursor_at: 'nie-data', import_from: null }));
  const from2 = (metaCalls(c2.server)[0].body as { dateRange: { from: string } }).dateRange.from;
  assert.equal(from2, new Date(c2.clock.t - 30 * 86_400_000).toISOString(), 'domyślnie 30 dni wstecz');

  const c3 = await setup({ count: 0 });
  await executeSync(c3.deps, TENANT, claimOk({ import_from: '1999-01-01' }));
  const firstFrom = Date.parse((metaCalls(c3.server)[0].body as { dateRange: { from: string } }).dateRange.from);
  assert.ok(firstFrom >= c3.clock.t - 5 * 365 * 86_400_000 - 1000);
});

test('awaria zapisu wyniku w bazie nie rzuca wyjątku (blokada wygaśnie sama po 10 minutach)', async () => {
  const c = await setup({ count: 1 });
  c.db.failFinish = true;
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.equal(out.status, 'ok');
  assert.ok(c.logs.some((l) => l.includes('ksef finish failed')));
});

test('niespodziewany błąd (nie z KSeF) nie ujawnia szczegółów użytkownikowi', async () => {
  const c = await setup({ count: 2 });
  c.deps.db = { ...c.deps.db, knownNumbers: async () => { throw new Error('connection refused to 10.0.0.5:5432 password=sekret'); } };
  const out = await executeSync(c.deps, TENANT, claimOk());
  assert.equal(out.status, 'error');
  assert.ok(!(out.error ?? '').includes('sekret') && !(out.error ?? '').includes('10.0.0.5'));
  assert.match(out.error ?? '', /nieoczekiwany/);
});

test('harmonogram: zajmuje miejsca po kolei, pracę zleca w tle; odmowy są liczone', async () => {
  const c = await setup({ count: 1 });
  c.db.due = ['t1', 't2', 't3'];
  c.db.claim = (tenant) => (tenant === 't2' ? { claimed: false, reason: 'already_running' } : claimOk({ run_id: tenant === 't1' ? 1 : 3 }));
  const jobs: Promise<unknown>[] = [];
  const out = await startDueSyncs(c.deps, (p) => { jobs.push(p); }, 3);
  assert.deepEqual(out, { started: 2, skipped: 1 });
  assert.deepEqual(c.db.claims.map((x) => `${x.tenant}:${x.trigger}`), ['t1:auto', 't2:auto', 't3:auto']);
  assert.equal(jobs.length, 2);
  await Promise.all(jobs);
  assert.deepEqual(c.db.finishes.map((f) => f.runId).sort(), [1, 3]);
});

test('claimSync przekazuje rodzaj synchronizacji do bazy', async () => {
  const c = await setup({ count: 0 });
  c.db.claim = () => ({ claimed: false, reason: 'too_soon' });
  assert.deepEqual(await claimSync(c.deps, TENANT, 'manual'), { claimed: false, reason: 'too_soon' });
  assert.deepEqual(c.db.claims, [{ tenant: TENANT, trigger: 'manual' }]);
});

test('KsefError dziedziczy po Error i ma właściwość isAuthFailure tylko dla błędów tokenu', () => {
  assert.ok(new KsefError('token_rejected', 'x').isAuthFailure);
  assert.ok(new KsefError('no_permission', 'x').isAuthFailure);
  for (const code of ['rate_limited', 'unavailable', 'bad_response', 'rejected', 'invalid_input'] as const) assert.ok(!new KsefError(code, 'x').isAuthFailure, code);
  assert.ok(new KsefError('unavailable', 'x') instanceof Error);
});
