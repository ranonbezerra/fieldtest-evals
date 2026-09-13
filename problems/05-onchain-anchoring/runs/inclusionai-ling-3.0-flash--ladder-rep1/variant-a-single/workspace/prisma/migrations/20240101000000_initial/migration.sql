CREATE TABLE "document_versions" (
  "id" VARCHAR(255) NOT NULL,
  "document_id" VARCHAR(255) NOT NULL,
  "version" VARCHAR(255) NOT NULL,
  "content" JSONB NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_versions_document_id_version_unique"
  ON "document_versions" ("document_id", "version");

CREATE TYPE "anchor_state" AS ENUM ('PREPARED', 'BROADCAST_SENT', 'BROADCAST_TIMEOUT', 'CONFIRMED', 'FAILED');

CREATE TABLE "anchors" (
  "id" VARCHAR(255) NOT NULL,
  "document_id" VARCHAR(255) NOT NULL,
  "version" VARCHAR(255) NOT NULL,
  "canonical_hash" VARCHAR(64) NOT NULL,
  "tx_id" VARCHAR(255) NOT NULL,
  "signed_tx" TEXT NOT NULL,
  "state" "anchor_state" NOT NULL DEFAULT 'PREPARED',
  "block" INTEGER,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "confirmed_at" TIMESTAMP,
  CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "anchors_document_id_version_unique"
  ON "anchors" ("document_id", "version");
