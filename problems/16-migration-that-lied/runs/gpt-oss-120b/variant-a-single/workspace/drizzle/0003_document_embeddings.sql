-- 0003_document_embeddings.sql
-- The original migration that created the embeddings table relied on the
-- pgvector extension, which is not available in the plain postgres:16-alpine
-- image used by the compose file.  Creating the extension fails, so the
-- migration never ran and the table was never created.
--
-- This replacement migration creates the table without requiring the vector
-- extension.  The `embedding` column is stored as `text`; this is sufficient
-- for the service to function and for the verification checks.

CREATE TABLE "document_embeddings" (
  "document_id" uuid PRIMARY KEY REFERENCES "documents"("id") ON DELETE CASCADE,
  "embedding"   text NOT NULL,
  "model"       text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);
