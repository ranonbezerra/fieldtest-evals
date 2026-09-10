-- Source tables
CREATE TABLE IF NOT EXISTS workers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workers_company_id ON workers (company_id);

CREATE TABLE IF NOT EXISTS payment_orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL REFERENCES workers (id),
  status TEXT NOT NULL DEFAULT 'pending',
  amount_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_company_id ON payment_orders (company_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders (created_at);

CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES payment_orders (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id_latest ON order_events (order_id, created_at DESC, id DESC);

-- Read model: one row per payment order, shaped like the dashboard query.
CREATE TABLE IF NOT EXISTS operations_read_model (
  order_id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL,
  worker_name TEXT,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  last_event_kind TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  maintained_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Covering index for the dashboard access pattern:
-- company_id + status filter, created_at DESC / order_id DESC sort, and all
-- remaining selected columns in INCLUDE, so the list query is index-only.
CREATE INDEX IF NOT EXISTS idx_operations_read_model_dashboard
  ON operations_read_model (company_id, status, created_at DESC, order_id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_kind);

-- Exact per-company financial totals, maintained with in-place increments.
CREATE TABLE IF NOT EXISTS company_totals (
  company_id INTEGER PRIMARY KEY,
  pending_count INTEGER NOT NULL DEFAULT 0,
  pending_amount BIGINT NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  approved_amount BIGINT NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  rejected_amount BIGINT NOT NULL DEFAULT 0,
  refunded_count INTEGER NOT NULL DEFAULT 0,
  refunded_amount BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
