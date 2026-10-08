import test from 'node:test';
import assert from 'node:assert/strict';
import { KsefClient, authFailure, mapClientError, normalizeMetadataPage, parseRetryAfter } from '../_shared/ksef/client.ts';
import { KSEF_BASE_URL, KsefError, type KsefSession } from '../_shared/ksef/types.ts';
import { FakeKsef, makeKsefNumber, metaFor } from './ksef-fixtures.ts';

const res = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function setup(server: FakeKsef, over: Partial<ConstructorParameters<typeof KsefClient>[0]> = {}) {
  const sleeps: number[] = [];
  const client = new KsefClient({
    environment: 'test', fetch: server.fetch, sleep: async (ms) => { sleeps.push(ms); }, now: server.now,
    authPollIntervalMs: 500, ...over,
  });
  return { client, sleeps };
}

async function expectKsefError(p: Promise<unknown>, code: string, messagePart?: RegExp): Promise<KsefError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof KsefError, `oczekiwano KsefError, jest ${e}`);
    assert.equal(e.code, code, `${e.code}: ${e.message}`);
    if (messagePart) assert.match(e.message, messagePart);
    return e;
  }
  assert.fail('oczekiwano błędu');
}

test('adresy środowisk wskazują na oficjalne hosty MF', () => {
  assert.equal(KSEF_BASE_URL.prod, 'https://api.ksef.mf.gov.pl/v2');
  assert.equal(KSEF_BASE_URL.demo, 'https://api-demo.ksef.mf.gov.pl/v2');
  assert.equal(KSEF_BASE_URL.test, 'https://api-test.ksef.mf.gov.pl/v2');
});

test('logowanie tokenem: pełny przebieg zgodny z kontraktem KSeF 2.0', async () => {
  const server = await new FakeKsef({ pollsBeforeSuccess: 2 }).init();
  const { client, sleeps } = setup(server);
  const session = await client.authenticate(server.token, server.nip);
  assert.equal(session.accessToken, 'ACCESS-JWT');

  assert.deepEqual(server.calledPaths(), [
    'POST /auth/challenge', 'GET /security/public-key-certificates', 'POST /auth/ksef-token',
    'GET /auth/20260201-AU-0123456789-ABCDEF0123-01', 'GET /auth/20260201-AU-0123456789-ABCDEF0123-01', 'GET /auth/20260201-AU-0123456789-ABCDEF0123-01',
    'POST /auth/token/redeem',
  ]);
  // serwer rozszyfrował dokładnie "token|timestampMs" kluczem prywatnym (jak serwer MF)
  assert.deepEqual(server.decrypted, [`${server.token}|${server.now()}`]);
  const submit = server.calls.find((c) => c.path === '/auth/ksef-token')!;
  assert.deepEqual((submit.body as Record<string, unknown>).contextIdentifier, { type: 'Nip', value: '5260250995' });
  assert.equal((submit.body as Record<string, unknown>).publicKeyId, server.currentKeyId);
  assert.equal(submit.headers['x-error-format'], 'problem-details');
  assert.equal(submit.headers['content-type'], 'application/json');
  assert.equal(server.calls.find((c) => c.path === '/auth/token/redeem')!.headers.authorization, 'Bearer AUTH-JWT');
  assert.deepEqual(sleeps, [500, 500], 'dwa oczekiwania między sprawdzeniami statusu');
});

test('certyfikat do szyfrowania: wybierany po przeznaczeniu i ważności, pobierany raz na godzinę', async () => {
  const server = await new FakeKsef().init();
  let t = server.now();
  server.now = () => t;
  const client = new KsefClient({ environment: 'test', fetch: server.fetch, sleep: async () => {}, now: () => t, authPollIntervalMs: 1 });
  const certFetches = () => server.calls.filter((c) => c.path === '/security/public-key-certificates').length;
  await client.authenticate(server.token, server.nip);
  await client.authenticate(server.token, server.nip);
  assert.equal(certFetches(), 1, 'drugi raz klucz bierzemy z pamięci');
  t += 50 * 60_000;
  await client.authenticate(server.token, server.nip);
  assert.equal(certFetches(), 1, 'po 50 minutach nadal z pamięci');
  t += 11 * 60_000;
  await client.authenticate(server.token, server.nip);
  assert.equal(certFetches(), 2, 'po godzinie pobieramy ponownie');
  // wybrany został certyfikat „tok” (a nie wygasły ani przeznaczony do kluczy symetrycznych)
  const submit = server.calls.filter((c) => c.path === '/auth/ksef-token').pop()!;
  assert.equal((submit.body as { publicKeyId: string }).publicKeyId, server.currentKeyId);
});

test('wycofany klucz (kod 21470): odświeżenie certyfikatów i jedna ponowna próba', async () => {
  const server = await new FakeKsef().init();
  const stale = server.currentKeyId;
  server.rejectKeyId = stale;
  // pierwsza odpowiedź na listę certyfikatów ma "stary" klucz, druga — nowy
  const fresh = 'B'.repeat(43) + '=';
  const original = server.certs.map((c) => ({ ...c }));
  let served = 0;
  const realFetch = server.fetch;
  const fetchSwitch = async (url: string, init?: RequestInit) => {
    const r = await realFetch(url, init);
    if (url.endsWith('/security/public-key-certificates')) {
      served++;
      if (served === 2) {
        server.currentKeyId = fresh;
        server.certs = original.map((c) => (c.certificateId === 'tok' ? { ...c, publicKeyId: fresh } : c));
        return realFetch(url, init);
      }
    }
    return r;
  };
  const client = new KsefClient({ environment: 'test', fetch: fetchSwitch, sleep: async () => {}, now: server.now, authPollIntervalMs: 1 });
  const session = await client.authenticate(server.token, server.nip);
  assert.equal(session.accessToken, 'ACCESS-JWT');
  assert.equal(server.calls.filter((c) => c.path === '/auth/ksef-token').length, 2);
  assert.equal(served, 2);
});

test('błędy logowania mapowane na czytelne komunikaty i kody', async () => {
  const cases: [number, string[], string, RegExp][] = [
    [450, ['Nieprawidłowy token'], 'token_rejected', /nie rozpoznał tokenu/],
    [450, ['Token unieważniony'], 'token_rejected', /unieważniony/],
    [450, ['Token nieaktywny'], 'token_rejected', /nieaktywny/],
    [450, ['Token nie może być użyty w kontekście Nip:123'], 'token_rejected', /innej firmy/],
    [450, ['Nieprawidłowy czas tokena'], 'unavailable', /Chwilowy błąd/],
    [450, ['Nieprawidłowe szyfrowanie tokena'], 'bad_response', /po naszej stronie/],
    [415, [], 'no_permission', /uprawnień/],
    [425, [], 'token_rejected', /unieważniony/],
    [480, [], 'token_rejected', /zablokował/],
    [550, [], 'unavailable', /przerwał/],
  ];
  for (const [code, details, expectedCode, re] of cases) {
    const server = await new FakeKsef().init();
    server.authStatusCode = code;
    server.authStatusDetails = details;
    const e = await expectKsefError(setup(server).client.authenticate(server.token, server.nip), expectedCode, re);
    assert.ok(!e.message.includes(server.token), 'komunikat nie może zawierać tokenu');
    assert.ok(!(e.detail ?? '').includes(server.token));
  }
});

test('zły token w prawdziwym przebiegu (KSeF odpowiada 202, a błąd widać dopiero w statusie)', async () => {
  const server = await new FakeKsef().init();
  const e = await expectKsefError(setup(server).client.authenticate('ZLY-TOKEN-0123456789012345', server.nip), 'token_rejected', /nie rozpoznał/);
  assert.equal(e.isAuthFailure, true);
});

test('zły NIP firmy → KSeF odrzuca kontekst; niepoprawne dane wejściowe nie dochodzą do sieci', async () => {
  const server = await new FakeKsef().init();
  const { client } = setup(server);
  await expectKsefError(client.authenticate(server.token, '1234563218'), 'rejected');           // serwer zna inny NIP
  const before = server.calls.length;
  await expectKsefError(client.authenticate(server.token, '12345'), 'invalid_input');
  await expectKsefError(client.authenticate('ma spacje', server.nip), 'invalid_input');
  await expectKsefError(client.authenticate('', server.nip), 'invalid_input');
  assert.equal(server.calls.length, before);
});

test('logowanie, które nie kończy się w czasie: błąd „unavailable”, a nie pętla bez końca', async () => {
  const server = await new FakeKsef({ pollsBeforeSuccess: 1000 }).init();
  let t = server.now();
  const client = new KsefClient({ environment: 'test', fetch: server.fetch, sleep: async (ms) => { t += ms; }, now: () => t, authPollIntervalMs: 1000, authTimeoutMs: 5000 });
  server.now = () => t;
  await expectKsefError(client.authenticate(server.token, server.nip), 'unavailable', /zbyt długo/);
  assert.ok(server.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/auth/2')).length <= 7);
});

test('429: krótkie Retry-After jest odczekane, długie kończy się błędem z czasem powrotu', async () => {
  const server = await new FakeKsef().init();
  server.force('/auth/challenge', res({ status: { code: 429 } }, 429, { 'retry-after': '3' }));
  const { client, sleeps } = setup(server);
  await client.authenticate(server.token, server.nip);
  assert.deepEqual(sleeps.slice(0, 1), [3000]);

  const server2 = await new FakeKsef().init();
  server2.force('/auth/challenge', res({}, 429, { 'retry-after': '120' }));
  const e = await expectKsefError(setup(server2).client.authenticate(server2.token, server2.nip), 'rate_limited');
  assert.equal(e.retryAfterSec, 120);
  assert.equal(e.status, 429);

  const server3 = await new FakeKsef().init();
  server3.force('/auth/challenge', res({}, 429), res({}, 429), res({}, 429), res({}, 429));      // bez nagłówka: domyślnie 30 s → za długo
  const e3 = await expectKsefError(setup(server3).client.authenticate(server3.token, server3.nip), 'rate_limited');
  assert.equal(e3.retryAfterSec, 30);
});

test('5xx i błędy sieci: dwie ponowne próby z rosnącą przerwą, potem „unavailable”', async () => {
  const server = await new FakeKsef().init();
  server.force('/auth/challenge', res({}, 503), res({}, 502));
  const { client, sleeps } = setup(server);
  await client.authenticate(server.token, server.nip);
  assert.deepEqual(sleeps.slice(0, 2), [1000, 2000]);

  const server2 = await new FakeKsef().init();
  server2.force('/auth/challenge', res({}, 500), res({}, 500), res({}, 500));
  await expectKsefError(setup(server2).client.authenticate(server2.token, server2.nip), 'unavailable', /nie działa/);

  let calls = 0;
  const flaky = async (url: string, init?: RequestInit) => {
    if (++calls <= 2) throw new TypeError('fetch failed');
    return server.fetch(url, init);
  };
  const c3 = new KsefClient({ environment: 'test', fetch: flaky, sleep: async () => {}, now: server.now, authPollIntervalMs: 1 });
  await c3.authenticate(server.token, server.nip);
  const dead = new KsefClient({ environment: 'test', fetch: async () => { throw new DOMException('timeout', 'TimeoutError'); }, sleep: async () => {} });
  await expectKsefError(dead.authenticate(server.token, server.nip), 'unavailable', /nie odpowiada/);
});

test('lista faktur: filtry podmiotu 2, data PermanentStorage, ograniczenie do HWM, numer STRONY i rozmiar strony', async () => {
  const invoices = Array.from({ length: 25 }, (_v, i) => metaFor(makeKsefNumber(i + 1), { permanentStorageDate: new Date(Date.parse('2026-01-10T00:00:00Z') + i * 3600_000).toISOString() }));
  const server = await new FakeKsef({ invoices }).init();
  const { client } = setup(server);
  const session = await client.authenticate(server.token, server.nip);

  const p0 = await client.queryMetadata(session, { from: '2026-01-01T00:00:00.000Z' }, 0, 10);
  const p1 = await client.queryMetadata(session, { from: '2026-01-01T00:00:00.000Z' }, 1, 10);
  const p2 = await client.queryMetadata(session, { from: '2026-01-01T00:00:00.000Z' }, 2, 10);
  assert.deepEqual([p0.invoices.length, p1.invoices.length, p2.invoices.length], [10, 10, 5]);
  assert.deepEqual([p0.hasMore, p1.hasMore, p2.hasMore], [true, true, false]);
  assert.equal(p0.permanentStorageHwmDate, '2026-02-01T11:59:00.000Z');
  assert.equal(p0.invoices[0].ksefNumber, makeKsefNumber(1));
  assert.equal(p2.invoices[4].ksefNumber, makeKsefNumber(25));

  const call = server.calls.filter((c) => c.path === '/invoices/query/metadata')[1];
  assert.deepEqual(call.query, { sortOrder: 'Asc', pageOffset: '1', pageSize: '10' });
  assert.deepEqual(call.body, { subjectType: 'Subject2', dateRange: { dateType: 'PermanentStorage', from: '2026-01-01T00:00:00.000Z', restrictToPermanentStorageHwmDate: true } });
  assert.equal(call.headers.authorization, 'Bearer ACCESS-JWT');

  await client.queryMetadata(session, { from: '2026-01-01T00:00:00.000Z', to: '2026-01-10T05:00:00.000Z' }, 0, 500);
  const last = server.calls.filter((c) => c.path === '/invoices/query/metadata').pop()!;
  assert.equal((last.body as { dateRange: { to: string } }).dateRange.to, '2026-01-10T05:00:00.000Z');
  assert.equal(last.query.pageSize, '250', 'rozmiar strony ograniczony do maksimum KSeF');
});

test('lista faktur: błędny szkielet to „bad_response”; pojedyncze wadliwe rekordy są pomijane', () => {
  for (const bad of [null, [], {}, { invoices: 'x', hasMore: false, isTruncated: false }, { invoices: [], hasMore: 'no', isTruncated: false }]) {
    assert.throws(() => normalizeMetadataPage(bad), (e: KsefError) => e.code === 'bad_response');
  }
  const good = metaFor(makeKsefNumber(1));
  const page = normalizeMetadataPage({
    hasMore: false, isTruncated: false, permanentStorageHwmDate: null,
    invoices: [good, { ksefNumber: 'BAD' }, null, { ...good, ksefNumber: makeKsefNumber(2), permanentStorageDate: 'nie-data' }, { ...good, ksefNumber: makeKsefNumber(3), seller: undefined }],
  });
  assert.deepEqual(page.invoices.map((i) => i.ksefNumber), [makeKsefNumber(1), makeKsefNumber(3)]);
  assert.equal(page.invoices[1].seller.nip, '');
  assert.equal(page.permanentStorageHwmDate, null);
});

test('pobranie XML faktury: nagłówki, błędy 403/404, pusta odpowiedź i zły numer', async () => {
  const n = makeKsefNumber(5);
  const server = await new FakeKsef({ xml: { [n]: '<Faktura>ok</Faktura>' } }).init();
  const { client } = setup(server);
  const session = await client.authenticate(server.token, server.nip);
  assert.equal(await client.downloadInvoice(session, n), '<Faktura>ok</Faktura>');
  const call = server.calls.find((c) => c.path === `/invoices/ksef/${n}`)!;
  assert.equal(call.headers.accept, 'application/xml');
  assert.equal(call.headers.authorization, 'Bearer ACCESS-JWT');

  await expectKsefError(client.downloadInvoice(session, makeKsefNumber(6)), 'rejected', /nie znalazł/);
  const before = server.calls.length;
  for (const bad of ['', '../auth/challenge', `${n}/../x`, n.toLowerCase(), 'x'.repeat(35)]) {
    await expectKsefError(client.downloadInvoice(session, bad), 'invalid_input');
  }
  assert.equal(server.calls.length, before, 'zły numer nie powoduje żadnego żądania (ochrona przed podmianą ścieżki)');

  server.force(`/invoices/ksef/${n}`, res('   ', 200, { 'content-type': 'application/xml' }));
  await expectKsefError(client.downloadInvoice(session, n), 'bad_response', /pustą/);
  server.force(`/invoices/ksef/${n}`, res({ title: 'Forbidden' }, 403));
  await expectKsefError(client.downloadInvoice(session, n), 'no_permission');
  server.force(`/invoices/ksef/${n}`, res({ title: 'Unauthorized' }, 401));
  const e401 = await expectKsefError(client.downloadInvoice(session, n), 'token_rejected');
  assert.equal(e401.status, 401, 'status 401 pozwala synchronizacji zalogować się ponownie');
});

test('pomocnicze: Retry-After w sekundach i jako data, mapowanie kodów HTTP', () => {
  assert.equal(parseRetryAfter('30'), 30);
  assert.equal(parseRetryAfter(' 2.2 '), 3);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter('abc'), null);
  assert.ok((parseRetryAfter(new Date(Date.now() + 10_000).toUTCString()) ?? 0) >= 8);
  assert.equal(mapClientError(401, '').code, 'token_rejected');
  assert.equal(mapClientError(403, '').code, 'no_permission');
  assert.equal(mapClientError(404, '').code, 'rejected');
  assert.equal(mapClientError(400, '{"exception":{"x":21470}}').detail?.includes('21470'), true);
  assert.equal(authFailure(undefined).code, 'rejected');
  assert.equal(authFailure(450, 'x', ['Token nieaktywny']).code, 'token_rejected');
});

test('odpowiedź JSON, której nie da się odczytać, to „bad_response”', async () => {
  const server = await new FakeKsef().init();
  server.force('/auth/challenge', new Response('{niepoprawny json', { status: 200, headers: { 'content-type': 'application/json' } }));
  await expectKsefError(setup(server).client.authenticate(server.token, server.nip), 'bad_response');
  const server2 = await new FakeKsef().init();
  server2.force('/auth/challenge', res({ challenge: 5 }));
  await expectKsefError(setup(server2).client.authenticate(server2.token, server2.nip), 'bad_response', /wyzwanie/);
  const server3 = await new FakeKsef().init();
  server3.certs = server3.certs.map((c) => ({ ...c, usage: ['SymmetricKeyEncryption'] }));
  await expectKsefError(setup(server3).client.authenticate(server3.token, server3.nip), 'bad_response', /klucza/);
});

// pomocnicza sesja do testów synchronizacji
export const fakeSession: KsefSession = { accessToken: 'ACCESS-JWT', validUntil: '2026-02-01T12:15:00Z' };
