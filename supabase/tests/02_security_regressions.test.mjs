// ============================================================================
// Regresje bezpieczeństwa F1–F10 (opis każdej usterki: docs/05_RAPORT_WERYFIKACJI.md)
// ============================================================================
// Każdy test odtwarza atak/usterkę z fundamentu (migracje 0001–0002) i wymaga,
// żeby po migracji 0003 się NIE udał. Uruchomione na samym 0001+0002 te testy
// świeciły na czerwono — to jest dowód, że usterki były prawdziwe.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDb, signUp, asUser, asAnon, ownerWithTenant, addMember, insertProduct, expectError,
} from './helpers.mjs';

let db;
test.before(async () => {
  db = await createTestDb();
});
test.after(async () => {
  await db.drop();
});

const count = async (sql, params) => (await db.admin.query(sql, params)).rows[0].n;

// ---------------------------------------------------------------------------
test('F1: osoba spoza firmy NIE może wystawić zaproszenia (żadnej roli)', async () => {
  const A = await ownerWithTenant(db, 'F1');
  const intruder = await signUp(db, { name: 'Intruz' });
  const s = asUser(db, intruder);

  for (const role of ['owner', 'manager', 'employee']) {
    await expectError(
      s.query(`select public.create_invite($1, $2, $3)`, [A.tenantId, intruder.email, role]),
      /Współwłaściciela|Kierownika|Pracownika/
    );
  }
  assert.equal(await count(`select count(*)::int n from public.tenant_invites where tenant_id=$1`, [A.tenantId]), 0);
  assert.equal(await count(`select count(*)::int n from public.memberships where tenant_id=$1 and user_id=$2`, [A.tenantId, intruder.id]), 0);
});

test('F1: pozostałe RPC też odmawiają osobie spoza firmy', async () => {
  const A = await ownerWithTenant(db, 'F1b');
  const emp = await addMember(db, A.tenantId, 'employee');
  const mgr = await addMember(db, A.tenantId, 'manager');
  const intruder = await signUp(db, { name: 'Intruz2' });
  const s = asUser(db, intruder);
  const membershipId = (await db.admin.query(`select id from public.memberships where user_id=$1`, [mgr.user.id])).rows[0].id;

  await expectError(s.query(`select public.set_manager_flag($1, true)`, [membershipId]), /wyłącznie właściciel/);
  await expectError(s.query(`select public.set_billing_flag($1, true)`, [membershipId]), /wyłącznie właściciel/);
  await expectError(s.query(`select public.set_tenant_nip($1, '5260250995')`, [A.tenantId]), /wyłącznie właściciel/);
  await expectError(s.query(`select public.delete_tenant($1, 'Firma F1b')`, [A.tenantId]), /wyłącznie właściciel/);
  await expectError(s.query(`select public.revoke_invite(gen_random_uuid())`), /Nie znaleziono/);
  // pracownik i kierownik też nie mogą przejąć uprawnień właściciela
  await expectError(emp.session.query(`select public.set_manager_flag($1, true)`, [membershipId]), /wyłącznie właściciel/);
  await expectError(mgr.session.query(`select public.set_billing_flag($1, true)`, [membershipId]), /wyłącznie właściciel/);
});

test('F1: byli członkowie nie wracają do firmy „tylnymi drzwiami"', async () => {
  const A = await ownerWithTenant(db, 'F1c');
  const fired = await addMember(db, A.tenantId, 'employee');
  await A.session.query(`delete from public.memberships where user_id=$1`, [fired.user.id]);
  // zwolniony pracownik nadal zna UUID firmy:
  await expectError(
    fired.session.query(`select public.create_invite($1, $2, 'owner')`, [A.tenantId, fired.user.email]),
    /Współwłaściciela/
  );
});

// ---------------------------------------------------------------------------
test('F2: kierownik nie może podnieść roli w istniejącym zaproszeniu', async () => {
  const A = await ownerWithTenant(db, 'F2');
  const mgr = await addMember(db, A.tenantId, 'manager');
  const invitee = await signUp(db, { name: 'Zapraszany' });
  const { rows } = await mgr.session.query(`select (public.create_invite($1, $2, 'employee')).id as id`, [A.tenantId, invitee.email]);

  await expectError(mgr.session.query(`update public.tenant_invites set role='owner' where id=$1`, [rows[0].id]), /permission denied/);
  await expectError(mgr.session.query(`select token from public.tenant_invites`), /permission denied/);
  // widok dla kierownictwa nie zawiera sekretów:
  const view = await mgr.session.query(`select * from public.team_invites where tenant_id=$1`, [A.tenantId]);
  assert.equal(view.rows.length, 1);
  assert.ok(!('token' in view.rows[0]) && !('code' in view.rows[0]));
});

// ---------------------------------------------------------------------------
test('F3: pracownik nie widzi faktur, pozycji ani plików faktur; kierownik tak', async () => {
  const A = await ownerWithTenant(db, 'F3');
  const emp = await addMember(db, A.tenantId, 'employee');
  const mgr = await addMember(db, A.tenantId, 'manager');
  const doc = (await db.admin.query(
    `insert into public.documents (tenant_id, source, supplier_name, total_gross) values ($1,'manual','Hurtownia',1234.56) returning id`, [A.tenantId])).rows[0].id;
  await db.admin.query(`insert into public.document_lines (tenant_id, document_id, raw_name, qty) values ($1,$2,'Towar',1)`, [A.tenantId, doc]);
  await db.admin.query(`insert into storage.objects (bucket_id, name) values ('documents', $1), ('product-photos', $2)`,
    [`${A.tenantId}/documents/f.jpg`, `${A.tenantId}/products/p.jpg`]);

  assert.equal((await emp.session.query(`select count(*)::int n from public.documents`)).rows[0].n, 0);
  assert.equal((await emp.session.query(`select count(*)::int n from public.document_lines`)).rows[0].n, 0);
  const files = (await emp.session.query(`select bucket_id from storage.objects order by 1`)).rows.map((r) => r.bucket_id);
  assert.deepEqual(files, ['product-photos']);

  assert.equal((await mgr.session.query(`select count(*)::int n from public.documents`)).rows[0].n, 1);
  assert.equal((await mgr.session.query(`select count(*)::int n from public.document_lines`)).rows[0].n, 1);
  const mfiles = (await mgr.session.query(`select bucket_id from storage.objects order by 1`)).rows.map((r) => r.bucket_id);
  assert.deepEqual(mfiles, ['documents', 'product-photos']);
});

// ---------------------------------------------------------------------------
test('F4: właściciel usuwa firmę razem z historią ruchów (po wpisaniu nazwy)', async () => {
  const A = await ownerWithTenant(db, 'F4');
  const other = await ownerWithTenant(db, 'F4-obca');
  const mgr = await addMember(db, A.tenantId, 'manager');
  const pid = await insertProduct(db, A.tenantId, 'Rękawiczki');
  await A.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',10)`, [A.tenantId, pid]);
  const reqId = (await A.session.query(`insert into public.requests (tenant_id, free_name) values ($1,'Lakier') returning id`, [A.tenantId])).rows[0].id;
  await A.session.query(`insert into public.request_messages (tenant_id, request_id, body) values ($1,$2,'Potrzebne na jutro')`, [A.tenantId, reqId]);
  await db.admin.query(`insert into public.documents (tenant_id, source) values ($1,'manual')`, [A.tenantId]);

  await expectError(mgr.session.query(`select public.delete_tenant($1, 'Firma F4')`, [A.tenantId]), /wyłącznie właściciel/);
  await expectError(A.session.query(`select public.delete_tenant($1, 'zła nazwa')`, [A.tenantId]), /dokładną nazwę/);
  await expectError(A.session.query(`delete from public.tenants where id=$1`, [A.tenantId]), /permission denied/);
  assert.equal(await count(`select count(*)::int n from public.tenants where id=$1`, [A.tenantId]), 1);

  await A.session.query(`select public.delete_tenant($1, ' firma f4 ')`, [A.tenantId]);   // wielkość liter i spacje bez znaczenia

  for (const t of ['tenants', 'memberships', 'products', 'stock_movements', 'requests', 'request_messages', 'documents', 'referral_codes']) {
    const col = t === 'tenants' ? 'id' : 'tenant_id';
    assert.equal(await count(`select count(*)::int n from public.${t} where ${col}=$1`, [A.tenantId]), 0, `${t} po usunięciu firmy`);
  }
  assert.equal(await count(`select count(*)::int n from public.tenant_deletions where tenant_id=$1`, [A.tenantId]), 1, 'ślad usunięcia');
  assert.equal(await count(`select count(*)::int n from public.tenants where id=$1`, [other.tenantId]), 1, 'cudza firma nietknięta');
});

test('F4: blokada „tylko dopisywanie" działa poza usuwaniem firmy (także dla właściciela)', async () => {
  const A = await ownerWithTenant(db, 'F4b');
  const pid = await insertProduct(db, A.tenantId, 'Mydło');
  const mv = (await A.session.query(
    `insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',3) returning id`, [A.tenantId, pid])).rows[0].id;
  await expectError(A.session.query(`update public.stock_movements set qty=99 where id=$1`, [mv]), /permission denied|tylko do dopisywania|0 rows|row-level/);
  // nawet superużytkownik (admin) nie edytuje księgi, bo blokuje trigger:
  await expectError(db.admin.query(`update public.stock_movements set qty=99 where id=$1`, [mv]), /tylko do dopisywania/);
  await expectError(db.admin.query(`delete from public.stock_movements where id=$1`, [mv]), /tylko do dopisywania/);
  // zmienna sesji dla INNEJ firmy niczego nie zwalnia:
  await db.admin.query(`select set_config('tapventory.deleting_tenant', gen_random_uuid()::text, false)`);
  await expectError(db.admin.query(`delete from public.stock_movements where id=$1`, [mv]), /tylko do dopisywania/);
  await db.admin.query(`select set_config('tapventory.deleting_tenant', '', false)`);
});

test('F4: usunięcie konta — z historią w firmie; profil anonimizowany, ślad zostaje', async () => {
  const A = await ownerWithTenant(db, 'F4c');
  const emp = await addMember(db, A.tenantId, 'employee');
  const pid = await insertProduct(db, A.tenantId, 'Gaziki');
  await emp.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',5)`, [A.tenantId, pid]);
  await emp.session.query(`insert into public.requests (tenant_id, free_name) values ($1,'Płyn')`, [A.tenantId]);
  await db.admin.query(`update public.profiles set phone='+48 600 100 200' where id=$1`, [emp.user.id]);

  await emp.session.query(`select public.delete_account()`);

  assert.equal(await count(`select count(*)::int n from auth.users where id=$1`, [emp.user.id]), 0);
  assert.equal(await count(`select count(*)::int n from public.memberships where user_id=$1`, [emp.user.id]), 0);
  const prof = (await db.admin.query(`select display_name, phone, deleted_at from public.profiles where id=$1`, [emp.user.id])).rows[0];
  assert.equal(prof.display_name, 'Usunięty użytkownik');
  assert.equal(prof.phone, null);
  assert.ok(prof.deleted_at);
  assert.equal(await count(`select count(*)::int n from public.stock_movements where created_by=$1`, [emp.user.id]), 1, 'ruch w księdze zostaje');
});

test('F4: jedyny właściciel nie usunie konta, współwłaściciel — tak', async () => {
  const A = await ownerWithTenant(db, 'F4d');
  await expectError(A.session.query(`select public.delete_account()`), /jedynym właścicielem firm: Firma F4d/);
  const co = await addMember(db, A.tenantId, 'owner');
  await A.session.query(`select public.delete_account()`);
  assert.equal(await count(`select count(*)::int n from public.memberships where tenant_id=$1 and role='owner'`, [A.tenantId]), 1);
  assert.equal(await count(`select count(*)::int n from public.memberships where user_id=$1`, [co.user.id]), 1);
});

// ---------------------------------------------------------------------------
test('F5: rejestracja nie wywala się dla pustego imienia ani konta bez e-maila', async () => {
  const empty = await signUp(db, { email: 'pusty@test.pl', meta: { display_name: '   ' } });
  const p1 = (await db.admin.query(`select display_name from public.profiles where id=$1`, [empty.id])).rows[0];
  assert.equal(p1.display_name, 'pusty');

  const noMeta = await signUp(db, { email: 'brak.meta@test.pl', meta: {} });
  assert.equal((await db.admin.query(`select display_name from public.profiles where id=$1`, [noMeta.id])).rows[0].display_name, 'brak.meta');

  const { rows } = await db.admin.query(`insert into auth.users (id, email) values (gen_random_uuid(), null) returning id`);
  assert.equal((await db.admin.query(`select display_name from public.profiles where id=$1`, [rows[0].id])).rows[0].display_name, 'Użytkownik');

  const long = await signUp(db, { email: 'dlugie@test.pl', meta: { display_name: 'x'.repeat(200) } });
  assert.equal((await db.admin.query(`select char_length(display_name)::int n from public.profiles where id=$1`, [long.id])).rows[0].n, 80);
});

// ---------------------------------------------------------------------------
test('F6: rekord jednej firmy nie może wskazywać rekordu innej firmy', async () => {
  const A = await ownerWithTenant(db, 'F6a');
  const C = await ownerWithTenant(db, 'F6c');
  const docA = (await db.admin.query(`insert into public.documents (tenant_id, source) values ($1,'manual') returning id`, [A.tenantId])).rows[0].id;
  const supA = (await db.admin.query(`insert into public.suppliers (tenant_id, name) values ($1,'Dostawca A') returning id`, [A.tenantId])).rows[0].id;
  const projA = (await db.admin.query(`insert into public.projects (tenant_id, name) values ($1,'Zlecenie A') returning id`, [A.tenantId])).rows[0].id;
  const prodA = await insertProduct(db, A.tenantId, 'Produkt A');
  const prodC = await insertProduct(db, C.tenantId, 'Produkt C');
  const reqA = (await db.admin.query(`insert into public.requests (tenant_id, free_name, reporter_id) values ($1,'x',$2) returning id`, [A.tenantId, A.owner.id])).rows[0].id;

  const bad = /foreign key|violates/;
  // ruch firmy C -> dokument/projekt firmy A
  await expectError(C.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty, document_id) values ($1,$2,'receipt',1,$3)`, [C.tenantId, prodC, docA]), bad);
  await expectError(C.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty, project_id) values ($1,$2,'receipt',1,$3)`, [C.tenantId, prodC, projA]), bad);
  // ruch firmy C -> produkt firmy A
  await expectError(C.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',1)`, [C.tenantId, prodA]), bad);
  // produkt firmy C -> dostawca firmy A
  await expectError(C.session.query(`insert into public.products (tenant_id, name, default_supplier_id) values ($1,'X',$2)`, [C.tenantId, supA]), bad);
  // zgłoszenie firmy C -> produkt/dostawca/projekt firmy A
  await expectError(C.session.query(`insert into public.requests (tenant_id, product_id) values ($1,$2)`, [C.tenantId, prodA]), bad);
  await expectError(C.session.query(`insert into public.requests (tenant_id, free_name, supplier_id) values ($1,'x',$2)`, [C.tenantId, supA]), bad);
  // wiadomość firmy C -> zgłoszenie firmy A
  await expectError(C.session.query(`insert into public.request_messages (tenant_id, request_id, body) values ($1,$2,'hej')`, [C.tenantId, reqA]), /row-level|foreign key/);
  // pozycja dokumentu firmy C -> dokument firmy A (INSERT i UPDATE)
  await expectError(db.admin.query(`insert into public.document_lines (tenant_id, document_id, raw_name, qty) values ($1,$2,'x',1)`, [C.tenantId, docA]), bad);
  const docC = (await db.admin.query(`insert into public.documents (tenant_id, source) values ($1,'manual') returning id`, [C.tenantId])).rows[0].id;
  const lineC = (await db.admin.query(`insert into public.document_lines (tenant_id, document_id, raw_name, qty) values ($1,$2,'x',1) returning id`, [C.tenantId, docC])).rows[0].id;
  await expectError(db.admin.query(`update public.document_lines set document_id=$1 where id=$2`, [docA, lineC]), bad);
  // przerzucenie wiersza do innej firmy
  await expectError(db.admin.query(`update public.products set tenant_id=$1 where id=$2`, [C.tenantId, prodA]), /Nie można zmienić firmy/);
});

test('F6: usunięcie dostawcy/projektu zeruje tylko wskazanie, nie psuje firmy', async () => {
  const A = await ownerWithTenant(db, 'F6d');
  const sup = (await db.admin.query(`insert into public.suppliers (tenant_id, name) values ($1,'Hurt') returning id`, [A.tenantId])).rows[0].id;
  const prod = (await db.admin.query(`insert into public.products (tenant_id, name, default_supplier_id) values ($1,'Płyn',$2) returning id`, [A.tenantId, sup])).rows[0].id;
  await A.session.query(`delete from public.suppliers where id=$1`, [sup]);
  const row = (await db.admin.query(`select tenant_id, default_supplier_id from public.products where id=$1`, [prod])).rows[0];
  assert.equal(row.tenant_id, A.tenantId, 'tenant_id nie może być wyzerowany');
  assert.equal(row.default_supplier_id, null);
});

// ---------------------------------------------------------------------------
test('F7: kierownik nie zmieni NIP-u; właściciel tak, ale tylko poprawnego', async () => {
  const A = await ownerWithTenant(db, 'F7');
  const mgr = await addMember(db, A.tenantId, 'manager');
  await A.session.query(`select public.set_tenant_nip($1, '1234563218')`, [A.tenantId]);

  await expectError(mgr.session.query(`update public.tenants set nip='5260250995' where id=$1`, [A.tenantId]), /permission denied/);
  await expectError(mgr.session.query(`select public.set_tenant_nip($1, '5260250995')`, [A.tenantId]), /wyłącznie właściciel/);
  await expectError(A.session.query(`select public.set_tenant_nip($1, '1234567890')`, [A.tenantId]), /suma kontrolna/);
  await A.session.query(`select public.set_tenant_nip($1, '5260250995')`, [A.tenantId]);
  assert.equal((await db.admin.query(`select nip from public.tenants where id=$1`, [A.tenantId])).rows[0].nip, '5260250995');

  // zwykła edycja danych kontaktowych nadal działa dla kierownika
  await mgr.session.query(`update public.tenants set city='Kraków', name='Salon Nowy' where id=$1`, [A.tenantId]);
  // ... ale plan/trial (kolumny backendu) — nie
  await expectError(mgr.session.query(`update public.tenants set country='DE' where id=$1`, [A.tenantId]), /permission denied/);
  // zmiana NIP zostawia ślad w dzienniku
  const logged = await count(`select count(*)::int n from public.audit_log where tenant_id=$1 and table_name='tenants' and action='UPDATE'`, [A.tenantId]);
  assert.ok(logged >= 2);
});

test('is_valid_nip: znane poprawne i błędne numery', async () => {
  const check = async (nip) => (await db.admin.query(`select public.is_valid_nip($1) ok`, [nip])).rows[0].ok;
  for (const good of ['1234563218', '5260250995', '7740001454']) assert.equal(await check(good), true, good);
  for (const bad of ['1234567890', '123456321', '12345632188', 'abcdefghij', '', null, '0000000000']) assert.equal(await check(bad), false, String(bad));
});

test('F7: create_tenant odrzuca NIP z błędną sumą kontrolną i nazwę spoza zakresu', async () => {
  const u = await signUp(db, { name: 'Nowy' });
  const s = asUser(db, u);
  await expectError(s.query(`select public.create_tenant('Salon', '1234567890')`), /suma kontrolna/);
  await expectError(s.query(`select public.create_tenant(' a ')`), /od 2 do 120/);
  await expectError(s.query(`select public.create_tenant(null)`), /od 2 do 120/);
  const ok = await s.query(`select public.create_tenant('Salon Anna', '1234563218', 'beauty') id`);
  assert.ok(ok.rows[0].id);
  assert.equal(await count(`select count(*)::int n from public.referral_codes where tenant_id=$1`, [ok.rows[0].id]), 1);
});

test('F7: jedno konto może być właścicielem najwyżej 5 firm', async () => {
  const u = await signUp(db, { name: 'Hurtownik' });
  const s = asUser(db, u);
  for (let i = 1; i <= 5; i++) await s.query(`select public.create_tenant($1)`, [`Firma ${i}`]);
  await expectError(s.query(`select public.create_tenant('Szósta')`), /najwyżej 5 firm/);
});

// ---------------------------------------------------------------------------
test('F8: użytkownik nie może wpisywać do globalnego katalogu produktów', async () => {
  const u = await signUp(db, { name: 'Spamer' });
  const s = asUser(db, u);
  await expectError(s.query(`insert into public.catalog_items (name, ean, created_by) values ('ZŁA NAZWA','5901234123457',$1)`, [u.id]), /permission denied/);
  await expectError(s.query(`update public.catalog_items set name='x'`), /permission denied/);
  await expectError(s.query(`delete from public.catalog_items`), /permission denied/);
  assert.ok((await s.query(`select count(*)::int n from public.catalog_items`)).rows[0].n >= 5, 'czytać wolno');
});

// ---------------------------------------------------------------------------
test('F9: flaga can_manage_billing — nadaje tylko właściciel, działa niezależnie od roli', async () => {
  const A = await ownerWithTenant(db, 'F9');
  const acc = await addMember(db, A.tenantId, 'employee');   // np. księgowa jako „pracownik"
  const mgr = await addMember(db, A.tenantId, 'manager');
  const accMembership = (await db.admin.query(`select id from public.memberships where user_id=$1`, [acc.user.id])).rows[0].id;
  const billing = (u) => asUser(db, u).query(`select public.can_manage_billing($1) ok`, [A.tenantId]).then((r) => r.rows[0].ok);

  assert.equal(await billing(A.owner), true, 'właściciel zawsze');
  assert.equal(await billing(acc.user), false);
  assert.equal(await billing(mgr.user), false, 'kierownik bez flagi nie ma billingu');

  await expectError(mgr.session.query(`select public.set_billing_flag($1, true)`, [accMembership]), /wyłącznie właściciel/);
  // bezpośredni UPDATE przez kierownika: RLS (polityka tylko dla właściciela) cicho odfiltrowuje wiersz
  const direct = await mgr.session.query(`update public.memberships set can_manage_billing=true where id=$1`, [accMembership]);
  assert.equal(direct.rowCount, 0, 'kierownik nie zmienił żadnego wiersza');
  assert.equal(await billing(acc.user), false);
  await A.session.query(`select public.set_billing_flag($1, true)`, [accMembership]);
  assert.equal(await billing(acc.user), true);
  // flaga billingowa nie daje żadnych praw w magazynie:
  await expectError(acc.session.query(`insert into public.products (tenant_id, name) values ($1,'X')`, [A.tenantId]), /row-level/);
});

// ---------------------------------------------------------------------------
test('F10: niezalogowany (anon) nie widzi niczego i nie wywoła żadnego RPC', async () => {
  const A = await ownerWithTenant(db, 'F10');
  await insertProduct(db, A.tenantId, 'Sekretny produkt');
  const anon = asAnon(db);
  for (const t of ['tenants', 'products', 'memberships', 'profiles', 'catalog_items', 'team_members', 'team_invites', 'product_stock']) {
    await expectError(anon.query(`select * from public.${t}`), /permission denied/);
  }
  await expectError(anon.query(`select public.create_tenant('Anon Sp. z o.o.')`), /permission denied/);
  await expectError(anon.query(`select public.is_member(gen_random_uuid())`), /permission denied/);
});
