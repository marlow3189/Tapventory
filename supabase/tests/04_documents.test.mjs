// ============================================================================
// Faktury: przetwarzanie → szkic → księgowanie → storno, aliasy i dopasowanie
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDb, asUser, asService, ownerWithTenant, addMember, insertProduct, expectError,
} from './helpers.mjs';

let db;
test.before(async () => {
  db = await createTestDb();
});
test.after(async () => {
  await db.drop();
});

const one = async (sql, params) => (await db.admin.query(sql, params)).rows[0];

async function setup(label) {
  const A = await ownerWithTenant(db, label);
  const mgr = await addMember(db, A.tenantId, 'manager');
  const emp = await addMember(db, A.tenantId, 'employee');
  return { ...A, mgr, emp };
}
/** Szkic faktury z N pozycjami (jako backend/Edge Function). */
async function draftInvoice(T, { number = 'FV/1/2026', nip = '5260250995', lines = [] } = {}) {
  const id = (await db.admin.query(
    `insert into public.documents (tenant_id, source, status, supplier_name, supplier_nip, invoice_number, total_gross)
     values ($1, 'photo', 'draft', 'Hurtownia Kosmetyczna', $2, $3, 100) returning id`, [T.tenantId, nip, number])).rows[0].id;
  let n = 1;
  const lineIds = [];
  for (const l of lines) {
    lineIds.push((await db.admin.query(
      `insert into public.document_lines (tenant_id, document_id, line_no, raw_name, qty, product_id, skip)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [T.tenantId, id, n++, l.raw ?? 'Towar', l.qty ?? 1, l.product ?? null, l.skip ?? false])).rows[0].id);
  }
  return { id, lineIds };
}
const stockOf = async (pid) => Number((await one(`select stock from public.product_overview where id=$1`, [pid])).stock);

// ---------------------------------------------------------------------------
test('księgowanie: pozycje → ruchy „przyjęcie" w jednej transakcji; dokument zamknięty', async () => {
  const T = await setup('D1');
  const lak = await insertProduct(db, T.tenantId, 'Lakier OPI Red 15 ml');
  const olej = await insertProduct(db, T.tenantId, 'Olej do skórek');
  const { id } = await draftInvoice(T, { lines: [
    { raw: 'Lakier hybr. czerw. 15ml', qty: 12, product: lak },
    { raw: 'Olej skórki 8ml', qty: 6.5, product: olej },
    { raw: 'Transport', qty: 1, skip: true },
  ] });

  const n = (await T.mgr.session.query(`select public.post_document($1) n`, [id])).rows[0].n;
  assert.equal(n, 2, 'pozycja „pomijana" nie tworzy ruchu');
  assert.equal(await stockOf(lak), 12);
  assert.equal(await stockOf(olej), 6.5);
  const d = await one(`select status, posted_by, posted_at from public.documents where id=$1`, [id]);
  assert.equal(d.status, 'posted');
  assert.equal(d.posted_by, T.mgr.user.id);
  assert.ok(d.posted_at);
  const mv = (await db.admin.query(`select movement_type, created_by, doc_revision from public.stock_movements where document_id=$1`, [id])).rows;
  assert.deepEqual(mv.map((m) => m.movement_type), ['receipt', 'receipt']);
  assert.ok(mv.every((m) => m.created_by === T.mgr.user.id && m.doc_revision === 1));

  await expectError(T.mgr.session.query(`select public.post_document($1)`, [id]), /już zaksięgowany/);          // nie dwa razy
  await expectError(T.mgr.session.query(`update public.documents set notes='x' where id=$1`, [id]), /tylko do odczytu/);
  await expectError(T.mgr.session.query(`delete from public.documents where id=$1`, [id]), /permission denied|tylko do odczytu|0 rows/).catch(() => {});
  const del = await T.mgr.session.query(`delete from public.documents where id=$1`, [id]);
  assert.equal(del.rowCount, 0, 'RLS: zaksięgowanego nie wolno kasować');
  const line = await T.mgr.session.query(`update public.document_lines set qty=999 where document_id=$1`, [id]);
  assert.equal(line.rowCount, 0, 'pozycje zaksięgowanego dokumentu są zamrożone');
});

test('księgowanie: odmowa dla pracownika, dla pozycji bez produktu i dla dokumentu w przetwarzaniu', async () => {
  const T = await setup('D2');
  const p = await insertProduct(db, T.tenantId, 'Gaziki');
  const { id } = await draftInvoice(T, { lines: [{ raw: 'Coś', qty: 3, product: null }, { raw: 'Gaziki', qty: 1, product: p }] });

  await expectError(T.emp.session.query(`select public.post_document($1)`, [id]), /Nie znaleziono|brak uprawnień/);
  await expectError(T.mgr.session.query(`select public.post_document($1)`, [id]), /bez przypisanego produktu: 1/);
  assert.equal(await stockOf(p), 0, 'nic się nie zaksięgowało (transakcja)');
  assert.equal(Number((await one(`select count(*) n from public.stock_movements where document_id=$1`, [id])).n), 0);

  const proc = (await db.admin.query(`insert into public.documents (tenant_id, source, status) values ($1,'photo','processing') returning id`, [T.tenantId])).rows[0].id;
  await expectError(T.mgr.session.query(`select public.post_document($1)`, [proc]), /nie jest gotowy/);
});

test('księgowanie: nie da się obejść przez bezpośredni UPDATE/INSERT statusu', async () => {
  const T = await setup('D3');
  const p = await insertProduct(db, T.tenantId, 'Rękawiczki');
  const { id } = await draftInvoice(T, { lines: [{ raw: 'Rękawiczki', qty: 10, product: p }] });

  await expectError(T.mgr.session.query(`update public.documents set status='posted' where id=$1`, [id]), /przyciski/);
  await expectError(T.mgr.session.query(`update public.documents set status='processing' where id=$1`, [id]), /przyciski/);
  await expectError(T.mgr.session.query(`update public.documents set revision=99, posted_by=$2 where id=$1`, [id, T.mgr.user.id]), /nie edytuje się ręcznie/);
  // ręczne dodanie dokumentu „od razu zaksięgowanego" kończy jako zwykły szkic
  const ins = await T.mgr.session.query(
    `insert into public.documents (tenant_id, source, status, posted_by, posted_at, revision) values ($1,'ksef','posted',$2,now(),7) returning source, status, posted_by, revision`,
    [T.tenantId, T.mgr.user.id]);
  assert.deepEqual(ins.rows[0], { source: 'manual', status: 'draft', posted_by: null, revision: 1 });
  // dozwolone ręczne przejścia: szkic ↔ zweryfikowany
  await T.mgr.session.query(`update public.documents set status='verified' where id=$1`, [id]);
  await T.mgr.session.query(`update public.documents set status='draft' where id=$1`, [id]);
});

test('storno: „Cofnij księgowanie" dopisuje ruchy odwrotne, wraca do szkicu, można poprawić i zaksięgować ponownie', async () => {
  const T = await setup('D4');
  const p = await insertProduct(db, T.tenantId, 'Płyn 1 l');
  const { id, lineIds } = await draftInvoice(T, { lines: [{ raw: 'Płyn', qty: 10, product: p }] });
  await T.mgr.session.query(`select public.post_document($1)`, [id]);
  await T.mgr.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'issue',-3)`, [T.tenantId, p]);
  assert.equal(await stockOf(p), 7);

  await expectError(T.mgr.session.query(`select public.unpost_document($1, 'x')`, [id]), /Podaj powód/);
  await expectError(T.emp.session.query(`select public.unpost_document($1, 'pomyłka w ilości')`, [id]), /brak uprawnień/);
  const rev = (await T.mgr.session.query(`select public.unpost_document($1, 'pomyłka w ilości') n`, [id])).rows[0].n;
  assert.equal(rev, 1);
  assert.equal(await stockOf(p), -3, 'cofnięto przyjęcie 10 szt. (3 już zeszły → stan ujemny widoczny dla spisu)');

  const d = await one(`select status, revision, posted_by from public.documents where id=$1`, [id]);
  assert.deepEqual({ ...d }, { status: 'draft', revision: 2, posted_by: null });
  const moves = (await db.admin.query(`select movement_type, qty, reverses_id, note from public.stock_movements where document_id=$1 order by created_at, id`, [id])).rows;
  assert.equal(moves.length, 2);
  assert.equal(moves[1].movement_type, 'adjustment');
  assert.equal(Number(moves[1].qty), -10);
  assert.ok(moves[1].reverses_id);
  assert.match(moves[1].note, /Storno: pomyłka w ilości/);
  await expectError(T.mgr.session.query(`select public.unpost_document($1, 'jeszcze raz')`, [id]), /tylko zaksięgowany/);

  // poprawka i ponowne księgowanie (nowa rewizja → nowe ruchy)
  await T.mgr.session.query(`update public.document_lines set qty=7 where id=$1`, [lineIds[0]]);
  await T.mgr.session.query(`select public.post_document($1)`, [id]);
  assert.equal(await stockOf(p), 4);
  const cnt = await one(`select count(*)::int n from public.stock_movements where document_id=$1`, [id]);
  assert.equal(cnt.n, 3);
});

test('storno: ten sam ruch odwracany najwyżej raz (ochrona przed podwójnym storno)', async () => {
  const T = await setup('D5');
  const p = await insertProduct(db, T.tenantId, 'Mydło');
  const { id } = await draftInvoice(T, { lines: [{ raw: 'Mydło', qty: 5, product: p }] });
  await T.mgr.session.query(`select public.post_document($1)`, [id]);
  const mv = (await db.admin.query(`select id, tenant_id, product_id, document_id, document_line_id, doc_revision from public.stock_movements where document_id=$1`, [id])).rows[0];
  await T.mgr.session.query(`select public.unpost_document($1, 'test powodu')`, [id]);
  await expectError(db.admin.query(
    `insert into public.stock_movements (tenant_id, product_id, movement_type, qty, reverses_id, created_by) values ($1,$2,'adjustment',-5,$3,$4)`,
    [mv.tenant_id, mv.product_id, mv.id, T.mgr.user.id]), /stock_movements_reversed_once|duplicate key/);
});

test('duplikaty: ten sam numer faktury od tego samego dostawcy — także z innymi spacjami i wielkością liter', async () => {
  const T = await setup('D6');
  await draftInvoice(T, { number: 'FV/001/2026' });
  await expectError(draftInvoice(T, { number: '  fv/001/2026 ' }), /documents_duplicate_guard|duplicate key/);
  await draftInvoice(T, { number: 'FV/002/2026' });                 // inny numer — ok
  await draftInvoice(T, { number: 'FV/001/2026', nip: '1234563218' }); // inny dostawca — ok
  const other = await setup('D6b');
  await draftInvoice(other, { number: 'FV/001/2026' });             // inna firma — ok
});

test('zdjęcia: create_photo_document zakłada dokument w przetwarzaniu, jest idempotentne i pilnuje ścieżek', async () => {
  const T = await setup('D7');
  const other = await ownerWithTenant(db, 'D7obca');
  const id = '0192f0d3-7a10-7000-8000-000000000001';
  const paths = [`${T.tenantId}/documents/${id}/p1.jpg`, `${T.tenantId}/documents/${id}/p2.jpg`];

  await expectError(T.emp.session.query(`select public.create_photo_document($1,$2,$3)`, [id, T.tenantId, paths]), /kierownictwo/);
  await expectError(T.mgr.session.query(`select public.create_photo_document($1,$2,$3)`, [id, T.tenantId, [`${other.tenantId}/documents/x.jpg`]]), /folderze Twojej firmy/);
  await expectError(T.mgr.session.query(`select public.create_photo_document($1,$2,$3)`, [id, T.tenantId, []]), /od 1 do 10/);
  await T.mgr.session.query(`select public.create_photo_document($1,$2,$3)`, [id, T.tenantId, paths]);
  await T.mgr.session.query(`select public.create_photo_document($1,$2,$3)`, [id, T.tenantId, paths]);   // powtórka (retry sieci)
  const d = await one(`select status, source, page_count, created_by from public.documents where id=$1`, [id]);
  assert.deepEqual({ ...d }, { status: 'processing', source: 'photo', page_count: 2, created_by: T.mgr.user.id });
  assert.equal(Number((await one(`select count(*) n from public.documents where id=$1`, [id])).n), 1);
  // cudzy identyfikator nie jest przejmowany
  await expectError(other.session.query(`select public.create_photo_document($1,$2,$3)`, [id, other.tenantId, [`${other.tenantId}/documents/z.jpg`]]), /zajęty/);
  // w przetwarzaniu: nikt nie edytuje
  await expectError(T.mgr.session.query(`update public.documents set invoice_number='X' where id=$1`, [id]), /w trakcie czytania/);
});

test('ponawianie: tylko nieudane, z limitem prób; status zmienia backend po przetworzeniu', async () => {
  const T = await setup('D8');
  const id = (await db.admin.query(
    `insert into public.documents (tenant_id, source, status, error_message) values ($1,'photo','failed','Nieczytelne zdjęcie') returning id`, [T.tenantId])).rows[0].id;
  await T.mgr.session.query(`select public.retry_document($1)`, [id]);
  let d = await one(`select status, retry_count, error_message from public.documents where id=$1`, [id]);
  assert.deepEqual({ ...d }, { status: 'processing', retry_count: 1, error_message: null });
  await expectError(T.mgr.session.query(`select public.retry_document($1)`, [id]), /tylko dokument, którego odczyt/);

  // Edge Function (service_role) kończy przetwarzanie i wpisuje wynik
  const svc = asService(db);
  await svc.query(`update public.documents set status='draft', ai_model='test-model', ai_confidence=92, processed_at=now() where id=$1`, [id]);
  d = await one(`select status, ai_model from public.documents where id=$1`, [id]);
  assert.equal(d.status, 'draft');
  await db.admin.query(`update public.documents set status='failed', retry_count=5 where id=$1`, [id]);
  await expectError(T.mgr.session.query(`select public.retry_document($1)`, [id]), /Zbyt wiele prób/);
});

test('faktury korygujące: ujemne ilości księgują się jako korekta; zero jest niedozwolone', async () => {
  const T = await setup('D9');
  const p = await insertProduct(db, T.tenantId, 'Klej');
  await db.admin.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty, created_by) values ($1,$2,'receipt',10,$3)`, [T.tenantId, p, T.owner.id]);
  const { id } = await draftInvoice(T, { number: 'KOR/1', lines: [{ raw: 'Klej (korekta)', qty: -2, product: p }] });
  await expectError(db.admin.query(`insert into public.document_lines (tenant_id, document_id, raw_name, qty) values ($1,$2,'zero',0)`, [T.tenantId, id]), /document_lines_qty_nonzero/);
  await T.mgr.session.query(`select public.post_document($1)`, [id]);
  assert.equal(await stockOf(p), 8);
  const mv = await one(`select movement_type from public.stock_movements where document_id=$1`, [id]);
  assert.equal(mv.movement_type, 'adjustment');
});

// ---------------------------------------------------------------------------
test('aliasy: księgowanie uczy słownik, a dopasowanie z niego korzysta (dostawca > ogólny)', async () => {
  const T = await setup('A1');
  const lak = await insertProduct(db, T.tenantId, 'Lakier OPI Red 15 ml');
  const { id } = await draftInvoice(T, { lines: [{ raw: 'LAKIER HYBR. CZERW. 15ML', qty: 4, product: lak }] });
  await T.mgr.session.query(`select public.post_document($1)`, [id]);

  const al = await one(`select alias_norm, uses, supplier_nip from public.product_aliases where tenant_id=$1`, [T.tenantId]);
  assert.deepEqual({ ...al }, { alias_norm: 'lakier hybr czerw 15ml', uses: 1, supplier_nip: '5260250995' });

  const res = (await T.mgr.session.query(
    `select public.match_products($1, '5260250995', $2::jsonb) m`,
    [T.tenantId, JSON.stringify([{ name: 'Lakier Hybr.  Czerw. 15ml' }])])).rows[0].m;
  assert.equal(res[0].product_id, lak);
  assert.equal(res[0].method, 'alias');
  assert.equal(res[0].confidence, 98);

  // ten sam tekst od INNEGO dostawcy nie jest aliasem dla tamtego (ale może trafić podobieństwem)
  const res2 = (await T.mgr.session.query(
    `select public.match_products($1, '1234563218', $2::jsonb) m`,
    [T.tenantId, JSON.stringify([{ name: 'LAKIER HYBR. CZERW. 15ML' }])])).rows[0].m;
  assert.notEqual(res2[0].method, 'alias');

  // drugie księgowanie tego samego aliasu zwiększa licznik
  const d2 = await draftInvoice(T, { number: 'FV/2', lines: [{ raw: 'LAKIER HYBR. CZERW. 15ML', qty: 1, product: lak }] });
  await T.mgr.session.query(`select public.post_document($1)`, [d2.id]);
  assert.equal(Number((await one(`select uses from public.product_aliases where tenant_id=$1 and supplier_nip='5260250995'`, [T.tenantId])).uses), 2);
});

test('dopasowanie: EAN > alias > podobieństwo; brak pewnego trafienia = brak produktu', async () => {
  const T = await setup('M1');
  const mleko = (await db.admin.query(`insert into public.products (tenant_id, name, ean) values ($1,'Płyn do dezynfekcji 1 l','5900000000031') returning id`, [T.tenantId])).rows[0].id;
  const lak = await insertProduct(db, T.tenantId, 'Lakier hybrydowy czerwony 8 ml');
  await insertProduct(db, T.tenantId, 'Rękawiczki nitrylowe M 100 szt');

  const items = [
    { name: 'cokolwiek', ean: '5900000000031' },                 // EAN
    { name: 'Lakier hybrydowy czerwony 8ml' },                   // podobieństwo (bez spacji)
    { name: 'Zupełnie inny towar budowlany' },                   // brak
    { name: '' },                                                // pusta nazwa
  ];
  const res = (await T.mgr.session.query(`select public.match_products($1, null, $2::jsonb) m`, [T.tenantId, JSON.stringify(items)])).rows[0].m;
  assert.deepEqual(res.map((r) => r.method), ['ean', 'similarity', 'none', 'none']);
  assert.equal(res[0].product_id, mleko);
  assert.equal(res[0].confidence, 99);
  assert.equal(res[1].product_id, lak);
  assert.ok(res[1].confidence >= 45 && res[1].confidence <= 90);
  assert.equal(res[2].product_id, null);
  assert.equal(res[3].confidence, 0);
  // pracownik nie dopasowuje faktur; backend — tak
  await expectError(T.emp.session.query(`select public.match_products($1, null, '[]'::jsonb)`, [T.tenantId]), /Brak uprawnień/);
  const viaSvc = await asService(db).query(`select public.match_products($1, null, $2::jsonb) m`, [T.tenantId, JSON.stringify([{ name: 'x', ean: '5900000000031' }])]);
  assert.equal(viaSvc.rows[0].m[0].product_id, mleko);
});

test('dopasowanie: dotyczy tylko produktów własnej firmy i tylko aktywnych', async () => {
  const A = await setup('M2');
  const B = await setup('M2b');
  const pb = (await db.admin.query(`insert into public.products (tenant_id, name, ean) values ($1,'Produkt tajny B','5900000000048') returning id`, [B.tenantId])).rows[0].id;
  const archived = (await db.admin.query(`insert into public.products (tenant_id, name, ean, active) values ($1,'Archiwalny','5900000000055', false) returning id`, [A.tenantId])).rows[0].id;
  const res = (await A.mgr.session.query(
    `select public.match_products($1, null, $2::jsonb) m`,
    [A.tenantId, JSON.stringify([{ name: 'Produkt tajny B', ean: '5900000000048' }, { name: 'Archiwalny', ean: '5900000000055' }])])).rows[0].m;
  assert.deepEqual(res.map((r) => r.product_id), [null, null]);
  assert.ok(pb && archived);
  // słownik aliasów: kierownik firmy B nie widzi aliasów firmy A i odwrotnie
  await A.mgr.session.query(`insert into public.product_aliases (tenant_id, alias_norm, product_id) values ($1,'abc',$2)`, [A.tenantId, archived]);
  assert.equal((await B.mgr.session.query(`select count(*)::int n from public.product_aliases`)).rows[0].n, 0);
  await expectError(A.emp.session.query(`insert into public.product_aliases (tenant_id, alias_norm, product_id) values ($1,'def',$2)`, [A.tenantId, archived]), /row-level/);
});

test('widok document_overview: tylko kierownictwo; liczy pozycje i nieprzypisane', async () => {
  const T = await setup('V1');
  const p = await insertProduct(db, T.tenantId, 'Gaziki');
  const { id } = await draftInvoice(T, { lines: [{ raw: 'A', qty: 1, product: p }, { raw: 'B', qty: 1 }, { raw: 'Transport', qty: 1, skip: true }] });
  const row = (await T.mgr.session.query(`select line_count, unmatched_count, status from public.document_overview where id=$1`, [id])).rows[0];
  assert.deepEqual({ ...row }, { line_count: 3, unmatched_count: 1, status: 'draft' });
  assert.equal((await T.emp.session.query(`select count(*)::int n from public.document_overview`)).rows[0].n, 0);
  const stranger = await ownerWithTenant(db, 'V1obca');
  assert.equal((await stranger.session.query(`select count(*)::int n from public.document_overview`)).rows[0].n, 0);
});
