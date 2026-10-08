// ============================================================================
// Migracja 0010: zapis wyniku odczytu faktury przez AI (apply_document_extraction),
// ochrona limitu przed podwójną rezerwacją, oznaczanie nieudanych dokumentów.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, ownerWithTenant, asService, asAnon, insertProduct, expectError } from './helpers.mjs';

let db;
test.before(async () => { db = await createTestDb(); });
test.after(async () => { await db.drop(); });

let seq = 0;
const nextId = () => `00000000-0000-4000-8000-${String(100000000000 + ++seq).slice(-12)}`;

async function newDoc(T) {
  const id = nextId();
  await T.session.query(`select public.create_photo_document($1, $2, $3)`, [id, T.tenantId, [`${T.tenantId}/documents/${id}/page-1.jpg`]]);
  return id;
}

const extraction = (over = {}) => ({
  doc_kind: 'invoice', supplier_name: 'Hurtownia ABC Sp. z o.o.', supplier_nip: '526-025-09-95',
  invoice_number: 'FV/1/2026', issue_date: '2026-10-05', currency: 'PLN', total_net: 160.5, total_gross: 197.42,
  ai_model: 'claude-haiku-5-5', ai_confidence: 91, ai_warnings: [{ code: 'low', text: 'Pozycja Transport — mała pewność.' }],
  lines: [
    { raw_name: 'Rękawice nitrylowe L', qty: 3, unit: 'op.', unit_price_net: 24.5, total_net: 73.5, vat_rate: 23, ean: null, ai_confidence: 96 },
    { raw_name: 'Transport', qty: 1, unit: 'usł.', unit_price_net: 15, total_net: 15, vat_rate: 23, ai_confidence: 50, skip: true },
    { raw_name: 'Zupełnie nieznany towar xyz', qty: 2, unit: 'szt.', unit_price_net: 10, total_net: 20, vat_rate: 23, ai_confidence: 80 },
  ],
  ...over,
});

const apply = (docId, ex) => asService(db).query(`select public.apply_document_extraction($1, $2::jsonb) as r`, [docId, JSON.stringify(ex)]).then((r) => r.rows[0].r);

test('zapis odczytu: nagłówek, pozycje, dopasowanie, dostawca i status „draft” w jednej transakcji', async () => {
  const T = await ownerWithTenant(db, 'AI1');
  const gloves = await insertProduct(db, T.tenantId, 'Rękawice nitrylowe L', { unit: 'op.' });
  const docId = await newDoc(T);

  const res = await apply(docId, extraction());
  assert.deepEqual({ status: res.status, lines: res.lines, matched: res.matched }, { status: 'draft', lines: 3, matched: 1 });

  const doc = (await db.admin.query(`select * from public.documents where id = $1`, [docId])).rows[0];
  assert.equal(doc.status, 'draft');
  assert.equal(doc.supplier_nip, '5260250995', 'NIP zapisany jako same cyfry');
  assert.equal(doc.invoice_number, 'FV/1/2026');
  assert.equal(String(doc.issue_date.toISOString?.().slice(0, 10) ?? doc.issue_date), '2026-10-05');
  assert.equal(Number(doc.total_net), 160.5);
  assert.equal(doc.ai_model, 'claude-haiku-5-5');
  assert.equal(doc.ai_confidence, 91);
  assert.equal(doc.ai_warnings[0].code, 'low');
  assert.equal(doc.error_message, null);
  assert.ok(doc.processed_at);

  const supplier = (await db.admin.query(`select id, name from public.suppliers where tenant_id = $1 and nip = '5260250995'`, [T.tenantId])).rows;
  assert.equal(supplier.length, 1, 'dostawca powstał z faktury');
  assert.equal(doc.supplier_id, supplier[0].id);

  const lines = (await db.admin.query(`select * from public.document_lines where document_id = $1 order by line_no`, [docId])).rows;
  assert.deepEqual(lines.map((l) => l.line_no), [1, 2, 3]);
  assert.equal(lines[0].product_id, gloves, 'podobna nazwa → produkt przypisany');
  assert.ok(lines[0].match_confidence >= 60);
  assert.equal(lines[1].skip, true);
  assert.equal(lines[2].product_id, null, 'nieznany towar zostaje do decyzji człowieka');
  assert.equal(Number(lines[0].qty), 3);

  // kierownik widzi to w widoku z licznikami
  const ov = (await T.session.query(`select line_count, unmatched_count from public.document_overview where id = $1`, [docId])).rows[0];
  assert.deepEqual({ ...ov }, { line_count: 3, unmatched_count: 1 });
});

test('drugi zapis na „draft” jest odrzucony; po błędzie i ponowieniu pozycje są zastępowane, nie dublowane', async () => {
  const T = await ownerWithTenant(db, 'AI2');
  const docId = await newDoc(T);
  await apply(docId, extraction({ invoice_number: 'FV/2' }));
  await expectError(apply(docId, extraction({ invoice_number: 'FV/2' })), /nie oczekuje na wynik/);

  // cofnięcie do przetwarzania: najpierw błąd, potem „Spróbuj ponownie” (retry_document)
  const doc2 = await newDoc(T);
  await apply(doc2, extraction({ invoice_number: 'FV/3', lines: [{ raw_name: 'A', qty: 1 }, { raw_name: 'B', qty: 1 }] }));
  await db.admin.query(`update public.documents set status = 'processing' where id = $1`, [doc2]);   // admin: symulacja ponowienia
  await apply(doc2, extraction({ invoice_number: 'FV/3', lines: [{ raw_name: 'C', qty: 5 }] }));
  const n = (await db.admin.query(`select count(*)::int n, min(raw_name) first from public.document_lines where document_id = $1`, [doc2])).rows[0];
  assert.deepEqual({ ...n }, { n: 1, first: 'C' });
});

test('duplikat faktury (ten sam NIP + numer) → dokument „failed” z czytelnym komunikatem', async () => {
  const T = await ownerWithTenant(db, 'AI3');
  const first = await newDoc(T);
  await apply(first, extraction({ invoice_number: 'FV/100/2026' }));
  const second = await newDoc(T);
  const res = await apply(second, extraction({ invoice_number: ' fv/100/2026 ' }));   // spacje i wielkość liter bez znaczenia
  assert.equal(res.status, 'failed');
  assert.equal(res.reason, 'duplicate');
  assert.equal(res.duplicate_of, first);
  const d = (await db.admin.query(`select status, error_message from public.documents where id = $1`, [second])).rows[0];
  assert.equal(d.status, 'failed');
  assert.match(d.error_message, /już istnieje/);
  assert.equal((await db.admin.query(`select count(*)::int n from public.document_lines where document_id = $1`, [second])).rows[0].n, 0);
});

test('dane z AI są oczyszczane po stronie bazy: zły NIP, nieznany rodzaj dokumentu', async () => {
  const T = await ownerWithTenant(db, 'AI4');
  const docId = await newDoc(T);
  await apply(docId, extraction({ supplier_nip: '12345', doc_kind: 'coś-dziwnego', invoice_number: 'X-1' }));
  const d = (await db.admin.query(`select supplier_nip, doc_kind, supplier_id from public.documents where id = $1`, [docId])).rows[0];
  assert.equal(d.supplier_nip, null);
  assert.equal(d.doc_kind, 'invoice');
  assert.equal(d.supplier_id, null, 'bez poprawnego NIP nie zakładamy dostawcy');
});

test('niepoprawna pozycja (ilość 0) cofa cały zapis: dokument zostaje „processing”', async () => {
  const T = await ownerWithTenant(db, 'AI5');
  const docId = await newDoc(T);
  await expectError(apply(docId, extraction({ invoice_number: 'Z-1', lines: [{ raw_name: 'Zero', qty: 0 }] })), /document_lines_qty_nonzero|check/);
  const d = (await db.admin.query(`select status, invoice_number from public.documents where id = $1`, [docId])).rows[0];
  assert.deepEqual({ ...d }, { status: 'processing', invoice_number: null });
});

test('fail_document: tylko dokument „processing”; zalogowani i anon nie wywołają funkcji backendu', async () => {
  const T = await ownerWithTenant(db, 'AI6');
  const docId = await newDoc(T);
  await asService(db).query(`select public.fail_document($1, $2)`, [docId, 'Model niedostępny.']);
  const d = (await db.admin.query(`select status, error_message from public.documents where id = $1`, [docId])).rows[0];
  assert.deepEqual({ ...d }, { status: 'failed', error_message: 'Model niedostępny.' });
  // dokument już nie jest „processing” — kolejne wywołanie niczego nie zmienia
  await asService(db).query(`select public.fail_document($1, $2)`, [docId, 'Inny komunikat']);
  assert.equal((await db.admin.query(`select error_message from public.documents where id = $1`, [docId])).rows[0].error_message, 'Model niedostępny.');

  await expectError(T.session.query(`select public.fail_document($1, 'x')`, [docId]), /permission denied/);
  await expectError(T.session.query(`select public.apply_document_extraction($1, '{}'::jsonb)`, [docId]), /permission denied/);
  await expectError(asAnon(db).query(`select public.fail_document($1, 'x')`, [docId]), /permission denied/);
});

test('rezerwacja skanu: ten sam dokument nie zajmuje limitu dwa razy; po błędzie można ponowić', async () => {
  const T = await ownerWithTenant(db, 'AI7');
  const docId = await newDoc(T);
  const svc = asService(db);
  const reserve = () => svc.query(`select public.reserve_ai_scan($1, $2, $3) as id`, [T.tenantId, T.owner.id, docId]).then((r) => r.rows[0].id);

  const usage = await reserve();
  await expectError(reserve(), /AI_ALREADY_PROCESSING/);
  const count = async () => (await T.session.query(`select (public.ai_quota($1) ->> 'used')::int as used`, [T.tenantId])).rows[0].used;
  assert.equal(await count(), 1);

  await svc.query(`select public.finish_ai_scan($1, 'claude-haiku-5-5', 1000, 200, 300, 'error')`, [usage]);
  assert.equal(await count(), 0, 'błąd nie zużywa limitu');
  const again = await reserve();
  assert.ok(again > usage);
  assert.equal(await count(), 1);
});

test('przypomnienie o mini-spisie: jedno na osobę na 20 godzin, także po przeczytaniu poprzedniego', async () => {
  const T = await ownerWithTenant(db, 'AI8');
  await insertProduct(db, T.tenantId, 'Cokolwiek');
  const svc = asService(db);
  const run = () => svc.query(`select public.queue_count_reminders()`);   // przetwarza wszystkie firmy w bazie — dlatego liczymy tylko wpisy tej firmy
  const mine = async () => (await db.admin.query(`select count(*)::int n from public.notifications where tenant_id = $1 and kind = 'count_due'`, [T.tenantId])).rows[0].n;

  await run();
  assert.equal(await mine(), 1, 'pierwsze uruchomienie: przypomnienie dla właściciela');
  await run();
  assert.equal(await mine(), 1, 'drugie: nieprzeczytane już jest');
  await db.admin.query(`update public.notifications set read_at = now() where tenant_id = $1 and kind = 'count_due'`, [T.tenantId]);
  await run();
  assert.equal(await mine(), 1, 'po przeczytaniu: nadal cisza przez 20 godzin (harmonogram chodzi co minutę)');
  await db.admin.query(`update public.notifications set created_at = now() - interval '21 hours' where tenant_id = $1 and kind = 'count_due'`, [T.tenantId]);
  await run();
  assert.equal(await mine(), 2, 'po 20 godzinach można przypomnieć ponownie');
});
