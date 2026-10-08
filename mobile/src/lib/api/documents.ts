import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useTenant } from '../tenant';
import { uuidv7 } from '../uuid';
import { unwrap } from './common';
import { invokeFunction } from './functions';
import { uploadBytes, uploadJpeg } from '../storage';
import { base64ToBytes } from '../base64';
import type { DocumentLineRow, DocumentRow } from '../types';

export function useDocuments() {
  const { tenantId, isManager } = useTenant();
  return useQuery({
    queryKey: ['documents', tenantId],
    enabled: Boolean(tenantId && isManager),
    queryFn: async () =>
      unwrap(await supabase.from('document_overview').select('*').eq('tenant_id', tenantId!).order('created_at', { ascending: false }).limit(100)) as DocumentRow[],
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: ['document', id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.from('document_overview').select('*').eq('id', id!).single()) as DocumentRow,
  });
}

export function useDocumentLines(id: string | undefined) {
  return useQuery({
    queryKey: ['document-lines', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabase.from('document_lines').select('*').eq('document_id', id!).order('line_no', { ascending: true }).order('id')) as DocumentLineRow[],
  });
}

function useInvalidateDocs() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['documents', 'document', 'document-lines', 'dashboard', 'products', 'product', 'movements'])
      qc.invalidateQueries({ queryKey: [k] });
  };
}

export type PageInput =
  | { kind: 'image'; base64: string }
  | { kind: 'pdf'; bytes: Uint8Array };

/**
 * Wgrywa strony do Storage, zakłada dokument „w przetwarzaniu" i uruchamia AI.
 * Zwraca id dokumentu OD RAZU po założeniu — użytkownik nie czeka na model;
 * wynik pojawi się na żywo (Realtime) i dostanie powiadomienie.
 */
export async function submitDocument(tenantId: string, pages: PageInput[]): Promise<string> {
  if (pages.length === 0) throw { message: 'Dodaj co najmniej jedną stronę.' };
  const docId = uuidv7();
  const paths: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const ext = p.kind === 'pdf' ? 'pdf' : 'jpg';
    const path = `${tenantId}/documents/${docId}/page-${i + 1}.${ext}`;
    if (p.kind === 'pdf') await uploadBytes('documents', path, p.bytes, 'application/pdf');
    else await uploadJpeg('documents', path, p.base64);
    paths.push(path);
  }
  const { error } = await supabase.rpc('create_photo_document', { p_id: docId, p_tenant: tenantId, p_paths: paths });
  if (error) throw error;
  // Uruchamiamy AI „w tle" — nie blokujemy ekranu. Awaria nie jest tu krytyczna:
  // dokument zostanie ponowiony przyciskiem „Spróbuj ponownie" lub przez cron serwera.
  void processDocument(docId).catch(() => {});
  return docId;
}

export function processDocument(documentId: string) {
  return invokeFunction<{ ok: true }>('process-document', { document_id: documentId });
}

export function useUpdateDocument() {
  const done = useInvalidateDocs();
  return useMutation({
    mutationFn: async (i: { id: string; patch: Partial<Pick<DocumentRow, 'supplier_name' | 'supplier_nip' | 'invoice_number' | 'issue_date' | 'total_net' | 'total_gross' | 'currency' | 'doc_kind' | 'supplier_id'>> & { notes?: string | null; status?: 'draft' | 'verified' }; }) => {
      const { error } = await supabase.from('documents').update(i.patch).eq('id', i.id);
      if (error) throw error;
    },
    onSuccess: done,
  });
}

export function useUpdateLine() {
  const done = useInvalidateDocs();
  return useMutation({
    mutationFn: async (i: { id: string; patch: Partial<Pick<DocumentLineRow, 'raw_name' | 'qty' | 'unit' | 'unit_price_net' | 'total_net' | 'product_id' | 'skip' | 'match_confidence'>> }) => {
      const { error } = await supabase.from('document_lines').update(i.patch).eq('id', i.id);
      if (error) throw error;
    },
    onSuccess: done,
  });
}

export function useAddLine() {
  const { tenantId } = useTenant();
  const done = useInvalidateDocs();
  return useMutation({
    mutationFn: async (i: { documentId: string; lineNo: number }) => {
      const { error } = await supabase.from('document_lines').insert({
        id: uuidv7(), tenant_id: tenantId!, document_id: i.documentId, line_no: i.lineNo, raw_name: 'Nowa pozycja', qty: 1,
      });
      if (error) throw error;
    },
    onSuccess: done,
  });
}

export function useDeleteLine() {
  const done = useInvalidateDocs();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('document_lines').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: done,
  });
}

export type MatchResult = { index: number; product_id: string | null; confidence: number; method: 'ean' | 'alias' | 'similarity' | 'none' };

export function useRematchLines() {
  const { tenantId } = useTenant();
  const done = useInvalidateDocs();
  return useMutation({
    mutationFn: async (i: { supplierNip: string | null; lines: DocumentLineRow[] }) => {
      const todo = i.lines.filter((l) => !l.product_id && !l.skip);
      if (todo.length === 0) return 0;
      const items = todo.map((l) => ({ name: l.raw_name, ean: l.ean }));
      const matches = unwrap(await supabase.rpc('match_products', { p_tenant: tenantId!, p_supplier_nip: i.supplierNip, p_items: items })) as MatchResult[];
      let applied = 0;
      for (const m of matches) {
        if (!m.product_id || m.confidence < 60) continue;
        const { error } = await supabase.from('document_lines').update({ product_id: m.product_id, match_confidence: m.confidence }).eq('id', todo[m.index].id);
        if (error) throw error;
        applied++;
      }
      return applied;
    },
    onSuccess: done,
  });
}

export function usePostDocument() {
  const done = useInvalidateDocs();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('post_document', { p_document: id })) as number,
    onSuccess: done,
  });
}

export function useUnpostDocument() {
  const done = useInvalidateDocs();
  return useMutation({
    mutationFn: async (i: { id: string; reason: string }) =>
      unwrap(await supabase.rpc('unpost_document', { p_document: i.id, p_reason: i.reason })) as number,
    onSuccess: done,
  });
}

export function useRetryDocument() {
  const done = useInvalidateDocs();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('retry_document', { p_document: id });
      if (error) throw error;
      void processDocument(id).catch(() => {});
    },
    onSuccess: done,
  });
}

export function useDeleteDocument() {
  const done = useInvalidateDocs();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('documents').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: done,
  });
}

export { base64ToBytes };
