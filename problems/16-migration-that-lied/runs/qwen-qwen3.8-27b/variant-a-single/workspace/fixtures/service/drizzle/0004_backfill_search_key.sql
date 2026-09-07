-- ADDITIVE fix for Defect D2 (RUNBOOK.md).
--
-- 0002_backfill_search_key.sql was applied everywhere with an inverted
-- predicate (`WHERE search_key IS NOT NULL`), so it updated zero rows and
-- is already checksummed. It must NOT be edited in place. This migration
-- backfills the same expression (keeping 'doc-' || id so that rows keyed
-- in any environment that got a corrected 0002 manually stay consistent
-- and no unique-constraint collision can occur) but with the correct
-- predicate: only rows that still lack a key.
--
-- Safe to run repeatedly and safe on already-correct databases:
-- WHERE search_key IS NULL makes the second and later runs update 0 rows.

UPDATE documents
SET search_key = 'doc-' || id
WHERE search_key IS NULL;
