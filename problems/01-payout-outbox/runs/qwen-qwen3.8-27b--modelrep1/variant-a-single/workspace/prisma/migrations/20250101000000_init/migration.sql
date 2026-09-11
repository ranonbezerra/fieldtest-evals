-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'PROCESSING', 'SENT', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');
CREATE TYPE "LedgerAccount" AS ENUM ('USER_AVAILABLE', 'USER_HELD', 'PAYOUTS_SENT');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "settled_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "held_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED',
    "tx_hash" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'payout.process',
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_account_id_idempotency_key_key" ON "payouts"("account_id", "idempotency_key");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
CREATE INDEX "ledger_entries_group_id_idx" ON "ledger_entries"("group_id");
CREATE INDEX "ledger_entries_payout_id_idx" ON "ledger_entries"("payout_id");
CREATE INDEX "outbox_messages_status_available_at_idx" ON "outbox_messages"("status", "available_at");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
