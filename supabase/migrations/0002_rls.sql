-- ============================================================================
-- Tapventory — migracja 0002: RLS (Row Level Security)
-- ============================================================================
-- Co tu się dzieje (dla juniora):
--   * "enable row level security" = od teraz tabela jest DOMYŚLNIE ZAMKNIĘTA.
--     Bez pasującej polityki zapytanie zwraca zero wierszy / odmowę zapisu —
--     nawet jeśli kod aplikacji ma błąd. To jest ta warstwa, której brakowało
--     w starym projekcie (pamiętasz endpoint /all?).
--   * Polityka = reguła "kiedy wolno": USING dotyczy czytania/zmiany
--     istniejących wierszy, WITH CHECK — wierszy zapisywanych.
--   * Wszystkie polityki dotyczą roli "authenticated" (zalogowany użytkownik).
--     Backend z kluczem service_role omija RLS z definicji — dlatego ten klucz
--     NIGDY nie trafia do aplikacji mobilnej.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. WŁĄCZENIE RLS NA KAŻDEJ TABELI (bez wyjątków!)
-- ----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.tenants           enable row level security;
alter table public.memberships       enable row level security;
alter table public.tenant_invites    enable row level security;
alter table public.suppliers         enable row level security;
alter table public.catalog_items     enable row level security;
alter table public.products          enable row level security;
alter table public.projects          enable row level security;
alter table public.documents         enable row level security;
alter table public.document_lines    enable row level security;
alter table public.stock_movements   enable row level security;
alter table public.requests          enable row level security;
alter table public.request_messages  enable row level security;
alter table public.audit_log         enable row level security;
alter table public.referral_codes    enable row level security;
alter table public.referrals         enable row level security;
alter table public.reward_ledger     enable row level security;
alter table public.ksef_integrations enable row level security;
-- Uwaga: ksef_integrations celowo NIE dostaje żadnych polityk — czyta ją
-- wyłącznie backend (service_role). Zalogowany użytkownik widzi pustkę.

-- ----------------------------------------------------------------------------
-- 2. PROFILES — swój profil + profile kolegów z firmy (do czatu i list)
-- ----------------------------------------------------------------------------
create policy "profiles: własny lub kolegi z firmy"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_tenant_with(id));

create policy "profiles: edycja własnego"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- (INSERT robi trigger handle_new_user; DELETE kaskadą przy usunięciu konta.)

-- ----------------------------------------------------------------------------
-- 3. TENANTS — widzą członkowie, edytuje kierownictwo, usuwa właściciel
-- ----------------------------------------------------------------------------
create policy "tenants: podgląd dla członków"
  on public.tenants for select to authenticated
  using (public.is_member(id));

create policy "tenants: edycja przez kierownictwo"
  on public.tenants for update to authenticated
  using (public.can_manage(id))
  with check (public.can_manage(id));

create policy "tenants: usunięcie przez właściciela"
  on public.tenants for delete to authenticated
  using (public.is_owner(id));

-- (INSERT wyłącznie przez RPC create_tenant — brak polityki = brak bezpośrednich
--  wstawień; funkcja security definer działa z pominięciem RLS.)

-- ----------------------------------------------------------------------------
-- 4. MEMBERSHIPS — lista zespołu dla członków; usuwanie wg macierzy ról
-- ----------------------------------------------------------------------------
create policy "memberships: podgląd zespołu"
  on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.is_member(tenant_id));

-- Zmiany ról/flag: technicznie UPDATE robi właściciel; szczegóły pilnuje
-- trigger membership_guard (0001, sekcja 6).
create policy "memberships: zmiany przez właściciela"
  on public.memberships for update to authenticated
  using (public.is_owner(tenant_id))
  with check (public.is_owner(tenant_id));

-- Usuwanie: sam siebie (wyjście z firmy) / właściciel każdego /
-- kierownik pracownika / kierownik-z-flagą także kierownika.
-- Ostatniego właściciela chroni trigger membership_delete_guard.
create policy "memberships: usuwanie wg ról"
  on public.memberships for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_owner(tenant_id)
    or (role = 'employee' and public.can_manage(tenant_id))
    or (role in ('employee', 'manager') and public.can_manage_managers(tenant_id))
  );

-- (INSERT wyłącznie przez RPC create_tenant / accept_invite.)

-- ----------------------------------------------------------------------------
-- 5. TENANT_INVITES — zarządza kierownictwo (wystawia RPC create_invite)
-- ----------------------------------------------------------------------------
create policy "invites: podgląd dla kierownictwa"
  on public.tenant_invites for select to authenticated
  using (public.can_manage(tenant_id));

create policy "invites: cofanie przez kierownictwo"
  on public.tenant_invites for update to authenticated
  using (public.can_manage(tenant_id))
  with check (public.can_manage(tenant_id));

create policy "invites: usuwanie przez kierownictwo"
  on public.tenant_invites for delete to authenticated
  using (public.can_manage(tenant_id));

-- ----------------------------------------------------------------------------
-- 6. SUPPLIERS / PRODUCTS / PROJECTS — czytają wszyscy w firmie,
--    zapisuje kierownictwo (pracownik zgłasza braki, nie edytuje katalogu)
-- ----------------------------------------------------------------------------
create policy "suppliers: podgląd" on public.suppliers for select to authenticated
  using (public.is_member(tenant_id));
create policy "suppliers: dodawanie" on public.suppliers for insert to authenticated
  with check (public.can_manage(tenant_id));
create policy "suppliers: edycja" on public.suppliers for update to authenticated
  using (public.can_manage(tenant_id)) with check (public.can_manage(tenant_id));
create policy "suppliers: usuwanie" on public.suppliers for delete to authenticated
  using (public.can_manage(tenant_id));

create policy "products: podgląd" on public.products for select to authenticated
  using (public.is_member(tenant_id));
create policy "products: dodawanie" on public.products for insert to authenticated
  with check (public.can_manage(tenant_id));
create policy "products: edycja" on public.products for update to authenticated
  using (public.can_manage(tenant_id)) with check (public.can_manage(tenant_id));
create policy "products: usuwanie" on public.products for delete to authenticated
  using (public.can_manage(tenant_id));
-- Uwaga: produkt z historią ruchów i tak nie zniknie — klucz obcy w
-- stock_movements ma ON DELETE RESTRICT. Zamiast kasować, ustawia się active=false.

create policy "projects: podgląd" on public.projects for select to authenticated
  using (public.is_member(tenant_id));
create policy "projects: dodawanie" on public.projects for insert to authenticated
  with check (public.can_manage(tenant_id));
create policy "projects: edycja" on public.projects for update to authenticated
  using (public.can_manage(tenant_id)) with check (public.can_manage(tenant_id));
create policy "projects: usuwanie" on public.projects for delete to authenticated
  using (public.can_manage(tenant_id));

-- ----------------------------------------------------------------------------
-- 7. CATALOG_ITEMS — katalog globalny: czytają wszyscy zalogowani,
--    dopisywać może każdy (kuracja później), edycji/usuwania brak
-- ----------------------------------------------------------------------------
create policy "catalog: podgląd dla zalogowanych"
  on public.catalog_items for select to authenticated
  using (true);

create policy "catalog: dopisywanie z podpisem"
  on public.catalog_items for insert to authenticated
  with check (created_by = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 8. DOCUMENTS / DOCUMENT_LINES — faktury obsługuje kierownictwo
-- ----------------------------------------------------------------------------
create policy "documents: podgląd" on public.documents for select to authenticated
  using (public.is_member(tenant_id));
create policy "documents: dodawanie" on public.documents for insert to authenticated
  with check (public.can_manage(tenant_id));
create policy "documents: edycja" on public.documents for update to authenticated
  using (public.can_manage(tenant_id)) with check (public.can_manage(tenant_id));
-- Zaksięgowanych pilnuje trigger lock_posted_document (0001).
create policy "documents: usuwanie szkiców" on public.documents for delete to authenticated
  using (public.can_manage(tenant_id) and status = 'draft');

create policy "doclines: podgląd" on public.document_lines for select to authenticated
  using (public.is_member(tenant_id));
create policy "doclines: dodawanie" on public.document_lines for insert to authenticated
  with check (
    public.can_manage(tenant_id)
    and exists (   -- pozycja musi należeć do dokumentu tej samej firmy,
                   -- który nie jest jeszcze zaksięgowany
      select 1 from public.documents d
      where d.id = document_id and d.tenant_id = document_lines.tenant_id
        and d.status <> 'posted'
    )
  );
create policy "doclines: edycja" on public.document_lines for update to authenticated
  using (
    public.can_manage(tenant_id)
    and exists (select 1 from public.documents d
                where d.id = document_id and d.status <> 'posted')
  )
  with check (public.can_manage(tenant_id));
create policy "doclines: usuwanie" on public.document_lines for delete to authenticated
  using (
    public.can_manage(tenant_id)
    and exists (select 1 from public.documents d
                where d.id = document_id and d.status <> 'posted')
  );

-- ----------------------------------------------------------------------------
-- 9. STOCK_MOVEMENTS — dopisuje każdy członek (akcja "Zdejmij"!),
--    podpis wykonawcy wymuszony, zmian i kasowania brak (append-only)
-- ----------------------------------------------------------------------------
create policy "movements: podgląd" on public.stock_movements for select to authenticated
  using (public.is_member(tenant_id));

create policy "movements: dopisywanie z podpisem"
  on public.stock_movements for insert to authenticated
  with check (
    public.is_member(tenant_id)
    and created_by = (select auth.uid())
  );
-- Zgodność produkt↔firma pilnuje trigger movement_same_tenant (0001).
-- Brak polityk UPDATE/DELETE + trigger forbid_change = księga jest nienaruszalna.

-- ----------------------------------------------------------------------------
-- 10. REQUESTS — zgłasza każdy; edytuje autor (póki "reported") lub kierownictwo
-- ----------------------------------------------------------------------------
create policy "requests: podgląd" on public.requests for select to authenticated
  using (public.is_member(tenant_id));

create policy "requests: zgłaszanie z podpisem"
  on public.requests for insert to authenticated
  with check (
    public.is_member(tenant_id)
    and reporter_id = (select auth.uid())
  );

create policy "requests: edycja autora lub kierownictwa"
  on public.requests for update to authenticated
  using (
    public.can_manage(tenant_id)
    or (reporter_id = (select auth.uid()) and status = 'reported')
  )
  with check (public.is_member(tenant_id));

create policy "requests: wycofanie własnego lub przez kierownictwo"
  on public.requests for delete to authenticated
  using (
    public.can_manage(tenant_id)
    or (reporter_id = (select auth.uid()) and status = 'reported')
  );

-- ----------------------------------------------------------------------------
-- 11. REQUEST_MESSAGES — czat: czyta firma, pisze członek pod swoim nazwiskiem
-- ----------------------------------------------------------------------------
create policy "messages: podgląd" on public.request_messages for select to authenticated
  using (public.is_member(tenant_id));

create policy "messages: pisanie z podpisem"
  on public.request_messages for insert to authenticated
  with check (
    public.is_member(tenant_id)
    and author_id = (select auth.uid())
    and exists (   -- wiadomość tylko do zgłoszenia z tej samej firmy
      select 1 from public.requests r
      where r.id = request_id and r.tenant_id = request_messages.tenant_id
    )
  );

-- ----------------------------------------------------------------------------
-- 12. AUDIT_LOG — czyta kierownictwo; pisze wyłącznie trigger (security definer)
-- ----------------------------------------------------------------------------
create policy "audit: podgląd dla kierownictwa"
  on public.audit_log for select to authenticated
  using (tenant_id is not null and public.can_manage(tenant_id));

-- ----------------------------------------------------------------------------
-- 13. POLECENIA — właściciel widzi swój kod i swoje polecenia
-- ----------------------------------------------------------------------------
create policy "refcodes: podgląd własnego"
  on public.referral_codes for select to authenticated
  using (public.is_member(tenant_id));

create policy "referrals: podgląd stron polecenia"
  on public.referrals for select to authenticated
  using (public.is_owner(code_tenant_id) or public.is_owner(referred_tenant_id));

create policy "ledger: podgląd właściciela"
  on public.reward_ledger for select to authenticated
  using (public.is_owner(tenant_id));
-- Zapisy w tych tabelach robi wyłącznie backend (webhook Stripe, RPC).

-- ============================================================================
-- 14. STORAGE — prywatne koszyki plików + reguły "folder = firma"
-- ============================================================================
-- Konwencja ścieżki KAŻDEGO pliku:  <tenant_id>/<podfolder>/<nazwa>
-- np. 3f2b.../documents/2026-08-18-faktura-1-strona-1.jpg
-- Pierwszy segment ścieżki to identyfikator firmy — i na nim opierają się
-- reguły dostępu poniżej.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false),
       ('product-photos', 'product-photos', false)
on conflict (id) do nothing;

-- Bezpieczne wyciągnięcie tenant_id ze ścieżki pliku.
-- Gdy pierwszy segment nie jest poprawnym UUID — zwracamy NULL,
-- a is_member(NULL) = false, czyli dostęp odcięty (a nie błąd zapytania).
create or replace function public.path_tenant(object_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function public.path_tenant(text) to authenticated;

create policy "storage: odczyt w obrębie firmy"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('documents', 'product-photos')
    and public.is_member(public.path_tenant(name))
  );

create policy "storage: zapis w obrębie firmy"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('documents', 'product-photos')
    and public.is_member(public.path_tenant(name))
  );

create policy "storage: usuwanie przez kierownictwo"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('documents', 'product-photos')
    and public.can_manage(public.path_tenant(name))
  );

-- ============================================================================
-- 15. REALTIME — kanały "na żywo" dla zgłoszeń i czatu
--     (aplikacja dostaje zmiany bez odświeżania; Realtime respektuje RLS)
-- ============================================================================
alter publication supabase_realtime add table public.requests;
alter publication supabase_realtime add table public.request_messages;

-- ============================================================================
-- KONIEC 0002. Test całości: `supabase db reset` musi przejść bez błędów.
-- ============================================================================
