-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'VOID', 'REFUNDED');

-- CreateTable: source of truth
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: source of truth
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable: source of truth
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: read-model projection for the operations dashboard
CREATE TABLE "operations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "worker_name" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "last_event_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: exact per-company, per-status financial aggregates
CREATE TABLE "company_financial_totals" (
    "company_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id", "status")
);

-- CreateIndex: workers
CREATE INDEX "workers_company_id_idx" ON "workers"("company_id");

-- CreateIndex: source scans by company and by created window
CREATE INDEX "payment_orders_company_id_status_idx" ON "payment_orders"("company_id", "status");
CREATE INDEX "payment_orders_created_at_idx" ON "payment_orders"("created_at");

-- CreateIndex: per-order event history and window scans
CREATE INDEX "order_events_order_id_occurred_at_idx" ON "order_events"("order_id", "occurred_at");
CREATE INDEX "order_events_occurred_at_idx" ON "order_events"("occurred_at");

-- CreateIndex: dashboard query — (company, [status,] last_event_at DESC)
CREATE INDEX "operations_company_id_last_event_at_idx" ON "operations"("company_id", "last_event_at" DESC);
CREATE INDEX "operations_company_id_status_last_event_at_idx" ON "operations"("company_id", "status", "last_event_at" DESC);

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey"
    FOREIGN KEY ("worker_id") REFERENCES "workers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
