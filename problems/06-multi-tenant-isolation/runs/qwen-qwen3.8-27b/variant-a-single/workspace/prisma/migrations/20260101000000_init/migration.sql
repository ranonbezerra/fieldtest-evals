CREATE TABLE "tenants" (
  "id" TEXT NOT NULL,
  "org" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "branding" JSONB NOT NULL,
  "feature_flags" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_org_key" ON "tenants"("org");
CREATE UNIQUE INDEX "tenants_host_key" ON "tenants"("host");

CREATE TABLE "customers" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE TABLE "plans" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "price_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_tenant_id_code_key" ON "plans"("tenant_id", "code");
CREATE INDEX "plans_tenant_id_idx" ON "plans"("tenant_id");

ALTER TABLE "plans"
  ADD CONSTRAINT "plans_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE TABLE "orders" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "plan_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount_cents" INTEGER NOT NULL,
  "reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_tenant_id_reference_key" ON "orders"("tenant_id", "reference");
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_customer_id_fkey"
  FOREIGN KEY ("customer_id")
  REFERENCES "customers"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_plan_id_fkey"
  FOREIGN KEY ("plan_id")
  REFERENCES "plans"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
