-- ADDITIVE fix for Defect D1 (RUNBOOK.md).
--
-- 0001_document_embeddings.sql was applied everywhere as a comment-only
-- no-op and is already checksummed in __drizzle_migrations, so it must
-- NOT be edited in place. This new, additive migration creates the table
-- 0001 was supposed to create. It is also safe on environments where the
-- table was hand-created as an interim hotfix: the whole file is
-- idempotent (IF NOT EXISTS / DO-block skip) and still records its own
-- checksum, keeping every environment on the same migration frontier.
--
-- ASSUMPTION: the intended table shape (column list, the embedding
-- dimension 1536, the ON DELETE CASCADE behaviour) is not recoverable
-- from the visible material; it is reconstructed from the service name
-- and the production error `relation "document_embeddings" does not
-- exist`. The `vector` column type is NOT a workaround: the requirement
-- of a real vector column is kept per the task constraint, which is why
-- docker-compose.yml must run an image that ships pgvector.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_embeddings (
    id uuid PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Defensive: if a hotfix already built the table without the embedding
-- column, add it. A plain ALTER is not possible here (it cannot be
-- skipped when the column exists), so the skip lives in a DO block.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'document_embeddings'
          AND column_name = 'embedding'
    ) THEN
        ALTER TABLE document_embeddings
            ADD COLUMN embedding vector(1536) NOT NULL;
    END IF;
END
$$;
