// ============================================================================
// Migracja 0011: integracja z KSeF po stronie bazy — sekret, blokada synchronizacji,
// import faktury bez duplikatów, powiadomienia, uprawnienia.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, ownerWithTenant, addMember, asService, asAnon, asUser, insertProduct, expectError } from './helpers.mjs';

let db;
test.before(async () => { db = await createTestDb(); });
test.after(async () => { await db.drop(); });

const NIP = '5260250995';                    // poprawna suma kontrolna
const SELLER = '1234563218';
const CIPHER = 'v1.AAAAAAAAAAAAAAAA.SEKRETNYSZYFROGRAMSEKRETNYSZYFROGRAM';
const svc = () => asService(db);
const rpc = async (sql, params) => (await svc().query(sql, params)).rows[0];

let seq = 0;
const ksefNo = (nip = SELLER) => `${nip}-20260105-${(0x100000000000 + ++seq).toString(16).toUpperCase().padStart(12, '0')}-AF`;

const invoice = (over = {}) => ({
  doc_kind: 'invoice', supplier_name: 'Hurtownia ABC Sp. z o.o.', supplier_nip: SELLER,
  invoice_number: `FV/${++seq}/2026`, issue_date: '2026-01-05', currency: 'PLN', total_net: 160.5, total_gross: 197.42,
  ai_warnings: [{ code: 'ksef_note', text: 'Przykładowa uwaga parsera.' }],
  lines: [
    { raw_name: 'Rękawice nitrylowe L', qty: 3, unit: 'op.', unit_price_net: 24.5, total_net: 73.5, vat_rate: 23, ean: null },
    { raw_name: 'Transport', qty: 1, unit: 'usł.', unit_price_net: 15, total_net: 15, vat_rate: 23, skip: true },
    { raw_name: 'Zupełnie nieznany towar xyz', qty: 2, unit: 'szt.', unit_price_net: 10, total_net: 20, vat_rate: 23 },
  ],
  ...over,
});

const importInvoice = (tenantId, number, inv, xml = '<Faktura/>') =>
  rpc(`select public.import_ksef_invoice($1, $2, $3::jsonb, $4, $5) as r`, [tenantId, number, JSON.stringify(inv), xml, 'a'.repeat(64)]).then((x) => x.r);

async function connected(label, extra = {}) {
  const T = await ownerWithTenant(db, label);
  await svc().query(`select public.save_ksef_connection($1, $2, $3, $4, $5, $6, $7)`,
    [T.tenantId, T.owner.id, extra.env ?? 'prod', extra.nip ?? NIP, CIPHER, 'ab12', '2026-01-01']);
  return T;
}

test('struktura: brak starej kolumny Vault, a tabele KSeF są niedostępne dla aplikacji (anon i zalogowani)', async () => {
  const cols = (await db.admin.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ksef_integrations'`)).rows.map((r) => r.column_name);
  assert.ok(!cols.includes('token_secret_id'));
  for (const c of ['token_ciphertext', 'cursor_at', 'environment', 'nip', 'sync_started_at']) assert.ok(cols.includes(c), c);

  const { rows } = await db.admin.query(`
    select c.relname, r.rolname,
           has_table_privilege(r.oid, c.oid, 'SELECT') or has_table_privilege(r.oid, c.oid, 'INSERT')
           or has_table_privilege(r.oid, c.oid, 'UPDATE') or has_table_privilege(r.oid, c.oid, 'DELETE') as any_priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join pg_roles r
    where c.relname in ('ksef_integrations', 'ksef_sync_runs', 'ksef_raw_invoices') and r.rolname in ('anon', 'authenticated')`);
  assert.equal(rows.length, 6);
  for (const r of rows) assert.equal(r.any_priv, false, `${r.rolname} → ${r.relname}`);
  const pol = await db.admin.query(`select count(*)::int n from pg_policies where schemaname = 'public' and tablename in ('ksef_integrations','ksef_sync_runs','ksef_raw_invoices')`);
  assert.equal(pol.rows[0].n, 0);
});

test('funkcje backendowe KSeF nie są wołalne z aplikacji; stan i odłączenie — tak', async () => {
  const T = await ownerWithTenant(db, 'K0');
  const mine = asUser(db, T.owner);
  const mustBeBackendOnly = [
    `select public.save_ksef_connection('${T.tenantId}', '${T.owner.id}', 'prod', '${NIP}', '${CIPHER}', 'x', null)`,
    `select public.claim_ksef_sync('${T.tenantId}', 'manual')`,
    `select public.finish_ksef_sync(1, 'ok', 0, 0, 0, 0, 0, null, null)`,
    `select * from public.due_ksef_tenants(5)`,
    `select public.ksef_known_numbers('${T.tenantId}', array['x'])`,
    `select public.import_ksef_invoice('${T.tenantId}', '${ksefNo()}', '{}'::jsonb, null, null)`,
  ];
  for (const sql of mustBeBackendOnly) await expectError(mine.query(sql), /permission denied/);
  await mine.query(`select public.get_ksef_status($1)`, [T.tenantId]);
  await expectError(asAnon(db).query(`select public.get_ksef_status('${T.tenantId}')`), /permission denied/);
});

test('get_ksef_status: kierownictwo widzi stan (bez sekretu), pracownik nie', async () => {
  const T = await connected('K1');
  const manager = await addMember(db, T.tenantId, 'manager');
  const employee = await addMember(db, T.tenantId, 'employee');

  const st = (await manager.session.query(`select public.get_ksef_status($1) as s`, [T.tenantId])).rows[0].s;
  assert.equal(st.status, 'connected');
  assert.equal(st.nip, NIP);
  assert.equal(st.environment, 'prod');
  assert.equal(st.token_hint, 'ab12');
  assert.ok(!('token_ciphertext' in st));
  assert.ok(!JSON.stringify(st).includes('SEKRETNY'), 'szyfrogram nie może wyciec do aplikacji');
  assert.deepEqual(st.runs, []);

  await expectError(employee.session.query(`select public.get_ksef_status($1)`, [T.tenantId]), /kierownictwo/);

  const other = await ownerWithTenant(db, 'K1b');
  await expectError(other.session.query(`select public.get_ksef_status($1)`, [T.tenantId]), /kierownictwo/);
  const fresh = (await other.session.query(`select public.get_ksef_status($1) as s`, [other.tenantId])).rows[0].s;
  assert.equal(fresh.status, 'disconnected');
});

test('save_ksef_connection: walidacja, ślad w dzienniku, zmiana NIP/środowiska zeruje kursor', async () => {
  const T = await ownerWithTenant(db, 'K2');
  await expectError(svc().query(`select public.save_ksef_connection($1,$2,'prod','1234567890',$3,'x',null)`, [T.tenantId, T.owner.id, CIPHER]), /NIP/);
  await expectError(svc().query(`select public.save_ksef_connection($1,$2,'staging',$3,$4,'x',null)`, [T.tenantId, T.owner.id, NIP, CIPHER]), /środowisko/);
  await expectError(svc().query(`select public.save_ksef_connection($1,$2,'prod',$3,'za-krotki','x',null)`, [T.tenantId, T.owner.id, NIP]), /check/);

  await svc().query(`select public.save_ksef_connection($1,$2,'prod',$3,$4,'abcd1234567','2026-01-01')`, [T.tenantId, T.owner.id, NIP, CIPHER]);
  let row = (await db.admin.query(`select * from public.ksef_integrations where tenant_id = $1`, [T.tenantId])).rows[0];
  assert.equal(row.status, 'connected');
  assert.equal(row.token_hint, 'abcd1234', 'wskazówka ucięta do 8 znaków');
  assert.equal(row.cursor_at, null);

  await db.admin.query(`update public.ksef_integrations set cursor_at = '2026-03-01T10:00:00Z' where tenant_id = $1`, [T.tenantId]);
  await svc().query(`select public.save_ksef_connection($1,$2,'prod',$3,$4,'zzzz',null)`, [T.tenantId, T.owner.id, NIP, CIPHER + 'N']);
  row = (await db.admin.query(`select * from public.ksef_integrations where tenant_id = $1`, [T.tenantId])).rows[0];
  assert.ok(row.cursor_at, 'ten sam NIP i środowisko → kursor zostaje (nie pobieramy wszystkiego od nowa)');
  assert.equal(row.token_ciphertext, CIPHER + 'N');

  await svc().query(`select public.save_ksef_connection($1,$2,'demo',$3,$4,'zzzz',null)`, [T.tenantId, T.owner.id, NIP, CIPHER]);
  row = (await db.admin.query(`select * from public.ksef_integrations where tenant_id = $1`, [T.tenantId])).rows[0];
  assert.equal(row.cursor_at, null, 'inne środowisko = inny zbiór faktur → kursor od zera');

  const audit = (await db.admin.query(`select action, data from public.audit_log where tenant_id = $1 and action like 'KSEF_%' order by id`, [T.tenantId])).rows;
  assert.equal(audit.length, 3);
  assert.ok(audit.every((a) => a.action === 'KSEF_CONNECT'));
  assert.ok(!JSON.stringify(audit).includes('SEKRET'), 'w dzienniku nie ma tokenu');
});

test('spójność: połączenie bez sekretu jest niemożliwe', async () => {
  const T = await connected('K3');
  await expectError(db.admin.query(`update public.ksef_integrations set token_ciphertext = null where tenant_id = $1`, [T.tenantId]), /ksef_connected_has_secret/);
  await expectError(db.admin.query(`update public.ksef_integrations set status = 'wyłączony' where tenant_id = $1`, [T.tenantId]), /ksef_status_valid/);
});

test('disconnect_ksef: tylko właściciel; kasuje szyfrogram, zostawia dokumenty i ślad', async () => {
  const T = await connected('K4');
  const manager = await addMember(db, T.tenantId, 'manager');
  await expectError(manager.session.query(`select public.disconnect_ksef($1)`, [T.tenantId]), /właściciel/);

  await T.session.query(`select public.disconnect_ksef($1)`, [T.tenantId]);
  const row = (await db.admin.query(`select status, token_ciphertext, token_hint from public.ksef_integrations where tenant_id = $1`, [T.tenantId])).rows[0];
  assert.deepEqual({ ...row }, { status: 'disconnected', token_ciphertext: null, token_hint: null });
  await T.session.query(`select public.disconnect_ksef($1)`, [T.tenantId]);   // powtórka nieszkodliwa
  const audit = (await db.admin.query(`select count(*)::int n from public.audit_log where tenant_id = $1 and action = 'KSEF_DISCONNECT'`, [T.tenantId])).rows[0].n;
  assert.equal(audit, 2);
  const claim = await rpc(`select public.claim_ksef_sync($1, 'manual') as r`, [T.tenantId]);
  assert.deepEqual(claim.r, { claimed: false, reason: 'not_connected' });
});

test('claim_ksef_sync: jedna synchronizacja naraz, odstępy, przejęcie porzuconej blokady', async () => {
  const T = await connected('K5');
  const claim = (trigger) => rpc(`select public.claim_ksef_sync($1, $2) as r`, [T.tenantId, trigger]).then((x) => x.r);

  const first = await claim('connect');
  assert.equal(first.claimed, true);
  assert.equal(first.nip, NIP);
  assert.equal(first.token_ciphertext, CIPHER);
  assert.equal(first.environment, 'prod');
  assert.ok(first.run_id > 0);

  assert.deepEqual(await claim('connect'), { claimed: false, reason: 'already_running' });
  assert.deepEqual(await claim('auto'), { claimed: false, reason: 'already_running' });

  // porzucona blokada (funkcja padła 11 minut temu) → można przejąć, a stary przebieg dostaje status błędu
  await db.admin.query(`update public.ksef_integrations set sync_started_at = now() - interval '11 minutes' where tenant_id = $1`, [T.tenantId]);
  await db.admin.query(`update public.ksef_sync_runs set started_at = now() - interval '11 minutes' where id = $1`, [first.run_id]);
  await db.admin.query(`update public.ksef_integrations set last_attempt_at = now() - interval '11 minutes' where tenant_id = $1`, [T.tenantId]);
  const second = await claim('manual');
  assert.equal(second.claimed, true);
  const old = (await db.admin.query(`select status, error from public.ksef_sync_runs where id = $1`, [first.run_id])).rows[0];
  assert.equal(old.status, 'error');
  assert.match(old.error, /przerwana/);

  await rpc(`select public.finish_ksef_sync($1, 'ok', 0, 0, 0, 0, 0, null, null)`, [second.run_id]);
  assert.deepEqual(await claim('manual'), { claimed: false, reason: 'too_soon' }, 'ręczna: nie częściej niż co 2 minuty');
  assert.deepEqual(await claim('auto'), { claimed: false, reason: 'too_soon' }, 'automatyczna: nie częściej niż co 3 godziny');

  await db.admin.query(`update public.ksef_integrations set last_attempt_at = now() - interval '3 minutes' where tenant_id = $1`, [T.tenantId]);
  assert.equal((await claim('manual')).claimed, true, 'po 3 minutach ręczna działa');
});

test('finish_ksef_sync: kursor tylko do przodu, liczniki, wycofanie po błędach, idempotencja', async () => {
  const T = await connected('K6');
  const claim = () => rpc(`select public.claim_ksef_sync($1, 'connect') as r`, [T.tenantId]).then((x) => x.r);
  const finish = (run, status, o = {}) =>
    rpc(`select public.finish_ksef_sync($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [run, status, o.listed ?? 0, o.imported ?? 0, o.linked ?? 0, o.skipped ?? 0, o.failed ?? 0, o.error ?? null, o.cursor ?? null, o.authFailed ?? false, o.retry ?? null]);
  const integ = async () => (await db.admin.query(`select * from public.ksef_integrations where tenant_id = $1`, [T.tenantId])).rows[0];

  let c = await claim();
  await finish(c.run_id, 'ok', { listed: 5, imported: 2, linked: 1, skipped: 2, cursor: '2026-02-01T00:00:00Z' });
  let row = await integ();
  assert.equal(row.sync_started_at, null);
  assert.equal(new Date(row.cursor_at).toISOString(), '2026-02-01T00:00:00.000Z');
  assert.ok(row.last_sync_at);
  assert.equal(row.consecutive_failures, 0);
  const run = (await db.admin.query(`select * from public.ksef_sync_runs where id = $1`, [c.run_id])).rows[0];
  assert.deepEqual({ status: run.status, listed: run.listed, imported: run.imported, linked: run.linked, skipped: run.skipped }, { status: 'ok', listed: 5, imported: 2, linked: 1, skipped: 2 });

  await finish(c.run_id, 'error', { error: 'drugie zamknięcie ignorowane' });          // idempotencja
  assert.equal((await db.admin.query(`select status from public.ksef_sync_runs where id = $1`, [c.run_id])).rows[0].status, 'ok');

  // kursor nie cofa się
  await db.admin.query(`update public.ksef_integrations set last_attempt_at = null where tenant_id = $1`, [T.tenantId]);
  c = await claim();
  await finish(c.run_id, 'ok', { cursor: '2026-01-15T00:00:00Z' });
  assert.equal(new Date((await integ()).cursor_at).toISOString(), '2026-02-01T00:00:00.000Z');

  // błędy: rosnące wycofanie (5, 10, 20 minut ...), po sukcesie licznik się zeruje
  const waits = [];
  for (let i = 0; i < 3; i++) {
    await db.admin.query(`update public.ksef_integrations set last_attempt_at = null where tenant_id = $1`, [T.tenantId]);
    c = await claim();
    await finish(c.run_id, 'error', { error: 'KSeF niedostępny' });
    row = await integ();
    waits.push(Math.round((new Date(row.next_attempt_at) - Date.now()) / 60000));
  }
  assert.deepEqual(waits.map((w) => Math.round(w / 5) * 5), [5, 10, 20]);
  assert.equal(row.consecutive_failures, 3);
  assert.equal(row.status, 'connected', 'zwykły błąd techniczny nie rozłącza');
  assert.equal(row.last_error, 'KSeF niedostępny');

  await db.admin.query(`update public.ksef_integrations set last_attempt_at = null, next_attempt_at = null where tenant_id = $1`, [T.tenantId]);
  c = await claim();
  await finish(c.run_id, 'ok');
  row = await integ();
  assert.equal(row.consecutive_failures, 0);
  assert.equal(row.last_error, null);
  assert.equal(row.next_attempt_at, null);
});

test('finish_ksef_sync: odrzucony token → status „error”, jedno powiadomienie dla kierownictwa, auto-pobieranie wstrzymane', async () => {
  const T = await connected('K7');
  const manager = await addMember(db, T.tenantId, 'manager');
  const employee = await addMember(db, T.tenantId, 'employee');
  const claim = () => rpc(`select public.claim_ksef_sync($1, 'manual') as r`, [T.tenantId]).then((x) => x.r);

  const c = await claim();
  await rpc(`select public.finish_ksef_sync($1, 'error', 0,0,0,0,0, 'Token odrzucony', null, true, null)`, [c.run_id]);
  const row = (await db.admin.query(`select status, token_ciphertext from public.ksef_integrations where tenant_id = $1`, [T.tenantId])).rows[0];
  assert.equal(row.status, 'error');
  assert.ok(row.token_ciphertext, 'szyfrogram zostaje do czasu ponownego połączenia lub odłączenia');

  const notes = (await db.admin.query(`select user_id, kind, data from public.notifications where tenant_id = $1 order by user_id`, [T.tenantId])).rows;
  const recipients = notes.map((n) => n.user_id).sort();
  assert.deepEqual(recipients, [T.owner.id, manager.user.id].sort());
  assert.ok(!recipients.includes(employee.user.id));
  assert.ok(notes.every((n) => n.kind === 'system' && n.data.screen === 'ksef'));

  assert.deepEqual(await claim(), { claimed: false, reason: 'needs_reconnect' });
  assert.ok(!(await rpc(`select array_agg(tenant_id) a from public.due_ksef_tenants(50)`)).a?.includes(T.tenantId));

  // ponowne połączenie przywraca pracę (pierwszą synchronizację po połączeniu uruchamia ksef-connect jako „connect”)
  await svc().query(`select public.save_ksef_connection($1,$2,'prod',$3,$4,'new',null)`, [T.tenantId, T.owner.id, NIP, CIPHER]);
  assert.equal((await rpc(`select public.claim_ksef_sync($1, 'connect') as r`, [T.tenantId])).r.claimed, true);
});

test('finish_ksef_sync: nowe faktury → powiadomienie „document_ready” dla kierownictwa; częściowy przebieg wraca szybciej', async () => {
  const T = await connected('K8');
  const employee = await addMember(db, T.tenantId, 'employee');
  const c = (await rpc(`select public.claim_ksef_sync($1, 'auto') as r`, [T.tenantId])).r;
  await rpc(`select public.finish_ksef_sync($1, 'partial', 10, 3, 0, 0, 2, 'KSeF ograniczył tempo', null, false, 45)`, [c.run_id]);

  const notes = (await db.admin.query(`select user_id, kind, title, data from public.notifications where tenant_id = $1`, [T.tenantId])).rows;
  assert.equal(notes.length, 1, 'tylko właściciel (jedyny kierownik)');
  assert.equal(notes[0].user_id, T.owner.id);
  assert.equal(notes[0].kind, 'document_ready');
  assert.equal(notes[0].title, 'Nowe faktury z KSeF: 3');
  assert.equal(notes[0].data.screen, 'documents');
  assert.ok(!notes.some((n) => n.user_id === employee.user.id));

  const row = (await db.admin.query(`select next_attempt_at, last_error from public.ksef_integrations where tenant_id = $1`, [T.tenantId])).rows[0];
  const sec = (new Date(row.next_attempt_at) - Date.now()) / 1000;
  assert.ok(sec >= 100 && sec <= 140, `retry-after 45 s podniesione do minimum 120 s, jest ${sec}`);
  assert.equal(row.last_error, 'KSeF ograniczył tempo');
});

test('finish_ksef_sync (0013): Retry-After z KSeF wydłuża przerwę — także po błędzie bez postępu — do 2 godzin', async () => {
  const T = await connected('K8b');
  const claim = () => rpc(`select public.claim_ksef_sync($1, 'auto') as r`, [T.tenantId]).then((x) => x.r);
  const reset = () => db.admin.query(`update public.ksef_integrations set last_attempt_at = null, next_attempt_at = null where tenant_id = $1`, [T.tenantId]);
  const waitSec = async () => {
    const row = (await db.admin.query(`select next_attempt_at from public.ksef_integrations where tenant_id = $1`, [T.tenantId])).rows[0];
    return (new Date(row.next_attempt_at) - Date.now()) / 1000;
  };
  const near = (value, expected) => assert.ok(Math.abs(value - expected) <= 60, `oczekiwano ok. ${expected} s, jest ${Math.round(value)} s`);

  // błąd bez postępu i Retry-After 50 min → przerwa ≥ 50 min (wykładnicze wycofanie dałoby tylko 5 min)
  let c = await claim();
  await rpc(`select public.finish_ksef_sync($1, 'error', 0,0,0,0,0, 'KSeF ograniczył tempo', null, false, 3000)`, [c.run_id]);
  near(await waitSec(), 3000);

  // częściowy przebieg: 50 minut, a nie ucięte do 30 (jak w 0011)
  await reset();
  c = await claim();
  await rpc(`select public.finish_ksef_sync($1, 'partial', 10, 2, 0, 0, 1, 'KSeF ograniczył tempo', null, false, 3000)`, [c.run_id]);
  near(await waitSec(), 3000);

  // sufit: 2 godziny, choćby KSeF kazał czekać dłużej
  await reset();
  c = await claim();
  await rpc(`select public.finish_ksef_sync($1, 'partial', 10, 2, 0, 0, 1, 'x', null, false, 90000)`, [c.run_id]);
  near(await waitSec(), 7200);

  // mały Retry-After nie skraca wykładniczego wycofania po błędzie (po sukcesie licznik był 0, ale poprzednie błędy trwają)
  await reset();
  c = await claim();
  await rpc(`select public.finish_ksef_sync($1, 'error', 0,0,0,0,0, 'x', null, false, 30)`, [c.run_id]);
  const sec = await waitSec();
  assert.ok(sec >= 280 && sec <= 330, `5 minut (ostatni przebieg częściowy wyzerował licznik), jest ${Math.round(sec)} s`);

  // błąd autoryzacji nadal wstrzymuje automat (brak next_attempt_at), niezależnie od Retry-After
  await reset();
  c = await claim();
  await rpc(`select public.finish_ksef_sync($1, 'error', 0,0,0,0,0, 'Token odrzucony', null, true, 3000)`, [c.run_id]);
  assert.equal((await db.admin.query(`select next_attempt_at from public.ksef_integrations where tenant_id = $1`, [T.tenantId])).rows[0].next_attempt_at, null);
});

test('due_ksef_tenants: tylko podłączone, niepracujące, bez wycofania i po odstępie 3 godzin', async () => {
  const A = await connected('Kd1');        // nigdy nie próbowano → należy się
  const B = await connected('Kd2');        // niedawno próbowano
  const C = await connected('Kd3');        // trwa synchronizacja
  const D = await connected('Kd4');        // wycofanie po błędzie
  const E = await connected('Kd5');        // próbowano 4 godziny temu → należy się
  const F = await ownerWithTenant(db, 'Kd6');   // brak integracji
  await db.admin.query(`update public.ksef_integrations set last_attempt_at = now() - interval '10 minutes' where tenant_id = $1`, [B.tenantId]);
  await db.admin.query(`update public.ksef_integrations set sync_started_at = now() - interval '1 minute', last_attempt_at = now() - interval '1 minute' where tenant_id = $1`, [C.tenantId]);
  await db.admin.query(`update public.ksef_integrations set last_attempt_at = now() - interval '5 hours', next_attempt_at = now() + interval '20 minutes' where tenant_id = $1`, [D.tenantId]);
  await db.admin.query(`update public.ksef_integrations set last_attempt_at = now() - interval '4 hours' where tenant_id = $1`, [E.tenantId]);

  const due = (await svc().query(`select tenant_id from public.due_ksef_tenants(50)`)).rows.map((r) => r.tenant_id);
  assert.ok(due.includes(A.tenantId) && due.includes(E.tenantId));
  for (const T of [B, C, D, F]) assert.ok(!due.includes(T.tenantId));
  assert.ok(due.indexOf(A.tenantId) < due.indexOf(E.tenantId), 'najpierw ci, których jeszcze nie próbowano');

  const one = (await svc().query(`select tenant_id from public.due_ksef_tenants(1)`)).rows;
  assert.equal(one.length, 1);
});

test('historia przebiegów: 10 ostatnich w stanie, 50 w bazie', async () => {
  const T = await connected('K9');
  for (let i = 0; i < 55; i++) {
    await db.admin.query(`update public.ksef_integrations set last_attempt_at = null where tenant_id = $1`, [T.tenantId]);
    const c = (await rpc(`select public.claim_ksef_sync($1, 'connect') as r`, [T.tenantId])).r;
    await rpc(`select public.finish_ksef_sync($1, 'ok', $2, 0, 0, 0, 0, null, null)`, [c.run_id, i]);
  }
  const total = (await db.admin.query(`select count(*)::int n from public.ksef_sync_runs where tenant_id = $1`, [T.tenantId])).rows[0].n;
  assert.equal(total, 50);
  const st = (await T.session.query(`select public.get_ksef_status($1) as s`, [T.tenantId])).rows[0].s;
  assert.equal(st.runs.length, 10);
  assert.equal(st.runs[0].listed, 54, 'najnowszy pierwszy');
});

test('ksef_known_numbers zwraca tylko numery tej firmy', async () => {
  const A = await connected('Kk1');
  const B = await connected('Kk2');
  const n1 = ksefNo(), n2 = ksefNo(), n3 = ksefNo();
  await importInvoice(A.tenantId, n1, invoice());
  await importInvoice(B.tenantId, n2, invoice());
  const known = (await rpc(`select public.ksef_known_numbers($1, $2) as r`, [A.tenantId, [n1, n2, n3]])).r;
  assert.deepEqual(known, [n1]);
});

test('import_ksef_invoice: nowy dokument „draft” ze źródłem ksef, dostawcą, dopasowaniem i surowym XML', async () => {
  const T = await connected('Ki1');
  const gloves = await insertProduct(db, T.tenantId, 'Rękawice nitrylowe L', { unit: 'op.' });
  const number = ksefNo();
  const inv = invoice({ invoice_number: 'FV/KSEF/1' });

  const res = await importInvoice(T.tenantId, number, inv, '<Faktura>treść</Faktura>');
  assert.equal(res.status, 'created');
  assert.equal(res.lines, 3);
  assert.equal(res.matched, 1);

  const doc = (await db.admin.query(`select * from public.documents where id = $1`, [res.document_id])).rows[0];
  assert.equal(doc.source, 'ksef');
  assert.equal(doc.status, 'draft');
  assert.equal(doc.ksef_number, number);
  assert.equal(doc.created_by, null);
  assert.equal(doc.supplier_nip, SELLER);
  assert.equal(doc.invoice_number, 'FV/KSEF/1');
  assert.equal(doc.ai_model, null, 'to nie jest odczyt AI');
  assert.equal(doc.ai_confidence, null);
  assert.equal(doc.ai_warnings[0].code, 'ksef_note');
  assert.deepEqual(doc.file_paths, []);

  const lines = (await db.admin.query(`select * from public.document_lines where document_id = $1 order by line_no`, [doc.id])).rows;
  assert.equal(lines[0].product_id, gloves);
  assert.equal(lines[1].skip, true);
  assert.equal(lines[2].product_id, null);

  const sup = (await db.admin.query(`select count(*)::int n from public.suppliers where tenant_id = $1 and nip = $2`, [T.tenantId, SELLER])).rows[0].n;
  assert.equal(sup, 1);
  const raw = (await db.admin.query(`select xml, sha256 from public.ksef_raw_invoices where tenant_id = $1 and ksef_number = $2`, [T.tenantId, number])).rows[0];
  assert.equal(raw.xml, '<Faktura>treść</Faktura>');
  assert.equal(raw.sha256, 'a'.repeat(64));

  // dokument od razu pojawia się w widoku dla kierownika (ekran faktur)
  const ov = (await T.session.query(`select source, line_count, unmatched_count from public.document_overview where id = $1`, [doc.id])).rows[0];
  assert.deepEqual({ ...ov }, { source: 'ksef', line_count: 3, unmatched_count: 1 });
  const note = (await db.admin.query(`select count(*)::int n from public.notifications where tenant_id = $1`, [T.tenantId])).rows[0].n;
  assert.equal(note, 0, 'powiadomienie wysyła dopiero finish_ksef_sync (jedno zbiorcze, nie po jednym na fakturę)');
});

test('import_ksef_invoice: ten sam numer KSeF drugi raz → exists; ten sam numer w innej firmie jest dozwolony', async () => {
  const A = await connected('Ki2');
  const B = await connected('Ki3');
  const number = ksefNo();
  const first = await importInvoice(A.tenantId, number, invoice({ invoice_number: 'FV/X/1' }));
  const again = await importInvoice(A.tenantId, number, invoice({ invoice_number: 'FV/X/1' }));
  assert.deepEqual({ status: again.status, document_id: again.document_id }, { status: 'exists', document_id: first.document_id });
  const other = await importInvoice(B.tenantId, number, invoice({ invoice_number: 'FV/X/1' }));
  assert.equal(other.status, 'created');
  const n = (await db.admin.query(`select count(*)::int n from public.documents where tenant_id = $1`, [A.tenantId])).rows[0].n;
  assert.equal(n, 1);
});

test('import_ksef_invoice: faktura wcześniej sfotografowana dostaje numer KSeF zamiast duplikatu (także zaksięgowana)', async () => {
  const T = await connected('Ki4');
  const prod = await insertProduct(db, T.tenantId, 'Rękawice nitrylowe L', { unit: 'op.' });

  // dokument ze zdjęcia (draft) i drugi, już zaksięgowany
  const mk = async (invNo) => {
    const { rows } = await db.admin.query(
      `insert into public.documents (tenant_id, source, status, supplier_nip, invoice_number, doc_kind) values ($1,'photo','draft',$2,$3,'invoice') returning id`,
      [T.tenantId, SELLER, invNo]);
    await db.admin.query(`insert into public.document_lines (tenant_id, document_id, line_no, raw_name, qty, product_id) values ($1,$2,1,'Rękawice',2,$3)`, [T.tenantId, rows[0].id, prod]);
    return rows[0].id;
  };
  const draftId = await mk('FV/FOTO/1');
  const postedId = await mk('FV/FOTO/2');
  await T.session.query(`select public.post_document($1)`, [postedId]);

  const n1 = ksefNo(), n2 = ksefNo();
  const r1 = await importInvoice(T.tenantId, n1, invoice({ invoice_number: ' fv/foto/1 ' }));
  assert.deepEqual({ status: r1.status, document_id: r1.document_id }, { status: 'linked', document_id: draftId });
  const r2 = await importInvoice(T.tenantId, n2, invoice({ invoice_number: 'FV/FOTO/2' }));
  assert.deepEqual({ status: r2.status, document_id: r2.document_id }, { status: 'linked', document_id: postedId });

  const docs = (await db.admin.query(`select id, ksef_number, status, source from public.documents where id = any($1) order by invoice_number`, [[draftId, postedId]])).rows;
  assert.deepEqual(docs.map((d) => [d.ksef_number, d.status, d.source]), [[n1, 'draft', 'photo'], [n2, 'posted', 'photo']]);
  assert.equal((await db.admin.query(`select count(*)::int n from public.documents where tenant_id = $1`, [T.tenantId])).rows[0].n, 2, 'żadnych nowych dokumentów');
});

test('import_ksef_invoice: korekta z ujemną ilością księguje się jako korekta stanu', async () => {
  const T = await connected('Ki5');
  const prod = await insertProduct(db, T.tenantId, 'Płyn do szyb', { unit: 'szt.' });
  await db.admin.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty, created_by) values ($1,$2,'receipt',10,$3)`, [T.tenantId, prod, T.owner.id]);

  const res = await importInvoice(T.tenantId, ksefNo(), invoice({
    doc_kind: 'correction', invoice_number: 'KOR/1', total_net: -36, total_gross: -44.28,
    lines: [{ raw_name: 'Płyn do szyb', qty: -2, unit: 'szt.', unit_price_net: 18, total_net: -36, vat_rate: 23 }],
  }));
  assert.equal(res.status, 'created');
  assert.equal(res.matched, 1);
  const doc = (await db.admin.query(`select doc_kind, total_net from public.documents where id = $1`, [res.document_id])).rows[0];
  assert.equal(doc.doc_kind, 'correction');
  assert.equal(Number(doc.total_net), -36);

  await T.session.query(`select public.post_document($1)`, [res.document_id]);
  const stock = (await db.admin.query(`select sum(qty)::float s, count(*) filter (where movement_type = 'adjustment')::int adj from public.stock_movements where product_id = $1`, [prod])).rows[0];
  assert.deepEqual({ ...stock }, { s: 8, adj: 1 });
});

test('import_ksef_invoice: złe dane są odrzucane czytelnym błędem', async () => {
  const T = await connected('Ki6');
  await expectError(importInvoice(T.tenantId, 'ZLY-NUMER', invoice()), /numer KSeF/);
  await expectError(rpc(`select public.import_ksef_invoice($1, $2, null, null, null)`, [T.tenantId, ksefNo()]), /Brak danych/);
  await expectError(importInvoice('00000000-0000-4000-8000-000000000000', ksefNo(), invoice()), /Firma nie istnieje/);
  await expectError(importInvoice(T.tenantId, ksefNo(), invoice({ lines: 'nie-tablica' })), /lines|tablic/);
  assert.equal((await db.admin.query(`select count(*)::int n from public.documents where tenant_id = $1`, [T.tenantId])).rows[0].n, 0, 'nieudany import nie zostawia śmieci');
});

test('numer KSeF w dokumentach: format, unikalność i zakaz ręcznej edycji przez aplikację', async () => {
  const T = await connected('Ki7');
  const number = ksefNo();
  await expectError(db.admin.query(`insert into public.documents (tenant_id, source, ksef_number) values ($1,'manual','123')`, [T.tenantId]), /documents_ksef_number_format/);

  // kierownik tworzy dokument ręcznie i próbuje wpisać numer KSeF → wartość jest zerowana
  const { rows } = await T.session.query(`insert into public.documents (tenant_id, supplier_name, ksef_number) values ($1,'Ręczny',$2) returning id, ksef_number, source`, [T.tenantId, number]);
  assert.equal(rows[0].ksef_number, null);
  assert.equal(rows[0].source, 'manual');
  await expectError(T.session.query(`update public.documents set ksef_number = $2 where id = $1`, [rows[0].id, number]), /nie edytuje się go ręcznie/);
  await T.session.query(`update public.documents set supplier_name = 'Zmieniony' where id = $1`, [rows[0].id]);   // inne edycje działają

  await db.admin.query(`insert into public.documents (tenant_id, source, ksef_number) values ($1,'ksef',$2)`, [T.tenantId, number]);
  await expectError(db.admin.query(`insert into public.documents (tenant_id, source, ksef_number) values ($1,'ksef',$2)`, [T.tenantId, number]), /documents_ksef_number_key/);
});

test('usunięcie firmy kasuje też surowe XML-e i dziennik KSeF', async () => {
  const T = await connected('Ki8');
  await importInvoice(T.tenantId, ksefNo(), invoice());
  const c = (await rpc(`select public.claim_ksef_sync($1, 'connect') as r`, [T.tenantId])).r;
  await rpc(`select public.finish_ksef_sync($1, 'ok', 1, 1, 0, 0, 0, null, null)`, [c.run_id]);
  await T.session.query(`select public.delete_tenant($1, 'Firma Ki8')`, [T.tenantId]);
  for (const t of ['ksef_integrations', 'ksef_sync_runs', 'ksef_raw_invoices', 'documents']) {
    const n = (await db.admin.query(`select count(*)::int n from public.${t} where tenant_id = $1`, [T.tenantId])).rows[0].n;
    assert.equal(n, 0, t);
  }
});
