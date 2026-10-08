import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useTenant } from '../tenant';
import { useAuth } from '../auth';
import { uuidv7 } from '../uuid';
import { unwrap } from './common';
import { OPEN_STATUSES, type RequestStatus } from '../status';
import type { EventRow, MessageRow, RequestFeedRow } from '../types';

const PAGE = 15;
export type FeedFilter = 'all' | 'open' | 'mine';

export function useRequestFeed(filter: FeedFilter) {
  const { tenantId } = useTenant();
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: ['requests', tenantId, filter, user?.id],
    enabled: Boolean(tenantId && user),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from('request_feed')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + PAGE - 1);
      if (filter === 'open') q = q.in('status', OPEN_STATUSES);
      if (filter === 'mine') q = q.eq('reporter_id', user!.id);
      return unwrap(await q) as RequestFeedRow[];
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
}

export function useRequest(id: string | undefined) {
  return useQuery({
    queryKey: ['request', id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.from('request_feed').select('*').eq('id', id!).single()) as RequestFeedRow,
  });
}

export function useRequestMessages(id: string | undefined) {
  return useQuery({
    queryKey: ['messages', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabase.from('request_message_feed').select('*').eq('request_id', id!).order('created_at', { ascending: true })) as MessageRow[],
  });
}

export function useRequestEvents(id: string | undefined) {
  return useQuery({
    queryKey: ['events', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabase.from('request_event_feed').select('*').eq('request_id', id!).order('id', { ascending: true })) as EventRow[],
  });
}

export type NewRequest = {
  product_id?: string | null;
  free_name?: string | null;
  qty?: number | null;
  note?: string | null;
  photo_path?: string | null;
  project_id?: string | null;
  id?: string;
};

function useInvalidateRequests() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['requests', 'request', 'events', 'dashboard', 'messages']) qc.invalidateQueries({ queryKey: [k] });
  };
}

export function useCreateRequest() {
  const { tenantId } = useTenant();
  const done = useInvalidateRequests();
  return useMutation({
    mutationFn: async (r: NewRequest): Promise<string> => {
      const id = r.id ?? uuidv7();
      const { error } = await supabase.from('requests').upsert(
        {
          id,
          tenant_id: tenantId!,
          product_id: r.product_id ?? null,
          free_name: r.free_name?.trim() || null,
          qty: r.qty ?? null,
          note: r.note?.trim() || null,
          photo_path: r.photo_path ?? null,
          project_id: r.project_id ?? null,
        },
        { onConflict: 'id', ignoreDuplicates: true }
      );
      if (error) throw error;
      return id;
    },
    onSuccess: done,
  });
}

export function useSetRequestStatus() {
  const done = useInvalidateRequests();
  return useMutation({
    mutationFn: async (i: { id: string; to: RequestStatus; supplierId?: string | null }) => {
      const patch: Record<string, unknown> = { status: i.to };
      if (i.supplierId) patch.supplier_id = i.supplierId;
      const { error } = await supabase.from('requests').update(patch).eq('id', i.id);
      if (error) throw error;
    },
    onSuccess: done,
  });
}

export function useSendMessage() {
  const { tenantId } = useTenant();
  const done = useInvalidateRequests();
  return useMutation({
    mutationFn: async (i: { requestId: string; body: string }) => {
      const body = i.body.trim();
      if (!body) return;
      const { error } = await supabase
        .from('request_messages')
        .insert({ id: uuidv7(), tenant_id: tenantId!, request_id: i.requestId, body });
      if (error) throw error;
    },
    onSuccess: done,
  });
}

export function useToggleVote() {
  const { tenantId } = useTenant();
  const { user } = useAuth();
  const done = useInvalidateRequests();
  return useMutation({
    mutationFn: async (i: { requestId: string; voted: boolean }) => {
      if (i.voted) {
        const { error } = await supabase.from('request_votes').delete().eq('request_id', i.requestId).eq('user_id', user!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('request_votes')
          .insert({ request_id: i.requestId, tenant_id: tenantId!, user_id: user!.id });
        if (error) throw error;
      }
    },
    onSuccess: done,
  });
}
