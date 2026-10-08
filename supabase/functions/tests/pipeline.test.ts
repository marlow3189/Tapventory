import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, toApplyPayload, type PipelineConfig } from '../_shared/pipeline.ts';
import { ProviderError } from '../_shared/provider.ts';
import { TODAY, ScriptedProvider, badInvoiceJson, goodInvoiceJson } from './helpers.ts';

const cfg: PipelineConfig = { fastModel: 'claude-haiku-5-5', strongModel: 'claude-sonnet-5-5', fastEffort: 'medium', strongEffort: 'high', escalate: true };
const pages = [{ kind: 'image' as const, mediaType: 'image/jpeg', base64: 'AAAA' }];
const run = (p: ScriptedProvider, c: PipelineConfig = cfg) => runPipeline(p, pages, c, { today: TODAY });

test('dobry odczyt tanim modelem: jedno wywołanie, bez drugiego modelu', async () => {
  const p = new ScriptedProvider([{ json: goodInvoiceJson() }]);
  const r = await run(p);
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].model, 'claude-haiku-5-5');
  assert.equal(p.calls[0].effort, 'medium');
  assert.equal(r.escalated, false);
  assert.equal(r.modelUsed, 'claude-haiku-5-5');
  assert.deepEqual(r.issues, []);
  // 3000 wej. × 0,10 + 800 wyj. × 0,50 = 300 + 400 = 700 micro-USD (czyli 0,0007 USD)
  assert.equal(r.costMicroUsd, 700);
});

test('wykryty błąd (suma nie gra): drugi odczyt mocniejszym modelem i wybór lepszego wyniku', async () => {
  const p = new ScriptedProvider([{ json: badInvoiceJson() }, { json: goodInvoiceJson(), tokens: [3000, 1200] }]);
  const r = await run(p);
  assert.deepEqual(p.calls.map((c) => c.model), ['claude-haiku-5-5', 'claude-sonnet-5-5']);
  assert.equal(p.calls[1].effort, 'high');
  assert.equal(r.escalated, true);
  assert.equal(r.modelUsed, 'claude-sonnet-5-5');
  assert.deepEqual(r.issues, []);
  // koszt obu odczytów: Haiku 700 + Sonnet (3000×2 + 1200×10 = 18000)
  assert.equal(r.costMicroUsd, 700 + 18000);
  const payload = toApplyPayload(r);
  assert.equal(payload.ai_model, 'claude-sonnet-5-5');
  assert.ok((payload.ai_warnings as { code: string }[]).some((w) => w.code === 'second_pass'));
});

test('mocniejszy model nie jest lepszy → zostaje wynik taniego (przy remisie wygrywa mocniejszy)', async () => {
  const worse = { ...badInvoiceJson(), supplier: { name: 'X', nip: '5260250996' } };   // dodatkowo zły NIP
  const p = new ScriptedProvider([{ json: badInvoiceJson() }, { json: worse }]);
  const r = await run(p);
  assert.equal(r.modelUsed, 'claude-haiku-5-5');
  const p2 = new ScriptedProvider([{ json: badInvoiceJson() }, { json: badInvoiceJson() }]);
  assert.equal((await run(p2)).modelUsed, 'claude-sonnet-5-5', 'remis → mocniejszy');
});

test('eskalacja wyłączona lub ten sam model: nigdy drugiego wywołania', async () => {
  const p = new ScriptedProvider([{ json: badInvoiceJson() }]);
  const r = await run(p, { ...cfg, escalate: false });
  assert.equal(p.calls.length, 1);
  assert.equal(r.escalated, false);
  assert.ok(r.issues.length > 0, 'problemy zostają do oceny człowieka');
  const p2 = new ScriptedProvider([{ json: badInvoiceJson() }]);
  await run(p2, { ...cfg, strongModel: cfg.fastModel });
  assert.equal(p2.calls.length, 1);
});

test('odmowa/ucięcie/zły JSON taniego modelu → próba mocniejszym', async () => {
  for (const code of ['refusal', 'truncated', 'bad_json', 'rejected'] as const) {
    const p = new ScriptedProvider([{ error: new ProviderError(code, 'x') }, { json: goodInvoiceJson() }]);
    const r = await run(p);
    assert.equal(p.calls.length, 2, code);
    assert.equal(r.modelUsed, 'claude-sonnet-5-5', code);
    assert.equal(r.attempts[0].ok, false);
    assert.equal(r.attempts[0].error, code);
  }
});

test('awaria usługi lub timeout → natychmiastowy błąd, bez wydawania pieniędzy na drugi model', async () => {
  for (const code of ['unavailable', 'timeout'] as const) {
    const p = new ScriptedProvider([{ error: new ProviderError(code, 'x') }, { json: goodInvoiceJson() }]);
    await assert.rejects(run(p), (e: unknown) => e instanceof ProviderError && e.code === code);
    assert.equal(p.calls.length, 1, code);
  }
});

test('oba modele zawodzą → zgłaszamy ostatni błąd; mocniejszy zawodzi po dobrym tanim → zostaje tani wynik', async () => {
  const p = new ScriptedProvider([{ error: new ProviderError('refusal', 'a') }, { error: new ProviderError('bad_json', 'b') }]);
  await assert.rejects(run(p), (e: unknown) => e instanceof ProviderError && e.code === 'bad_json');

  const p2 = new ScriptedProvider([{ json: badInvoiceJson() }, { error: new ProviderError('unavailable', 'x') }]);
  const r = await run(p2);
  assert.equal(r.modelUsed, 'claude-haiku-5-5');
  assert.equal(r.attempts.length, 2);
});

test('ładunek dla bazy: tylko uwagi, których aplikacja sama nie wyliczy (nie „zamrażamy" sum i NIP)', async () => {
  const raw = badInvoiceJson();
  raw.warnings = [{ code: 'blur', text: 'Dolny róg jest nieostry.' }] as never;
  const r = await run(new ScriptedProvider([{ json: raw }]), { ...cfg, escalate: false });
  const payload = toApplyPayload(r) as { ai_warnings: { code: string }[]; lines: unknown[]; total_net: number };
  assert.deepEqual(payload.ai_warnings.map((w) => w.code), ['blur']);
  assert.equal(payload.lines.length, 3);
  assert.equal(payload.total_net, 999, 'dane z dokumentu zapisujemy wiernie — człowiek zdecyduje');
});
