-- CreateEnum
CREATE TYPE "AnchorState" AS ENUM ('PENDING', 'BROADCASTING', 'CONFIRMED');

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "state" "AnchorState" NOT NULL DEFAULT 'PENDING',
    "block_number" INTEGER,
    "block_hash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anchors_document_id_version_key" ON "anchors"("document_id", "version");

-- CreateIndex
CREATE INDEX "anchors_state_idx" ON "anchors"("state");
