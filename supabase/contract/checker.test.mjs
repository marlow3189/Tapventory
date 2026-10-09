// ============================================================================
// Test samego sprawdzacza kontraktu: czy na pewno wykrywa błędy? (Test, który nigdy się nie czerwieni, nic nie dowodzi.)
// Piszemy „aplikację" ze specjalnie błędnymi wywołaniami i sprawdzamy, że KAŻDY błąd zostaje zgłoszony.
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb } from '../tests/helpers.mjs';
import { extractCalls } from './extract.mjs';
import { loadSchema } from './schema.mjs';
import { validateChains } from './check.mjs';

let db, schema, dir;
test.before(async () => {
  db = await createTestDb();
  schema = await loadSchema(db);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-contract-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: false, noEmit: true, target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler' }, include: ['src'] }));
});
test.after(async () => { await db?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

function check(source) {
  fs.writeFileSync(path.join(dir, 'src', 'case.ts'), `declare const supabase: any;\ndeclare const anyValue: any;\n${source}`);
  return validateChains(extractCalls(path.join(dir, 'src')), schema);
}
const has = (result, pattern) => result.errors.some((e) => pattern.test(e));

test('poprawne wywołania nie dają błędów', () => {
  const r = check(`
    supabase.from('products').select('id, name, ean').eq('tenant_id', 'x').order('name').range(0, 10);
    supabase.from('product_overview').select('*').eq('tenant_id', 'x');
    supabase.from('memberships').select('id, tenant_id, role, tenants(id, name, nip, plan)').eq('user_id', 'x');
    supabase.rpc('dashboard_summary', { p_tenant: 'x' });
    supabase.from('stock_movements').upsert({ id: '1', tenant_id: 't', product_id: 'p', movement_type: 'issue', qty: -1 }, { onConflict: 'id', ignoreDuplicates: true });
    supabase.from('notifications').update({ read_at: 'now' }).eq('id', '1');
  `);
  assert.deepEqual(r.errors, []);
  assert.ok(r.stats.from >= 5 && r.stats.rpc >= 1);
});

test('wykrywa literówki i nieistniejące obiekty', () => {
  const r = check(`
    supabase.from('produkty').select('id');
    supabase.from('products').select('id, nme');
    supabase.from('products').select('id').eq('tenat_id', 'x');
    supabase.from('products').select('id').order('nazwa');
    supabase.rpc('dashboard_sumary', { p_tenant: 'x' });
    supabase.rpc('dashboard_summary', { p_tenant_id: 'x' });
    supabase.rpc('dashboard_summary', {});
  `);
  assert.ok(has(r, /from\('produkty'\).*nie istnieje/), 'nieistniejąca tabela');
  assert.ok(has(r, /brak kolumny „nme”/), 'literówka w select');
  assert.ok(has(r, /eq\('tenat_id'\)/), 'literówka w filtrze');
  assert.ok(has(r, /order\('nazwa'\)/), 'literówka w order');
  assert.ok(has(r, /rpc\('dashboard_sumary'\).*nie istnieje/), 'nieistniejąca funkcja');
  assert.ok(has(r, /rpc\('dashboard_summary', \{p_tenant_id\}\).*nie pasują/), 'zły argument funkcji');
  assert.ok(has(r, /rpc\('dashboard_summary', \{\}\).*nie pasują/), 'brak wymaganego argumentu');
});

test('wykrywa brak uprawnień roli authenticated', () => {
  const r = check(`
    supabase.from('stock_movements').update({ qty: 5 }).eq('id', '1');
    supabase.from('stock_movements').delete().eq('id', '1');
    supabase.from('tenants').update({ plan: 'team' }).eq('id', 't');
    supabase.from('ksef_integrations').select('token_ciphertext');
    supabase.from('documents').select('ai_extraction');
    supabase.rpc('claim_ksef_sync', { p_tenant: 't', p_trigger: 'manual' });
    supabase.rpc('apply_document_extraction', { p_document: 'd', p_extraction: {} });
  `);
  assert.ok(has(r, /update\('stock_movements'\)|update\('stock_movements.qty'\)/), 'UPDATE na księdze ruchów');
  assert.ok(has(r, /delete\('stock_movements'\).*DELETE/), 'DELETE na księdze ruchów');
  assert.ok(has(r, /update\('tenants\.plan'\).*UPDATE/), 'zmiana planu przez klienta');
  assert.ok(has(r, /ksef_integrations/), 'tabela tylko dla backendu');
  assert.ok(has(r, /rpc\('claim_ksef_sync'\).*EXECUTE/), 'funkcja tylko dla backendu');
  assert.ok(has(r, /rpc\('apply_document_extraction'\).*EXECUTE/), 'zapis odczytu tylko dla backendu');
});

test('upsert: cel konfliktu musi mieć zwykły unikalny indeks; nadpisanie wymaga UPDATE', () => {
  const r = check(`
    supabase.from('products').upsert({ id: '1', tenant_id: 't', name: 'x' }, { onConflict: 'name' });
    supabase.from('stock_movements').upsert({ id: '1', tenant_id: 't', product_id: 'p', movement_type: 'issue', qty: 1 }, { onConflict: 'id' });
    supabase.from('documents').upsert({ id: '1', supplier_nip: '1' }, { onConflict: 'tenant_id,supplier_nip' });
  `);
  assert.ok(has(r, /upsert\('products'\).*\(name\).*unikalnego indeksu/), 'brak unikalnego indeksu na name');
  assert.ok(has(r, /upsert \(nadpisanie\)\('stock_movements\.id'\)|upsert \(nadpisanie\)\('stock_movements\./), 'upsert bez ignoreDuplicates na tabeli bez UPDATE');
  assert.ok(has(r, /upsert\('documents'\).*\(tenant_id, supplier_nip\).*unikalnego indeksu/), 'indeks częściowy nie jest celem ON CONFLICT');
});

test('klucze z typów: Partial<…> jest sprawdzany kompilatorem, a zagnieżdżenie wymaga klucza obcego', () => {
  const r = check(`
    type Patch = { name?: string; nieistniejaca_kolumna?: number };
    const patch: Patch = anyValue;
    supabase.from('products').update(patch).eq('id', '1');
    supabase.from('product_overview').select('id, tenants(id)');
    supabase.from('memberships').select('id, requests(id)');
  `);
  assert.ok(has(r, /pole „nieistniejaca_kolumna” z typu argumentu/), 'kolumna z typu');
  assert.ok(r.unverified.some((u) => /zagnieżdżanie z widoku/.test(u)) || has(r, /zagnieżdżenie/), 'zagnieżdżanie z widoku');
  assert.ok(has(r, /zagnieżdżenie „requests” w „memberships”.*brak klucza obcego/), 'brak FK');
});
