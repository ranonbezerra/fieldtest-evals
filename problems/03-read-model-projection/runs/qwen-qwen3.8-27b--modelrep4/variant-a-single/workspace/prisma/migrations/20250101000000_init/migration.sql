-- Source tables

CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "worker_id" TEXT,
    "event_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- Read-model projections

CREATE TABLE "operation_views" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "worker_id" TEXT,
    "worker_name" TEXT,
    "event_id" TEXT,
    "event_title" TEXT,
    "event_venue" TEXT,
    "event_starts_at" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operation_views_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "company_operation_totals" (
    "company_id" TEXT NOT NULL,
    "pending_cents" BIGINT NOT NULL DEFAULT 0,
    "approved_cents" BIGINT NOT NULL DEFAULT 0,
    "rejected_cents" BIGINT NOT NULL DEFAULT 0,
    "completed_cents" BIGINT NOT NULL DEFAULT 0,
    "cancelled_cents" BIGINT NOT NULL DEFAULT 0,
    "pending_count" BIGINT NOT NULL DEFAULT 0,
    "approved_count" BIGINT NOT NULL DEFAULT 0,
    "rejected_count" BIGINT NOT NULL DEFAULT 0,
    "completed_count" BIGINT NOT NULL DEFAULT 0,
    "cancelled_count" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "company_operation_totals_pkey" PRIMARY KEY ("company_id")
);

-- Source-table indexes (re-derivation and drift checks scan by created_at / company)

CREATE INDEX "workers_company_id_idx" ON "workers"("company_id");
CREATE INDEX "events_company_id_idx" ON "events"("company_id");
CREATE INDEX "payment_orders_company_id_idx" ON "payment_orders"("company_id");
CREATE INDEX "payment_orders_created_at_idx" ON "payment_orders"("created_at");

-- Dashboard indexes: company-scoped, optional status equality, date range,
-- recency order, pagination. Trailing id DESC breaks created_at ties so
-- pagination is stable.
CREATE INDEX "operation_views_company_status_created_idx" ON "operation_views"("company_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "operation_views_company_created_idx" ON "operation_views"("company_id", "created_at" DESC, "id" DESC);

-- Re-derivation / drift-repair window scans.
CREATE INDEX "operation_views_created_at_idx" ON "operation_views"("created_at");

-- Referential integrity

ALTER TABLE "workers" ADD CONSTRAINT "workers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Status whitelist enforced in the database as well as in the services.

ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'completed', 'cancelled'));
ALTER TABLE "operation_views" ADD CONSTRAINT "operation_views_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'completed', 'cancelled'));
