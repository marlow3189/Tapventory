// ============================================================================
// Kontrakt aplikacja ↔ baza: czy KAŻDE wywołanie bazy w kodzie aplikacji ma pokrycie w prawdziwym schemacie?
// ============================================================================
// Co sprawdzamy (dla każdego supabase.from(...) i supabase.rpc(...) znalezionego w mobile/src):
//   • tabela/widok istnieje w schemacie public, a rola `authenticated` ma do niej uprawnienie do takiej operacji,
//   • każda kolumna w select(...), filtrach (eq, in, gte, order…), insert/upsert/update istnieje i rola ma do niej uprawnienie,
//   • upsert z onConflict wskazuje kolumny, na których jest zwykły (nieczęściowy) unikalny indeks — inaczej PostgREST zwróci błąd,
//   • zagnieżdżone zasoby (np. tenants(...) przy memberships) mają klucz obcy,
//   • funkcja rpc istnieje, rola ma EXECUTE, nazwy argumentów zgadzają się z sygnaturą i podano wszystkie wymagane.
// Czego NIE sprawdzamy: zapytań, których nie da się odczytać statycznie (raportujemy je jako „niezweryfikowane”)
// i samej logiki RLS (to robią testy w supabase/tests). Uruchomienie: npm run api:contract
// (potrzebny PostgreSQL jak dla db:test oraz `npm install` w folderze mobile — kod aplikacji czytamy kompilatorem TypeScript).

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '../tests/helpers.mjs';
import { extractCalls } from './extract.mjs';
import { loadSchema } from './schema.mjs';
import { validateChains } from './check.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../mobile/src');

let db, schema, chains;
test.before(async () => {
  db = await createTestDb();
  schema = await loadSchema(db);
  chains = extractCalls(srcDir);
});
test.after(async () => { await db?.drop(); });

test('kontrola wyciągania: znaleziono sensowną liczbę wywołań (inaczej ten test niczego nie dowodzi)', () => {
  const from = chains.filter((c) => c.calls[0].name === 'from').length;
  const rpc = chains.filter((c) => c.calls[0].name === 'rpc').length;
  assert.ok(from >= 30, `znaleziono tylko ${from} łańcuchów supabase.from(...) — extractor zepsuty?`);
  assert.ok(rpc >= 15, `znaleziono tylko ${rpc} wywołań supabase.rpc(...) — extractor zepsuty?`);
});

test('każde wywołanie bazy w aplikacji pasuje do schematu (tabele, kolumny, uprawnienia, funkcje, argumenty)', () => {
  const { errors, unverified, stats } = validateChains(chains, schema);
  console.log(`Kontrakt aplikacja ↔ baza: from: ${stats.from}, rpc: ${stats.rpc}, upsertów: ${stats.upserts}; kolumn w select: ${stats.selectColumns}, w zapisie: ${stats.writeColumns}, filtrów: ${stats.filters}, zagnieżdżeń: ${stats.embeds}`);
  if (unverified.length) console.log(`Niezweryfikowane (${unverified.length}):\n  - ${unverified.join('\n  - ')}`);
  assert.deepEqual(errors, [], `Niezgodności aplikacja ↔ baza:\n  - ${errors.join('\n  - ')}`);
});
