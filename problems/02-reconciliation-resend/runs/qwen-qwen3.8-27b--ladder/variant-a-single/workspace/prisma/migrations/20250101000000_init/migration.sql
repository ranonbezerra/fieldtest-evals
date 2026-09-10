-- CreateType
CREATE TYPE "orders_status" AS ENUM ('pending', 'processing', 'unknown', 'settled', 'rejected', 'needs_review');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "bank_key" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "txid" TEXT,
    "status" "orders_status" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "settled_at" TIMESTAMP(3),
    "settled_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_txid_key" ON "orders"("txid");

-- CreateIndex
CREATE INDEX "orders_status_last_attempt_at_idx" ON "orders"("status", "last_attempt_at");
