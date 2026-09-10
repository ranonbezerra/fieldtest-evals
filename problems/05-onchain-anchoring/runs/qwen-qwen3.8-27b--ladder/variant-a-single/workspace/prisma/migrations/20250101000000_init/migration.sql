-- CreateEnum
CREATE TYPE "anchor_status" AS ENUM ('PREPARED', 'BROADCAST_SENT', 'OUTCOME_UNKNOWN', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid()),
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "anchor_status" NOT NULL DEFAULT 'PREPARED',
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "block_number" BIGINT,
    "block_hash" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anchors_tx_id_key" ON "anchors"("tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "anchors_document_id_version_key" ON "anchors"("document_id", "version");
