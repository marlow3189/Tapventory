// „+1 też potrzebuję" oraz zasada: pracownik tylko zdejmuje z magazynu.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, ownerWithTenant, addMember, insertProduct, expectError } from './helpers.mjs';

let db;
test.before(async () => { db = await createTestDb(); });
test.after(async () => { await db.drop(); });

async function setup(label) {
  const A = await ownerWithTenant(db, label);
  return { ...A, mgr: await addMember(db, A.tenantId, 'manager'), emp: await addMember(db, A.tenantId, 'employee'), emp2: await addMember(db, A.tenantId, 'employee') };
}

test('głosy: inni członkowie dają +1, autor nie; licznik i „zagłosowałem" w widoku', async () => {
  const T = await setup('V1');
  const rid = (await T.emp.session.query(`insert into public.requests (tenant_id, free_name) values ($1,'Lakier') returning id`, [T.tenantId])).rows[0].id;

  await expectError(T.emp.session.query(`insert into public.request_votes (request_id, tenant_id, user_id) values ($1,$2,$3)`, [rid, T.tenantId, T.emp.user.id]), /Własnego zgłoszenia/);
  await T.emp2.session.query(`insert into public.request_votes (request_id, tenant_id, user_id) values ($1,$2,$3)`, [rid, T.tenantId, T.emp2.user.id]);
  await T.mgr.session.query(`insert into public.request_votes (request_id, tenant_id, user_id) values ($1,$2,$3)`, [rid, T.tenantId, T.mgr.user.id]);
  await expectError(T.mgr.session.query(`insert into public.request_votes (request_id, tenant_id, user_id) values ($1,$2,$3)`, [rid, T.tenantId, T.mgr.user.id]), /duplicate key|request_votes_pkey/);
  // podszywanie się pod cudzy głos
  await expectError(T.emp2.session.query(`insert into public.request_votes (request_id, tenant_id, user_id) values ($1,$2,$3)`, [rid, T.tenantId, T.owner.id]), /row-level/);

  const asMgr = (await T.mgr.session.query(`select vote_count, voted_by_me from public.request_feed where id=$1`, [rid])).rows[0];
  assert.deepEqual({ ...asMgr }, { vote_count: 2, voted_by_me: true });
  const asOwner = (await T.session.query(`select vote_count, voted_by_me from public.request_feed where id=$1`, [rid])).rows[0];
  assert.deepEqual({ ...asOwner }, { vote_count: 2, voted_by_me: false });

  // cofnięcie własnego głosu; cudzego nie cofniesz
  assert.equal((await T.mgr.session.query(`delete from public.request_votes where request_id=$1 and user_id=$2`, [rid, T.emp2.user.id])).rowCount, 0);
  assert.equal((await T.mgr.session.query(`delete from public.request_votes where request_id=$1 and user_id=$2`, [rid, T.mgr.user.id])).rowCount, 1);
  assert.equal((await T.mgr.session.query(`select vote_count from public.request_feed where id=$1`, [rid])).rows[0].vote_count, 1);
});

test('głosy: obca firma nie głosuje ani nie widzi', async () => {
  const A = await setup('V2');
  const B = await setup('V2b');
  const rid = (await A.emp.session.query(`insert into public.requests (tenant_id, free_name) values ($1,'x') returning id`, [A.tenantId])).rows[0].id;
  await expectError(B.mgr.session.query(`insert into public.request_votes (request_id, tenant_id, user_id) values ($1,$2,$3)`, [rid, A.tenantId, B.mgr.user.id]), /row-level/);
  await expectError(B.mgr.session.query(`insert into public.request_votes (request_id, tenant_id, user_id) values ($1,$2,$3)`, [rid, B.tenantId, B.mgr.user.id]), /foreign key/);
  assert.equal((await B.mgr.session.query(`select count(*)::int n from public.request_votes`)).rows[0].n, 0);
});

test('księga: pracownik zapisuje tylko rozchód; kierownictwo każdy typ', async () => {
  const T = await setup('K1');
  const p = await insertProduct(db, T.tenantId, 'Mydło');
  const ins = (who, type, qty) => who.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,$3,$4)`, [T.tenantId, p, type, qty]);

  await expectError(ins(T.emp, 'receipt', 100), /Pracownik może tylko zdejmować/);
  await expectError(ins(T.emp, 'adjustment', 5), /Pracownik może tylko zdejmować/);
  await expectError(ins(T.emp, 'return', -1), /Pracownik może tylko zdejmować/);
  await ins(T.mgr, 'receipt', 10);
  await ins(T.emp, 'issue', -2);
  await ins({ session: T.session }, 'adjustment', -1);       // właściciel
  assert.equal(Number((await db.admin.query(`select stock from public.product_overview where id=$1`, [p])).rows[0].stock), 7);
});

test('spis jest drogą pracownika do korekty — zmienna sesji nie „przecieka" na kolejne ruchy', async () => {
  const T = await setup('K2');
  const p = await insertProduct(db, T.tenantId, 'Gaziki');
  await T.mgr.session.query(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',10)`, [T.tenantId, p]);
  // w jednej transakcji: spis, a zaraz potem próba obejścia reguły
  await expectError(T.emp.session.tx(async (q) => {
    await q(`select public.record_stock_check($1, 4)`, [p]);
    await q(`insert into public.stock_movements (tenant_id, product_id, movement_type, qty) values ($1,$2,'receipt',50)`, [T.tenantId, p]);
  }), /Pracownik może tylko zdejmować/);
  const r = (await T.emp.session.query(`select public.record_stock_check($1, 4) r`, [p])).rows[0].r;
  assert.equal(Number(r.diff), -6);
});
