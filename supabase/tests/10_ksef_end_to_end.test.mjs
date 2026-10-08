// ============================================================================
// KSeF od końca do końca: „fałszywy KSeF" (prawdziwe RSA, prawdziwy protokół) → klient → parser FA →
// synchronizacja → PRAWDZIWY Postgres z migracjami. Wyłapuje rozjazdy między kodem TypeScript
// (kształt danych, nazwy parametrów RPC) a funkcjami SQL z migracji 0011.
// Nie testuje tylko jednego: rozmowy z prawdziwym serwerem MF (patrz docs/10_KSEF.md, „co sprawdzić na TEST").
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, ownerWithTenant, asService, insertProduct } from './helpers.mjs';
import { FakeKsef, faXml, makeKsefNumber, metaFor } from '../functions/tests/ksef-fixtures.ts';
import { KsefClient } from '../functions/_shared/ksef/client.ts';
import { claimSync, executeSync, startDueSyncs } from '../functions/_shared/ksef/sync.ts';
import { openToken, sealToken } from '../functions/_shared/ksef/token-vault.ts';

let db;
test.before(async () => { db = await createTestDb(); });
test.after(async () => { await db.drop(); });

const KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const hourly = (i) => new Date(Date.parse('2026-01-10T00:00:00Z') + i * 3_600_000).toISOString();
const HWM = '2026-02-01T11:59:00.000Z';

/** Adapter bazy dla synchronizacji — te same wywołania RPC, które w produkcji wykonuje supabase-js. */
function sqlAdapter() {
  const rpc = async (sql, params) => (await asService(db).query(sql, params)).rows[0];
  return {
    claim: async (tenant, trigger) => (await rpc('select public.claim_ksef_sync($1, $2) as r', [tenant, trigger])).r,
    knownNumbers: async (tenant, numbers) => (await rpc('select public.ksef_known_numbers($1, $2) as r', [tenant, numbers])).r,
    importInvoice: async (tenant, number, payload, xml, sha) =>
      (await rpc('select public.import_ksef_invoice($1, $2, $3::jsonb, $4, $5) as r', [tenant, number, JSON.stringify(payload), xml, sha])).r,
    finish: async (a) => {
      await rpc('select public.finish_ksef_sync($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [a.runId, a.status, a.listed, a.imported, a.linked, a.skipped, a.failed, a.error, a.cursor, a.authFailed, a.retryAfterSec]);
    },
    dueTenants: async (limit) => (await asService(db).query('select tenant_id from public.due_ksef_tenants($1)', [limit])).rows.map((r) => r.tenant_id),
  };
}

async function scenario(label) {
  const T = await ownerWithTenant(db, label);
  const server = await new FakeKsef().init();
  const ciphertext = await sealToken(server.token, [KEY], T.tenantId);
  await asService(db).query(`select public.save_ksef_connection($1, $2, 'test', $3, $4, 'ab12', '2026-01-01')`, [T.tenantId, T.owner.id, server.nip, ciphertext]);
  const deps = {
    db: sqlAdapter(),
    openToken: (cipher, tenantId) => openToken(cipher, [KEY], tenantId),
    makeApi: (environment) => new KsefClient({ environment, fetch: server.fetch, sleep: async () => {}, now: server.now, authPollIntervalMs: 1 }),
    now: () => server.now(),
    sleep: async () => {},
    limits: { downloadGapMs: 0 },
    log: () => {},
  };
  return { T, server, deps };
}

const sync = async (S, trigger = 'connect') => {
  const claim = await claimSync(S.deps, S.T.tenantId, trigger);
  assert.equal(claim.claimed, true, JSON.stringify(claim));
  return executeSync(S.deps, S.T.tenantId, claim);
};

test('pełny obieg: faktury z KSeF trafiają do bazy jako szkice z pozycjami, dopasowaniem i powiadomieniem', async () => {
  const S = await scenario('E1');
  const gloves = await insertProduct(db, S.T.tenantId, 'Rękawice nitrylowe L', { unit: 'op.' });
  const [n1, n2, n3, n4] = [1, 2, 3, 4].map((i) => makeKsefNumber(i));
  S.server.invoices = [
    metaFor(n1, { permanentStorageDate: hourly(0), invoiceNumber: 'FV/1' }),
    metaFor(n2, { permanentStorageDate: hourly(1), invoiceNumber: 'KOR/1', invoiceType: 'Kor' }),
    metaFor(n3, { permanentStorageDate: hourly(2), invoiceNumber: 'PEF/1', invoiceType: 'VatPef', formCode: { systemCode: 'PEF (3)', schemaVersion: '2-1', value: 'PEF' } }),
    metaFor(n4, { permanentStorageDate: hourly(3), invoiceNumber: 'FV/4', seller: { nip: '9999999999', name: 'Inny Dostawca' } }),
  ];
  const ean = '5901234123457';
  await db.admin.query(`update public.products set ean = $1 where id = $2`, [ean, await insertProduct(db, S.T.tenantId, 'Mleko UHT 3,2%', { unit: 'szt.' })]);
  S.server.xml = {
    [n1]: faXml({ number: 'FV/1', lines: [
      { name: 'Rękawice nitrylowe L', unit: 'op.', qty: 3, unitNet: 24.5, net: 73.5 },
      { name: 'Całkiem inna nazwa', gtin: ean, unit: 'szt.', qty: 6, unitNet: 3, net: 18 },
      { name: 'Transport', unit: 'usł.', qty: 1, unitNet: 15, net: 15 },
      { name: 'Nieznany towar xyz', qty: 2, unitNet: 10, net: 20, rate: 'zw' },
    ], net23: 126.5, vat23: 29.1, gross: 155.6 }),
    [n2]: faXml({ number: 'KOR/1', type: 'KOR', lines: [
      { name: 'Rękawice nitrylowe L', unit: 'op.', qty: 3, unitNet: 24.5, net: 73.5, before: true },
      { name: 'Rękawice nitrylowe L', unit: 'op.', qty: 1, unitNet: 24.5, net: 24.5 },
    ], net23: -49, vat23: -11.27, gross: -60.27 }),
    [n3]: '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>PEF/1</ID></Invoice>',
    [n4]: faXml({ number: 'FV/4', nip: '9999999999', sellerName: 'Inny Dostawca', lines: [{ name: 'Rękawice nitrylowe L', unit: 'op.', qty: 10, unitNet: 20, net: 200 }] }),
  };
  // numer NIP sprzedawcy musi mieć poprawną sumę kontrolną, by powstał rekord dostawcy
  const out = await sync(S);
  assert.deepEqual({ status: out.status, listed: out.listed, imported: out.imported, failed: out.failed, error: out.error }, { status: 'ok', listed: 4, imported: 4, failed: 0, error: null });
  assert.equal(out.cursor, HWM);

  const docs = (await db.admin.query(`select * from public.documents where tenant_id = $1 order by invoice_number`, [S.T.tenantId])).rows;
  assert.deepEqual(docs.map((d) => [d.invoice_number, d.source, d.status, d.doc_kind, d.ksef_number]), [
    ['FV/1', 'ksef', 'draft', 'invoice', n1], ['FV/4', 'ksef', 'draft', 'invoice', n4], ['KOR/1', 'ksef', 'draft', 'correction', n2], ['PEF/1', 'ksef', 'draft', 'invoice', n3],
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const byNo = Object.fromEntries(docs.map((d) => [d.invoice_number, d]));

  // zwykła faktura: pozycje, dopasowanie po nazwie i po EAN, pomijany transport, stawka zw → NULL
  const lines = (await db.admin.query(`select * from public.document_lines where document_id = $1 order by line_no`, [byNo['FV/1'].id])).rows;
  assert.deepEqual(lines.map((l) => [l.raw_name, Number(l.qty), l.unit, Number(l.unit_price_net), Number(l.total_net), l.vat_rate === null ? null : Number(l.vat_rate), l.skip, l.ean]), [
    ['Rękawice nitrylowe L', 3, 'op.', 24.5, 73.5, 23, false, null],
    ['Całkiem inna nazwa', 6, 'szt.', 3, 18, 23, false, ean],
    ['Transport', 1, 'usł.', 15, 15, 23, true, null],
    ['Nieznany towar xyz', 2, 'szt.', 10, 20, null, false, null],
  ]);
  assert.equal(lines[0].product_id, gloves, 'po nazwie');
  assert.ok(lines[1].product_id && lines[1].product_id !== gloves, 'po kodzie EAN, mimo innej nazwy');
  assert.equal(lines[3].product_id, null);
  assert.equal(Number(byNo['FV/1'].total_gross), 155.6);
  assert.equal(byNo['FV/1'].ai_warnings[0].code, 'ksef_skipped_lines');
  assert.equal(byNo['FV/1'].created_by, null);

  // korekta: do bazy trafia różnica, minus 2 sztuki
  const kor = (await db.admin.query(`select * from public.document_lines where document_id = $1`, [byNo['KOR/1'].id])).rows;
  assert.deepEqual(kor.map((l) => [Number(l.qty), Number(l.total_net)]), [[-2, -49]]);
  assert.equal(kor[0].product_id, gloves);

  // PEF: sam nagłówek z listy metadanych
  const pef = (await db.admin.query(`select count(*)::int n from public.document_lines where document_id = $1`, [byNo['PEF/1'].id])).rows[0].n;
  assert.equal(pef, 0);
  assert.equal(byNo['PEF/1'].ai_warnings[0].code, 'ksef_header_only');
  assert.equal(byNo['PEF/1'].supplier_nip, '1234563218');

  // dostawcy powstali z faktur; surowy XML zarchiwizowany ze skrótem
  const suppliers = (await db.admin.query(`select nip from public.suppliers where tenant_id = $1 order by nip`, [S.T.tenantId])).rows.map((r) => r.nip);
  assert.deepEqual(suppliers, ['1234563218', '9999999999']);
  const raw = (await db.admin.query(`select count(*)::int n, bool_and(sha256 ~ '^[0-9a-f]{64}$') ok from public.ksef_raw_invoices where tenant_id = $1`, [S.T.tenantId])).rows[0];
  assert.deepEqual({ ...raw }, { n: 4, ok: true });

  // dziennik, kursor i powiadomienie
  const st = (await S.T.session.query(`select public.get_ksef_status($1) as s`, [S.T.tenantId])).rows[0].s;
  assert.equal(st.status, 'connected');
  assert.equal(st.running, false);
  assert.equal(new Date(st.last_sync_at).getTime() > 0, true);
  assert.deepEqual({ status: st.runs[0].status, listed: st.runs[0].listed, imported: st.runs[0].imported, trigger: st.runs[0].trigger }, { status: 'ok', listed: 4, imported: 4, trigger: 'connect' });
  const integ = (await db.admin.query(`select cursor_at, consecutive_failures, last_error from public.ksef_integrations where tenant_id = $1`, [S.T.tenantId])).rows[0];
  assert.equal(new Date(integ.cursor_at).toISOString(), HWM);
  const note = (await db.admin.query(`select title, kind, data from public.notifications where tenant_id = $1`, [S.T.tenantId])).rows;
  assert.deepEqual(note.map((n) => [n.kind, n.title, n.data.screen]), [['document_ready', 'Nowe faktury z KSeF: 4', 'documents']]);

  // to samo można zaksięgować zwykłym przyciskiem: przypisujemy brakujące produkty i księgujemy
  await S.T.session.query(`update public.document_lines set skip = true where document_id = $1 and product_id is null`, [byNo['FV/1'].id]);
  const posted = (await S.T.session.query(`select public.post_document($1) as n`, [byNo['FV/1'].id])).rows[0].n;
  assert.equal(posted, 2, 'dwie pozycje towarowe (transport i nieznany towar pominięte)');
  const kor2 = (await S.T.session.query(`select public.post_document($1) as n`, [byNo['KOR/1'].id])).rows[0].n;
  assert.equal(kor2, 1);
  const stock = (await db.admin.query(`select sum(qty)::float s from public.stock_movements where product_id = $1`, [gloves])).rows[0].s;
  assert.equal(stock, 3 - 2, 'rękawice: +3 z faktury, −2 z korekty');
});

test('druga synchronizacja nie dubluje; faktura sfotografowana wcześniej dostaje numer KSeF', async () => {
  const S = await scenario('E2');
  const [a, b] = [10, 11].map((i) => makeKsefNumber(i));
  S.server.invoices = [metaFor(a, { permanentStorageDate: hourly(0), invoiceNumber: 'FV/A' }), metaFor(b, { permanentStorageDate: hourly(1), invoiceNumber: 'FV/FOTO' })];
  S.server.xml = { [a]: faXml({ number: 'FV/A' }), [b]: faXml({ number: 'FV/FOTO' }) };
  // wcześniej dodana ze zdjęcia, ta sama faktura (NIP + numer)
  const { rows } = await db.admin.query(
    `insert into public.documents (tenant_id, source, status, supplier_nip, invoice_number) values ($1,'photo','draft','1234563218','fv/foto') returning id`, [S.T.tenantId]);

  const first = await sync(S);
  assert.deepEqual({ imported: first.imported, linked: first.linked }, { imported: 1, linked: 1 });
  assert.equal((await db.admin.query(`select ksef_number from public.documents where id = $1`, [rows[0].id])).rows[0].ksef_number, b);

  await db.admin.query(`update public.ksef_integrations set last_attempt_at = now() - interval '5 hours' where tenant_id = $1`, [S.T.tenantId]);
  // KSeF gwarantuje, że poniżej HWM nic nowego się nie pojawi — nowa faktura ma więc datę PO poprzednim HWM
  S.server.hwm = '2026-02-01T11:59:50.000Z';
  S.server.invoices.push(metaFor(makeKsefNumber(12), { permanentStorageDate: '2026-02-01T11:59:30Z', invoiceNumber: 'FV/NOWA' }));
  S.server.xml[makeKsefNumber(12)] = faXml({ number: 'FV/NOWA' });
  const second = await sync(S, 'auto');
  assert.deepEqual({ status: second.status, listed: second.listed, imported: second.imported, skipped: second.skipped }, { status: 'ok', listed: 1, imported: 1, skipped: 0 });
  assert.equal((await db.admin.query(`select count(*)::int n from public.documents where tenant_id = $1`, [S.T.tenantId])).rows[0].n, 3);

  // cofnięcie kursora (np. po awarii) niczego nie zdubluje — baza rozpoznaje faktury po numerze KSeF
  await db.admin.query(`update public.ksef_integrations set cursor_at = null, import_from = '2026-01-01', last_attempt_at = now() - interval '5 hours' where tenant_id = $1`, [S.T.tenantId]);
  const third = await sync(S, 'auto');
  assert.deepEqual({ imported: third.imported, skipped: third.skipped }, { imported: 0, skipped: 3 });
  assert.equal((await db.admin.query(`select count(*)::int n from public.documents where tenant_id = $1`, [S.T.tenantId])).rows[0].n, 3);
});

test('błędy z KSeF: limit tempa = przebieg częściowy z powrotem za kilka minut; odrzucony token = wstrzymanie i powiadomienie', async () => {
  const S = await scenario('E3');
  const nums = [20, 21, 22].map((i) => makeKsefNumber(i));
  S.server.invoices = nums.map((n, i) => metaFor(n, { permanentStorageDate: hourly(i), invoiceNumber: `FV/${i}` }));
  S.server.xml = Object.fromEntries(nums.map((n, i) => [n, faXml({ number: `FV/${i}` })]));
  S.server.force(`/invoices/ksef/${nums[1]}`, new Response('{}', { status: 429, headers: { 'retry-after': '300', 'content-type': 'application/json' } }));

  const part = await sync(S);
  assert.deepEqual({ status: part.status, imported: part.imported }, { status: 'partial', imported: 1 });
  const row = (await db.admin.query(`select next_attempt_at, last_error, sync_started_at, cursor_at, status from public.ksef_integrations where tenant_id = $1`, [S.T.tenantId])).rows[0];
  assert.equal(row.sync_started_at, null, 'blokada zwolniona');
  assert.equal(row.status, 'connected');
  assert.equal(new Date(row.cursor_at).toISOString(), hourly(0), 'kursor na ostatniej gotowej fakturze');
  const wait = (new Date(row.next_attempt_at) - Date.now()) / 60_000;
  assert.ok(wait > 4.5 && wait < 5.5, `Retry-After 300 s = ok. 5 minut do ponowienia, jest ${wait} min`);

  // ręczna synchronizacja po 3 minutach domyka resztę
  await db.admin.query(`update public.ksef_integrations set last_attempt_at = now() - interval '3 minutes' where tenant_id = $1`, [S.T.tenantId]);
  const rest = await sync(S, 'manual');
  assert.deepEqual({ status: rest.status, imported: rest.imported, skipped: rest.skipped }, { status: 'ok', imported: 2, skipped: 1 });

  // token unieważniony w KSeF
  S.server.token = 'ZMIENIONY-PO-STRONIE-KSEF-0123456789';
  await db.admin.query(`update public.ksef_integrations set last_attempt_at = now() - interval '3 minutes' where tenant_id = $1`, [S.T.tenantId]);
  const bad = await sync(S, 'manual');
  assert.equal(bad.status, 'error');
  const after = (await db.admin.query(`select status, last_error from public.ksef_integrations where tenant_id = $1`, [S.T.tenantId])).rows[0];
  assert.equal(after.status, 'error');
  assert.match(after.last_error, /nie rozpoznał tokenu/);
  const notes = (await db.admin.query(`select kind, title from public.notifications where tenant_id = $1 order by created_at`, [S.T.tenantId])).rows;
  assert.ok(notes.some((n) => n.kind === 'system' && /połączenie przestało działać/.test(n.title)));
  assert.deepEqual(await claimSync(S.deps, S.T.tenantId, 'manual'), { claimed: false, reason: 'needs_reconnect' });
});

test('harmonogram: startDueSyncs zajmuje i uruchamia tylko firmy, którym się należy', async () => {
  const A = await scenario('E4a');
  const B = await scenario('E4b');
  const nA = makeKsefNumber(30), nB = makeKsefNumber(31);
  A.server.invoices = [metaFor(nA, { permanentStorageDate: hourly(0) })]; A.server.xml = { [nA]: faXml({ number: 'A1' }) };
  B.server.invoices = [metaFor(nB, { permanentStorageDate: hourly(0) })]; B.server.xml = { [nB]: faXml({ number: 'B1' }) };
  await db.admin.query(`update public.ksef_integrations set last_attempt_at = now() - interval '4 hours' where tenant_id = $1`, [B.T.tenantId]);
  await db.admin.query(`update public.ksef_integrations set last_attempt_at = now() where tenant_id = $1`, [A.T.tenantId]);

  const jobs = [];
  // jedna wspólna lista zależności: adapter wybiera serwer po firmie
  const deps = {
    ...B.deps,
    db: sqlAdapter(),
    makeApi: (environment) => new KsefClient({ environment, fetch: B.server.fetch, sleep: async () => {}, now: B.server.now, authPollIntervalMs: 1 }),
    openToken: async (cipher, tenantId) => openToken(cipher, [KEY], tenantId),
  };
  const out = await startDueSyncs(deps, (p) => jobs.push(p), 50);
  assert.ok(out.started >= 1);
  await Promise.all(jobs);
  const ran = (await db.admin.query(`select count(*)::int n from public.ksef_sync_runs where tenant_id = $1 and trigger = 'auto'`, [B.T.tenantId])).rows[0].n;
  assert.equal(ran, 1);
  const notRan = (await db.admin.query(`select count(*)::int n from public.ksef_sync_runs where tenant_id = $1`, [A.T.tenantId])).rows[0].n;
  assert.equal(notRan, 0, 'firma z niedawną próbą nie jest ruszana');
});
