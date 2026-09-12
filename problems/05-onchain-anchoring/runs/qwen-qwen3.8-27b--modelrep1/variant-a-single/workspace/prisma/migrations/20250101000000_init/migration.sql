-- CreateEnum
CREATE TYPE "AnchorState" AS ENUM ('pending', 'confirmed');

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "state" "AnchorState" NOT NULL DEFAULT 'pending',
    "block_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "broadcast_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anchors_documentId_version_key" ON "anchors"("document_id", "version");
