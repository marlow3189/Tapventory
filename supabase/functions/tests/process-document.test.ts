import test from 'node:test';
import assert from 'node:assert/strict';
import { ReserveError, handleProcessDocument, type DocumentRow, type ProcessDeps, type ScanStatus } from '../process-document/handler.ts';
import { ProviderError } from '../_shared/provider.ts';
import { ScriptedProvider, badInvoiceJson, goodInvoiceJson } from './helpers.ts';

const DOC_ID = '44444444-4444-4444-8444-444444444444';
const TENANT = '22222222-2222-4222-8222-222222222222';

type Ctx = { deps: ProcessDeps; jobs: Promise<unknown>[]; log: { applied: unknown[]; failed: string[]; finished: { model: string; status: ScanStatus; tokensIn: number; cost: number }[]; reserved: number } };

function setup(over: { doc?: Partial<DocumentRow> | null; manager?: boolean; userId?: string | null; reserve?: Error | number; provider?: ScriptedProvider; files?: Record<string, { bytes: Uint8Array; contentType: string | null }>; config?: Partial<ProcessDeps['config']> } = {}): Ctx {
  const jobs: Promise<unknown>[] = [];
  const log: Ctx['log'] = { applied: [], failed: [], finished: [], reserved: 0 };
  const doc: DocumentRow | null = over.doc === null ? null : { id: DOC_ID, tenant_id: TENANT, status: 'processing', source: 'photo', file_paths: [`${TENANT}/documents/${DOC_ID}/page-1.jpg`], ...over.doc };
  const files = over.files ?? { [`${TENANT}/documents/${DOC_ID}/page-1.jpg`]: { bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/jpeg' } };
  const deps: ProcessDeps = {
    auth: { getUserId: async (t) => (over.userId === undefined ? (t === 'good-token' ? 'user-1' : null) : over.userId) },
    db: {
      getDocument: async () => doc,
      isManager: async () => over.manager ?? true,
      reserveScan: async () => {
        if (over.reserve instanceof Error) throw over.reserve;
        log.reserved += 1;
        return typeof over.reserve === 'number' ? over.reserve : 77;
      },
      finishScan: async (_id, model, tokensIn, _out, cost, status) => { log.finished.push({ model, status, tokensIn, cost }); },
      applyExtraction: async (_id, payload) => { log.applied.push(payload); return { status: 'draft' }; },
      failDocument: async (_id, message) => { log.failed.push(message); },
    },
    storage: {
      download: async (path) => {
        const f = files[path];
        if (!f) throw new Error('nie ma pliku');
        return f;
      },
    },
    provider: over.provider ?? new ScriptedProvider([{ json: goodInvoiceJson() }]),
    config: { fastModel: 'claude-haiku-5-5', strongModel: 'claude-sonnet-5-5', fastEffort: 'medium', strongEffort: 'high', escalate: true, maxPages: 10, maxTotalBytes: 24 * 1024 * 1024, timeoutMs: 5000, ...over.config },
    waitUntil: (p) => { jobs.push(p); },
  };
  return { deps, jobs, log };
}

const call = (ctx: Ctx, init: { method?: string; token?: string | null; body?: unknown } = {}) =>
  handleProcessDocument(
    new Request('http://localhost/functions/v1/process-document', {
      method: init.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? 'good-token'}` }) },
      body: init.method === 'GET' || init.method === 'OPTIONS' ? undefined : JSON.stringify(init.body ?? { document_id: DOC_ID }),
    }),
    ctx.deps
  );

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

test('szczęśliwa ścieżka: 202 od razu, odczyt w tle, zapis w bazie i rozliczenie kosztu', async () => {
  const ctx = setup({ provider: new ScriptedProvider([{ json: goodInvoiceJson(), delayMs: 40 }]) });
  const res = await call(ctx);
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { ok: true, status: 'processing' });
  assert.equal(ctx.log.applied.length, 0, 'odpowiedź wraca zanim model skończy (telefon nie czeka)');
  await Promise.all(ctx.jobs);
  assert.equal(ctx.log.applied.length, 1);
  const payload = ctx.log.applied[0] as { supplier_nip: string; lines: unknown[]; ai_model: string };
  assert.equal(payload.supplier_nip, '5260250995');
  assert.equal(payload.lines.length, 3);
  assert.equal(payload.ai_model, 'claude-haiku-5-5');
  assert.deepEqual(ctx.log.finished, [{ model: 'claude-haiku-5-5', status: 'ok', tokensIn: 3000, cost: 700 }]);
  assert.deepEqual(ctx.log.failed, []);
});

test('uwierzytelnienie i uprawnienia: brak tokenu, zły token, pracownik, obca firma, zła metoda', async () => {
  assert.equal((await call(setup(), { token: null })).status, 401);
  assert.equal((await call(setup(), { token: 'zly' })).status, 401);
  const forbidden = await call(setup({ manager: false }));
  assert.equal(forbidden.status, 403);
  assert.equal((await errorOf(forbidden)).code, 'forbidden');
  assert.equal((await call(setup(), { method: 'GET' })).status, 405);
  const options = await call(setup(), { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.ok(options.headers.get('access-control-allow-origin'));
});

test('walidacja żądania i stanu dokumentu', async () => {
  assert.equal((await call(setup(), { body: { document_id: 'nie-uuid' } })).status, 400);
  assert.equal((await call(setup(), { body: {} })).status, 400);
  assert.equal((await call(setup({ doc: null }))).status, 404);
  assert.equal((await call(setup({ doc: { source: 'manual' } }))).status, 400);
  // dokument już odczytany: odpowiedź 200 bez rezerwowania limitu i bez wywołania modelu
  const done = setup({ doc: { status: 'draft' } });
  const r = await call(done);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, status: 'draft' });
  assert.equal(done.log.reserved, 0);
  assert.equal(done.jobs.length, 0);
});

test('limit planu wyczerpany: 429, dokument oznaczony jako nieudany, model nie jest wołany', async () => {
  const provider = new ScriptedProvider([{ json: goodInvoiceJson() }]);
  const ctx = setup({ reserve: new ReserveError('AI_QUOTA_EXCEEDED'), provider });
  const res = await call(ctx);
  assert.equal(res.status, 429);
  assert.equal((await errorOf(res)).code, 'quota');
  assert.equal(ctx.log.failed.length, 1);
  assert.match(ctx.log.failed[0], /limit skanów/);
  assert.equal(provider.calls.length, 0);
  assert.equal(ctx.jobs.length, 0);
});

test('ten sam dokument już jest przetwarzany: 202 bez drugiego odczytu', async () => {
  const provider = new ScriptedProvider([{ json: goodInvoiceJson() }]);
  const ctx = setup({ reserve: new ReserveError('AI_ALREADY_PROCESSING'), provider });
  const res = await call(ctx);
  assert.equal(res.status, 202);
  assert.equal(ctx.jobs.length, 0);
  assert.equal(provider.calls.length, 0);
});

test('błędy odczytu zamieniają się w czytelne komunikaty przy dokumencie i zwalniają limit', async () => {
  const cases: [ProviderError, RegExp, ScanStatus][] = [
    [new ProviderError('refusal', 'x'), /odmówił/, 'refused'],
    [new ProviderError('truncated', 'x'), /zbyt długi/, 'error'],
    [new ProviderError('timeout', 'x'), /zbyt długo/, 'error'],
    [new ProviderError('unavailable', 'Usługa AI jest chwilowo niedostępna.'), /niedostępna/, 'error'],
  ];
  for (const [err, pattern, status] of cases) {
    // refusal/truncated: potok próbuje jeszcze mocniejszego modelu, więc oba kroki zwracają ten sam błąd
    const ctx = setup({ provider: new ScriptedProvider([{ error: err }, { error: err }]) });
    assert.equal((await call(ctx)).status, 202);
    await Promise.all(ctx.jobs);
    assert.equal(ctx.log.applied.length, 0, err.code);
    assert.match(ctx.log.failed[0], pattern, err.code);
    assert.equal(ctx.log.finished[0].status, status, err.code);
    assert.equal(ctx.log.finished[0].cost, 0);
  }
});

test('brak pliku w magazynie, zbyt wiele stron, zbyt duże pliki → dokument „failed” z wyjaśnieniem', async () => {
  const missing = setup({ doc: { file_paths: [`${TENANT}/documents/${DOC_ID}/nie-ma.jpg`] } });
  await call(missing); await Promise.all(missing.jobs);
  assert.match(missing.log.failed[0], /Nie znaleziono pliku/);

  const many = setup({ doc: { file_paths: Array.from({ length: 11 }, (_, i) => `${TENANT}/documents/${DOC_ID}/p${i}.jpg`) } });
  await call(many); await Promise.all(many.jobs);
  assert.match(many.log.failed[0], /najwyżej 10 stron/);

  const big = setup({ config: { maxTotalBytes: 3 } });
  await call(big); await Promise.all(big.jobs);
  assert.match(big.log.failed[0], /zbyt duże/);

  const none = setup({ doc: { file_paths: [] } });
  await call(none); await Promise.all(none.jobs);
  assert.match(none.log.failed[0], /nie ma żadnych stron/);
});

test('PDF i obrazy trafiają do modelu w dobrej formie, a kolejność stron jest zachowana', async () => {
  const p1 = `${TENANT}/documents/${DOC_ID}/page-1.pdf`;
  const p2 = `${TENANT}/documents/${DOC_ID}/page-2.png`;
  const provider = new ScriptedProvider([{ json: goodInvoiceJson() }]);
  const ctx = setup({
    provider,
    doc: { file_paths: [p1, p2] },
    files: { [p1]: { bytes: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf' }, [p2]: { bytes: new Uint8Array([1, 2]), contentType: null } },
  });
  await call(ctx); await Promise.all(ctx.jobs);
  assert.equal(provider.calls[0].pages, 2);
  assert.equal(ctx.log.applied.length, 1);
});

test('eskalacja z handlera: zły pierwszy odczyt → drugi mocniejszym modelem, koszt obu w rozliczeniu', async () => {
  const provider = new ScriptedProvider([{ json: badInvoiceJson() }, { json: goodInvoiceJson() }]);
  const ctx = setup({ provider });
  await call(ctx); await Promise.all(ctx.jobs);
  assert.equal(provider.calls.length, 2);
  assert.equal(ctx.log.finished[0].model, 'claude-sonnet-5-5');
  // Haiku: 3000×0,10 + 800×0,50 = 700;  Sonnet: 3000×2 + 800×10 = 14000
  assert.equal(ctx.log.finished[0].cost, 700 + 14000);
});

test('zapis w bazie zawodzi po odczycie → dokument „failed”, limit zwolniony (status error)', async () => {
  const ctx = setup();
  ctx.deps.db.applyExtraction = async () => { throw new Error('baza niedostępna'); };
  await call(ctx); await Promise.all(ctx.jobs);
  assert.equal(ctx.log.failed.length, 1);
  assert.equal(ctx.log.finished[0].status, 'error');
});
