-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'PROCESSING', 'SENT', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('OPEN', 'PROCESSED');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "settled" BIGINT NOT NULL DEFAULT 0,
    "held" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" BIGSERIAL NOT NULL,
    "payout_id" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'OPEN',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "delta" BIGINT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_idempotency_key_key" ON "payouts"("idempotency_key");

-- CreateIndex
CREATE INDEX "payouts_account_id_status_idx" ON "payouts"("account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_messages_payout_id_key" ON "outbox_messages"("payout_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_id_idx" ON "ledger_entries"("account_id", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_payout_id_idx" ON "ledger_entries"("payout_id");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
