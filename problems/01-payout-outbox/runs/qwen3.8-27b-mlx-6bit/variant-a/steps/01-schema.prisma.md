# 01-schema.prisma

## reasoning

```
Let me analyze the PLAN.md to determine what the Prisma schema should contain.

From the plan, I need four models:

1. **accounts**
   - id: uuid (pk)
   - balance: bigint
   - created_at: timestamptz

2. **payouts**
   - id: uuid (pk)
   - account_id: uuid (fk → accounts.id)
   - amount: bigint
   - destination_address: text
   - idempotency_key: text
   - status: text (one of: created, processing, sent, completed, failed, needs_review)
   - tx_hash: text? (nullable)
   - created_at: timestamptz
   - updated_at: timestamptz
   - Unique constraint: (account_id, idempotency_key)

3. **outbox_messages**
   - id: uuid (pk)
   - payout_id: uuid (fk → payouts.id, unique)
   - payload: jsonb
   - status: text (pending, processing, done)
   - attempts: int
   - next_attempt_at: timestamptz? (nullable)
   - last_error: text? (nullable)
   - created_at: timestamptz
   - updated_at: timestamptz

4. **ledger_entries**
   - id: uuid (pk)
   - account_id: uuid (fk → accounts.id)
   - debit: bigint
   - credit: bigint
   - reference_type: text (deposit or payout)
   - reference_id: uuid? (nullable)
   - created_at: timestamptz

Now let me think about the conventions:
- Table and column names are `snake_case` via Prisma `@map`/`@@map`.
- The stack is PostgreSQL.
- ESM, `"type": "module"`.

For Prisma:
- datasource: postgresql, env("DATABASE_URL")
- generator: client

Let me think about the naming convention. The convention says "Table and column: `snake_case` (via Prisma `@map`/`@@map`)". So the model names can be PascalCase but the table names should be snake_case via `@@map`. Column fields in the model can be camelCase but mapped to snake_case via `@map`.

Let me write this out:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id        String   @id @default(uuid()) @map("id")
  balance   BigInt   @map("balance")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("accounts")
}
```

Wait, the column is `id` which is already snake_case (single word). Do I still need `@map("id")`? It's redundant but the convention says to use `@map`/`@@map`. Let me just be consistent and add it where the field name differs, or actually the convention says "via Prisma `@map`/`@@map`" meaning we use those to ensure snake_case. If the field is already snake_case (like `id`, `balance`), no mapping needed. But for multi-word fields like `createdAt`, we need `@map("created_at")`.

Actually, let me re-read: "Table and column: `snake_case` (via Prisma `@map`/`@@map`)". This means the actual DB columns must be snake_case, and we achieve that through `@map`/`@@map`. So if my field is `createdAt`, I map it to `created_at`. If my field is `id`, it's already `id` in the DB, so no mapping needed. But I could still add `@map("id")` for clarity - actually no, that would be noise. Let me only add `@map` where the names differ.

Wait, but what about the field naming? In TypeScript/Prisma convention, fields are typically camelCase. So `createdAt` → `@map("created_at")`. Single-word fields like `id`, `balance`, `amount` don't need mapping.

Let me also think about the UUID. In Prisma for PostgreSQL, I can use `@default(uuid())` for auto-generated UUIDs (v4).

For BigInt, Prisma uses `BigInt` type.
For DateTime with timestamptz, Prisma uses `DateTime` type (which maps to `timestamptz` in PostgreSQL by default... actually no, Prisma maps DateTime to `timestamp(3)` by default in PostgreSQL. For `timestamptz`, I need to check... Actually in newer Prisma versions, DateTime maps to `timestamp(3)` not `timestamptz`. To get `timestamptz`, I might need to use a custom mapping or just accept the default. But the plan says `timestamptz`.

Hmm, actually looking at this more carefully - in Prisma for PostgreSQL, `DateTime` maps to `timestamp(3)` (without timezone). There's no built-in `Timestamptz` type in Prisma. However, many projects just use `DateTime` and it works fine for most purposes. The plan says `timestamptz` but Prisma doesn't natively support that distinction. I'll use `DateTime` which is the standard Prisma approach, and this is a reasonable interpretation.

Actually wait - I should check if there's a way to do this. In Prisma, you can't directly specify `timestamptz`. The standard approach is to use `DateTime` and it maps to `timestamp(3)`. For this task, I'll use `DateTime` as that's what Prisma supports natively. The plan's mention of `timestamptz` is describing the intent, and `DateTime` is the Prisma equivalent.

Let me also think about the `payload` field in outbox_messages. The plan says `jsonb`. In Prisma for PostgreSQL, the type is `Json`.

Now let me write the full schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id        String   @id @default(uuid())
  balance   BigInt
  createdAt DateTime @default(now()) @map("created_at")

  @@map("accounts")
}

model Payout {
  id                String    @id @default(uuid())
  accountId         String    @map("account_id")
  amount            BigInt
  destinationAddress String   @map("destination_address")
  idempotencyKey    String    @map("idempotency_key")
  status            String
  txHash            String?   @map("tx_hash")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @default(now()) @updatedAt @map("updated_at")

  account Account @relation(fields: [accountId], references: [id])

  @@unique([accountId, idempotencyKey])
  @@map("payouts")
}

model OutboxMessage {
  id            String    @id @default(uuid())
  payoutId      String    @unique @map("payout_id")
  payload       Json
  status        String
  attempts      Int       @default(0)
  nextAttemptAt DateTime? @map("next_attempt_at")
  lastError     String?   @map("last_error")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @default(now()) @updatedAt @map("updated_at")

  payout Payout @relation(fields: [payoutId], references: [id])

  @@map("outbox_messages")
}

model LedgerEntry {
  id            String   @id @default(uuid())
  accountId     String   @map("account_id")
  debit         BigInt   @default(0)
  credit        BigInt   @default(0)
  referenceType String   @map("reference_type")
  referenceId   String?  @map("reference_id")
  createdAt     DateTime @default(now()) @map("created_at")

  account Account @relation(fields: [accountId], references: [id])

  @@map("ledger_entries")
}
```

Wait, I need to think about the relations. The plan says:
- payouts.account_id → accounts.id (fk)
- outbox_messages.payout_id → payouts.id (unique, fk)
- ledger_entries.account_id → accounts.id (fk)

So I need relations defined on the Account model as well for the inverse:

```prisma
model Account {
  id        String   @id @default(uuid())
  balance   BigInt
  createdAt DateTime @default(now()) @map("created_at")

  payouts       Payout[]
  ledgerEntries LedgerEntry[]

  @@map("accounts")
}
```

And Payout needs:
```prisma
  outboxMessage OutboxMessage? // one-to-one since payout_id is unique
```

Let me also reconsider the `reference_id` field. The plan says it's `uuid?`. In Prisma, UUID is stored as String. So `String?` is correct for a nullable UUID.

Let me also double-check: the plan says `attempts` starts at 0. I'll add `@default(0)`.

For `debit` and `credit`, the plan says they're bigint with 0 when not applicable. I'll add `@default(0)`.

Let me finalize the schema now. I think my draft is solid. Let me clean it up and make sure everything aligns with the plan.

One more thing - should I add `@map("id")` for the id fields? Since `id` is already a single word and the same in both camelCase and snake_case, it's not strictly necessary. I'll omit it for cleanliness.

Actually, re-reading the conventions: "Table and column: `snake_case` (via Prisma `@map`/`@@map`)". This just means the final DB names must be snake_case. For single-word columns like `id`, `balance`, `amount`, `status`, `attempts` - they're already snake_case so no mapping needed. For multi-word like `created_at`, `account_id` - we need `@map`.

I'm satisfied with my schema. Let me write the final version.
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

model Account {
  id        String   @id @default(uuid())
  balance   BigInt
  createdAt DateTime @default(now()) @map("created_at")

  payouts       Payout[]
  ledgerEntries LedgerEntry[]

  @@map("accounts")
}

model Payout {
  id                 String   @id @default(uuid())
  accountId          String   @map("account_id")
  amount             BigInt
  destinationAddress String   @map("destination_address")
  idempotencyKey     String   @map("idempotency_key")
  status             String
  txHash             String?  @map("tx_hash")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @default(now()) @updatedAt @map("updated_at")

  account       Account         @relation(fields: [accountId], references: [id])
  outboxMessage OutboxMessage?

  @@unique([accountId, idempotencyKey])
  @@map("payouts")
}

model OutboxMessage {
  id            String    @id @default(uuid())
  payoutId      String    @unique @map("payout_id")
  payload       Json
  status        String
  attempts      Int       @default(0)
  nextAttemptAt DateTime? @map("next_attempt_at")
  lastError     String?   @map("last_error")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @default(now()) @updatedAt @map("updated_at")

  payout Payout @relation(fields: [payoutId], references: [id])

  @@map("outbox_messages")
}

model LedgerEntry {
  id            String   @id @default(uuid())
  accountId     String   @map("account_id")
  debit         BigInt   @default(0)
  credit        BigInt   @default(0)
  referenceType String   @map("reference_type")
  referenceId   String?  @map("reference_id")
  createdAt     DateTime @default(now()) @map("created_at")

  account Account @relation(fields: [accountId], references: [id])

  @@map("ledger_entries")
}
```
