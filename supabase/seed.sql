-- ============================================================================
-- Tapventory — seed.sql: dane startowe DEV
-- Uruchamiane automatycznie przy `supabase db reset` TYLKO lokalnie.
-- Na środowiska test/prod NIE wgrywamy seedów z danymi przykładowymi.
-- ============================================================================

-- Kilka pozycji globalnego katalogu (marka DEMO — od razu widać, że to próbki).
insert into public.catalog_items (name, brand, ean) values
  ('Rękawiczki nitrylowe M, 100 szt.', 'DEMO', '5900000000017'),
  ('Lakier hybrydowy 8 ml — czerwień', 'DEMO', '5900000000024'),
  ('Płyn do dezynfekcji 1 l',          'DEMO', '5900000000031'),
  ('Olej silnikowy 5W-30, 4 l',        'DEMO', '5900000000048'),
  ('Klocki hamulcowe — komplet',       'DEMO', '5900000000055')
on conflict (ean) do nothing;

-- Konta użytkowników i firmy zakładamy normalnie przez aplikację —
-- rejestracja → mail potwierdzający (lokalnie ląduje w skrzynce testowej
-- pod adresem http://127.0.0.1:54324) → utworzenie firmy w aplikacji.
