CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'PROCESSING', 'SENT', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');

CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');

CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "settled_balance" BIGINT NOT NULL DEFAULT 0,
    "reserved_amount" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED'::"PayoutStatus",
    "tx_hash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3) WITH TIME ZONE,
    "completed_at" TIMESTAMP(3) WITH TIME ZONE,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payout_messages" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING'::"MessageStatus",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3) WITH TIME ZONE,

    CONSTRAINT "payout_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payout_messages_payout_id_key" ON "payout_messages"("payout_id");

CREATE UNIQUE INDEX "uq_messages_account_idem" ON "payout_messages"("account_id", "idempotency_key");

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payout_messages" ADD CONSTRAINT "payout_messages_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
