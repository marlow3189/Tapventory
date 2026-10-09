// Pobranie danych firmy do eksportu CSV. Używamy widoków, które aplikacja zna z ekranów
// (product_overview, movement_feed, document_overview) — czyli dokładnie tego, co użytkownik ma prawo zobaczyć;
// o tym, kto co widzi, decyduje baza (faktury widzi tylko kierownictwo).

import { supabase } from '../supabase';
import { buildCsv, documentsRows, DOCUMENTS_HEADER, exportFilename, movementsRows, MOVEMENTS_HEADER, productsRows, PRODUCTS_HEADER, type ExportKind, type MovementExportRow } from '../csv';
import type { DocumentRow, ProductRow } from '../types';
import { fetchAll } from './common';

export type ExportFile = { kind: ExportKind; filename: string; text: string; rowCount: number };

export const MOVEMENT_EXPORT_DAYS = 90;

export async function buildProductsExport(tenantId: string, now: Date = new Date()): Promise<ExportFile> {
  const rows = await fetchAll<ProductRow>((from, to) =>
    supabase.from('product_overview').select('*').eq('tenant_id', tenantId).order('name').range(from, to)
  );
  return { kind: 'stany', filename: exportFilename('stany', now), text: buildCsv(PRODUCTS_HEADER, productsRows(rows)), rowCount: rows.length };
}

export async function buildMovementsExport(tenantId: string, now: Date = new Date(), days = MOVEMENT_EXPORT_DAYS): Promise<ExportFile> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = await fetchAll<MovementExportRow>((from, to) =>
    supabase.from('movement_feed').select('*').eq('tenant_id', tenantId).gte('created_at', since).order('created_at', { ascending: false }).range(from, to)
  );
  return { kind: 'ruchy', filename: exportFilename('ruchy', now), text: buildCsv(MOVEMENTS_HEADER, movementsRows(rows)), rowCount: rows.length };
}

export async function buildDocumentsExport(tenantId: string, now: Date = new Date()): Promise<ExportFile> {
  const rows = await fetchAll<DocumentRow>((from, to) =>
    supabase.from('document_overview').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).range(from, to)
  );
  return { kind: 'faktury', filename: exportFilename('faktury', now), text: buildCsv(DOCUMENTS_HEADER, documentsRows(rows)), rowCount: rows.length };
}
