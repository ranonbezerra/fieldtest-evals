CREATE TABLE IF NOT EXISTS "accounts" (
    "id" VARCHAR(24) PRIMARY KEY DEFAULT gen_random_uuid(),
    "settled_balance" BIGINT NOT NULL DEFAULT 0,
    "reserved_balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "payouts" (
    "id" VARCHAR(24) PRIMARY KEY DEFAULT gen_random_uuid(),
    "account_id" VARCHAR(24) NOT NULL REFERENCES "accounts"("id"),
    "amount" BIGINT NOT NULL,
    "destination_address" VARCHAR(255) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL UNIQUE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    "tx_hash" VARCHAR(255),
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "processed_at" TIMESTAMP,
    "completed_at" TIMESTAMP,
    "retries" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "messages" (
    "id" VARCHAR(24) PRIMARY KEY DEFAULT gen_random_uuid(),
    "payout_id" VARCHAR(24) NOT NULL UNIQUE REFERENCES "payouts"("id"),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "ledger_entries" (
    "id" VARCHAR(24) PRIMARY KEY DEFAULT gen_random_uuid(),
    "account_id" VARCHAR(24) NOT NULL REFERENCES "accounts"("id"),
    "amount" BIGINT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "payout_id" VARCHAR(24) REFERENCES "payouts"("id"),
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);
