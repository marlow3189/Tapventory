// ============================================================================
// Warstwa „klej" dla środowiska Supabase Edge (Deno): klienci, zmienne środowiskowe, adaptery.
// Tylko tu wolno importować pakiety npm:… — reszta kodu jest czysta i testowana w Node.
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk@0.127.0';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { HttpError } from './http.ts';
import { AnthropicExtractor } from './providers/anthropic.ts';
import { AnthropicChat } from './providers/anthropic-chat.ts';
import type { Effort } from './provider.ts';
import { ReserveError, type ProcessDeps } from '../process-document/handler.ts';
import type { AssistantDeps } from '../assistant/handler.ts';
import type { BarcodeDeps } from '../barcode-lookup/handler.ts';
import type { PushDeps } from '../send-push/handler.ts';
import type { ConnectDeps } from '../ksef-connect/handler.ts';
import type { KsefSyncDeps } from '../ksef-sync/handler.ts';
import { KsefClient } from './ksef/client.ts';
import { claimSync, executeSync, startDueSyncs, type SyncDeps } from './ksef/sync.ts';
import { VaultError, openToken, parseKeyList, sealToken } from './ksef/token-vault.ts';

declare const Deno: { env: { get(name: string): string | undefined } };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

export const env = (name: string, fallback?: string): string => {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined || v === '') throw new HttpError(500, 'not_configured', `Brak zmiennej środowiskowej ${name} (patrz supabase/functions/README.md).`);
  return v;
};

export function adminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
type Admin = ReturnType<typeof adminClient>;

export const waitUntil = (p: Promise<unknown>): void => {
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
  else void p;   // lokalnie / w testach: zadanie i tak się wykona
};

const log = (message: string, extra?: Record<string, unknown>) => console.log(JSON.stringify({ message, ...extra }));

function userAuth(admin: Admin) {
  return {
    async getUserId(token: string): Promise<string | null> {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
  };
}

const effort = (name: string, fallback: Effort): Effort => {
  const v = Deno.env.get(name);
  return v === 'low' || v === 'medium' || v === 'high' ? v : fallback;
};

export function buildProcessDeps(): ProcessDeps {
  const admin = adminClient();
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), maxRetries: 2, timeout: 110_000 });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw error;
    return data;
  };
  return {
    auth: userAuth(admin),
    db: {
      async getDocument(id) {
        const { data, error } = await admin.from('documents').select('id, tenant_id, status, source, file_paths').eq('id', id).maybeSingle();
        if (error) throw error;
        return data;
      },
      async isManager(tenantId, userId) {
        const { data, error } = await admin.from('memberships').select('role').eq('tenant_id', tenantId).eq('user_id', userId).in('role', ['owner', 'manager']).maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
      async reserveScan(tenantId, userId, documentId) {
        const { data, error } = await admin.rpc('reserve_ai_scan', { p_tenant: tenantId, p_user: userId, p_document: documentId });
        if (error) {
          if (error.message.includes('AI_QUOTA_EXCEEDED')) throw new ReserveError('AI_QUOTA_EXCEEDED');
          if (error.message.includes('AI_ALREADY_PROCESSING')) throw new ReserveError('AI_ALREADY_PROCESSING');
          throw error;
        }
        return Number(data);
      },
      async finishScan(usageId, model, inputTokens, outputTokens, costMicroUsd, status) {
        await rpc('finish_ai_scan', { p_usage: usageId, p_model: model, p_input: inputTokens, p_output: outputTokens, p_cost_micro_usd: costMicroUsd, p_status: status });
      },
      async applyExtraction(documentId, payload) {
        return (await rpc('apply_document_extraction', { p_document: documentId, p_extraction: payload })) as { status: string };
      },
      async failDocument(documentId, message) {
        await rpc('fail_document', { p_document: documentId, p_message: message });
      },
    },
    storage: {
      async download(path) {
        const { data, error } = await admin.storage.from('documents').download(path);
        if (error || !data) throw error ?? new Error('brak pliku');
        return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || null };
      },
    },
    provider: new AnthropicExtractor(anthropic),
    config: {
      fastModel: env('AI_MODEL_FAST', 'claude-haiku-5-5'),
      strongModel: env('AI_MODEL_STRONG', 'claude-sonnet-5-5'),
      fastEffort: effort('AI_EFFORT_FAST', 'medium'),
      strongEffort: effort('AI_EFFORT_STRONG', 'high'),
      escalate: (Deno.env.get('AI_ESCALATE') ?? 'true') !== 'false',
      maxPages: 10,
      maxTotalBytes: 24 * 1024 * 1024,
      timeoutMs: Number(Deno.env.get('AI_TIMEOUT_MS') ?? 120_000),
    },
    waitUntil,
    log,
  };
}

export function buildAssistantDeps(): AssistantDeps {
  const admin = adminClient();
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), maxRetries: 1, timeout: 50_000 });
  return {
    auth: userAuth(admin),
    db: {
      async isMember(tenantId, userId) {
        const { data, error } = await admin.from('memberships').select('id').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
      async bumpUsage(tenantId, userId, dailyLimit) {
        const { error } = await admin.rpc('bump_assistant_usage', { p_tenant: tenantId, p_user: userId, p_daily_limit: dailyLimit });
        if (error) {
          if (/limit pytań/i.test(error.message)) throw new HttpError(429, 'quota', error.message);
          throw error;
        }
      },
      async logUsage(tenantId, userId, model, inputTokens, outputTokens, costMicroUsd, status) {
        const { error } = await admin.from('ai_usage').insert({
          tenant_id: tenantId, user_id: userId, kind: 'assistant', model, input_tokens: inputTokens, output_tokens: outputTokens,
          cost_micro_usd: costMicroUsd, status, finished_at: new Date().toISOString(),
        });
        if (error) throw error;
      },
    },
    chat: new AnthropicChat(anthropic),
    config: { model: env('AI_MODEL_ASSISTANT', 'claude-haiku-5-5'), dailyLimit: Number(Deno.env.get('ASSISTANT_DAILY_LIMIT') ?? 30), maxMessages: 10, maxChars: 1000, timeoutMs: 45_000 },
  };
}

export function buildBarcodeDeps(): BarcodeDeps {
  const admin = adminClient();
  return {
    auth: userAuth(admin),
    cache: {
      async get(ean) {
        const { data, error } = await admin.from('barcode_cache').select('*').eq('ean', ean).maybeSingle();
        if (error) throw error;
        return data;
      },
      async put(row) {
        const { error } = await admin.from('barcode_cache').upsert({ ...row, fetched_at: new Date().toISOString() });
        if (error) throw error;
      },
    },
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    userAgent: env('BARCODE_USER_AGENT', 'Tapventory/1.0 (kontakt@tapventory.com)'),
  };
}

export function buildPushDeps(): PushDeps {
  const admin = adminClient();
  return {
    db: {
      async fetchUnsent(limit) {
        const { data, error } = await admin
          .from('notifications').select('id, user_id, kind, title, body, data')
          .eq('push', true).is('push_sent_at', null).order('created_at', { ascending: true }).limit(limit);
        if (error) throw error;
        return data ?? [];
      },
      async tokensFor(userIds) {
        const { data, error } = await admin.from('push_tokens').select('user_id, token').in('user_id', userIds);
        if (error) throw error;
        return data ?? [];
      },
      async markSent(ids) {
        const { error } = await admin.from('notifications').update({ push_sent_at: new Date().toISOString() }).in('id', ids);
        if (error) throw error;
      },
      async deleteTokens(tokens) {
        const { error } = await admin.from('push_tokens').delete().in('token', tokens);
        if (error) throw error;
      },
    },
    fetch: (url, init) => fetch(url, init),
    expoAccessToken: Deno.env.get('EXPO_ACCESS_TOKEN'),
  };
}

export const cronSecret = (): string | undefined => Deno.env.get('CRON_SECRET');

// --- KSeF ---------------------------------------------------------------------------------------

/** Klucze szyfrujące token (pierwszy = do zapisu, kolejne = tylko do odczytu starych zapisów). */
function ksefKeys(): string[] {
  const v = Deno.env.get('KSEF_TOKEN_KEY');
  if (!v) throw new VaultError('bad_key', 'Brak zmiennej środowiskowej KSEF_TOKEN_KEY.');
  return parseKeyList(v);
}

function ksefSyncCore(admin: Admin): SyncDeps & { db: SyncDeps['db'] & { dueTenants(limit: number): Promise<string[]> } } {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw error;
    return data;
  };
  return {
    db: {
      async claim(tenantId, trigger) {
        return (await rpc('claim_ksef_sync', { p_tenant: tenantId, p_trigger: trigger })) as Awaited<ReturnType<SyncDeps['db']['claim']>>;
      },
      async knownNumbers(tenantId, numbers) {
        return ((await rpc('ksef_known_numbers', { p_tenant: tenantId, p_numbers: numbers })) as string[] | null) ?? [];
      },
      async importInvoice(tenantId, ksefNumber, payload, xml, sha256) {
        return (await rpc('import_ksef_invoice', { p_tenant: tenantId, p_ksef_number: ksefNumber, p_invoice: payload, p_xml: xml, p_xml_sha256: sha256 })) as
          { status: 'created' | 'linked' | 'exists'; document_id: string };
      },
      async finish(a) {
        await rpc('finish_ksef_sync', {
          p_run: a.runId, p_status: a.status, p_listed: a.listed, p_imported: a.imported, p_linked: a.linked, p_skipped: a.skipped,
          p_failed: a.failed, p_error: a.error, p_cursor: a.cursor, p_auth_failed: a.authFailed, p_retry_after_sec: a.retryAfterSec,
        });
      },
      async dueTenants(limit) {
        return ((await rpc('due_ksef_tenants', { p_limit: limit })) as { tenant_id: string }[] | null ?? []).map((r) => r.tenant_id);
      },
    },
    openToken: (ciphertext, tenantId) => openToken(ciphertext, ksefKeys(), tenantId),
    makeApi: (environment) => new KsefClient({ environment, fetch: (url, init) => fetch(url, init) }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log,
  };
}

export function buildKsefSyncDeps(): KsefSyncDeps {
  const admin = adminClient();
  return {
    auth: userAuth(admin),
    db: {
      async isManager(tenantId, userId) {
        const { data, error } = await admin.from('memberships').select('role').eq('tenant_id', tenantId).eq('user_id', userId).in('role', ['owner', 'manager']).maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
    },
    sync: ksefSyncCore(admin),
    waitUntil,
  };
}

export function buildKsefConnectDeps(): ConnectDeps {
  const admin = adminClient();
  const core = ksefSyncCore(admin);
  return {
    auth: userAuth(admin),
    db: {
      async getTenant(id) {
        const { data, error } = await admin.from('tenants').select('id, nip').eq('id', id).maybeSingle();
        if (error) throw error;
        return data;
      },
      async isOwner(tenantId, userId) {
        const { data, error } = await admin.from('memberships').select('role').eq('tenant_id', tenantId).eq('user_id', userId).eq('role', 'owner').maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
      async saveConnection(a) {
        const { error } = await admin.rpc('save_ksef_connection', {
          p_tenant: a.tenantId, p_user: a.userId, p_environment: a.environment, p_nip: a.nip,
          p_ciphertext: a.ciphertext, p_hint: a.hint, p_import_from: a.importFrom,
        });
        if (error) throw error;
      },
    },
    sealToken: (plain, tenantId) => sealToken(plain, ksefKeys(), tenantId),
    makeApi: core.makeApi,
    async startFirstSync(tenantId) {
      const claim = await claimSync(core, tenantId, 'connect');
      if (!claim.claimed) return false;
      waitUntil(executeSync(core, tenantId, claim));
      return true;
    },
    now: () => Date.now(),
    log,
  };
}

/** Dla harmonogramu: uruchamia automatyczne synchronizacje firm, którym się należą. */
export function buildCronKsef(): { startDue(): Promise<unknown> } {
  const core = ksefSyncCore(adminClient());
  return { startDue: () => startDueSyncs(core, waitUntil, 3) };
}
