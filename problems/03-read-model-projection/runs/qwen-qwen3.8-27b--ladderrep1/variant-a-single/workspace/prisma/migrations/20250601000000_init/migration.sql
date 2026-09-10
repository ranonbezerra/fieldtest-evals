-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'approved', 'disputed', 'cancelled');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "payment_order_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- Read model: one row per payment order, shaped like the operations dashboard query.
CREATE TABLE "operation_rows" (
    "payment_order_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "worker_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "latest_event_type" TEXT,
    "latest_event_at" TIMESTAMPTZ(6),
    "latest_event_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operation_rows_pkey" PRIMARY KEY ("payment_order_id")
);

-- Read model: exact per-company financial totals, maintained by atomic in-place deltas.
CREATE TABLE "company_financial_totals" (
    "company_id" UUID NOT NULL,
    "pending_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "approved_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "approved_count" INTEGER NOT NULL DEFAULT 0,
    "disputed_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "disputed_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "cancelled_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "workers_company_id_idx" ON "workers"("company_id");
CREATE INDEX "payment_orders_company_id_status_idx" ON "payment_orders"("company_id", "status");
CREATE INDEX "payment_orders_created_at_idx" ON "payment_orders"("created_at");
CREATE INDEX "events_payment_order_id_occurred_at_id_idx" ON "events"("payment_order_id", "occurred_at" DESC, "id" DESC);

-- Covering index for the hot read: seek on (company_id, status), walk in sort order
-- (updated_at DESC, payment_order_id DESC), and answer the whole row from INCLUDE —
-- the dashboard never touches the heap or the source tables.
CREATE INDEX "operation_rows_company_status_updated_idx"
    ON "operation_rows" ("company_id", "status", "updated_at" DESC, "payment_order_id" DESC)
    INCLUDE ("worker_name", "amount_cents", "currency", "latest_event_type", "latest_event_at", "latest_event_id", "created_at");

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operation_rows" ADD CONSTRAINT "operation_rows_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operation_rows" ADD CONSTRAINT "operation_rows_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_financial_totals" ADD CONSTRAINT "company_financial_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
