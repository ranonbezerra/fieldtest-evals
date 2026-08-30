# 02-migration.sql

## reasoning

```
We need answer user's request: write exactly one file prisma/migrations/20250101000000_init/migration.sql complete, inside one fenced block, nothing else. Need follow plan. Need produce SQL for Prisma initial migration creating three tables: orders, reconcile_runs, send_events. Need consider conventions: TypeScript strict etc but file SQL. Need implement exactly plan. Need likely Prisma migration style. Need include CREATE TABLE, indexes, unique constraints, foreign key? Plan says send_events.order_id FK to orders.id. It mentions Index unique on (txid). Index on (state, effective_date). Need columns snake_case via @map. Types: id String cuid, supplier_key String, amount_cents Int, effective_date String, txid String unique, state String, send_attempts Int default 0, created_at DateTime default now(), updated_at DateTime updated on change. In Prisma migration SQL: "id" TEXT NOT NULL, etc. For cuid default? Prisma cuid is generated client-side, no DB default. So id TEXT NOT NULL PRIMARY KEY. supplier_key TEXT NOT NULL. amount_cents INTEGER NOT NULL. effective_date TEXT NOT NULL. txid TEXT NOT NULL. state TEXT NOT NULL. send_attempts INTEGER NOT NULL DEFAULT 0. created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP. updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP? Prisma @updatedAt is client-side, no DB trigger. Migration typically default now for updated_at if @default(now())? Plan says updated_at updated on change, not explicit default. In Prisma schema if DateTime @updatedAt, migration column is TIMESTAMP(3) NOT NULL (no default). But plan table says updated_at DateTime, updated on change. Could include DEFAULT CURRENT_TIMESTAMP? Prisma @updatedAt doesn't add default. But plan not explicit DB default. Need defensible. Since Prisma manages updated_at in app, no default necessary. But to be safe? If no default, inserting without updated_at fails unless app sets. Prisma client sets it. Migration can have DEFAULT CURRENT_TIMESTAMP? That might not match Prisma schema if @updatedAt no default, but plan doesn't give exact schema. It says updated_at DateTime updated on change. Could include NOT NULL DEFAULT CURRENT_TIMESTAMP. But if later Prisma expects no default? Migration just initial; not run prisma migrate diff maybe. Need likely standard Prisma migration output for schema with @updatedAt: "updated_at" TIMESTAMP(3) NOT NULL; no default. For created_at @default(now()): DEFAULT CURRENT_TIMESTAMP. Plan says created_at default now(). So include default for created_at only.

reconcile_runs: id TEXT PK, window_from TIMESTAMP(3) NOT NULL, window_to TIMESTAMP(3) NOT NULL, matched_count INTEGER NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP.

send_events: id TEXT PK, order_id TEXT NOT NULL, txid TEXT NOT NULL, classification TEXT NOT NULL, raw_response TEXT NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP. Add foreign key order_id references orders(id) on delete? Plan says FK to orders.id. Prisma relation would require onDelete? If not specified, default restrict? In migration: CONSTRAINT "send_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE. Could include. Need maybe index on order_id? Not specified but FK in Postgres doesn't auto index. Plan only says purpose audit. Could add index? "Do not add feature plan does not name." An index on FK might be reasonable but not specified. Avoid extra? But unique txid and state,effective_date specified. For send_events no indexes specified. Could just FK constraint. But maybe Prisma relation without @relation? If no index, okay. But if using Prisma, relation field order? It might create index? No, Prisma doesn't auto-index FK. So no extra.

Need maybe table names quoted? Prisma migrations use CREATE TABLE "orders" (...). Add indexes:
CREATE UNIQUE INDEX "orders_txid_key" ON "orders"("txid");
CREATE INDEX "orders_state_effective_date_idx" ON "orders"("state", "effective_date");
Foreign key constraint name likely "send_events_order_id_fkey".

Need ensure amount_cents integer minor units. Could add CHECK (amount_cents > 0)? Plan says >0 notes. Should migration include check? Prisma schema cannot express @default but can have @@index. Check constraints not in plan data model? It says amount_cents Int, minor units, > 0. "Do not add feature plan does not name." But >0 in notes could be column note, not necessarily DB constraint. Should we include CHECK? Prisma schema doesn't support check constraints in standard? It can via extensions? Not likely. Migration could include CHECK ("amount_cents" > 0). But if plan says deliver schema, service; validation service. It notes >0. To be defensible maybe include CHECK? But "Implement exactly what the plan specifies for this file." The plan data model says amount_cents Int, minor units, > 0. Could be interpreted as constraint. But Prisma migration from schema would not include check unless raw. The convention says no raw SQL? Repository only? Migration is raw SQL. Hmm.

Need maybe state enum values? Plan uses String, not DB enum. So no CHECK for state. Could add CHECK for classification? Not specified. Avoid.

Need maybe use SERIAL? No, cuid string.

Need maybe include comments? SQL migration can have no comments. User says reply only fenced block. Could include no explanation. Need decide if use // ASSUMPTION comments? SQL uses -- comments. The instruction says mark with one `// ASSUMPTION` comment at point it matters if symbol absent. But SQL doesn't use //? It says one `// ASSUMPTION` comment. Could be invalid in SQL? PostgreSQL supports -- comments, not //. If we need assumption, use -- ASSUMPTION? But only if necessary. We likely don't need.

Need ensure complete first line to last. Fenced block with sql. Nothing else.

Let's think deeper: Plan says "Prisma migration file name: 20250101000000_init. Reason: single initial migration." It expects file content likely Prisma-generated SQL. Need match Prisma conventions exactly? Let's infer from Prisma schema:
model Order {
  id String @id @default(cuid())
  supplierKey String @map("supplier_key")
  amountCents Int @map("amount_cents")
  effectiveDate String @map("effective_date")
  txid String @unique @map("txid")
  state String @map("state")
  sendAttempts Int @default(0) @map("send_attempts")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  sendEvents SendEvent[]
  @@index([state, effectiveDate], map: "orders_state_effective_date_idx")? 
  @@map("orders")
}

model ReconcileRun { ... @@map("reconcile_runs") }
model SendEvent { id String @id @default(cuid()) orderId String @map("order_id") txid String @map("txid") classification String @map("classification") rawResponse String @map("raw_response") createdAt DateTime @default(now()) @map("created_at") order Order @relation(fields: [orderId], references: [id]) @@map("send_events") }

Prisma migration output order:
-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "effective_date" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "send_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconcile_runs" (
    "id" TEXT NOT NULL,
    "window_from" TIMESTAMP(3) NOT NULL,
    "window_to" TIMESTAMP(3) NOT NULL,
    "matched_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconcile_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "raw_response" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_txid_key" ON "orders"("txid");

-- CreateIndex
CREATE INDEX "orders_state_effective_date_idx" ON "orders"("state", "effective_date");

-- AddForeignKey
ALTER TABLE "send_events" ADD CONSTRAINT "send_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

This is likely. But should we include default for updated_at? If schema has @updatedAt no default. Plan says updated on change, not default. Keep no default.

Need consider "Money in minor units, integers only." Could use BIGINT? Plan says Int. Use INTEGER.

Need consider "effectiveDate is UTC calendar day (YYYY-MM-DD) stored on order" String. Use TEXT.

Need maybe add CHECK amount_cents > 0? Let's evaluate. The plan data model table: `amount_cents` | `Int` | `@map("amount_cents")`, minor units, > 0. In Prisma schema, Int cannot enforce >0; service validates. If migration includes CHECK, it's extra not named? But note says > 0, could be requirement. However "Do not add an export, a feature or a file the plan does not name." A check constraint is not a feature? It's data integrity. But if they compare to expected Prisma migration, extra CHECK may be considered deviating. Since plan says "Prisma schema ... Models as described" and Prisma doesn't generate check, likely no CHECK. Also tests mention money integer: schema and service reject or ignore non-integer amounts (Prisma Int column enforces at DB level; service validates input). It doesn't mention >0 enforcement. So no CHECK.

Need maybe add index on send_events.order_id? Not specified. Avoid.

Need maybe include "public" schema? Prisma migration doesn't quote public in CREATE TABLE, but FK references "orders". It uses ON DELETE RESTRICT ON UPDATE CASCADE. Good.

Need maybe include `ALTER TABLE "orders" ALTER COLUMN "send_attempts" SET DEFAULT 0;`? No, inline default.

Need maybe include `DROP TABLE IF EXISTS`? Initial migration no.

Need ensure final answer only fenced block. Could include ```sql ... ```. User says inside one fenced block, and nothing else. Good.

Double-check potential issue: `updated_at` no default but Prisma @updatedAt requires value; if repository creates order, must set updatedAt. In migration no default. Fine.

Could there be need for `send_events.raw_response` to be JSONB? Plan says String JSON string. Use TEXT.

Could `reconcile_runs` have unique on window? No.

Could `orders.txid` unique per order+date? Plan says unique on (txid). Use unique.

Could `orders` need index on effective_date alone? No.

Need maybe use `TIMESTAMP(3)` vs `TIMESTAMPTZ`? Prisma DateTime maps to TIMESTAMP(3) (without time zone) by default. Use TIMESTAMP(3). Good.

Need maybe use `TEXT` for id. Yes.

Need maybe include primary key constraints after columns with blank line as Prisma. Fine.

Need maybe include comments `-- CreateTable` etc. Prisma migrations include these comments. The plan says file initial migration. Including comments okay? It says complete. Could include standard comments. But "Do not add ... plan does not name." Comments not features. Standard migration includes them. Could include or omit. To be safe, include standard Prisma comments? They are not part of SQL execution. But if expected exact? It might not matter. The instruction says never an "unchanged" comment, but standard comments okay? It says write complete first line to last. I can include no comments to be minimal. But Prisma migration files often have comments. The plan manifest doesn't specify content style. Since it's a migration, either is fine. Maybe include no comments to avoid extra. But "Initial migration creating the three tables" likely expects SQL statements only. I can include comments? The final answer should be just file content. Comments are okay but not necessary. To minimize deviation, use only SQL statements without comments? But Prisma-generated migration has comments; however task doesn't require exact generated. It says implement plan. I'd output clean SQL without comments, except maybe none. But if they expect migration file, comments not harmful. The instruction "Do not add an export, a feature or a file the plan does not name" not comments. But "nothing else". I can include no comments for concise.

Need think about `// ASSUMPTION` if any. No.

Potential hidden requirement: "Every schema change ships with a migration." This is initial migration. Need maybe include `--` comments? Not required.

Let's consider if `send_events` should have `order` relation and maybe cascade delete? Plan says FK to orders.id. No onDelete specified. Prisma default is Restrict for required relations? Actually if relation is optional? For required, default onDelete: Restrict? In Prisma, default referential actions are Restrict for required and SetNull for optional? I think default is Restrict. Migration output ON DELETE RESTRICT ON UPDATE CASCADE. Good.

Potential issue: If order deleted, send_events restricted. Fine.

Could `orders.state` have default? Plan says state enum values, pending only sent. No default specified. Could include DEFAULT 'pending'? Not in plan. Avoid.

Could `send_events.classification` default? No.

Need maybe include `amount_cents` as `INTEGER` not `INT`. Both okay. Prisma uses INTEGER.

Need maybe include `matched_count` default 0? Plan says Int, no default. But repository create with matchedCount. Could include DEFAULT 0? Not specified. Avoid.

Need maybe include `send_attempts` default 0. Yes plan says default 0.

Need maybe include `created_at` default now. Yes.

Let's ensure SQL syntax:
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "effective_date" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "send_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reconcile_runs" (...);
CREATE TABLE "send_events" (...);
CREATE UNIQUE INDEX ...;
CREATE INDEX ...;
ALTER TABLE ... ADD CONSTRAINT ...;

All good.

Need final only fenced block. Ensure no trailing explanation. Use ```sql.

One more thought: The plan says "Index: unique on `(txid)`. Index on `(state, effective_date)` for query efficiency." It doesn't specify index names. We choose standard. Good.

Could there be an index on `orders_effective_date` for reconcile findOrdersByEffectiveDate? Plan repository has findOrdersByEffectiveDate. It only specifies index on state, effective_date. That composite can support queries where state specified; findOrdersByEffectiveDate maybe not. But plan says only that index. Do not add extra.

Could reconcile need find orders by effective_date and state sent, composite (state, effective_date) supports if state first? Query where state='sent' and effective_date=date uses index. Good.

Could findOrdersByTxids use unique index. Good.

Need maybe add `CREATE INDEX "send_events_order_id_idx"`? Not specified, but FK performance. Avoid.

Now final.
```

## reply

```sql
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "effective_date" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "send_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reconcile_runs" (
    "id" TEXT NOT NULL,
    "window_from" TIMESTAMP(3) NOT NULL,
    "window_to" TIMESTAMP(3) NOT NULL,
    "matched_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconcile_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "send_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "raw_response" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_txid_key" ON "orders"("txid");

CREATE INDEX "orders_state_effective_date_idx" ON "orders"("state", "effective_date");

ALTER TABLE "send_events" ADD CONSTRAINT "send_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```
