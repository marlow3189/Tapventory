// ============================================================================
// process-document: odczyt faktury (zdjęcia / PDF) modelem AI i zapis wyniku w bazie.
// ============================================================================
// Przepływ (każdy krok ma swój powód):
//   1. kto pyta?           — JWT → użytkownik; musi być kierownikiem firmy dokumentu
//   2. czy jest co robić?  — dokument musi być „processing" (powtórne wywołanie jest nieszkodliwe)
//   3. limit planu         — reserve_ai_scan ZANIM wydamy pieniądze na model (atomowo, bez wyścigów)
//   4. odpowiedź 202       — telefon nie czeka na model; resztę robimy „w tle" (EdgeRuntime.waitUntil)
//   5. w tle: pobierz strony → potok AI (tani model, kontrola kodem, ewent. mocniejszy) →
//      apply_document_extraction (jedna transakcja) → finish_ai_scan (koszt do tabeli ai_usage)
//   6. każda awaria        — dokument „failed" z czytelnym komunikatem (+ „Spróbuj ponownie" w aplikacji)
// Logi serwera NIE zawierają treści faktur (dane osobowe) — tylko identyfikatory, kody i liczby.

import { bytesToBase64 } from '../_shared/base64.ts';
import { HttpError, UUID_RE, bearerToken, errorResponse, json, preflight, readJsonBody } from '../_shared/http.ts';
import { runPipeline, toApplyPayload, type PipelineConfig } from '../_shared/pipeline.ts';
import { ProviderError, type ExtractionProvider, type PageInput } from '../_shared/provider.ts';

export type DocumentRow = { id: string; tenant_id: string; status: string; source: string; file_paths: string[] };

export type ScanStatus = 'ok' | 'error' | 'refused';

export interface ProcessDeps {
  auth: { getUserId(token: string): Promise<string | null> };
  db: {
    getDocument(id: string): Promise<DocumentRow | null>;
    isManager(tenantId: string, userId: string): Promise<boolean>;
    /** zwraca id rezerwacji; błędy: 'AI_QUOTA_EXCEEDED', 'AI_ALREADY_PROCESSING' (jako ReserveError) */
    reserveScan(tenantId: string, userId: string, documentId: string): Promise<number>;
    finishScan(usageId: number, model: string, inputTokens: number, outputTokens: number, costMicroUsd: number, status: ScanStatus): Promise<void>;
    applyExtraction(documentId: string, payload: Record<string, unknown>): Promise<{ status: string }>;
    failDocument(documentId: string, message: string): Promise<void>;
  };
  storage: { download(path: string): Promise<{ bytes: Uint8Array; contentType: string | null }> };
  provider: ExtractionProvider;
  config: PipelineConfig & { maxPages: number; maxTotalBytes: number; timeoutMs: number };
  waitUntil(p: Promise<unknown>): void;
  now?: () => number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

export class ReserveError extends Error {
  code: 'AI_QUOTA_EXCEEDED' | 'AI_ALREADY_PROCESSING';
  constructor(code: 'AI_QUOTA_EXCEEDED' | 'AI_ALREADY_PROCESSING') {
    super(code);
    this.code = code;
  }
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function guessType(path: string, declared: string | null): string {
  const d = (declared ?? '').split(';')[0].trim().toLowerCase();
  if (d === 'application/pdf' || IMAGE_TYPES.includes(d)) return d;
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

export async function loadPages(deps: ProcessDeps, paths: string[]): Promise<PageInput[]> {
  if (paths.length === 0) throw new HttpError(400, 'no_pages', 'Dokument nie ma żadnych stron.');
  if (paths.length > deps.config.maxPages) throw new HttpError(400, 'too_many_pages', `Dokument może mieć najwyżej ${deps.config.maxPages} stron.`);
  const pages: PageInput[] = [];
  let total = 0;
  for (const path of paths) {
    let file;
    try {
      file = await deps.storage.download(path);
    } catch {
      throw new HttpError(404, 'file_missing', 'Nie znaleziono pliku dokumentu w magazynie. Dodaj dokument ponownie.');
    }
    total += file.bytes.byteLength;
    if (total > deps.config.maxTotalBytes) throw new HttpError(413, 'too_large', 'Pliki dokumentu są zbyt duże. Zrób mniejsze zdjęcia.');
    const type = guessType(path, file.contentType);
    pages.push(type === 'application/pdf' ? { kind: 'pdf', base64: bytesToBase64(file.bytes) } : { kind: 'image', mediaType: type, base64: bytesToBase64(file.bytes) });
  }
  return pages;
}

function describeFailure(e: unknown): { message: string; status: ScanStatus; code: string } {
  if (e instanceof ProviderError) {
    switch (e.code) {
      case 'refusal':
        return { message: 'Model AI odmówił odczytu tego dokumentu. Wpisz pozycje ręcznie.', status: 'refused', code: e.code };
      case 'truncated':
        return { message: 'Dokument jest zbyt długi, by odczytać go jednorazowo. Podziel go na mniejsze części.', status: 'error', code: e.code };
      case 'bad_json':
        return { message: 'Nie udało się zinterpretować odpowiedzi AI. Spróbuj ponownie.', status: 'error', code: e.code };
      case 'timeout':
        return { message: 'Odczyt trwał zbyt długo. Spróbuj ponownie.', status: 'error', code: e.code };
      case 'rejected':
        return { message: 'Nie udało się odczytać tego pliku. Zrób wyraźniejsze zdjęcie lub wpisz pozycje ręcznie.', status: 'error', code: e.code };
      default:
        return { message: e.message, status: 'error', code: e.code };
    }
  }
  if (e instanceof HttpError) return { message: e.message, status: 'error', code: e.code };
  return { message: 'Odczyt nie powiódł się. Spróbuj ponownie.', status: 'error', code: 'unknown' };
}

export async function handleProcessDocument(req: Request, deps: ProcessDeps): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method', 'Użyj metody POST.');

    const token = bearerToken(req);
    const userId = token ? await deps.auth.getUserId(token) : null;
    if (!userId) throw new HttpError(401, 'unauthorized', 'Zaloguj się ponownie.');

    const body = await readJsonBody(req);
    const documentId = String(body.document_id ?? '');
    if (!UUID_RE.test(documentId)) throw new HttpError(400, 'bad_request', 'Brak poprawnego identyfikatora dokumentu.');

    const doc = await deps.db.getDocument(documentId);
    if (!doc) throw new HttpError(404, 'not_found', 'Nie znaleziono dokumentu.');
    if (!(await deps.db.isManager(doc.tenant_id, userId))) throw new HttpError(403, 'forbidden', 'Faktury odczytuje kierownictwo firmy.');
    if (doc.source !== 'photo') throw new HttpError(400, 'bad_source', 'Ten dokument nie pochodzi ze skanu.');
    if (doc.status !== 'processing') return json({ ok: true, status: doc.status });   // już gotowe — nic do zrobienia

    let usageId: number;
    try {
      usageId = await deps.db.reserveScan(doc.tenant_id, userId, doc.id);
    } catch (e) {
      if (e instanceof ReserveError && e.code === 'AI_ALREADY_PROCESSING') return json({ ok: true, status: 'processing' }, 202);
      if (e instanceof ReserveError && e.code === 'AI_QUOTA_EXCEEDED') {
        await deps.db.failDocument(doc.id, 'Wykorzystano miesięczny limit skanów AI w Twoim planie. Wpisz pozycje ręcznie albo zmień plan.');
        throw new HttpError(429, 'quota', 'Wykorzystano miesięczny limit skanów AI w Twoim planie.');
      }
      throw e;
    }

    const job = async () => {
      const started = (deps.now ?? Date.now)();
      try {
        const pages = await loadPages(deps, doc.file_paths);
        const result = await runPipeline(deps.provider, pages, deps.config, { signal: AbortSignal.timeout(deps.config.timeoutMs) });
        const applied = await deps.db.applyExtraction(doc.id, toApplyPayload(result));
        await deps.db.finishScan(usageId, result.modelUsed, result.inputTokens, result.outputTokens, result.costMicroUsd, 'ok');
        deps.log?.('process-document ok', {
          documentId: doc.id, model: result.modelUsed, escalated: result.escalated, lines: result.extraction.lines.length,
          issues: result.issues.map((i) => i.code), costMicroUsd: result.costMicroUsd, ms: (deps.now ?? Date.now)() - started, applied: applied.status,
        });
      } catch (e) {
        const f = describeFailure(e);
        deps.log?.('process-document failed', { documentId: doc.id, code: f.code });
        try { await deps.db.failDocument(doc.id, f.message); } catch (inner) { deps.log?.('failDocument error', { documentId: doc.id, inner: String(inner) }); }
        try { await deps.db.finishScan(usageId, deps.config.fastModel, 0, 0, 0, f.status); } catch (inner) { deps.log?.('finishScan error', { documentId: doc.id, inner: String(inner) }); }
      }
    };
    deps.waitUntil(job());
    return json({ ok: true, status: 'processing' }, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
