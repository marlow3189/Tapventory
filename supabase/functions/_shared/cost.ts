// Koszt wywołania modelu w milionowych częściach dolara (micro-USD) — do tabeli ai_usage.
// Ceny za 1 mln tokenów (USD), z cennika Anthropic na dzień budowy; sprawdź przed zmianą modelu:
// https://platform.claude.com/docs/en/about-claude/pricing
// Wzór: tokeny × cena_za_MTok = micro-USD (bo 1 USD = 1 000 000 micro-USD, a cena jest „za milion").

type Price = { input: number; output: number; longInput?: number; longOutput?: number };

const PRICES: Record<string, Price> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, longInput: 0.5, longOutput: 2.5 },   // dłuższy prompt (>100K) drożej
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-fable-5-1': { input: 10, output: 50 },
};
const FALLBACK: Price = PRICES['claude-sonnet-5-5'];   // nieznany model: wyceniamy ostrożnie (jak Sonnet)

export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? FALLBACK;
  const long = inputTokens > 100_000 && p.longInput !== undefined;
  const inRate = long ? (p.longInput as number) : p.input;
  const outRate = long ? (p.longOutput as number) : p.output;
  return Math.round(inputTokens * inRate + outputTokens * outRate);
}
