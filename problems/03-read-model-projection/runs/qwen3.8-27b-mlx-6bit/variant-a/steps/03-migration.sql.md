# 03-migration.sql

## reasoning

```
Let me analyze the PLAN.md to understand what tables and indexes I need to create in the migration.

Tables:
1. `payment_orders` - source, simulated
2. `events` - source, simulated
3. `workers` - source, simulated
4. `operations` - projection
5. `company_financial_totals` - exact aggregate

Let me detail each table based on the plan:

**payment_orders:**
- id: uuid, PK
- company_id: uuid, NOT NULL (FK → companies, but not modelled here; opaque)
- worker_id: uuid, NOT NULL (FK → workers.id)
- status: text, NOT NULL (enum: pending / approved / rejected / settled)
- amount: numeric(14,2), NOT NULL
- currency: char(3), NOT NULL (ISO-4217)
- created_at: timestamptz, NOT NULL, default now()
- updated_at: timestamptz, NOT NULL, default now()

**events:**
- id: uuid, PK
- order_id: uuid, NOT NULL (FK → payment_orders.id)
- event_type: text, NOT NULL
- payload: jsonb, NOT NULL, default '{}'
- created_at: timestamptz, NOT NULL, default now()

**workers:**
- id: uuid, PK
- company_id: uuid, NOT NULL
- name: text, NOT NULL
- role: text, NOT NULL

**operations (projection):**
- order_id: uuid, PK, FK → payment_orders.id
- company_id: uuid, NOT NULL
- status: text, NOT NULL
- amount: numeric(14,2), NOT NULL
- currency: char(3), NOT NULL
- worker_name: text, NOT NULL
- worker_role: text, NOT NULL
- last_event_type: text, NULL
- created_at: timestamptz, NOT NULL
- updated_at: timestamptz, NOT NULL

Indexes on `operations`:
- `(company_id, status, created_at DESC)` — dashboard with status filter
- `(company_id, created_at DESC)` — dashboard without status filter

**company_financial_totals:**
- company_id: uuid, PK
- total_amount: numeric(14,2), NOT NULL, default 0
- order_count: integer, NOT NULL, default 0
- updated_at: timestamptz, NOT NULL, default now()

Now, regarding FK constraints:
- `payment_orders.worker_id` → `workers.id` - this is a real FK
- `events.order_id` → `payment_orders.id` - this is a real FK
- `operations.order_id` → `payment_orders.id` - this is a real FK
- `payment_orders.company_id` → companies (not modelled here; opaque) - so no FK constraint, just a column
- `workers.company_id` - no FK mentioned to any table

Let me think about naming conventions. The plan says "Table and column: `snake_case` (via Prisma `@map`/`@@map`)". So in the migration SQL, tables and columns should be snake_case. Since these are the actual DB names, I'll use snake_case directly in the DDL.

For Prisma, the model names would be PascalCase but the `@@map` and `@map` attributes map them to snake_case. In the migration SQL, I see the actual database names.

Let me write the DDL:

```sql
-- payment_orders
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- workers
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- events
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- operations (projection)
CREATE TABLE "operations" (
    "order_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "worker_name" TEXT NOT NULL,
    "worker_role" TEXT NOT NULL,
    "last_event_type" TEXT,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("order_id")
);

-- company_financial_totals
CREATE TABLE "company_financial_totals" (
    "company_id" UUID NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id")
);

-- Indexes on operations
CREATE INDEX "operations_company_id_status_created_at_idx" ON "operations"("company_id", "status", "created_at" DESC);
CREATE INDEX "operations_company_id_created_at_idx" ON "operations"("company_id", "created_at" DESC);

-- Foreign keys
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id");
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id");
ALTER TABLE "operations" ADD CONSTRAINT "operations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id");
```

Wait, I need to think about the order of table creation. `payment_orders` references `workers`, and `events` references `payment_orders`, and `operations` references `payment_orders`. So the order should be:
1. workers (no deps)
2. payment_orders (depends on workers)
3. events (depends on payment_orders)
4. operations (depends on payment_orders)
5. company_financial_totals (no deps)

Then indexes and FKs at the end.

Actually, in Prisma migrations, FKs are typically added as ALTER TABLE statements at the end. Let me follow that pattern.

Also, I should think about whether to add indexes on the source tables. The plan only specifies indexes on `operations`. Let me stick to what the plan says.

Let me also consider: should I add an index on `payment_orders.created_at` for the re-derivation window query? The plan says "Fetch all `payment_orders` in `[date_from, date_to]` ordered by `created_at ASC`" for re-derivation, and the drift-repair fetches projection rows with `updated_at` in window. But the plan only explicitly lists indexes on `operations`. I'll stick to exactly what's specified.

Wait, let me re-read the plan. Under "Data model", it says:
- Indexes on `operations`: two indexes listed.

That's it. No other indexes are specified. I'll only add those.

For the `TIMESTAMP(3) WITH TIME ZONE` vs `timestamptz` - in Prisma migrations, it typically uses `TIMESTAMP(3) WITH TIME ZONE`. Let me use that.

Let me finalize the migration.
```

## reply

```sql
-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "order_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "worker_name" TEXT NOT NULL,
    "worker_role" TEXT NOT NULL,
    "last_event_type" TEXT,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "company_financial_totals" (
    "company_id" UUID NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "operations_company_id_status_created_at_idx" ON "operations"("company_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "operations_company_id_created_at_idx" ON "operations"("company_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id");

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id");
```
