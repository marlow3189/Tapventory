// Atrapa dostawcy odczytu do TRYBU PRÓBNEGO (bez klucza API i bez kosztów).
// Zwraca wartości wzorcowe zamienione na format odpowiedzi modelu — opcjonalnie z losowymi, powtarzalnymi
// błędami. Służy wyłącznie do sprawdzenia, że cała rura (potok → ocena → raport) działa; liczby z takiego
// uruchomienia NIE opisują żadnego prawdziwego modelu (raport wyraźnie to oznacza).

import { round2 } from '../supabase/functions/_shared/validate.ts';
import type { Effort, ExtractionProvider, PageInput, ProviderResult } from '../supabase/functions/_shared/provider.ts';
import { rng, type Expected } from './cases.ts';

export function toModelJson(e: Expected): Record<string, unknown> {
  return {
    document_kind: e.doc_kind,
    supplier: { name: e.supplier_name, nip: e.supplier_nip },
    invoice: { number: e.invoice_number, issue_date: e.issue_date, currency: e.currency },
    totals: { net: e.total_net, vat: e.total_net !== null && e.total_gross !== null ? round2(e.total_gross - e.total_net) : null, gross: e.total_gross },
    lines: e.lines.map((l) => ({
      name: l.name, quantity: l.qty, unit: l.unit, unit_price_net: l.unit_price_net, total_net: l.total_net, vat_rate: l.vat_rate, ean: l.ean,
      is_stock_item: !l.skip, confidence: 95,
    })),
    warnings: [],
    overall_confidence: 95,
  };
}

const hash = (s: string) => [...s].reduce((a, ch) => (Math.imul(a, 31) + ch.charCodeAt(0)) | 0, 7);

/** Mnożnik błędów wg „siły" modelu (tani popełnia ich więcej) — tylko do próby. */
const strength = (model: string) => (/opus/.test(model) ? 0.2 : /sonnet/.test(model) ? 0.45 : 1);

export class DryProvider implements ExtractionProvider {
  expected: Expected;
  noise: number;
  seed: number;
  calls = 0;
  constructor(expected: Expected, noise: number, seed: number) {
    this.expected = expected;
    this.noise = noise;
    this.seed = seed;
  }
  async extract(args: { model: string; effort: Effort; pages: PageInput[] }): Promise<ProviderResult> {
    this.calls++;
    const r = rng(this.seed ^ hash(args.model) ^ (this.calls * 7919));
    const json = toModelJson(this.expected) as { supplier: { nip: string | null }; invoice: { issue_date: string | null }; totals: { gross: number | null }; lines: Record<string, unknown>[] };
    const p = this.noise * strength(args.model);
    if (r() < p) {
      switch (Math.floor(r() * 7)) {
        case 0: if (json.supplier.nip) json.supplier.nip = json.supplier.nip.slice(0, 9) + ((Number(json.supplier.nip[9]) + 1) % 10); break;      // zła cyfra NIP (kod to wykryje)
        case 1: if (json.lines[0]) json.lines[0].quantity = Number(json.lines[0].quantity) + 1; break;                                           // zła ilość (suma pozycji przestaje się zgadzać)
        case 2: if (json.lines[0] && typeof json.lines[0].unit_price_net === 'number') { json.lines[0].unit_price_net = json.lines[0].unit_price_net * 10; } break;
        case 3: json.lines.pop(); break;                                                                                                          // pominięta pozycja
        case 4: if (json.totals.gross !== null) json.totals.gross = round2(json.totals.gross + 10); break;
        case 5: json.lines.push({ name: 'Razem', quantity: 1, unit: null, unit_price_net: null, total_net: null, vat_rate: null, ean: null, is_stock_item: true, confidence: 40 }); break;
        default: if (json.invoice.issue_date) json.invoice.issue_date = json.invoice.issue_date.replace(/-\d\d$/, '-01'); break;                  // zła data (cichy błąd — kod nie ma jak sprawdzić)
      }
    }
    const pages = args.pages.length;
    return { json, model: args.model, inputTokens: 1500 * pages + 900, outputTokens: 350 + 120 * this.expected.lines.length };
  }
}
