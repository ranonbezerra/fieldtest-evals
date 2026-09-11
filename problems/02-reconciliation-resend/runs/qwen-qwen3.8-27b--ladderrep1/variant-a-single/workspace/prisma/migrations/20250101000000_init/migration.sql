-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SENT', 'OUTCOME_UNKNOWN', 'SETTLED', 'REJECTED', 'PARKED');

-- CreateTable
CREATE TABLE "payout_orders" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "effective_date" TIMESTAMPTZ NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "txid" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "settled_at" TIMESTAMPTZ,
    "parked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payout_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_orders_status_effective_date_idx" ON "payout_orders"("status", "effective_date");
CREATE INDEX "payout_orders_txid_idx" ON "payout_orders"("txid");
