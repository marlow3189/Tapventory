// Rdzeń uruchamiania zestawu ewaluacyjnego: wczytanie przypadków z dysku, konfiguracje modeli, pętla z równoległością.
// Używa PRAWDZIWEGO kodu produkcyjnego (runPipeline + kontrole) — mierzymy to, co naprawdę zadziała w aplikacji.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runPipeline, type PipelineConfig } from '../supabase/functions/_shared/pipeline.ts';
import { ProviderError, type Effort, type ExtractionProvider, type PageInput } from '../supabase/functions/_shared/provider.ts';
import { bytesToBase64 } from '../supabase/functions/_shared/base64.ts';
import type { Expected } from './cases.ts';
import type { EvalMeta, RunResult } from './report.ts';
import { failedRunScore, scoreCase } from './score.ts';

export interface EvalConfig extends PipelineConfig {
  name: string;
}

export const DEFAULT_CONFIGS: EvalConfig[] = [
  { name: 'haiku', fastModel: 'claude-haiku-5-5', strongModel: 'claude-haiku-5-5', fastEffort: 'medium', strongEffort: 'medium', escalate: false },
  { name: 'sonnet', fastModel: 'claude-sonnet-5-5', strongModel: 'claude-sonnet-5-5', fastEffort: 'high', strongEffort: 'high', escalate: false },
  { name: 'opus', fastModel: 'claude-opus-5-5', strongModel: 'claude-opus-5-5', fastEffort: 'high', strongEffort: 'high', escalate: false },
  { name: 'pipeline', fastModel: 'claude-haiku-5-5', strongModel: 'claude-sonnet-5-5', fastEffort: 'medium', strongEffort: 'high', escalate: true },
];

export const describeConfig = (c: EvalConfig) =>
  c.escalate ? `${c.fastModel} (${c.fastEffort}) → ${c.strongModel} (${c.strongEffort}) przy problemach` : `${c.fastModel} (${c.fastEffort})`;

export interface LoadedCase {
  id: string;
  category: string;
  note: string;
  files: string[];
  dir: string;
  expected: Expected;
}

export function loadCases(dataDir: string): LoadedCase[] {
  const manifest = JSON.parse(readFileSync(path.join(dataDir, 'manifest.json'), 'utf8')) as { id: string }[];
  return manifest.map((m) => {
    const dir = path.join(dataDir, m.id);
    const c = JSON.parse(readFileSync(path.join(dir, 'case.json'), 'utf8')) as Omit<LoadedCase, 'dir'>;
    return { ...c, dir };
  });
}

const MEDIA: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export function loadPages(c: LoadedCase): PageInput[] {
  return c.files.map((f) => {
    const bytes = new Uint8Array(readFileSync(path.join(c.dir, f)));
    const ext = path.extname(f).toLowerCase();
    return ext === '.pdf' ? { kind: 'pdf', base64: bytesToBase64(bytes) } : { kind: 'image', mediaType: MEDIA[ext] ?? 'image/jpeg', base64: bytesToBase64(bytes) };
  });
}

export interface RunOptions {
  cases: LoadedCase[];
  configs: EvalConfig[];
  providerFor: (c: LoadedCase) => ExtractionProvider;
  pagesFor?: (c: LoadedCase) => PageInput[];
  concurrency?: number;
  usdPln?: number;
  dry?: boolean;
  today?: Date;
  timeoutMs?: number;
  onProgress?: (done: number, total: number, r: RunResult) => void;
  now?: () => number;
}

export async function runEval(o: RunOptions): Promise<{ meta: EvalMeta; runs: RunResult[] }> {
  const pagesFor = o.pagesFor ?? loadPages;
  const jobs = o.configs.flatMap((config) => o.cases.map((c) => ({ config, c })));
  const runs: RunResult[] = new Array(jobs.length);
  const pageCache = new Map<string, PageInput[]>();
  let next = 0;
  let done = 0;
  const now = o.now ?? Date.now;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      const { config, c } = jobs[i];
      if (!pageCache.has(c.id)) pageCache.set(c.id, pagesFor(c));
      const started = now();
      let result: RunResult;
      try {
        const r = await runPipeline(o.providerFor(c), pageCache.get(c.id) as PageInput[], config, { today: o.today, signal: AbortSignal.timeout(o.timeoutMs ?? 240_000) });
        result = {
          config: config.name, caseId: c.id, category: c.category, ok: true, modelUsed: r.modelUsed, escalated: r.escalated, costMicroUsd: r.costMicroUsd,
          inputTokens: r.inputTokens, outputTokens: r.outputTokens, ms: now() - started, issueCodes: r.issues.map((x) => x.code), score: scoreCase(c.expected, r.extraction, r.issues),
        };
      } catch (e) {
        result = {
          config: config.name, caseId: c.id, category: c.category, ok: false, error: e instanceof ProviderError ? e.code : e instanceof Error ? e.message.slice(0, 120) : 'błąd',
          costMicroUsd: 0, inputTokens: 0, outputTokens: 0, ms: now() - started, issueCodes: [], score: failedRunScore(c.expected),
        };
      }
      runs[i] = result;
      o.onProgress?.(++done, jobs.length, result);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 3) }, worker));

  const meta: EvalMeta = {
    createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '), usdPln: o.usdPln ?? 3.75, dry: Boolean(o.dry), caseCount: o.cases.length,
    configs: Object.fromEntries(o.configs.map((c) => [c.name, describeConfig(c)])),
  };
  return { meta, runs };
}

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];
