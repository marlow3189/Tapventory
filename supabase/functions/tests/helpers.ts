// Wspólne dane i atrapy do testów funkcji.
import type { AnthropicLike, AnthropicResponse } from '../_shared/providers/anthropic.ts';
import type { ExtractionProvider, ProviderResult } from '../_shared/provider.ts';

export const TODAY = new Date('2026-10-08T12:00:00Z');

/** Poprawna odpowiedź modelu (format zgodny ze schematem). */
export const goodInvoiceJson = () => ({
  document_kind: 'invoice',
  supplier: { name: 'Hurtownia ABC Sp. z o.o.', nip: '5260250995' },
  invoice: { number: 'FV/2026/10/0451', issue_date: '2026-10-05', currency: 'PLN' },
  totals: { net: 160.5, vat: 36.92, gross: 197.42 },
  lines: [
    { name: 'Rękawice nitrylowe L', quantity: 3, unit: 'op.', unit_price_net: 24.5, total_net: 73.5, vat_rate: 23, ean: null, is_stock_item: true, confidence: 96 },
    { name: 'Płyn do szyb zimowy 5L', quantity: 4, unit: 'szt.', unit_price_net: 18, total_net: 72, vat_rate: 23, ean: null, is_stock_item: true, confidence: 88 },
    { name: 'Transport', quantity: 1, unit: 'usł.', unit_price_net: 15, total_net: 15, vat_rate: 23, ean: null, is_stock_item: false, confidence: 70 },
  ],
  warnings: [],
  overall_confidence: 92,
});

/** Odpowiedź z błędem: suma pozycji nie zgadza się z sumą na fakturze. */
export const badInvoiceJson = () => ({ ...goodInvoiceJson(), totals: { net: 999, vat: 36.92, gross: 197.42 } });

type Step = { json?: unknown; error?: Error; tokens?: [number, number]; delayMs?: number };

/** Dostawca odczytu, który odpowiada kolejno według scenariusza i zapamiętuje wywołania. */
export class ScriptedProvider implements ExtractionProvider {
  calls: { model: string; effort: string; pages: number }[] = [];
  i = 0;
  steps: Step[];
  constructor(steps: Step[]) {
    this.steps = steps;
  }
  async extract(args: { model: string; effort: 'low' | 'medium' | 'high'; pages: unknown[] }): Promise<ProviderResult> {
    this.calls.push({ model: args.model, effort: args.effort, pages: args.pages.length });
    const s = this.steps[Math.min(this.i++, this.steps.length - 1)];
    if (s.delayMs) await new Promise((r) => setTimeout(r, s.delayMs));
    if (s.error) throw s.error;
    return { json: s.json, model: args.model, inputTokens: s.tokens?.[0] ?? 3000, outputTokens: s.tokens?.[1] ?? 800 };
  }
}

/** Atrapa klienta Anthropic: zapamiętuje parametry żądań i zwraca kolejne odpowiedzi/błędy. */
export class FakeAnthropic implements AnthropicLike {
  requests: Record<string, unknown>[] = [];
  i = 0;
  outcomes: (AnthropicResponse | Error)[];
  constructor(outcomes: (AnthropicResponse | Error)[]) {
    this.outcomes = outcomes;
  }
  messages = {
    create: async (params: Record<string, unknown>) => {
      this.requests.push(params);
      const o = this.outcomes[Math.min(this.i++, this.outcomes.length - 1)];
      if (o instanceof Error) throw o;
      return o;
    },
  };
}

export const textResponse = (obj: unknown, extra: Partial<AnthropicResponse> = {}): AnthropicResponse => ({
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 2500, output_tokens: 700 },
  model: 'claude-haiku-5-5',
  ...extra,
});

export const sdkError = (status: number, message: string) => Object.assign(new Error(message), { status, name: 'APIError' });
