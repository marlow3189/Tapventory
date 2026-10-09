// Sprawdzenie łańcuchów wywołań bazy (z extract.mjs) względem schematu (z schema.mjs).
// Zwraca listę niezgodności (errors), listę rzeczy niesprawdzonych (unverified) i statystyki.

import { parseSelect, splitSelectItem } from './extract.mjs';

const FILTERS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'order', 'not', 'match', 'filter', 'textSearch']);
const NO_COLUMN = new Set(['range', 'limit', 'single', 'maybeSingle', 'abortSignal', 'throwOnError', 'returns', 'csv', 'explain', 'or', 'overrideTypes', 'setHeader', 'then']);

export function validateChains(chains, schema) {
  const errors = [];
  const unverified = [];
  const stats = { from: 0, rpc: 0, selectColumns: 0, writeColumns: 0, filters: 0, embeds: 0, upserts: 0 };
  const where = (c) => `${c.file}:${c.line}`;
  const list = (iterable) => [...iterable].join(', ');

  function checkSelect(c, table, selectText, rel, relName) {
    let items;
    try {
      items = parseSelect(selectText);
    } catch (e) {
      errors.push(`${where(c)} from('${table}').select: nie da się odczytać składni „${selectText}” (${e.message})`);
      return;
    }
    for (const item of items) {
      if (typeof item === 'string') {
        const { name } = splitSelectItem(item);
        stats.selectColumns += 1;
        if (name === '*') {
          if (!rel.select) errors.push(`${where(c)} select('*') na „${relName}”: rola authenticated nie ma SELECT na całej tabeli`);
          continue;
        }
        const col = rel.columns.get(name);
        if (!col) errors.push(`${where(c)} „${relName}”: brak kolumny „${name}” (są: ${list(rel.columns.keys())})`);
        else if (!col.select) errors.push(`${where(c)} „${relName}.${name}”: rola authenticated nie ma SELECT na tej kolumnie`);
      } else {
        stats.embeds += 1;
        const { name: relation, hints } = splitSelectItem(item.rel);
        const target = schema.relations.get(relation);
        if (!target) { errors.push(`${where(c)} zasób zagnieżdżony „${relation}” w „${relName}” nie istnieje`); continue; }
        if (rel.kind === 'v') { unverified.push(`${where(c)} zagnieżdżanie z widoku „${relName}” → „${relation}” (PostgREST wymaga kluczy obcych tabel bazowych)`); continue; }
        const linked = schema.fks.some((f) => (f.from === relName && f.to === relation) || (f.from === relation && f.to === relName));
        if (!linked) errors.push(`${where(c)} zagnieżdżenie „${relation}” w „${relName}”: brak klucza obcego między tabelami (hint: ${hints.join(',') || '—'})`);
        const innerText = item.inner.map((x) => (typeof x === 'string' ? x : '')).filter(Boolean).join(',');
        checkSelect(c, relation, innerText, target, relation);
      }
    }
  }

  function checkWriteKeys(c, table, rel, keys, op, privilege) {
    for (const name of keys) {
      stats.writeColumns += 1;
      const col = rel.columns.get(name);
      if (!col) errors.push(`${where(c)} ${op}('${table}'): brak kolumny „${name}”`);
      else if (!col[privilege]) errors.push(`${where(c)} ${op}('${table}.${name}'): rola authenticated nie ma uprawnienia ${privilege.toUpperCase()} na tej kolumnie`);
    }
  }

  function checkFrom(c) {
    stats.from += 1;
    const table = c.calls[0].args[0]?.kind === 'string' ? c.calls[0].args[0].value : null;
    if (!table) { unverified.push(`${where(c)} from(<dynamiczna nazwa>)`); return; }
    const rel = schema.relations.get(table);
    if (!rel) { errors.push(`${where(c)} from('${table}'): taka tabela/widok nie istnieje w schemacie public`); return; }

    for (const step of c.calls.slice(1)) {
      const a0 = step.args[0];
      if (step.name === 'select') {
        if (a0?.kind === 'string') checkSelect(c, table, a0.value, rel, table);
        else if (a0?.kind === 'none') { stats.selectColumns += 1; if (!rel.select) errors.push(`${where(c)} select() na „${table}”: brak SELECT`); }
        else unverified.push(`${where(c)} select(<dynamiczny>) na „${table}”`);
        continue;
      }
      if (step.name === 'insert' || step.name === 'upsert' || step.name === 'update') {
        const objects = a0?.kind === 'array' ? a0.items : a0 ? [a0] : [];
        const writes = step.name === 'update' ? 'update' : 'insert';
        const anyColumn = [...rel.columns.values()].some((col) => col[writes]);
        // uprawnienia mogą być nadane tylko na wybranych kolumnach (np. notifications.read_at) — wtedy wystarcza „którakolwiek"
        if (!rel[writes] && !anyColumn) errors.push(`${where(c)} ${step.name}('${table}'): rola authenticated nie ma uprawnienia ${writes.toUpperCase()} na żadnej kolumnie`);
        for (const o of objects) {
          if (o.kind === 'typed') {
            // klucze poznane z typu (np. Partial<…>): sprawdzamy tylko, czy kolumny istnieją — typ bywa szerszy niż to, co kod faktycznie wysyła
            for (const name of o.keys) {
              stats.writeColumns += 1;
              if (!rel.columns.has(name)) errors.push(`${where(c)} ${step.name}('${table}'): pole „${name}” z typu argumentu nie jest kolumną tabeli`);
            }
            continue;
          }
          if (o.kind !== 'object') { unverified.push(`${where(c)} ${step.name}('${table}') z treścią, której typu nie da się odczytać`); continue; }
          for (const name of o.spreadKeys ?? []) {
            stats.writeColumns += 1;
            if (!rel.columns.has(name)) errors.push(`${where(c)} ${step.name}('${table}'): pole „${name}” z rozwinięcia (...) nie jest kolumną tabeli`);
          }
          if (o.dynamic) unverified.push(`${where(c)} ${step.name}('${table}'): obiekt z rozwinięciem o nieznanym typie — część kluczy niesprawdzona`);
          checkWriteKeys(c, table, rel, o.keys, step.name, writes);
          if (step.name === 'upsert') {
            const options = step.args[1];
            stats.upserts += 1;
            // ON CONFLICT DO UPDATE (domyślnie) wymaga też uprawnienia UPDATE na zapisywanych kolumnach; DO NOTHING (ignoreDuplicates) — nie
            const ignore = options?.kind === 'object' && options.values?.ignoreDuplicates === true;
            if (!ignore) checkWriteKeys(c, table, rel, o.keys, 'upsert (nadpisanie)', 'update');
            // cel konfliktu: onConflict z literału albo klucz główny; tu sprawdzamy literał, jeśli da się go odczytać
            const target = options?.kind === 'object' ? options.values?.onConflict : undefined;
            if (typeof target === 'string') {
              const cols = target.split(',').map((x) => x.trim());
              for (const col of cols) if (!rel.columns.has(col)) errors.push(`${where(c)} upsert('${table}'): onConflict wskazuje nieistniejącą kolumnę „${col}”`);
              if (!schema.hasUnique(table, cols)) errors.push(`${where(c)} upsert('${table}'): na kolumnach (${cols.join(', ')}) nie ma zwykłego unikalnego indeksu — PostgREST zwróci błąd (indeks częściowy nie działa jako cel ON CONFLICT)`);
            }
          }
        }
        continue;
      }
      if (step.name === 'delete') {
        if (!rel.delete) errors.push(`${where(c)} delete('${table}'): rola authenticated nie ma DELETE`);
        continue;
      }
      if (FILTERS.has(step.name)) {
        stats.filters += 1;
        if (a0?.kind === 'string' && !a0.value.includes('.') && !rel.columns.has(a0.value)) {
          errors.push(`${where(c)} ${step.name}('${a0.value}') na „${table}”: brak takiej kolumny`);
        }
        continue;
      }
      if (!NO_COLUMN.has(step.name)) unverified.push(`${where(c)} nieznana metoda ${step.name}() w łańcuchu from('${table}')`);
    }
  }

  function checkRpc(c) {
    stats.rpc += 1;
    const fn = c.calls[0].args[0]?.kind === 'string' ? c.calls[0].args[0].value : null;
    if (!fn) { unverified.push(`${where(c)} rpc(<dynamiczna nazwa>)`); return; }
    const overloads = schema.functions.get(fn);
    if (!overloads) { errors.push(`${where(c)} rpc('${fn}'): taka funkcja nie istnieje w schemacie public`); return; }
    const callable = overloads.filter((o) => o.execute);
    if (callable.length === 0) { errors.push(`${where(c)} rpc('${fn}'): rola authenticated nie ma EXECUTE`); return; }
    const argsNode = c.calls[0].args[1];
    if (argsNode && argsNode.kind === 'typed') {
      for (const name of argsNode.keys) if (!callable.some((o) => o.names.includes(name))) errors.push(`${where(c)} rpc('${fn}'): argument „${name}” z typu nie występuje w sygnaturze`);
      return;
    }
    if (argsNode && argsNode.kind !== 'object') { unverified.push(`${where(c)} rpc('${fn}') z dynamicznymi argumentami`); return; }
    if (argsNode?.dynamic) { unverified.push(`${where(c)} rpc('${fn}') z rozwinięciem (...) w argumentach`); return; }
    const given = [...(argsNode?.keys ?? []), ...(argsNode?.spreadKeys ?? [])];
    const fits = callable.some((o) => {
      const required = o.names.slice(0, o.nargs - o.ndefaults);
      return given.every((g) => o.names.includes(g)) && required.every((r) => given.includes(r));
    });
    if (!fits) {
      errors.push(`${where(c)} rpc('${fn}', {${given.join(', ')}}): argumenty nie pasują do sygnatury — ${callable.map((o) => `(${o.names.join(', ')}; wymagane: ${o.names.slice(0, o.nargs - o.ndefaults).join(', ') || '—'})`).join(' lub ')}`);
    }
  }

  for (const c of chains) {
    if (c.calls[0].name === 'from') checkFrom(c);
    else checkRpc(c);
  }
  return { errors, unverified, stats };
}
