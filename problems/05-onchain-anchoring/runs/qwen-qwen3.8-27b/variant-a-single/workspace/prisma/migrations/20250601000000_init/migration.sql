-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('pending_broadcast', 'broadcast_sent', 'broadcast_unknown', 'confirmed', 'failed');

-- CreateTable
CREATE TABLE "anchor_records" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT 'pending_broadcast',
    "block_number" BIGINT,
    "log_index" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "anchor_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anchor_records_document_id_version_key" ON "anchor_records"("document_id", "version");
