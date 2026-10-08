// ============================================================================
// Niezmienniki schematu: reguły, które muszą być prawdziwe ZAWSZE.
// ============================================================================
// Dla juniora: te testy nie sprawdzają jednej funkcji, tylko "stan świata".
// Gdy dodasz nową tabelę lub funkcję i któryś test zaświeci się na czerwono,
// to znaczy, że o czymś zapomniałeś (RLS, uprawnienia). Napraw przyczynę,
// nie test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers.mjs';

let db;
test.before(async () => {
  db = await createTestDb();
});
test.after(async () => {
  await db.drop();
});

const q = (sql, params) => db.admin.query(sql, params).then((r) => r.rows);

test('każda tabela w schemacie public ma włączone RLS', async () => {
  const rows = await q(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    order by 1`);
  assert.deepEqual(rows.map((r) => r.relname), [], 'tabele bez RLS = dziura na całą bazę');
});

test('rola anon (niezalogowany) nie ma żadnych uprawnień w schemacie public', async () => {
  const tables = await q(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))
    order by 1`);
  assert.deepEqual(tables.map((r) => r.relname), []);

  const fns = await q(`
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
    order by 1`);
  assert.deepEqual(fns.map((r) => r.proname), []);
});

test('powierzchnia RPC: dokładnie te funkcje są wykonywalne przez zalogowanych', async () => {
  // Nowa funkcja w public bez świadomej decyzji = dziura. Ten test wymusza decyzję:
  // dopisz ją tutaj (a w migracji pamiętaj o REVOKE ... FROM public, anon).
  const expected = [
    // pomocnicze (używane przez polityki RLS)
    'can_invite_role', 'can_manage', 'can_manage_billing', 'can_manage_managers',
    'is_member', 'is_owner', 'is_valid_nip', 'my_role', 'owners_count', 'path_tenant',
    'shares_tenant_with',
    'normalize_name', 'paths_in_tenant',
    // RPC wołane przez aplikację
    'accept_invite', 'accept_invite_code', 'create_invite', 'create_photo_document', 'create_tenant',
    'delete_account', 'delete_tenant', 'get_invite_preview', 'match_products', 'post_document',
    'retry_document', 'revoke_invite', 'set_billing_flag', 'set_manager_flag', 'set_tenant_nip',
    'unpost_document',
  ].sort();
  const rows = await q(`
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    order by 1`);
  const actual = rows.map((r) => r.proname);
  const unexpected = actual.filter((f) => !expected.includes(f));
  const missing = expected.filter((f) => !actual.includes(f));
  assert.deepEqual({ unexpected, missing }, { unexpected: [], missing: [] });
});

test('macierz uprawnień do tabel dla zalogowanych jest dokładnie taka, jak zaplanowano', async () => {
  // Uprawnienia tabelowe = „co w ogóle wolno spróbować"; RLS zawęża je do właściwych
  // wierszy. Zmiana tej macierzy musi być świadoma (patrz docs/03_ARCHITEKTURA_I_BEZPIECZENSTWO.md).
  const expected = {
    audit_log: 'SELECT',
    catalog_items: 'SELECT',
    document_lines: 'DELETE,INSERT,SELECT,UPDATE',
    document_overview: 'SELECT',
    documents: 'DELETE,INSERT,SELECT,UPDATE',
    memberships: 'DELETE,SELECT',            // + UPDATE tylko na 3 kolumnach (niżej)
    movement_feed: 'SELECT',
    product_overview: 'SELECT',
    product_stock: 'SELECT',
    product_aliases: 'DELETE,INSERT,SELECT,UPDATE',
    products: 'DELETE,INSERT,SELECT,UPDATE',
    profiles: 'SELECT',                       // + UPDATE tylko display_name, phone
    projects: 'DELETE,INSERT,SELECT,UPDATE',
    referral_codes: 'SELECT',
    referrals: 'SELECT',
    request_messages: 'INSERT,SELECT',
    request_event_feed: 'SELECT',
    request_events: 'SELECT',
    request_feed: 'SELECT',
    request_message_feed: 'SELECT',
    requests: 'INSERT,SELECT,UPDATE',          // bez DELETE: zgłoszeń się nie kasuje
    reward_ledger: 'SELECT',
    stock_movements: 'INSERT,SELECT',
    suppliers: 'DELETE,INSERT,SELECT,UPDATE',
    team_invites: 'SELECT',
    team_members: 'SELECT',
    tenants: 'SELECT',                        // + UPDATE tylko na danych kontaktowych
  };
  const rows = await q(`
    select c.relname, string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
      and a.grantee = 'authenticated'::regrole::oid
    group by c.relname order by 1`);
  const actual = Object.fromEntries(rows.map((r) => [r.relname, r.privs]));
  assert.deepEqual(actual, expected);

  const cols = await q(`
    select c.relname, string_agg(att.attname, ',' order by att.attname) as cols
    from pg_attribute att
    join pg_class c on c.oid = att.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(att.attacl) a
    where n.nspname = 'public' and a.grantee = 'authenticated'::regrole::oid and a.privilege_type = 'UPDATE'
    group by c.relname order by 1`);
  assert.deepEqual(Object.fromEntries(cols.map((r) => [r.relname, r.cols])), {
    memberships: 'can_manage_billing,can_manage_managers,role',
    profiles: 'display_name,phone',
    tenants: 'address_line,city,industry,lat,lng,name,postal_code',
  });
});

test('każda funkcja SECURITY DEFINER ma ustaloną ścieżkę search_path', async () => {
  // Bez tego atakujący mógłby podstawić własny obiekt o tej samej nazwie.
  const rows = await q(`
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
    order by 1`);
  assert.deepEqual(rows.map((r) => r.proname), []);
});

test('tabele „tylko do dopisywania" mają blokadę zmian i kasowania', async () => {
  const expectedTables = ['stock_movements', 'request_messages', 'audit_log', 'reward_ledger', 'tenant_deletions'];
  for (const t of expectedTables) {
    const rows = await q(
      `select count(*)::int n from pg_trigger tg
       join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and not tg.tgisinternal
         and tg.tgfoid = 'public.forbid_change'::regproc`,
      [t]
    );
    assert.equal(rows[0].n, 1, `${t} powinna mieć dokładnie jeden trigger forbid_change`);
  }
});

test('tabele wyłącznie-backendowe nie mają żadnych polityk dla zalogowanych', async () => {
  for (const t of ['ksef_integrations', 'tenant_deletions', 'tenant_invites']) {
    const rows = await q(`select count(*)::int n from pg_policies where schemaname = 'public' and tablename = $1`, [t]);
    assert.equal(rows[0].n, 0, `${t}: polityki ujawniałyby sekrety`);
  }
});

test('migracje stosują się od zera (db reset) i seed się ładuje', async () => {
  assert.ok(db.applied.length >= 3);
  const rows = await q(`select count(*)::int n from public.catalog_items`);
  assert.ok(rows[0].n >= 5, 'seed.sql powinien dodać próbki katalogu');
});
