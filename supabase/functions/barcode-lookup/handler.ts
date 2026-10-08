// Podpowiedź nazwy produktu po kodzie kreskowym (Open Food Facts, a w drugiej kolejności Open Beauty Facts).
// Zasady „dobrego sąsiada" wobec darmowego API: własny User-Agent z kontaktem, krótki limit czasu,
// pamięć podręczna w bazie (znalezione 30 dni, nieznalezione 7 dni) — ten sam kod nie odpytuje serwisu drugi raz.

import { HttpError, bearerToken, errorResponse, json, preflight, readJsonBody } from '../_shared/http.ts';
import { normalizeEan } from '../_shared/validate.ts';

export type CacheRow = { ean: string; found: boolean; name: string | null; brand: string | null; quantity: string | null; source: string; fetched_at: string };

export interface BarcodeDeps {
  auth: { getUserId(token: string): Promise<string | null> };
  cache: { get(ean: string): Promise<CacheRow | null>; put(row: Omit<CacheRow, 'fetched_at'>): Promise<void> };
  fetch: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  now: () => number;
  userAgent: string;
}

const DAY = 86_400_000;
const SOURCES: { id: string; host: string }[] = [
  { id: 'openfoodfacts', host: 'world.openfoodfacts.org' },
  { id: 'openbeautyfacts', host: 'world.openbeautyfacts.org' },
];

/** „Łaciate" + „Mleko UHT 3,2%" + „1 l" → „Łaciate Mleko UHT 3,2% 1 l" (bez dublowania, do 300 znaków). */
export function composeName(name: string | null, brand: string | null, quantity: string | null): string | null {
  const parts: string[] = [];
  const n = (name ?? '').trim();
  const b = (brand ?? '').split(',')[0].trim();
  const q = (quantity ?? '').trim();
  if (b && !n.toLowerCase().includes(b.toLowerCase())) parts.push(b);
  if (n) parts.push(n);
  if (q && !n.toLowerCase().includes(q.toLowerCase())) parts.push(q);
  const s = parts.join(' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 300) : null;
}

type Lookup = { found: boolean; name: string | null; brand: string | null; quantity: string | null; source: string };

async function lookup(deps: BarcodeDeps, ean: string): Promise<Lookup> {
  for (const s of SOURCES) {
    const url = `https://${s.host}/api/v2/product/${ean}.json?fields=product_name,product_name_pl,brands,quantity`;
    try {
      const res = await deps.fetch(url, { headers: { 'User-Agent': deps.userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { status?: number; product?: Record<string, unknown> };
      const p = data.product;
      if (data.status === 1 && p) {
        const name = String(p.product_name_pl || p.product_name || '').trim() || null;
        const brand = typeof p.brands === 'string' && p.brands.trim() ? p.brands.trim() : null;
        const quantity = typeof p.quantity === 'string' && p.quantity.trim() ? p.quantity.trim() : null;
        if (name) return { found: true, name, brand, quantity, source: s.id };
      }
    } catch {
      // jedno źródło niedostępne nie przekreśla drugiego
      if (s === SOURCES[SOURCES.length - 1]) throw new HttpError(502, 'lookup_unavailable', 'Baza produktów jest chwilowo niedostępna. Wpisz nazwę ręcznie.');
    }
  }
  return { found: false, name: null, brand: null, quantity: null, source: 'none' };
}

export async function handleBarcodeLookup(req: Request, deps: BarcodeDeps): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method', 'Użyj metody POST.');
    const token = bearerToken(req);
    if (!token || !(await deps.auth.getUserId(token))) throw new HttpError(401, 'unauthorized', 'Zaloguj się ponownie.');

    const body = await readJsonBody(req);
    const ean = normalizeEan(body.ean);
    if (!ean) throw new HttpError(400, 'bad_ean', 'Nieprawidłowy kod kreskowy (EAN ma 8 lub 13 cyfr i poprawną sumę kontrolną).');

    const cached = await deps.cache.get(ean);
    if (cached) {
      const ageDays = (deps.now() - new Date(cached.fetched_at).getTime()) / DAY;
      if (ageDays < (cached.found ? 30 : 7)) {
        return json({ found: cached.found, name: composeName(cached.name, cached.brand, cached.quantity), cached: true });
      }
    }

    const r = await lookup(deps, ean);
    await deps.cache.put({ ean, found: r.found, name: r.name, brand: r.brand, quantity: r.quantity, source: r.source }).catch(() => {});
    return json({ found: r.found, name: composeName(r.name, r.brand, r.quantity), cached: false });
  } catch (e) {
    return errorResponse(e);
  }
}
