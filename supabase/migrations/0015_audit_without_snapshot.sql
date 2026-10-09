-- ============================================================================
-- Tapventory — migracja 0015: dziennik zdarzeń bez migawki odczytu maszynowego
-- ============================================================================
-- Dla juniora:
--   Trigger log_audit() zapisuje w audit_log CAŁY wiersz zmienianej tabeli (jako JSON), z wyjątkiem pól
--   tajnych. Migracja 0014 dodała do documents kolumnę ai_extraction (migawka odczytu AI: nagłówek + wszystkie
--   pozycje, kilka–kilkanaście KB). Bez tej poprawki KAŻDA edycja dokumentu (a dokument bywa poprawiany
--   kilkadziesiąt razy) kopiowałaby całą migawkę do dziennika — dziennik puchłby wielokrotnie, a dane
--   i tak są już w samym dokumencie. Migawka nie jest „zdarzeniem”, więc wycinamy ją z śladu.
--   Zgodnie z zasadą projektu poprawka jest NOWĄ migracją — 0003 i 0014 pozostają nietknięte.
-- ============================================================================

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
    v_row - 'token' - 'code' - 'token_secret_id' - 'ai_extraction'
  );
  return coalesce(new, old);
end;
$$;

revoke execute on function public.log_audit() from public, anon, authenticated;
