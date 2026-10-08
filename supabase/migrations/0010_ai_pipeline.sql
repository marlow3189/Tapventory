-- ============================================================================
-- Tapventory — migracja 0010: potok odczytu faktur przez AI (strona bazy)
-- ============================================================================
-- Edge Function `process-document` czyta fakturę modelem AI i kod sprawdza wynik.
-- Do bazy wynik trafia JEDNYM wywołaniem — apply_document_extraction — w jednej
-- transakcji: nagłówek + pozycje + dopasowanie do produktów + zmiana statusu na
-- „draft". Dzięki temu dokument nigdy nie jest „w połowie": albo ma komplet pozycji,
-- albo nadal jest „processing" (a strażnik z 0009 po 10 minutach uzna go za błąd).
--
--  A. reserve_ai_scan: ten sam dokument nie zajmie limitu dwa razy (ponowne
--     kliknięcie, dwa telefony, ponowienie sieci).
--  B. apply_document_extraction: zapis wyniku odczytu (tylko backend).
--     * duplikat faktury (ten sam NIP dostawcy + numer) → dokument „failed"
--       z jasnym komunikatem, a nie błąd bazy z indeksu unikalnego,
--     * dostawca z poprawnym NIP jest dopinany do słownika dostawców
--       (powstaje automatycznie z pierwszej faktury),
--     * każda pozycja dostaje podpowiedź produktu (match_products), przypisanie
--       „na stałe" tylko od 60% pewności — słabsze zostają do decyzji człowieka.
--  C. fail_document: bezpieczne oznaczenie dokumentu jako nieudanego.
--  D. queue_count_reminders: najwyżej jedno przypomnienie na osobę na 20 godzin
--     (poprzednio — dopóki poprzednie było nieprzeczytane; po jego przeczytaniu harmonogram
--     uruchamiany co minutę mógłby sypać kolejnymi).
-- ============================================================================

-- A ---------------------------------------------------------------------------
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

  -- ten sam dokument już ma świeżą rezerwację → nie liczymy drugi raz
  if p_document is not null and exists (
       select 1 from public.ai_usage
        where tenant_id = p_tenant and document_id = p_document and kind = 'document'
          and status = 'reserved' and created_at > now() - interval '10 minutes') then
    raise exception 'AI_ALREADY_PROCESSING' using errcode = 'P0001';
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

-- B ---------------------------------------------------------------------------
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
         processed_at   = now(),
         error_message  = null
   where id = p_document;

  return jsonb_build_object('status', 'draft', 'lines', v_total, 'matched', v_matched);
end;
$$;

-- C ---------------------------------------------------------------------------
create or replace function public.fail_document(p_document uuid, p_message text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.documents
     set status = 'failed', processed_at = now(), error_message = left(coalesce(nullif(btrim(p_message), ''), 'Odczyt nie powiódł się.'), 500)
   where id = p_document and status = 'processing';
$$;

-- D ---------------------------------------------------------------------------
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
                        and n.kind = 'count_due'
                        and (n.read_at is null or n.created_at > now() - interval '20 hours'));
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;

-- Uprawnienia: wyłącznie backend (Edge Functions z kluczem service_role).
revoke execute on function public.apply_document_extraction(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_document(uuid, text) from public, anon, authenticated;
grant  execute on function public.apply_document_extraction(uuid, jsonb) to service_role;
grant  execute on function public.fail_document(uuid, text) to service_role;

-- ============================================================================
-- KONIEC 0010.
-- ============================================================================
