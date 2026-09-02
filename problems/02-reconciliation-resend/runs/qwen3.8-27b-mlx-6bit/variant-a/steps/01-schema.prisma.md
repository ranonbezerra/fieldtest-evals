# 01-schema.prisma

## reasoning

```
The user wants me to write the `prisma/schema.prisma` file based on the PLAN.md specification.

From the plan, I need:

1. **Orders table** (`@@map("orders")`):
   - `id` - String @id @default(cuid())
   - `amount_cents` - Int @map("amount_cents")
   - `bank_key` - String @map("bank_key")
   - `status` - OrderStatus @default(pending) - wait, the enum values are PENDING, IN_FLIGHT, SETTLED, REJECTED, PARKED. The default should be `PENDING`.
   - `attempts` - Int @default(0) @map("attempts")
   - `txid` - String? @map("txid")
   - `effective_date` - DateTime @map("effective_date")
   - `created_at` - DateTime @default(now()) @map("created_at")
   - `updated_at` - DateTime @updatedAt @map("updated_at")

2. **Enum** `OrderStatus` (`@map("order_status")`):
   - PENDING
   - IN_FLIGHT
   - SETTLED
   - REJECTED
   - PARKED

3. **Indexes**: 
   - `(status, effectiveDate)` for send/reconcile scans
   - unique on `txid` where non-null

Wait, let me check the Prisma syntax for these:

- The enum in Prisma uses `enum` keyword. The `@map` on the enum maps it to a DB-level name.
- For the `status` field, the default would be `@default(PENDING)` since the enum value is `PENDING`.
- For unique on `txid` where non-null: Prisma doesn't support partial/conditional unique indexes directly in the schema. However, we can use `@unique` on the field, but that would require it to be non-null. Since `txid` is nullable (`String?`), we need a different approach.

Actually, in Prisma, you can't have a `@unique` on a nullable field that only applies when non-null in a standard way. But in PostgreSQL, you can have a unique index that allows multiple NULLs. Prisma's `@unique` on a nullable field in PostgreSQL actually does allow multiple NULLs (PostgreSQL treats NULL != NULL for unique constraints). So `@unique` on a nullable String field should work fine in PostgreSQL.

Wait, let me reconsider. In PostgreSQL, a UNIQUE constraint allows multiple NULL values. So if I put `@unique` on `txid String?`, it will create a UNIQUE index that allows multiple NULLs. That's exactly what we want.

Actually, looking more carefully at Prisma documentation: `@unique` on a nullable field - in PostgreSQL this creates a unique index that permits multiple NULLs. So that's correct.

Let me also think about the datasource and generator:
- PostgreSQL datasource
- The `DATABASE_URL` environment variable (from the conventions)
- Prisma client generator

Let me write the schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderStatus {
  PENDING
  IN_FLIGHT
  SETTLED
  REJECTED
  PARKED

  @@map("order_status")
}

model Order {
  id             String      @id @default(cuid())
  amountCents    Int         @map("amount_cents")
  bankKey        String      @map("bank_key")
  status         OrderStatus @default(PENDING)
  attempts       Int         @default(0)
  txid           String?     @unique @map("txid")
  effectiveDate  DateTime    @map("effective_date")
  createdAt      DateTime    @default(now()) @map("created_at")
  updatedAt      DateTime    @updatedAt @map("updated_at")

  @@index([status, effectiveDate])
  @@map("orders")
}
```

Wait, the plan says "unique on `txid` where non-null". Let me use `@unique` which in PostgreSQL allows multiple NULLs. That should be sufficient.

Let me double-check the naming conventions:
- Table and column: `snake_case` (via Prisma `@map`/`@@map`) ✓
- The model name is `Order` (PascalCase) ✓
- Fields are camelCase with @map to snake_case ✓

The plan says the model is called `orders` in the table, but the Prisma model name should be `Order` (singular, PascalCase as per naming conventions: "Class: PascalCase").

Let me verify all fields match the plan exactly:
- `id` → `id` (no @map needed since it's already snake_case... well, it's a single word)
- `amountCents` → `@map("amount_cents")` ✓
- `bankKey` → `@map("bank_key")` ✓
- `status` → no @map needed (single word, already lowercase)
- `attempts` → no @map needed (single word)
- `txid` → `@map("txid")` - well, it's already the same, but the plan explicitly shows `@map("txid")`. Actually, since the field name and column name are the same, we don't need @map. But the plan shows it. Let me include it for clarity per the plan.

Actually, looking at the plan again: `txid` | `txid` | `String? @map("txid")`. The plan explicitly includes `@map("txid")` even though it's redundant. I'll include it to match the plan exactly.

Similarly for `attempts`: the plan shows `Int @default(0)` without a @map. Since it's a single word, no mapping needed.

For `status`: the plan shows `OrderStatus @default(pending)` - wait, it says `@default(pending)` with lowercase. But in Prisma, enum defaults use the enum value name which is uppercase: `@default(PENDING)`. The plan's table shows the value as "pending" in a description column, but the actual Prisma syntax needs `PENDING`.

Let me re-read: "status | OrderStatus @default(pending)" - this is in the plan's table format. The actual Prisma code would be `@default(PENDING)`.

I think my schema is correct. Let me finalize it.
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

enum OrderStatus {
  PENDING
  IN_FLIGHT
  SETTLED
  REJECTED
  PARKED

  @@map("order_status")
}

model Order {
  id            String      @id @default(cuid())
  amountCents   Int         @map("amount_cents")
  bankKey       String      @map("bank_key")
  status        OrderStatus @default(PENDING)
  attempts      Int         @default(0)
  txid          String?     @unique @map("txid")
  effectiveDate DateTime    @map("effective_date")
  createdAt     DateTime    @default(now()) @map("created_at")
  updatedAt     DateTime    @updatedAt @map("updated_at")

  @@index([status, effectiveDate])
  @@map("orders")
}
```
