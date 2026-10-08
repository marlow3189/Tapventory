// ============================================================================
// Migracja 0009: limity plików, cache kodów kreskowych, licznik asystenta AI.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, ownerWithTenant, asService, expectError } from './helpers.mjs';

let db;
test.before(async () => {
  db = await createTestDb();
});
test.after(async () => {
  await db.drop();
});

test('buckety mają limity wielkości i dozwolone typy plików', async () => {
  const { rows } = await db.admin.query(
    `select id, file_size_limit::bigint as lim, allowed_mime_types from storage.buckets order by id`
  );
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(Number(by['documents'].lim), 10 * 1024 * 1024);
  assert.ok(by['documents'].allowed_mime_types.includes('application/pdf'));
  assert.equal(Number(by['product-photos'].lim), 5 * 1024 * 1024);
  assert.ok(!by['product-photos'].allowed_mime_types.includes('application/pdf'));
  for (const id of ['documents', 'product-photos']) {
    assert.ok(!by[id].allowed_mime_types.includes('text/html'), `${id}: HTML nie może być dozwolony`);
    assert.ok(!by[id].allowed_mime_types.includes('image/svg+xml'), `${id}: SVG może zawierać skrypty`);
  }
});

test('barcode_cache i assistant_usage są niedostępne dla aplikacji (anon i zalogowani)', async () => {
  const { rows } = await db.admin.query(`
    select c.relname, r.rolname,
           has_table_privilege(r.oid, c.oid, 'SELECT') as sel,
           has_table_privilege(r.oid, c.oid, 'INSERT') as ins,
           has_table_privilege(r.oid, c.oid, 'UPDATE') as upd,
           has_table_privilege(r.oid, c.oid, 'DELETE') as del
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join pg_roles r
    where c.relname in ('barcode_cache', 'assistant_usage') and r.rolname in ('anon', 'authenticated')`);
  assert.equal(rows.length, 4);
  for (const r of rows) assert.deepEqual([r.sel, r.ins, r.upd, r.del], [false, false, false, false], `${r.rolname} → ${r.relname}`);
});

test('cache kodów przyjmuje tylko poprawne EAN-y i opisy o rozsądnej długości', async () => {
  await db.admin.query(`insert into public.barcode_cache (ean, found, name) values ('5901234123457', true, 'Mleko 3,2%')`);
  await assert.rejects(db.admin.query(`insert into public.barcode_cache (ean, found) values ('12345', false)`), /check/);
  await assert.rejects(db.admin.query(`insert into public.barcode_cache (ean, found, name) values ('5901234123464', true, $1)`, ['x'.repeat(301)]), /check/);
});

test('licznik asystenta: rośnie do limitu, potem błąd i brak dalszego wzrostu', async () => {
  const T = await ownerWithTenant(db, 'L1');
  const svc = asService(db);
  const call = () => svc.query(`select public.bump_assistant_usage($1, $2, 3) as n`, [T.tenantId, T.owner.id]).then((r) => r.rows[0].n);
  assert.equal(await call(), 1);
  assert.equal(await call(), 2);
  assert.equal(await call(), 3);
  await expectError(call(), /limit pytań/);
  const { rows } = await db.admin.query(`select messages from public.assistant_usage where tenant_id = $1`, [T.tenantId]);
  assert.equal(rows[0].messages, 3, 'nieudane wywołanie nie może podbić licznika');
});

test('zalogowany użytkownik nie może wywołać funkcji licznika (tylko backend)', async () => {
  const T = await ownerWithTenant(db, 'L2');
  await expectError(
    T.session.query(`select public.bump_assistant_usage($1, $2, 100)`, [T.tenantId, T.owner.id]),
    /permission denied/
  );
});

test('strażnik: dokument wiszący w "processing" przechodzi w "failed", świeży zostaje', async () => {
  const T = await ownerWithTenant(db, 'R1');
  const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
  for (const n of [1, 2]) {
    await T.session.query(`select public.create_photo_document($1, $2, $3)`, [id(n), T.tenantId, [`${T.tenantId}/documents/${id(n)}/page-1.jpg`]]);
  }
  // postarzamy pierwszy dokument (z pominięciem wyzwalaczy, które ustawiają updated_at)
  await db.admin.query('set session_replication_role = replica');
  await db.admin.query(`update public.documents set updated_at = now() - interval '1 hour' where id = $1`, [id(1)]);
  await db.admin.query('reset session_replication_role');

  const svc = asService(db);
  const { rows } = await svc.query(`select public.reap_stuck_documents(interval '10 minutes') as n`);
  assert.equal(rows[0].n, 1);
  const st = await db.admin.query(`select id, status, error_message from public.documents order by id`);
  assert.equal(st.rows[0].status, 'failed');
  assert.match(st.rows[0].error_message, /zbyt długo/);
  assert.equal(st.rows[1].status, 'processing');

  // a „failed" można ponowić (retry_document) albo wpisać ręcznie
  await T.session.query(`select public.retry_document($1)`, [id(1)]);
  assert.equal((await db.admin.query(`select status from public.documents where id = $1`, [id(1)])).rows[0].status, 'processing');
});

test('strażnik jest niedostępny dla zalogowanych', async () => {
  const T = await ownerWithTenant(db, 'R2');
  await expectError(T.session.query(`select public.reap_stuck_documents()`), /permission denied/);
});
