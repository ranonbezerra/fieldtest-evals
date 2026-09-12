-- CreateTable
CREATE TABLE "payout_orders" (
    "id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "recipient_key" TEXT NOT NULL,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_send_at" TIMESTAMP(3),
    "proven_absent_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "review_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_orders_state_idx" ON "payout_orders"("state");
