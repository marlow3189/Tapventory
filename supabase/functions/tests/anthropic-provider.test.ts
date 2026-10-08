import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicExtractor, parseJsonLenient } from '../_shared/providers/anthropic.ts';
import { AnthropicChat } from '../_shared/providers/anthropic-chat.ts';
import { ProviderError } from '../_shared/provider.ts';
import { EXTRACTION_SYSTEM_PROMPT } from '../_shared/prompt.ts';
import { FakeAnthropic, goodInvoiceJson, sdkError, textResponse } from './helpers.ts';

const pages = [
  { kind: 'image' as const, mediaType: 'image/jpeg', base64: 'AAAA' },
  { kind: 'pdf' as const, base64: 'BBBB' },
];

test('żądanie: model, schemat odpowiedzi, wysiłek, strony jako obraz i dokument, brak zakazanych parametrów', async () => {
  const fake = new FakeAnthropic([textResponse(goodInvoiceJson())]);
  const r = await new AnthropicExtractor(fake).extract({ model: 'claude-haiku-5-5', effort: 'medium', pages });
  const req = fake.requests[0] as Record<string, any>;

  assert.equal(req.model, 'claude-haiku-5-5');
  assert.equal(req.system, EXTRACTION_SYSTEM_PROMPT);
  assert.equal(req.max_tokens, 16000);
  assert.deepEqual(Object.keys(req.output_config).sort(), ['effort', 'format']);
  assert.equal(req.output_config.effort, 'medium');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.output_config.format.schema.additionalProperties, false);

  // Modele Claude 5.x odrzucają te parametry błędem 400 — nie wolno ich wysyłać.
  for (const forbidden of ['temperature', 'top_p', 'top_k', 'thinking', 'budget_tokens', 'output_format']) assert.equal(forbidden in req, false, forbidden);
  const messages = req.messages as { role: string; content: Record<string, any>[] }[];
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user', 'ostatnia wiadomość to użytkownik (brak prefillu)');
  const blocks = messages[0].content;
  assert.deepEqual(blocks.map((b) => b.type), ['image', 'document', 'text']);
  assert.deepEqual(blocks[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' });
  assert.deepEqual(blocks[1].source, { type: 'base64', media_type: 'application/pdf', data: 'BBBB' });

  assert.equal(r.inputTokens, 2500);
  assert.equal(r.outputTokens, 700);
  assert.equal((r.json as { document_kind: string }).document_kind, 'invoice');
});

test('odpowiedź zaczynająca się od bloku „thinking” jest czytana po typie bloku', async () => {
  const fake = new FakeAnthropic([{ ...textResponse(goodInvoiceJson()), content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(goodInvoiceJson()) }] }]);
  const r = await new AnthropicExtractor(fake).extract({ model: 'claude-sonnet-5-5', effort: 'high', pages });
  assert.equal((r.json as { document_kind: string }).document_kind, 'invoice');
});

test('odmowa, ucięcie i pusta treść mają osobne kody błędów', async () => {
  const ex = (o: Parameters<typeof textResponse>[1]) => new AnthropicExtractor(new FakeAnthropic([textResponse(goodInvoiceJson(), o)]));
  await assert.rejects(ex({ stop_reason: 'refusal' }).extract({ model: 'm', effort: 'low', pages }), (e: unknown) => (e as ProviderError).code === 'refusal');
  await assert.rejects(ex({ stop_reason: 'max_tokens' }).extract({ model: 'm', effort: 'low', pages }), (e: unknown) => (e as ProviderError).code === 'truncated');
  await assert.rejects(ex({ content: [{ type: 'thinking' }] }).extract({ model: 'm', effort: 'low', pages }), (e: unknown) => (e as ProviderError).code === 'bad_json');
});

test('serwer odrzuca schemat odpowiedzi (400) → jedna próba z prośbą o czysty JSON, bez output_config.format', async () => {
  const fake = new FakeAnthropic([sdkError(400, 'output_config.format: invalid schema'), textResponse(goodInvoiceJson())]);
  const r = await new AnthropicExtractor(fake).extract({ model: 'claude-haiku-5-5', effort: 'medium', pages });
  assert.equal(fake.requests.length, 2);
  const second = fake.requests[1] as Record<string, any>;
  assert.equal('format' in second.output_config, false);
  assert.equal(second.output_config.effort, 'medium');
  const text = second.messages[0].content.at(-1).text as string;
  assert.match(text, /Respond with ONE JSON object only/);
  assert.equal((r.json as { document_kind: string }).document_kind, 'invoice');
});

test('inny błąd 400 (np. zły plik) nie jest ponawiany; klucz/limity/awaria mapują się na „usługa niedostępna”', async () => {
  const bad = new FakeAnthropic([sdkError(400, 'image could not be processed')]);
  await assert.rejects(new AnthropicExtractor(bad).extract({ model: 'm', effort: 'low', pages }), (e: unknown) => (e as ProviderError).code === 'rejected');
  assert.equal(bad.requests.length, 1);

  for (const status of [401, 403, 429, 500, 529]) {
    const f = new FakeAnthropic([sdkError(status, 'x')]);
    await assert.rejects(new AnthropicExtractor(f).extract({ model: 'm', effort: 'low', pages }), (e: unknown) => (e as ProviderError).code === 'unavailable', String(status));
  }
  const abort = Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
  await assert.rejects(new AnthropicExtractor(new FakeAnthropic([abort])).extract({ model: 'm', effort: 'low', pages }), (e: unknown) => (e as ProviderError).code === 'timeout');
});

test('błędy nie wyciekają szczegółów serwera do użytkownika', async () => {
  const f = new FakeAnthropic([sdkError(401, 'invalid x-api-key sk-ant-SEKRET')]);
  await assert.rejects(new AnthropicExtractor(f).extract({ model: 'm', effort: 'low', pages }), (e: unknown) => !/SEKRET|sk-ant/.test((e as Error).message));
});

test('parseJsonLenient: markdown, tekst wokół, śmieci', () => {
  assert.deepEqual(parseJsonLenient('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLenient('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLenient('Oto wynik: {"a":{"b":2}} — koniec'), { a: { b: 2 } });
  assert.throws(() => parseJsonLenient('nie ma tu obiektu'), (e: unknown) => (e as ProviderError).code === 'bad_json');
});

test('asystent: niski wysiłek, bez zakazanych parametrów, tekst z bloków', async () => {
  const fake = new FakeAnthropic([{ content: [{ type: 'thinking' }, { type: 'text', text: 'Odpowiedź.' }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 40 }, model: 'claude-haiku-5-5' }]);
  const r = await new AnthropicChat(fake).complete({ model: 'claude-haiku-5-5', system: 'sys', messages: [{ role: 'user', content: 'Jak zdjąć towar?' }] });
  const req = fake.requests[0] as Record<string, any>;
  assert.deepEqual(req.output_config, { effort: 'low' });
  for (const forbidden of ['temperature', 'top_p', 'top_k', 'thinking']) assert.equal(forbidden in req, false);
  assert.equal(r.text, 'Odpowiedź.');
  assert.equal(r.inputTokens, 900);
});
