-- ============================================================================
-- Tapventory — migracja 0012: PostgreSQL 17 — odbieramy uprawnienie MAINTAIN
-- ============================================================================
-- Co się stało: PostgreSQL 17 wprowadził nowe uprawnienie do tabel — MAINTAIN (pozwala wykonać
-- VACUUM, ANALYZE, CLUSTER, REINDEX, REFRESH MATERIALIZED VIEW i LOCK TABLE). Supabase nadaje
-- rolom anon / authenticated „ALL" na każdej nowej tabeli, więc na Postgresie 17 (nowe projekty
-- i lokalne `supabase start`) MAINTAIN trafiał do aplikacji. Przez API (PostgREST) i tak nie da się
-- wykonać tych poleceń, ale zasada projektu brzmi: aplikacja ma DOKŁADNIE te uprawnienia, które
-- zaplanowaliśmy (test „macierz uprawnień" w 01_invariants.test.mjs) — bez zapasu „na wszelki wypadek".
-- Wyłapał to test uruchomiony na Postgresie 17.5; na 16 przechodził, bo tam MAINTAIN nie istnieje.
--
-- Jak: polecenie `REVOKE MAINTAIN` na Postgresie 16 (i starszych) kończy się błędem składni,
-- dlatego wykonujemy je dynamicznie i tylko na wersji 17+. Na starszych wersjach ta migracja nic nie robi.
-- Domyślne uprawnienia zmieniamy też dla PRZYSZŁYCH tabel (jak w 0003 dla truncate/references/trigger).
-- ============================================================================

do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke maintain on tables from anon, authenticated';
  end if;
end;
$$;

-- ============================================================================
-- KONIEC 0012.
-- ============================================================================
