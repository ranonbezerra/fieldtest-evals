-- CreateTable
CREATE TABLE "payout_orders" (
    "id" UUID NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "effective_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INT NOT NULL DEFAULT 0,
    "txid" TEXT NOT NULL,
    "last_outcome" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_orders_txid_key" ON "payout_orders"("txid");

-- CreateIndex
CREATE INDEX "payout_orders_status_idx" ON "payout_orders"("status");
