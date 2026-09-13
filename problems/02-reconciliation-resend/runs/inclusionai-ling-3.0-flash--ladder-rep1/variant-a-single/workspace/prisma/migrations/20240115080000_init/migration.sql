CREATE TYPE "PayoutStatus" AS ENUM (
    'PENDING',
    'AWAITING_EVIDENCE',
    'SETTLED',
    'REJECTED',
    'PARKED_FOR_REVIEW'
);

CREATE TABLE "payout" (
    "id" VARCHAR(255) NOT NULL DEFAULT gen_random_uuid(),
    "order_ref" VARCHAR(255) NOT NULL,
    "effective_date" VARCHAR(10) NOT NULL,
    "amount" INTEGER NOT NULL,
    "txid" VARCHAR(255) NOT NULL,
    "bank_key" VARCHAR(255) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "send_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_send_outcome" VARCHAR(255),
    "bank_response_code" VARCHAR(255),
    "bank_response_message" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payout_order_ref_unique" ON "payout"("order_ref");
CREATE UNIQUE INDEX "payout_txid_unique" ON "payout"("txid");
