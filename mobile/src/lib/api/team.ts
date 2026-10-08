import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useTenant } from '../tenant';
import { unwrap } from './common';
import type { Role, TeamInvite, TeamMember } from '../types';

export function useTeam() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['team', tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () =>
      unwrap(await supabase.from('team_members').select('*').eq('tenant_id', tenantId!).order('created_at', { ascending: true })) as TeamMember[],
  });
}

export function useInvites() {
  const { tenantId, isManager } = useTenant();
  return useQuery({
    queryKey: ['invites', tenantId],
    enabled: Boolean(tenantId && isManager),
    queryFn: async () =>
      unwrap(await supabase.from('team_invites').select('*').eq('tenant_id', tenantId!).eq('status', 'pending').order('created_at', { ascending: false })) as TeamInvite[],
  });
}

export type CreatedInvite = { id: string; token: string; code: string; email: string; role: Role; expires_at: string };

export function useCreateInvite() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { email: string; role: Role; manageManagers?: boolean; manageBilling?: boolean }) =>
      unwrap(
        await supabase.rpc('create_invite', {
          p_tenant: tenantId!, p_email: i.email, p_role: i.role,
          p_manage_managers: Boolean(i.manageManagers), p_manage_billing: Boolean(i.manageBilling),
        })
      ) as CreatedInvite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('revoke_invite', { p_invite: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { membershipId: string; patch: { role?: Role; can_manage_managers?: boolean; can_manage_billing?: boolean } }) => {
      const { error } = await supabase.from('memberships').update(i.patch).eq('id', i.membershipId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (membershipId: string) => {
      const { error } = await supabase.from('memberships').delete().eq('id', membershipId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] });
      qc.invalidateQueries({ queryKey: ['memberships'] });
    },
  });
}

/** Dołączenie do firmy kodem z zaproszenia (ABCD-EFGH). Zwraca id firmy. */
export async function acceptInviteCode(code: string): Promise<string> {
  return unwrap(await supabase.rpc('accept_invite_code', { p_code: code })) as string;
}
