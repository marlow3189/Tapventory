-- ============================================================================
-- Tapventory — migracja 0014: pętla zwrotna jakości odczytu faktur (AI i KSeF)
-- ============================================================================
-- Dla juniora:
--   Zestaw ewaluacyjny (eval/) mierzy modele na dokumentach SYNTETYCZNYCH. Prawdziwą jakość poznasz dopiero
--   po tym, jak ludzie poprawią prawdziwe faktury. Do tej pory poprawka nadpisywała odczyt i nic po nim
--   nie zostawało. Teraz:
--     1. apply_document_extraction zapisuje w documents.ai_extraction MIGAWKĘ tego, co przeczytała maszyna
--        (nagłówek + pozycje z identyfikatorami). Klienci nie mogą jej wpisać ani zmienić (trigger).
--     2. ai_correction_report(...) porównuje migawki z końcowym, zaksięgowanym stanem i liczy, ile pól
--        człowiek musiał poprawić. Tylko dla właściciela projektu (SQL Editor w panelu) i backendu —
--        zwykli użytkownicy nie mają do niej dostępu.
--   Opis użycia i interpretacji: docs/09_AI_I_OCR.md, rozdział „Mierz jakość w produkcji".
-- ============================================================================

alter table public.documents
  add column ai_extraction jsonb check (ai_extraction is null or jsonb_typeof(ai_extraction) = 'object');

comment on column public.documents.ai_extraction is
  'Migawka odczytu maszynowego (AI/KSeF) z chwili zapisu — tylko do pomiaru jakości; nie edytowalna przez użytkowników.';

-- Migawkę wpisuje wyłącznie backend (auth.uid() jest NULL dla service_role).
create or replace function public.documents_ai_snapshot_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.ai_extraction := null;
  elsif new.ai_extraction is distinct from old.ai_extraction then
    raise exception 'Migawka odczytu maszynowego nie podlega edycji.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_documents_ai_snapshot_guard before insert or update on public.documents
  for each row execute function public.documents_ai_snapshot_guard();
revoke execute on function public.documents_ai_snapshot_guard() from public, anon, authenticated;

create or replace function public.apply_document_extraction(p_document uuid, p_extraction jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc      public.documents;
  v_nip      text := nullif(regexp_replace(coalesce(p_extraction ->> 'supplier_nip', ''), '[^0-9]', '', 'g'), '');
  v_number   text := nullif(btrim(coalesce(p_extraction ->> 'invoice_number', '')), '');
  v_name     text := nullif(btrim(coalesce(p_extraction ->> 'supplier_name', '')), '');
  v_lines    jsonb := coalesce(p_extraction -> 'lines', '[]'::jsonb);
  v_kind     text  := coalesce(nullif(p_extraction ->> 'doc_kind', ''), 'invoice');
  v_dup      uuid;
  v_supplier uuid;
  v_items    jsonb;
  v_matches  jsonb;
  v_total    int;
  v_matched  int;
  v_snapshot jsonb;
begin
  select * into v_doc from public.documents where id = p_document for update;
  if not found then
    raise exception 'Dokument nie istnieje.' using errcode = 'P0001';
  end if;
  if v_doc.status <> 'processing' then
    raise exception 'Dokument nie oczekuje na wynik odczytu (status: %).', v_doc.status using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'Pole lines musi być tablicą.' using errcode = 'P0001';
  end if;
  if v_kind not in ('invoice', 'correction', 'receipt', 'delivery_note', 'other') then
    v_kind := 'invoice';
  end if;
  if v_nip is not null and v_nip !~ '^[0-9]{10}$' then
    v_nip := null;     -- niepełny numer to nie NIP; człowiek zobaczy puste pole i ostrzeżenie
  end if;

  -- duplikat: ta sama faktura (NIP dostawcy + numer) już jest w firmie
  if v_nip is not null and v_number is not null then
    select id into v_dup from public.documents
     where tenant_id = v_doc.tenant_id and supplier_nip = v_nip
       and lower(btrim(invoice_number)) = lower(v_number) and id <> p_document
     limit 1;
    if found then
      update public.documents
         set status = 'failed', processed_at = now(), ai_model = left(p_extraction ->> 'ai_model', 80),
             error_message = format('Ta faktura (%s) już istnieje w systemie. Usuń ten dokument.', v_number)
       where id = p_document;
      return jsonb_build_object('status', 'failed', 'reason', 'duplicate', 'duplicate_of', v_dup);
    end if;
  end if;

  -- dostawca: dopinamy do słownika (powstaje z pierwszej faktury), o ile NIP jest prawdziwy
  if v_nip is not null and public.is_valid_nip(v_nip) then
    select id into v_supplier from public.suppliers
     where tenant_id = v_doc.tenant_id and nip = v_nip order by created_at limit 1;
    if v_supplier is null and v_name is not null and char_length(v_name) between 2 and 160 then
      insert into public.suppliers (tenant_id, name, nip) values (v_doc.tenant_id, v_name, v_nip)
      returning id into v_supplier;
    end if;
  end if;

  -- podpowiedzi produktów (kolejność jak w v_lines)
  select coalesce(jsonb_agg(jsonb_build_object('name', t.l ->> 'raw_name', 'ean', t.l ->> 'ean') order by t.ord), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(v_lines) with ordinality as t(l, ord);
  v_matches := public.match_products(v_doc.tenant_id, v_nip, v_items);

  -- ponowny odczyt (retry) zastępuje poprzednie pozycje
  delete from public.document_lines where document_id = p_document;
  insert into public.document_lines
    (tenant_id, document_id, line_no, raw_name, qty, unit, unit_price_net, total_net, vat_rate, ean,
     skip, ai_confidence, product_id, match_confidence)
  select v_doc.tenant_id, p_document, t.ord::int,
         left(coalesce(nullif(btrim(t.l ->> 'raw_name'), ''), '(bez nazwy)'), 500),
         (t.l ->> 'qty')::numeric,
         left(nullif(btrim(t.l ->> 'unit'), ''), 20),
         (t.l ->> 'unit_price_net')::numeric,
         (t.l ->> 'total_net')::numeric,
         (t.l ->> 'vat_rate')::numeric,
         nullif(t.l ->> 'ean', ''),
         coalesce((t.l ->> 'skip')::boolean, false),
         (t.l ->> 'ai_confidence')::int,
         case when (mm.x ->> 'confidence')::int >= 60 then (mm.x ->> 'product_id')::uuid end,
         nullif((mm.x ->> 'confidence')::int, 0)
    from jsonb_array_elements(v_lines) with ordinality as t(l, ord)
    left join lateral (
      select x from jsonb_array_elements(v_matches) x where (x ->> 'index')::int = t.ord - 1 limit 1
    ) mm on true;

  get diagnostics v_total = row_count;
  select count(*) into v_matched from public.document_lines where document_id = p_document and product_id is not null;

  -- Migawka „co przeczytała maszyna" (0014): pozycje już leżą w tabeli, więc zapisujemy je razem z identyfikatorami.
  -- Człowiek poprawia dokument w miejscu; porównanie migawki z końcowym stanem mówi, jak często maszyna się myliła.
  v_snapshot := jsonb_build_object(
    'version', 1,
    'model', left(p_extraction ->> 'ai_model', 80),
    'header', jsonb_build_object(
      'doc_kind', v_kind,
      'supplier_name', v_name,
      'supplier_nip', v_nip,
      'invoice_number', v_number,
      'issue_date', nullif(p_extraction ->> 'issue_date', ''),
      'currency', coalesce(nullif(upper(p_extraction ->> 'currency'), ''), 'PLN'),
      'total_net', (p_extraction ->> 'total_net')::numeric,
      'total_gross', (p_extraction ->> 'total_gross')::numeric),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'line_no', l.line_no, 'raw_name', l.raw_name, 'qty', l.qty, 'unit', l.unit,
               'unit_price_net', l.unit_price_net, 'total_net', l.total_net, 'vat_rate', l.vat_rate,
               'ean', l.ean, 'skip', l.skip, 'product_id', l.product_id) order by l.line_no)
        from public.document_lines l where l.document_id = p_document), '[]'::jsonb));

  update public.documents
     set status         = 'draft',
         doc_kind       = v_kind,
         supplier_id    = coalesce(v_supplier, supplier_id),
         supplier_name  = v_name,
         supplier_nip   = v_nip,
         invoice_number = v_number,
         issue_date     = nullif(p_extraction ->> 'issue_date', '')::date,
         currency       = coalesce(nullif(upper(p_extraction ->> 'currency'), ''), 'PLN'),
         total_net      = (p_extraction ->> 'total_net')::numeric,
         total_gross    = (p_extraction ->> 'total_gross')::numeric,
         ai_model       = left(p_extraction ->> 'ai_model', 80),
         ai_confidence  = (p_extraction ->> 'ai_confidence')::int,
         ai_warnings    = coalesce(p_extraction -> 'ai_warnings', '[]'::jsonb),
         ai_extraction  = v_snapshot,
         processed_at   = now(),
         error_message  = null
   where id = p_document;

  return jsonb_build_object('status', 'draft', 'lines', v_total, 'matched', v_matched);
end;
$$;

-- ----------------------------------------------------------------------------
-- Raport poprawek: ile pól człowiek zmienił względem odczytu maszynowego
-- ----------------------------------------------------------------------------
-- Bierze dokumenty ZAKSIĘGOWANE (człowiek je zatwierdził, więc stan końcowy = „prawda") z migawką,
-- przetworzone od p_since. p_source: 'photo' (zdjęcia/AI), 'ksef' (parser KSeF) albo NULL (wszystkie).
-- Pozycje porównujemy po identyfikatorze wiersza: usunięta = jest w migawce, brak w dokumencie;
-- dodana ręcznie = jest w dokumencie, brak w migawce.
create or replace function public.ai_correction_report(p_since timestamptz default now() - interval '90 days', p_source text default 'photo')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select id, ai_model, ai_extraction as s, doc_kind, supplier_name, supplier_nip, invoice_number,
           issue_date::text as issue_date, currency, total_net, total_gross
      from public.documents
     where status = 'posted' and ai_extraction is not null and processed_at >= p_since
       and (p_source is null or source::text = p_source)
  ),
  hdr as (
    select id,
           (s #>> '{header,doc_kind}')       is distinct from doc_kind       as doc_kind,
           (s #>> '{header,supplier_nip}')   is distinct from supplier_nip   as supplier_nip,
           (s #>> '{header,invoice_number}') is distinct from invoice_number as invoice_number,
           (s #>> '{header,issue_date}')     is distinct from issue_date     as issue_date,
           (s #>> '{header,currency}')       is distinct from currency       as currency,
           ((s #>> '{header,total_net}')::numeric)   is distinct from total_net   as total_net,
           ((s #>> '{header,total_gross}')::numeric) is distinct from total_gross as total_gross
      from d
  ),
  snap as (
    select d.id as doc_id, (l ->> 'id')::uuid as line_id, l ->> 'raw_name' as raw_name, (l ->> 'qty')::numeric as qty,
           l ->> 'unit' as unit, (l ->> 'unit_price_net')::numeric as unit_price_net, (l ->> 'total_net')::numeric as total_net,
           (l ->> 'vat_rate')::numeric as vat_rate, l ->> 'ean' as ean, (l ->> 'skip')::boolean as skip,
           (l ->> 'product_id')::uuid as product_id
      from d cross join lateral jsonb_array_elements(d.s -> 'lines') as l
  ),
  cmp as (
    select s.doc_id, f.id is null as deleted,
           f.id is not null and s.raw_name is distinct from f.raw_name                 as name_changed,
           f.id is not null and s.qty is distinct from f.qty                           as qty_changed,
           f.id is not null and s.unit is distinct from f.unit                         as unit_changed,
           f.id is not null and s.unit_price_net is distinct from f.unit_price_net     as price_changed,
           f.id is not null and s.total_net is distinct from f.total_net               as total_changed,
           f.id is not null and s.vat_rate is distinct from f.vat_rate                 as vat_changed,
           f.id is not null and s.ean is distinct from f.ean                           as ean_changed,
           f.id is not null and s.skip is distinct from f.skip                         as skip_changed,
           f.id is not null and s.product_id is not null and s.product_id is distinct from f.product_id as product_changed,
           f.id is not null and s.product_id is null and f.product_id is not null and not f.skip         as product_manual,
           s.product_id is not null as product_auto
      from snap s left join public.document_lines f on f.id = s.line_id
  ),
  added as (
    select f.document_id as doc_id, count(*) as n
      from public.document_lines f join d on d.id = f.document_id
     where not exists (select 1 from snap s where s.line_id = f.id)
     group by f.document_id
  ),
  per_doc as (
    select d.id, d.ai_model,
           not (h.doc_kind or h.supplier_nip or h.invoice_number or h.issue_date or h.currency or h.total_net or h.total_gross
                or coalesce((select bool_or(c.deleted or c.name_changed or c.qty_changed or c.unit_changed or c.price_changed or c.total_changed
                                            or c.vat_changed or c.ean_changed or c.skip_changed or c.product_changed or c.product_manual)
                               from cmp c where c.doc_id = d.id), false)
                or coalesce((select a.n from added a where a.doc_id = d.id), 0) > 0) as untouched
      from d join hdr h on h.id = d.id
  )
  select jsonb_build_object(
    'since', p_since,
    'source', p_source,
    'documents', (select count(*) from d),
    'documents_untouched', (select count(*) from per_doc where untouched),
    'header_changed', jsonb_build_object(
      'doc_kind', (select count(*) from hdr where doc_kind), 'supplier_nip', (select count(*) from hdr where supplier_nip),
      'invoice_number', (select count(*) from hdr where invoice_number), 'issue_date', (select count(*) from hdr where issue_date),
      'currency', (select count(*) from hdr where currency), 'total_net', (select count(*) from hdr where total_net),
      'total_gross', (select count(*) from hdr where total_gross)),
    'lines', jsonb_build_object(
      'read_by_machine', (select count(*) from cmp),
      'deleted', (select count(*) from cmp where deleted),
      'added_manually', (select coalesce(sum(n), 0) from added),
      'name_changed', (select count(*) from cmp where name_changed), 'qty_changed', (select count(*) from cmp where qty_changed),
      'unit_changed', (select count(*) from cmp where unit_changed), 'unit_price_changed', (select count(*) from cmp where price_changed),
      'total_net_changed', (select count(*) from cmp where total_changed), 'vat_rate_changed', (select count(*) from cmp where vat_changed),
      'ean_changed', (select count(*) from cmp where ean_changed), 'skip_changed', (select count(*) from cmp where skip_changed),
      'product_auto_matched', (select count(*) from cmp where product_auto),
      'product_auto_changed', (select count(*) from cmp where product_changed),
      'product_matched_by_human', (select count(*) from cmp where product_manual)),
    'by_model', coalesce((
      select jsonb_agg(jsonb_build_object('model', m.ai_model, 'documents', m.n, 'untouched', m.untouched) order by m.n desc)
        from (select ai_model, count(*) as n, count(*) filter (where untouched) as untouched from per_doc group by ai_model) m), '[]'::jsonb));
$$;
revoke execute on function public.ai_correction_report(timestamptz, text) from public, anon, authenticated;
grant  execute on function public.ai_correction_report(timestamptz, text) to service_role;

revoke execute on function public.apply_document_extraction(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.apply_document_extraction(uuid, jsonb) to service_role;
