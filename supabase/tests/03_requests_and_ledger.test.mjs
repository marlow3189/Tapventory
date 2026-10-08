// ============================================================================
// Zgłoszenia braków (cykl statusów), księga ruchów i widoki dla aplikacji
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDb, signUp, asUser, ownerWithTenant, addMember, insertProduct, expectError,
} from './helpers.mjs';

let db;
test.before(async () => {
  db = await createTestDb();
});
test.after(async () => {
  await db.drop();
});

const one = async (sql, params) => (await db.admin.query(sql, params)).rows[0];

/** Firma z właścicielem, kierownikiem i dwoma pracownikami. */
async function team(label) {
  const A = await ownerWithTenant(db, label);
  const mgr = await addMember(db, A.tenantId, 'manager');
  const emp = await addMember(db, A.tenantId, 'employee');
  const emp2 = await addMember(db, A.tenantId, 'employee');
  return { ...A, mgr, emp, emp2 };
}
const report = async (who, tenantId, extra = '') =>
  (await who.session.query(
    `insert into public.requests (tenant_id, free_name${extra ? ', ' + extra.split('=')[0] : ''}) values ($1, 'Lakier czerwony'${extra ? ', ' + extra.split('=')[1] : ''}) returning id`,
    [tenantId]
  )).rows[0].id;
const statusOf = async (id) => (await one(`select status from public.requests where id=$1`, [id])).status;

// ---------------------------------------------------------------------------
test('zgłoszenie: nowe zawsze startuje jako „zgłoszone", autor = zalogowany, czasy puste', async () => {
  const T = await team('R1');
  const { rows } = await T.emp.session.query(
    `insert into public.requests (tenant_id, free_name, status, reporter_id, accepted_at, received_at)
     values ($1, 'Rękawiczki', 'received', $2, now(), now()) returning *`,
    [T.tenantId, T.emp2.user.id]   // próba podszycia się pod kolegę i „wstecznego" statusu
  );
  assert.equal(rows[0].status, 'reported');
  assert.equal(rows[0].reporter_id, T.emp.user.id);
  assert.equal(rows[0].accepted_at, null);
  assert.equal(rows[0].received_at, null);
  const ev = await db.admin.query(`select from_status, to_status, actor_id from public.request_events where request_id=$1`, [rows[0].id]);
  assert.deepEqual(ev.rows, [{ from_status: null, to_status: 'reported', actor_id: T.emp.user.id }]);
});

test('zgłoszenie: pracownik NIE zmieni statusu własnego zgłoszenia (przejęcie akceptacji)', async () => {
  const T = await team('R2');
  const id = await report(T.emp, T.tenantId);
  for (const s of ['accepted', 'ordered', 'delivered', 'received']) {
    await expectError(T.emp.session.query(`update public.requests set status=$2 where id=$1`, [id, s]), /Niedozwolona zmiana statusu/);
  }
  assert.equal(await statusOf(id), 'reported');
});

test('zgłoszenie: pełny cykl prowadzony przez kierownictwo, z historią i czasami z serwera', async () => {
  const T = await team('R3');
  const id = await report(T.emp, T.tenantId);
  await T.mgr.session.query(`update public.requests set status='accepted' where id=$1`, [id]);
  await T.mgr.session.query(`update public.requests set status='ordered' where id=$1`, [id]);
  await T.session.query(`update public.requests set status='delivered' where id=$1`, [id]);
  await T.emp.session.query(`update public.requests set status='received' where id=$1`, [id]);   // autor potwierdza odbiór

  const r = await one(`select * from public.requests where id=$1`, [id]);
  assert.equal(r.status, 'received');
  assert.ok(r.accepted_at && r.ordered_at && r.delivered_at && r.received_at);
  assert.ok(r.accepted_at <= r.ordered_at && r.ordered_at <= r.delivered_at && r.delivered_at <= r.received_at);

  const ev = (await db.admin.query(`select from_status f, to_status t, actor_id a from public.request_events where request_id=$1 order by id`, [id])).rows;
  assert.deepEqual(ev.map((e) => `${e.f ?? '-'}>${e.t}`), ['-' + '>reported', 'reported>accepted', 'accepted>ordered', 'ordered>delivered', 'delivered>received']);
  assert.equal(ev[1].a, T.mgr.user.id);
  assert.equal(ev[3].a, T.owner.id);
  assert.equal(ev[4].a, T.emp.user.id);
});

test('zgłoszenie: klient nie dyktuje znaczników czasu, a kolejność kroków jest wymuszona', async () => {
  const T = await team('R4');
  const id = await report(T.emp, T.tenantId);
  await expectError(T.mgr.session.query(`update public.requests set status='delivered' where id=$1`, [id]), /Niedozwolona zmiana/);     // pominięcie kroków
  await T.mgr.session.query(`update public.requests set accepted_at='2020-01-01', ordered_at='2020-01-02' where id=$1`, [id]);          // bez zmiany statusu
  const r = await one(`select accepted_at, ordered_at from public.requests where id=$1`, [id]);
  assert.equal(r.accepted_at, null);
  assert.equal(r.ordered_at, null);
});

test('zgłoszenie: autor wycofuje własne, ale nie cudze; zamknięte jest nieodwracalne', async () => {
  const T = await team('R5');
  const mine = await report(T.emp, T.tenantId);
  const theirs = await report(T.emp2, T.tenantId);
  await T.emp.session.query(`update public.requests set status='rejected' where id=$1`, [mine]);
  const other = await T.emp.session.query(`update public.requests set status='rejected' where id=$1`, [theirs]);
  assert.equal(other.rowCount, 0, 'RLS: cudzego zgłoszenia nie widać do edycji');
  assert.equal(await statusOf(theirs), 'reported');
  await expectError(T.mgr.session.query(`update public.requests set status='accepted' where id=$1`, [mine]), /zamknięte/);
  await expectError(T.session.query(`update public.requests set qty=5 where id=$1`, [mine]), /zamknięte/);
});

test('zgłoszenie: edycja treści — autor tylko do akceptacji, bez dostawcy; kierownictwo dłużej', async () => {
  const T = await team('R6');
  const sup = (await db.admin.query(`insert into public.suppliers (tenant_id, name) values ($1,'Hurtownia') returning id`, [T.tenantId])).rows[0].id;
  const id = await report(T.emp, T.tenantId);
  await T.emp.session.query(`update public.requests set qty=3, note='pilne' where id=$1`, [id]);
  await expectError(T.emp.session.query(`update public.requests set supplier_id=$2 where id=$1`, [id, sup]), /Dostawcę wskazuje kierownictwo/);
  await expectError(T.emp.session.query(`update public.requests set reporter_id=$2 where id=$1`, [id, T.emp2.user.id]), /Nie można zmienić autora/);
  await expectError(T.emp.session.query(`update public.requests set status='rejected', qty=99 where id=$1`, [id]), /nie może łączyć się z edycją/);
  await T.mgr.session.query(`update public.requests set status='accepted', supplier_id=$2 where id=$1`, [id, sup]);
  // po akceptacji autor już nie edytuje (RLS: wiersz poza polityką)
  const blocked = await T.emp.session.query(`update public.requests set qty=100 where id=$1`, [id]);
  assert.equal(blocked.rowCount, 0);
  await T.mgr.session.query(`update public.requests set qty=4 where id=$1`, [id]);
  assert.equal((await one(`select qty from public.requests where id=$1`, [id])).qty, '4.000');
});

test('zgłoszenie: nie da się go skasować (nie gumkujemy), czat zostaje', async () => {
  const T = await team('R7');
  const id = await report(T.emp, T.tenantId);
  await expectError(T.emp.session.query(`delete from public.requests where id=$1`, [id]), /permission denied/);
  await expectError(T.session.query(`delete from public.requests where id=$1`, [id]), /permission denied/);
});

test('czat: pisze członek pod własnym nazwiskiem; feed pokazuje autorów, także po usunięciu konta', async () => {
  const T = await team('R8');
  const id = await report(T.emp, T.tenantId);
  await T.mgr.session.query(`insert into public.request_messages (tenant_id, request_id, body) values ($1,$2,'Zamawiam jutro')`, [T.tenantId, id]);
  await expectError(
    T.emp2.session.query(`insert into public.request_messages (tenant_id, request_id, author_id, body) values ($1,$2,$3,'jako kierownik')`, [T.tenantId, id, T.mgr.user.id]),
    /row-level/
  );
  await T.emp.session.query(`insert into public.request_messages (tenant_id, request_id, body) values ($1,$2,'Dzięki!')`, [T.tenantId, id]);
  await expectError(T.emp.session.query(`update public.request_messages set body='x'`), /permission denied/);

  const feed = (await T.emp2.session.query(`select author_name, body from public.request_message_feed where request_id=$1 order by created_at, id`, [id])).rows;
  assert.deepEqual(feed.map((m) => m.body), ['Zamawiam jutro', 'Dzięki!']);

  const rf = (await T.emp2.session.query(`select reporter_name, message_count, status from public.request_feed where id=$1`, [id])).rows[0];
  assert.equal(rf.message_count, 2);
  assert.equal(rf.status, 'reported');

  await T.emp.session.query(`select public.delete_account()`);
  const after = (await T.mgr.session.query(`select reporter_name, reporter_deleted from public.request_feed where id=$1`, [id])).rows[0];
  assert.equal(after.reporter_name, 'Usunięty użytkownik');
  assert.equal(after.reporter_deleted, true);
});

test('feedy: nikt spoza firmy nie widzi niczego (widoki z prawami właściciela mają filtr)', async () => {
  const T = await team('R9');
  const stranger = await ownerWithTenant(db, 'Obca');
  const pid = await insertProduct(db, T.tenantId, 'Tajny produkt');
  const id = await report(T.emp, T.tenantId);
  await T.emp.session.query(`insert into public.request_messages (tenant_id, request_id, body) values ($1,$2,'tajne')`, [T.tenantId, id]);
  await T.emp.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',2)`, [T.tenantId, pid]);

  for (const v of ['request_feed', 'request_message_feed', 'request_event_feed', 'movement_feed', 'product_overview', 'team_members', 'team_invites']) {
    const r = await stranger.session.query(`select count(*)::int n from public.${v} where tenant_id=$1`, [T.tenantId]);
    assert.equal(r.rows[0].n, 0, `${v} nie może ujawniać danych obcej firmy`);
  }
  // i widok nie „przecieka" bez filtra tenant_id:
  const all = await stranger.session.query(`select count(*)::int n from public.request_feed`);
  assert.equal(all.rows[0].n, 0);
});

// ---------------------------------------------------------------------------
test('księga: znak ilości wymuszony typem ruchu; stan = suma ruchów; poniżej minimum', async () => {
  const T = await team('L1');
  const pid = await insertProduct(db, T.tenantId, 'Płyn 1 l', { minStock: 3 });
  const ins = (who, type, qty, extra = '') => who.session.query(
    `insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,$3,$4)`, [T.tenantId, pid, type, qty]);

  await expectError(ins(T.emp, 'receipt', -1), /qty_sign_matches_type/);
  await expectError(ins(T.emp, 'issue', 1), /qty_sign_matches_type/);
  await expectError(ins(T.emp, 'return', 2), /qty_sign_matches_type/);
  await expectError(ins(T.emp, 'adjustment', 0), /qty_sign_matches_type/);

  await ins(T.mgr, 'receipt', 10);
  await ins(T.emp, 'issue', -4);                 // „Zdejmij" — każdy członek
  await ins(T.emp2, 'issue', -2.5);
  await ins(T.mgr, 'adjustment', -0.5);

  const row = (await T.emp.session.query(`select stock, below_min from public.product_overview where id=$1`, [pid])).rows[0];
  assert.equal(row.stock, '3.000');
  assert.equal(row.below_min, false);
  await ins(T.emp, 'issue', -0.001);
  assert.equal((await T.emp.session.query(`select below_min from public.product_overview where id=$1`, [pid])).rows[0].below_min, true);
  // widok product_stock z fundamentu liczy to samo
  assert.equal((await T.emp.session.query(`select stock from public.product_stock where product_id=$1`, [pid])).rows[0].stock, '2.999');
});

test('księga: serwer ustawia autora i czas ruchu (brak podszywania i antydatowania)', async () => {
  const T = await team('L2');
  const pid = await insertProduct(db, T.tenantId, 'Gaziki');
  // próba podpisania się cudzym nazwiskiem jest neutralizowana: wpis dostaje PRAWDZIWEGO autora
  const spoof = await T.emp.session.query(
    `insert into public.stock_movements (tenant_id, product_id, movement_type, qty, created_by) values ($1,$2,'issue',-1,$3) returning created_by`,
    [T.tenantId, pid, T.mgr.user.id]
  );
  assert.equal(spoof.rows[0].created_by, T.emp.user.id);
  const { rows } = await T.emp.session.query(
    `insert into public.stock_movements (tenant_id, product_id, movement_type, qty, created_at) values ($1,$2,'receipt',1,'2001-01-01') returning created_at, created_by`,
    [T.tenantId, pid]
  );
  assert.equal(rows[0].created_by, T.emp.user.id);
  assert.ok(Date.now() - new Date(rows[0].created_at).getTime() < 60_000, 'czas = teraz, nie rok 2001');
  // backend (service_role) może zaimportować historię z własnym czasem
  await db.admin.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty, created_by, created_at) values ($1,$2,'receipt',1,$3,'2001-01-01')`, [T.tenantId, pid, T.emp.user.id]);
});

test('księga: produkt z historią nie znika; „Zdejmij" ma powód; feed ruchów zna autorów', async () => {
  const T = await team('L3');
  const pid = await insertProduct(db, T.tenantId, 'Olej 5W-30');
  await T.emp.session.query(
    `insert into public.stock_movements (tenant_id, product_id, movement_type, qty, reason, note) values ($1,$2,'issue',-1,'damage','rozlany')`, [T.tenantId, pid]);
  await expectError(T.emp.session.query(
    `insert into public.stock_movements (tenant_id, product_id, movement_type, qty, reason) values ($1,$2,'issue',-1,'kradzież')`, [T.tenantId, pid]), /check/);
  await expectError(T.mgr.session.query(`delete from public.products where id=$1`, [pid]), /foreign key|violates/);
  const f = (await T.mgr.session.query(`select product_name, author_name, reason, qty from public.movement_feed where product_id=$1`, [pid])).rows;
  assert.equal(f.length, 1);
  assert.equal(f[0].reason, 'damage');
  assert.match(f[0].author_name, /employee/);
});

test('ścieżki plików: zdjęcie musi leżeć w folderze własnej firmy', async () => {
  const T = await team('L4');
  const other = await ownerWithTenant(db, 'L4obca');
  await expectError(T.mgr.session.query(`insert into public.products (tenant_id, name, photo_path) values ($1,'X',$2)`, [T.tenantId, `${other.tenantId}/products/x.jpg`]), /products_photo_in_tenant_folder/);
  await T.mgr.session.query(`insert into public.products (tenant_id, name, photo_path) values ($1,'X',$2)`, [T.tenantId, `${T.tenantId}/products/x.jpg`]);
  await expectError(T.emp.session.query(`insert into public.requests (tenant_id, free_name, photo_path) values ($1,'x',$2)`, [T.tenantId, `${other.tenantId}/products/y.jpg`]), /requests_photo_in_tenant_folder/);
});

test('izolacja firm: użytkownik firmy B nie odczyta, nie zmieni i nie skasuje danych firmy A', async () => {
  const A = await team('I-A');
  const B = await team('I-B');
  const pidA = await insertProduct(db, A.tenantId, 'Produkt A');
  const reqA = await report(A.emp, A.tenantId);
  await db.admin.query(`insert into public.suppliers (tenant_id, name) values ($1,'Dostawca A')`, [A.tenantId]);
  await db.admin.query(`insert into public.projects (tenant_id, name) values ($1,'Projekt A')`, [A.tenantId]);

  for (const t of ['products', 'requests', 'suppliers', 'projects', 'request_events', 'memberships', 'tenants']) {
    const col = t === 'tenants' ? 'id' : 'tenant_id';
    const r = await B.owner && (await B.session.query(`select count(*)::int n from public.${t} where ${col}=$1`, [A.tenantId]));
    assert.equal(r.rows[0].n, 0, `${t}: B nie widzi wierszy A`);
  }
  await expectError(B.session.query(`insert into public.products (tenant_id, name) values ($1,'Włamanie')`, [A.tenantId]), /row-level/);
  await expectError(B.session.query(`insert into public.requests (tenant_id, free_name) values ($1,'Włamanie')`, [A.tenantId]), /row-level/);
  await expectError(B.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',100)`, [A.tenantId, pidA]), /row-level/);
  assert.equal((await B.session.query(`update public.products set name='Zhakowany' where id=$1`, [pidA])).rowCount, 0);
  assert.equal((await B.session.query(`update public.requests set status='accepted' where id=$1`, [reqA])).rowCount, 0);
  assert.equal((await B.session.query(`delete from public.products where id=$1`, [pidA])).rowCount, 0);
  assert.equal((await one(`select name from public.products where id=$1`, [pidA])).name, 'Produkt A');
});
