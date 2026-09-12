-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('prepared', 'broadcast_sent', 'broadcast_unknown', 'confirmed', 'failed');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL DEFAULT uuid(),
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL DEFAULT uuid(),
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT 'prepared',
    "block_number" BIGINT,
    "receipt" JSONB,
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "anchors_document_id_version_key" ON "anchors"("document_id", "version");

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
