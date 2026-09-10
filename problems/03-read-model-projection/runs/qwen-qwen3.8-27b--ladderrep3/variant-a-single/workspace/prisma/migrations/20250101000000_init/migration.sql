-- Init schema: source tables plus the operations read-model projection.

CREATE TYPE "OrderStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_orders_amount_cents_check" CHECK ("amount_cents" >= 0)
);

-- Projection: one row per payment order, pre-joined with worker and event names.
CREATE TABLE "operation_read_model" (
    "payment_order_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "worker_name" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "event_name" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "operation_read_model_pkey" PRIMARY KEY ("payment_order_id")
);

-- Projection: exact per-company financial totals (whole history).
CREATE TABLE "company_financial_totals" (
    "company_id" UUID NOT NULL,
    "pending_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "approved_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "rejected_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id")
);

-- Source foreign keys.
ALTER TABLE "events"
    ADD CONSTRAINT "events_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
    ADD CONSTRAINT "payment_orders_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
    ADD CONSTRAINT "payment_orders_worker_id_fkey"
    FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
    ADD CONSTRAINT "payment_orders_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Projection foreign keys (integrity; the read model mirrors the source).
ALTER TABLE "operation_read_model"
    ADD CONSTRAINT "operation_read_model_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operation_read_model"
    ADD CONSTRAINT "operation_read_model_worker_id_fkey"
    FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operation_read_model"
    ADD CONSTRAINT "operation_read_model_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_financial_totals"
    ADD CONSTRAINT "company_financial_totals_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Source indexes.
CREATE INDEX "events_company_id_idx" ON "events"("company_id");
CREATE INDEX "idx_payment_orders_company_created" ON "payment_orders"("company_id", "created_at" DESC);
CREATE INDEX "idx_payment_orders_created" ON "payment_orders"("created_at");

-- The dashboard access pattern: filter by company and optional status, range on
-- created_at, sort by created_at DESC with payment_order_id DESC as a stable
-- tiebreak. The INCLUDE list covers every selected column, so a page is served
-- as an index-only scan no matter how large the table gets.
CREATE INDEX "idx_operation_read_model_dashboard"
    ON "operation_read_model" ("company_id", "status", "created_at" DESC, "payment_order_id" DESC)
    INCLUDE ("worker_name", "event_name", "amount_cents", "updated_at");
