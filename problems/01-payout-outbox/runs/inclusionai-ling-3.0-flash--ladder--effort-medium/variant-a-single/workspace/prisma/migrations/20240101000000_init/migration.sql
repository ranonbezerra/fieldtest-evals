CREATE TABLE "accounts" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "settled_balance" BIGINT NOT NULL DEFAULT 0,
  "reserved_balance" BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE "payouts" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "account_id"         UUID NOT NULL REFERENCES "accounts"("id"),
  "amount"             BIGINT NOT NULL,
  "destination_address" VARCHAR(255) NOT NULL,
  "idempotency_key"    VARCHAR(255) NOT NULL UNIQUE,
  "status"             VARCHAR(50) NOT NULL DEFAULT 'created',
  "tx_hash"            VARCHAR(255),
  "retries"            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "messages" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "payout_id" UUID NOT NULL UNIQUE REFERENCES "payouts"("id"),
  "status"    VARCHAR(50) NOT NULL DEFAULT 'pending'
);

CREATE TABLE "ledger_entries" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "payout_id"    UUID REFERENCES "payouts"("id"),
  "account_id"   UUID NOT NULL REFERENCES "accounts"("id"),
  "amount"       BIGINT NOT NULL,
  "balance_after" BIGINT NOT NULL,
  "entry_type"   VARCHAR(50) NOT NULL,
  "reason"       VARCHAR(500) NOT NULL
);
