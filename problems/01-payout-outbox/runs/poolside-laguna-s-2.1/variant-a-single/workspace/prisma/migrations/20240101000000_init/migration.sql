CREATE TABLE "accounts" (
    "id" TEXT PRIMARY KEY,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "reserved" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "payouts" (
    "id" TEXT PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'created',
    "tx_hash" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ledger_entries" (
    "id" TEXT PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "payout_id" TEXT,
    "entry_type" TEXT NOT NULL,
    "debit" BIGINT NOT NULL DEFAULT 0,
    "credit" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "payout_messages" (
    "id" TEXT PRIMARY KEY,
    "payout_id" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMPTZ(3),
    "lock_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMTPZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payout_messages_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "payout_messages_pending_idx" ON "payout_messages" ("status", "next_retry_at", "lock_until");
CREATE INDEX "payouts_idempotency_key_idx" ON "payouts" ("idempotency_key");
CREATE INDEX "ledger_entries_payout_id_idx" ON "ledger_entries" ("payout_id");

CREATE OR REPLACE FUNCTION "set_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounts_updated_at_trigger"
    BEFORE UPDATE ON "accounts"
    FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

CREATE TRIGGER "payouts_updated_at_trigger"
    BEFORE UPDATE ON "payouts"
    FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

CREATE TRIGGER "payout_messages_updated_at_trigger"
    BEFORE UPDATE ON "payout_messages"
    FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
