// Wspólne pomocniki HTTP dla wszystkich funkcji: CORS, odpowiedzi JSON, błędy po polsku.
// Aplikacja (src/lib/api/functions.ts) czyta błędy w kształcie { error: { code, message } }.

export const corsHeaders: Record<string, string> = {
  // Autoryzacja idzie nagłówkiem Bearer (nie ciasteczkami), więc „*" jest bezpieczne.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message } }, e.status);
  return json({ error: { code: 'internal', message: 'Wystąpił błąd serwera. Spróbuj ponownie za chwilę.' } }, 500);
}

export const preflight = (req: Request): Response | null =>
  req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: corsHeaders }) : null;

export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // niżej zgłaszamy czytelny błąd
  }
  throw new HttpError(400, 'bad_request', 'Nieprawidłowe dane żądania.');
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
