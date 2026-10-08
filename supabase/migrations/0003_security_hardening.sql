-- ============================================================================
-- Tapventory — migracja 0003: TWARDE ZABEZPIECZENIA I SPÓJNOŚĆ
-- ============================================================================
-- Skąd ta migracja (dla juniora):
--   Testy na prawdziwym Postgresie (supabase/tests/) wykazały w migracjach 0001
--   i 0002 usterki, których nie widać "na oko". Zgodnie z zasadą projektu
--   („migracja raz napisana jest nietykalna") poprawiamy je NOWYM plikiem.
--   Pełny opis każdej usterki z dowodem: docs/05_RAPORT_WERYFIKACJI.md.
--
--   F1  Autoryzacja w RPC przepuszczała osoby spoza firmy. Przyczyna: logika
--       trójwartościowa SQL. is_owner() dla nie-członka zwracała NULL (nie
--       false), a `if not NULL then raise` NIE rzuca wyjątku. Skutek: dowolny
--       zalogowany użytkownik mógł wystawić sobie zaproszenie na WŁAŚCICIELA
--       cudzej firmy (znając jej UUID — np. były pracownik).
--   F2  Kierownik mógł zmienić rolę w istniejącym zaproszeniu (UPDATE).
--   F3  Pracownik widział faktury i ceny zakupu (macierz ról tego zabrania).
--   F4  Usunięcie firmy było niemożliwe (tabele „tylko do dopisywania"
--       blokowały kaskadę), a usunięcie konta — niemożliwe, gdy użytkownik
--       zostawił jakikolwiek ślad (klucze obce do auth.users). Apple i Google
--       wymagają usuwania kont, RODO też.
--   F5  Rejestracja wywalała się dla pustego imienia i dla kont bez e-maila.
--   F6  Brak kontroli spójności między firmami (dokument firmy A w ruchu
--       firmy C). Naprawa: złożone klucze obce (tenant_id, id).
--   F7  Kierownik mógł zmienić NIP firmy (kotwica ochrony okresów próbnych).
--   F8  Dowolny użytkownik mógł zatruć globalny katalog (nazwa pod cudzy EAN).
--   F9  Brak flagi can_manage_billing z dokumentu koncepcyjnego v1.1.
--   F10 Role `anon` miała domyślnie dostęp do wszystkiego w schemacie public.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FUNKCJE UPRAWNIEŃ: ZAWSZE true/false, NIGDY NULL  (naprawa F1)
-- ----------------------------------------------------------------------------
-- Zasada na całe życie projektu: funkcja uprawnień zwraca boolean bez NULL.
-- Dzięki temu `if not public.is_owner(...)` zawsze działa tak, jak czytamy.

create or replace function public.is_owner(t uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = t and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create or replace function public.can_manage(t uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = t and m.user_id = (select auth.uid())
      and m.role in ('owner', 'manager')
  );
$$;

-- Flaga uprawnień do płatności (np. księgowa jako „pracownik").
alter table public.memberships
  add column can_manage_billing boolean not null default false;

create or replace function public.can_manage_billing(t uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = t and m.user_id = (select auth.uid())
      and (m.role = 'owner' or m.can_manage_billing)
  );
$$;
grant execute on function public.can_manage_billing(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. TOŻSAMOŚĆ UŻYTKOWNIKA: profil jako „znacznik", konto da się usunąć (F4, F5)
-- ----------------------------------------------------------------------------
-- Problem: klucze obce z ruchów/zgłoszeń/czatu wskazywały na auth.users, więc
-- konto z jakąkolwiek historią było nieusuwalne. Rozwiązanie jak w księgowości
-- i RODO: ślad w księdze zostaje, ale dane osobowe znikają. Klucze wskazują
-- teraz na public.profiles, a profil po usunięciu konta jest ANONIMIZOWANY
-- (nie kasowany). Ruchy pokazują wtedy „Usunięty użytkownik".

alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles add column deleted_at timestamptz;

alter table public.stock_movements  drop constraint stock_movements_created_by_fkey;
alter table public.stock_movements  add  constraint stock_movements_created_by_fkey
  foreign key (created_by) references public.profiles (id);

alter table public.requests         drop constraint requests_reporter_id_fkey;
alter table public.requests         add  constraint requests_reporter_id_fkey
  foreign key (reporter_id) references public.profiles (id);

alter table public.request_messages drop constraint request_messages_author_id_fkey;
alter table public.request_messages add  constraint request_messages_author_id_fkey
  foreign key (author_id) references public.profiles (id);

alter table public.tenant_invites   drop constraint tenant_invites_invited_by_fkey;
alter table public.tenant_invites   add  constraint tenant_invites_invited_by_fkey
  foreign key (invited_by) references public.profiles (id);

alter table public.documents        drop constraint documents_created_by_fkey;
alter table public.documents        add  constraint documents_created_by_fkey
  foreign key (created_by) references public.profiles (id);
alter table public.documents        drop constraint documents_posted_by_fkey;
alter table public.documents        add  constraint documents_posted_by_fkey
  foreign key (posted_by) references public.profiles (id);

alter table public.catalog_items    drop constraint catalog_items_created_by_fkey;
alter table public.catalog_items    add  constraint catalog_items_created_by_fkey
  foreign key (created_by) references public.profiles (id);

-- Rejestracja nie może się wywalić: puste imię → część maila → „Użytkownik";
-- konto bez e-maila (telefon / anonimowe) też dostaje profil.
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
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Użytkownik'
      ),
      80
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Usunięcie konta w auth.users → anonimizacja profilu (zamiast kaskady).
create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set display_name = 'Usunięty użytkownik', phone = null, deleted_at = now()
   where id = old.id;
  return old;
end;
$$;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_user();

-- ----------------------------------------------------------------------------
-- 3. STRAŻNICY: członkostwa, tabele „tylko dopisywanie", niezmienność tenant_id
-- ----------------------------------------------------------------------------

-- 3.1 Dopisywanie-tylko z wyjątkiem świadomego usuwania CAŁEJ firmy.
--     Funkcja delete_tenant() ustawia zmienną sesji, która zwalnia blokadę
--     wyłącznie dla wierszy usuwanej firmy, w jednej transakcji.
create or replace function public.forbid_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
     and old.tenant_id is not null
     and current_setting('tapventory.deleting_tenant', true) = old.tenant_id::text then
    return old;
  end if;
  raise exception 'Tabela % jest tylko do dopisywania. Pomyłkę koryguje się nowym wpisem, nie edycją.', tg_table_name
    using errcode = 'P0001';
end;
$$;

-- 3.2 Członkostwa: nowe reguły (flaga billingowa, auto-czyszczenie flagi
--     kierownika, wyjątek dla backendu/service_role = auth.uid() IS NULL).
create or replace function public.membership_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id <> old.tenant_id or new.user_id <> old.user_id then
    raise exception 'Nie można przenieść członkostwa.' using errcode = 'P0001';
  end if;

  -- Flaga „zarządza kierownikami" ma sens wyłącznie przy roli kierownika.
  if new.role <> 'manager' then
    new.can_manage_managers := false;
  end if;

  if (new.role is distinct from old.role)
     or (new.can_manage_managers is distinct from old.can_manage_managers)
     or (new.can_manage_billing is distinct from old.can_manage_billing) then
    -- auth.uid() IS NULL = operacja backendu (service_role / procedura
    -- administracyjna zmiany właściciela z dokumentu koncepcyjnego, rozdz. 6).
    -- Każdy zalogowany użytkownik musi być właścicielem.
    if auth.uid() is not null and not public.is_owner(old.tenant_id) then
      raise exception 'Role i flagi uprawnień zmienia wyłącznie właściciel.'
        using errcode = 'P0001';
    end if;
  end if;

  if old.role = 'owner' and new.role <> 'owner'
     and public.owners_count(old.tenant_id) <= 1 then
    raise exception 'Firma musi mieć co najmniej jednego właściciela.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.membership_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Wyjątek: świadome usuwanie całej firmy (delete_tenant).
  if current_setting('tapventory.deleting_tenant', true) = old.tenant_id::text then
    return old;
  end if;
  if old.role = 'owner' and public.owners_count(old.tenant_id) <= 1 then
    raise exception 'Nie można usunąć ostatniego właściciela firmy.'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

-- 3.3 tenant_id jest niezmienny we wszystkich tabelach firmowych (wiersza nie
--     da się „przerzucić" do innej firmy).
create or replace function public.forbid_tenant_change()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'Nie można zmienić firmy, do której należy wiersz.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_suppliers_tenant_fixed       before update on public.suppliers
  for each row execute function public.forbid_tenant_change();
create trigger trg_products_tenant_fixed        before update on public.products
  for each row execute function public.forbid_tenant_change();
create trigger trg_projects_tenant_fixed        before update on public.projects
  for each row execute function public.forbid_tenant_change();
create trigger trg_documents_tenant_fixed       before update on public.documents
  for each row execute function public.forbid_tenant_change();
create trigger trg_document_lines_tenant_fixed  before update on public.document_lines
  for each row execute function public.forbid_tenant_change();
create trigger trg_requests_tenant_fixed        before update on public.requests
  for each row execute function public.forbid_tenant_change();

-- 3.4 Dziennik zdarzeń: bez sekretów (tokeny, kody) w danych śladu.
create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (tenant_id, user_id, action, table_name, row_id, data)
  values (
    coalesce(new.tenant_id, old.tenant_id),
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(new.id, old.id),
    v_row - 'token' - 'code' - 'token_secret_id'
  );
  return coalesce(new, old);
end;
$$;

-- Ślad dla tenants (tam kluczem firmy jest `id`, nie `tenant_id`).
create or replace function public.log_audit_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (tenant_id, user_id, action, table_name, row_id, data)
  values (
    coalesce(new.id, old.id), auth.uid(), tg_op, tg_table_name, coalesce(new.id, old.id),
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;
create trigger trg_audit_tenants  after update on public.tenants
  for each row execute function public.log_audit_tenant();
create trigger trg_audit_projects after insert or update or delete on public.projects
  for each row execute function public.log_audit();
create trigger trg_audit_invites  after insert or update on public.tenant_invites
  for each row execute function public.log_audit();

-- ----------------------------------------------------------------------------
-- 4. ZESPÓŁ I ZAPROSZENIA  (naprawa F1, F2; nowe: kod, flagi, widoki)
-- ----------------------------------------------------------------------------

-- Krótki kod do przepisania (8 znaków bez mylących 0/O/1/I): ABCD-EFGH.
-- Losowość z gen_random_uuid() (CSPRNG); bajt % 32 daje rozkład bez przechyłu.
create or replace function public.gen_invite_code()
returns text
language sql volatile
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                  1 + (get_byte(decode(substr(h, 2 * i - 1, 2), 'hex'), 0) % 32), 1),
           '' order by i)
  from (select replace(gen_random_uuid()::text, '-', '') as h) x,
       generate_series(1, 8) as i;
$$;

alter table public.tenant_invites
  add column can_manage_billing boolean not null default false,
  add column code               text   not null default public.gen_invite_code(),
  add column accepted_by        uuid references public.profiles (id),
  add column accepted_at        timestamptz;
alter table public.tenant_invites add constraint tenant_invites_code_key unique (code);

-- Jedno aktywne zaproszenie na adres w firmie:
create unique index tenant_invites_one_pending
  on public.tenant_invites (tenant_id, lower(email)) where status = 'pending';

-- Dostęp do tabeli tylko przez RPC i widok (kolumny token/code są sekretne).
drop policy "invites: podgląd dla kierownictwa"   on public.tenant_invites;
drop policy "invites: cofanie przez kierownictwo" on public.tenant_invites;
drop policy "invites: usuwanie przez kierownictwo" on public.tenant_invites;
revoke all on public.tenant_invites from anon, authenticated;

-- Czy wolno komuś wystawić / cofnąć zaproszenie na daną rolę (macierz z koncepcji).
create or replace function public.can_invite_role(p_tenant uuid, p_role public.member_role)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case p_role
    when 'owner'   then public.is_owner(p_tenant)
    when 'manager' then public.can_manage_managers(p_tenant)
    else                public.can_manage(p_tenant)
  end;
$$;

drop function public.create_invite(uuid, text, public.member_role, boolean);

create function public.create_invite(
  p_tenant          uuid,
  p_email           text,
  p_role            public.member_role default 'employee',
  p_manage_managers boolean default false,
  p_manage_billing  boolean default false
)
returns public.tenant_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row   public.tenant_invites;
begin
  if auth.uid() is null then
    raise exception 'Wymagane zalogowanie.' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Podaj poprawny adres e-mail.' using errcode = 'P0001';
  end if;

  -- Macierz uprawnień. Dzięki funkcjom bez NULL osoba spoza firmy ZAWSZE
  -- zatrzyma się na tym sprawdzeniu.
  if not public.can_invite_role(p_tenant, p_role) then
    raise exception '%', case p_role
      when 'owner'   then 'Współwłaściciela zaprasza wyłącznie właściciel.'
      when 'manager' then 'Kierownika zaprasza właściciel lub kierownik z uprawnieniem.'
      else                'Pracownika zaprasza kierownik lub właściciel.'
    end using errcode = 'P0001';
  end if;

  if p_manage_managers and p_role <> 'manager' then
    raise exception 'Flaga zarządzania kierownikami dotyczy tylko kierowników.' using errcode = 'P0001';
  end if;
  if (p_manage_managers or p_manage_billing) and not public.is_owner(p_tenant) then
    raise exception 'Flagi uprawnień nadaje wyłącznie właściciel.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from auth.users u
    join public.memberships m on m.user_id = u.id
    where lower(u.email) = v_email and m.tenant_id = p_tenant
  ) then
    raise exception 'Ta osoba już należy do firmy.' using errcode = 'P0001';
  end if;

  if (select count(*) from public.tenant_invites
      where tenant_id = p_tenant and status = 'pending') >= 50 then
    raise exception 'Zbyt wiele oczekujących zaproszeń. Cofnij nieużywane.' using errcode = 'P0001';
  end if;

  -- „Wyślij ponownie" = stare zaproszenie na ten adres wygasa, powstaje nowe.
  update public.tenant_invites
     set status = 'revoked'
   where tenant_id = p_tenant and lower(email) = v_email and status = 'pending';

  insert into public.tenant_invites
    (tenant_id, email, role, can_manage_managers, can_manage_billing, invited_by)
  values
    (p_tenant, v_email, p_role, p_manage_managers, p_manage_billing, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.tenant_invites;
begin
  select * into v_invite from public.tenant_invites where id = p_invite;
  if not found or not public.can_invite_role(v_invite.tenant_id, v_invite.role) then
    -- ten sam komunikat dla „nie istnieje" i „brak uprawnień" — nie zdradzamy,
    -- czy zaproszenie o danym id istnieje w cudzej firmie
    raise exception 'Nie znaleziono zaproszenia lub brak uprawnień.' using errcode = 'P0001';
  end if;
  update public.tenant_invites set status = 'revoked' where id = p_invite and status = 'pending';
end;
$$;

-- Wspólna logika przyjęcia zaproszenia (po tokenie lub po kodzie).
create or replace function public._accept_invite(v_invite public.tenant_invites)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_conf  timestamptz;
begin
  if v_uid is null then
    raise exception 'Wymagane zalogowanie.' using errcode = 'P0001';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Zaproszenie zostało już użyte lub cofnięte.' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'Zaproszenie wygasło. Poproś o nowe.' using errcode = 'P0001';
  end if;

  -- Prawda o adresie e-mail pochodzi z bazy kont, nie z (starzejącego się) tokenu.
  select lower(u.email), u.email_confirmed_at into v_email, v_conf
  from auth.users u where u.id = v_uid;

  if v_conf is null then
    raise exception 'Najpierw potwierdź swój adres e-mail (link w wiadomości od nas).' using errcode = 'P0001';
  end if;
  if v_email is distinct from lower(v_invite.email) then
    raise exception 'Zaproszenie wystawiono na inny adres e-mail (%).', v_invite.email
      using errcode = 'P0001';
  end if;

  insert into public.memberships (tenant_id, user_id, role, can_manage_managers, can_manage_billing)
  values (v_invite.tenant_id, v_uid, v_invite.role, v_invite.can_manage_managers, v_invite.can_manage_billing)
  on conflict (tenant_id, user_id) do nothing;

  update public.tenant_invites
     set status = 'accepted', accepted_by = v_uid, accepted_at = now()
   where id = v_invite.id;

  return v_invite.tenant_id;
end;
$$;
revoke all on function public._accept_invite(public.tenant_invites) from public, anon, authenticated;

create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.tenant_invites;
begin
  select * into v_invite from public.tenant_invites where token = p_token for update;
  if not found then
    raise exception 'Zaproszenie nie istnieje.' using errcode = 'P0001';
  end if;
  return public._accept_invite(v_invite);
end;
$$;

create or replace function public.accept_invite_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.tenant_invites;
begin
  select * into v_invite from public.tenant_invites
   where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
   for update;
  if not found then
    raise exception 'Zaproszenie nie istnieje.' using errcode = 'P0001';
  end if;
  return public._accept_invite(v_invite);
end;
$$;

-- Podgląd zaproszenia przed przyjęciem („Zaproszono Cię do firmy X jako …").
create or replace function public.get_invite_preview(p_token uuid)
returns table (tenant_name text, role public.member_role, inviter_name text,
               masked_email text, status public.invite_status, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Wymagane zalogowanie.' using errcode = 'P0001';
  end if;
  return query
    select t.name, i.role, p.display_name,
           regexp_replace(i.email, '^(.).*(@.*)$', '\1***\2'),
           i.status, i.expires_at
    from public.tenant_invites i
    join public.tenants t on t.id = i.tenant_id
    join public.profiles p on p.id = i.invited_by
    where i.token = p_token;
end;
$$;

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
  select tenant_id, role into v_tenant, v_role from public.memberships where id = p_membership;
  if not found or not public.is_owner(v_tenant) then
    raise exception 'Flagę nadaje wyłącznie właściciel.' using errcode = 'P0001';
  end if;
  if v_role <> 'manager' then
    raise exception 'Flaga dotyczy tylko kierowników.' using errcode = 'P0001';
  end if;
  update public.memberships set can_manage_managers = p_flag where id = p_membership;
end;
$$;

create or replace function public.set_billing_flag(p_membership uuid, p_flag boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.memberships where id = p_membership;
  if not found or not public.is_owner(v_tenant) then
    raise exception 'Uprawnienie do płatności nadaje wyłącznie właściciel.' using errcode = 'P0001';
  end if;
  update public.memberships set can_manage_billing = p_flag where id = p_membership;
end;
$$;

-- Widoki dla ekranu „Zespół" — bez sekretów, tylko dla uprawnionych.
-- Widok działa z prawami właściciela (omija RLS), więc FILTR w WHERE jest
-- jego jedynym zabezpieczeniem — i jest sprawdzany testami.
create view public.team_members
with (security_invoker = false)
as
select
  m.id as membership_id, m.tenant_id, m.user_id, m.role,
  m.can_manage_managers, m.can_manage_billing, m.created_at,
  p.display_name,
  case when public.can_manage(m.tenant_id) then u.email::text end as email
from public.memberships m
join public.profiles p on p.id = m.user_id
left join auth.users u on u.id = m.user_id
where public.is_member(m.tenant_id);

create view public.team_invites
with (security_invoker = false)
as
select
  i.id, i.tenant_id, i.email, i.role, i.can_manage_managers, i.can_manage_billing,
  i.status, i.expires_at, i.created_at, p.display_name as invited_by_name
from public.tenant_invites i
join public.profiles p on p.id = i.invited_by
where public.can_manage(i.tenant_id);

-- Kto i co może zmieniać w członkostwach (kolumny) — reszta tylko przez RPC.
revoke update on public.memberships from authenticated;
grant  update (role, can_manage_managers, can_manage_billing) on public.memberships to authenticated;

-- ----------------------------------------------------------------------------
-- 5. FIRMA: NIP, zakładanie, usuwanie  (naprawa F4, F7)
-- ----------------------------------------------------------------------------

-- Suma kontrolna polskiego NIP (wagi 6,5,7,2,3,4,5,6,7; reszta z dzielenia
-- przez 11 musi równać się ostatniej cyfrze; reszta 10 = NIP nieprawidłowy).
create or replace function public.is_valid_nip(p_nip text)
returns boolean
language plpgsql immutable
as $$
declare
  w int[] := array[6, 5, 7, 2, 3, 4, 5, 6, 7];
  s int := 0;
  i int;
begin
  -- pierwsze trzy cyfry to kod urzędu skarbowego (101-999), więc NIP nie zaczyna
  -- się od zera; sam suma kontrolna przepuszcza np. 0000000000
  if p_nip is null or p_nip !~ '^[1-9][0-9]{9}$' then
    return false;
  end if;
  for i in 1..9 loop
    s := s + substr(p_nip, i, 1)::int * w[i];
  end loop;
  return (s % 11) = substr(p_nip, 10, 1)::int;
end;
$$;
grant execute on function public.is_valid_nip(text) to authenticated;

alter table public.tenants
  add constraint tenants_nip_checksum check (nip is null or public.is_valid_nip(nip));
alter table public.suppliers
  add constraint suppliers_nip_checksum check (nip is null or public.is_valid_nip(nip));

-- Zwykła edycja firmy: tylko dane kontaktowe. NIP zmienia wyłącznie właściciel
-- przez set_tenant_nip (ślad w dzienniku); plany/triale — wyłącznie backend.
revoke update on public.tenants from authenticated;
grant  update (name, address_line, city, postal_code, lat, lng, industry)
  on public.tenants to authenticated;
drop policy "tenants: usunięcie przez właściciela" on public.tenants;  -- patrz delete_tenant()

create or replace function public.set_tenant_nip(p_tenant uuid, p_nip text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nip text := nullif(btrim(coalesce(p_nip, '')), '');
begin
  if not public.is_owner(p_tenant) then
    raise exception 'NIP zmienia wyłącznie właściciel.' using errcode = 'P0001';
  end if;
  if v_nip is not null and not public.is_valid_nip(v_nip) then
    raise exception 'Nieprawidłowy NIP (sprawdź cyfry — suma kontrolna się nie zgadza).' using errcode = 'P0001';
  end if;
  update public.tenants set nip = v_nip where id = p_tenant;
end;
$$;

drop function public.create_tenant(text, text);

create function public.create_tenant(
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
  -- ochrona przed masowym zakładaniem firm przez jedno konto
  if (select count(*) from public.memberships where user_id = v_uid and role = 'owner') >= 5 then
    raise exception 'Jedno konto może być właścicielem najwyżej 5 firm.' using errcode = 'P0001';
  end if;

  insert into public.tenants (name, nip, industry)
  values (v_name, v_nip, nullif(btrim(coalesce(p_industry, '')), ''))
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

-- Ślad po usuniętych firmach (bez danych osobowych) — na wypadek sporu.
create table public.tenant_deletions (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null,
  name       text not null,
  nip        text,
  deleted_by uuid references public.profiles (id),
  deleted_at timestamptz not null default now()
);
alter table public.tenant_deletions enable row level security;   -- zero polityk = tylko backend
revoke all on public.tenant_deletions from anon, authenticated;
create trigger trg_tenant_deletions_append_only before update or delete on public.tenant_deletions
  for each row execute function public.forbid_change();

create or replace function public.delete_tenant(p_tenant uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_nip  text;
begin
  if auth.uid() is null then
    raise exception 'Wymagane zalogowanie.' using errcode = 'P0001';
  end if;
  if not public.is_owner(p_tenant) then
    raise exception 'Firmę usuwa wyłącznie właściciel.' using errcode = 'P0001';
  end if;
  select name, nip into v_name, v_nip from public.tenants where id = p_tenant;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v_name)) then
    raise exception 'Aby usunąć firmę, wpisz jej dokładną nazwę.' using errcode = 'P0001';
  end if;

  insert into public.tenant_deletions (tenant_id, name, nip, deleted_by)
  values (p_tenant, v_name, v_nip, auth.uid());

  -- zwalnia blokady „tylko dopisywanie" wyłącznie dla tej firmy, w tej transakcji
  perform set_config('tapventory.deleting_tenant', p_tenant::text, true);
  delete from public.tenants where id = p_tenant;
end;
$$;

-- Usunięcie konta (wymóg Apple 5.1.1(v), Google Play i RODO).
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_blocking text;
begin
  if v_uid is null then
    raise exception 'Wymagane zalogowanie.' using errcode = 'P0001';
  end if;

  select string_agg(t.name, ', ' order by t.name) into v_blocking
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = v_uid and m.role = 'owner' and public.owners_count(m.tenant_id) = 1;

  if v_blocking is not null then
    raise exception 'Jesteś jedynym właścicielem firm: %. Przekaż im własność albo usuń firmy, zanim usuniesz konto.', v_blocking
      using errcode = 'P0001';
  end if;

  delete from auth.users where id = v_uid;   -- kaskada: członkostwa; trigger: anonimizacja profilu
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. KATALOG GLOBALNY: koniec z zatruwaniem  (naprawa F8)
-- ----------------------------------------------------------------------------
-- Wpisy tworzy wyłącznie backend (kuracja / import z Open Food Facts).
-- Firmy mają własne `products` z własnym EAN — katalog jest tylko podpowiedzią.
drop policy "catalog: dopisywanie z podpisem" on public.catalog_items;
revoke insert, update, delete on public.catalog_items from authenticated;

-- ----------------------------------------------------------------------------
-- 7. FAKTURY TYLKO DLA KIEROWNICTWA  (naprawa F3)  + zdjęcia produktów dla wszystkich
-- ----------------------------------------------------------------------------
drop policy "documents: podgląd" on public.documents;
create policy "documents: podgląd dla kierownictwa" on public.documents
  for select to authenticated using (public.can_manage(tenant_id));

drop policy "doclines: podgląd" on public.document_lines;
create policy "doclines: podgląd dla kierownictwa" on public.document_lines
  for select to authenticated using (public.can_manage(tenant_id));

drop policy "storage: odczyt w obrębie firmy"       on storage.objects;
drop policy "storage: zapis w obrębie firmy"        on storage.objects;
drop policy "storage: usuwanie przez kierownictwo"  on storage.objects;

-- product-photos: wszyscy z firmy (zgłoszenia ze zdjęciem). documents: kierownictwo.
create policy "storage: odczyt" on storage.objects for select to authenticated using (
  (bucket_id = 'product-photos' and public.is_member(public.path_tenant(name)))
  or (bucket_id = 'documents'   and public.can_manage(public.path_tenant(name)))
);
create policy "storage: zapis" on storage.objects for insert to authenticated with check (
  (bucket_id = 'product-photos' and public.is_member(public.path_tenant(name)))
  or (bucket_id = 'documents'   and public.can_manage(public.path_tenant(name)))
);
create policy "storage: usuwanie" on storage.objects for delete to authenticated using (
  bucket_id in ('documents', 'product-photos') and public.can_manage(public.path_tenant(name))
);

-- ----------------------------------------------------------------------------
-- 8. SPÓJNOŚĆ MIĘDZY FIRMAMI: złożone klucze obce  (naprawa F6)
-- ----------------------------------------------------------------------------
-- Zamiast „document_id wskazuje jakikolwiek dokument" wymuszamy „dokument tej
-- samej firmy": klucz obcy obejmuje PARĘ (tenant_id, id). Baza odrzuci każdą
-- próbę podpięcia cudzego rekordu — niezależnie od tego, kto i jak zapisuje
-- (aplikacja, Edge Function, ręczny SQL).
alter table public.suppliers add constraint suppliers_tenant_id_id_key unique (tenant_id, id);
alter table public.products  add constraint products_tenant_id_id_key  unique (tenant_id, id);
alter table public.projects  add constraint projects_tenant_id_id_key  unique (tenant_id, id);
alter table public.documents add constraint documents_tenant_id_id_key unique (tenant_id, id);
alter table public.requests  add constraint requests_tenant_id_id_key  unique (tenant_id, id);

-- products.default_supplier_id
alter table public.products drop constraint products_default_supplier_id_fkey;
alter table public.products add constraint products_supplier_same_tenant
  foreign key (tenant_id, default_supplier_id) references public.suppliers (tenant_id, id)
  on delete set null (default_supplier_id);

-- documents.supplier_id
alter table public.documents drop constraint documents_supplier_id_fkey;
alter table public.documents add constraint documents_supplier_same_tenant
  foreign key (tenant_id, supplier_id) references public.suppliers (tenant_id, id)
  on delete set null (supplier_id);

-- document_lines
alter table public.document_lines drop constraint document_lines_document_id_fkey;
alter table public.document_lines add constraint document_lines_document_same_tenant
  foreign key (tenant_id, document_id) references public.documents (tenant_id, id)
  on delete cascade;
alter table public.document_lines drop constraint document_lines_product_id_fkey;
alter table public.document_lines add constraint document_lines_product_same_tenant
  foreign key (tenant_id, product_id) references public.products (tenant_id, id);
alter table public.document_lines drop constraint document_lines_project_id_fkey;
alter table public.document_lines add constraint document_lines_project_same_tenant
  foreign key (tenant_id, project_id) references public.projects (tenant_id, id)
  on delete set null (project_id);

-- stock_movements (NO ACTION zamiast RESTRICT: produkt z historią nadal jest
-- nieusuwalny, ale kaskada usuwania CAŁEJ firmy przechodzi)
alter table public.stock_movements drop constraint stock_movements_product_id_fkey;
alter table public.stock_movements add constraint stock_movements_product_same_tenant
  foreign key (tenant_id, product_id) references public.products (tenant_id, id);
alter table public.stock_movements drop constraint stock_movements_document_id_fkey;
alter table public.stock_movements add constraint stock_movements_document_same_tenant
  foreign key (tenant_id, document_id) references public.documents (tenant_id, id)
  on delete set null (document_id);
alter table public.stock_movements drop constraint stock_movements_project_id_fkey;
alter table public.stock_movements add constraint stock_movements_project_same_tenant
  foreign key (tenant_id, project_id) references public.projects (tenant_id, id)
  on delete set null (project_id);

-- requests
alter table public.requests drop constraint requests_product_id_fkey;
alter table public.requests add constraint requests_product_same_tenant
  foreign key (tenant_id, product_id) references public.products (tenant_id, id)
  on delete set null (product_id);
alter table public.requests drop constraint requests_project_id_fkey;
alter table public.requests add constraint requests_project_same_tenant
  foreign key (tenant_id, project_id) references public.projects (tenant_id, id)
  on delete set null (project_id);
alter table public.requests drop constraint requests_supplier_id_fkey;
alter table public.requests add constraint requests_supplier_same_tenant
  foreign key (tenant_id, supplier_id) references public.suppliers (tenant_id, id)
  on delete set null (supplier_id);

-- request_messages
alter table public.request_messages drop constraint request_messages_request_id_fkey;
alter table public.request_messages add constraint request_messages_request_same_tenant
  foreign key (tenant_id, request_id) references public.requests (tenant_id, id)
  on delete cascade;

-- Stary trigger sprawdzający zgodność produkt↔firma jest zbędny (robi to klucz obcy).
drop trigger trg_movements_same_tenant on public.stock_movements;
drop function public.movement_same_tenant();

-- Jeden produkt na EAN w firmie (skan musi trafiać jednoznacznie).
create unique index products_tenant_ean_unique
  on public.products (tenant_id, ean) where ean is not null and active;

-- ----------------------------------------------------------------------------
-- 9. HIGIENA UPRAWNIEŃ  (naprawa F10)
-- ----------------------------------------------------------------------------
-- Aplikacja używa wyłącznie zalogowanych (authenticated); backend — service_role.
-- Rola anon (niezalogowany) nie dostaje NIC w schemacie public, także w przyszłych
-- tabelach i funkcjach.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from public, anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Jawne „permission denied" zamiast cichego „0 wierszy": dla operacji, których
-- zalogowany użytkownik NIGDY nie wykonuje bezpośrednio, odbieramy uprawnienie
-- całkiem (RLS zostaje jako druga linia obrony). Błąd od razu pokazuje, że
-- aplikacja robi coś niedozwolonego, zamiast udawać, że się udało.
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- księga i dziennik: tylko dopisywanie (i odczyt)
revoke update, delete on public.stock_movements   from authenticated;
revoke update, delete on public.request_messages  from authenticated;
revoke insert, update, delete on public.audit_log      from authenticated;
revoke insert, update, delete on public.reward_ledger  from authenticated;
-- dane prowadzone wyłącznie przez backend / RPC
revoke insert, update, delete on public.referral_codes from authenticated;
revoke insert, update, delete on public.referrals      from authenticated;
revoke insert, delete on public.tenants     from authenticated;   -- tworzy create_tenant, usuwa delete_tenant
revoke insert         on public.memberships from authenticated;   -- tworzy create_tenant / accept_invite
revoke all on public.ksef_integrations from authenticated;
-- profil: użytkownik edytuje tylko imię i telefon (nie deleted_at); tworzy go trigger
revoke insert, update, delete on public.profiles from authenticated;
grant  update (display_name, phone) on public.profiles to authenticated;

-- RPC wołane z aplikacji (reszta funkcji to helpery RLS i triggery).
revoke execute on function public.create_invite(uuid, text, public.member_role, boolean, boolean) from public, anon;
grant  execute on function public.create_invite(uuid, text, public.member_role, boolean, boolean) to authenticated;
grant  execute on function public.revoke_invite(uuid)            to authenticated;
grant  execute on function public.accept_invite(uuid)            to authenticated;
grant  execute on function public.accept_invite_code(text)       to authenticated;
grant  execute on function public.get_invite_preview(uuid)       to authenticated;
grant  execute on function public.set_manager_flag(uuid, boolean) to authenticated;
grant  execute on function public.set_billing_flag(uuid, boolean) to authenticated;
grant  execute on function public.set_tenant_nip(uuid, text)     to authenticated;
grant  execute on function public.create_tenant(text, text, text) to authenticated;
grant  execute on function public.delete_tenant(uuid, text)      to authenticated;
grant  execute on function public.delete_account()               to authenticated;
grant  execute on function public.can_invite_role(uuid, public.member_role) to authenticated;

-- Funkcje wyzwalaczy nie mają być widoczne jako RPC.
revoke execute on function
  public.set_updated_at(), public.forbid_change(), public.forbid_tenant_change(),
  public.lock_posted_document(), public.membership_guard(), public.membership_delete_guard(),
  public.handle_new_user(), public.handle_deleted_user(), public.log_audit(),
  public.log_audit_tenant(), public.gen_invite_code()
from public, anon, authenticated;

-- Widoki dla aplikacji: tylko odczyt (domyślne granty dawałyby też zapis).
revoke insert, update, delete on public.team_members, public.team_invites, public.product_stock from authenticated;
grant select on public.team_members, public.team_invites to authenticated;

-- ============================================================================
-- KONIEC 0003.
-- ============================================================================
