-- ============================================================================
-- Tapventory — migracja 0013: KSeF — szanujemy „Retry-After" przy ograniczeniu tempa (429)
-- ============================================================================
-- Dla juniora:
--   Oficjalne limity KSeF na produkcji (liczone osobno dla pary „NIP firmy + adres IP") to m.in.
--   20 zapytań o listę faktur i 64 pobrania faktur NA GODZINĘ (dokumentacja MF „Limity żądań API").
--   Po przekroczeniu KSeF odpowiada 429 z nagłówkiem Retry-After, a „wielokrotne przekroczenia mogą
--   skutkować znacznym wydłużeniem blokady". Migracja 0011 ucinała przerwę do 30 minut (i ignorowała
--   Retry-After po błędzie bez postępu), więc przy większym zaległym wolumenie moglibyśmy pukać do
--   KSeF za wcześnie. Teraz przerwa jest co najmniej tak długa, jak podał KSeF (maks. 2 godziny).
--   Zgodnie z zasadą projektu poprawka jest NOWĄ migracją — 0011 pozostaje nietknięta.
-- ============================================================================

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
           -- Retry-After z KSeF (429) traktujemy jako dolną granicę przerwy — też po błędzie bez postępu —
           -- ale nie dłuższą niż 2 godziny (godzinowe limity KSeF znikają po godzinie).
           next_attempt_at = case
             when p_status = 'error' and not p_auth_failed
               then now() + greatest(
                      least(interval '6 hours', make_interval(mins => 5 * (2 ^ least(consecutive_failures, 6))::int)),
                      make_interval(secs => least(7200, greatest(0, coalesce(p_retry_after_sec, 0)))))
             when p_status = 'partial'
               then now() + make_interval(secs => least(7200, greatest(120, coalesce(p_retry_after_sec, 600))))
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

revoke execute on function public.finish_ksef_sync(bigint, text, int, int, int, int, int, text, timestamptz, boolean, int) from public, anon, authenticated;
grant  execute on function public.finish_ksef_sync(bigint, text, int, int, int, int, int, text, timestamptz, boolean, int) to service_role;
