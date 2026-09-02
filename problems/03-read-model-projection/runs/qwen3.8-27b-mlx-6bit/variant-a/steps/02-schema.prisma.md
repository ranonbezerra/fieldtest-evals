# 02-schema.prisma

## reasoning

```
Let me analyze the PLAN.md to understand exactly what tables and indexes are needed in the Prisma schema.

From the plan, I need five tables:

1. **payment_orders** (source, simulated)
   - id: uuid, PK
   - company_id: uuid, NOT NULL
   - worker_id: uuid, NOT NULL
   - status: text, NOT NULL (enum: pending / approved / rejected / settled)
   - amount: numeric(14,2), NOT NULL
   - currency: char(3), NOT NULL
   - created_at: timestamptz, NOT NULL, default now()
   - updated_at: timestamptz, NOT NULL, default now()

2. **events** (source, simulated)
   - id: uuid, PK
   - order_id: uuid, NOT NULL
   - event_type: text, NOT NULL
   - payload: jsonb, NOT NULL, default '{}'
   - created_at: timestamptz, NOT NULL, default now()

3. **workers** (source, simulated)
   - id: uuid, PK
   - company_id: uuid, NOT NULL
   - name: text, NOT NULL
   - role: text, NOT NULL

4. **operations** (projection)
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

5. **company_financial_totals** (exact aggregate)
   - company_id: uuid, PK
   - total_amount: numeric(14,2), NOT NULL, default 0
   - order_count: integer, NOT NULL, default 0
   - updated_at: timestamptz, NOT NULL, default now()

Now let me think about the Prisma schema conventions:

- Stack: TypeScript, NestJS, Prisma, PostgreSQL
- Table and column: `snake_case` (via Prisma `@map`/`@@map`)
- ESM

For Prisma:
- Provider: "postgresql"
- datasource with url from env("DATABASE_URL")
- generator client

Let me think about the field naming. The convention says "Table and column: snake_case (via Prisma @map/@@map)". This means the TS field names can be camelCase and mapped to snake_case in the database, OR the field names themselves are snake_case. Looking at the plan's types:

```ts
export interface OperationRow {
  order_id: string;
  company_id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  worker_name: string;
  worker_role: string;
  last_event_type: string | null;
  created_at: Date;
}
```

The fields in the types are snake_case. This suggests the Prisma model fields should be snake_case directly (or use @map). Let me think... The convention says "Table and column: snake_case (via Prisma @map/@@map)". This means the database columns are snake_case, and we use @map to map from the Prisma field name to the DB column name. But if the Prisma field name is already snake_case, then @map would be redundant.

Actually, looking more carefully at the convention: "Table and column: snake_case (via Prisma @map/@@map)" - this tells us the mechanism is @map/@@map. So the Prisma field names could be camelCase and map to snake_case columns. But the types in the plan use snake_case...

Let me re-read: The convention says columns in the DB are snake_case, achieved via @map/@@map. The TS types use snake_case field names. In Prisma, if I name the field `companyId` with `@map("company_id")`, the generated client will have `companyId`. But the plan's types show `company_id`.

I think the most consistent reading is: use snake_case field names in Prisma directly, with @@map for table names. Actually, if the field is already snake_case in Prisma, we don't need @map for individual fields. But @@map is needed if the model name (PascalCase) differs from the table name (snake_case).

Wait, let me reconsider. The convention says "Table and column: snake_case (via Prisma @map/@@map)". This is the standard pattern where:
- Model name in Prisma is PascalCase (e.g., `PaymentOrder`)
- Table name in DB is snake_case (e.g., `payment_orders`) via `@@map("payment_orders")`
- Field name in Prisma could be camelCase (e.g., `companyId`) mapped to snake_case column (`company_id`) via `@map("company_id")`

OR:
- Field name in Prisma is already snake_case (e.g., `company_id`) and no @map needed for the field
- Table name still needs @@map

Given that the plan's types use snake_case field names directly, and the convention explicitly mentions @map for columns, I think the intended pattern is:
- Prisma field names are camelCase
- @map maps them to snake_case DB columns
- @@map maps the model to snake_case table name

But wait, that conflicts with the plan's types which use snake_case. Unless the service layer transforms...

Actually, let me look at this differently. The convention is a general rule for the codebase. The plan specifies types with snake_case. The simplest and most defensible approach that satisfies both:

Option A: Use snake_case directly as Prisma field names (no @map needed for fields), use @@map for table names.
Option B: Use camelCase as Prisma field names, @map to snake_case, @@map for table names.

The convention says "via Prisma @map/@@map" which implies we should use the mapping mechanism. But if fields are already snake_case, @map is technically redundant (mapping a field to itself).

I'll go with Option B (camelCase fields + @map) since the convention explicitly calls out @map as the mechanism. The types in the plan are application-level interfaces, not necessarily the Prisma model field names. The repository/service layer would handle the mapping.

Actually wait - let me reconsider again. If I use camelCase in Prisma, the generated Prisma client will have camelCase fields. The repository would then need to map to the snake_case types defined in the plan. That's an extra step but it's clean separation.

Hmm, but actually the most natural reading of "Table and column: snake_case (via Prisma @map/@@map)" in the context of this codebase is:
- The DB uses snake_case (obviously, it's Postgres convention)
- We achieve this in Prisma by using @map and @@map

This strongly implies the Prisma field names are NOT snake_case (otherwise why mention @map?). So I'll use camelCase in Prisma with @map to snake_case.

Let me now write the schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model PaymentOrder {
  id         String   @id @default(uuid()) @db.Uuid
  companyId  String   @map("company_id") @db.Uuid
  workerId   String   @map("worker_id") @db.Uuid
  status     String
  amount     Decimal  @db.Decimal(14, 2)
  currency   String   @db.Char(3)
  createdAt  DateTime @map("created_at") @default(now()) @db.Timestamptz(6)
  updatedAt  DateTime @map("updated_at") @default(now()) @db.Timestamptz(6)

  @@map("payment_orders")
}

model Event {
  id        String   @id @default(uuid()) @db.Uuid
  orderId   String   @map("order_id") @db.Uuid
  eventType String   @map("event_type")
  payload   Json     @default("{}")
  createdAt DateTime @map("created_at") @default(now()) @db.Timestamptz(6)

  @@map("events")
}
```

Wait, "Event" is a reserved word in some contexts. Let me think... In Prisma, model names are just identifiers. "Event" should be fine as a model name. But to be safe, I could name it `OrderEvent`. Actually the plan calls it "events" table. Let me just use `Event` as the model name with `@@map("events")`.

Actually, I realize I should think about whether to include relations. The plan mentions FK relationships:
- payment_orders.worker_id → workers.id
- events.order_id → payment_orders.id
- operations.order_id → payment_orders.id (PK and FK)

Should I define explicit relations in Prisma? The plan says "FK → workers.id" and "FK → payment_orders.id". In Prisma, to have a FK in the DB, I need to define the relation. Let me include them.

But wait - do I need relations for the query patterns in the plan? The repository methods like `findWorkerById` suggest direct queries rather than relation traversals. And the projection table denormalizes everything, so the dashboard query doesn't need joins.

However, for correctness and to have actual FK constraints in the DB (which the plan implies with "FK →"), I should define the relations.

Let me also think about the `payload` field. The plan says `jsonb, NOT NULL, default '{}'`. In Prisma, the type is `Json` with `@db.JsonB` for Postgres. Actually, Prisma's `Json` type maps to `jsonb` on PostgreSQL by default in recent versions. Let me use `Json` with `@default("{}")`.

Wait, actually for PostgreSQL, Prisma's `Json` type maps to `jsonb` by default. But to be explicit, I can add `@db.JsonB`. Let me check - actually in Prisma, for PostgreSQL provider, `Json` already maps to `jsonb`. Adding `@db.JsonB` is redundant but explicit. I'll add it for clarity.

Now for the `operations` table, the PK is `order_id` which is also a FK to `payment_orders.id`. In Prisma:

```prisma
model Operation {
  orderId        String   @id @map("order_id") @db.Uuid
  companyId      String   @map("company_id") @db.Uuid
  status         String
  amount         Decimal  @db.Decimal(14, 2)
  currency       String   @db.Char(3)
  workerName     String   @map("worker_name")
  workerRole     String   @map("worker_role")
  lastEventType  String?  @map("last_event_type")
  createdAt      DateTime @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @map("updated_at") @default(now()) @db.Timestamptz(6)

  paymentOrder   PaymentOrder @relation(fields: [orderId], references: [id])

  @@index([companyId, status, createdAt(sort: Desc)])
  @@index([companyId, createdAt(sort: Desc)])
  @@map("operations")
}
```

Wait, for the index with DESC, Prisma supports `sort: Desc` in `@@index`. Let me verify the syntax. Yes, Prisma supports:
```prisma
@@index([companyId, status, createdAt(sort: Desc)])
```

For the `company_financial_totals` table:
```prisma
model CompanyFinancialTotal {
  companyId   String   @id @map("company_id") @db.Uuid
  totalAmount Decimal  @default(0) @map("total_amount") @db.Decimal(14, 2)
  orderCount  Int      @default(0) @map("order_count")
  updatedAt   DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  @@map("company_financial_totals")
}
```

Now, about the `updated_at` in `operations` - the plan says "projection row timestamp" without a default. Looking at the control flow, it's set during the upsert. I'll include `@default(now())` for safety, or actually the plan says it's the "projection row timestamp" which implies it's set by the application. Let me not add a default for `operations.updated_at` since the plan explicitly sets it. Actually, looking at the plan more carefully:

For `operations`:
- `created_at | timestamptz, NOT NULL | from payment_orders.created_at (sort key)` - no default mentioned
- `updated_at | timestamptz, NOT NULL | projection row timestamp` - no default mentioned

For `company_financial_totals`:
- `updated_at | timestamptz, NOT NULL, default now()` - has default

For `payment_orders`:
- `created_at | timestamptz, NOT NULL, default now()` - has default
- `updated_at | timestamptz, NOT NULL, default now()` - has default

So for `operations`, both `created_at` and `updated_at` don't have defaults - they're set by the application during upsert. I'll omit `@default(now())` for those.

Actually wait, let me reconsider. If there's no default and the field is NOT NULL, then every INSERT must provide a value. That's fine since the application always sets them. Let me go with no defaults for `operations.created_at` and `operations.updated_at`.

Now let me think about the `Event` model name. "Event" is not reserved in Prisma, but it might conflict with something. Let me just use it since the plan calls the table "events".

Let me also consider: do I need `@@index` on any other tables? The plan only specifies indexes on `operations`. For the source tables, no specific indexes are mentioned beyond what's needed for FKs (which Prisma creates automatically). I'll only add the specified indexes.

Actually, for `events`, having an index on `order_id` would be important for the `findLastEventForOrder` query (SELECT ... WHERE order_id = ? ORDER BY created_at DESC LIMIT 1). But the plan doesn't explicitly list this index. However, since `order_id` is a FK to `payment_orders`, Prisma will create an index on it automatically when the relation is defined.

Wait, does Prisma automatically create indexes for FK relations? Yes, it does by default in PostgreSQL. So I don't need to add explicit indexes for FK columns.

Let me also think about the `payload` field type. In Prisma for PostgreSQL:
- `Json` type maps to `jsonb` 
- `@default("{}")` for the default

Actually, I need to be careful. The Prisma `Json` type in PostgreSQL is indeed `jsonb`. Let me verify the default syntax. In Prisma, for a Json field, the default is specified as `@default("{}")` - this should work.

Hmm, actually I recall that in Prisma, for `Json` fields, the default syntax might be different. Let me think... I believe `@default("{}")` works for Json fields in Prisma. Yes, it does.

Let me finalize the schema. One more consideration: the `uuid()` default. In Prisma for PostgreSQL, `@default(uuid())` generates a UUID v4 at the database level. This is correct for our use case.

Let me also double-check: the plan says `id | uuid, PK` for payment_orders, events, workers. For operations, the PK is `order_id`. For company_financial_totals, the PK is `company_id`.

One more thing: should I add `@@map` or `@map` for the status field? The plan says `status | text, NOT NULL`. In Prisma, a `String` field maps to `text` by default in PostgreSQL. So no `@db.Text` needed, but I could add it for explicitness. I'll omit it since `String` → `text` is the default.

Actually, for `char(3)`, I need `@db.Char(3)` since Prisma's `String` defaults to `text`.

Let me write the final schema now.

Wait, one more thought on the `Event` model. Should I name it `OrderEvent` to be more descriptive and avoid potential naming conflicts? The plan calls it "events" (the table). The model name in Prisma would be `Event` with `@@map("events")`. I think `Event` is fine.

Actually, I want to reconsider whether to use relations or not. The plan's repository methods suggest:
- `findWorkerById(workerId)` - direct query on workers
- `findLastEventForOrder(orderId)` - direct query on events
- The projection denormalizes everything

If I define relations in Prisma, I get:
1. Actual FK constraints in the DB (good for data integrity)
2. The ability to use relation queries (not needed here but harmless)
3. Auto-generated indexes on FK columns

I'll define the relations to get proper FK constraints, matching the plan's "FK →" notation.

For `payment_orders`:
- `workerId` FK → `workers.id`

For `events`:
- `orderId` FK → `payment_orders.id`

For `operations`:
- `orderId` PK and FK → `payment_orders.id`

Let me write this out now. I'll use the relation pattern where the "many" side has the `@relation` field.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Worker {
  id        String @id @default(uuid()) @db.Uuid
  companyId String @map("company_id") @db.Uuid
  name      String
  role      String

  paymentOrders PaymentOrder[]

  @@map("workers")
}

model PaymentOrder {
  id        String   @id @default(uuid()) @db.Uuid
  companyId String   @map("company_id") @db.Uuid
  workerId  String   @map("worker_id") @db.Uuid
  status    String
  amount    Decimal  @db.Decimal(14, 2)
  currency  String   @db.Char(3)
  createdAt DateTime @map("created_at") @default(now()) @db.Timestamptz(6)
  updatedAt DateTime @map("updated_at") @default(now()) @db.Timestamptz(6)

  worker Worker   @relation(fields: [workerId], references: [id])
  events Event[]
  operation Operation?

  @@map("payment_orders")
}

model Event {
  id        String   @id @default(uuid()) @db.Uuid
  orderId   String   @map("order_id") @db.Uuid
  eventType String   @map("event_type")
  payload   Json     @default("{}")
  createdAt DateTime @map("created_at") @default(now()) @db.Timestamptz(6)

  paymentOrder PaymentOrder @relation(fields: [orderId], references: [id])

  @@map("events")
}

model Operation {
  orderId       String   @id @map("order_id") @db.Uuid
  companyId     String   @map("company_id") @db.Uuid
  status        String
  amount        Decimal  @db.Decimal(14, 2)
  currency      String   @db.Char(3)
  workerName    String   @map("worker_name")
  workerRole    String   @map("worker_role")
  lastEventType String?  @map("last_event_type")
  createdAt     DateTime @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime @map("updated_at") @db.Timestamptz(6)

  paymentOrder PaymentOrder @relation(fields: [orderId], references: [id])

  @@index([companyId, status, createdAt(sort: Desc)])
  @@index([companyId, createdAt(sort: Desc)])
  @@map("operations")
}

model CompanyFinancialTotal {
  companyId   String   @id @map("company_id") @db.Uuid
  totalAmount Decimal  @default(0) @map("total_amount") @db.Decimal(14, 2)
  orderCount  Int      @default(0) @map("order_count")
  updatedAt   DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  @@map("company_financial_totals")
}
```

Wait, I need to double-check the `Json` default. In Prisma, for a `Json` field, is the syntax `@default("{}")` or something else? Let me think...

In Prisma, for PostgreSQL `Json` fields (which are `jsonb`), the default can be specified as:
- `@default("{}")` - this should work in recent Prisma versions

Actually, I recall there might be an issue. Let me use `@default(dbgenerated("'{}'::jsonb"))` or just `@default("{}")`. I'll go with `@default("{}")` as it's the standard Prisma way.

Hmm, actually I just want to double-check: in Prisma schema, for a `Json` type field, the correct default syntax is indeed `@default("{}")`. Yes, this is correct for Prisma 4.x and later.

One more consideration: the `@db.Timestamptz(6)` - is precision 6 correct for `timestamptz`? In PostgreSQL, `timestamp with time zone` has microsecond precision (6 digits) by default. So `@db.Timestamptz(6)` is correct. Actually, the default precision for timestamptz in Postgres is already 6 (microseconds), so I could just use `@db.Timestamptz` without specifying. But being explicit is better.

Actually, let me reconsider. In Prisma, `@db.Timestamptz(6)` - is this valid syntax? Let me think... Prisma supports `@db.Timestamptz(0)` through `@db.Timestamptz(6)`. The default when you just write `DateTime @db.Timestamptz` is precision 6. So I can either write `@db.Timestamptz` or `@db.Timestamptz(6)`. I'll use `@db.Timestamptz` for brevity since 6 is the default.

Wait, actually I'm not sure if bare `@db.Timestamptz` is valid without a precision argument. Let me just use `@db.Timestamptz(6)` to be safe and explicit.

Let me finalize. I think my schema is complete and correct. Let me review once more against the plan:

1. ✅ payment_orders - all fields match
2. ✅ events - all fields match  
3. ✅ workers - all fields match
4. ✅ operations - all fields match, two indexes specified
5. ✅ company_financial_totals - all fields match

Relations:
- ✅ payment_orders.worker_id → workers.id
- ✅ events.order_id → payment_orders.id
- ✅ operations.order_id → payment_orders.id (PK + FK)

Indexes:
- ✅ operations: (company_id, status, created_at DESC)
- ✅ operations: (company_id, created_at DESC)

Table names via @@map:
- ✅ payment_orders
- ✅ events
- ✅ workers
- ✅ operations
- ✅ company_financial_totals

Column names via @map:
- ✅ All snake_case columns

I'm satisfied with this. Let me write the final output.
```

## reply

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Worker {
  id        String @id @default(uuid()) @db.Uuid
  companyId String @map("company_id") @db.Uuid
  name      String
  role      String

  paymentOrders PaymentOrder[]

  @@map("workers")
}

model PaymentOrder {
  id        String   @id @default(uuid()) @db.Uuid
  companyId String   @map("company_id") @db.Uuid
  workerId  String   @map("worker_id") @db.Uuid
  status    String
  amount    Decimal  @db.Decimal(14, 2)
  currency  String   @db.Char(3)
  createdAt DateTime @map("created_at") @default(now()) @db.Timestamptz(6)
  updatedAt DateTime @map("updated_at") @default(now()) @db.Timestamptz(6)

  worker    Worker     @relation(fields: [workerId], references: [id])
  events    Event[]
  operation Operation?

  @@map("payment_orders")
}

model Event {
  id        String   @id @default(uuid()) @db.Uuid
  orderId   String   @map("order_id") @db.Uuid
  eventType String   @map("event_type")
  payload   Json     @default("{}")
  createdAt DateTime @map("created_at") @default(now()) @db.Timestamptz(6)

  paymentOrder PaymentOrder @relation(fields: [orderId], references: [id])

  @@map("events")
}

model Operation {
  orderId       String   @id @map("order_id") @db.Uuid
  companyId     String   @map("company_id") @db.Uuid
  status        String
  amount        Decimal  @db.Decimal(14, 2)
  currency      String   @db.Char(3)
  workerName    String   @map("worker_name")
  workerRole    String   @map("worker_role")
  lastEventType String?  @map("last_event_type")
  createdAt     DateTime @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime @map("updated_at") @db.Timestamptz(6)

  paymentOrder PaymentOrder @relation(fields: [orderId], references: [id])

  @@index([companyId, status, createdAt(sort: Desc)])
  @@index([companyId, createdAt(sort: Desc)])
  @@map("operations")
}

model CompanyFinancialTotal {
  companyId   String   @id @map("company_id") @db.Uuid
  totalAmount Decimal  @default(0) @map("total_amount") @db.Decimal(14, 2)
  orderCount  Int      @default(0) @map("order_count")
  updatedAt   DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  @@map("company_financial_totals")
}
```
