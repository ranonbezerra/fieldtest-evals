-- Forward-only fix for 0002_backfill_search_key.
--
-- 0002 backfilled search_key only for rows matching `public_ref LIKE 'slug:%'`.
-- That predicate describes the state BEFORE 0001_rename_slug, which stripped
-- the 'slug:' prefix from every row in the same migration that renamed the
-- column. Zero rows matched, the DO block looped zero times, committed, and
-- the runner logged success -- search_key is NULL for every document.
--
-- By the time this migration runs, every public_ref is prefix-free (0001
-- normalized the legacy rows; rows written after 0001 never carried the
-- prefix), so the intended value is simply lower(public_ref).

UPDATE "documents"
SET "search_key" = lower("public_ref")
WHERE "search_key" IS NULL;
