CREATE TABLE IF NOT EXISTS "companies" (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "workers" (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  "companyId" UUID NOT NULL REFERENCES "companies"(id),
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "payment_orders" (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL REFERENCES "companies"(id),
  "workerId"  UUID NOT NULL REFERENCES "workers"(id),
  amount      DECIMAL(18,4) NOT NULL,
  status      VARCHAR(50) NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "events" (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId"  UUID NOT NULL REFERENCES "payment_orders"(id),
  type       VARCHAR(100) NOT NULL,
  data       JSONB DEFAULT '{}',
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "order_dashboard" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId"    UUID UNIQUE NOT NULL,
  "companyId"  UUID NOT NULL,
  "workerId"   UUID NOT NULL,
  "workerName" VARCHAR(255) NOT NULL,
  "companyName" VARCHAR(255) NOT NULL,
  amount       DECIMAL(18,4) NOT NULL,
  status       VARCHAR(50) NOT NULL,
  "createdAt"  TIMESTAMP NOT NULL,
  "updatedAt"  TIMESTAMP NOT NULL,
  "eventCount" INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_order_dashboard_filter"
  ON "order_dashboard" ("companyId", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "company_financial_totals" (
  "companyId"      UUID PRIMARY KEY,
  totalOrders      INT NOT NULL DEFAULT 0,
  totalAmount      DECIMAL(18,4) NOT NULL DEFAULT 0,
  approvedCount    INT NOT NULL DEFAULT 0,
  approvedAmount   DECIMAL(18,4) NOT NULL DEFAULT 0,
  "updatedAt"      TIMESTAMP NOT NULL DEFAULT NOW()
);
