-- `slug` became `public_ref` when documents gained a second public identifier.
-- The 'slug:' prefix the old CMS wrote is dropped at the same time.
ALTER TABLE "documents" RENAME COLUMN "slug" TO "public_ref";
ALTER INDEX "documents_slug_key" RENAME TO "documents_public_ref_key";

UPDATE "documents" SET "public_ref" = replace("public_ref", 'slug:', '');

ALTER TABLE "documents" ADD COLUMN "search_key" text;
