// Linki z wiadomości e-mail (potwierdzenie konta, reset hasła) w aplikacji na telefonie.
// W przeglądarce robi to sam klient Supabase (detectSessionInUrl) — tu obsługujemy
// tylko adresy typu  tapventory://reset-password#access_token=...&refresh_token=...&type=recovery

import { supabase } from './supabase';

export type AuthLinkResult = 'recovery' | 'signed-in' | 'ignored' | 'error';

function parseParams(url: string): URLSearchParams {
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const parts: string[] = [];
  if (queryIndex >= 0) parts.push(url.slice(queryIndex + 1, hashIndex >= 0 && hashIndex > queryIndex ? hashIndex : undefined));
  if (hashIndex >= 0) parts.push(url.slice(hashIndex + 1));
  return new URLSearchParams(parts.join('&'));
}

export async function handleAuthUrl(url: string): Promise<AuthLinkResult> {
  const p = parseParams(url);
  const access = p.get('access_token');
  const refresh = p.get('refresh_token');
  if (!access || !refresh) return 'ignored';
  const { error } = await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
  if (error) return 'error';
  return p.get('type') === 'recovery' ? 'recovery' : 'signed-in';
}
