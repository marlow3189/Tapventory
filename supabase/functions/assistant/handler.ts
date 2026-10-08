// Asystent AI: odpowiada na pytania „jak to zrobić w Tapventory?" (instrukcja zaszyta po stronie serwera).
// Zabezpieczenia: JWT, członkostwo w firmie, dzienny limit pytań na osobę, ograniczenie długości i liczby wiadomości.

import { costMicroUsd } from '../_shared/cost.ts';
import { HttpError, UUID_RE, bearerToken, errorResponse, json, preflight, readJsonBody } from '../_shared/http.ts';
import { ASSISTANT_SYSTEM_PROMPT } from '../_shared/app-manual.ts';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export interface AssistantDeps {
  auth: { getUserId(token: string): Promise<string | null> };
  db: {
    isMember(tenantId: string, userId: string): Promise<boolean>;
    /** zwiększa dzienny licznik; po przekroczeniu limitu zgłasza HttpError(429) */
    bumpUsage(tenantId: string, userId: string, dailyLimit: number): Promise<void>;
    logUsage(tenantId: string, userId: string, model: string, inputTokens: number, outputTokens: number, costMicroUsd: number, status: 'ok' | 'error'): Promise<void>;
  };
  chat: {
    complete(args: { model: string; system: string; messages: ChatMessage[]; signal?: AbortSignal }): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }>;
  };
  config: { model: string; dailyLimit: number; maxMessages: number; maxChars: number; timeoutMs: number };
}

export function sanitizeMessages(raw: unknown, maxMessages: number, maxChars: number): ChatMessage[] {
  if (!Array.isArray(raw)) throw new HttpError(400, 'bad_request', 'Brak wiadomości.');
  const out: ChatMessage[] = [];
  for (const m of raw.slice(-maxMessages)) {
    const o = (m ?? {}) as Record<string, unknown>;
    const role = o.role === 'assistant' ? 'assistant' : o.role === 'user' ? 'user' : null;
    const content = typeof o.content === 'string' ? o.content.trim().slice(0, maxChars) : '';
    if (role && content) out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();      // rozmowa musi zaczynać się od użytkownika
  if (out.length === 0 || out[out.length - 1].role !== 'user') throw new HttpError(400, 'bad_request', 'Zadaj pytanie.');
  return out;
}

export async function handleAssistant(req: Request, deps: AssistantDeps): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method', 'Użyj metody POST.');
    const token = bearerToken(req);
    const userId = token ? await deps.auth.getUserId(token) : null;
    if (!userId) throw new HttpError(401, 'unauthorized', 'Zaloguj się ponownie.');

    const body = await readJsonBody(req);
    const tenantId = String(body.tenant_id ?? '');
    if (!UUID_RE.test(tenantId)) throw new HttpError(400, 'bad_request', 'Brak firmy.');
    const messages = sanitizeMessages(body.messages, deps.config.maxMessages, deps.config.maxChars);

    if (!(await deps.db.isMember(tenantId, userId))) throw new HttpError(403, 'forbidden', 'Brak dostępu do tej firmy.');
    await deps.db.bumpUsage(tenantId, userId, deps.config.dailyLimit);

    try {
      const r = await deps.chat.complete({
        model: deps.config.model, system: ASSISTANT_SYSTEM_PROMPT, messages, signal: AbortSignal.timeout(deps.config.timeoutMs),
      });
      await deps.db.logUsage(tenantId, userId, r.model, r.inputTokens, r.outputTokens, costMicroUsd(r.model, r.inputTokens, r.outputTokens), 'ok');
      const reply = r.text.trim();
      if (!reply) throw new HttpError(502, 'empty', 'Asystent nie odpowiedział. Spróbuj ponownie.');
      return json({ reply });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      await deps.db.logUsage(tenantId, userId, deps.config.model, 0, 0, 0, 'error').catch(() => {});
      throw new HttpError(502, 'ai_unavailable', 'Asystent jest chwilowo niedostępny. Spróbuj ponownie za chwilę.');
    }
  } catch (e) {
    return errorResponse(e);
  }
}
