// ============================================================================
// Potok odczytu: tani model → kontrola kodem → (opcjonalnie) mocniejszy model.
// ============================================================================
// Dla juniora: większość faktur czyta się dobrze najtańszym modelem (ułamek grosza).
// Gdy KOD wykryje problem (suma nie zgadza się, NIP z błędną sumą kontrolną, niska
// pewność), faktura jest czytana drugi raz mocniejszym modelem i wybieramy lepszy wynik.
// Dzięki temu płacimy za „mocny" model tylko wtedy, gdy to naprawdę potrzebne.

import { costMicroUsd } from './cost.ts';
import { needsEscalation, normalizeExtraction, scoreIssues, verifyExtraction, type Issue, type Normalized, type Warning } from './invoice.ts';
import { ProviderError, type Effort, type ExtractionProvider, type PageInput } from './provider.ts';

export type PipelineConfig = {
  fastModel: string;
  strongModel: string;
  fastEffort: Effort;
  strongEffort: Effort;
  /** czy wolno przeczytać drugi raz mocniejszym modelem */
  escalate: boolean;
};

export type Attempt = {
  model: string;
  ok: boolean;
  score: number;
  issues: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  ms: number;
  error?: string;
};

export type PipelineResult = {
  extraction: Normalized;
  issues: Issue[];
  modelUsed: string;
  attempts: Attempt[];
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  escalated: boolean;
};

type Candidate = { extraction: Normalized; issues: Issue[]; score: number; model: string };

export async function runPipeline(
  provider: ExtractionProvider,
  pages: PageInput[],
  cfg: PipelineConfig,
  opts: { now?: () => number; today?: Date; signal?: AbortSignal } = {}
): Promise<PipelineResult> {
  const now = opts.now ?? (() => Date.now());
  const attempts: Attempt[] = [];
  let lastError: unknown = null;

  async function attempt(model: string, effort: Effort): Promise<Candidate | null> {
    const started = now();
    try {
      const r = await provider.extract({ model, effort, pages, signal: opts.signal });
      const extraction = normalizeExtraction(r.json, opts.today);
      const issues = verifyExtraction(extraction);
      const score = scoreIssues(issues);
      attempts.push({
        model: r.model, ok: true, score, issues: issues.length, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
        costMicroUsd: costMicroUsd(r.model, r.inputTokens, r.outputTokens), ms: now() - started,
      });
      return { extraction, issues, score, model: r.model };
    } catch (e) {
      lastError = e;
      attempts.push({
        model, ok: false, score: 0, issues: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, ms: now() - started,
        error: e instanceof ProviderError ? e.code : 'unknown',
      });
      return null;
    }
  }

  const fast = await attempt(cfg.fastModel, cfg.fastEffort);
  // Awaria usługi lub przekroczenie czasu nie jest winą dokumentu — drugi model niczego nie naprawi.
  if (!fast && lastError instanceof ProviderError && (lastError.code === 'unavailable' || lastError.code === 'timeout')) {
    throw lastError;
  }

  let chosen = fast;
  let escalated = false;
  const canEscalate = cfg.escalate && cfg.strongModel !== cfg.fastModel;
  if (canEscalate && (!fast || needsEscalation(fast.issues))) {
    escalated = true;
    const strong = await attempt(cfg.strongModel, cfg.strongEffort);
    // przy remisie wygrywa mocniejszy model; gdy mocniejszy zawiódł — zostaje pierwszy wynik
    if (strong && (!fast || strong.score <= fast.score)) chosen = strong;
  }

  if (!chosen) throw lastError ?? new ProviderError('unavailable', 'Odczyt nie powiódł się.');

  return {
    extraction: chosen.extraction,
    issues: chosen.issues,
    modelUsed: chosen.model,
    attempts,
    inputTokens: attempts.reduce((a, x) => a + x.inputTokens, 0),
    outputTokens: attempts.reduce((a, x) => a + x.outputTokens, 0),
    costMicroUsd: attempts.reduce((a, x) => a + x.costMicroUsd, 0),
    escalated,
  };
}

/**
 * Obiekt dla funkcji bazy apply_document_extraction. W ai_warnings trafiają TYLKO uwagi, których aplikacja
 * nie wyliczy sama (zgłoszone przez model, odrzucone EAN-y, rozbieżności w pozycjach, informacja o drugim
 * odczycie). Sumy i NIP aplikacja sprawdza na bieżąco — inaczej zostałyby „zamrożone" po poprawce użytkownika.
 */
export function toApplyPayload(r: PipelineResult): Record<string, unknown> {
  const e = r.extraction;
  const warnings: Warning[] = [...e.model_warnings, ...e.notes];
  if (r.escalated) warnings.push({ code: 'second_pass', text: 'Dokument został przeczytany drugi raz dokładniejszym modelem AI.' });
  return {
    doc_kind: e.doc_kind,
    supplier_name: e.supplier_name,
    supplier_nip: e.supplier_nip,
    invoice_number: e.invoice_number,
    issue_date: e.issue_date,
    currency: e.currency,
    total_net: e.total_net,
    total_gross: e.total_gross,
    ai_model: r.modelUsed,
    ai_confidence: e.ai_confidence,
    ai_warnings: warnings.slice(0, 30),
    lines: e.lines.map((l) => ({
      raw_name: l.raw_name, qty: l.qty, unit: l.unit, unit_price_net: l.unit_price_net, total_net: l.total_net,
      vat_rate: l.vat_rate, ean: l.ean, skip: l.skip, ai_confidence: l.ai_confidence,
    })),
  };
}
