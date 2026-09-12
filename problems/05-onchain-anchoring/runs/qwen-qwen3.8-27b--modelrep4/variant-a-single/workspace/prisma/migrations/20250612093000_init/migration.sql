-- CreateTable
CREATE TABLE "document_anchors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "anchor_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING_BROADCAST',
    "block_number" INTEGER,
    "chain_status" TEXT,
    "last_error" TEXT,
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "document_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Exactly one anchor per (document, version), enforced at the schema level.
CREATE UNIQUE INDEX "document_anchors_document_id_version_key" ON "document_anchors"("document_id", "version");
