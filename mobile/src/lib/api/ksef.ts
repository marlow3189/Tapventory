// Połączenie z KSeF: stan, łączenie tokenem, ręczna synchronizacja, odłączenie.
// Sekret (token) nigdy nie jest zapisywany w aplikacji — wędruje tylko do funkcji `ksef-connect`.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useTenant } from '../tenant';
import { unwrap } from './common';
import { invokeFunction } from './functions';
import type { KsefEnv, KsefStatus } from '../ksef';

const KEY = 'ksef';
const DATA_KEYS = ['documents', 'document', 'dashboard', 'notifications'];

export function useKsefStatus() {
  const { tenantId, isManager } = useTenant();
  const qc = useQueryClient();
  return useQuery({
    queryKey: [KEY, tenantId],
    enabled: Boolean(tenantId && isManager),
    staleTime: 10_000,
    // dopóki serwer pracuje, dopytujemy co kilka sekund
    refetchInterval: (q) => (q.state.data?.running ? 4000 : false),
    queryFn: async () => {
      const was = qc.getQueryData<KsefStatus>([KEY, tenantId])?.running;
      const next = unwrap(await supabase.rpc('get_ksef_status', { p_tenant: tenantId! })) as KsefStatus;
      if (was && !next.running) for (const k of DATA_KEYS) qc.invalidateQueries({ queryKey: [k] });   // praca skończona → nowe faktury na listach
      return next;
    },
  });
}

export function useConnectKsef() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { token: string; environment: KsefEnv; importFrom: string; nip?: string }) =>
      invokeFunction<{ ok: true; status: 'connected'; sync: 'started' | 'pending' }>('ksef-connect', {
        tenant_id: tenantId, token: a.token, environment: a.environment, import_from: a.importFrom, ...(a.nip ? { nip: a.nip } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useSyncKsef() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invokeFunction<{ ok: true; status: 'started' | 'running' }>('ksef-sync', { tenant_id: tenantId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDisconnectKsef() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('disconnect_ksef', { p_tenant: tenantId! });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
