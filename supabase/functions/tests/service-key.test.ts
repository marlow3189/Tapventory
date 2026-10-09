import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveServiceKey } from '../_shared/service-key.ts';

const envOf = (vars: Record<string, string | undefined>) => (name: string) => vars[name];

test('klucz w starym formacie: SUPABASE_SERVICE_ROLE_KEY', () => {
  assert.equal(resolveServiceKey(envOf({ SUPABASE_SERVICE_ROLE_KEY: 'eyJ.legacy.key' })), 'eyJ.legacy.key');
});

test('nowy format: mapa JSON SUPABASE_SECRET_KEYS, wpis „default"', () => {
  const raw = JSON.stringify({ default: 'sb_secret_default', automations: 'sb_secret_other' });
  assert.equal(resolveServiceKey(envOf({ SUPABASE_SECRET_KEYS: raw })), 'sb_secret_default');
});

test('mapa bez wpisu „default" — bierzemy pierwszy niepusty klucz', () => {
  const raw = JSON.stringify({ empty: '', cron: 'sb_secret_cron' });
  assert.equal(resolveServiceKey(envOf({ SUPABASE_SECRET_KEYS: raw })), 'sb_secret_cron');
});

test('pojedynczy klucz jako zwykły tekst lub jako tekst w cudzysłowie JSON', () => {
  assert.equal(resolveServiceKey(envOf({ SUPABASE_SECRET_KEYS: 'sb_secret_plain' })), 'sb_secret_plain');
  assert.equal(resolveServiceKey(envOf({ SUPABASE_SECRET_KEYS: '"sb_secret_quoted"' })), 'sb_secret_quoted');
});

test('własny TV_SERVICE_KEY ma pierwszeństwo przed kluczami wstrzykniętymi przez platformę', () => {
  const key = resolveServiceKey(envOf({
    TV_SERVICE_KEY: '  sb_secret_mine  ',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_default' }),
  }));
  assert.equal(key, 'sb_secret_mine');
});

test('stary klucz wygrywa z mapą, gdy oba są ustawione', () => {
  const key = resolveServiceKey(envOf({
    SUPABASE_SERVICE_ROLE_KEY: 'legacy',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_default' }),
  }));
  assert.equal(key, 'legacy');
});

test('brak kluczy albo śmieci zamiast klucza → undefined (a nie przypadkowy tekst)', () => {
  assert.equal(resolveServiceKey(envOf({})), undefined);
  assert.equal(resolveServiceKey(envOf({ SUPABASE_SECRET_KEYS: '' })), undefined);
  assert.equal(resolveServiceKey(envOf({ SUPABASE_SECRET_KEYS: '{}' })), undefined);
  assert.equal(resolveServiceKey(envOf({ SUPABASE_SECRET_KEYS: '[1,2]' })), undefined);
  assert.equal(resolveServiceKey(envOf({ SUPABASE_SECRET_KEYS: 'to nie jest klucz' })), undefined);
  assert.equal(resolveServiceKey(envOf({ SUPABASE_SERVICE_ROLE_KEY: '   ' })), undefined);
});
