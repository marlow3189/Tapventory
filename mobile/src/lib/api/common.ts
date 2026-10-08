import type { PostgrestError } from '@supabase/supabase-js';

/** Rozpakowuje odpowiedź Supabase: błąd → wyjątek (łapie go react-query / ekran). */
export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

/**
 * PostgREST oddaje domyślnie max 1000 wierszy. Ta funkcja dociąga kolejne strony,
 * aż skończą się dane — potrzebne dla planu „Zespół" (produkty bez limitu).
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  pageSize = 1000,
  maxPages = 50
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const rows = unwrap(await page(i * pageSize, (i + 1) * pageSize - 1)) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
