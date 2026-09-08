-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ("PENDING","SENT","AWAITING_RECONCILE","SETTLED","REJECTED","FAILED");

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "external_key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "effective_date" TIMESTAMPTZ NOT NULL,
    "txid" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "settled_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_txid_key" ON "payouts"("txid");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
CREATE INDEX "payouts_effective_date_idx" ON "payouts"("effective_date");
