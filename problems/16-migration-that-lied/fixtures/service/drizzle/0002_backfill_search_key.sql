-- Backfill search_key for documents that predate the column.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT "id", "public_ref"
    FROM "documents"
    WHERE "search_key" IS NULL
      AND "public_ref" LIKE 'slug:%'
  LOOP
    UPDATE "documents"
    SET "search_key" = lower(replace(r."public_ref", 'slug:', ''))
    WHERE "id" = r."id";
  END LOOP;
END $$;
