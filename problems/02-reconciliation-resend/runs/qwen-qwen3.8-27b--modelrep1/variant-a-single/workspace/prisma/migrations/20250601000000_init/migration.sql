-- CreateEnum
CREATE TYPE "payout_state" AS ENUM ('PENDING', 'AWAITING_SETTLEMENT', 'RETRYABLE', 'SETTLED', 'NEEDS_MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "payout_orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "state" "payout_state" NOT NULL DEFAULT 'PENDING',
    "txid" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_send_at" TIMESTAMP(3),
    "last_outcome" TEXT,
    "resend_eligible_at" TIMESTAMP(3),
    "parked_reason" TEXT,
    "settled_at" TIMESTAMP(3),
    "settlement_amount" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_orders_txid_key" ON "payout_orders"("txid");

-- CreateIndex
CREATE INDEX "payout_orders_state_idx" ON "payout_orders"("state");
