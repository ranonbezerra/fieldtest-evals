-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('prepared', 'broadcast_sent', 'broadcast_unknown', 'confirmed', 'failed');

-- CreateTable
CREATE TABLE "document_anchors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT E'prepared',
    "block_number" BIGINT,
    "tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_anchors_status_idx" ON "document_anchors"("status");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "document_anchors_tx_id_key" ON "document_anchors"("tx_id");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "document_anchors_document_id_version_key" ON "document_anchors"("document_id", "version");
