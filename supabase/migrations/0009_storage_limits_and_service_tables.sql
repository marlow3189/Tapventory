-- ============================================================================
-- Tapventory — migracja 0009: limity plików, cache kodów kreskowych, limit asystenta AI
-- ============================================================================
-- A. Storage: dotąd oba prywatne buckety przyjmowały DOWOLNY plik dowolnej wielkości.
--    Każdy członek firmy mógł więc wgrać 5 GB filmu na koszt właściciela. Teraz:
--      documents       — do 10 MB, tylko JPEG / PNG / WebP / PDF (faktury)
--      product-photos  — do 5 MB,  tylko JPEG / PNG / WebP (produkty, zgłoszenia)
--    Aplikacja i tak zmniejsza zdjęcia do ~300 KB; limit to zabezpieczenie na wypadek
--    innego klienta (np. skryptu) i oszczędność miejsca.
-- B. barcode_cache — Open Food Facts prosi o cache'owanie zapytań (limit 100 zapytań/min
--    na produkty, 10/min na wyszukiwania). Funkcja barcode-lookup zapisuje wyniki tutaj.
--    Tabela jest WYŁĄCZNIE dla backendu (service_role) — aplikacja nie ma do niej dostępu.
-- C. assistant_usage — dzienny licznik pytań do asystenta AI na osobę. Bez limitu każdy
--    członek firmy mógłby generować nieograniczone koszty modelu.
-- D. reap_stuck_documents — „strażnik" dokumentów, które utknęły w statusie processing
--    (np. funkcja AI padła w trakcie). Uruchamiany co kilka minut przez harmonogram
--    (patrz supabase/functions/README.md). Oznacza je jako failed, by użytkownik mógł
--    spróbować ponownie albo wpisać pozycje ręcznie.
-- ============================================================================

-- A ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 where id = 'documents';

update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'product-photos';

-- B ---------------------------------------------------------------------------
create table public.barcode_cache (
  ean        text primary key check (ean ~ '^[0-9]{8}$' or ean ~ '^[0-9]{13}$'),
  found      boolean not null,
  name       text check (name is null or char_length(name) <= 300),
  brand      text check (brand is null or char_length(brand) <= 200),
  quantity   text check (quantity is null or char_length(quantity) <= 100),
  source     text not null default 'openfoodfacts',
  fetched_at timestamptz not null default now()
);
alter table public.barcode_cache enable row level security;
revoke all on public.barcode_cache from public, anon, authenticated;
grant select, insert, update on public.barcode_cache to service_role;

-- C ---------------------------------------------------------------------------
create table public.assistant_usage (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id   uuid not null references public.profiles (id),
  day       date not null default ((now() at time zone 'utc')::date),
  messages  int  not null default 0 check (messages >= 0),
  primary key (tenant_id, user_id, day)
);
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from public, anon, authenticated;
grant select, insert, update on public.assistant_usage to service_role;

-- Zwiększa dzienny licznik i zwraca nową wartość; po przekroczeniu limitu zgłasza błąd
-- (wyjątek cofa też zwiększenie, więc licznik nigdy nie przekroczy limitu).
create or replace function public.bump_assistant_usage(p_tenant uuid, p_user uuid, p_daily_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.assistant_usage as u (tenant_id, user_id, day, messages)
  values (p_tenant, p_user, (now() at time zone 'utc')::date, 1)
  on conflict (tenant_id, user_id, day) do update set messages = u.messages + 1
  returning u.messages into v_count;

  if v_count > p_daily_limit then
    raise exception 'Dzienny limit pytań do asystenta (%) został wykorzystany. Wróć jutro.', p_daily_limit
      using errcode = 'P0001';
  end if;
  return v_count;
end;
$$;
revoke execute on function public.bump_assistant_usage(uuid, uuid, int) from public, anon, authenticated;
grant  execute on function public.bump_assistant_usage(uuid, uuid, int) to service_role;

-- D ---------------------------------------------------------------------------
create or replace function public.reap_stuck_documents(p_older_than interval default interval '10 minutes')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.documents
     set status = 'failed',
         error_message = 'Odczyt trwał zbyt długo i został przerwany. Spróbuj ponownie lub wpisz pozycje ręcznie.'
   where status = 'processing'
     and updated_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.reap_stuck_documents(interval) from public, anon, authenticated;
grant  execute on function public.reap_stuck_documents(interval) to service_role;

-- ============================================================================
-- KONIEC 0009.
-- ============================================================================
