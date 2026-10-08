// Plany i limity — LUSTRO funkcji plan_limits() z migracji 0007 (baza i tak egzekwuje limity;
// tu tylko pokazujemy je użytkownikowi). Ceny netto, zgodnie z dokumentem koncepcyjnym, rozdz. 12.

export type PlanId = 'solo' | 'start' | 'team';

export const PLANS: Record<PlanId, { name: string; price: string; users: number; products: number | null; scans: number }> = {
  solo: { name: 'Solo', price: '0 zł', users: 1, products: 150, scans: 5 },
  start: { name: 'Start', price: '49 zł / mc', users: 3, products: 1000, scans: 30 },
  team: { name: 'Zespół', price: '99 zł / mc', users: 10, products: null, scans: 150 },
};

export const planName = (id: string | null | undefined): string => PLANS[id as PlanId]?.name ?? '—';
