// Krótkie rozmowy (asystent) przez Claude. Klienta wstrzykuje index.ts (ten plik nie importuje SDK).
import type { AnthropicLike } from './anthropic.ts';

export class AnthropicChat {
  client: AnthropicLike;
  constructor(client: AnthropicLike) {
    this.client = client;
  }

  async complete(args: { model: string; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; signal?: AbortSignal }) {
    const res = await this.client.messages.create(
      {
        model: args.model,
        max_tokens: 2000,                       // myślenie liczy się do limitu — zostawiamy zapas na krótką odpowiedź
        system: args.system,
        output_config: { effort: 'low' },       // proste pytania: niski wysiłek = szybciej i taniej
        messages: args.messages,
      },
      { signal: args.signal }
    );
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    return {
      text,
      model: res.model ?? args.model,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    };
  }
}
