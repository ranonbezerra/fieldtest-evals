-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'sent', 'in_flight', 'retryable', 'settled', 'parked');

-- CreateEnum
CREATE TYPE "ParkReason" AS ENUM ('attempt_limit', 'permanent_rejection');

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "txid" TEXT NOT NULL,
    "park_reason" "ParkReason",
    "last_attempt_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_txid_key" ON "payouts"("txid");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
