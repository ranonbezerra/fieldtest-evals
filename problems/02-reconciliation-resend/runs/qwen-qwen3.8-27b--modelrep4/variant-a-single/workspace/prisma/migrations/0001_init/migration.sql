CREATE TABLE "payouts" (
    "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "supplier_id" TEXT,
    "bank_key" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_tx_id" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "resend_proven_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "settlement_id" UUID,
    "review_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "payouts_status_last_attempt_at_idx" ON "payouts"("status", "last_attempt_at");
CREATE INDEX "payouts_last_tx_id_idx" ON "payouts"("last_tx_id");

CREATE TABLE "settlements" (
    "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "statement_date" DATE NOT NULL,
    "tx_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "settled_at" TIMESTAMP(3),
    "bank_reference" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settlements_statement_date_tx_id_unique" UNIQUE("statement_date", "tx_id")
);

CREATE TABLE "statement_coverage" (
    "date" DATE NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "statement_coverage_date_pkey" PRIMARY KEY("date")
);
