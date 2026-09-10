-- Initial schema for the marketplace back-office.
--
-- Source tables: companies, workers, events, payment_orders.
-- Read-model projection: ops_rows (per-order dashboard rows) and
-- company_totals (exact per-company financial totals).

CREATE TABLE "companies" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL
);

CREATE TABLE "workers" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL
);

CREATE TABLE "events" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "title" TEXT NOT NULL
);

CREATE TABLE "payment_orders" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company_id" TEXT NOT NULL,
  "worker_id" TEXT,
  "event_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount_cents" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Supports the windowed scans used by re-derivation and drift repair.
CREATE INDEX "payment_orders_company_id_idx" ON "payment_orders" ("company_id");

CREATE INDEX "payment_orders_updated_at_idx" ON "payment_orders" ("updated_at");

CREATE TABLE "ops_rows" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "worker_name" TEXT,
  "event_name" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);

-- Covering index for the dashboard access pattern:
--   WHERE company_id = ? [AND status = ?] AND occurred_at in range
--   ORDER BY occurred_at DESC, id DESC
-- The INCLUDE columns make the dashboard read an index-only scan.
CREATE INDEX "idx_ops_rows_lookup"
  ON "ops_rows" ("company_id", "status", "occurred_at" DESC, "id" DESC)
  INCLUDE ("amount_cents", "worker_name", "event_name", "created_at");

CREATE TABLE "company_totals" (
  "company_id" TEXT PRIMARY KEY NOT NULL,
  "total_cents" BIGINT NOT NULL DEFAULT 0,
  "approved_cents" BIGINT NOT NULL DEFAULT 0,
  "rejected_cents" BIGINT NOT NULL DEFAULT 0,
  "order_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "company_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
