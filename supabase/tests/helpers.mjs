// ============================================================================
// Pomocniki testow bazy (Node + `pg`, bez zadnych frameworkow).
// ============================================================================
// Dla juniora:
//  * Kazdy plik *.test.mjs dostaje WLASNA, swieza baze danych: createTestDb()
//    tworzy ja, nakleja bootstrap.sql ("udawane Supabase"), wszystkie migracje
//    z supabase/migrations oraz seed.sql - czyli to samo, co `supabase db reset`.
//  * Zapytania "jako uzytkownik" (asUser) odtwarzaja to, co robi PostgREST przy
//    kazdym zadaniu API: SET LOCAL ROLE authenticated + ustawienie tokenu JWT.
//    Dzieki temu RLS dziala dokladnie tak, jak dla aplikacji.
//  * Polaczenie administracyjne (db.admin) jest superuzytkownikiem - uzywamy go
//    tylko do przygotowania danych i do sprawdzania efektow ubocznych.
//
// Adres serwera Postgres: zmienna TEST_DATABASE_URL. Domyslnie lokalny
// Postgres z `supabase start` (port 54322). Baza testowa powstaje OBOK
// bazy "postgres" i jest kasowana po testach - Twoje dane dev sa bezpieczne.
// ============================================================================

import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const supabaseDir = path.join(here, '..');

export const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

/** Wczytuje pliki migracji w kolejnosci numerow (0001, 0002, ...). */
export function listMigrations() {
  const dir = path.join(supabaseDir, 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(path.join(dir, f), 'utf8') }));
}

/**
 * Tworzy swieza baze testowa. Opcje:
 *   upTo   - zatrzymaj sie na migracji o tym prefiksie numerycznym (np. '0002'),
 *            przydatne do pokazania, jak zachowywala sie baza przed poprawkami;
 *   seed   - czy nakleic seed.sql (domyslnie tak).
 */
export async function createTestDb({ upTo = process.env.TEST_MIGRATE_UP_TO, seed = true } = {}) {
  // TEST_MIGRATE_UP_TO=0002 zatrzymuje budowe bazy na wskazanej migracji - tak pokazujemy, ze testy F1-F10 swieca na czerwono
  // na oryginalnym fundamencie (0001+0002), a na zielono dopiero po 0003 (docs/05_RAPORT_WERYFIKACJI.md).
  const name = `tv_test_${randomBytes(4).toString('hex')}`;

  const adminConn = new pg.Client({ connectionString: ADMIN_URL });
  await adminConn.connect();
  await adminConn.query(`create database ${name}`);
  await adminConn.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();

  // Jak w Supabase: schemat extensions jest w sciezce wyszukiwania.
  await admin.query(`alter database ${name} set search_path = "$user", public, extensions`);
  await admin.end();
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();

  const drop = async () => {
    await db.end().catch(() => {});
    const c = new pg.Client({ connectionString: ADMIN_URL });
    await c.connect();
    await c.query(`drop database if exists ${name} with (force)`);
    await c.end();
  };

  const applied = [];
  try {
    await db.query(readFileSync(path.join(here, 'bootstrap.sql'), 'utf8'));
    for (const m of listMigrations()) {
      if (upTo && m.name.slice(0, 4) > upTo) break;
      try {
        await db.query(m.sql);
      } catch (e) {
        e.message = `Migracja ${m.name} nie przeszla: ${e.message}`;
        throw e;
      }
      applied.push(m.name);
    }
    if (seed) {
      await db.query(readFileSync(path.join(supabaseDir, 'seed.sql'), 'utf8'));
    }
  } catch (e) {
    // Bez tego nieudana migracja zostawialaby otwarte polaczenie (test "wisi") i smieciowa baze tv_test_*.
    await drop().catch(() => {});
    throw e;
  }

  return { name, url: url.toString(), admin: db, applied, drop };
}

// ----------------------------------------------------------------------------
// Uzytkownicy i sesje
// ----------------------------------------------------------------------------

/** Zaklada konto w auth.users (jak rejestracja) - trigger tworzy profil. */
export async function signUp(db, { email, name = 'Test User', confirmed = true, meta } = {}) {
  const id = randomUUID();
  const address = email ?? `u-${id.slice(0, 8)}@test.pl`;
  await db.admin.query(
    `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
     values ($1, $2, $3, $4)`,
    [
      id,
      address,
      JSON.stringify(meta ?? { display_name: name }),
      confirmed ? new Date().toISOString() : null,
    ]
  );
  return { id, email: address };
}

/**
 * Sesja "jako zalogowany uzytkownik". Kazde wywolanie query() to osobna
 * transakcja z rola `authenticated` i tokenem JWT - jak jedno zadanie API.
 * Gdy potrzeba kilku zapytan w jednej transakcji: tx(async q => { ... }).
 */
export function asUser(db, user, { role = 'authenticated' } = {}) {
  // Token backendu (service_role) w prawdziwym Supabase NIE ma claimu `sub` -
  // dlatego auth.uid() jest wtedy NULL. Odtwarzamy to wiernie.
  const claims = JSON.stringify({
    ...(user.id ? { sub: user.id } : {}),
    ...(user.email ? { email: user.email } : {}),
    role,
    aud: 'authenticated',
  });

  async function tx(fn) {
    await db.admin.query('begin');
    try {
      await db.admin.query(`set local role ${role}`);
      await db.admin.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      const result = await fn((sql, params) => db.admin.query(sql, params));
      await db.admin.query('commit');
      return result;
    } catch (e) {
      await db.admin.query('rollback');
      throw e;
    }
  }
  const query = (sql, params) => tx((q) => q(sql, params));
  return { user, tx, query, rows: async (sql, params) => (await query(sql, params)).rows };
}

/** Zapytanie jako rola anonimowa (niezalogowany) - bez tokenu. */
export function asAnon(db) {
  async function tx(fn) {
    await db.admin.query('begin');
    try {
      await db.admin.query('set local role anon');
      const result = await fn((sql, params) => db.admin.query(sql, params));
      await db.admin.query('commit');
      return result;
    } catch (e) {
      await db.admin.query('rollback');
      throw e;
    }
  }
  const query = (sql, params) => tx((q) => q(sql, params));
  return { tx, query, rows: async (sql, params) => (await query(sql, params)).rows };
}

/** Zapytanie jako backend (service_role) - omija RLS, tak jak Edge Functions. */
export function asService(db) {
  return asUser(db, { id: null, email: null }, { role: 'service_role' });
}

// ----------------------------------------------------------------------------
// Skroty do budowania scenariuszy
// ----------------------------------------------------------------------------

/** Konto + firma, w ktorej jest wlascicielem. */
export async function ownerWithTenant(db, label = 'A') {
  const owner = await signUp(db, { name: `Owner ${label}` });
  const s = asUser(db, owner);
  const { rows } = await s.query(`select public.create_tenant($1) as id`, [`Firma ${label}`]);
  return { owner, session: s, tenantId: rows[0].id };
}

/** Dodaje do firmy czlonka o danej roli (pomija zaproszenia - bezposrednio jako admin). */
export async function addMember(db, tenantId, role = 'employee', opts = {}) {
  const user = await signUp(db, { name: `${role}-${randomBytes(2).toString('hex')}` });
  await db.admin.query(
    `insert into public.memberships (tenant_id, user_id, role, can_manage_managers)
     values ($1, $2, $3, $4)`,
    [tenantId, user.id, role, opts.canManageManagers ?? false]
  );
  return { user, session: asUser(db, user) };
}

/** Wstawia produkt jako admin (pomija RLS) i zwraca jego id. */
export async function insertProduct(db, tenantId, name = 'Produkt testowy', extra = {}) {
  const { rows } = await db.admin.query(
    `insert into public.products (tenant_id, name, unit, min_stock)
     values ($1, $2, $3, $4) returning id`,
    [tenantId, name, extra.unit ?? 'szt.', extra.minStock ?? 0]
  );
  return rows[0].id;
}

/** Oczekuje bledu zapytania; zwraca jego tresc, a gdy blad nie wystapil - rzuca. */
export async function expectError(promise, pattern) {
  try {
    await promise;
  } catch (e) {
    if (pattern && !pattern.test(`${e.code ?? ''} ${e.message}`)) {
      throw new Error(`Blad inny niz oczekiwany. Oczekiwano ${pattern}, jest: [${e.code}] ${e.message}`);
    }
    return e;
  }
  throw new Error('Oczekiwano bledu, ale zapytanie zakonczylo sie sukcesem.');
}
