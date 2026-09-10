-- Source tables (simulated write path)

CREATE TABLE companies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workers (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workers_company_idx ON workers (company_id);

CREATE TABLE payment_orders (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  worker_id uuid NOT NULL REFERENCES workers (id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_orders_company_created_idx ON payment_orders (company_id, created_at DESC);
CREATE INDEX payment_orders_company_status_idx ON payment_orders (company_id, status);
CREATE INDEX payment_orders_created_at_idx ON payment_orders (created_at);

CREATE TABLE events (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  worker_id uuid NOT NULL REFERENCES workers (id),
  type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_company_worker_idx ON events (company_id, worker_id, occurred_at DESC);

-- Read model: the operations list, shaped like the dashboard query.
-- No FKs: a projection is rebuilt, not cascade-deleted; integrity against the
-- source is enforced by drift repair, not by constraints.

CREATE TABLE op_operations (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  worker_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  amount_cents bigint NOT NULL,
  last_event_type text,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- The dashboard access pattern: filter by company (and optionally status),
-- order by recency (created_at DESC, id DESC as a deterministic tie-break),
-- and return every displayed column. INCLUDE makes the index covering, so the
-- query is an index-only scan that never touches the heap and never sorts.
CREATE INDEX ops_company_recency_covering
  ON op_operations (company_id, created_at DESC, id DESC)
  INCLUDE (status, worker_id, worker_name, amount_cents, last_event_type, last_event_at, updated_at);

CREATE INDEX ops_company_pending
  ON op_operations (company_id, created_at DESC, id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_type, last_event_at, updated_at)
  WHERE status = 'pending';

CREATE INDEX ops_company_approved
  ON op_operations (company_id, created_at DESC, id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_type, last_event_at, updated_at)
  WHERE status = 'approved';

CREATE INDEX ops_company_rejected
  ON op_operations (company_id, created_at DESC, id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_type, last_event_at, updated_at)
  WHERE status = 'rejected';

-- Re-derivation / drift repair rebuild the window by created_at.
CREATE INDEX ops_created_at_idx ON op_operations (created_at);

-- Read model: exact per-company financial totals.
-- No CHECK constraints on the counters: a drifted projection must not block
-- the write path; drift repair restores correctness.

CREATE TABLE company_totals (
  company_id uuid PRIMARY KEY,
  orders_count bigint NOT NULL DEFAULT 0,
  approved_count bigint NOT NULL DEFAULT 0,
  approved_amount_cents bigint NOT NULL DEFAULT 0,
  pending_count bigint NOT NULL DEFAULT 0,
  pending_amount_cents bigint NOT NULL DEFAULT 0,
  rejected_count bigint NOT NULL DEFAULT 0,
  rejected_amount_cents bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
