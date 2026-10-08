// „Na żywo": gdy ktoś w firmie doda zgłoszenie, wiadomość czy zmieni status,
// ekran odświeża się sam. Realtime respektuje RLS — dostajemy tylko to, co wolno.

import { useEffect } from 'react';
import { supabase } from './supabase';
import { queryClient } from './query';

export function useRealtimeSync(tenantId: string | null, userId: string | null) {
  useEffect(() => {
    if (!tenantId || !userId) return;
    const refresh = (...keys: string[]) => () => {
      for (const k of keys) queryClient.invalidateQueries({ queryKey: [k] });
    };
    const f = `tenant_id=eq.${tenantId}`;
    const channel = supabase
      .channel(`tv-${tenantId}-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests', filter: f }, refresh('requests', 'request', 'dashboard'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'request_messages', filter: f }, refresh('messages', 'requests'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'request_events', filter: f }, refresh('events'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter: f }, refresh('documents', 'document', 'dashboard'))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, refresh('notifications', 'dashboard'))
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, userId]);
}
