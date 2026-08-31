# 02-schema.prisma

## reasoning

```
The task is to write exactly one file: `prisma/schema.prisma`. According to the plan, this file should contain "Prisma models + indexes for operation_read_models."

Let me carefully read the plan:

**Data model:**

`operation_read_models` (projection, `@@map("operation_read_models")`)
- `id` `BigInt` `@id @default(autoincrement()) @map("id")` — surrogate key
- `order_id` `BigInt` `@unique @map("order_id")` — natural key, one row per order
- `company_id` `BigInt` `@map("company_id")`
- `worker_id` `BigInt?` `@map("worker_id")`
- `event_id` `BigInt?` `@map("event_id")`
- `status` `String` `@map("status")` — snapshot of order status
- `amount_cents` `BigInt` `@map("amount_cents")` — exact financial amount
- `currency` `String` `@map("currency")`
- `occurred_at` `DateTime` `@map("occurred_at")` — recency sort key
- `created_at` `DateTime` `@default(now()) @map("created_at")`
- `updated_at` `DateTime` `@updatedAt @map("updated_at")`

Indexes on `operation_read_models`:
- unique index on `order_id` (enforced by `@unique`)
- composite index `(company_id, status, occurred_at DESC, id DESC)` for dashboard filter+sort
- index on `occurred_at` for window re-derivation and drift repair

**Source tables (existing, read-only here):**
- `payment_orders` (`order_id`, `company_id`, `worker_id`, `event_id`, `status`, `amount_cents`, `currency`, `occurred_at`, ...)
- `events` (`event_id`, ...)
- `workers` (`worker_id`, ...)
- `companies` (`company_id`, ...)

Now, the question is: should I include the source tables in the schema? The plan says "the source tables `payment_orders`, `events`, `workers`, `companies` already exist and are owned by the write services; only add projection tables, do not modify source DDL."

Hmm. But the repository's `rederiveWindow` needs to read from source tables. If the Prisma schema doesn't include them, the repository can't query via Prisma (the plan says "zero raw SQL" at the service layer, but the repository is "the only layer that touches the database"). Wait — can the repository use raw SQL? The layering rules say "service holds logic. zero raw SQL, zero Prisma client calls." It doesn't forbid raw SQL at the repository layer. But the plan says the repository uses PrismaClient: `constructor(prisma: PrismaClient)`. And `rederiveWindow` is a repository method that reads source orders joined with events/workers.

Hmm, but the plan explicitly says about this file: "Prisma models + indexes for operation_read_models." The manifest line is: `prisma/schema.prisma | reads: - | Prisma models + indexes for operation_read_models`.

So the file should contain only the `operation_read_models` model. The source tables "already exist" — but in a real Prisma project, if the repository is to query them via Prisma, they'd need to be in the schema. However, the plan says "only add projection tables, do not modify source DDL" — meaning we shouldn't redefine them. The instructions say "implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan doesn't name."

The plan's data model section lists source tables as "existing, read-only here" — they're context, not part of what I create. The manifest description says "Prisma models + indexes for operation_read_models" (singular model). So I should write only the `operation_read_models` model.

But wait — if rederiveWindow reads source tables via Prisma, they'd need models in the schema. The plan's repository signature shows `rederiveWindow(window: DateWindow): Promise<number>`. How does it read source? Probably via `$queryRaw` in the repository (allowed since only service is forbidden from raw SQL). That's a defensible reading: the repository can use raw SQL for reading source tables it doesn't own. No, let me reconsider. The convention says "repository is the only layer that touches the database." It doesn't say repository must use Prisma models. The service has "zero raw SQL, zero Prisma client calls." So the repository can use `prisma.$queryRaw` for source reads. That resolves the tension: the schema only needs `operation_read_models`.

Actually, hmm, should I add an ASSUMPTION comment? The instructions say: "If a symbol you truly need is missing from both the plan and references, do not silently guess... write the file with the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

Is there a symbol missing here? The schema file itself is fully specified: model name, fields, types, attributes, indexes. The only ambiguity is whether to include source table models. The plan explicitly says not to modify source DDL and that the file is "Prisma models + indexes for operation_read_models." So the defensible reading is clear: only the projection model. No need for an ASSUMPTION comment about that... actually, hmm, is it "truly missing"? The plan addresses it: "only add projection tables, do not modify source DDL." So it's resolved. No assumption needed.

Now let me write the schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model OperationReadModel {
  id           BigInt   @id @default(autoincrement()) @map("id")
  orderId      BigInt   @unique @map("order_id")
  companyId    BigInt   @map("company_id")
  workerId     BigInt?  @map("worker_id")
  eventId      BigInt?  @map("event_id")
  status       String   @map("status")
  amountCents  BigInt   @map("amount_cents")
  currency     String   @map("currency")
  occurredAt   DateTime @map("occurred_at")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([companyId, status, occurredAt(sort: Desc), id(sort: Desc)], map: "idx_operations_company_status_recency")
  @@index([occurredAt], map: "idx_operations_occurred_at")
  @@map("operation_read_models")
}
```

Wait — the naming convention says "TS file: `kebab-case.role.ts`." Prisma model field names: the plan uses snake_case for the DB (`@map`) and camelCase in TS types (`orderId`, `companyId`). The plan's type is `OperationReadModel` with camelCase fields. So the model fields should be camelCase in Prisma with `@map` to snake_case. That matches the convention "tables and columns: snake_case (via Prisma `@map`/`@@map`)."

The plan writes fields as `order_id` `BigInt` `@unique @map("order_id")` — a bit ambiguous whether the Prisma field name is `orderId` or `order_id`. But the TS interface `OperationReadModel` uses `orderId`, `companyId`, etc. Prisma model field names must match what the TS code expects from the client (the repository returns `OperationReadModel`-shaped objects). So camelCase field names with `@map("order_id")` is correct.

Also, the plan says "unique index on `order_id` (enforced by `@unique`)" — so just `@unique`, no separate `@@unique`. Good.

Composite index with DESC: Prisma supports `sort: Desc` in indexes (since Prisma 4.x or so). `@@index([companyId, status, occurredAt(sort: Desc), id(sort: Desc)])`. This is valid Prisma.

Index naming: the convention doesn't explicitly specify index names, but giving them explicit `map` names is good practice. The plan doesn't name them. Should I add `map` names? "Do not add exports, features, or files that the plan doesn't name" — index names aren't features; the plan specifies three indexes. Giving them explicit names is defensible and standard. But to be safe, minimal: I could omit the `map` on indexes. Hmm. Prisma auto-generates names like `operation_read_models_company_id_status_occurred_at_id_idx`. Explicit naming is cleaner and doesn't contradict the plan. I'll include explicit `map` names — it's within the scope of "indexes" specified. Actually, let me think about whether this is over-engineering. The discipline says "do exactly what the task asks." Naming indexes is a normal part of writing DDL with appropriate indexes. I'll keep it.

Should I include `generator client` and `datasource db` blocks? A Prisma schema file needs a datasource to be valid. The environment section says `DATABASE_URL` for Postgres, config from env vars only. So:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

And the generator block is standard. The plan says "TypeScript + NestJS + Prisma + Postgres," so the generator is `prisma-client-js`. These blocks are necessary for a complete schema file — "write it completely, from the first line to the last." A schema without datasource is invalid. So I'll include them.

Now, about `BigInt` and Prisma: Postgres `BigInt` maps to `bigint`. Good — the plan says exact integer `amount_cents` (Postgres `bigint`).

One consideration: should the model include relations to source tables? The plan doesn't specify any relation fields. No relations. Keep it flat.

Also, the plan's type has `OperationReadModel` with all these fields — matches.

Double-checking the index list:
1. unique on `order_id` → `@unique` on field ✓
2. composite `(company_id, status, occurred_at DESC, id DESC)` → `@@index([companyId, status, occurredAt(sort: Desc), id(sort: Desc)])` ✓
3. index on `occurred_at` → `@@index([occurredAt])` ✓

Field order: I'll follow the plan's order.

Let me also think about whether `status` should be an enum. The plan says `String`. Keep it String.

Should I add `///` doc comments? The convention says code and comments in English. Short comments are fine but not required. I'll add minimal comments where they help (e.g., marking it as a projection). Actually, the discipline says don't add things not asked for; comments are harmless and aid readability. I'll keep it very light — maybe one comment on the model and one on the composite index. Hmm, "do not improve code that wasn't asked to be changed" — this is new code. Light comments are fine. I'll include a couple of brief ones.

Final file:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Denormalized read model for the operations dashboard: one row per payment
// order, maintained synchronously by the write path and repaired by drift jobs.
model OperationReadModel {
  id          BigInt   @id @default(autoincrement()) @map("id")
  orderId     BigInt   @unique @map("order_id")
  companyId   BigInt   @map("company_id")
  workerId    BigInt?  @map("worker_id")
  eventId     BigInt?  @map("event_id")
  status      String   @map("status")
  amountCents BigInt   @map("amount_cents")
  currency    String   @map("currency")
  occurredAt  DateTime @map("occurred_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  // Dashboard filter + sort: company, status, recency (stable tie-break on id).
  @@index([companyId, status, occurredAt(sort: Desc), id(sort: Desc)], map: "operation_read_models_company_status_recency_idx")
  // Date-window re-derivation and drift repair scan by occurred_at.
  @@index([occurredAt], map: "operation_read_models_occurred_at_idx")

  @@map("operation_read_models")
}
```

Wait — is `sort: Desc` valid in `@@index`? Yes, Prisma supports field sort order in indexes: `@@index([fieldA(sort: Desc)])` — supported since Prisma 4.16 or so (actually, index sort order was added in Prisma 4.x). It's valid in modern Prisma. Node 20+, current Prisma — no problem.

Hmm, one more check: the plan says "unique index on `order_id` (enforced by `@unique`)." When you put `@unique` on a field, Prisma creates a unique index. Good.

Should the datasource name be `db`? Standard convention, and the repository would use `PrismaClient` (default). No problem.

The generator provider: "prisma-client-js" is the standard for ESM NestJS apps. The newer `prisma-client` generator (v5+) outputs to a directory, but "prisma-client-js" is the safe, widely-used default. The plan doesn't specify. I'll use "prisma-client-js."

I think this is complete and matches the plan exactly. No ASSUMPTION comments needed — everything I need is in the plan.

Format: reply with the complete contents inside a single fenced block, nothing else.
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

// Denormalized read model for the operations dashboard: one row per payment
// order (order + event + worker joined), maintained synchronously by the write
// path and re-derived over date windows by the drift-repair job.
model OperationReadModel {
  id          BigInt   @id @default(autoincrement()) @map("id")
  orderId     BigInt   @unique @map("order_id")
  companyId   BigInt   @map("company_id")
  workerId    BigInt?  @map("worker_id")
  eventId     BigInt?  @map("event_id")
  status      String   @map("status")
  amountCents BigInt   @map("amount_cents")
  currency    String   @map("currency")
  occurredAt  DateTime @map("occurred_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  // Dashboard filter + sort: company, status, recency with a stable tie-break on id.
  @@index([companyId, status, occurredAt(sort: Desc), id(sort: Desc)], map: "operation_read_models_company_status_recency_idx")
  // Date-window re-derivation and drift repair scan by occurred_at.
  @@index([occurredAt], map: "operation_read_models_occurred_at_idx")

  @@map("operation_read_models")
}
```
