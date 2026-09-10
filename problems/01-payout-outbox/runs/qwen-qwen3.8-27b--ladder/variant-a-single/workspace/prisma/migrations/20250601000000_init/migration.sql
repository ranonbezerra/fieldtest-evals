-- Init: payout service — accounts, payouts, outbox messages, double-entry ledger.

CREATE TYPE "PayoutStatus" AS ENUM ('created', 'processing', 'sent', 'completed', 'failed', 'needs_review');

CREATE TYPE "MessageStatus" AS ENUM ('pending', 'processing', 'processed');

CREATE TABLE "account" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "settled_balance" BIGINT NOT NULL DEFAULT 0,
    "reserved_balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payout" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "account_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'created',
    "tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "payout_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payout_account_id_idempotency_key_key" UNIQUE ("account_id", "idempotency_key")
);

CREATE INDEX "payout_account_id_idx" ON "payout" ("account_id");

ALTER TABLE "payout" ADD CONSTRAINT "payout_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "message" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "message_status_next_attempt_at_idx" ON "message" ("status", "next_attempt_at");

CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "payout_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_entry_payout_id_idx" ON "ledger_entry" ("payout_id");

ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ledger_line" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "entry_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_id" TEXT,
    "direction" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    CONSTRAINT "ledger_line_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_line_account_id_idx" ON "ledger_line" ("account_id");

ALTER TABLE "ledger_line" ADD CONSTRAINT "ledger_line_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_line" ADD CONSTRAINT "ledger_line_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
