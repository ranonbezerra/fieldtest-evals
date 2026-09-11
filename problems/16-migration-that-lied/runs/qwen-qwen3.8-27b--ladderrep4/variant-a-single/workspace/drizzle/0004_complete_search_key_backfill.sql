-- Complete the search_key backfill that 0002_backfill_search_key intended.
--
-- 0001_rename_slug already stripped the 'slug:' prefix from every row, so the
-- `public_ref LIKE 'slug:%'` filter in 0002 matched zero rows and the backfill
-- was a silent no-op. 0001 and 0002 are applied and are not edited; this
-- forward-only migration derives search_key from the already-clean public_ref.
UPDATE "documents"
SET "search_key" = lower("public_ref")
WHERE "search_key" IS NULL
  AND "public_ref" IS NOT NULL;
