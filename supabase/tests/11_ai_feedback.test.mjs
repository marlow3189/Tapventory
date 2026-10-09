// ============================================================================
// Migracja 0014: migawka odczytu maszynowego + raport poprawek (pętla zwrotna jakości).
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, ownerWithTenant, asService, asAnon, insertProduct, expectError } from './helpers.mjs';

let db;
test.before(async () => { db = await createTestDb(); });
test.after(async () => { await db.drop(); });

let seq = 0;
const nextId = () => `00000000-0000-4000-8000-${String(200000000000 + ++seq).slice(-12)}`;

async function newDoc(T) {
  const id = nextId();
  await T.session.query(`select public.create_photo_document($1, $2, $3)`, [id, T.tenantId, [`${T.tenantId}/documents/${id}/page-1.jpg`]]);
  return id;
}

const extraction = (over = {}) => ({
  doc_kind: 'invoice', supplier_name: 'Hurtownia ABC Sp. z o.o.', supplier_nip: '526-025-09-95',
  invoice_number: 'FV/1/2026', issue_date: '2026-10-05', currency: 'PLN', total_net: 160.5, total_gross: 197.42,
  ai_model: 'claude-haiku-5-5', ai_confidence: 91, ai_warnings: [],
  lines: [
    { raw_name: 'Rękawice nitrylowe L', qty: 3, unit: 'op.', unit_price_net: 24.5, total_net: 73.5, vat_rate: 23, ai_confidence: 96 },
    { raw_name: 'Transport', qty: 1, unit: 'usł.', unit_price_net: 15, total_net: 15, vat_rate: 23, ai_confidence: 50, skip: true },
  ],
  ...over,
});
const apply = (docId, ex) => asService(db).query(`select public.apply_document_extraction($1, $2::jsonb) as r`, [docId, JSON.stringify(ex)]).then((r) => r.rows[0].r);
const report = async (...args) => (await asService(db).query(`select public.ai_correction_report(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args)).rows[0].r;
const since = '2000-01-01T00:00:00Z';

test('migawka: zapisywana razem z odczytem (nagłówek + pozycje z identyfikatorami), klient nie może jej zmienić', async () => {
  const T = await ownerWithTenant(db, 'FB1');
  const gloves = await insertProduct(db, T.tenantId, 'Rękawice nitrylowe L', { unit: 'op.' });
  const docId = await newDoc(T);
  assert.equal((await db.admin.query(`select ai_extraction from public.documents where id = $1`, [docId])).rows[0].ai_extraction, null);

  await apply(docId, extraction());
  const snap = (await db.admin.query(`select ai_extraction from public.documents where id = $1`, [docId])).rows[0].ai_extraction;
  assert.equal(snap.version, 1);
  assert.equal(snap.model, 'claude-haiku-5-5');
  assert.deepEqual({ nip: snap.header.supplier_nip, number: snap.header.invoice_number, net: snap.header.total_net, date: snap.header.issue_date },
    { nip: '5260250995', number: 'FV/1/2026', net: 160.5, date: '2026-10-05' });
  assert.equal(snap.lines.length, 2);
  assert.equal(snap.lines[0].product_id, gloves, 'migawka zapamiętuje także automatyczne dopasowanie produktu');
  assert.equal(snap.lines[1].skip, true);
  const ids = (await db.admin.query(`select id from public.document_lines where document_id = $1 order by line_no`, [docId])).rows.map((r) => r.id);
  assert.deepEqual(snap.lines.map((l) => l.id), ids);

  // zwykły użytkownik (kierownik, nawet właściciel) nie zmieni migawki
  await expectError(T.session.query(`update public.documents set ai_extraction = '{"version":1}'::jsonb where id = $1`, [docId]), /nie podlega edycji/);
  // a innych pól dokumentu dalej może poprawiać
  const ok = await T.session.query(`update public.documents set notes = 'sprawdzone' where id = $1`, [docId]);
  assert.equal(ok.rowCount, 1);
});

test('raport: liczy poprawki człowieka względem odczytu maszynowego (nagłówek i pozycje), dokumenty bez zmian osobno', async () => {
  const T = await ownerWithTenant(db, 'FB2');
  const gloves = await insertProduct(db, T.tenantId, 'Rękawice nitrylowe L', { unit: 'op.' });
  const other = await insertProduct(db, T.tenantId, 'Zupełnie inny produkt', { unit: 'szt.' });

  // A: zatwierdzony bez żadnej poprawki
  const a = await newDoc(T);
  await apply(a, extraction({ invoice_number: 'FV/A' }));
  await T.session.query(`select public.post_document($1)`, [a]);

  // B: człowiek poprawia numer i datę, ilość w pozycji 1, usuwa pozycję 4, przypisuje produkt do pozycji 3 i dopisuje pozycję 5
  const b = await newDoc(T);
  await apply(b, extraction({
    invoice_number: 'FV/B', supplier_nip: '5260250995',
    lines: [
      { raw_name: 'Rękawice nitrylowe L', qty: 3, unit: 'op.', unit_price_net: 24.5, total_net: 73.5, vat_rate: 23, ai_confidence: 96 },
      { raw_name: 'Transport', qty: 1, unit: 'usł.', unit_price_net: 15, total_net: 15, vat_rate: 23, ai_confidence: 50, skip: true },
      { raw_name: 'Zupełnie nieznany towar xyz', qty: 2, unit: 'szt.', unit_price_net: 10, total_net: 20, vat_rate: 23, ai_confidence: 80 },
      { raw_name: 'Pozycja urojona przez model', qty: 1, unit: 'szt.', unit_price_net: 1, total_net: 1, vat_rate: 23, ai_confidence: 40 },
    ],
  }));
  const lines = (await db.admin.query(`select id, line_no from public.document_lines where document_id = $1 order by line_no`, [b])).rows;
  await db.admin.query(`update public.documents set invoice_number = 'FV/B/2026', issue_date = '2026-10-06' where id = $1`, [b]);
  await db.admin.query(`update public.document_lines set qty = 4 where id = $1`, [lines[0].id]);
  await db.admin.query(`update public.document_lines set product_id = $2 where id = $1`, [lines[2].id, other]);
  await db.admin.query(`delete from public.document_lines where id = $1`, [lines[3].id]);
  await db.admin.query(
    `insert into public.document_lines (tenant_id, document_id, line_no, raw_name, qty, unit, product_id) values ($1, $2, 9, 'Dopisana ręcznie', 1, 'szt.', $3)`,
    [T.tenantId, b, gloves]);
  await T.session.query(`select public.post_document($1)`, [b]);

  // C: dokument jeszcze niezatwierdzony nie wchodzi do raportu
  const c = await newDoc(T);
  await apply(c, extraction({ invoice_number: 'FV/C' }));

  const r = await report(since, 'photo');
  assert.equal(r.documents, 2, 'tylko zaksięgowane');
  assert.equal(r.documents_untouched, 1);
  assert.deepEqual(r.header_changed, { doc_kind: 0, supplier_nip: 0, invoice_number: 1, issue_date: 1, currency: 0, total_net: 0, total_gross: 0 });
  assert.deepEqual(r.lines, {
    read_by_machine: 6, deleted: 1, added_manually: 1,
    name_changed: 0, qty_changed: 1, unit_changed: 0, unit_price_changed: 0, total_net_changed: 0, vat_rate_changed: 0, ean_changed: 0, skip_changed: 0,
    product_auto_matched: 2, product_auto_changed: 0, product_matched_by_human: 1,
  });
  assert.deepEqual(r.by_model, [{ model: 'claude-haiku-5-5', documents: 2, untouched: 1 }]);

  // filtr po źródle: dokumenty ze zdjęć vs KSeF vs wszystkie
  assert.equal((await report(since, 'ksef')).documents, 0);
  assert.equal((await report(since, null)).documents, 2);
  // okno czasowe
  assert.equal((await report('2999-01-01T00:00:00Z', 'photo')).documents, 0);
});

test('raport: zmiana produktu przypisanego automatycznie liczy się jako pomyłka dopasowania', async () => {
  const T = await ownerWithTenant(db, 'FB3');
  const gloves = await insertProduct(db, T.tenantId, 'Rękawice nitrylowe L', { unit: 'op.' });
  const wrong = await insertProduct(db, T.tenantId, 'Inny towar', { unit: 'szt.' });
  const d = await newDoc(T);
  await apply(d, extraction({ invoice_number: 'FV/FB3' }));
  const line = (await db.admin.query(`select id from public.document_lines where document_id = $1 and line_no = 1`, [d])).rows[0].id;
  assert.equal((await db.admin.query(`select product_id from public.document_lines where id = $1`, [line])).rows[0].product_id, gloves);
  await db.admin.query(`update public.document_lines set product_id = $2 where id = $1`, [line, wrong]);
  await T.session.query(`select public.post_document($1)`, [d]);

  const before = await report(since, 'photo');
  assert.ok(before.lines.product_auto_changed >= 1);
});

test('uprawnienia: raport i zapis odczytu tylko dla backendu — zalogowani i anonimowi dostają odmowę', async () => {
  const T = await ownerWithTenant(db, 'FB4');
  await expectError(T.session.query(`select public.ai_correction_report()`), /permission denied/);
  await expectError(asAnon(db).query(`select public.ai_correction_report()`), /permission denied/);
  await expectError(T.session.query(`select public.apply_document_extraction(gen_random_uuid(), '{}'::jsonb)`), /permission denied/);
  const ok = await asService(db).query(`select public.ai_correction_report() as r`);
  assert.equal(typeof ok.rows[0].r.documents, 'number');
});
