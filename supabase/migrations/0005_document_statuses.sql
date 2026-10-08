-- ============================================================================
-- Tapventory — migracja 0005: nowe statusy dokumentu
-- ============================================================================
-- Osobny plik z jednego powodu technicznego: Postgres nie pozwala użyć nowej
-- wartości typu enum w tej samej transakcji, w której ją dodano. Kolejna
-- migracja (0006) może już z nich korzystać.
--
--   processing = zdjęcia wgrane, AI jeszcze czyta dokument (użytkownik nie czeka)
--   failed     = AI/parser nie dał rady (komunikat w error_message; można ponowić)
-- ============================================================================

alter type public.document_status add value if not exists 'processing' before 'draft';
alter type public.document_status add value if not exists 'failed';
