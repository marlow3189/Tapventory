// Aktywna firma użytkownika (jedna osoba może należeć do kilku firm).
// Wybór pamiętamy w pamięci urządzenia. Rola decyduje, co pokazujemy w interfejsie —
// ale to BAZA (RLS) naprawdę pilnuje uprawnień; ukrycie przycisku to tylko wygoda.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from './auth';
import type { Membership, Role } from './types';

const KEY = 'tv.activeTenant';

type TenantContextValue = {
  loading: boolean;
  error: Error | null;
  memberships: Membership[];
  membership: Membership | null;
  tenantId: string | null;
  tenantName: string;
  role: Role | null;
  isOwner: boolean;
  isManager: boolean;
  canBilling: boolean;
  setActiveTenant: (id: string) => void;
  refetch: () => Promise<unknown>;
};

const noop = async () => {};
const TenantContext = createContext<TenantContextValue>({
  loading: true, error: null, memberships: [], membership: null, tenantId: null, tenantName: '',
  role: null, isOwner: false, isManager: false, canBilling: false, setActiveTenant: () => {}, refetch: noop,
});

export function TenantProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => setActiveId(v))
      .catch(() => {})
      .finally(() => setRestored(true));
  }, []);

  const q = useQuery({
    queryKey: ['memberships', user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from('memberships')
        .select('id, tenant_id, role, can_manage_managers, can_manage_billing, tenants(id, name, nip, plan)')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Membership[];
    },
  });

  const memberships = useMemo(() => q.data ?? [], [q.data]);
  const membership = useMemo(
    () => memberships.find((m) => m.tenant_id === activeId) ?? memberships[0] ?? null,
    [memberships, activeId]
  );

  const setActiveTenant = useCallback((id: string) => {
    setActiveId(id);
    AsyncStorage.setItem(KEY, id).catch(() => {});
  }, []);

  const role = membership?.role ?? null;
  const value = useMemo<TenantContextValue>(
    () => ({
      loading: !restored || (Boolean(user) && q.isPending),
      error: (q.error as Error | null) ?? null,
      memberships,
      membership,
      tenantId: membership?.tenant_id ?? null,
      tenantName: membership?.tenants?.name ?? '',
      role,
      isOwner: role === 'owner',
      isManager: role === 'owner' || role === 'manager',
      canBilling: role === 'owner' || Boolean(membership?.can_manage_billing),
      setActiveTenant,
      refetch: q.refetch,
    }),
    [restored, user, q.isPending, q.error, q.refetch, memberships, membership, role, setActiveTenant]
  );
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export const useTenant = () => useContext(TenantContext);

/** Dla ekranów, które istnieją wyłącznie wewnątrz firmy: id zawsze jest dostępne. */
export function useTenantId(): string {
  const { tenantId } = useTenant();
  return tenantId ?? '';
}
