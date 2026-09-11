-- Backfill search_key for documents that predate the column.
--
-- 0002_backfill_search_key selected rows matching public_ref LIKE 'slug:%',
-- but 0001_rename_slug had already stripped the 'slug:' prefix from every
-- row, so 0002's loop matched nothing and committed cleanly. 0002 is already
-- applied in production and is not edited in place; this forward-only
-- migration backfills the remaining NULLs against the post-rename data.
-- lower(replace(...)) is the same expression 0002 intended (a no-op once
-- the prefix is gone); the stale LIKE guard is dropped. The IS NULL guard
-- keeps this idempotent and never overwrites a key the app has set.
UPDATE "documents"
SET "search_key" = lower(replace("public_ref", 'slug:', ''))
WHERE "search_key" IS NULL;
