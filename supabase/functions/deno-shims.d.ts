// Typy „na niby" dla elementów środowiska Deno/Supabase, których TypeScript nie zna poza Deno.
// Używane TYLKO przez `npm run fn:typecheck`; w prawdziwym Deno te deklaracje nie są potrzebne.
declare module 'npm:@anthropic-ai/sdk@*' {
  export default class Anthropic {
    constructor(options: { apiKey: string; maxRetries?: number; timeout?: number });
    messages: {
      create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{
        content: { type: string; text?: string }[];
        stop_reason: string | null;
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
      }>;
    };
  }
}
