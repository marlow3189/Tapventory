import test from 'node:test';
import assert from 'node:assert/strict';
import { composeName, handleBarcodeLookup, type BarcodeDeps, type CacheRow } from '../barcode-lookup/handler.ts';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const DAY = 86_400_000;

function setup(over: { cache?: CacheRow | null; responses?: Record<string, { status: number; body?: unknown } | Error> } = {}) {
  const log: { fetched: string[]; puts: unknown[]; headers: Record<string, string>[] } = { fetched: [], puts: [], headers: [] };
  const deps: BarcodeDeps = {
    auth: { getUserId: async (t) => (t === 'good' ? 'u1' : null) },
    cache: { get: async () => over.cache ?? null, put: async (row) => { log.puts.push(row); } },
    fetch: async (url, init) => {
      log.fetched.push(url);
      log.headers.push(init.headers);
      const host = new URL(url).host;
      const r = over.responses?.[host] ?? { status: 404 };
      if (r instanceof Error) throw r;
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
    },
    now: () => NOW,
    userAgent: 'Tapventory/1.0 (test@tapventory.com)',
  };
  return { deps, log };
}
const call = (deps: BarcodeDeps, body: unknown, token: string | null = 'good') =>
  handleBarcodeLookup(new Request('http://x/barcode', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }), deps);

test('składanie nazwy: marka, nazwa, ilość — bez dublowania', () => {
  assert.equal(composeName('Mleko UHT 3,2%', 'Łaciate', '1 l'), 'Łaciate Mleko UHT 3,2% 1 l');
  assert.equal(composeName('Łaciate Mleko', 'Łaciate', null), 'Łaciate Mleko');
  assert.equal(composeName('Woda 1,5 l', 'Żywiec, Nestlé', '1,5 l'), 'Żywiec Woda 1,5 l');
  assert.equal(composeName(null, null, null), null);
  assert.equal(composeName('x'.repeat(500), null, null)?.length, 300);
});

test('znaleziono w Open Food Facts: odpowiedź, zapis do pamięci podręcznej, własny User-Agent', async () => {
  const { deps, log } = setup({ responses: { 'world.openfoodfacts.org': { status: 200, body: { status: 1, product: { product_name: 'Mleko UHT 3,2%', brands: 'Łaciate', quantity: '1 l' } } } } });
  const res = await call(deps, { ean: '5901234123457' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { found: true, name: 'Łaciate Mleko UHT 3,2% 1 l', cached: false });
  assert.match(log.fetched[0], /world\.openfoodfacts\.org\/api\/v2\/product\/5901234123457\.json/);
  assert.match(log.headers[0]['User-Agent'], /Tapventory/);
  assert.equal((log.puts[0] as { found: boolean; source: string }).found, true);
  assert.equal((log.puts[0] as { source: string }).source, 'openfoodfacts');
});

test('brak w Food Facts → próbujemy Beauty Facts; nigdzie → found:false i zapis (cache negatywny)', async () => {
  const beauty = setup({ responses: { 'world.openfoodfacts.org': { status: 404 }, 'world.openbeautyfacts.org': { status: 200, body: { status: 1, product: { product_name: 'Szampon 250 ml', brands: 'Elseve' } } } } });
  const r1 = await call(beauty.deps, { ean: '5901234123457' });
  assert.deepEqual(await r1.json(), { found: true, name: 'Elseve Szampon 250 ml', cached: false });
  assert.equal(beauty.log.fetched.length, 2);

  const none = setup({ responses: { 'world.openfoodfacts.org': { status: 200, body: { status: 0 } }, 'world.openbeautyfacts.org': { status: 404 } } });
  const r2 = await call(none.deps, { ean: '5901234123457' });
  assert.deepEqual(await r2.json(), { found: false, name: null, cached: false });
  assert.equal((none.log.puts[0] as { found: boolean }).found, false);
});

test('pamięć podręczna: świeży wpis bez zapytania; znaleziony ważny 30 dni, nieznaleziony 7', async () => {
  const row = (found: boolean, ageDays: number): CacheRow => ({ ean: '5901234123457', found, name: found ? 'Mleko' : null, brand: null, quantity: null, source: 'openfoodfacts', fetched_at: new Date(NOW - ageDays * DAY).toISOString() });
  const fresh = setup({ cache: row(true, 29) });
  assert.deepEqual(await (await call(fresh.deps, { ean: '5901234123457' })).json(), { found: true, name: 'Mleko', cached: true });
  assert.equal(fresh.log.fetched.length, 0);

  const stale = setup({ cache: row(true, 31), responses: { 'world.openfoodfacts.org': { status: 404 } } });
  await call(stale.deps, { ean: '5901234123457' });
  assert.ok(stale.log.fetched.length > 0, 'po 30 dniach pytamy ponownie');

  assert.equal(setup({ cache: row(false, 6) }).log.fetched.length, 0);
  const miss = setup({ cache: row(false, 8), responses: { 'world.openfoodfacts.org': { status: 404 } } });
  await call(miss.deps, { ean: '5901234123457' });
  assert.ok(miss.log.fetched.length > 0, 'nieznaleziony po 7 dniach — próbujemy ponownie');
});

test('walidacja i uwierzytelnienie; awaria wszystkich źródeł → 502', async () => {
  const { deps } = setup();
  assert.equal((await call(deps, { ean: '123' })).status, 400);
  assert.equal((await call(deps, { ean: '5901234123458' })).status, 400, 'zła suma kontrolna');
  assert.equal((await call(deps, { ean: '5901234123457' }, null)).status, 401);
  assert.equal((await call(deps, { ean: '5901234123457' }, 'zly')).status, 401);
  const down = setup({ responses: { 'world.openfoodfacts.org': new Error('offline'), 'world.openbeautyfacts.org': new Error('offline') } });
  const res = await call(down.deps, { ean: '5901234123457' });
  assert.equal(res.status, 502);
  assert.equal(down.log.puts.length, 0, 'awarii nie zapisujemy jako „nie znaleziono”');
});
