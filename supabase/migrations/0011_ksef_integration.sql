-- ============================================================================
-- Tapventory — migracja 0011: integracja z KSeF (strona bazy)
-- ============================================================================
-- KSeF = państwowy system e-faktur. Firma generuje w Aplikacji Podatnika KSeF
-- token z JEDNYM uprawnieniem („przeglądanie faktur"), wkleja go do Tapventory,
-- a my co kilka godzin pobieramy faktury ZAKUPU i zamieniamy je w szkice
-- dokumentów do sprawdzenia i zaksięgowania (te same ekrany co przy skanie zdjęcia).
--
-- Dla juniora — podział pracy:
--   * Edge Functions (TypeScript) rozmawiają z KSeF (szyfrowanie, logowanie, pobieranie, parser XML).
--   * Baza (ten plik) pilnuje tego, czego kod nie może zagwarantować sam:
--       - sekret (token) leży tylko w tabeli bez dostępu dla aplikacji, i to ZASZYFROWANY
--         kluczem, którego baza nie zna (patrz supabase/functions/_shared/ksef/token-vault.ts),
--       - jedna synchronizacja naraz na firmę (blokada w claim_ksef_sync),
--       - ta sama faktura nigdy nie powstaje dwa razy (indeks po numerze KSeF + kontrola NIP/numer),
--       - faktura wcześniej sfotografowana dostaje numer KSeF zamiast duplikatu.
--
-- A. Rozbudowa ksef_integrations (tabela z 0001 — dotąd tylko szkielet).
-- B. ksef_sync_runs — dziennik przebiegów (do ekranu „ostatnie synchronizacje" i diagnozy).
-- C. ksef_raw_invoices — surowy XML faktury (archiwum do ponownego odczytu bez pytania KSeF).
-- D. documents: numer KSeF — format, unikalność, zakaz ręcznej edycji.
-- E. Funkcje: get_ksef_status / disconnect_ksef (dla aplikacji, kierownictwo / właściciel);
--    save_ksef_connection, claim_ksef_sync, finish_ksef_sync, due_ksef_tenants,
--    ksef_known_numbers, import_ksef_invoice (wyłącznie backend).
-- ============================================================================

-- A ---------------------------------------------------------------------------
-- token_secret_id (odnośnik do Vault) nigdy nie był używany — sekret trzymamy zaszyfrowany
-- aplikacyjnie (token_ciphertext). Dzięki temu nie zależymy od rozszerzenia Vault i da się
-- to w pełni przetestować.
alter table public.ksef_integrations
  drop column token_secret_id,
  add column environment          text not null default 'prod' check (environment in ('test', 'demo', 'prod')),
  add column nip                  text check (nip is null or public.is_valid_nip(nip)),
  add column token_ciphertext     text check (token_ciphertext is null or char_length(token_ciphertext) between 20 and 4000),
  add column token_hint           text check (token_hint is null or char_length(token_hint) <= 8),
  add column import_from          date,
  add column cursor_at            timestamptz,                     -- „zrobione do tego momentu" (PermanentStorage / HWM)
  add column connected_by         uuid references auth.users (id) on delete set null,
  add column connected_at         timestamptz,
  add column sync_started_at      timestamptz,                     -- znacznik blokady: trwa synchronizacja
  add column last_attempt_at      timestamptz,
  add column next_attempt_at      timestamptz,                     -- wcześniejsza próba nie przed tym czasem (po błędzie)
  add column consecutive_failures int not null default 0,
  add column last_error           text check (last_error is null or char_length(last_error) <= 500),
  add constraint ksef_status_valid check (status in ('disconnected', 'connected', 'error')),
  add constraint ksef_connected_has_secret check (status = 'disconnected' or (token_ciphertext is not null and nip is not null));
-- last_sync_at (z 0001) znaczy od teraz: „ostatnia UDANA synchronizacja".

-- B ---------------------------------------------------------------------------
create table public.ksef_sync_runs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  trigger     text not null check (trigger in ('connect', 'manual', 'auto')),
  status      text not null default 'running' check (status in ('running', 'ok', 'partial', 'error')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  listed      int not null default 0 check (listed >= 0),          -- ile faktur KSeF wymienił na liście
  imported    int not null default 0 check (imported >= 0),        -- nowe dokumenty w Tapventory
  linked      int not null default 0 check (linked >= 0),          -- faktura już była (np. ze zdjęcia) → dopięto numer KSeF
  skipped     int not null default 0 check (skipped >= 0),         -- zaimportowane wcześniej
  failed      int not null default 0 check (failed >= 0),          -- nie udało się pobrać lub odczytać
  error       text check (error is null or char_length(error) <= 500)
);
create index idx_ksef_runs_tenant on public.ksef_sync_runs (tenant_id, started_at desc);
alter table public.ksef_sync_runs enable row level security;
revoke all on public.ksef_sync_runs from public, anon, authenticated;
grant select on public.ksef_sync_runs to service_role;

-- C ---------------------------------------------------------------------------
create table public.ksef_raw_invoices (
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  ksef_number text not null check (ksef_number ~ '^[0-9]{10}-[0-9]{8}-[0-9A-F]{12}-[0-9A-F]{2}$'),
  xml         text not null check (char_length(xml) <= 4000000),   -- KSeF: faktura do 1 MB (3 MB z załącznikiem)
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  fetched_at  timestamptz not null default now(),
  primary key (tenant_id, ksef_number)
);
alter table public.ksef_raw_invoices enable row level security;
revoke all on public.ksef_raw_invoices from public, anon, authenticated;
grant select on public.ksef_raw_invoices to service_role;

-- D ---------------------------------------------------------------------------
alter table public.documents
  add constraint documents_ksef_number_format
  check (ksef_number is null or ksef_number ~ '^[0-9]{10}-[0-9]{8}-[0-9A-F]{12}-[0-9A-F]{2}$');
create unique index documents_ksef_number_key
  on public.documents (tenant_id, ksef_number) where ksef_number is not null;

-- Numer KSeF nadaje państwowy system. Gdyby kierownik mógł go wpisać ręcznie, mógłby
-- „zająć" numer prawdziwej faktury i zablokować jej import.
create or replace function public.documents_ksef_number_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;                       -- backend (service_role) ustawia numer przy imporcie
  end if;
  if tg_op = 'INSERT' then
    new.ksef_number := null;
  elsif new.ksef_number is distinct from old.ksef_number then
    raise exception 'Numer KSeF nadaje system KSeF — nie edytuje się go ręcznie.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_documents_ksef_guard before insert or update on public.documents
  for each row execute function public.documents_ksef_number_guard();
revoke execute on function public.documents_ksef_number_guard() from public, anon, authenticated;

-- E1: dla aplikacji ----------------------------------------------------------
-- Stan połączenia + 10 ostatnich przebiegów. Nigdy nie zwraca tokenu ani jego szyfrogramu.
create or replace function public.get_ksef_status(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r      public.ksef_integrations;
  v_runs jsonb;
begin
  if not public.can_manage(p_tenant) then
    raise exception 'Stan KSeF widzi kierownictwo firmy.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.started_at desc), '[]'::jsonb) into v_runs
    from (select id, trigger, status, started_at, finished_at, listed, imported, linked, skipped, failed, error
            from public.ksef_sync_runs where tenant_id = p_tenant order by started_at desc limit 10) x;

  select * into r from public.ksef_integrations where tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('status', 'disconnected', 'runs', v_runs, 'running', false);
  end if;

  return jsonb_build_object(
    'status', r.status,
    'environment', r.environment,
    'nip', r.nip,
    'token_hint', r.token_hint,
    'import_from', r.import_from,
    'connected_at', r.connected_at,
    'last_sync_at', r.last_sync_at,
    'last_attempt_at', r.last_attempt_at,
    'last_error', r.last_error,
    'running', r.sync_started_at is not null and r.sync_started_at > now() - interval '10 minutes',
    'runs', v_runs
  );
end;
$$;

-- Odłączenie: kasuje szyfrogram tokenu. (Sam token w KSeF unieważnia się w Aplikacji Podatnika —
-- ekran w aplikacji podpowiada, jak to zrobić.) Dokumenty już pobrane zostają.
create or replace function public.disconnect_ksef(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner(p_tenant) then
    raise exception 'Połączenie z KSeF odłącza właściciel firmy.' using errcode = 'P0001';
  end if;
  update public.ksef_integrations
     set status = 'disconnected', token_ciphertext = null, token_hint = null,
         sync_started_at = null, next_attempt_at = null, consecutive_failures = 0, last_error = null
   where tenant_id = p_tenant;
  if found then
    insert into public.audit_log (tenant_id, user_id, action, table_name, row_id, data)
    values (p_tenant, auth.uid(), 'KSEF_DISCONNECT', 'ksef_integrations', null, '{}'::jsonb);
  end if;
end;
$$;

-- E2: dla backendu -----------------------------------------------------------
create or replace function public.save_ksef_connection(
  p_tenant uuid, p_user uuid, p_environment text, p_nip text, p_ciphertext text, p_hint text, p_import_from date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_environment not in ('test', 'demo', 'prod') then
    raise exception 'Nieznane środowisko KSeF.' using errcode = 'P0001';
  end if;
  if not public.is_valid_nip(p_nip) then
    raise exception 'NIP firmy jest nieprawidłowy.' using errcode = 'P0001';
  end if;

  insert into public.ksef_integrations as k
    (tenant_id, status, environment, nip, token_ciphertext, token_hint, import_from,
     connected_by, connected_at, consecutive_failures, last_error, next_attempt_at)
  values (p_tenant, 'connected', p_environment, p_nip, p_ciphertext, left(p_hint, 8), p_import_from, p_user, now(), 0, null, null)
  on conflict (tenant_id) do update
     set status = 'connected',
         -- zmiana NIP-u lub środowiska = zupełnie inny zbiór faktur → zaczynamy od początku
         cursor_at = case when k.nip is not distinct from excluded.nip and k.environment = excluded.environment
                          then k.cursor_at else null end,
         environment = excluded.environment, nip = excluded.nip,
         token_ciphertext = excluded.token_ciphertext, token_hint = excluded.token_hint,
         import_from = excluded.import_from, connected_by = excluded.connected_by, connected_at = now(),
         consecutive_failures = 0, last_error = null, next_attempt_at = null;

  insert into public.audit_log (tenant_id, user_id, action, table_name, row_id, data)
  values (p_tenant, p_user, 'KSEF_CONNECT', 'ksef_integrations', null,
          jsonb_build_object('environment', p_environment, 'nip', p_nip));
end;
$$;

-- Zajmuje „miejsce" na synchronizację: najwyżej jedna naraz na firmę, z zachowaniem odstępów
-- (KSeF zaleca nie częściej niż co 15 minut). Zwraca dane potrzebne do pracy albo powód odmowy.
create or replace function public.claim_ksef_sync(p_tenant uuid, p_trigger text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.ksef_integrations;
  v_run bigint;
begin
  if p_trigger not in ('connect', 'manual', 'auto') then
    raise exception 'Nieznany rodzaj synchronizacji.' using errcode = 'P0001';
  end if;
  select * into r from public.ksef_integrations where tenant_id = p_tenant for update;
  if not found or r.status = 'disconnected' then
    return jsonb_build_object('claimed', false, 'reason', 'not_connected');
  end if;
  if r.status = 'error' then
    return jsonb_build_object('claimed', false, 'reason', 'needs_reconnect');
  end if;

  -- przebiegi, które się nie zakończyły (funkcja padła w trakcie), oznaczamy jako błąd
  update public.ksef_sync_runs
     set status = 'error', finished_at = now(), error = 'Synchronizacja została przerwana (przekroczono czas).'
   where tenant_id = p_tenant and status = 'running' and started_at < now() - interval '10 minutes';

  if r.sync_started_at is not null and r.sync_started_at > now() - interval '10 minutes' then
    return jsonb_build_object('claimed', false, 'reason', 'already_running');
  end if;
  if p_trigger = 'auto'
     and coalesce(r.next_attempt_at, r.last_attempt_at + interval '3 hours', '-infinity') > now() then
    return jsonb_build_object('claimed', false, 'reason', 'too_soon');
  end if;
  if p_trigger = 'manual' and r.last_attempt_at is not null and r.last_attempt_at > now() - interval '2 minutes' then
    return jsonb_build_object('claimed', false, 'reason', 'too_soon');
  end if;

  insert into public.ksef_sync_runs (tenant_id, trigger) values (p_tenant, p_trigger) returning id into v_run;
  update public.ksef_integrations set sync_started_at = now(), last_attempt_at = now() where tenant_id = p_tenant;

  return jsonb_build_object(
    'claimed', true, 'run_id', v_run, 'environment', r.environment, 'nip', r.nip,
    'token_ciphertext', r.token_ciphertext, 'cursor_at', r.cursor_at, 'import_from', r.import_from);
end;
$$;

-- Zamyka przebieg. Kursor (cursor_at) nigdy nie cofa się. Błąd autoryzacji (token odrzucony)
-- wstrzymuje automatyczne pobieranie i powiadamia kierownictwo — bez tego bezskutecznie
-- pukalibyśmy do KSeF co kilka godzin.
create or replace function public.finish_ksef_sync(
  p_run bigint, p_status text, p_listed int, p_imported int, p_linked int, p_skipped int, p_failed int,
  p_error text, p_cursor timestamptz, p_auth_failed boolean default false, p_retry_after_sec int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run  public.ksef_sync_runs;
  r      public.ksef_integrations;
  v_err  text := left(nullif(btrim(coalesce(p_error, '')), ''), 500);
begin
  if p_status not in ('ok', 'partial', 'error') then
    raise exception 'Nieznany status synchronizacji.' using errcode = 'P0001';
  end if;
  select * into v_run from public.ksef_sync_runs where id = p_run for update;
  if not found or v_run.status <> 'running' then
    return;                                         -- idempotentne: przebieg już zamknięty
  end if;

  update public.ksef_sync_runs
     set status = p_status, finished_at = now(), listed = p_listed, imported = p_imported, linked = p_linked,
         skipped = p_skipped, failed = p_failed, error = v_err
   where id = p_run;

  select * into r from public.ksef_integrations where tenant_id = v_run.tenant_id for update;
  if found then
    update public.ksef_integrations
       set sync_started_at = null,
           cursor_at = case when p_cursor is null then cursor_at else greatest(coalesce(cursor_at, p_cursor), p_cursor) end,
           last_sync_at = case when p_status in ('ok', 'partial') then now() else last_sync_at end,
           consecutive_failures = case when p_status = 'error' then consecutive_failures + 1 else 0 end,
           last_error = case when p_status = 'ok' then null else v_err end,
           next_attempt_at = case
             when p_status = 'error' and not p_auth_failed
               then now() + least(interval '6 hours', make_interval(mins => 5 * (2 ^ least(consecutive_failures, 6))::int))
             when p_status = 'partial'
               then now() + make_interval(secs => least(1800, greatest(120, coalesce(p_retry_after_sec, 600))))
             else null end,
           status = case when p_auth_failed then 'error' else status end
     where tenant_id = v_run.tenant_id;

    if p_auth_failed and r.status = 'connected' then
      perform public.notify_managers(v_run.tenant_id, null, 'system', 'KSeF: połączenie przestało działać',
        'Token został odrzucony lub wygasł. Połącz KSeF ponownie w Ustawieniach.',
        jsonb_build_object('screen', 'ksef'), true);
    end if;
    if p_imported > 0 then
      perform public.notify_managers(v_run.tenant_id, null, 'document_ready',
        case when p_imported = 1 then 'Nowa faktura z KSeF' else format('Nowe faktury z KSeF: %s', p_imported) end,
        'Sprawdź pozycje i zaksięguj przyjęcie towaru.',
        jsonb_build_object('screen', 'documents'), true);
    end if;
  end if;

  -- trzymamy 50 ostatnich przebiegów
  delete from public.ksef_sync_runs
   where tenant_id = v_run.tenant_id
     and id not in (select id from public.ksef_sync_runs where tenant_id = v_run.tenant_id order by id desc limit 50);
end;
$$;

-- Firmy, którym należy się automatyczna synchronizacja (wołane z harmonogramu).
create or replace function public.due_ksef_tenants(p_limit int default 5)
returns table (tenant_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select k.tenant_id
    from public.ksef_integrations k
   where k.status = 'connected'
     and (k.sync_started_at is null or k.sync_started_at < now() - interval '10 minutes')
     and coalesce(k.next_attempt_at, k.last_attempt_at + interval '3 hours', '-infinity') <= now()
   order by k.last_attempt_at nulls first
   limit greatest(1, least(coalesce(p_limit, 5), 50));
$$;

-- Które z podanych numerów KSeF mamy już w dokumentach? (oszczędza limity zapytań do KSeF)
create or replace function public.ksef_known_numbers(p_tenant uuid, p_numbers text[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(d.ksef_number), '{}'::text[])
    from public.documents d
   where d.tenant_id = p_tenant and d.ksef_number = any (p_numbers);
$$;

-- Zapis jednej faktury z KSeF. Trzy możliwe wyniki:
--   exists  — ten numer KSeF już mamy (nic nie robimy),
--   linked  — ta sama faktura (NIP dostawcy + numer) weszła wcześniej innym kanałem, np. ze zdjęcia;
--             dopinamy numer KSeF zamiast tworzyć duplikat (również do dokumentu zaksięgowanego),
--   created — nowy dokument w statusie „draft": dostawca, pozycje i podpowiedzi produktów
--             powstają tym samym kodem, co przy skanie zdjęcia (apply_document_extraction).
-- Dane faktury (p_invoice) mają ten sam kształt co wynik odczytu AI — patrz 0010.
create or replace function public.import_ksef_invoice(
  p_tenant uuid, p_ksef_number text, p_invoice jsonb, p_xml text, p_xml_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nip      text := nullif(regexp_replace(coalesce(p_invoice ->> 'supplier_nip', ''), '[^0-9]', '', 'g'), '');
  v_number   text := nullif(btrim(coalesce(p_invoice ->> 'invoice_number', '')), '');
  v_existing public.documents;
  v_doc      uuid;
  v_res      jsonb;
begin
  if p_ksef_number is null or p_ksef_number !~ '^[0-9]{10}-[0-9]{8}-[0-9A-F]{12}-[0-9A-F]{2}$' then
    raise exception 'Nieprawidłowy numer KSeF.' using errcode = 'P0001';
  end if;
  if p_invoice is null or jsonb_typeof(p_invoice) <> 'object' then
    raise exception 'Brak danych faktury.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'Firma nie istnieje.' using errcode = 'P0001';
  end if;

  if p_xml is not null and p_xml_sha256 is not null then
    insert into public.ksef_raw_invoices (tenant_id, ksef_number, xml, sha256)
    values (p_tenant, p_ksef_number, p_xml, p_xml_sha256)
    on conflict (tenant_id, ksef_number) do nothing;
  end if;

  select * into v_existing from public.documents where tenant_id = p_tenant and ksef_number = p_ksef_number;
  if found then
    return jsonb_build_object('status', 'exists', 'document_id', v_existing.id);
  end if;

  if v_nip is not null and v_number is not null then
    select * into v_existing from public.documents
     where tenant_id = p_tenant and supplier_nip = v_nip and lower(btrim(invoice_number)) = lower(v_number)
     limit 1;
    if found then
      if v_existing.ksef_number is null then
        update public.documents set ksef_number = p_ksef_number where id = v_existing.id;
        return jsonb_build_object('status', 'linked', 'document_id', v_existing.id);
      end if;
      return jsonb_build_object('status', 'exists', 'document_id', v_existing.id);
    end if;
  end if;

  insert into public.documents (tenant_id, source, status, ksef_number)
  values (p_tenant, 'ksef', 'processing', p_ksef_number)
  returning id into v_doc;

  v_res := public.apply_document_extraction(v_doc, p_invoice);
  if v_res ->> 'status' = 'failed' then
    -- wyścig z równoległym dodaniem tej samej faktury: nie zostawiamy „pustego" dokumentu z numerem KSeF
    delete from public.documents where id = v_doc;
    return jsonb_build_object('status', 'exists', 'document_id', v_res ->> 'duplicate_of');
  end if;
  return jsonb_build_object('status', 'created', 'document_id', v_doc, 'lines', v_res -> 'lines', 'matched', v_res -> 'matched');
end;
$$;

-- Uprawnienia ----------------------------------------------------------------
revoke execute on function public.get_ksef_status(uuid)         from public, anon;
revoke execute on function public.disconnect_ksef(uuid)        from public, anon;
grant  execute on function public.get_ksef_status(uuid)         to authenticated;
grant  execute on function public.disconnect_ksef(uuid)        to authenticated;

revoke execute on function public.save_ksef_connection(uuid, uuid, text, text, text, text, date) from public, anon, authenticated;
revoke execute on function public.claim_ksef_sync(uuid, text)                                     from public, anon, authenticated;
revoke execute on function public.finish_ksef_sync(bigint, text, int, int, int, int, int, text, timestamptz, boolean, int) from public, anon, authenticated;
revoke execute on function public.due_ksef_tenants(int)                                           from public, anon, authenticated;
revoke execute on function public.ksef_known_numbers(uuid, text[])                                from public, anon, authenticated;
revoke execute on function public.import_ksef_invoice(uuid, text, jsonb, text, text)              from public, anon, authenticated;
grant  execute on function public.save_ksef_connection(uuid, uuid, text, text, text, text, date)  to service_role;
grant  execute on function public.claim_ksef_sync(uuid, text)                                     to service_role;
grant  execute on function public.finish_ksef_sync(bigint, text, int, int, int, int, int, text, timestamptz, boolean, int) to service_role;
grant  execute on function public.due_ksef_tenants(int)                                           to service_role;
grant  execute on function public.ksef_known_numbers(uuid, text[])                                to service_role;
grant  execute on function public.import_ksef_invoice(uuid, text, jsonb, text, text)              to service_role;

-- ============================================================================
-- KONIEC 0011.
-- ============================================================================
