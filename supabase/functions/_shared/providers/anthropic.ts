// Odczyt faktur modelem Claude (Anthropic Messages API) ze structured outputs.
// Klienta (`new Anthropic(...)`) wstrzykuje index.ts — ten plik nie importuje SDK, więc działa też w testach w Node.

import { INVOICE_JSON_SCHEMA } from '../invoice.ts';
import { EXTRACTION_JSON_ONLY_SUFFIX, EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT_IMAGES } from '../prompt.ts';
import { ProviderError, type Effort, type ExtractionProvider, type PageInput, type ProviderResult } from '../provider.ts';

type ContentBlock = { type: string; text?: string };
export type AnthropicResponse = {
  content: ContentBlock[];
  stop_reason: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
};
export type AnthropicLike = {
  messages: { create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<AnthropicResponse> };
};

function pageBlock(p: PageInput): Record<string, unknown> {
  return p.kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } };
}

/** Wyciąga obiekt JSON z tekstu (także gdy model owinął go w ```json … ```). */
export function parseJsonLenient(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new ProviderError('bad_json', 'Odpowiedź modelu nie jest poprawnym JSON.');
  }
}

type SdkErrorLike = { status?: number; name?: string; message?: string };

function mapError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = (e ?? {}) as SdkErrorLike;
  if (err.name === 'AbortError' || /abort|timed? ?out/i.test(`${err.name} ${err.message}`)) {
    return new ProviderError('timeout', 'Odczyt trwał zbyt długo.');
  }
  const status = err.status;
  if (status === 400) return new ProviderError('rejected', err.message ?? 'Żądanie odrzucone.');
  if (status === 401 || status === 403 || status === 404) return new ProviderError('unavailable', 'Usługa AI jest chwilowo niedostępna (konfiguracja serwera).');
  return new ProviderError('unavailable', 'Usługa AI jest chwilowo niedostępna. Spróbuj ponownie za chwilę.');
}

export class AnthropicExtractor implements ExtractionProvider {
  client: AnthropicLike;
  maxTokens: number;
  constructor(client: AnthropicLike, opts: { maxTokens?: number } = {}) {
    this.client = client;
    this.maxTokens = opts.maxTokens ?? 16000;   // miejsce na myślenie (liczy się do limitu) + do ~250 pozycji
  }

  async extract(args: { model: string; effort: Effort; pages: PageInput[]; signal?: AbortSignal }): Promise<ProviderResult> {
    const { model, effort, pages, signal } = args;
    const call = async (structured: boolean): Promise<AnthropicResponse> => {
      const params: Record<string, unknown> = {
        model,
        max_tokens: this.maxTokens,
        system: EXTRACTION_SYSTEM_PROMPT,
        // Uwaga (Claude 5.x): nie wysyłamy temperature/top_p/top_k ani prefillu — zwracają błąd 400.
        output_config: structured
          ? { effort, format: { type: 'json_schema', schema: INVOICE_JSON_SCHEMA } }
          : { effort },
        messages: [
          {
            role: 'user',
            content: [...pages.map(pageBlock), { type: 'text', text: EXTRACTION_USER_PROMPT_IMAGES + (structured ? '' : EXTRACTION_JSON_ONLY_SUFFIX) }],
          },
        ],
      };
      return await this.client.messages.create(params, { signal });
    };

    let res: AnthropicResponse;
    try {
      try {
        res = await call(true);
      } catch (e) {
        const err = (e ?? {}) as SdkErrorLike;
        // Serwer nie przyjął schematu odpowiedzi → jedna próba z prośbą o czysty JSON w tekście.
        if (err.status === 400 && /output_config|json_schema|schema|format/i.test(err.message ?? '')) res = await call(false);
        else throw e;
      }
    } catch (e) {
      throw mapError(e);
    }

    if (res.stop_reason === 'refusal') throw new ProviderError('refusal', 'Model odmówił odczytu tego dokumentu.');
    if (res.stop_reason === 'max_tokens') throw new ProviderError('truncated', 'Odpowiedź modelu została ucięta (zbyt długi dokument).');

    // Treść czytamy po typie bloku: odpowiedź może zaczynać się od bloków „thinking".
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    if (!text.trim()) throw new ProviderError('bad_json', 'Model nie zwrócił treści.');

    return {
      json: parseJsonLenient(text),
      model: res.model ?? model,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    };
  }
}
