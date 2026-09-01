# 01-schema.prisma

## reasoning

```
The user is asking for the creation of a single file: `prisma/schema.prisma`. This must implement exactly what PLAN.md specifies for this file. That is: "Complete Prisma schema: source tables, projection tables, enum, indexes".

Let me go through PLAN.md carefully to extract everything needed.

**Generator and datasource blocks** — the plan doesn't explicitly state these, but a Prisma schema requires `datasource` and `generator`. The plan states PostgreSQL as the database, with `DATABASE_URL` from environment variables (via the "Environment" convention). So I should include:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

This is defensible and required for a working schema. The environment convention says `DATABASE_URL` is for Postgres. This isn't guessing at symbols — it's a standard requirement for the file to be complete.

**Enum:**

```prisma
enum OrderStatus {
  pending
  approved
  rejected
}
```

Plan: "enum: `pending`, `approved`, `rejected`". The enum block shown is exactly that.

**Source tables:**

**`payment_orders`** (`@@map("payment_orders")`):
- `id` | `String @id @default(uuid())` | PK
- `company_id` | `String @map("company_id")` | FK → companies (implicit)
- `worker_id` | `String @map("worker_id")` | FK → workers
- `event_id` | `String @map("event_id")` | FK → events
- `status` | `OrderStatus @default(pending)` | enum
- `amount_cents` | `Int @map("amount_cents")`
- `created_at` | `DateTime @default(now())`
- `updated_at` | `DateTime @updatedAt @map("updated_at")`

"FK → companies (implicit)" — hmm. The plan says there is no `companies` table in the schema. Source tables listed are only payment_orders, events, workers. "Implicit" FK means a column without an actual relation constraint? The plan says "FK → companies (implicit)" — i.e., there's no companies table, so it's just a column that references company conceptually. So I should NOT declare a relation to a non-existent model. Just the column `companyId String @map("company_id")`.

Similarly `worker_id` is "FK → workers" and there IS a workers table. Should I declare a Prisma relation? The plan says "Source tables (pre-existing, defined in schema for Prisma)" and "do not migrate them here". Declaring relations would be fine in the schema, but the plan doesn't specify relation fields (like `worker Worker @relation(...)`). The plan's column listing is exhaustive for each table. Adding relation scalar fields would be adding beyond the plan. The safest reading: just columns as listed, no Prisma relations. Since the plan only enumerates columns, and says for company "implicit" (meaning no actual table), consistency suggests worker/event refs are plain columns too. The dashboard query joins source tables for re-derivation, but that's done via raw fetch in the repository (per plan: "reads source tables; returns joined rows" — likely raw SQL or multiple queries). The plan says the repository is "the only layer that touches the database" and can use Prisma. Joined rows could be obtained via `$queryRaw` or nested queries. To keep the schema minimal and faithful to the plan, I'll go with plain columns without relations.

Hmm, but is that defensible? The plan table explicitly says "FK → workers" and "FK → events". In Prisma, an FK without a relation is just a column. The word "implicit" attached to companies hints that they deliberately did not create a companies model. If they wanted real Prisma relations, they'd have specified relation attributes. Also the "Discipline" instruction: "Implement exactly what the plan specifies for this file. Do not add exports, features, or files the plan does not name." Relations are schema features. I'll stick to plain columns. No `ASSUMPTION` comment needed since the plan's own table defines the column set exactly — I'm implementing what's written, not guessing. Actually wait — let me reconsider. The column list in the plan IS the spec for the schema. It lists exactly these columns and no relation fields. So implementing exactly those columns is faithful.

**`events`** (`@@map("events")`):
- `id` | `String @id @default(uuid())`
- `title` | `String`
- `location` | `String`
- `created_at` | `DateTime @default(now())`

**`workers`** (`@@map("workers")`):
- `id` | `String @id @default(uuid())`
- `name` | `String`
- `company_id` | `String @map("company_id")`
- `created_at` | `DateTime @default(now())`

**Projection tables:**

**`operation_read_models`** (`@@map("operation_read_models")`):
- `id` | `String @id` | Same UUID as source order — upsert key
- `company_id` | `String @map("company_id")`
- `worker_id` | `String @map("worker_id")`
- `worker_name` | `String @map("worker_name")`
- `event_id` | `String @map("event_id")`
- `event_title` | `String @map("event_title")`
- `event_location` | `String @map("event_location")`
- `status` | `OrderStatus` — note: no default specified. Should I add one? The plan says `status | OrderStatus | Mirrors source`. No `@default` mentioned. I'll leave it without a default. Hmm, but upsert requires all fields anyway. Leaving without default is faithful.
- `amount_cents` | `Int @map("amount_cents")`
- `created_at` | `DateTime @map("created_at")` | Sort key — no default (mirrors the source order's created_at).
- `updated_at` | `DateTime @updatedAt @map("updated_at")`

Indexes:
- `@@index([company_id, status, created_at(sort: Desc)])` — main dashboard query pattern.
- `@@index([company_id, created_at(sort: Desc)])` — company + date range without status filter.

Prisma syntax for index with sort order: `@@index([companyId, status, createdAt(sort: Desc)])`. Yes, Prisma supports `(sort: Desc)` inside indexes (for Postgres). The plan writes them in column mapping names but I should use field names: `companyId`, `status`, `createdAt`.

Should I name the indexes? The plan doesn't give names. I'll leave unnamed. Adding names would be an addition beyond the plan, though harmless. Discipline says do exactly what's asked — I'll leave unnamed.

**`company_financial_totals`** (`@@map("company_financial_totals")`):
- `company_id` | `String @id @map("company_id")` | PK — one row per company
- `approved_total_cents` | `BigInt @default(0) @map("approved_total_cents")`
- `rejected_total_cents` | `BigInt @default(0) @map("rejected_total_cents")`
- `pending_count` | `Int @default(0) @map("pending_count")`

"No additional indexes needed (PK lookup only)."

Now, field naming in Prisma: TS fields are camelCase with `@map("snake_case")`. The plan shows column types as, e.g., `String @id @default(uuid())` under the header `id`, and for mapped columns shows e.g. `companyId`? Actually looking at the plan's table: under "Column" it lists `company_id` with type `String @map("company_id")`. That's a bit odd — if the column is `company_id` and it maps to `company_id`, then the Prisma field name must be camelCase (`companyId`) because Prisma requires PascalCase/camelCase? Actually no — Prisma field names must be valid identifiers; camelCase is convention and `@@map` maps the *model* to a table name, while `@map` maps field to column. The plan's "Column" header lists DB column names, and the `@map("company_id")` in the type confirms the field name is camelCase (`companyId`) mapped to `company_id`. For `id`, no `@map` needed.

So the schema fields: `companyId String @map("company_id")`, etc. This matches the convention section: "Table and column: snake_case (via Prisma @map/@@map)".

BigInt default: `@default(0)` works for BigInt in Prisma. Yes.

`DateTime @updatedAt` — fine.

Now the datasource/generator: required for completeness. The convention says "Prisma as ORM, PostgreSQL as database", "DATABASE_URL". So:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
```

Order: conventionally generator first, then datasource. Either works.

Do I need an `ASSUMPTION` comment for the generator/datasource? The instructions say: "If a symbol you truly need is missing from both plan and reference, don't silently guess... mark with one `// ASSUMPTION:` comment." Generator/datasource are genuinely not in the plan, but they're universally required for any `schema.prisma` and fully determined by the stack conventions (Postgres + DATABASE_URL). I think this is "the most defensible reading" — should I mark it? The instruction says mark with an ASSUMPTION comment when you're forced to use the most defensible reading for something missing. The datasource URL variable name IS given by the convention ("DATABASE_URL is for Postgres"), and Postgres provider is given. The generator choice (`prisma-client-js`) is the only default in Prisma, standard for NestJS. I could add one `// ASSUMPTION:` comment on the generator block. But is it really "truly missing"? The task says the file must be a complete Prisma schema — one that can't exist without datasource/generator. I think a brief comment is safe and honest, but the discipline says don't add more than necessary; ASSUMPTION comments are explicitly sanctioned when something is unresolved. Let me judge: `prisma-client-js` vs `prisma-client` (new generator) — this is a real fork in recent Prisma versions. The convention says nothing. I'll add one ASSUMPTION comment on the generator line noting the choice of client generator. Actually, let me reconsider — would that be noise? The instruction says: "don't silently guess and don't work around it by reasoning: write the file using the most defensible reading and mark with one `// ASSUMPTION: <what was unresolved>` comment at the point where it matters." I'm using the most defensible reading for generator; marking it complies. One comment, one point. I'll include it.

For datasource: provider postgresql and env("DATABASE_URL") are both directly specified by the conventions. No assumption needed.

Now, should source tables be `@@map`? Yes: the plan explicitly shows `@@map("payment_orders")`, `@@map("events")`, `@@map("workers")`.

Model names: `PaymentOrder`? The plan doesn't specify model (class) names. Convention: "Class: PascalCase". Prisma models are the natural PascalCase of the table: `PaymentOrder`, `Event`, `Worker`, `OperationReadModel`, `CompanyFinancialTotal`. The plan refers to tables by snake_case names, and model names aren't given. PascalCase singular is the standard Prisma convention (Prisma recommends singular model names). This is a naming choice not in the plan — but any Prisma schema needs model names, and PascalCase singular of table name is the only defensible reading. Do I mark with ASSUMPTION? The instruction's spirit: mark when a *symbol* is truly missing. Model names are symbols... but these are mechanical conversions. I think one ASSUMPTION comment covering the generator is enough; for model names, converting `payment_orders` → `PaymentOrder` is not a guess, it's the standard. Hmm, but strictly, "Event" for `events` table, or "Events"? Singular is convention. I'll not clutter with assumptions; I think it's defensible without a comment. Actually, let me reconsider the instruction again: "If a symbol you truly need is missing from both plan and reference, don't silently guess and don't work around it by reasoning: write the file using the most defensible reading and mark with one `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

Safest compliant approach: use PascalCase singular model names (most defensible), and add a single ASSUMPTION comment. But where? "At the point where it matters." I could add one comment near the first model or at the top. But too many ASSUMPTION comments look like I'm uncertain. Let me count what's truly unresolved:

1. Generator provider (`prisma-client-js` vs `prisma-client`) — truly unresolved. Mark it.
2. Model names — mechanical PascalCase; the plan even uses "Class: PascalCase" convention. Not worth a comment... but it IS absent from the plan. Hmm.
3. Datasource name `db` — conventional default.
4. Whether to declare Prisma relations — I decided NO, following the plan's exhaustive column lists and "implicit" FK note. Actually wait, this IS a judgment call worth considering carefully. The plan says "FK → workers" and "FK → events" for payment_orders, "FK → companies (implicit)" for company_id. If I declare a relation `worker Worker @relation(fields: [workerId], references: [id])`, I'd need `@relation` attribute and a back-reference on the Worker model (`orders PaymentOrder[]`) — the plan doesn't list such fields on workers. So relations are not intended. Plain columns confirmed by the back-reference omission. Good — no comment needed; the plan's column lists are exhaustive and authoritative.

5. `status` on operation_read_models: with or without default? Plan lists it as just `OrderStatus` for projection, and `OrderStatus @default(pending)` for source. So no default on projection. Faithful.

Let me also double-check index syntax with sort: Prisma supports `@@index([companyId, status, createdAt(sort: Desc)])`. Yes.

Also should the composite index use mapped column names? No — Prisma uses field names in @@index.

One more: `@default(now())` for created_at, `@updatedAt` for updated_at — standard.

BigInt in Prisma with Postgres maps to bigint; default(0) is fine.

`pending_count Int @default(0)`.

Now let me structure the file:

```prisma
// ASSUMPTION: ... generator provider not specified in plan; using prisma-client-js.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderStatus {
  pending
  approved
  rejected
}

// Source tables (pre-existing domain; defined here for Prisma client typing)

model PaymentOrder {
  id           String      @id @default(uuid())
  companyId    String      @map("company_id")
  workerId     String      @map("worker_id")
  eventId      String      @map("event_id")
  status       OrderStatus @default(pending)
  amountCents  Int         @map("amount_cents")
  createdAt    DateTime    @default(now()) @map("created_at")
  updatedAt    DateTime    @updatedAt @map("updated_at")

  @@map("payment_orders")
}

model Event {
  id        String   @id @default(uuid())
  title     String
  location  String
  createdAt DateTime @default(now()) @map("created_at")

  @@map("events")
}

model Worker {
  id        String   @id @default(uuid())
  name      String
  companyId String   @map("company_id")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("workers")
}

// Projection tables

model OperationReadModel {
  id            String      @id
  companyId     String      @map("company_id")
  workerId      String      @map("worker_id")
  workerName    String      @map("worker_name")
  eventId       String      @map("event_id")
  eventTitle    String      @map("event_title")
  eventLocation String      @map("event_location")
  status        OrderStatus
  amountCents   Int         @map("amount_cents")
  createdAt     DateTime    @map("created_at")
  updatedAt     DateTime    @updatedAt @map("updated_at")

  @@index([companyId, status, createdAt(sort: Desc)])
  @@index([companyId, createdAt(sort: Desc)])
  @@map("operation_read_models")
}

model CompanyFinancialTotal {
  companyId          String @id @map("company_id")
  approvedTotalCents BigInt @default(0) @map("approved_total_cents")
  rejectedTotalCents BigInt @default(0) @map("rejected_total_cents")
  pendingCount       Int    @default(0) @map("pending_count")

  @@map("company_financial_totals")
}
```

Wait — comments: the convention says "Code and comments in English." Comments are fine. But discipline: don't add more than asked. Section header comments like `// Source tables` are harmless and reflect the plan's structure. I'll keep them minimal — maybe just leave in a couple of short section comments, or none at all. The plan itself labels "Source tables (pre-existing...)" and "Projection tables (new)". I'll keep brief comments mirroring that. It aids readability without being a feature.

Do I need the ASSUMPTION comment for generator? Let me think once more. The rule: mark with an ASSUMPTION when a symbol is truly missing and you're using the most defensible reading. The generator provider IS truly missing from plan and references. So per the instructions, I should mark it. One comment:

`// ASSUMPTION: plan does not pin a Prisma client generator; using the standard prisma-client-js provider.`

Placed at the generator block.

What about model names? The plan uses table names as identifiers throughout (e.g., `@@map("payment_orders")` suggests the model name is something else — otherwise why show the @@map? Well, `@@map` is shown for every model including e.g. operation_read_models; if model name were the same as table, `@@map` would be redundant but harmless. The convention mandates snake_case tables via @@map, which implies the model names differ from table names (camelCase/PascalCase). PascalCase singular is the only defensible reading. Is this "truly missing"? It's a naming detail derivable by standard convention, I'd argue; but to be maximally compliant, I could add one more ASSUMPTION comment... The instruction says "one // ASSUMPTION comment at the point where it matters" — per unresolved item. I think model naming is borderline; two comments (generator + model naming) are defensible, but I worry about over-marking. Let me re-read: "If a symbol you truly need is missing from both plan and reference, don't silently guess and don't work around it by reasoning: write the file using the most defensible reading and mark with one // ASSUMPTION: <what was unresolved> comment at the point where it matters."

The model names ARE symbols I truly need (Prisma requires model identifiers). They ARE missing from the plan (which only gives table names via @@map) and reference. So strictly, I should mark. Similarly `datasource db` name — trivial but also a symbol. The generator is in Prisma's own domain.

Hmm. Practical balance: I'll add one ASSUMPTION comment for the generator (most substantive), and one at the top or first model covering that model names follow PascalCase singular of table since the plan only specifies table names. That's honest and compliant without spamming. Actually — for the datasource block, `env("DATABASE_URL")` is fixed by convention; `provider = "postgresql"` fixed. The block name `db` is conventional default; I won't mark that (it's purely decorative and universally `db`). For model names, I'll mark once.

Where to put the model naming assumption? "At the point where it matters" — I'll put it just above the first model, or at the top of the schema after the enum. Maybe right before `model PaymentOrder`. But then it only covers that one... I'll phrase it generally: "ASSUMPTION: plan specifies table names (via @@map) but not Prisma model identifiers; using PascalCase singular of each table."

Two ASSUMPTION comments total. That feels right — the instruction anticipates per-point marking.

Hmm, actually, let me reconsider once more whether to include the generator assumption at all — could "prisma-client-js" be considered not an assumption but the obviously complete requirement? The instructions are quite explicit: missing symbol → most defensible reading + mark. I'll include both marks. It shows diligence and follows the letter of the instructions.

One more consideration: should `OperationReadModel.status` have a default? No (per plan). `createdAt` on OperationReadModel: no `@default(now())`, because it mirrors source order's createdAt and is set explicitly on upsert. Plan: "created_at | DateTime @map("created_at") | original created_at of order — sort key." No default listed → no default. Good.

For CompanyFinancialTotal, should there be a `@@index`? Plan says no. Good.

Also for the source tables: should `payment_orders` have indexes? The plan's "Indexes:" section only appears under the projection table (operation_read_models) and says for totals "No additional indexes needed." Source tables are pre-existing and not migrated here; no index listed → none.

Let me double-check the plan's index line: "`@@index([company_id, status, created_at(sort: Desc)])` — main dashboard query pattern." Translated to field names: `@@index([companyId, status, createdAt(sort: Desc)])`. Good.

Also double-check `@@map` for enum? No, OrderStatus values are lowercase and no mapping needed; plan's enum block shows plain values.

Field alignment/formatting: Prisma convention aligns types; I'll format cleanly with aligned columns.

One more check on `BigInt @default(0)`: valid in Prisma (bigint default must be a number, 0 is OK).

`@updatedAt` requires an initial default? No, `@updatedAt` auto-sets on create and update; no default needed.

ESM/`type: module` — irrelevant to schema.

OK, final file. Let me also consider whether to include comments at all besides assumptions. Short section comments reflecting the plan's sections are English, harmless, and improve readability. I'll include two short ones: `// Source tables (pre-existing; defined here for Prisma)` and `// Projection tables (maintained by write-path hooks, re-derivation and drift repair)`. Keep concise.

Actually, the discipline note: "Do exactly what the task asks. Don't create files it doesn't ask for and don't improve code you weren't asked to change." Comments in a file I'm creating are part of the file; minimal comments are fine.

Let me write out the final content, carefully aligning.

```prisma
// ASSUMPTION: The plan does not pin a Prisma client generator, so the standard
// prisma-client-js provider is used.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderStatus {
  pending
  approved
  rejected
}

// ASSUMPTION: The plan specifies only table names (via @@map), not Prisma model
// identifiers; model names below are the PascalCase singular of each table.

// Source tables (pre-existing domain; defined here so Prisma can type them)
model PaymentOrder {
  id          String      @id @default(uuid())
  companyId   String      @map("company_id")
  workerId    String      @map("worker_id")
  eventId     String      @map("event_id")
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt @map("updated_at")

  @@map("payment_orders")
}

model Event {
  id        String   @id @default(uuid())
  title     String
  location  String
  createdAt DateTime @default(now()) @map("created_at")

  @@map("events")
}

model Worker {
  id        String   @id @default(uuid())
  name      String
  companyId String   @map("company_id")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("workers")
}

// Projection tables (kept in sync by write-path hooks; rebuilt by re-derivation)
model OperationReadModel {
  id            String      @id
  companyId     String      @map("company_id")
  workerId      String      @map("worker_id")
  workerName    String      @map("worker_name")
  eventId       String      @map("event_id")
  eventTitle    String      @map("event_title")
  eventLocation String      @map("event_location")
  status        OrderStatus
  amountCents   Int         @map("amount_cents")
  createdAt     DateTime    @map("created_at")
  updatedAt     DateTime    @updatedAt @map("updated_at")

  @@index([companyId, status, createdAt(sort: Desc)])
  @@index([companyId, createdAt(sort: Desc)])
  @@map("operation_read_models")
}

model CompanyFinancialTotal {
  companyId          String @id @map("company_id")
  approvedTotalCents BigInt @default(0) @map("approved_total_cents")
  rejectedTotalCents BigInt @default(0) @map("rejected_total_cents")
  pendingCount       Int    @default(0) @map("pending_count")

  @@map("company_financial_totals")
}
```

Check the plan's projection "status" line once more: `| status | OrderStatus | Mirrors source |` — no default. ✓

Check the plan's `operation_read_models.id`: `String @id` (no default). ✓ "Same UUID as source order — upsert key" → provided by caller. ✓

Check `company_financial_totals.company_id`: `String @id @map("company_id")`. ✓

Check source `payment_orders.status`: `OrderStatus @default(pending)`. ✓

All columns present, no extras. Indexes only on OperationReadModel as specified. Enum exact.

Do I need `// ASSUMPTION` for the datasource URL? No — convention explicitly gives DATABASE_URL + Postgres.

Output format: "Reply with the complete contents of prisma/schema.prisma in a single fenced block, nothing else — no preamble or postscript."

So I output only the fenced code block. Fence language: `prisma` or so, or just triple backticks. I'll use ```prisma for clarity — acceptable as "a single fenced block".

Final check of trailing newline and completeness. Good.
```

## reply

```prisma
// ASSUMPTION: The plan does not pin a Prisma client generator, so the standard
// prisma-client-js provider is used.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderStatus {
  pending
  approved
  rejected
}

// ASSUMPTION: The plan specifies only table names (via @@map), not Prisma model
// identifiers; the model names below are the PascalCase singular of each table.

// Source tables (pre-existing domain; defined here so Prisma can type them)
model PaymentOrder {
  id          String      @id @default(uuid())
  companyId   String      @map("company_id")
  workerId    String      @map("worker_id")
  eventId     String      @map("event_id")
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt @map("updated_at")

  @@map("payment_orders")
}

model Event {
  id        String   @id @default(uuid())
  title     String
  location  String
  createdAt DateTime @default(now()) @map("created_at")

  @@map("events")
}

model Worker {
  id        String   @id @default(uuid())
  name      String
  companyId String   @map("company_id")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("workers")
}

// Projection tables (kept in sync by write-path hooks; rebuilt by re-derivation)
model OperationReadModel {
  id            String      @id
  companyId     String      @map("company_id")
  workerId      String      @map("worker_id")
  workerName    String      @map("worker_name")
  eventId       String      @map("event_id")
  eventTitle    String      @map("event_title")
  eventLocation String      @map("event_location")
  status        OrderStatus
  amountCents   Int         @map("amount_cents")
  createdAt     DateTime    @map("created_at")
  updatedAt     DateTime    @updatedAt @map("updated_at")

  @@index([companyId, status, createdAt(sort: Desc)])
  @@index([companyId, createdAt(sort: Desc)])
  @@map("operation_read_models")
}

model CompanyFinancialTotal {
  companyId          String @id @map("company_id")
  approvedTotalCents BigInt @default(0) @map("approved_total_cents")
  rejectedTotalCents BigInt @default(0) @map("rejected_total_cents")
  pendingCount       Int    @default(0) @map("pending_count")

  @@map("company_financial_totals")
}
```
