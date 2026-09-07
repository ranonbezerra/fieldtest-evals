-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('created', 'processing', 'sent', 'completed', 'failed', 'needs_review');
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'processing', 'done', 'dead');
CREATE TYPE "OutboxKind" AS ENUM ('payout_transfer', 'payout_finalize');
CREATE TYPE "LedgerBucket" AS ENUM ('available', 'reserved', 'in_transit', 'settled_out');
CREATE TYPE "LedgerSide" AS ENUM ('debit', 'credit');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "settled_balance" BIGINT NOT NULL DEFAULT 0,
    "reserved_balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'created',
    "tx_hash" TEXT,
    "provider_attempted_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" TEXT NOT NULL,
    "kind" "OutboxKind" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT,
    "account_id" TEXT NOT NULL,
    "bucket" "LedgerBucket" NOT NULL,
    "side" "LedgerSide" NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payouts_account_id_idx" ON "payouts"("account_id");
CREATE UNIQUE INDEX "payouts_idempotency_key_key" ON "payouts"("idempotency_key");
CREATE INDEX "outbox_messages_status_next_attempt_idx" ON "outbox_messages"("status", "next_attempt_at");
CREATE INDEX "ledger_entries_account_id_idx" ON "ledger_entries"("account_id");
CREATE INDEX "ledger_entries_payout_id_idx" ON "ledger_entries"("payout_id");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_ref_id_fkey" FOREIGN KEY ("ref_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddConstraint
-- Funds-safety backstops, enforced inside Postgres regardless of application code.
ALTER TABLE "accounts" ADD CONSTRAINT "account_settled_balance_non_negative" CHECK ("settled_balance" >= 0);
ALTER TABLE "accounts" ADD CONSTRAINT "account_reserved_balance_non_negative" CHECK ("reserved_balance" >= 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entry_amount_positive" CHECK ("amount" > 0);
