-- Init: payout outbox schema.

CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "settled_minor_units" BIGINT NOT NULL DEFAULT 0,
    "reserved_minor_units" BIGINT NOT NULL DEFAULT 0,
    "available_minor_units" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount_minor_units" BIGINT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "attempt_state" TEXT NOT NULL DEFAULT 'none',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "tx_hash" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'payout.transfer',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "leased_at" TIMESTAMP(3),
    "next_try_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "amount_minor_units" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payouts_account_id_idempotency_key_key" ON "payouts"("account_id", "idempotency_key");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
CREATE UNIQUE INDEX "messages_payout_id_key" ON "messages"("payout_id");
CREATE INDEX "messages_status_next_try_at_idx" ON "messages"("status", "next_try_at");
CREATE INDEX "ledger_entries_entry_id_idx" ON "ledger_entries"("entry_id");
CREATE INDEX "ledger_entries_payout_id_idx" ON "ledger_entries"("payout_id");
CREATE INDEX "ledger_entries_account_id_idx" ON "ledger_entries"("account_id");

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
