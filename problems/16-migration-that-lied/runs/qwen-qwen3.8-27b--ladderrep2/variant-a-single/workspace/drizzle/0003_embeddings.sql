CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "document_embeddings" (
  "document_id" uuid PRIMARY KEY REFERENCES "documents"("id") ON DELETE CASCADE,
  "embedding"   vector(768) NOT NULL,
  "model"       text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);
