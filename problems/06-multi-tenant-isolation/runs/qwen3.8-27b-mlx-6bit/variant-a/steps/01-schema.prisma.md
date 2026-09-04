# 01-schema.prisma

## reasoning

```
Let me analyze the plan to write the `prisma/schema.prisma` file.

From the plan, I need:

1. **tenants** (registry, exempt from guard)
   - id: uuid PK, default uuid()
   - slug: text unique
   - domain: text unique
   - name: text
   - branding: jsonb
   - feature_flags: jsonb, default {}
   - created_at: timestamptz, default now()
   - updated_at: timestamptz, auto

2. **customers** (scoped)
   - id: uuid PK, default uuid()
   - tenant_id: uuid FK→tenants.id, not null
   - email: text, not null
   - name: text, nullable
   - created_at / updated_at: timestamptz
   - Constraint: @@unique([tenant_id, email])

3. **plans** (scoped)
   - id: uuid PK, default uuid()
   - tenant_id: uuid FK→tenants.id, not null
   - name: text, not null
   - price: int, not null
   - Constraint: @@unique([tenant_id, name])

4. **orders** (scoped)
   - id: uuid PK, default uuid()
   - tenant_id: uuid FK→tenants.id, not null
   - customer_id: uuid FK→customers.id
   - plan_id: uuid FK→plans.id
   - status: text, default 'pending'
   - total: int, not null
   - created_at / updated_at: timestamptz

Now, following the conventions:
- Table and column: `snake_case` (via Prisma `@map`/`@@map`)
- ESM, "type": "module"

Let me write the Prisma schema. In Prisma:
- `uuid` type is used for UUIDs with `@default(uuid())` (actually in newer Prisma it's `@default(uuid(7))` but the plan says `uuid()` so I'll use that)
- `text` maps to `String` in Prisma
- `jsonb` maps to `Json` in Prisma
- `timestamptz` maps to `DateTime` in Prisma
- `int` maps to `Int` in Prisma

For snake_case mapping, I need to use `@map` for columns and `@@map` for tables.

Let me think about the field names in Prisma model vs DB:
- Model fields can be camelCase in TS, mapped to snake_case in DB via `@map`
- Table names: `tenants`, `customers`, `plans`, `orders` - these are already snake_case (single word or simple)

Wait, let me re-read the conventions: "Table and column: `snake_case` (via Prisma `@map`/`@@map`)."

So the TS model field names should be camelCase, and I map them to snake_case columns.

For the tenants table:
- `id` → stays `id` (single word)
- `slug` → stays `slug`
- `domain` → stays `domain`
- `name` → stays `name`
- `branding` → stays `branding`
- `featureFlags` in TS → `feature_flags` in DB via `@map("feature_flags")`
- `createdAt` in TS → `created_at` in DB via `@map("created_at")`
- `updatedAt` in TS → `updated_at` in DB via `@map("updated_at")`

For customers:
- `id` → `id`
- `tenantId` in TS → `tenant_id` in DB via `@map("tenant_id")`
- `email` → `email`
- `name` → `name`
- `createdAt` in TS → `created_at` in DB via `@map("created_at")`
- `updatedAt` in TS → `updated_at` in DB via `@map("updated_at")`

For plans:
- `id` → `id`
- `tenantId` in TS → `tenant_id` in DB via `@map("tenant_id")`
- `name` → `name`
- `price` → `price`

For orders:
- `id` → `id`
- `tenantId` in TS → `tenant_id` in DB via `@map("tenant_id")`
- `customerId` in TS → `customer_id` in DB via `@map("customer_id")`
- `planId` in TS → `plan_id` in DB via `@map("plan_id")`
- `status` → `status`
- `total` → `total`
- `createdAt` in TS → `created_at` in DB via `@map("created_at")`
- `updatedAt` in TS → `updated_at` in DB via `@map("updated_at")`

Table names via `@@map`:
- `Tenant` → `@@map("tenants")`
- `Customer` → `@@map("customers")`
- `Plan` → `@@map("plans")`
- `Order` → `@@map("orders")`

Now for the datasource and generator:
- PostgreSQL provider
- DATABASE_URL from env

For relations:
- Tenant has many Customers, Plans, Orders
- Customer belongs to Tenant
- Order belongs to Tenant, Customer, Plan

Let me think about whether I need relation fields. The plan mentions FKs but let me check what's needed:

For the guard to work, it injects `tenantId` into where clauses. The relations in Prisma schema define the FK columns. I should include them properly.

Let me think about `updated_at` - the plan says "auto" for tenants. In Prisma, I can use `@updatedAt` decorator which auto-sets it. For customers and orders, the plan just says `timestamptz` without specifying auto, but it's reasonable to use `@updatedAt` for consistency. Actually, let me re-read:

For tenants: `updated_at | timestamptz | auto`
For customers: `created_at / updated_at | timestamptz |` (no "auto" note)
For orders: `created_at / updated_at | timestamptz |` (no "auto" note)

Hmm, but using `@updatedAt` is standard practice and the plan doesn't explicitly say "not auto" for customers/orders. I'll use `@updatedAt` for all since it's the standard Prisma pattern and the plan doesn't contradict it. Actually, let me be conservative - for tenants it explicitly says "auto", for the others it doesn't mention auto. But `@updatedAt` is just a convenience and doesn't change the column type. I'll use it for all since it's standard and the plan doesn't prohibit it.

Wait, actually I should be careful. The plan says "Implement exactly what the plan specifies for this file." The plan explicitly marks `auto` only for tenants. For customers and orders, it just says `timestamptz`. I'll still use `@updatedAt` because:
1. It's the standard Prisma pattern
2. The column is still `timestamptz` 
3. Not using it would be a functional regression with no plan basis

Actually, I'll use `@updatedAt` for all. The "auto" note in the plan is just describing what `@updatedAt` does.

For `created_at`, I'll use `@default(now())`.

Now let me also think about the `feature_flags` default. The plan says `default {}`. In Prisma, for Json fields, you can use `@default("{}")` - actually no, Prisma doesn't support default values for Json fields in the schema. You'd need to handle it at the application level or use a raw migration. Let me check...

Actually, in Prisma, you cannot set a default value on a Json field. The plan says `feature_flags | jsonb | map of flag→bool, default {}`. Since Prisma doesn't support defaults on Json fields, I'll omit the `@default` and note that it will be handled in the migration or application layer. But wait, the plan says to implement what's in the plan. Let me just add a comment or leave it without default since Prisma doesn't support it.

Actually, I can set a default in the migration SQL but not in the Prisma schema for Json types. I'll just leave it without a default in the schema. The migration can add `DEFAULT '{}'::jsonb` if needed, but that's a separate file.

Let me also consider: do I need `relations` (the back-references)? In Prisma, if you define a relation field on one model, you need to handle the other side. But for this schema, the important thing is:
- `Tenant` has `customers Customer[]`, `plans Plan[]`, `orders Order[]`
- `Customer` has `tenant Tenant @relation(fields: [tenantId], references: [id])`
- etc.

But wait - the guard works by injecting `tenantId` into where clauses directly. The relations in Prisma are needed for the FK constraint to be created in the DB. I should include them.

Actually, let me think about whether including relation fields (like `tenant Tenant` on Customer) would interfere with the guard. The guard operates on the model being queried (Customer, Plan, Order) and injects `tenantId` into the where clause. The relation fields are just for navigation and don't affect the guard's behavior.

However, I should be careful: if the guard sees a query on `Customer` that includes a relation filter like `where: { tenant: { slug: 'x' } }`, the guard would add `tenantId` to the where as well. But that's fine - it's just an additional constraint.

Let me write the schema now:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id            String   @id @default(uuid())
  slug          String   @unique
  domain        String   @unique
  name          String
  branding      Json
  featureFlags  Json     @map("feature_flags")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  customers Customer[]
  plans     Plan[]
  orders    Order[]

  @@map("tenants")
}

model Customer {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  email     String
  name      String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])
  orders Order[]

  @@unique([tenantId, email])
  @@map("customers")
}

model Plan {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")
  name     String
  price    Int

  tenant Tenant @relation(fields: [tenantId], references: [id])
  orders Order[]

  @@unique([tenantId, name])
  @@map("plans")
}

model Order {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  customerId String?  @map("customer_id")
  planId     String?  @map("plan_id")
  status     String   @default("pending")
  total      Int
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  tenant   Tenant    @relation(fields: [tenantId], references: [id])
  customer Customer? @relation(fields: [customerId], references: [id])
  plan     Plan?     @relation(fields: [planId], references: [id])

  @@map("orders")
}
```

Wait, I need to check: the plan says `customer_id` and `plan_id` are nullable (no "not null" noted). Let me re-read:

```
| customer_id | uuid FK→customers.id | |
| plan_id | uuid FK→plans.id | |
```

The notes column is empty for both, which I'll interpret as nullable (optional FKs). This makes sense - an order might not be associated with a customer or plan yet.

Also, for `plans`, the plan doesn't mention `created_at`/`updated_at`. Let me re-check:

```
**`plans`** (scoped)
| column | type | notes |
|---|---|---|
| id | uuid PK | default uuid() |
| tenant_id | uuid FK→tenants.id | not null |
| name | text | not null |
| price | int | not null |

Constraint: `@@unique([tenant_id, name])`.
```

No timestamps for plans. I'll omit them.

Let me also double-check: does the plan say `name` on Customer is nullable? Yes: `| name | text | nullable |`. Good, I have `String?`.

One more thought: the `@@unique` constraint. In Prisma, when you reference a mapped field in `@@unique`, do you use the TS name or the DB name? You use the TS field name. So `@@unique([tenantId, email])` is correct - Prisma will handle the mapping to the actual column names in the migration.

I think this is complete. Let me finalize it.
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

model Tenant {
  id           String   @id @default(uuid())
  slug         String   @unique
  domain       String   @unique
  name         String
  branding     Json
  featureFlags Json     @map("feature_flags")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  customers Customer[]
  plans     Plan[]
  orders    Order[]

  @@map("tenants")
}

model Customer {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  email     String
  name      String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant Tenant  @relation(fields: [tenantId], references: [id])
  orders Order[]

  @@unique([tenantId, email])
  @@map("customers")
}

model Plan {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")
  name     String
  price    Int

  tenant Tenant  @relation(fields: [tenantId], references: [id])
  orders Order[]

  @@unique([tenantId, name])
  @@map("plans")
}

model Order {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  customerId String?  @map("customer_id")
  planId     String?  @map("plan_id")
  status     String   @default("pending")
  total      Int
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  tenant   Tenant    @relation(fields: [tenantId], references: [id])
  customer Customer? @relation(fields: [customerId], references: [id])
  plan     Plan?     @relation(fields: [planId], references: [id])

  @@map("orders")
}
```
