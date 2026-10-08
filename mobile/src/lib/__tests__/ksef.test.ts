import { KSEF_RANGES, KSEF_STATUS_VIEW, canSyncNow, cleanKsefToken, describeRun, importFromDate, type KsefRun, type KsefStatus } from '../ksef';
import { notificationHref } from '../notification-target';

const NOW = new Date(2026, 1, 15, 10, 30);          // 15 lutego 2026, czas lokalny

describe('KSeF: od kiedy pobierać faktury', () => {
  it('liczy datę wstecz od dziś (czas lokalny), także na przełomie miesięcy i lat', () => {
    expect(importFromDate('new', NOW)).toBe('2026-02-15');
    expect(importFromDate('30', NOW)).toBe('2026-01-16');
    expect(importFromDate('90', NOW)).toBe('2025-11-17');
    expect(importFromDate('year', NOW)).toBe('2026-01-01');
    expect(importFromDate('30', new Date(2026, 0, 5))).toBe('2025-12-06');
  });
  it('wszystkie opcje z listy dają poprawną datę', () => {
    for (const r of KSEF_RANGES) expect(importFromDate(r.value, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('KSeF: czyszczenie wklejonego tokenu', () => {
  const real = '20260105-EC-0123456789-ABCDEF0123-45|nip-5260250995|0a1b2c3d4e5f60718293a4b5c6d7e8f9';
  it('usuwa spacje, końce wierszy i niewidoczne znaki z kopiowania', () => {
    expect(cleanKsefToken(`  ${real}\n`)).toEqual({ token: real, error: null });
    expect(cleanKsefToken(`${real.slice(0, 30)}\n${real.slice(30)}`)).toEqual({ token: real, error: null });
    expect(cleanKsefToken(`﻿${real}​`)).toEqual({ token: real, error: null });
    expect(cleanKsefToken(`„${real}”`)).toEqual({ token: real, error: null });
    expect(cleanKsefToken(`"${real}"`)).toEqual({ token: real, error: null });
  });
  it('odrzuca puste, zbyt krótkie, zbyt długie i z polskimi znakami', () => {
    expect(cleanKsefToken('   ').error).toMatch(/Wklej token/);
    expect(cleanKsefToken('krotki').error).toMatch(/za krótki/);
    expect(cleanKsefToken('a'.repeat(2001)).error).toMatch(/za długi/);
    expect(cleanKsefToken('zażółć-gęślą-jaźń-0123456789').error).toMatch(/niedozwolone/);
  });
});

const run = (over: Partial<KsefRun> = {}): KsefRun => ({
  id: 1, trigger: 'auto', status: 'ok', started_at: '2026-02-15T08:00:00Z', finished_at: '2026-02-15T08:00:05Z',
  listed: 0, imported: 0, linked: 0, skipped: 0, failed: 0, error: null, ...over,
});

describe('KSeF: opis przebiegu synchronizacji', () => {
  it('odmienia „faktura” po polsku', () => {
    expect(describeRun(run({ imported: 1 })).title).toBe('Pobrano 1 nową fakturę');
    expect(describeRun(run({ imported: 3 })).title).toBe('Pobrano 3 nowe faktury');
    expect(describeRun(run({ imported: 5 })).title).toBe('Pobrano 5 nowych faktur');
    expect(describeRun(run({ imported: 22 })).title).toBe('Pobrano 22 nowe faktury');
    expect(describeRun(run({ imported: 12 })).title).toBe('Pobrano 12 nowych faktur');
  });
  it('pokazuje dopięte numery KSeF i brak nowości', () => {
    expect(describeRun(run({ imported: 2, linked: 1 })).title).toBe('Pobrano 2 nowe faktury, dopięto numer KSeF w 1 istniejącej fakturze');
    expect(describeRun(run({ linked: 2 })).title).toBe('Dopięto numer KSeF w 2 istniejących fakturach');
    expect(describeRun(run())).toEqual({ title: 'Brak nowych faktur', detail: null, tone: 'neutral' });
  });
  it('błąd i przebieg częściowy mają ton ostrzegawczy i szczegóły', () => {
    expect(describeRun(run({ status: 'error', error: 'KSeF nie działa' }))).toEqual({ title: 'Nie udało się pobrać faktur', detail: 'KSeF nie działa', tone: 'danger' });
    const partial = describeRun(run({ status: 'partial', imported: 2, error: 'limit czasu' }));
    expect(partial.tone).toBe('warning');
    expect(partial.title).toContain('to jeszcze nie wszystko');
    expect(partial.detail).toBe('limit czasu');
    expect(describeRun(run({ status: 'running' })).tone).toBe('info');
  });
});

describe('KSeF: stan połączenia', () => {
  const st = (over: Partial<KsefStatus>): KsefStatus => ({ status: 'connected', running: false, runs: [], ...over });
  it('synchronizować można tylko połączone i bez trwającej pracy', () => {
    expect(canSyncNow(st({}))).toBe(true);
    expect(canSyncNow(st({ running: true }))).toBe(false);
    expect(canSyncNow(st({ status: 'error' }))).toBe(false);
    expect(canSyncNow(st({ status: 'disconnected' }))).toBe(false);
    expect(canSyncNow(undefined)).toBe(false);
  });
  it('każdy status ma napis i ton', () => {
    for (const k of ['disconnected', 'connected', 'error'] as const) expect(KSEF_STATUS_VIEW[k].label.length).toBeGreaterThan(3);
  });
});

describe('powiadomienia z KSeF prowadzą na właściwy ekran', () => {
  it('ekran KSeF i lista faktur', () => {
    expect(notificationHref('system', { screen: 'ksef' })).toBe('/settings/ksef');
    expect(notificationHref('document_ready', { screen: 'documents' })).toBe('/documents');
    expect(notificationHref('document_ready', { document_id: 'd1' })).toBe('/documents/d1');
    expect(notificationHref('system', null)).toBe('/activity');
  });
});
