-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('PREPARED', 'BROADCAST', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "report_versions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_anchors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "tx_id" VARCHAR(128) NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT 'PREPARED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "block_number" INTEGER,
    "block_hash" VARCHAR(128),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "document_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_versions_document_id_version_key" ON "report_versions"("document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_anchors_document_id_version_key" ON "document_anchors"("document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_anchors_tx_id_key" ON "document_anchors"("tx_id");

-- CreateIndex
CREATE INDEX "document_anchors_status_updated_at_idx" ON "document_anchors"("status", "updated_at");
