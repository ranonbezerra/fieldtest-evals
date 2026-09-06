BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- ASSUMPTION: migration sequence number 0004 is the next after the last existing migration; exact value unresolved from available references

CREATE TABLE IF NOT EXISTS document_embeddings (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    model       text        NOT NULL,
    vector      vector(1536),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_embeddings_document_id
    ON document_embeddings (document_id);

COMMIT;
