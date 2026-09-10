-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'PROCESSING', 'SENT', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'PROCESSED');
CREATE TYPE "LedgerBucket" AS ENUM ('AVAILABLE', 'HELD', 'PAID_OUT');
CREATE TYPE "LedgerSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "settled" BIGINT NOT NULL DEFAULT 0,
    "reserved" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED',
    "tx_hash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(3),
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "bucket" "LedgerBucket" NOT NULL,
    "side" "LedgerSide" NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payouts_account_id_idx" ON "payouts"("account_id");
CREATE UNIQUE INDEX "payouts_account_id_idempotency_key_key" ON "payouts"("account_id", "idempotency_key");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
CREATE UNIQUE INDEX "outbox_messages_payout_id_key" ON "outbox_messages"("payout_id");
CREATE INDEX "outbox_messages_status_next_attempt_at_idx" ON "outbox_messages"("status", "next_attempt_at");
CREATE INDEX "ledger_entries_payout_id_idx" ON "ledger_entries"("payout_id");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
