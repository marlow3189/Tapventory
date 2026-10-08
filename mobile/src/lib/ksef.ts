// Logika ekranu „KSeF" bez zależności od Reacta — dzięki temu da się ją testować w sekundę (Jest).

import { plural } from './format';
import type { Tone } from './status';

export type KsefEnv = 'prod' | 'demo' | 'test';

export const KSEF_ENVS: { value: KsefEnv; label: string }[] = [
  { value: 'prod', label: 'Produkcja (prawdziwe faktury)' },
  { value: 'demo', label: 'Demo (przedprodukcja MF)' },
  { value: 'test', label: 'Test (dane próbne MF)' },
];

export type KsefRange = 'new' | '30' | '90' | 'year';

export const KSEF_RANGES: { value: KsefRange; label: string }[] = [
  { value: 'new', label: 'Tylko nowe (od dziś)' },
  { value: '30', label: 'Ostatnie 30 dni' },
  { value: '90', label: 'Ostatnie 90 dni' },
  { value: 'year', label: 'Od początku roku' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Od jakiej daty (RRRR-MM-DD, czas lokalny) pobierać faktury po pierwszym połączeniu. */
export function importFromDate(range: KsefRange, now: Date = new Date()): string {
  if (range === 'new') return iso(now);
  if (range === 'year') return `${now.getFullYear()}-01-01`;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(range));
  return iso(d);
}

/**
 * Czyści wklejony token: ludzie kopiują go z końcami wierszy, spacjami i niewidocznymi znakami.
 * Prawdziwy token nie zawiera białych znaków, więc usuwamy je wszystkie.
 */
export function cleanKsefToken(raw: string): { token: string; error: string | null } {
  const token = raw.replace(/[\s​-‍⁠﻿"'„”]+/g, '');
  if (!token) return { token, error: 'Wklej token skopiowany z KSeF.' };
  if (token.length < 20) return { token, error: 'Token jest za krótki — skopiuj go w całości.' };
  if (token.length > 2000) return { token, error: 'Token jest za długi — skopiowano więcej, niż trzeba.' };
  if (!/^[\x21-\x7e]+$/.test(token)) return { token, error: 'Token zawiera niedozwolone znaki. Skopiuj go ponownie z KSeF.' };
  return { token, error: null };
}

export type KsefRun = {
  id: number;
  trigger: 'connect' | 'manual' | 'auto';
  status: 'running' | 'ok' | 'partial' | 'error';
  started_at: string;
  finished_at: string | null;
  listed: number;
  imported: number;
  linked: number;
  skipped: number;
  failed: number;
  error: string | null;
};

export type KsefStatus = {
  status: 'disconnected' | 'connected' | 'error';
  environment?: KsefEnv;
  nip?: string | null;
  token_hint?: string | null;
  import_from?: string | null;
  connected_at?: string | null;
  last_sync_at?: string | null;
  last_attempt_at?: string | null;
  last_error?: string | null;
  running: boolean;
  runs: KsefRun[];
};

export const KSEF_STATUS_VIEW: Record<KsefStatus['status'], { label: string; tone: Tone }> = {
  disconnected: { label: 'Niepodłączony', tone: 'neutral' },
  connected: { label: 'Połączony', tone: 'success' },
  error: { label: 'Wymaga uwagi', tone: 'danger' },
};

export const TRIGGER_LABEL: Record<KsefRun['trigger'], string> = { connect: 'po połączeniu', manual: 'ręcznie', auto: 'automatycznie' };

const FORMS_NEW = ['nową fakturę', 'nowe faktury', 'nowych faktur'] as const;
const FORMS_EXISTING = ['istniejącej fakturze', 'istniejących fakturach', 'istniejących fakturach'] as const;

/** Jedno zdanie opisujące przebieg synchronizacji (lista „Ostatnie synchronizacje"). */
export function describeRun(run: KsefRun): { title: string; detail: string | null; tone: Tone } {
  if (run.status === 'running') return { title: 'Trwa pobieranie…', detail: null, tone: 'info' };
  const parts: string[] = [];
  if (run.imported > 0) parts.push(`Pobrano ${run.imported} ${plural(run.imported, FORMS_NEW)}`);
  if (run.linked > 0) parts.push(`dopięto numer KSeF w ${run.linked} ${plural(run.linked, FORMS_EXISTING)}`);
  if (run.status === 'error') return { title: 'Nie udało się pobrać faktur', detail: run.error, tone: 'danger' };
  if (run.status === 'partial') {
    return { title: parts.length ? `${parts.join(', ')} — to jeszcze nie wszystko` : 'Pobrano część faktur', detail: run.error, tone: 'warning' };
  }
  if (parts.length === 0) return { title: 'Brak nowych faktur', detail: null, tone: 'neutral' };
  const text = parts.join(', ');
  return { title: text.charAt(0).toUpperCase() + text.slice(1), detail: null, tone: 'success' };
}

/** Czy pokazać przycisk „Synchronizuj teraz": połączony i nic aktualnie nie pracuje. */
export const canSyncNow = (s: KsefStatus | undefined): boolean => Boolean(s && s.status === 'connected' && !s.running);
