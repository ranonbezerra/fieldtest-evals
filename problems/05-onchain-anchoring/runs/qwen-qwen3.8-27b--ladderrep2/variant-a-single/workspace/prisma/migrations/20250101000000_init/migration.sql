-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('PREPARED', 'BROADCAST_SENT', 'BROADCAST_UNKNOWN', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT 'PREPARED',
    "block_number" INTEGER,
    "block_hash" TEXT,
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "broadcast_at" TIMESTAMP(3) DEFAULT NULL,
    "last_error" TEXT,
    "confirmed_at" TIMESTAMP(3) DEFAULT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anchors_tx_id_key" ON "anchors"("tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_anchors_document_version" ON "anchors"("document_id", "version");
