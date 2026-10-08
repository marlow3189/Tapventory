-- ============================================================================
-- Tapventory - testowe "udawane Supabase" na zwyklym Postgresie
-- ============================================================================
-- Po co to jest (dla juniora):
--   Nasze migracje zakladaja, ze baza ma elementy dostarczane normalnie przez
--   Supabase: role (anon / authenticated / service_role), schemat `auth`
--   (tabela users + funkcje auth.uid(), auth.jwt()), schemat `storage` oraz
--   publikacje Realtime. Ten plik odtwarza je w minimalnej postaci, zeby
--   testy bazy dzialaly na KAZDYM Postgresie 15+ (takze w CI, bez Dockera
--   i bez Supabase CLI).
--
--   To jest przyblizenie, nie kopia. Ostateczny test migracji zawsze robi
--   `npx supabase db reset` na prawdziwym Supabase.
--
-- Skrypt jest idempotentny dla rol (sa wspolne dla calego serwera Postgresa).
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Schemat na rozszerzenia (tak jak w Supabase) + rozszerzenia uzywane przez migracje.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- Schemat auth: tabela uzytkownikow i funkcje odczytujace token JWT.
-- Wartosci "request.jwt.claims" ustawia w prawdziwym Supabase PostgREST
-- przy kazdym zapytaniu; w testach ustawiamy je recznie (helpers.mjs).
-- ----------------------------------------------------------------------------
create schema if not exists auth;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid,
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  phone              text,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  is_anonymous       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create function auth.uid()
returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.jwt()
returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create function auth.role()
returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Schemat storage: koszyki, obiekty (RLS wlaczone, jak w Supabase).
-- ----------------------------------------------------------------------------
create schema if not exists storage;

create table storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table storage.objects enable row level security;

create function storage.foldername(name text)
returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Publikacja Realtime (migracja 0002 dopisuje do niej tabele).
-- ----------------------------------------------------------------------------
create publication supabase_realtime;

-- ----------------------------------------------------------------------------
-- Domyslne uprawnienia schematu public - tak jak w Supabase kazda nowa tabela,
-- funkcja i sekwencja jest od razu dostepna dla rol API. O dostepie do DANYCH
-- decyduja potem RLS i REVOKE w migracjach, nie te domyslne granty.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
