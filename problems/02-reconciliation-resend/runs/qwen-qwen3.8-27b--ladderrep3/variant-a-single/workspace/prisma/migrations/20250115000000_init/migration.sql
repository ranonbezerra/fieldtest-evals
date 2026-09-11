-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'in_flight', 'unknown', 'settled', 'rejected', 'parked');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "txid" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "last_outcome" TEXT,
    "settled_at" TIMESTAMPTZ,
    "parked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_records" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "statement_date" TEXT NOT NULL,
    "settled_at" TIMESTAMPTZ NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settlement_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_txid_key" ON "orders"("txid");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_records_order_id_key" ON "settlement_records"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_records_txid_key" ON "settlement_records"("txid");

-- AddForeignKey
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
