-- ============================================================================
-- Tapventory — migracja 0008: „+1 też potrzebuję" i reguły księgi dla pracowników
-- ============================================================================
-- 1) Serce w feedzie zgłoszeń ma realną funkcję: „ja też tego potrzebuję".
--    Kierownik widzi liczbę głosów i wie, co jest naprawdę pilne.
-- 2) Luka z fundamentu: RLS pozwalała KAŻDEMU członkowi zapisać ruch dowolnego
--    typu (np. „przyjęcie" bez faktury). Dokument koncepcyjny mówi: pracownik
--    „zdejmuje" (rozchód) i zgłasza braki; przyjęcia to faktury (kierownictwo).
--    Wyjątek: korekta ze spisu („ile zostało?") — robi ją record_stock_check.
-- ============================================================================

create table public.request_votes (
  request_id uuid not null,
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (request_id, user_id),
  foreign key (tenant_id, request_id) references public.requests (tenant_id, id) on delete cascade
);
alter table public.request_votes enable row level security;
create policy "votes: podgląd" on public.request_votes
  for select to authenticated using (public.is_member(tenant_id));
create policy "votes: głos własny" on public.request_votes
  for insert to authenticated
  with check (public.is_member(tenant_id) and user_id = (select auth.uid()));
create policy "votes: cofnięcie własnego" on public.request_votes
  for delete to authenticated using (user_id = (select auth.uid()));
revoke update, truncate, references, trigger on public.request_votes from authenticated;

-- Autor nie głosuje na własne zgłoszenie (to by sztucznie podbijało licznik).
create or replace function public.votes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.requests r where r.id = new.request_id and r.reporter_id = new.user_id) then
    raise exception 'Własnego zgłoszenia nie oceniasz — masz je już „na liście".' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_votes_guard before insert on public.request_votes
  for each row execute function public.votes_guard();
revoke execute on function public.votes_guard() from public, anon, authenticated;

-- Widok zgłoszeń: dopisujemy kolumny NA KOŃCU (create or replace view tak wymaga).
create or replace view public.request_feed
with (security_invoker = false)
as
select
  r.id, r.tenant_id, r.status, r.qty, r.note, r.free_name, r.photo_path,
  r.created_at, r.updated_at, r.accepted_at, r.ordered_at, r.delivered_at, r.received_at,
  r.reporter_id, rp.display_name as reporter_name, (rp.deleted_at is not null) as reporter_deleted,
  r.product_id, p.name as product_name, p.unit as product_unit, p.photo_path as product_photo_path,
  r.project_id, pr.name as project_name,
  r.supplier_id, s.name as supplier_name,
  coalesce(m.cnt, 0)::int as message_count, m.last_at as last_message_at,
  coalesce(v.cnt, 0)::int as vote_count,
  coalesce(v.mine, false) as voted_by_me
from public.requests r
join public.profiles rp          on rp.id = r.reporter_id
left join public.products p      on p.id  = r.product_id
left join public.projects pr     on pr.id = r.project_id
left join public.suppliers s     on s.id  = r.supplier_id
left join lateral (
  select count(*) as cnt, max(created_at) as last_at
  from public.request_messages where request_id = r.id
) m on true
left join lateral (
  select count(*) as cnt, bool_or(user_id = auth.uid()) as mine
  from public.request_votes where request_id = r.id
) v on true
where public.is_member(r.tenant_id);

-- Reguła księgi: pracownik zapisuje wyłącznie rozchód („Zdejmij").
create or replace function public.stock_movements_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Klient nie dyktuje czasu ani autora ruchu (backdating = fałszowanie księgi).
  -- Backend (auth.uid() IS NULL) może ustawić oba pola (np. import historii).
  if auth.uid() is not null then
    new.created_at := now();
    new.created_by := auth.uid();
    -- (osobom spoza firmy odmówi RLS — nie wprowadzamy ich w błąd komunikatem o pracowniku)
    if new.movement_type <> 'issue'
       and public.is_member(new.tenant_id)
       and not public.can_manage(new.tenant_id)
       and current_setting('tapventory.ledger_op', true) is distinct from 'count' then
      raise exception 'Pracownik może tylko zdejmować produkty z magazynu. Przyjęcia i korekty księguje kierownictwo.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- Spis („ile zostało?") może wykonać każdy — to jedyna droga pracownika do korekty.
create or replace function public.record_stock_check(
  p_product uuid, p_counted numeric, p_source text default 'manual', p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant   uuid;
  v_expected numeric(12, 3);
  v_diff     numeric(12, 3);
  v_mv       uuid;
  v_id       uuid := coalesce(p_id, gen_random_uuid());
  v_prev     public.stock_checks;
begin
  select tenant_id into v_tenant from public.products where id = p_product for update;
  if not found or not public.is_member(v_tenant) then
    raise exception 'Nie znaleziono produktu lub brak uprawnień.' using errcode = 'P0001';
  end if;
  if p_counted is null or p_counted < 0 or p_counted > 1000000000 then
    raise exception 'Podaj poprawną ilość (od 0 w górę).' using errcode = 'P0001';
  end if;
  if p_source not in ('scheduled', 'on_take', 'manual') then
    raise exception 'Nieznane źródło spisu.' using errcode = 'P0001';
  end if;

  select * into v_prev from public.stock_checks where id = v_id;
  if found then
    return jsonb_build_object('expected', v_prev.expected_qty, 'counted', v_prev.counted_qty,
                              'diff', v_prev.diff, 'movement_id', v_prev.movement_id, 'repeated', true);
  end if;

  select coalesce(sum(qty), 0) into v_expected from public.stock_movements where product_id = p_product;
  v_diff := p_counted - v_expected;

  if v_diff <> 0 then
    perform set_config('tapventory.ledger_op', 'count', true);
    insert into public.stock_movements (tenant_id, product_id, movement_type, qty, note)
    values (v_tenant, p_product, 'adjustment', v_diff,
            'Spis: policzono ' || p_counted::text || ', w systemie ' || v_expected::text)
    returning id into v_mv;
    perform set_config('tapventory.ledger_op', '', true);
  end if;

  insert into public.stock_checks (id, tenant_id, product_id, expected_qty, counted_qty, source, movement_id, counted_by)
  values (v_id, v_tenant, p_product, v_expected, p_counted, p_source, v_mv, auth.uid());

  update public.products set last_counted_at = now() where id = p_product;

  return jsonb_build_object('expected', v_expected, 'counted', p_counted, 'diff', v_diff,
                            'movement_id', v_mv, 'repeated', false);
end;
$$;

-- ============================================================================
-- KONIEC 0008.
-- ============================================================================
