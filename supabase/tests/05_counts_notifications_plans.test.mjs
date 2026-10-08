// ============================================================================
// Plany i limity, użycie AI, mini-inwentaryzacje, powiadomienia, pulpit
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  createTestDb, signUp, asUser, asService, ownerWithTenant, addMember, insertProduct, expectError,
} from './helpers.mjs';

let db;
test.before(async () => {
  db = await createTestDb();
});
test.after(async () => {
  await db.drop();
});

const one = async (sql, params) => (await db.admin.query(sql, params)).rows[0];
const num = (v) => Number(v);

async function setup(label) {
  const A = await ownerWithTenant(db, label);
  const mgr = await addMember(db, A.tenantId, 'manager');
  const emp = await addMember(db, A.tenantId, 'employee');
  return { ...A, mgr, emp };
}
const endTrial = (tenantId, plan = 'solo') =>
  db.admin.query(`update public.tenants set trial_ends_at = now() - interval '1 day', plan = $2 where id = $1`, [tenantId, plan]);

// ---------------------------------------------------------------------------
// A. PLANY I LIMITY
test('plany: nowa firma ma 14 dni planu Zespół; użytkownik nie zmieni planu ani triala', async () => {
  const T = await setup('P1');
  const t = await one(`select plan, public.effective_plan(id) eff, trial_ends_at - now() as left from public.tenants where id=$1`, [T.tenantId]);
  assert.equal(t.plan, 'solo');
  assert.equal(t.eff, 'team');
  assert.ok(t.left.days >= 13);
  await expectError(T.session.query(`update public.tenants set plan='team' where id=$1`, [T.tenantId]), /permission denied/);
  await expectError(T.session.query(`update public.tenants set trial_ends_at = now() + interval '10 years' where id=$1`, [T.tenantId]), /permission denied/);
  await expectError(T.session.query(`select public.set_tenant_plan($1, 'team')`, [T.tenantId]), /permission denied/);
  await asService(db).query(`select public.set_tenant_plan($1, 'start')`, [T.tenantId]);
  assert.equal((await one(`select plan from public.tenants where id=$1`, [T.tenantId])).plan, 'start');
});

test('plany: po okresie próbnym plan Solo ma limit 1 osoby i 150 produktów', async () => {
  const T = await ownerWithTenant(db, 'P2');
  await endTrial(T.tenantId, 'solo');
  await expectError(addMember(db, T.tenantId, 'employee'), /limit osób w Twoim planie \(1\)/);

  await db.admin.query(`insert into public.products (tenant_id, name) select $1, 'P' || g from generate_series(1, 150) g`, [T.tenantId]);
  await expectError(insertProduct(db, T.tenantId, 'sto pięćdziesiąty pierwszy'), /limit produktów w Twoim planie \(150\)/);
  // archiwizacja zwalnia miejsce, edycja istniejących nie jest blokowana
  await T.session.query(`update public.products set active=false where name='P1' and tenant_id=$1`, [T.tenantId]);
  await T.session.query(`update public.products set name='P2 zmieniony' where name='P2' and tenant_id=$1`, [T.tenantId]);
  await insertProduct(db, T.tenantId, 'nowy po archiwizacji');
  await expectError(T.session.query(`update public.products set active=true where name='P1' and tenant_id=$1`, [T.tenantId]), /limit produktów/);
});

test('plany: Start = 3 osoby / 1000 produktów, Zespół = 10 osób / bez limitu produktów', async () => {
  const lim = async (plan) => (await one(`select * from public.plan_limits($1)`, [plan]));
  assert.deepEqual({ ...(await lim('solo')) }, { max_users: 1, max_products: 150, ai_scans_month: 5 });
  assert.deepEqual({ ...(await lim('start')) }, { max_users: 3, max_products: 1000, ai_scans_month: 30 });
  assert.deepEqual({ ...(await lim('team')) }, { max_users: 10, max_products: null, ai_scans_month: 150 });

  const T = await ownerWithTenant(db, 'P3');
  await endTrial(T.tenantId, 'start');
  await addMember(db, T.tenantId, 'employee');
  await addMember(db, T.tenantId, 'employee');
  await expectError(addMember(db, T.tenantId, 'employee'), /limit osób w Twoim planie \(3\)/);
});

test('zaproszenie przyjęte ponad limit osób kończy się czytelnym błędem', async () => {
  const T = await ownerWithTenant(db, 'P4');
  await endTrial(T.tenantId, 'solo');
  const guest = await signUp(db, { name: 'Gość' });
  const inv = await T.session.query(`select (public.create_invite($1, $2, 'employee')).token as token`, [T.tenantId, guest.email]);
  await expectError(asUser(db, guest).query(`select public.accept_invite($1)`, [inv.rows[0].token]), /limit osób/);
});

// ---------------------------------------------------------------------------
// A. LICZNIK AI
test('AI: rezerwacja zużywa limit, błąd go zwalnia, nowy miesiąc zeruje licznik', async () => {
  const T = await setup('Q1');
  await endTrial(T.tenantId, 'solo');               // limit 5 skanów / miesiąc
  const svc = asService(db);
  const reserve = () => svc.query(`select public.reserve_ai_scan($1, $2, null) id`, [T.tenantId, T.mgr.user.id]);

  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await reserve()).rows[0].id);
  await expectError(reserve(), /AI_QUOTA_EXCEEDED/);

  const q = (await T.mgr.session.query(`select public.ai_quota($1) q`, [T.tenantId])).rows[0].q;
  assert.deepEqual({ plan: q.plan, limit: q.limit, used: q.used, remaining: q.remaining }, { plan: 'solo', limit: 5, used: 5, remaining: 0 });

  await svc.query(`select public.finish_ai_scan($1, 'm', 100, 50, 300, 'error')`, [ids[0]]);   // awaria modelu → bez kosztu dla klienta
  await svc.query(`select public.finish_ai_scan($1, 'm', 1000, 500, 900, 'ok')`, [ids[1]]);
  assert.equal((await T.mgr.session.query(`select public.ai_quota($1) q`, [T.tenantId])).rows[0].q.remaining, 1);
  await reserve();
  await expectError(reserve(), /AI_QUOTA_EXCEEDED/);

  // poprzedni miesiąc nie liczy się do bieżącego
  await db.admin.query(`update public.ai_usage set created_at = created_at - interval '40 days' where tenant_id=$1`, [T.tenantId]);
  assert.equal((await T.mgr.session.query(`select public.ai_quota($1) q`, [T.tenantId])).rows[0].q.used, 0);
  await reserve();

  // uprawnienia: tylko backend rezerwuje; pracownik nie widzi zużycia, kierownik tak
  await expectError(T.mgr.session.query(`select public.reserve_ai_scan($1, $2, null)`, [T.tenantId, T.mgr.user.id]), /permission denied/);
  await expectError(T.mgr.session.query(`insert into public.ai_usage (tenant_id, kind) values ($1,'document')`, [T.tenantId]), /permission denied/);
  assert.ok((await T.mgr.session.query(`select count(*)::int n from public.ai_usage`)).rows[0].n > 0);
  assert.equal((await T.emp.session.query(`select count(*)::int n from public.ai_usage`)).rows[0].n, 0);
  const stranger = await ownerWithTenant(db, 'Q1obca');
  await expectError(stranger.session.query(`select public.ai_quota($1)`, [T.tenantId]), /Brak uprawnień/);
});

test('AI: dwa równoległe skany przy jednym wolnym miejscu — dokładnie jeden przechodzi', async () => {
  const T = await ownerWithTenant(db, 'Q2');
  await endTrial(T.tenantId, 'solo');
  for (let i = 0; i < 4; i++) await asService(db).query(`select public.reserve_ai_scan($1, null, null)`, [T.tenantId]);

  const clients = await Promise.all([1, 2, 3].map(async () => {
    const c = new pg.Client({ connectionString: db.url });
    await c.connect();
    return c;
  }));
  const attempt = async (c) => {
    await c.query('begin');
    try {
      await c.query(`set local role service_role`);
      await c.query(`select public.reserve_ai_scan($1, null, null)`, [T.tenantId]);
      await new Promise((r) => setTimeout(r, 150));   // „model myśli", transakcja trwa
      await c.query('commit');
      return 'ok';
    } catch (e) {
      await c.query('rollback');
      return /AI_QUOTA_EXCEEDED/.test(e.message) ? 'quota' : `blad: ${e.message}`;
    }
  };
  const results = await Promise.all(clients.map(attempt));
  await Promise.all(clients.map((c) => c.end()));
  assert.deepEqual(results.sort(), ['ok', 'quota', 'quota']);
});

// ---------------------------------------------------------------------------
// B. MINI-INWENTARYZACJE
test('spis: „ile zostało?" księguje różnicę jako korektę; stan = policzone; idempotentne', async () => {
  const T = await setup('C1');
  const p = await insertProduct(db, T.tenantId, 'Płyn do szyb', { unit: 'l' });
  await T.mgr.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',10)`, [T.tenantId, p]);

  const id = '0192f0d3-7a10-7000-8000-00000000c001';
  const r1 = (await T.emp.session.query(`select public.record_stock_check($1, 7.5, 'on_take', $2) r`, [p, id])).rows[0].r;   // pracownik też liczy
  assert.deepEqual({ expected: num(r1.expected), counted: num(r1.counted), diff: num(r1.diff), repeated: r1.repeated }, { expected: 10, counted: 7.5, diff: -2.5, repeated: false });
  assert.equal(num((await one(`select stock from public.product_overview where id=$1`, [p])).stock), 7.5);
  const mv = await one(`select movement_type, qty, note, created_by from public.stock_movements where id=$1`, [r1.movement_id]);
  assert.equal(mv.movement_type, 'adjustment');
  assert.equal(num(mv.qty), -2.5);
  assert.match(mv.note, /policzono 7.5, w systemie 10/);
  assert.equal(mv.created_by, T.emp.user.id);
  assert.ok((await one(`select last_counted_at from public.products where id=$1`, [p])).last_counted_at);

  const again = (await T.emp.session.query(`select public.record_stock_check($1, 7.5, 'on_take', $2) r`, [p, id])).rows[0].r;
  assert.equal(again.repeated, true);
  assert.equal(num((await one(`select count(*) n from public.stock_movements where product_id=$1`, [p])).n), 2, 'powtórka nie dubluje korekty');

  // zgodny stan: brak ruchu, ale spis zapisany
  const r2 = (await T.mgr.session.query(`select public.record_stock_check($1, 7.5) r`, [p])).rows[0].r;
  assert.equal(r2.movement_id, null);
  assert.equal(num((await one(`select count(*) n from public.stock_checks where product_id=$1`, [p])).n), 2);

  await expectError(T.mgr.session.query(`select public.record_stock_check($1, -1)`, [p]), /poprawną ilość/);
  await expectError(T.mgr.session.query(`select public.record_stock_check($1, 1, 'zly')`, [p]), /Nieznane źródło/);
  const stranger = await ownerWithTenant(db, 'C1obca');
  await expectError(stranger.session.query(`select public.record_stock_check($1, 1)`, [p]), /Nie znaleziono produktu/);
  await expectError(T.mgr.session.query(`update public.stock_checks set counted_qty=1`), /permission denied/);
});

test('spis: kolejka do policzenia — najdłużej niepoliczone najpierw, partia z ustawień', async () => {
  const T = await setup('C2');
  const names = ['Aaa', 'Bbb', 'Ccc', 'Ddd'];
  const ids = [];
  for (const n of names) ids.push(await insertProduct(db, T.tenantId, n));
  await T.mgr.session.query(`select public.record_stock_check($1, 1)`, [ids[0]]);       // Aaa dopiero co policzony
  await db.admin.query(`update public.products set last_counted_at = now() - interval '40 days' where id=$1`, [ids[2]]);

  const q = (await T.emp.session.query(`select name from public.next_count_candidates($1, 3)`, [T.tenantId])).rows.map((r) => r.name);
  assert.deepEqual(q, ['Bbb', 'Ddd', 'Ccc']);                                              // nigdy nie liczone → najstarszy → ...
  await T.mgr.session.query(`update public.tenant_settings set count_batch_size = 2 where tenant_id=$1`, [T.tenantId]);
  assert.equal((await T.emp.session.query(`select * from public.next_count_candidates($1)`, [T.tenantId])).rows.length, 2);
  await expectError(T.emp.session.query(`update public.tenant_settings set count_batch_size = 9 where tenant_id=$1`, [T.tenantId]).then((r) => { if (r.rowCount === 0) throw new Error('0 wierszy'); }), /0 wierszy/);
});

test('pytanie przy okazji: tylko zaległe produkty, dzienny limit na osobę, wyłączalne', async () => {
  const T = await setup('C3');
  const a = await insertProduct(db, T.tenantId, 'Stary');
  const b = await insertProduct(db, T.tenantId, 'Drugi');
  const c = await insertProduct(db, T.tenantId, 'Trzeci');
  const ask = (who, p) => who.session.query(`select public.should_ask_count($1) ok`, [p]).then((r) => r.rows[0].ok);

  assert.equal(await ask(T.emp, a), true, 'nigdy nie liczony');
  await T.emp.session.query(`select public.record_stock_check($1, 0, 'on_take')`, [a]);
  assert.equal(await ask(T.emp, a), false, 'świeżo policzony');
  assert.equal(await ask(T.emp, b), true);
  await T.emp.session.query(`select public.record_stock_check($1, 0, 'on_take')`, [b]);
  assert.equal(await ask(T.emp, c), false, 'limit 2 pytań dziennie osiągnięty');
  assert.equal(await ask(T.mgr, c), true, 'limit jest per osoba');

  await T.mgr.session.query(`update public.tenant_settings set count_question_cap = 0 where tenant_id=$1`, [T.tenantId]);
  assert.equal(await ask(T.mgr, c), false, 'wyłączone w ustawieniach');
  const stranger = await ownerWithTenant(db, 'C3obca');
  assert.equal(await ask(stranger, c), false);
});

test('spis: przypomnienia dla kierownictwa raz, tylko gdy spis zaległy', async () => {
  const T = await setup('C4');
  await insertProduct(db, T.tenantId, 'Cokolwiek');
  const svc = asService(db);
  const first = (await svc.query(`select public.queue_count_reminders() n`)).rows[0].n;
  assert.ok(first >= 2, 'właściciel i kierownik');
  const mine = await db.admin.query(`select user_id from public.notifications where tenant_id=$1 and kind='count_due'`, [T.tenantId]);
  assert.deepEqual(mine.rows.map((r) => r.user_id).sort(), [T.owner.id, T.mgr.user.id].sort(), 'pracownik nie dostaje przypomnienia');
  assert.equal((await svc.query(`select public.queue_count_reminders() n`)).rows[0].n, 0, 'nie dubluje nieprzeczytanego');
  await expectError(T.mgr.session.query(`select public.queue_count_reminders()`), /permission denied/);
});

// ---------------------------------------------------------------------------
// C. POWIADOMIENIA
test('powiadomienia: spadek poniżej minimum alarmuje kierownictwo jednokrotnie', async () => {
  const T = await setup('N1');
  const p = await insertProduct(db, T.tenantId, 'Rękawiczki', { minStock: 5 });
  const take = (q) => T.emp.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'issue',$3)`, [T.tenantId, p, q]);
  await T.mgr.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',6)`, [T.tenantId, p]);

  await take(-1);                                  // 5 = nie poniżej minimum
  assert.equal(num((await one(`select count(*) n from public.notifications where kind='low_stock'`)).n), 0);
  await take(-1);                                  // 4 < 5 → alarm
  await take(-1);                                  // 3, nadal poniżej → bez kolejnego
  const n = (await db.admin.query(`select user_id, title, body, push from public.notifications where kind='low_stock' and tenant_id=$1`, [T.tenantId])).rows;
  assert.equal(n.length, 2);
  assert.deepEqual(n.map((x) => x.user_id).sort(), [T.owner.id, T.mgr.user.id].sort());
  assert.match(n[0].title, /Kończy się: Rękawiczki/);
  assert.match(n[0].body, /Stan 4/);

  // po uzupełnieniu i ponownym spadku — nowy alarm; z wyłączonym pushem tylko wpis w aplikacji
  await T.mgr.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',10)`, [T.tenantId, p]);
  await T.mgr.session.query(`update public.tenant_settings set low_stock_push = false where tenant_id=$1`, [T.tenantId]);
  await take(-9);
  const latest = (await db.admin.query(`select push from public.notifications where kind='low_stock' and tenant_id=$1 order by created_at desc, id limit 1`, [T.tenantId])).rows[0];
  assert.equal(latest.push, false);
  assert.equal(num((await one(`select count(*) n from public.notifications where kind='low_stock' and tenant_id=$1`, [T.tenantId])).n), 4);
});

test('powiadomienia: nowe zgłoszenie → kierownictwo; zmiana statusu → autor; dokument gotowy → twórca', async () => {
  const T = await setup('N2');
  const rid = (await T.emp.session.query(`insert into public.requests (tenant_id, free_name, qty) values ($1,'Lakier czerwony', 3) returning id`, [T.tenantId])).rows[0].id;
  let rows = (await db.admin.query(`select user_id, title, body from public.notifications where kind='request_new' and tenant_id=$1`, [T.tenantId])).rows;
  assert.deepEqual(rows.map((r) => r.user_id).sort(), [T.owner.id, T.mgr.user.id].sort(), 'autor nie powiadamia sam siebie');
  assert.match(rows[0].body, /Lakier czerwony \(3\.000\)/);

  await T.mgr.session.query(`update public.requests set status='accepted' where id=$1`, [rid]);
  rows = (await db.admin.query(`select user_id, title from public.notifications where kind='request_status' and tenant_id=$1`, [T.tenantId])).rows;
  assert.deepEqual(rows, [{ user_id: T.emp.user.id, title: 'Zgłoszenie: zaakceptowane' }]);

  // autor sam wycofuje → bez powiadomienia dla siebie
  const r2 = (await T.emp.session.query(`insert into public.requests (tenant_id, free_name) values ($1,'X') returning id`, [T.tenantId])).rows[0].id;
  await T.emp.session.query(`update public.requests set status='rejected' where id=$1`, [r2]);
  assert.equal(num((await one(`select count(*) n from public.notifications where kind='request_status' and tenant_id=$1`, [T.tenantId])).n), 1);

  const doc = (await db.admin.query(`insert into public.documents (tenant_id, source, status, created_by, supplier_name) values ($1,'photo','processing',$2,'Hurtownia') returning id`, [T.tenantId, T.mgr.user.id])).rows[0].id;
  await asService(db).query(`update public.documents set status='draft' where id=$1`, [doc]);
  const dn = await one(`select user_id, title from public.notifications where kind='document_ready' and tenant_id=$1`, [T.tenantId]);
  assert.deepEqual({ ...dn }, { user_id: T.mgr.user.id, title: 'Faktura gotowa do sprawdzenia' });
});

test('powiadomienia: każdy widzi tylko swoje i może je oznaczyć jako przeczytane (tylko read_at)', async () => {
  const T = await setup('N3');
  await T.emp.session.query(`insert into public.requests (tenant_id, free_name) values ($1,'Coś')`, [T.tenantId]);
  const mine = (await T.mgr.session.query(`select id, kind from public.notifications`)).rows;
  assert.equal(mine.length, 1);
  assert.equal((await T.emp.session.query(`select count(*)::int n from public.notifications`)).rows[0].n, 0);

  await T.mgr.session.query(`update public.notifications set read_at = now() where id=$1`, [mine[0].id]);
  await expectError(T.mgr.session.query(`update public.notifications set title='podmiana' where id=$1`, [mine[0].id]), /permission denied/);
  await expectError(T.mgr.session.query(`insert into public.notifications (tenant_id, user_id, kind, title) values ($1,$2,'system','x')`, [T.tenantId, T.mgr.user.id]), /permission denied/);
  const other = await T.emp.session.query(`update public.notifications set read_at = now() where id=$1`, [mine[0].id]);
  assert.equal(other.rowCount, 0, 'cudzego nie oznaczysz');
});

test('push: token przechodzi na nowe konto po przelogowaniu; usunięcie konta kasuje tokeny i powiadomienia', async () => {
  const T = await setup('N4');
  const token = 'ExponentPushToken[abcdefghijklmnop]';
  await T.emp.session.query(`select public.register_push_token($1, 'android', 'Pixel 8')`, [token]);
  await T.mgr.session.query(`select public.register_push_token($1, 'android', 'Pixel 8')`, [token]);    // ten sam telefon, inne konto
  assert.deepEqual((await db.admin.query(`select user_id from public.push_tokens where token=$1`, [token])).rows.map((r) => r.user_id), [T.mgr.user.id]);
  await expectError(T.mgr.session.query(`select public.register_push_token('krótki', 'ios')`), /Nieprawidłowy token/);
  await expectError(T.mgr.session.query(`select public.register_push_token($1, 'windows')`, [token]), /check/);
  await expectError(T.mgr.session.query(`insert into public.push_tokens (user_id, token, platform) values ($1,'xxxxxxxxxxxx','ios')`, [T.mgr.user.id]), /permission denied/);

  await T.emp.session.query(`insert into public.requests (tenant_id, free_name) values ($1,'Coś')`, [T.tenantId]);
  await T.mgr.session.query(`select public.delete_account()`);
  assert.equal(num((await one(`select count(*) n from public.push_tokens where user_id=$1`, [T.mgr.user.id])).n), 0);
  assert.equal(num((await one(`select count(*) n from public.notifications where user_id=$1`, [T.mgr.user.id])).n), 0);
});

// ---------------------------------------------------------------------------
// D. PULPIT
test('pulpit: liczby dla kierownika i pracownika, produkty poniżej minimum, okres próbny', async () => {
  const T = await setup('S1');
  const a = await insertProduct(db, T.tenantId, 'Mało', { minStock: 10 });
  const b = await insertProduct(db, T.tenantId, 'Dużo', { minStock: 2 });
  await insertProduct(db, T.tenantId, 'Bez minimum');
  await T.mgr.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',3), ($1,$3,'receipt',50)`, [T.tenantId, a, b]);
  await T.emp.session.query(`insert into public.requests (tenant_id, free_name) values ($1,'Lakier'), ($1,'Rękawiczki')`, [T.tenantId]);
  await db.admin.query(`insert into public.documents (tenant_id, source, status) values ($1,'photo','draft'), ($1,'photo','processing'), ($1,'photo','failed')`, [T.tenantId]);

  const dm = (await T.mgr.session.query(`select public.dashboard_summary($1) d`, [T.tenantId])).rows[0].d;
  assert.equal(dm.role, 'manager');
  assert.equal(dm.plan, 'team');
  assert.ok(dm.trial_days_left >= 13);
  assert.equal(dm.products_total, 3);
  assert.equal(dm.below_min, 1);
  assert.equal(dm.below_min_top[0].name, 'Mało');
  assert.equal(dm.requests_open, 2);
  assert.equal(dm.requests_to_accept, 2);
  assert.equal(dm.documents_to_verify, 1);
  assert.equal(dm.documents_processing, 1);
  assert.equal(dm.documents_failed, 1);
  assert.equal(dm.count_stale, 3);
  // 2 nowe zgłoszenia; przyjęcie, które zostawia stan poniżej minimum, nie jest
  // „spadkiem poniżej progu" (takie produkty widać w below_min)
  assert.equal(dm.unread_notifications, 2);

  const de = (await T.emp.session.query(`select public.dashboard_summary($1) d`, [T.tenantId])).rows[0].d;
  assert.equal(de.role, 'employee');
  assert.equal(de.requests_mine_open, 2);
  assert.equal(de.requests_to_accept, 0, 'pracownik nie akceptuje');
  assert.equal(de.documents_to_verify, 0, 'pracownik nie widzi faktur nawet w liczbach');
  assert.equal(de.documents_failed, 0);
  assert.equal(de.unread_notifications, 0);

  await endTrial(T.tenantId, 'solo');
  const after = (await T.mgr.session.query(`select public.dashboard_summary($1) d`, [T.tenantId])).rows[0].d;
  assert.equal(after.plan, 'solo');
  assert.equal(after.trial_days_left, null);

  const stranger = await ownerWithTenant(db, 'S1obca');
  await expectError(stranger.session.query(`select public.dashboard_summary($1)`, [T.tenantId]), /Brak uprawnień/);
});
