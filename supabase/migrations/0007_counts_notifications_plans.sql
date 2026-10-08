-- ============================================================================
-- Tapventory — migracja 0007: MINI-INWENTARYZACJE, POWIADOMIENIA, PLANY I AI, PULPIT
-- ============================================================================
-- Dla juniora — cztery osobne, ale powiązane tematy z dokumentu koncepcyjnego:
--   A. Plany i limity (rozdz. 12): Solo / Start / Zespół + 14 dni próbnych
--      planu Zespół. Limity osób i produktów pilnuje BAZA, nie aplikacja.
--      Użycie AI: rezerwacja skanu w transakcji (dwa skany naraz nie ominą limitu).
--   B. Mini-inwentaryzacje (rozdz. 3): „ile zostało?" księguje różnicę jako
--      korektę. Stan to suma ruchów, więc spis to po prostu nowy ruch.
--   C. Powiadomienia: tabela zasila zakładkę „Aktywność" w aplikacji (Realtime)
--      i wysyłkę push (Edge Function send-push).
--   D. dashboard_summary: jedno wywołanie = wszystkie liczby na pulpit i w
--      „stories" (rozdz. 4 koncepcji; styl Instagrama w aplikacji).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. PLANY, LIMITY, UŻYCIE AI
-- ----------------------------------------------------------------------------
alter table public.tenants
  add column plan          text not null default 'solo' check (plan in ('solo', 'start', 'team')),
  add column trial_ends_at timestamptz;
-- Kolumn plan / trial_ends_at użytkownik NIE może zmieniać (grant z 0003 obejmuje
-- tylko dane kontaktowe) — ustawia je backend (webhook Stripe → set_tenant_plan).

-- Limity planów (NULL = bez limitu). Jedno miejsce prawdy; cennik w koncepcji, rozdz. 12.
create or replace function public.plan_limits(p_plan text)
returns table (max_users int, max_products int, ai_scans_month int)
language sql immutable
as $$
  select v.max_users, v.max_products, v.ai_scans_month
  from (values ('solo', 1, 150, 5), ('start', 3, 1000, 30), ('team', 10, null::int, 150))
       as v(plan, max_users, max_products, ai_scans_month)
  where v.plan = p_plan;
$$;

-- Plan obowiązujący teraz: w trakcie okresu próbnego zawsze „team".
create or replace function public.effective_plan(t uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select case when trial_ends_at is not null and trial_ends_at > now() then 'team' else plan end
  from public.tenants where id = t;
$$;

create or replace function public.enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan  text := public.effective_plan(new.tenant_id);
  v_limit int;
begin
  select max_users into v_limit from public.plan_limits(v_plan);
  if v_limit is not null
     and (select count(*) from public.memberships where tenant_id = new.tenant_id) >= v_limit then
    raise exception 'Osiągnięto limit osób w Twoim planie (%). Ta funkcja jest dostępna w wyższym planie.', v_limit
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_memberships_limit before insert on public.memberships
  for each row execute function public.enforce_member_limit();

create or replace function public.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan  text := public.effective_plan(new.tenant_id);
  v_limit int;
begin
  if not new.active or (tg_op = 'UPDATE' and old.active) then
    return new;     -- limit dotyczy dodawania i odarchiwizowania, nie edycji
  end if;
  select max_products into v_limit from public.plan_limits(v_plan);
  if v_limit is not null
     and (select count(*) from public.products
          where tenant_id = new.tenant_id and active and id <> new.id) >= v_limit then
    raise exception 'Osiągnięto limit produktów w Twoim planie (%). Ta funkcja jest dostępna w wyższym planie.', v_limit
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_products_limit before insert or update of active on public.products
  for each row execute function public.enforce_product_limit();

-- Zakładanie firmy: od teraz z 14-dniowym okresem próbnym planu Zespół.
create or replace function public.create_tenant(
  p_name     text,
  p_nip      text default null,
  p_industry text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text := btrim(coalesce(p_name, ''));
  v_nip    text := nullif(btrim(coalesce(p_nip, '')), '');
  v_tenant uuid;
  v_code   text;
begin
  if v_uid is null then
    raise exception 'Wymagane zalogowanie.' using errcode = 'P0001';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Nazwa firmy musi mieć od 2 do 120 znaków.' using errcode = 'P0001';
  end if;
  if v_nip is not null and not public.is_valid_nip(v_nip) then
    raise exception 'Nieprawidłowy NIP (sprawdź cyfry — suma kontrolna się nie zgadza).' using errcode = 'P0001';
  end if;
  if (select count(*) from public.memberships where user_id = v_uid and role = 'owner') >= 5 then
    raise exception 'Jedno konto może być właścicielem najwyżej 5 firm.' using errcode = 'P0001';
  end if;

  insert into public.tenants (name, nip, industry, trial_ends_at)
  values (v_name, v_nip, nullif(btrim(coalesce(p_industry, '')), ''), now() + interval '14 days')
  returning id into v_tenant;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_tenant, v_uid, 'owner');

  loop
    v_code := 'TV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.referral_codes (tenant_id, code) values (v_tenant, v_code);
      exit;
    exception when unique_violation then
      -- kod już istnieje (skrajnie rzadkie) — losujemy ponownie
    end;
  end loop;

  return v_tenant;
end;
$$;

-- Zmiana planu: tylko backend (webhook Stripe).
create or replace function public.set_tenant_plan(p_tenant uuid, p_plan text, p_trial_ends_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tenants
     set plan = p_plan, trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at)
   where id = p_tenant;
  if not found then
    raise exception 'Firma nie istnieje.' using errcode = 'P0001';
  end if;
end;
$$;

-- ---- Użycie AI ----
create table public.ai_usage (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  user_id        uuid references public.profiles (id),
  kind           text not null check (kind in ('document', 'assistant', 'match')),
  document_id    uuid,
  model          text,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  cost_micro_usd bigint not null default 0,          -- koszt w milionowych części USD
  status         text not null default 'reserved'
                 check (status in ('reserved', 'ok', 'error', 'refused')),
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index idx_ai_usage_tenant_month on public.ai_usage (tenant_id, created_at);
alter table public.ai_usage enable row level security;
create policy "ai_usage: podgląd dla kierownictwa" on public.ai_usage
  for select to authenticated using (public.can_manage(tenant_id));
revoke insert, update, delete, truncate, references, trigger on public.ai_usage from authenticated;

-- Granica „miesiąca rozliczeniowego": kalendarzowy miesiąc czasu polskiego.
create or replace function public.ai_month_start()
returns timestamptz
language sql stable
as $$
  select date_trunc('month', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw';
$$;

create or replace function public.ai_quota(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_used  int;
begin
  if auth.uid() is not null and not public.is_member(p_tenant) then
    raise exception 'Brak uprawnień.' using errcode = 'P0001';
  end if;
  select ai_scans_month into v_limit from public.plan_limits(public.effective_plan(p_tenant));
  select count(*) into v_used from public.ai_usage
   where tenant_id = p_tenant and kind = 'document' and status in ('reserved', 'ok')
     and created_at >= public.ai_month_start();
  return jsonb_build_object(
    'plan', public.effective_plan(p_tenant), 'limit', v_limit, 'used', v_used,
    'remaining', greatest(coalesce(v_limit, 0) - v_used, 0),
    'resets_at', (public.ai_month_start() + interval '1 month'));
end;
$$;

-- Rezerwacja skanu (backend, PRZED wywołaniem modelu). Blokada wiersza firmy
-- serializuje równoległe skany; przy wyczerpaniu limitu — wyjątek.
create or replace function public.reserve_ai_scan(p_tenant uuid, p_user uuid, p_document uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_used  int;
  v_id    bigint;
begin
  perform 1 from public.tenants where id = p_tenant for update;
  if not found then
    raise exception 'Firma nie istnieje.' using errcode = 'P0001';
  end if;
  select ai_scans_month into v_limit from public.plan_limits(public.effective_plan(p_tenant));
  select count(*) into v_used from public.ai_usage
   where tenant_id = p_tenant and kind = 'document' and status in ('reserved', 'ok')
     and created_at >= public.ai_month_start();
  if v_limit is not null and v_used >= v_limit then
    raise exception 'AI_QUOTA_EXCEEDED' using errcode = 'P0001';
  end if;
  insert into public.ai_usage (tenant_id, user_id, kind, document_id)
  values (p_tenant, p_user, 'document', p_document) returning id into v_id;
  return v_id;
end;
$$;

-- Zamknięcie rezerwacji po wywołaniu modelu (błąd/odmowa nie zużywają limitu).
create or replace function public.finish_ai_scan(
  p_usage bigint, p_model text, p_input int, p_output int, p_cost_micro_usd bigint, p_status text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_usage
     set model = p_model, input_tokens = p_input, output_tokens = p_output,
         cost_micro_usd = p_cost_micro_usd, status = p_status, finished_at = now()
   where id = p_usage and p_status in ('ok', 'error', 'refused');
$$;

-- ----------------------------------------------------------------------------
-- B. MINI-INWENTARYZACJE
-- ----------------------------------------------------------------------------
create table public.tenant_settings (
  tenant_id          uuid primary key references public.tenants (id) on delete cascade,
  count_frequency    text not null default 'weekly' check (count_frequency in ('off', 'weekly', 'biweekly')),
  count_batch_size   int  not null default 5   check (count_batch_size between 1 and 20),
  count_question_cap int  not null default 2   check (count_question_cap between 0 and 5),
  count_stale_days   int  not null default 30  check (count_stale_days between 7 and 365),
  low_stock_push     boolean not null default true,
  updated_at         timestamptz not null default now()
);
alter table public.tenant_settings enable row level security;
create policy "settings: podgląd" on public.tenant_settings
  for select to authenticated using (public.is_member(tenant_id));
create policy "settings: edycja kierownictwa" on public.tenant_settings
  for update to authenticated using (public.can_manage(tenant_id)) with check (public.can_manage(tenant_id));
revoke insert, delete, truncate, references, trigger on public.tenant_settings from authenticated;
create trigger trg_settings_updated before update on public.tenant_settings
  for each row execute function public.set_updated_at();

create or replace function public.create_default_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_settings (tenant_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger trg_tenants_settings after insert on public.tenants
  for each row execute function public.create_default_settings();
insert into public.tenant_settings (tenant_id) select id from public.tenants on conflict do nothing;

alter table public.products add column last_counted_at timestamptz;

create table public.stock_checks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  product_id   uuid not null,
  expected_qty numeric(12, 3) not null,
  counted_qty  numeric(12, 3) not null check (counted_qty >= 0),
  diff         numeric(12, 3) generated always as (counted_qty - expected_qty) stored,
  source       text not null default 'manual' check (source in ('scheduled', 'on_take', 'manual')),
  movement_id  uuid,
  counted_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  foreign key (tenant_id, product_id)  references public.products (tenant_id, id),
  foreign key (tenant_id, movement_id) references public.stock_movements (tenant_id, id)
    on delete set null (movement_id)
);
create index idx_stock_checks_tenant on public.stock_checks (tenant_id, created_at desc);
create index idx_stock_checks_user_day on public.stock_checks (counted_by, created_at);
alter table public.stock_checks enable row level security;
create policy "checks: podgląd" on public.stock_checks
  for select to authenticated using (public.is_member(tenant_id));
revoke insert, update, delete, truncate, references, trigger on public.stock_checks from authenticated;
create trigger trg_stock_checks_append_only before update or delete on public.stock_checks
  for each row execute function public.forbid_change();

-- „Ile zostało?" — policzone przez człowieka wygrywa nad stanem z księgi; różnica
-- trafia do księgi jako korekta. Blokada wiersza produktu (FOR UPDATE) sprawia,
-- że równoległe ruchy poczekają i ułożą się PO spisie.
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

  -- idempotencja: ponowione wywołanie (zła sieć) nie dubluje korekty
  select * into v_prev from public.stock_checks where id = v_id;
  if found then
    return jsonb_build_object('expected', v_prev.expected_qty, 'counted', v_prev.counted_qty,
                              'diff', v_prev.diff, 'movement_id', v_prev.movement_id, 'repeated', true);
  end if;

  select coalesce(sum(qty), 0) into v_expected from public.stock_movements where product_id = p_product;
  v_diff := p_counted - v_expected;

  if v_diff <> 0 then
    insert into public.stock_movements (tenant_id, product_id, movement_type, qty, note)
    values (v_tenant, p_product, 'adjustment', v_diff,
            'Spis: policzono ' || p_counted::text || ', w systemie ' || v_expected::text)
    returning id into v_mv;
  end if;

  insert into public.stock_checks (id, tenant_id, product_id, expected_qty, counted_qty, source, movement_id, counted_by)
  values (v_id, v_tenant, p_product, v_expected, p_counted, p_source, v_mv, auth.uid());

  update public.products set last_counted_at = now() where id = p_product;

  return jsonb_build_object('expected', v_expected, 'counted', p_counted, 'diff', v_diff,
                            'movement_id', v_mv, 'repeated', false);
end;
$$;

-- Kolejka do policzenia: najdłużej niepoliczone najpierw (rotacja po całym magazynie).
create or replace function public.next_count_candidates(p_tenant uuid, p_limit int default null)
returns table (product_id uuid, name text, unit text, photo_path text,
               expected_qty numeric, last_counted_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int;
begin
  if not public.is_member(p_tenant) then
    raise exception 'Brak uprawnień.' using errcode = 'P0001';
  end if;
  select coalesce(p_limit, count_batch_size) into v_limit from public.tenant_settings where tenant_id = p_tenant;
  return query
    select p.id, p.name, p.unit, p.photo_path,
           coalesce((select sum(m.qty) from public.stock_movements m where m.product_id = p.id), 0),
           p.last_counted_at
    from public.products p
    where p.tenant_id = p_tenant and p.active
    order by p.last_counted_at nulls first, p.name
    limit coalesce(v_limit, 5);
end;
$$;

-- Pytanie „przy okazji" przy akcji „Zdejmij": tylko dla zaległego produktu i do
-- dziennego limitu pytań na osobę (żeby nie męczyć — koncepcja, rozdz. 3).
create or replace function public.should_ask_count(p_product uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_last   timestamptz;
  s        public.tenant_settings;
  v_today  int;
begin
  select tenant_id, last_counted_at into v_tenant, v_last from public.products where id = p_product;
  if not found or not public.is_member(v_tenant) then
    return false;
  end if;
  select * into s from public.tenant_settings where tenant_id = v_tenant;
  if not found or s.count_question_cap = 0 then
    return false;
  end if;
  if v_last is not null and v_last > now() - make_interval(days => s.count_stale_days) then
    return false;
  end if;
  select count(*) into v_today from public.stock_checks
   where counted_by = auth.uid() and source = 'on_take'
     and created_at >= date_trunc('day', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw';
  return v_today < s.count_question_cap;
end;
$$;

-- ----------------------------------------------------------------------------
-- C. POWIADOMIENIA I TOKENY PUSH
-- ----------------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  user_id      uuid not null references public.profiles (id),
  kind         text not null check (kind in ('low_stock', 'request_new', 'request_status', 'document_ready', 'count_due', 'system')),
  title        text not null check (char_length(title) <= 120),
  body         text check (body is null or char_length(body) <= 300),
  data         jsonb not null default '{}'::jsonb,
  push         boolean not null default true,       -- czy wysyłać push (poza wpisem w aplikacji)
  read_at      timestamptz,
  push_sent_at timestamptz,
  created_at   timestamptz not null default now()
);
create index idx_notifications_user on public.notifications (user_id, created_at desc);
create index idx_notifications_unread on public.notifications (user_id) where read_at is null;
create index idx_notifications_unsent on public.notifications (created_at) where push and push_sent_at is null;
alter table public.notifications enable row level security;
create policy "notifications: własne" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: oznaczanie własnych jako przeczytane" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update, delete, truncate, references, trigger on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create table public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id),
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android', 'web')),
  device_name  text,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index idx_push_tokens_user on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
create policy "push_tokens: własne" on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy "push_tokens: usuwanie własnych" on public.push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));
revoke insert, update, truncate, references, trigger on public.push_tokens from authenticated;

-- Rejestracja urządzenia: ten sam token po przelogowaniu przechodzi na nowe konto.
create or replace function public.register_push_token(p_token text, p_platform text, p_device text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Wymagane zalogowanie.' using errcode = 'P0001';
  end if;
  if p_token is null or char_length(p_token) not between 10 and 300 then
    raise exception 'Nieprawidłowy token.' using errcode = 'P0001';
  end if;
  insert into public.push_tokens (user_id, token, platform, device_name)
  values (auth.uid(), p_token, p_platform, left(p_device, 80))
  on conflict (token) do update
    set user_id = auth.uid(), platform = excluded.platform,
        device_name = excluded.device_name, last_seen_at = now();
end;
$$;

-- Usunięcie konta kasuje też tokeny push i powiadomienia tej osoby.
create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_tokens   where user_id = old.id;
  delete from public.notifications where user_id = old.id;
  update public.profiles
     set display_name = 'Usunięty użytkownik', phone = null, deleted_at = now()
   where id = old.id;
  return old;
end;
$$;

-- ---- zdarzenia → powiadomienia ----
create or replace function public.notify_managers(
  p_tenant uuid, p_except uuid, p_kind text, p_title text, p_body text, p_data jsonb, p_push boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (tenant_id, user_id, kind, title, body, data, push)
  select m.tenant_id, m.user_id, p_kind, p_title, p_body, p_data, p_push
  from public.memberships m
  where m.tenant_id = p_tenant and m.role in ('owner', 'manager')
    and m.user_id is distinct from p_except;
$$;

-- Spadek poniżej minimum (przekroczenie progu W DÓŁ, nie każdy kolejny ruch).
create or replace function public.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_after  numeric;
  v_min    numeric;
  v_name   text;
  v_unit   text;
  v_push   boolean;
begin
  if new.qty >= 0 then
    return new;
  end if;
  select min_stock, name, unit into v_min, v_name, v_unit from public.products where id = new.product_id;
  if v_min is null or v_min <= 0 then
    return new;
  end if;
  select coalesce(sum(qty), 0) into v_after from public.stock_movements where product_id = new.product_id;
  if v_after - new.qty >= v_min and v_after < v_min then
    select coalesce(low_stock_push, true) into v_push from public.tenant_settings where tenant_id = new.tenant_id;
    perform public.notify_managers(
      new.tenant_id, null, 'low_stock', 'Kończy się: ' || v_name,
      'Stan ' || v_after::text || ' ' || v_unit || ' (minimum ' || v_min::text || ').',
      jsonb_build_object('product_id', new.product_id), coalesce(v_push, true));
  end if;
  return new;
end;
$$;
create trigger trg_movements_low_stock after insert on public.stock_movements
  for each row execute function public.notify_low_stock();

create or replace function public.notify_request_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_what text;
  v_who  text;
begin
  v_what := coalesce(
    (select name from public.products where id = new.product_id), new.free_name, 'zgłoszenie');
  if tg_op = 'INSERT' then
    select display_name into v_who from public.profiles where id = new.reporter_id;
    perform public.notify_managers(
      new.tenant_id, new.reporter_id, 'request_new', 'Nowe zgłoszenie braku',
      v_who || ': ' || v_what || coalesce(' (' || new.qty::text || ')', ''),
      jsonb_build_object('request_id', new.id), true);
  elsif new.status is distinct from old.status and new.reporter_id is distinct from auth.uid() then
    insert into public.notifications (tenant_id, user_id, kind, title, body, data)
    values (new.tenant_id, new.reporter_id, 'request_status',
            'Zgłoszenie: ' || case new.status
              when 'accepted' then 'zaakceptowane' when 'ordered' then 'zamówione'
              when 'delivered' then 'dostarczone' when 'received' then 'przyjęte'
              when 'rejected' then 'odrzucone' else new.status::text end,
            v_what, jsonb_build_object('request_id', new.id));
  end if;
  return new;
end;
$$;
create trigger trg_requests_notify after insert or update on public.requests
  for each row execute function public.notify_request_events();

create or replace function public.notify_document_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'processing' and new.status in ('draft', 'failed') and new.created_by is not null then
    insert into public.notifications (tenant_id, user_id, kind, title, body, data)
    values (new.tenant_id, new.created_by, 'document_ready',
            case when new.status = 'draft' then 'Faktura gotowa do sprawdzenia' else 'Nie udało się odczytać dokumentu' end,
            coalesce(new.supplier_name, new.invoice_number),
            jsonb_build_object('document_id', new.id));
  end if;
  return new;
end;
$$;
create trigger trg_documents_notify after update on public.documents
  for each row execute function public.notify_document_ready();

-- Przypomnienia o mini-spisie (wołane z crona raz dziennie przez backend).
create or replace function public.queue_count_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_n     int;
  s       record;
begin
  for s in
    select ts.tenant_id, ts.count_frequency
    from public.tenant_settings ts
    where ts.count_frequency <> 'off'
      and coalesce((select max(c.created_at) from public.stock_checks c
                    where c.tenant_id = ts.tenant_id and c.source = 'scheduled'), '-infinity')
          < now() - case ts.count_frequency when 'weekly' then interval '7 days' else interval '14 days' end
      and exists (select 1 from public.products p where p.tenant_id = ts.tenant_id and p.active)
  loop
    insert into public.notifications (tenant_id, user_id, kind, title, body, data)
    select s.tenant_id, m.user_id, 'count_due', 'Czas na mini-spis',
           'Policz kilka produktów — to zajmie 3 minuty.', '{}'::jsonb
    from public.memberships m
    where m.tenant_id = s.tenant_id and m.role in ('owner', 'manager')
      and not exists (select 1 from public.notifications n
                      where n.user_id = m.user_id and n.tenant_id = s.tenant_id
                        and n.kind = 'count_due' and n.read_at is null);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;

-- ----------------------------------------------------------------------------
-- D. PODSUMOWANIE PULPITU (jedno wywołanie = wszystkie liczby)
-- ----------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.member_role;
  v_manager boolean;
  v_trial   timestamptz;
  s         public.tenant_settings;
  v_result  jsonb;
begin
  v_role := public.my_role(p_tenant);
  if v_role is null then
    raise exception 'Brak uprawnień.' using errcode = 'P0001';
  end if;
  v_manager := v_role in ('owner', 'manager');
  select * into s from public.tenant_settings where tenant_id = p_tenant;
  select trial_ends_at into v_trial from public.tenants where id = p_tenant;

  v_result := jsonb_build_object(
    'role', v_role,
    'plan', public.effective_plan(p_tenant),
    'trial_days_left', case when v_trial is not null and v_trial > now()
                            then ceil(extract(epoch from (v_trial - now())) / 86400)::int end,
    'products_total', (select count(*) from public.products where tenant_id = p_tenant and active),
    'below_min', (select count(*) from public.product_overview o where o.tenant_id = p_tenant and o.active and o.below_min),
    'below_min_top', coalesce((
        select jsonb_agg(to_jsonb(t)) from (
          select o.id, o.name, o.unit, o.stock, o.min_stock, o.photo_path
          from public.product_overview o
          where o.tenant_id = p_tenant and o.active and o.below_min
          order by (o.min_stock - o.stock) desc, o.name limit 10) t), '[]'::jsonb),
    'requests_open', (select count(*) from public.requests where tenant_id = p_tenant
                      and status in ('reported', 'accepted', 'ordered', 'delivered')),
    'requests_to_accept', case when v_manager then
        (select count(*) from public.requests where tenant_id = p_tenant and status = 'reported') else 0 end,
    'requests_to_confirm', (select count(*) from public.requests
                            where tenant_id = p_tenant and status = 'delivered'
                              and (v_manager or reporter_id = v_uid)),
    'requests_mine_open', (select count(*) from public.requests where tenant_id = p_tenant
                           and reporter_id = v_uid and status in ('reported', 'accepted', 'ordered', 'delivered')),
    'documents_to_verify', case when v_manager then
        (select count(*) from public.documents where tenant_id = p_tenant and status in ('draft', 'verified')) else 0 end,
    'documents_processing', case when v_manager then
        (select count(*) from public.documents where tenant_id = p_tenant and status = 'processing') else 0 end,
    'documents_failed', case when v_manager then
        (select count(*) from public.documents where tenant_id = p_tenant and status = 'failed') else 0 end,
    'count_stale', (select count(*) from public.products p
                    where p.tenant_id = p_tenant and p.active
                      and (p.last_counted_at is null
                           or p.last_counted_at < now() - make_interval(days => coalesce(s.count_stale_days, 30)))),
    'count_batch_size', coalesce(s.count_batch_size, 5),
    'count_frequency', coalesce(s.count_frequency, 'weekly'),
    'unread_notifications', (select count(*) from public.notifications where user_id = v_uid and tenant_id = p_tenant and read_at is null)
  );
  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- E. UPRAWNIENIA, REALTIME
-- ----------------------------------------------------------------------------
revoke execute on function
  public.plan_limits(text), public.effective_plan(uuid), public.ai_month_start(),
  public.ai_quota(uuid), public.reserve_ai_scan(uuid, uuid, uuid),
  public.finish_ai_scan(bigint, text, int, int, bigint, text), public.set_tenant_plan(uuid, text, timestamptz),
  public.record_stock_check(uuid, numeric, text, uuid), public.next_count_candidates(uuid, int),
  public.should_ask_count(uuid), public.register_push_token(text, text, text),
  public.queue_count_reminders(), public.dashboard_summary(uuid),
  public.notify_managers(uuid, uuid, text, text, text, jsonb, boolean),
  public.enforce_member_limit(), public.enforce_product_limit(), public.create_default_settings(),
  public.notify_low_stock(), public.notify_request_events(), public.notify_document_ready()
from public, anon, authenticated;

-- dla aplikacji (zalogowani)
grant execute on function public.plan_limits(text)                          to authenticated;
grant execute on function public.ai_quota(uuid)                             to authenticated, service_role;
grant execute on function public.record_stock_check(uuid, numeric, text, uuid) to authenticated;
grant execute on function public.next_count_candidates(uuid, int)           to authenticated;
grant execute on function public.should_ask_count(uuid)                     to authenticated;
grant execute on function public.register_push_token(text, text, text)      to authenticated;
grant execute on function public.dashboard_summary(uuid)                    to authenticated;
-- wyłącznie backend (Edge Functions / cron / webhooki)
grant execute on function public.effective_plan(uuid), public.ai_month_start() to service_role;
grant execute on function public.reserve_ai_scan(uuid, uuid, uuid)          to service_role;
grant execute on function public.finish_ai_scan(bigint, text, int, int, bigint, text) to service_role;
grant execute on function public.set_tenant_plan(uuid, text, timestamptz)   to service_role;
grant execute on function public.queue_count_reminders()                    to service_role;

alter publication supabase_realtime add table public.notifications;

-- ============================================================================
-- KONIEC 0007.
-- ============================================================================
