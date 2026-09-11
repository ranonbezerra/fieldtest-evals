-- CreateEnum
CREATE TYPE "PaymentOrderState" AS ENUM ('PENDING', 'IN_FLIGHT', 'OUTCOME_UNKNOWN', 'SETTLED', 'REJECTED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "state" "PaymentOrderState" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_result" TEXT,
    "reject_reason" TEXT,
    "settle_txid" TEXT,
    "settled_at" TIMESTAMP(3),
    "parked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_orders_effective_date_state_idx" ON "payment_orders"("effective_date", "state");
