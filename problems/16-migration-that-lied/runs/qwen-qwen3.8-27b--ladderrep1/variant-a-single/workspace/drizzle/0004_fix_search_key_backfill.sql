-- 0002_backfill_search_key only matched rows with `public_ref LIKE 'slug:%'`,
-- but 0001_rename_slug had already stripped the `slug:` prefix from every row,
-- so 0002 backfilled nothing (its loop ran zero times and still succeeded).
--
-- Forward-only correction, additive: derive search_key from the
-- already-normalized public_ref — the value 0002 intended to write.
-- Idempotent; only documents that still lack a value are touched.
UPDATE "documents"
SET "search_key" = lower("public_ref")
WHERE "search_key" IS NULL;
