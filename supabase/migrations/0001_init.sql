-- ============================================================================
-- Tapventory — migracja 0001: SCHEMAT BAZY DANYCH
-- ============================================================================
-- Jak czytać ten plik (dla juniora):
--   * "Migracja" to przepis na zmianę struktury bazy. Uruchamia się RAZ,
--     w kolejności numerów plików. Nigdy nie edytujemy starej migracji po
--     wdrożeniu na prod — piszemy nową (0003, 0004...).
--   * Konwencja nazw: identyfikatory po angielsku (standard branżowy),
--     komentarze i teksty błędów po polsku.
--   * Każda tabela biznesowa ma kolumnę tenant_id = "do której firmy należy
--     ten wiersz". To oś całego bezpieczeństwa (RLS w pliku 0002).
--   * Klucze główne to UUID. Domyślnie generuje je baza (gen_random_uuid),
--     ale aplikacja MOŻE przysłać własny UUID v7 — warunek trybu offline.
-- ============================================================================

-- Rozszerzenie do generowania UUID (w Supabase już jest; "if not exists"
-- sprawia, że polecenie jest bezpieczne przy ponownym uruchomieniu).
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. TYPY WYLICZENIOWE (enum = zamknięta lista dozwolonych wartości).
--    Baza fizycznie nie przyjmie wartości spoza listy — pierwsza linia obrony
--    przed literówkami typu "menager".
-- ----------------------------------------------------------------------------
create type public.member_role     as enum ('owner', 'manager', 'employee');
create type public.movement_type   as enum ('receipt', 'issue', 'adjustment', 'return');
--  receipt = przyjęcie (+), issue = rozchód (−), adjustment = korekta ze spisu (±),
--  return = zwrot do dostawcy (−)
create type public.document_source as enum ('ksef', 'photo', 'manual');
create type public.document_status as enum ('draft', 'verified', 'posted');
--  draft = szkic z AI/KSeF, verified = sprawdzony przez człowieka,
--  posted = zaksięgowany (wpłynął na stany; od tej chwili tylko do odczytu)
create type public.request_status  as enum ('reported', 'accepted', 'ordered', 'delivered', 'received', 'rejected');
create type public.project_type    as enum ('vehicle', 'job', 'event', 'client', 'other');
create type public.project_status  as enum ('open', 'closed');
create type public.invite_status   as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.referral_status as enum ('registered', 'activated', 'rewarded');

-- ----------------------------------------------------------------------------
-- 2. FUNKCJE TECHNICZNE (używane przez triggery niżej)
-- ----------------------------------------------------------------------------

-- Automatyczne ustawianie updated_at przy każdej zmianie wiersza.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Blokada zmian: tabele "tylko dopisywanie" (append-only).
-- Ruchy magazynowe i dziennik zdarzeń wolno DOPISYWAĆ, nigdy zmieniać/kasować.
-- Pomyłkę koryguje się NOWYM ruchem przeciwnym — jak w księgowości.
create or replace function public.forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Tabela % jest tylko do dopisywania. Pomyłkę koryguje się nowym wpisem, nie edycją.', tg_table_name
    using errcode = 'P0001';
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. TABELE
--    Kolejność ma znaczenie: tabela może wskazywać (klucz obcy) tylko na
--    tabelę, która już istnieje.
-- ----------------------------------------------------------------------------

-- 3.1 PROFILE UŻYTKOWNIKÓW ---------------------------------------------------
-- Konta (e-mail, hasło) trzyma wbudowany moduł Supabase w schemacie auth.users.
-- Tabeli auth.users NIE modyfikujemy. Nasze dodatkowe dane (wyświetlana nazwa,
-- telefon) trzymamy obok, w public.profiles, połączone tym samym id.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  phone        text check (phone ~ '^\+?[0-9 ]{7,20}$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Gdy powstaje konto w auth.users → automatycznie tworzymy profil.
-- security definer = funkcja działa z uprawnieniami właściciela bazy,
-- bo zwykły użytkownik nie ma prawa pisać "w cudzym imieniu".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3.2 FIRMY (TENANTS) --------------------------------------------------------
create table public.tenants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 2 and 120),
  nip          text check (nip ~ '^[0-9]{10}$'),          -- polski NIP: 10 cyfr
  country      char(2) not null default 'PL',
  address_line text,
  city         text,
  postal_code  text,
  lat          numeric(9, 6),                              -- geolokalizacja —
  lng          numeric(9, 6),                              -- furtka pod marketplace
  industry     text,                                       -- np. 'beauty', 'auto'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_tenants_updated before update on public.tenants
  for each row execute function public.set_updated_at();

-- 3.3 CZŁONKOSTWA (kto należy do której firmy i w jakiej roli) ---------------
create table public.memberships (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  role                public.member_role not null default 'employee',
  can_manage_managers boolean not null default false,      -- flaga: kierownik może
                                                           -- zarządzać kierownikami
  created_at          timestamptz not null default now(),
  unique (tenant_id, user_id)   -- jedna osoba = jedno członkostwo w danej firmie
);
create index idx_memberships_user   on public.memberships (user_id);
create index idx_memberships_tenant on public.memberships (tenant_id);

-- 3.4 ZAPROSZENIA DO FIRMY ---------------------------------------------------
create table public.tenant_invites (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  email               text not null check (position('@' in email) > 1),
  role                public.member_role not null default 'employee',
  can_manage_managers boolean not null default false,
  token               uuid not null unique default gen_random_uuid(),
  status              public.invite_status not null default 'pending',
  invited_by          uuid not null references auth.users (id),
  expires_at          timestamptz not null default now() + interval '7 days',
  created_at          timestamptz not null default now()
);
create index idx_invites_tenant on public.tenant_invites (tenant_id);

-- 3.5 DOSTAWCY ---------------------------------------------------------------
create table public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 160),
  nip        text check (nip ~ '^[0-9]{10}$'),
  email      text,
  phone      text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_suppliers_tenant on public.suppliers (tenant_id);
create trigger trg_suppliers_updated before update on public.suppliers
  for each row execute function public.set_updated_at();

-- 3.6 GLOBALNY KATALOG PRODUKTÓW ---------------------------------------------
-- Wspólny słownik dla wszystkich firm (bez tenant_id!) — "wspólny język"
-- produktów, fundament pod marketplace. EAN = kod kreskowy 8 lub 13 cyfr.
create table public.catalog_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 200),
  brand      text,
  ean        text unique check (ean ~ '^[0-9]{8}$' or ean ~ '^[0-9]{13}$'),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index idx_catalog_ean on public.catalog_items (ean);

-- 3.7 PRODUKTY FIRMY ---------------------------------------------------------
create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  catalog_item_id     uuid references public.catalog_items (id),
  name                text not null check (char_length(name) between 1 and 200),
  ean                 text check (ean ~ '^[0-9]{8}$' or ean ~ '^[0-9]{13}$'),
  unit                text not null default 'szt.',
  pack_size           numeric(10, 3) not null default 1 check (pack_size > 0),
  min_stock           numeric(12, 3) not null default 0 check (min_stock >= 0),
  default_supplier_id uuid references public.suppliers (id) on delete set null,
  photo_path          text,          -- ścieżka w Storage: tenant_id/products/...
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_products_tenant on public.products (tenant_id);
create index idx_products_ean    on public.products (tenant_id, ean);
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();

-- 3.8 PROJEKTY / ZLECENIA (VIN, impreza, klient) -----------------------------
create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  type       public.project_type not null default 'other',
  name       text not null check (char_length(name) between 1 and 160),
  ref_number text,                                  -- VIN / nr rej. / nr zlecenia
  status     public.project_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_projects_tenant on public.projects (tenant_id, status);
create trigger trg_projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

-- 3.9 DOKUMENTY (faktury z KSeF / zdjęcia / ręczne) --------------------------
create table public.documents (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  source         public.document_source not null,
  status         public.document_status not null default 'draft',
  supplier_id    uuid references public.suppliers (id) on delete set null,
  supplier_name  text,
  supplier_nip   text check (supplier_nip ~ '^[0-9]{10}$'),
  invoice_number text,
  ksef_number    text,                       -- numer nadany przez KSeF (jeśli źródło ksef)
  issue_date     date,
  currency       char(3) not null default 'PLN',
  total_net      numeric(12, 2),
  total_gross    numeric(12, 2),
  file_paths     text[] not null default '{}',   -- strony zdjęć w Storage
  error_message  text,                            -- komunikat, gdy AI/parser poległ
  created_by     uuid references auth.users (id),
  posted_by      uuid references auth.users (id),
  posted_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_documents_tenant on public.documents (tenant_id, status);
create trigger trg_documents_updated before update on public.documents
  for each row execute function public.set_updated_at();

-- Kontrola duplikatów: ta sama faktura (NIP dostawcy + numer) w jednej firmie
-- może istnieć tylko raz. "Unikalny indeks częściowy" — działa tylko, gdy oba
-- pola są wypełnione.
create unique index documents_duplicate_guard
  on public.documents (tenant_id, supplier_nip, lower(invoice_number))
  where supplier_nip is not null and invoice_number is not null;

-- Zaksięgowany dokument = tylko do odczytu. Zamek w triggerze:
create or replace function public.lock_posted_document()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'posted' then
    raise exception 'Dokument zaksięgowany jest tylko do odczytu. Korektę wprowadź nowym dokumentem.'
      using errcode = 'P0001';
  end if;
  -- Uwaga (lekcja triggerów): przy DELETE zmienna "new" jest pusta (NULL),
  -- a zwrócenie NULL z triggera BEFORE po cichu ANULUJE operację.
  -- coalesce zwraca właściwy wiersz i dla UPDATE, i dla DELETE.
  return coalesce(new, old);
end;
$$;
create trigger trg_documents_lock before update or delete on public.documents
  for each row execute function public.lock_posted_document();

-- 3.10 POZYCJE DOKUMENTU -----------------------------------------------------
create table public.document_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  document_id      uuid not null references public.documents (id) on delete cascade,
  line_no          int not null default 1,
  raw_name         text not null,               -- nazwa tak, jak stała na fakturze
  qty              numeric(12, 3) not null check (qty > 0),
  unit             text,
  unit_price_net   numeric(12, 4),
  product_id       uuid references public.products (id),   -- dopasowany produkt
  match_confidence smallint check (match_confidence between 0 and 100),
  project_id       uuid references public.projects (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index idx_doclines_document on public.document_lines (document_id);
create index idx_doclines_tenant   on public.document_lines (tenant_id);

-- 3.11 RUCHY MAGAZYNOWE (serce systemu) --------------------------------------
-- Stan magazynowy NIE jest kolumną. Stan = suma ruchów (widok niżej).
-- Dzięki temu dwa telefony dopisujące ruchy nigdy nie nadpisują sobie danych.
create table public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete restrict,
  movement_type public.movement_type not null,
  qty           numeric(12, 3) not null,
  document_id   uuid references public.documents (id) on delete set null,
  project_id    uuid references public.projects (id) on delete set null,
  note          text,
  created_by    uuid not null references auth.users (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  -- Konwencja znaków wymuszona przez bazę:
  --   przyjęcie: qty > 0;  rozchód i zwrot: qty < 0;  korekta: dowolny znak ≠ 0
  constraint qty_sign_matches_type check (
    (movement_type = 'receipt'                and qty > 0) or
    (movement_type in ('issue', 'return')     and qty < 0) or
    (movement_type = 'adjustment'             and qty <> 0)
  )
);
create index idx_movements_product on public.stock_movements (product_id);
create index idx_movements_tenant  on public.stock_movements (tenant_id, created_at desc);

create trigger trg_movements_append_only before update or delete on public.stock_movements
  for each row execute function public.forbid_change();

-- Bezpiecznik spójności: produkt w ruchu musi należeć do tej samej firmy.
create or replace function public.movement_same_tenant()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.products p
    where p.id = new.product_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'Produkt nie należy do tej firmy.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_movements_same_tenant before insert on public.stock_movements
  for each row execute function public.movement_same_tenant();

-- 3.12 ZGŁOSZENIA BRAKÓW / ZAMÓWIENIA ----------------------------------------
create table public.requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  product_id  uuid references public.products (id) on delete set null,
  free_name   text,                       -- opis, gdy produktu nie ma w katalogu
  photo_path  text,
  qty         numeric(12, 3) check (qty is null or qty > 0),
  note        text,
  status      public.request_status not null default 'reported',
  project_id  uuid references public.projects (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  reporter_id uuid not null references auth.users (id) default auth.uid(),
  accepted_at  timestamptz,
  ordered_at   timestamptz,
  delivered_at timestamptz,
  received_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Zgłoszenie musi wskazywać produkt ALBO mieć opis słowny:
  constraint request_has_subject check (product_id is not null or free_name is not null)
);
create index idx_requests_tenant on public.requests (tenant_id, status, created_at desc);
create trigger trg_requests_updated before update on public.requests
  for each row execute function public.set_updated_at();

-- 3.13 CZAT PRZY ZGŁOSZENIU --------------------------------------------------
create table public.request_messages (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  request_id uuid not null references public.requests (id) on delete cascade,
  author_id  uuid not null references auth.users (id) default auth.uid(),
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index idx_messages_request on public.request_messages (request_id, created_at);
create trigger trg_messages_append_only before update or delete on public.request_messages
  for each row execute function public.forbid_change();

-- 3.14 DZIENNIK ZDARZEŃ (audit log) ------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  tenant_id  uuid,
  user_id    uuid,
  action     text not null,            -- INSERT / UPDATE / DELETE
  table_name text not null,
  row_id     uuid,
  data       jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_tenant on public.audit_log (tenant_id, created_at desc);
create trigger trg_audit_append_only before update or delete on public.audit_log
  for each row execute function public.forbid_change();

-- Uniwersalny rejestrator: dopisuje ślad po każdej zmianie w kluczowych
-- tabelach. security definer, bo zwykły użytkownik nie ma prawa INSERT
-- do audit_log (i bardzo dobrze — dziennika nie wolno fałszować).
create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (tenant_id, user_id, action, table_name, row_id, data)
  values (
    coalesce(new.tenant_id, old.tenant_id),
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_audit_memberships after insert or update or delete on public.memberships
  for each row execute function public.log_audit();
create trigger trg_audit_products    after insert or update or delete on public.products
  for each row execute function public.log_audit();
create trigger trg_audit_documents   after insert or update or delete on public.documents
  for each row execute function public.log_audit();
create trigger trg_audit_requests    after insert or update or delete on public.requests
  for each row execute function public.log_audit();
create trigger trg_audit_suppliers   after insert or update or delete on public.suppliers
  for each row execute function public.log_audit();

-- 3.15 PROGRAM POLECEŃ -------------------------------------------------------
create table public.referral_codes (
  tenant_id  uuid primary key references public.tenants (id) on delete cascade,
  code       text not null unique check (char_length(code) between 6 and 24),
  created_at timestamptz not null default now()
);

create table public.referrals (
  id                 uuid primary key default gen_random_uuid(),
  code_tenant_id     uuid not null references public.referral_codes (tenant_id),
  referred_tenant_id uuid not null unique references public.tenants (id),
  status             public.referral_status not null default 'registered',
  created_at         timestamptz not null default now(),
  activated_at       timestamptz,
  rewarded_at        timestamptz,
  constraint no_self_referral check (code_tenant_id <> referred_tenant_id)
);

create table public.reward_ledger (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  days        int not null check (days > 0),
  reason      text not null,
  referral_id uuid references public.referrals (id),
  created_at  timestamptz not null default now()
);
create trigger trg_ledger_append_only before update or delete on public.reward_ledger
  for each row execute function public.forbid_change();

-- 3.16 INTEGRACJA KSeF (wypełniana w tygodniach 10–12) -----------------------
-- Tokeny klientów to klucze do ich faktur: tabela ma włączone RLS i CELOWO
-- zero polityk dla zwykłych użytkowników — czyta ją wyłącznie backend
-- (Edge Functions z kluczem service_role). Sam sekret trafi do Supabase Vault,
-- tu trzymamy tylko odnośnik.
create table public.ksef_integrations (
  tenant_id       uuid primary key references public.tenants (id) on delete cascade,
  token_secret_id uuid,                 -- odnośnik do sekretu w Vault
  status          text not null default 'disconnected',
  last_sync_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_ksef_updated before update on public.ksef_integrations
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. WIDOK STANÓW MAGAZYNOWYCH
--    security_invoker = widok "dziedziczy" uprawnienia pytającego, więc RLS
--    tabel źródłowych nadal obowiązuje (firma widzi tylko swoje stany).
-- ----------------------------------------------------------------------------
create view public.product_stock
with (security_invoker = true)
as
select
  p.id          as product_id,
  p.tenant_id,
  p.name,
  p.unit,
  p.min_stock,
  p.active,
  coalesce(sum(m.qty), 0) as stock,
  (coalesce(sum(m.qty), 0) < p.min_stock) as below_min
from public.products p
left join public.stock_movements m on m.product_id = p.id
group by p.id;

-- ----------------------------------------------------------------------------
-- 5. FUNKCJE UPRAWNIEŃ (używane przez polityki RLS w pliku 0002)
--    security definer = funkcja czyta memberships Z POMINIĘCIEM RLS.
--    To celowe i bezpieczne: funkcja odpowiada tylko "tak/nie" na pytanie
--    o członkostwo — i przerywa błędne koło "żeby sprawdzić uprawnienia,
--    muszę mieć uprawnienia".
--    (select auth.uid()) zamiast auth.uid() — udokumentowana optymalizacja:
--    Postgres policzy to raz na zapytanie, nie raz na wiersz.
-- ----------------------------------------------------------------------------

create or replace function public.is_member(t uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = t and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.my_role(t uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.memberships m
  where m.tenant_id = t and m.user_id = (select auth.uid());
$$;

create or replace function public.is_owner(t uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role(t) = 'owner';
$$;

-- can_manage = kierownik lub właściciel (zarządza katalogiem, fakturami itd.)
create or replace function public.can_manage(t uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role(t) in ('owner', 'manager');
$$;

-- Czy pytający ma "władzę nad kierownikami": właściciel LUB kierownik z flagą.
create or replace function public.can_manage_managers(t uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = t
      and m.user_id = (select auth.uid())
      and (m.role = 'owner' or (m.role = 'manager' and m.can_manage_managers))
  );
$$;

-- Czy dwoje użytkowników dzieli jakąkolwiek firmę (do podglądu profili kolegów).
create or replace function public.shares_tenant_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships a
    join public.memberships b on a.tenant_id = b.tenant_id
    where a.user_id = (select auth.uid()) and b.user_id = other
  );
$$;

create or replace function public.owners_count(t uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.memberships
  where tenant_id = t and role = 'owner';
$$;

-- ----------------------------------------------------------------------------
-- 6. STRAŻNICY CZŁONKOSTW (triggery na memberships)
-- ----------------------------------------------------------------------------

-- 6.1 Reguły zmian: kto może zmieniać role i flagi.
create or replace function public.membership_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Członkostwa nie przenosi się między firmami ani osobami:
  if new.tenant_id <> old.tenant_id or new.user_id <> old.user_id then
    raise exception 'Nie można przenieść członkostwa.' using errcode = 'P0001';
  end if;

  -- Zmiana roli lub flagi can_manage_managers: wyłącznie właściciel.
  if (new.role is distinct from old.role)
     or (new.can_manage_managers is distinct from old.can_manage_managers) then
    if not public.is_owner(old.tenant_id) then
      raise exception 'Role i flagę uprawnień zmienia wyłącznie właściciel.'
        using errcode = 'P0001';
    end if;
  end if;

  -- Ochrona ostatniego właściciela przed degradacją:
  if old.role = 'owner' and new.role <> 'owner'
     and public.owners_count(old.tenant_id) <= 1 then
    raise exception 'Firma musi mieć co najmniej jednego właściciela.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
create trigger trg_membership_guard before update on public.memberships
  for each row execute function public.membership_guard();

-- 6.2 Ochrona ostatniego właściciela przed usunięciem.
create or replace function public.membership_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Wyjątek od reguły: gdy usuwana jest CAŁA firma (kaskada z tabeli tenants),
  -- wiersz firmy już nie istnieje — wtedy członkostwa mają prawo zniknąć.
  -- Bez tego warunku właściciel nie mógłby nigdy usunąć własnej firmy.
  if old.role = 'owner'
     and public.owners_count(old.tenant_id) <= 1
     and exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    raise exception 'Nie można usunąć ostatniego właściciela firmy.'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;
create trigger trg_membership_delete_guard before delete on public.memberships
  for each row execute function public.membership_delete_guard();

-- ----------------------------------------------------------------------------
-- 7. RPC — "przyciski" wywoływane przez aplikację
--    (RPC = zdalne wywołanie funkcji; aplikacja robi supabase.rpc('nazwa')).
--    Operacje wieloetapowe pakujemy w jedną funkcję: wykonują się w CAŁOŚCI
--    albo WCALE (transakcja) i trzymają logikę po stronie serwera.
-- ----------------------------------------------------------------------------

-- 7.1 Założenie firmy: tworzy firmę + członkostwo właściciela + kod poleceń.
create or replace function public.create_tenant(p_name text, p_nip text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_code   text;
begin
  if v_uid is null then
    raise exception 'Wymagane zalogowanie.' using errcode = 'P0001';
  end if;

  insert into public.tenants (name, nip)
  values (trim(p_name), nullif(trim(p_nip), ''))
  returning id into v_tenant;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_tenant, v_uid, 'owner');

  -- Kod poleceń: TV- + 6 znaków, z gwarancją unikalności.
  loop
    v_code := 'TV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.referral_codes (tenant_id, code) values (v_tenant, v_code);
      exit;
    exception when unique_violation then
      -- wylosowany kod już istnieje (skrajnie rzadkie) — losujemy ponownie
    end;
  end loop;

  return v_tenant;
end;
$$;

-- 7.2 Zaproszenie do firmy (z macierzą uprawnień wewnątrz).
create or replace function public.create_invite(
  p_tenant uuid,
  p_email  text,
  p_role   public.member_role default 'employee',
  p_flag   boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if p_role = 'owner' then
    if not public.is_owner(p_tenant) then
      raise exception 'Współwłaściciela zaprasza wyłącznie właściciel.' using errcode = 'P0001';
    end if;
  elsif p_role = 'manager' then
    if not public.can_manage_managers(p_tenant) then
      raise exception 'Kierownika zaprasza właściciel lub kierownik z uprawnieniem.' using errcode = 'P0001';
    end if;
  else
    if not public.can_manage(p_tenant) then
      raise exception 'Pracownika zaprasza kierownik lub właściciel.' using errcode = 'P0001';
    end if;
  end if;

  if p_flag and not public.is_owner(p_tenant) then
    raise exception 'Flagę zarządzania kierownikami nadaje wyłącznie właściciel.' using errcode = 'P0001';
  end if;

  insert into public.tenant_invites (tenant_id, email, role, can_manage_managers, invited_by)
  values (p_tenant, lower(trim(p_email)), p_role, p_flag, auth.uid())
  returning token into v_token;

  return v_token;
end;
$$;

-- 7.3 Przyjęcie zaproszenia (klik w link z maila → aplikacja woła tę funkcję).
create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.tenant_invites%rowtype;
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  select * into v_invite
  from public.tenant_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'Zaproszenie nie istnieje.' using errcode = 'P0001';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Zaproszenie zostało już użyte lub cofnięte.' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    update public.tenant_invites set status = 'expired' where id = v_invite.id;
    raise exception 'Zaproszenie wygasło. Poproś o nowe.' using errcode = 'P0001';
  end if;
  if v_email <> lower(v_invite.email) then
    raise exception 'Zaproszenie wystawiono na inny adres e-mail (%).', v_invite.email
      using errcode = 'P0001';
  end if;

  insert into public.memberships (tenant_id, user_id, role, can_manage_managers)
  values (v_invite.tenant_id, auth.uid(), v_invite.role, v_invite.can_manage_managers)
  on conflict (tenant_id, user_id) do nothing;

  update public.tenant_invites set status = 'accepted' where id = v_invite.id;

  return v_invite.tenant_id;
end;
$$;

-- 7.4 Nadanie/odebranie flagi kierownikowi (tylko właściciel).
create or replace function public.set_manager_flag(p_membership uuid, p_flag boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_role   public.member_role;
begin
  select tenant_id, role into v_tenant, v_role
  from public.memberships where id = p_membership;

  if not found then
    raise exception 'Członkostwo nie istnieje.' using errcode = 'P0001';
  end if;
  if not public.is_owner(v_tenant) then
    raise exception 'Flagę nadaje wyłącznie właściciel.' using errcode = 'P0001';
  end if;
  if v_role <> 'manager' then
    raise exception 'Flaga dotyczy tylko kierowników.' using errcode = 'P0001';
  end if;

  update public.memberships set can_manage_managers = p_flag where id = p_membership;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. UPRAWNIENIA DO FUNKCJI
--    Domyślnie Postgres daje "public" prawo wykonywania funkcji — zawężamy:
--    anonimowi (rola anon) nie mają czego szukać przy RPC firmowych.
-- ----------------------------------------------------------------------------
revoke execute on function public.create_tenant(text, text)                              from public, anon;
revoke execute on function public.create_invite(uuid, text, public.member_role, boolean) from public, anon;
revoke execute on function public.accept_invite(uuid)                                    from public, anon;
revoke execute on function public.set_manager_flag(uuid, boolean)                        from public, anon;

grant execute on function public.create_tenant(text, text)                               to authenticated;
grant execute on function public.create_invite(uuid, text, public.member_role, boolean)  to authenticated;
grant execute on function public.accept_invite(uuid)                                     to authenticated;
grant execute on function public.set_manager_flag(uuid, boolean)                         to authenticated;

-- Funkcje pomocnicze wołane wewnątrz polityk RLS muszą być wykonywalne
-- przez zalogowanych:
grant execute on function public.is_member(uuid)          to authenticated;
grant execute on function public.my_role(uuid)            to authenticated;
grant execute on function public.is_owner(uuid)           to authenticated;
grant execute on function public.can_manage(uuid)         to authenticated;
grant execute on function public.can_manage_managers(uuid) to authenticated;
grant execute on function public.shares_tenant_with(uuid) to authenticated;
grant execute on function public.owners_count(uuid)       to authenticated;

-- ============================================================================
-- KONIEC 0001. Zabezpieczenia RLS: plik 0002_rls.sql.
-- ============================================================================
