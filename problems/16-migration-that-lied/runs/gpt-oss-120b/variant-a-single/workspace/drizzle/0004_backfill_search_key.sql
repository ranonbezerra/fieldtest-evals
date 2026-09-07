-- 0004_backfill_search_key.sql
-- The original back‑fill (0002_backfill_search_key.sql) only updated rows
-- where `public_ref` still contained the old 'slug:' prefix.  The preceding
-- migration (0001_rename_slug.sql) stripped that prefix from *all* rows,
-- leaving the condition never true and `search_key` remaining NULL.
--
-- This migration correctly back‑fills `search_key` for every document that
-- still has a NULL value, using a lower‑cased version of the current
-- `public_ref`.

UPDATE "documents"
SET "search_key" = lower("public_ref")
WHERE "search_key" IS NULL;
