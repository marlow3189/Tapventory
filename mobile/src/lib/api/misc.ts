import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useTenant } from '../tenant';
import { useAuth } from '../auth';
import { unwrap } from './common';
import { uuidv7 } from '../uuid';
import type { DashboardSummary } from '../stories';
import type { NotificationRow } from '../types';

// ---- Pulpit ---------------------------------------------------------------
export function useDashboard() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['dashboard', tenantId],
    enabled: Boolean(tenantId),
    staleTime: 15_000,
    queryFn: async () => unwrap(await supabase.rpc('dashboard_summary', { p_tenant: tenantId! })) as DashboardSummary,
  });
}

// ---- Powiadomienia --------------------------------------------------------
export function useNotifications() {
  const { tenantId } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', tenantId, user?.id],
    enabled: Boolean(tenantId && user),
    queryFn: async () =>
      unwrap(await supabase.from('notifications').select('*').eq('tenant_id', tenantId!).order('created_at', { ascending: false }).limit(60)) as NotificationRow[],
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ---- Mini-inwentaryzacje --------------------------------------------------
export type CountCandidate = {
  product_id: string; name: string; unit: string; photo_path: string | null;
  expected_qty: number | string; last_counted_at: string | null;
};

export function useCountCandidates(limit?: number) {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['count-candidates', tenantId, limit],
    enabled: Boolean(tenantId),
    queryFn: async () =>
      unwrap(await supabase.rpc('next_count_candidates', { p_tenant: tenantId!, p_limit: limit ?? null })) as CountCandidate[],
  });
}

export type CountResult = { expected: number | string; counted: number | string; diff: number | string; movement_id: string | null; repeated: boolean };

export function useRecordCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { productId: string; counted: number; source: 'scheduled' | 'on_take' | 'manual'; id?: string }) =>
      unwrap(await supabase.rpc('record_stock_check', {
        p_product: i.productId, p_counted: i.counted, p_source: i.source, p_id: i.id ?? uuidv7(),
      })) as CountResult,
    onSuccess: () => {
      for (const k of ['products', 'product', 'movements', 'dashboard', 'count-candidates']) qc.invalidateQueries({ queryKey: [k] });
    },
  });
}

/** Czy po „Zdejmij" zapytać „ile zostało?" (zaległy produkt + dzienny limit pytań). */
export async function shouldAskCount(productId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('should_ask_count', { p_product: productId });
  if (error) return false;
  return Boolean(data);
}

// ---- Ustawienia firmy -----------------------------------------------------
export type TenantSettings = {
  count_frequency: 'off' | 'weekly' | 'biweekly';
  count_batch_size: number;
  count_question_cap: number;
  count_stale_days: number;
  low_stock_push: boolean;
};

export function useSettings() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['settings', tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => unwrap(await supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId!).single()) as TenantSettings,
  });
}

export function useUpdateSettings() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<TenantSettings>) => {
      const { error } = await supabase.from('tenant_settings').update(patch).eq('tenant_id', tenantId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ---- Firma i konto --------------------------------------------------------
export async function createTenant(name: string, nip: string | null, industry: string | null): Promise<string> {
  return unwrap(await supabase.rpc('create_tenant', { p_name: name, p_nip: nip, p_industry: industry })) as string;
}

export async function setTenantNip(tenantId: string, nip: string | null) {
  const { error } = await supabase.rpc('set_tenant_nip', { p_tenant: tenantId, p_nip: nip });
  if (error) throw error;
}

export async function updateTenantContact(tenantId: string, patch: { name?: string; city?: string | null; address_line?: string | null; postal_code?: string | null; industry?: string | null }) {
  const { error } = await supabase.from('tenants').update(patch).eq('id', tenantId);
  if (error) throw error;
}

export async function deleteTenant(tenantId: string, confirmName: string) {
  const { error } = await supabase.rpc('delete_tenant', { p_tenant: tenantId, p_confirm_name: confirmName });
  if (error) throw error;
}

export async function deleteAccount() {
  const { error } = await supabase.rpc('delete_account');
  if (error) throw error;
}

export function useAiQuota() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['ai-quota', tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => unwrap(await supabase.rpc('ai_quota', { p_tenant: tenantId! })) as { plan: string; limit: number | null; used: number; remaining: number; resets_at: string },
  });
}

/** Zmiana wyświetlanej nazwy (widocznej dla zespołu w komentarzach i historii). */
export async function updateDisplayName(userId: string, name: string) {
  const n = name.trim();
  if (n.length < 2) throw { message: 'Imię musi mieć co najmniej 2 znaki.' };
  const { error } = await supabase.from('profiles').update({ display_name: n }).eq('id', userId);
  if (error) throw error;
  await supabase.auth.updateUser({ data: { display_name: n } });   // żeby pasek zakładek pokazał nowe inicjały
}
