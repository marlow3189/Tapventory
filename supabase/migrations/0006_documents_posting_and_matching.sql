-- ============================================================================
-- Tapventory — migracja 0006: FAKTURY — przetwarzanie, KSIĘGOWANIE, STORNO, ALIASY
-- ============================================================================
-- Dla juniora — zasady, które ta migracja wprowadza w życie
-- (dokument koncepcyjny v1.1, rozdz. 9):
--   1. Faktura przechodzi: processing → draft → (verified) → posted.
--      Status „posted" i powrót z niego ustawiają WYŁĄCZNIE funkcje
--      post_document / unpost_document. Żadne bezpośrednie UPDATE tego nie zrobi.
--   2. „Nie gumkujemy — stornujemy": unpost_document dopisuje ruchy odwrotne
--      i przywraca dokument do szkicu. Księga ruchów nigdy nie jest edytowana.
--   3. Księgowanie to JEDNA transakcja: albo powstają wszystkie ruchy, albo
--      żaden. Ta sama pozycja nie może zostać zaksięgowana dwa razy.
--   4. Każde ręczne przypisanie „pozycja z faktury → produkt" zapisuje się w
--      słowniku aliasów (product_aliases). System uczy się: następnym razem
--      ta sama nazwa od tego dostawcy trafia sama.
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;   -- podobieństwo nazw (dopasowanie)

-- ----------------------------------------------------------------------------
-- 1. KOLUMNY
-- ----------------------------------------------------------------------------
alter table public.documents
  add column doc_kind      text not null default 'invoice'
                           check (doc_kind in ('invoice', 'correction', 'receipt', 'delivery_note', 'other')),
  add column page_count    int check (page_count is null or page_count between 1 and 10),
  add column ai_model      text,
  add column ai_confidence smallint check (ai_confidence is null or ai_confidence between 0 and 100),
  add column ai_warnings   jsonb not null default '[]'::jsonb,
  add column processed_at  timestamptz,
  add column retry_count   int not null default 0,
  add column revision      int not null default 1,      -- rośnie z każdym „Cofnij księgowanie"
  add column notes         text check (notes is null or char_length(notes) <= 1000);

-- Pliki dokumentu muszą leżeć w folderze własnej firmy (konwencja z 0002).
create or replace function public.paths_in_tenant(p_paths text[], p_tenant uuid)
returns boolean
language sql immutable
as $$
  select coalesce(bool_and(p like p_tenant::text || '/%'), true) from unnest(p_paths) as p;
$$;
alter table public.documents
  add constraint documents_files_in_tenant_folder check (public.paths_in_tenant(file_paths, tenant_id));

alter table public.document_lines
  add column skip          boolean not null default false,   -- pozycja bez wpływu na magazyn (transport, usługa)
  add column ean           text check (ean is null or ean ~ '^[0-9]{8}$' or ean ~ '^[0-9]{13}$'),
  add column vat_rate      numeric(5, 2),
  add column total_net     numeric(14, 2),
  add column ai_confidence smallint check (ai_confidence is null or ai_confidence between 0 and 100),
  add constraint document_lines_tenant_id_id_key unique (tenant_id, id);

-- Faktury korygujące mają ilości ujemne — zero nie ma sensu, minus tak.
alter table public.document_lines drop constraint document_lines_qty_check;
alter table public.document_lines add constraint document_lines_qty_nonzero check (qty <> 0);

-- Ten sam numer faktury od tego samego dostawcy = duplikat (spacje i wielkość liter bez znaczenia).
drop index public.documents_duplicate_guard;
create unique index documents_duplicate_guard
  on public.documents (tenant_id, supplier_nip, lower(btrim(invoice_number)))
  where supplier_nip is not null and invoice_number is not null;

-- Ruchy z księgowania: powiązanie z pozycją i rewizją dokumentu + storno.
alter table public.stock_movements
  add column doc_revision int,
  add column reverses_id  uuid,
  add constraint stock_movements_tenant_id_id_key unique (tenant_id, id),
  add constraint stock_movements_line_same_tenant
    foreign key (tenant_id, document_line_id) references public.document_lines (tenant_id, id)
    on delete set null (document_line_id),
  add constraint stock_movements_reverses_same_tenant
    foreign key (tenant_id, reverses_id) references public.stock_movements (tenant_id, id);

-- Jedna pozycja w jednej rewizji dokumentu = najwyżej jedno przyjęcie.
create unique index stock_movements_one_posting_per_line
  on public.stock_movements (document_line_id, doc_revision)
  where document_line_id is not null and reverses_id is null;
-- Ruch można odwrócić tylko raz.
create unique index stock_movements_reversed_once
  on public.stock_movements (reverses_id) where reverses_id is not null;

-- ----------------------------------------------------------------------------
-- 2. SŁOWNIK ALIASÓW + DOPASOWANIE
-- ----------------------------------------------------------------------------
-- Normalizacja nazw: małe litery, bez polskich znaków, bez interpunkcji.
-- „Lakier Hybr. CZERW. 15ml" → „lakier hybr czerw 15ml".
create or replace function public.normalize_name(p_text text)
returns text
language sql immutable
as $$
  select btrim(regexp_replace(
           translate(lower(coalesce(p_text, '')), 'ąćęłńóśźżäöüß', 'acelnoszzaous'),
           '[^a-z0-9]+', ' ', 'g'));
$$;

create table public.product_aliases (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  supplier_nip text check (supplier_nip is null or supplier_nip ~ '^[0-9]{10}$'),   -- NULL = alias ogólny
  alias_norm   text not null check (char_length(alias_norm) between 2 and 200),
  product_id   uuid not null,
  uses         int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade,
  unique nulls not distinct (tenant_id, supplier_nip, alias_norm)
);
create index idx_aliases_product on public.product_aliases (product_id);
create trigger trg_aliases_updated before update on public.product_aliases
  for each row execute function public.set_updated_at();
create trigger trg_aliases_tenant_fixed before update on public.product_aliases
  for each row execute function public.forbid_tenant_change();
alter table public.product_aliases enable row level security;
create policy "aliases: kierownictwo" on public.product_aliases
  for all to authenticated
  using (public.can_manage(tenant_id)) with check (public.can_manage(tenant_id));
revoke truncate, references, trigger on public.product_aliases from authenticated;

-- Dopasowanie pozycji faktur do produktów firmy. Kolejność (od najpewniejszego):
--   1) EAN zgodny z produktem                 → 99 %
--   2) alias „nazwa z faktury" (dostawca/ogólny) → 97–98 %
--   3) podobieństwo nazw (trigramy)           → podobieństwo×100, max 90 %
-- Wejście: jsonb [{ "name": "...", "ean": "..." }, ...]. Wyjście: tablica w tej
-- samej kolejności: { index, product_id | null, confidence, method }.
-- Wołają ją: kierownictwo (ekran weryfikacji) i backend (Edge Function skanu).
create or replace function public.match_products(p_tenant uuid, p_supplier_nip text, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out  jsonb := '[]'::jsonb;
  v_item jsonb;
  v_idx  int := 0;
  v_norm text;
  v_ean  text;
  v_pid  uuid;
  v_conf int;
  v_meth text;
  v_sim  real;
begin
  if auth.uid() is not null and not public.can_manage(p_tenant) then
    raise exception 'Brak uprawnień do dopasowania produktów.' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_norm := public.normalize_name(v_item ->> 'name');
    v_ean  := nullif(v_item ->> 'ean', '');
    v_pid := null; v_conf := 0; v_meth := 'none';

    if v_ean is not null then
      select id into v_pid from public.products
       where tenant_id = p_tenant and ean = v_ean and active limit 1;
      if v_pid is not null then v_conf := 99; v_meth := 'ean'; end if;
    end if;

    if v_pid is null and char_length(v_norm) >= 2 then
      -- alias od tego dostawcy wygrywa z aliasem ogólnym
      select a.product_id, case when a.supplier_nip is not null then 98 else 97 end
        into v_pid, v_conf
        from public.product_aliases a
        join public.products p on p.id = a.product_id and p.active
       where a.tenant_id = p_tenant and a.alias_norm = v_norm
         and (a.supplier_nip = p_supplier_nip or a.supplier_nip is null)
       order by (a.supplier_nip is not null) desc, a.uses desc limit 1;
      if v_pid is not null then v_meth := 'alias'; end if;
    end if;

    if v_pid is null and char_length(v_norm) >= 3 then
      select p.id, extensions.similarity(public.normalize_name(p.name), v_norm)
        into v_pid, v_sim
        from public.products p
       where p.tenant_id = p_tenant and p.active
       order by extensions.similarity(public.normalize_name(p.name), v_norm) desc, p.name limit 1;
      if v_pid is not null and v_sim >= 0.45 then
        v_conf := least(90, round(v_sim * 100)::int); v_meth := 'similarity';
      else
        v_pid := null; v_conf := 0;
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'index', v_idx, 'product_id', v_pid, 'confidence', coalesce(v_conf, 0), 'method', v_meth);
    v_idx := v_idx + 1;
  end loop;

  return v_out;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. STRAŻNIK DOKUMENTÓW (zastępuje lock_posted_document z 0001)
-- ----------------------------------------------------------------------------
create or replace function public.lock_posted_document()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'Dokument zaksięgowany jest tylko do odczytu. Użyj „Cofnij księgowanie".'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- Przejścia zaksięgowania wykonują wyłącznie nasze funkcje (zmienna sesji
  -- ustawiana na czas jednej transakcji). Backend (auth.uid() IS NULL) też.
  if current_setting('tapventory.doc_op', true) in ('post', 'unpost', 'retry') or auth.uid() is null then
    return new;
  end if;

  if old.status = 'posted' then
    raise exception 'Dokument zaksięgowany jest tylko do odczytu. Użyj „Cofnij księgowanie".'
      using errcode = 'P0001';
  end if;
  if old.status = 'processing' then
    raise exception 'Dokument jest w trakcie czytania przez AI. Poczekaj chwilę.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     and not (old.status in ('draft', 'verified', 'failed') and new.status in ('draft', 'verified')) then
    raise exception 'Status dokumentu zmieniają przyciski Zatwierdź / Zaksięguj / Cofnij.' using errcode = 'P0001';
  end if;
  if (new.source, new.file_paths, new.created_by, new.revision, new.posted_by, new.posted_at,
      new.ai_model, new.ai_confidence, new.ai_warnings, new.processed_at, new.retry_count, new.page_count)
     is distinct from
     (old.source, old.file_paths, old.created_by, old.revision, old.posted_by, old.posted_at,
      old.ai_model, old.ai_confidence, old.ai_warnings, old.processed_at, old.retry_count, old.page_count) then
    raise exception 'Tych pól dokumentu nie edytuje się ręcznie.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Dokument dodany ręcznie przez użytkownika to zawsze szkic „manual". Status
-- „posted" czy „processing" nadają wyłącznie nasze funkcje i backend — inaczej
-- kierownik mógłby wstawić od razu „zaksięgowaną" fakturę z pominięciem ruchów.
create or replace function public.documents_insert_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and current_setting('tapventory.doc_op', true) is distinct from 'create' then
    new.source := 'manual';
    new.status := 'draft';
    new.created_by := auth.uid();
    new.posted_by := null; new.posted_at := null;
    new.revision := 1; new.retry_count := 0; new.processed_at := null;
    new.ai_model := null; new.ai_confidence := null; new.ai_warnings := '[]'::jsonb;
    new.error_message := null;
  end if;
  return new;
end;
$$;
create trigger trg_documents_insert_guard before insert on public.documents
  for each row execute function public.documents_insert_guard();

-- Dokument można usunąć, dopóki nie jest zaksięgowany (także nieudany/„wiszący").
drop policy "documents: usuwanie szkiców" on public.documents;
create policy "documents: usuwanie niezaksięgowanych" on public.documents
  for delete to authenticated
  using (public.can_manage(tenant_id) and status <> 'posted');

-- Pozycje: nie edytuje się ich w trakcie czytania przez AI ani po zaksięgowaniu.
drop policy "doclines: dodawanie" on public.document_lines;
drop policy "doclines: edycja"    on public.document_lines;
drop policy "doclines: usuwanie"  on public.document_lines;
create policy "doclines: dodawanie" on public.document_lines for insert to authenticated
  with check (
    public.can_manage(tenant_id)
    and exists (select 1 from public.documents d
                where d.id = document_id and d.tenant_id = document_lines.tenant_id
                  and d.status not in ('posted', 'processing'))
  );
create policy "doclines: edycja" on public.document_lines for update to authenticated
  using (
    public.can_manage(tenant_id)
    and exists (select 1 from public.documents d
                where d.id = document_id and d.status not in ('posted', 'processing'))
  )
  with check (public.can_manage(tenant_id));
create policy "doclines: usuwanie" on public.document_lines for delete to authenticated
  using (
    public.can_manage(tenant_id)
    and exists (select 1 from public.documents d
                where d.id = document_id and d.status not in ('posted', 'processing'))
  );

-- ----------------------------------------------------------------------------
-- 4. RPC: wgranie zdjęć, ponowienie, ksiegowanie, storno
-- ----------------------------------------------------------------------------

-- Aplikacja wgrała strony do Storage i zakłada dokument „w przetwarzaniu".
-- Idempotentne: ponowne wywołanie z tym samym p_id niczego nie dubluje.
create or replace function public.create_photo_document(p_id uuid, p_tenant uuid, p_paths text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if not public.can_manage(p_tenant) then
    raise exception 'Faktury skanuje kierownictwo.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_paths, 1), 0) not between 1 and 10 then
    raise exception 'Dokument może mieć od 1 do 10 stron.' using errcode = 'P0001';
  end if;
  if not public.paths_in_tenant(p_paths, p_tenant) then
    raise exception 'Pliki muszą leżeć w folderze Twojej firmy.' using errcode = 'P0001';
  end if;

  perform set_config('tapventory.doc_op', 'create', true);
  insert into public.documents (id, tenant_id, source, status, file_paths, page_count, created_by)
  values (v_id, p_tenant, 'photo', 'processing', p_paths, array_length(p_paths, 1), auth.uid())
  on conflict (id) do nothing;
  perform set_config('tapventory.doc_op', '', true);

  if not exists (select 1 from public.documents where id = v_id and tenant_id = p_tenant) then
    raise exception 'Identyfikator dokumentu jest już zajęty.' using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

-- Ponowienie po błędzie AI („Spróbuj ponownie").
create or replace function public.retry_document(p_document uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents;
begin
  select * into v_doc from public.documents where id = p_document for update;
  if not found or not public.can_manage(v_doc.tenant_id) then
    raise exception 'Nie znaleziono dokumentu lub brak uprawnień.' using errcode = 'P0001';
  end if;
  if v_doc.status <> 'failed' then
    raise exception 'Ponowić można tylko dokument, którego odczyt się nie udał.' using errcode = 'P0001';
  end if;
  if v_doc.retry_count >= 5 then
    raise exception 'Zbyt wiele prób. Dodaj dokument ręcznie albo zrób wyraźniejsze zdjęcie.' using errcode = 'P0001';
  end if;
  perform set_config('tapventory.doc_op', 'retry', true);
  update public.documents
     set status = 'processing', error_message = null, retry_count = retry_count + 1
   where id = p_document;
  perform set_config('tapventory.doc_op', '', true);
end;
$$;

-- KSIĘGOWANIE: pozycje faktury → ruchy „przyjęcie", w jednej transakcji.
create or replace function public.post_document(p_document uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc       public.documents;
  v_line      public.document_lines;
  v_unmatched int;
  v_count     int := 0;
begin
  select * into v_doc from public.documents where id = p_document for update;
  if not found or not public.can_manage(v_doc.tenant_id) then
    raise exception 'Nie znaleziono dokumentu lub brak uprawnień.' using errcode = 'P0001';
  end if;
  if v_doc.status = 'posted' then
    raise exception 'Dokument jest już zaksięgowany.' using errcode = 'P0001';
  end if;
  if v_doc.status not in ('draft', 'verified') then
    raise exception 'Dokument nie jest gotowy do księgowania (status: %).', v_doc.status using errcode = 'P0001';
  end if;

  select count(*) into v_unmatched
    from public.document_lines where document_id = p_document and not skip and product_id is null;
  if v_unmatched > 0 then
    raise exception 'Pozycje bez przypisanego produktu: %. Przypisz produkt albo oznacz pozycję jako pomijaną.', v_unmatched
      using errcode = 'P0001';
  end if;

  perform set_config('tapventory.doc_op', 'post', true);

  for v_line in
    select * from public.document_lines where document_id = p_document and not skip order by line_no, id
  loop
    insert into public.stock_movements
      (tenant_id, product_id, movement_type, qty, document_id, document_line_id, doc_revision, project_id, note)
    values
      (v_doc.tenant_id, v_line.product_id,
       case when v_line.qty > 0 then 'receipt'::public.movement_type else 'adjustment'::public.movement_type end,
       v_line.qty, p_document, v_line.id, v_doc.revision, v_line.project_id,
       'Faktura ' || coalesce(v_doc.invoice_number, '(bez numeru)'));
    v_count := v_count + 1;

    -- uczenie: „nazwa z faktury" → produkt (dla tego dostawcy)
    if public.normalize_name(v_line.raw_name) <> '' and char_length(public.normalize_name(v_line.raw_name)) >= 2 then
      insert into public.product_aliases (tenant_id, supplier_nip, alias_norm, product_id)
      values (v_doc.tenant_id, v_doc.supplier_nip, public.normalize_name(v_line.raw_name), v_line.product_id)
      on conflict (tenant_id, supplier_nip, alias_norm)
      do update set product_id = excluded.product_id, uses = public.product_aliases.uses + 1;
    end if;
  end loop;

  update public.documents
     set status = 'posted', posted_by = auth.uid(), posted_at = now()
   where id = p_document;

  perform set_config('tapventory.doc_op', '', true);
  return v_count;
end;
$$;

-- STORNO: „Cofnij księgowanie" — ruchy odwrotne + powrót do szkicu do poprawy.
create or replace function public.unpost_document(p_document uuid, p_reason text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc   public.documents;
  v_count int;
  v_why   text := btrim(coalesce(p_reason, ''));
begin
  select * into v_doc from public.documents where id = p_document for update;
  if not found or not public.can_manage(v_doc.tenant_id) then
    raise exception 'Nie znaleziono dokumentu lub brak uprawnień.' using errcode = 'P0001';
  end if;
  if v_doc.status <> 'posted' then
    raise exception 'Cofnąć można tylko zaksięgowany dokument.' using errcode = 'P0001';
  end if;
  if char_length(v_why) < 3 then
    raise exception 'Podaj powód cofnięcia (min. 3 znaki) — trafi do historii.' using errcode = 'P0001';
  end if;

  perform set_config('tapventory.doc_op', 'unpost', true);

  insert into public.stock_movements
    (tenant_id, product_id, movement_type, qty, document_id, document_line_id, doc_revision,
     reverses_id, project_id, note)
  select m.tenant_id, m.product_id, 'adjustment', -m.qty, m.document_id, m.document_line_id,
         m.doc_revision, m.id, m.project_id, left('Storno: ' || v_why, 500)
    from public.stock_movements m
   where m.document_id = p_document
     and m.doc_revision = v_doc.revision
     and m.reverses_id is null
     and not exists (select 1 from public.stock_movements r where r.reverses_id = m.id);
  get diagnostics v_count = row_count;

  update public.documents
     set status = 'draft', posted_by = null, posted_at = null, revision = revision + 1
   where id = p_document;

  perform set_config('tapventory.doc_op', '', true);
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. WIDOK LISTY DOKUMENTÓW (tylko kierownictwo)
-- ----------------------------------------------------------------------------
create view public.document_overview
with (security_invoker = false)
as
select
  d.id, d.tenant_id, d.source, d.status, d.doc_kind, d.supplier_id, d.supplier_name, d.supplier_nip,
  d.invoice_number, d.ksef_number, d.issue_date, d.currency, d.total_net, d.total_gross,
  d.file_paths, d.page_count, d.error_message, d.ai_model, d.ai_confidence, d.ai_warnings,
  d.processed_at, d.retry_count, d.revision, d.notes,
  d.created_by, cb.display_name as created_by_name, d.posted_by, d.posted_at, d.created_at, d.updated_at,
  coalesce(l.cnt, 0)::int       as line_count,
  coalesce(l.unmatched, 0)::int as unmatched_count
from public.documents d
left join public.profiles cb on cb.id = d.created_by
left join lateral (
  select count(*) as cnt, count(*) filter (where not skip and product_id is null) as unmatched
  from public.document_lines where document_id = d.id
) l on true
where public.can_manage(d.tenant_id);

revoke all on public.document_overview from anon, authenticated;
grant select on public.document_overview to authenticated;

-- ----------------------------------------------------------------------------
-- 6. UPRAWNIENIA, REALTIME
-- ----------------------------------------------------------------------------
-- ZASADA NA CAŁE ŻYCIE PROJEKTU: Postgres domyślnie daje EXECUTE grupie PUBLIC
-- (czyli także niezalogowanym). Dlatego KAŻDA nowa funkcja w public dostaje tuż
-- po utworzeniu `revoke ... from public, anon`, a potem świadome `grant` —
-- test supabase/tests/01_invariants.test.mjs zaświeci się na czerwono, jeśli
-- o tym zapomnisz.
revoke execute on function
  public.match_products(uuid, text, jsonb), public.create_photo_document(uuid, uuid, text[]),
  public.retry_document(uuid), public.post_document(uuid), public.unpost_document(uuid, text),
  public.paths_in_tenant(text[], uuid), public.normalize_name(text)
from public, anon;
revoke execute on function public.lock_posted_document(), public.documents_insert_guard()
  from public, anon, authenticated;

grant execute on function public.match_products(uuid, text, jsonb)         to authenticated, service_role;
grant execute on function public.create_photo_document(uuid, uuid, text[]) to authenticated;
grant execute on function public.retry_document(uuid)                      to authenticated;
grant execute on function public.post_document(uuid)                       to authenticated;
grant execute on function public.unpost_document(uuid, text)               to authenticated;
grant execute on function public.paths_in_tenant(text[], uuid), public.normalize_name(text) to authenticated;

alter publication supabase_realtime add table public.documents;

-- ============================================================================
-- KONIEC 0006.
-- ============================================================================
