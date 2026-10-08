import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useTenant } from '../tenant';
import { uuidv7 } from '../uuid';
import { fetchAll, unwrap } from './common';
import type { MovementRow, ProductRow, Project, Supplier } from '../types';

export function useProducts() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['products', tenantId],
    enabled: Boolean(tenantId),
    queryFn: () =>
      fetchAll<ProductRow>((from, to) =>
        supabase.from('product_overview').select('*').eq('tenant_id', tenantId!).order('name').range(from, to)
      ),
  });
}

export function useProduct(id: string | undefined) {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['product', tenantId, id],
    enabled: Boolean(tenantId && id),
    initialData: () => qc.getQueryData<ProductRow[]>(['products', tenantId])?.find((p) => p.id === id),
    staleTime: 10_000,
    queryFn: async () =>
      unwrap(await supabase.from('product_overview').select('*').eq('id', id!).single()) as ProductRow,
  });
}

export function useProductMovements(productId: string | undefined) {
  return useQuery({
    queryKey: ['movements', productId],
    enabled: Boolean(productId),
    queryFn: async () =>
      unwrap(
        await supabase.from('movement_feed').select('*').eq('product_id', productId!).order('created_at', { ascending: false }).limit(60)
      ) as MovementRow[],
  });
}

export function useSuppliers() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['suppliers', tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => unwrap(await supabase.from('suppliers').select('id, name, nip').eq('tenant_id', tenantId!).order('name')) as Supplier[],
  });
}

export function useProjects(onlyOpen = true) {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['projects', tenantId, onlyOpen],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      let q = supabase.from('projects').select('id, name, ref_number, type, status').eq('tenant_id', tenantId!).order('created_at', { ascending: false });
      if (onlyOpen) q = q.eq('status', 'open');
      return unwrap(await q) as Project[];
    },
  });
}

export type ProductInput = {
  id?: string;
  name: string;
  ean: string | null;
  unit: string;
  pack_size: number;
  min_stock: number;
  photo_path: string | null;
  default_supplier_id: string | null;
  active?: boolean;
};

export async function saveProduct(tenantId: string, input: ProductInput): Promise<string> {
  const row = {
    name: input.name.trim(),
    ean: input.ean,
    unit: input.unit.trim() || 'szt.',
    pack_size: input.pack_size,
    min_stock: input.min_stock,
    photo_path: input.photo_path,
    default_supplier_id: input.default_supplier_id,
    active: input.active ?? true,
  };
  if (input.id) {
    const { error } = await supabase.from('products').update(row).eq('id', input.id);
    if (error) throw error;
    return input.id;
  }
  const id = uuidv7();   // id z klienta = bezpieczne ponowienie przy słabej sieci
  const { error } = await supabase.from('products').upsert({ id, tenant_id: tenantId, ...row }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
  return id;
}

export function useSaveProduct() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) => saveProduct(tenantId!, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export async function findProductByEan(tenantId: string, ean: string): Promise<ProductRow | null> {
  const { data, error } = await supabase.from('product_overview').select('*').eq('tenant_id', tenantId).eq('ean', ean).eq('active', true).limit(1).maybeSingle();
  if (error) throw error;
  return (data as ProductRow | null) ?? null;
}

export type TakeInput = {
  productId: string;
  qty: number;                       // dodatnia liczba — znak nadaje funkcja
  reason?: 'use' | 'damage' | 'expired' | 'other';
  note?: string;
  projectId?: string | null;
};

/** „Zdejmij": dopisuje ruch typu rozchód. Id z klienta → ponowienie przy słabej sieci nie zdubluje wpisu. */
export function useTakeStock() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TakeInput) => {
      if (!(input.qty > 0)) throw { message: 'Podaj ilość większą od zera.' };
      const { error } = await supabase.from('stock_movements').upsert(
        {
          id: uuidv7(),
          tenant_id: tenantId!,
          product_id: input.productId,
          movement_type: 'issue',
          qty: -Math.abs(input.qty),
          reason: input.reason ?? 'use',
          note: input.note?.trim() || null,
          project_id: input.projectId ?? null,
        },
        { onConflict: 'id', ignoreDuplicates: true }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Ręczna korekta/przyjęcie przez kierownictwo (poza fakturą). */
export function useManualMovement() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { productId: string; type: 'receipt' | 'adjustment'; qty: number; note?: string }) => {
      const { error } = await supabase.from('stock_movements').upsert(
        { id: uuidv7(), tenant_id: tenantId!, product_id: i.productId, movement_type: i.type, qty: i.qty, note: i.note?.trim() || null },
        { onConflict: 'id', ignoreDuplicates: true }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Szybkie dodanie dostawcy z formularza produktu (reszta danych dojdzie z faktury). */
export function useCreateSupplier() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<Supplier> => {
      const row = { id: uuidv7(), tenant_id: tenantId!, name: name.trim() };
      const { error } = await supabase.from('suppliers').insert(row);
      if (error) throw error;
      return { id: row.id, name: row.name, nip: null };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

/** Dodanie zlecenia/projektu (np. „Auto Kowalskiego", „Wesele 12.10"), do którego przypisuje się zużycie i zakupy. */
export function useCreateProject() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { name: string; ref_number?: string | null }) => {
      const { error } = await supabase.from('projects').insert({
        id: uuidv7(), tenant_id: tenantId!, name: i.name.trim(), ref_number: i.ref_number?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useSetProjectStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { id: string; status: 'open' | 'closed' }) => {
      const { error } = await supabase.from('projects').update({ status: i.status }).eq('id', i.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}
