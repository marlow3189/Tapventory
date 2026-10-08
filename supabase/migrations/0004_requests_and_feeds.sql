-- ============================================================================
-- Tapventory — migracja 0004: ZGŁOSZENIA (cykl statusów), HISTORIA, WIDOKI DLA FEEDU
-- ============================================================================
-- Co tu się dzieje (dla juniora):
--   * Dotąd RLS pozwalała autorowi zgłoszenia zmienić KAŻDE pole własnego
--     zgłoszenia — także status. Pracownik mógł więc sam „zaakceptować" i
--     „przyjąć" swoje zgłoszenie. Reguły cyklu życia są logiką biznesową, a ta
--     mieszka w bazie: trigger requests_guard pilnuje dozwolonych przejść.
--   * Każda zmiana statusu zostawia wpis w request_events (kto, kiedy, z→na) —
--     tego wymaga dokument koncepcyjny („każdy status: kto, kiedy").
--   * Widoki request_feed / movement_feed / product_overview odciążają
--     aplikację: jedno zapytanie zamiast pięciu, a nazwy autorów dostajemy
--     nawet po usunięciu ich kont („Usunięty użytkownik").
--
-- Cykl życia zgłoszenia (kto może wykonać przejście):
--   zgłoszone ─► zaakceptowane ─► zamówione ─► dostarczone ─► przyjęte
--       │             │              │
--       └─────────────┴──────────────┴──► odrzucone
--   * kierownictwo: wszystkie przejścia „do przodu" i odrzucenie
--   * autor: wycofanie własnego zgłoszenia (zgłoszone ─► odrzucone) oraz
--            potwierdzenie odbioru (dostarczone ─► przyjęte)
--   * „przyjęte" i „odrzucone" są końcowe (nie gumkujemy — dopisujemy nowe).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HISTORIA ZMIAN STATUSU
-- ----------------------------------------------------------------------------
create table public.request_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  request_id  uuid not null,
  from_status public.request_status,                 -- NULL = utworzenie zgłoszenia
  to_status   public.request_status not null,
  actor_id    uuid references public.profiles (id),  -- NULL = backend
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, request_id) references public.requests (tenant_id, id) on delete cascade
);
create index idx_request_events_request on public.request_events (request_id, id);
alter table public.request_events enable row level security;
create policy "request_events: podgląd" on public.request_events
  for select to authenticated using (public.is_member(tenant_id));
revoke insert, update, delete on public.request_events from authenticated;
create trigger trg_request_events_append_only before update or delete on public.request_events
  for each row execute function public.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. STRAŻNIK ZGŁOSZEŃ
-- ----------------------------------------------------------------------------
create or replace function public.requests_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_manager  boolean;
  v_reporter boolean;
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.reporter_id := v_uid;                     -- autorem jest zawsze zalogowany
    elsif new.reporter_id is null then
      raise exception 'Zgłoszenie musi mieć autora.' using errcode = 'P0001';
    end if;
    -- nowe zgłoszenie zawsze startuje od „zgłoszone", znaczniki czasu ustawia serwer
    new.status := 'reported';
    new.accepted_at := null; new.ordered_at := null;
    new.delivered_at := null; new.received_at := null;
    return new;
  end if;

  -- ---- UPDATE ----
  if new.reporter_id is distinct from old.reporter_id then
    raise exception 'Nie można zmienić autora zgłoszenia.' using errcode = 'P0001';
  end if;

  -- auth.uid() IS NULL = backend (service_role) — zaufany, bez ograniczeń.
  if v_uid is null then
    return new;
  end if;

  if old.status in ('received', 'rejected') then
    raise exception 'To zgłoszenie jest zamknięte. Jeśli potrzeba czegoś jeszcze, dodaj nowe zgłoszenie.'
      using errcode = 'P0001';
  end if;

  v_manager  := public.can_manage(old.tenant_id);
  v_reporter := (old.reporter_id = v_uid);

  if new.status is distinct from old.status then
    if not (
         (old.status = 'reported'  and new.status in ('accepted', 'rejected') and v_manager)
      or (old.status = 'reported'  and new.status = 'rejected'                 and v_reporter)
      or (old.status = 'accepted'  and new.status in ('ordered', 'rejected')   and v_manager)
      or (old.status = 'ordered'   and new.status in ('delivered', 'rejected') and v_manager)
      or (old.status = 'delivered' and new.status = 'received'                 and (v_manager or v_reporter))
    ) then
      raise exception 'Niedozwolona zmiana statusu zgłoszenia: % → %.', old.status, new.status
        using errcode = 'P0001';
    end if;

    -- Zmiana statusu nie miesza się z edycją treści (czytelny ślad w historii).
    if not v_manager and (
         new.product_id  is distinct from old.product_id  or new.free_name  is distinct from old.free_name
      or new.qty         is distinct from old.qty         or new.note       is distinct from old.note
      or new.photo_path  is distinct from old.photo_path  or new.project_id is distinct from old.project_id
      or new.supplier_id is distinct from old.supplier_id) then
      raise exception 'Zmiana statusu nie może łączyć się z edycją treści zgłoszenia.' using errcode = 'P0001';
    end if;

    -- znaczniki czasu ustawia WYŁĄCZNIE serwer
    new.accepted_at  := case when new.status = 'accepted'  then now() else old.accepted_at  end;
    new.ordered_at   := case when new.status = 'ordered'   then now() else old.ordered_at   end;
    new.delivered_at := case when new.status = 'delivered' then now() else old.delivered_at end;
    new.received_at  := case when new.status = 'received'  then now() else old.received_at  end;
  else
    new.accepted_at := old.accepted_at;   new.ordered_at  := old.ordered_at;
    new.delivered_at := old.delivered_at; new.received_at := old.received_at;

    -- Edycja treści: autor — tylko własnego, dopóki „zgłoszone"; reszta — kierownictwo.
    if not v_manager then
      if not (v_reporter and old.status = 'reported') then
        raise exception 'Zgłoszenie może edytować autor (do czasu akceptacji) lub kierownictwo.'
          using errcode = 'P0001';
      end if;
      if new.supplier_id is distinct from old.supplier_id then
        raise exception 'Dostawcę wskazuje kierownictwo.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;
create trigger trg_requests_guard before insert or update on public.requests
  for each row execute function public.requests_guard();

create or replace function public.log_request_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.request_events (tenant_id, request_id, from_status, to_status, actor_id)
    values (new.tenant_id, new.id, null, new.status, new.reporter_id);
  elsif new.status is distinct from old.status then
    insert into public.request_events (tenant_id, request_id, from_status, to_status, actor_id)
    values (new.tenant_id, new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;
create trigger trg_requests_events after insert or update on public.requests
  for each row execute function public.log_request_event();

-- Uprawnienia: autor może zmienić swoje zgłoszenie także przy „dostarczone"
-- (potwierdzenie odbioru). Szczegóły i tak pilnuje trigger. Kasowania zgłoszeń
-- nie ma — wycofanie to status „odrzucone" (nie gumkujemy, tylko dopisujemy).
drop policy "requests: edycja autora lub kierownictwa" on public.requests;
create policy "requests: edycja autora lub kierownictwa" on public.requests
  for update to authenticated
  using (
    public.can_manage(tenant_id)
    or (reporter_id = (select auth.uid()) and status in ('reported', 'delivered'))
  )
  with check (public.is_member(tenant_id));

drop policy "requests: wycofanie własnego lub przez kierownictwo" on public.requests;
revoke delete on public.requests from authenticated;

-- ----------------------------------------------------------------------------
-- 3. RUCHY: serwer ustawia czas i autora; powód rozchodu
-- ----------------------------------------------------------------------------
alter table public.stock_movements
  add column reason text check (reason in ('use', 'damage', 'expired', 'other')),
  add column document_line_id uuid;
alter table public.stock_movements
  add constraint stock_movements_note_len check (note is null or char_length(note) <= 500);

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
  end if;
  return new;
end;
$$;
create trigger trg_movements_guard before insert on public.stock_movements
  for each row execute function public.stock_movements_guard();

-- Ścieżki plików muszą leżeć w folderze własnej firmy (konwencja z 0002).
alter table public.products add constraint products_photo_in_tenant_folder
  check (photo_path is null or photo_path like tenant_id::text || '/%');
alter table public.requests add constraint requests_photo_in_tenant_folder
  check (photo_path is null or photo_path like tenant_id::text || '/%');

-- ----------------------------------------------------------------------------
-- 4. WIDOKI DLA APLIKACJI
-- ----------------------------------------------------------------------------
-- Lista produktów ze stanem — działa z prawami pytającego (RLS tabel źródłowych).
create view public.product_overview
with (security_invoker = true)
as
select
  p.id, p.tenant_id, p.name, p.ean, p.unit, p.pack_size, p.min_stock, p.photo_path,
  p.active, p.default_supplier_id, s.name as default_supplier_name, p.created_at,
  coalesce(sum(m.qty), 0)::numeric(14, 3)                  as stock,
  (coalesce(sum(m.qty), 0) < p.min_stock)                  as below_min,
  max(m.created_at)                                        as last_movement_at
from public.products p
left join public.suppliers s        on s.id = p.default_supplier_id
left join public.stock_movements m  on m.product_id = p.id
group by p.id, s.name;

-- Widoki „feedu" łączą dane z profilami autorów. Działają z prawami właściciela
-- (profile kolegów, którzy odeszli z firmy, nie są dla zwykłego użytkownika
-- widoczne), a ZABEZPIECZENIEM jest filtr is_member() w WHERE — testowany.
create view public.request_feed
with (security_invoker = false)
as
select
  r.id, r.tenant_id, r.status, r.qty, r.note, r.free_name, r.photo_path,
  r.created_at, r.updated_at, r.accepted_at, r.ordered_at, r.delivered_at, r.received_at,
  r.reporter_id, rp.display_name as reporter_name, (rp.deleted_at is not null) as reporter_deleted,
  r.product_id, p.name as product_name, p.unit as product_unit, p.photo_path as product_photo_path,
  r.project_id, pr.name as project_name,
  r.supplier_id, s.name as supplier_name,
  coalesce(m.cnt, 0)::int as message_count, m.last_at as last_message_at
from public.requests r
join public.profiles rp          on rp.id = r.reporter_id
left join public.products p      on p.id  = r.product_id
left join public.projects pr     on pr.id = r.project_id
left join public.suppliers s     on s.id  = r.supplier_id
left join lateral (
  select count(*) as cnt, max(created_at) as last_at
  from public.request_messages where request_id = r.id
) m on true
where public.is_member(r.tenant_id);

create view public.request_message_feed
with (security_invoker = false)
as
select
  m.id, m.tenant_id, m.request_id, m.author_id,
  a.display_name as author_name, (a.deleted_at is not null) as author_deleted,
  m.body, m.created_at
from public.request_messages m
join public.profiles a on a.id = m.author_id
where public.is_member(m.tenant_id);

create view public.request_event_feed
with (security_invoker = false)
as
select
  e.id, e.tenant_id, e.request_id, e.from_status, e.to_status, e.created_at,
  e.actor_id, a.display_name as actor_name
from public.request_events e
left join public.profiles a on a.id = e.actor_id
where public.is_member(e.tenant_id);

create view public.movement_feed
with (security_invoker = false)
as
select
  m.id, m.tenant_id, m.product_id, p.name as product_name, p.unit as product_unit,
  p.photo_path as product_photo_path,
  m.movement_type, m.qty, m.reason, m.note, m.document_id, m.project_id,
  pr.name as project_name,
  m.created_by, a.display_name as author_name, (a.deleted_at is not null) as author_deleted,
  m.created_at
from public.stock_movements m
join public.products p       on p.id = m.product_id
join public.profiles a       on a.id = m.created_by
left join public.projects pr on pr.id = m.project_id
where public.is_member(m.tenant_id);

revoke all on public.product_overview, public.request_feed, public.request_message_feed,
              public.request_event_feed, public.movement_feed from anon, authenticated;
grant select on public.product_overview, public.request_feed, public.request_message_feed,
                public.request_event_feed, public.movement_feed to authenticated;

-- ----------------------------------------------------------------------------
-- 5. REALTIME + higiena uprawnień funkcji
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.request_events;

revoke execute on function public.requests_guard(), public.log_request_event(),
                           public.stock_movements_guard()
  from public, anon, authenticated;

-- ============================================================================
-- KONIEC 0004.
-- ============================================================================
