// Odczyt „kontraktu" bazy (to, co widzi rola `authenticated` przez PostgREST): tabele, widoki, kolumny, uprawnienia,
// funkcje z nazwami argumentów, klucze obce i unikalne indeksy. Wynik służy do sprawdzenia kodu aplikacji.

export async function loadSchema(db) {
  const q = async (sql) => (await db.admin.query(sql)).rows;

  const relations = new Map();
  for (const r of await q(`select c.relname, c.relkind, has_table_privilege('authenticated', c.oid, 'SELECT') as can_select,
                                  has_table_privilege('authenticated', c.oid, 'INSERT') as can_insert,
                                  has_table_privilege('authenticated', c.oid, 'UPDATE') as can_update,
                                  has_table_privilege('authenticated', c.oid, 'DELETE') as can_delete
                           from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')`)) {
    relations.set(r.relname, { kind: r.relkind, select: r.can_select, insert: r.can_insert, update: r.can_update, delete: r.can_delete, columns: new Map() });
  }
  for (const r of await q(`select c.relname, a.attname,
                                  has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT') as can_select,
                                  has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT') as can_insert,
                                  has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE') as can_update
                           from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v') and a.attnum > 0 and not a.attisdropped`)) {
    relations.get(r.relname)?.columns.set(r.attname, { select: r.can_select, insert: r.can_insert, update: r.can_update });
  }

  const functions = new Map();
  for (const r of await q(`select p.proname, p.pronargs, p.pronargdefaults, has_function_privilege('authenticated', p.oid, 'EXECUTE') as can_execute,
                                  (select coalesce(array_agg(t.n order by t.ord), '{}') from unnest(coalesce(p.proargnames, '{}'::text[])) with ordinality as t(n, ord)
                                    where coalesce(p.proargmodes[t.ord], 'i') in ('i', 'b', 'v')) as in_names
                           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`)) {
    if (!functions.has(r.proname)) functions.set(r.proname, []);
    functions.get(r.proname).push({ nargs: r.pronargs, ndefaults: r.pronargdefaults, execute: r.can_execute, names: r.in_names });
  }

  const fks = (await q(`select c.conname, c.conrelid::regclass::text as from_rel, c.confrelid::regclass::text as to_rel
                        from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace`))
    .map((f) => ({ name: f.conname, from: f.from_rel.replace(/^public\./, ''), to: f.to_rel.replace(/^public\./, '') }));

  const uniques = new Map();   // tabela → zbiór „a,b" (posortowane) — tylko indeksy unikalne bez predykatu i bez wyrażeń
  for (const r of await q(`select c.relname, (select string_agg(a.attname, ',' order by a.attname) from unnest(i.indkey::int2[]) k join pg_attribute a on a.attrelid = c.oid and a.attnum = k) as cols
                           from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and i.indisunique and i.indpred is null and i.indexprs is null`)) {
    if (!uniques.has(r.relname)) uniques.set(r.relname, new Set());
    uniques.get(r.relname).add(r.cols);
  }
  const hasUnique = (rel, cols) => uniques.get(rel)?.has([...cols].sort().join(',')) ?? false;
  return { relations, functions, fks, hasUnique };
}
