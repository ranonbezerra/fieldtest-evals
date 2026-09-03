# 01-schema.prisma

## reasoning

```
The task is to write the `prisma/schema.prisma` file based on the PLAN.md specification.

From the plan, the data model is:

Single table `document_anchors` (`@@map("document_anchors")`):

| Column (TS / DB) | Type | Notes |
|---|---|---|
| `id` / `id` | `uuid`, PK, default `gen_random_uuid()` | |
| `documentId` / `document_id` | `text` | |
| `version` / `version` | `int` | |
| `contentHash` / `content_hash` | `text` | 64-char lowercase hex SHA-256 |
| `txId` / `tx_id` | `text` | from `prepare()` |
| `signedTx` / `signed_tx` | `text` | from `prepare()` |
| `status` / `status` | `text`, one of: `pending`, `broadcast`, `confirmed`, `failed` | default `pending` |
| `blockNumber` / `block_number` | `bigint`, nullable | set on confirmation |
| `blockHash` / `block_hash` | `text`, nullable | set on confirmation |
| `failureReason` / `failure_reason` | `text`, nullable | set on `failed` |
| `createdAt` / `created_at` | `timestamptz`, default `now()` | |
| `updatedAt` / `updated_at` | `timestamptz`, default `now()`, updated on write | |

Constraints:
- `@@unique([documentId, version])` — schema-level guarantee of exactly one anchor per (document, version).
- `@@index([status])` — worker queries by status.

Let me write the Prisma schema:

- Generator: prisma-client-js
- Datasource: postgresql, env("DATABASE_URL")

For the status field, the plan says `text` with one of four values. In Prisma, I can use a String field with a default value "pending". The plan doesn't specify using an enum type in the database — it says `text`. I'll use `String` with `@default("pending")`.

For `updatedAt`, the plan says "updated on write". Prisma supports `@updatedAt` which auto-updates. That's the cleanest way.

Let me write it:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model DocumentAnchor {
  id            String    @id @default(uuid()) @map("id")
  documentId    String    @map("document_id")
  version       Int       @map("version")
  contentHash   String    @map("content_hash")
  txId          String    @map("tx_id")
  signedTx      String    @map("signed_tx")
  status        String    @default("pending") @map("status")
  blockNumber   BigInt?   @map("block_number")
  blockHash     String?   @map("block_hash")
  failureReason String?   @map("failure_reason")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @default(now()) @updatedAt @map("updated_at")

  @@unique([documentId, version])
  @@index([status])
  @@map("document_anchors")
}
```

Wait, the plan says `gen_random_uuid()` for the default. In Prisma, `@default(uuid())` generates a UUID v4 client-side. If the plan specifically says `gen_random_uuid()`, that's a Postgres function. However, in Prisma, to use a database-level default with a raw SQL expression, you'd need `@default(dbgenerated("gen_random_uuid()))` — but that's only for certain types and is a bit awkward.

Actually, looking more carefully: the plan says `uuid`, PK, default `gen_random_uuid()`. In Prisma with PostgreSQL, `@default(uuid())` is the standard way. The plan mentions `gen_random_uuid()` which is the Postgres built-in. But in practice, Prisma's `@default(uuid())` will work fine and is the idiomatic way. The plan's mention of `gen_random_uuid()` is likely just describing the mechanism (generating a UUID) rather than mandating the exact SQL function.

I'll go with `@default(uuid())` which is the Prisma-idiomatic way to generate UUIDs. This is the most defensible reading.

Actually, let me reconsider. The plan says the type is `uuid`. In Prisma with PostgreSQL, the `String` type maps to `text` by default. To get a `uuid` column type in PostgreSQL, I should use `@db.Uuid`. Let me check...

Actually, in Prisma:
- `String` → `text` by default in PostgreSQL
- To get `uuid` type in the database, you need `String @default(uuid()) @db.Uuid`

Wait, actually if you just use `@default(uuid())`, Prisma will generate a UUID in the application and insert it as text. The column type would still be `text` unless you explicitly specify `@db.Uuid`.

The plan says the column type is `uuid`. So I should use `@db.Uuid` to ensure the database column is actually `uuid` type.

Let me finalize:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model DocumentAnchor {
  id            String    @id @default(uuid()) @map("id") @db.Uuid
  documentId    String    @map("document_id")
  version       Int       @map("version")
  contentHash   String    @map("content_hash")
  txId          String    @map("tx_id")
  signedTx      String    @map("signed_tx")
  status        String    @default("pending") @map("status")
  blockNumber   BigInt?   @map("block_number")
  blockHash     String?   @map("block_hash")
  failureReason String?   @map("failure_reason")
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([documentId, version])
  @@index([status])
  @@map("document_anchors")
}
```

Hmm, for `DateTime` in Prisma with PostgreSQL, the default mapping is already `timestamptz`. Adding `@db.Timestamptz` is explicit but not strictly necessary. The plan says `timestamptz`, so I'll add it for clarity.

Actually, in Prisma, `DateTime` maps to `timestamptz(6)` by default for PostgreSQL. So `@db.Timestamptz` is redundant but explicit. I'll include it since the plan explicitly states the type.

Wait, actually I need to double-check. In Prisma:
- `DateTime` → `TIMESTAMPTZ(6)` by default for PostgreSQL

So adding `@db.Timestamptz` is fine and makes the intent explicit per the plan.

For `id`, the plan says type `uuid`. I'll use `@db.Uuid`.

Let me also reconsider whether to add `@db.Uuid` or not. The plan says the type is `uuid`. In Prisma, if I just use `String @default(uuid())`, the migration will create a `text` column (I think). To get an actual `uuid` column, I need `@db.Uuid`. Let me go with that.

Actually, I just realized - in Prisma for PostgreSQL:
- `String` without a `@db.` attribute maps to `text`
- `String @db.Uuid` maps to `uuid`

So yes, I need `@db.Uuid` for the id field.

Final version looks good. Let me write it out cleanly.
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

model DocumentAnchor {
  id            String    @id @default(uuid()) @map("id") @db.Uuid
  documentId    String    @map("document_id")
  version       Int       @map("version")
  contentHash   String    @map("content_hash")
  txId          String    @map("tx_id")
  signedTx      String    @map("signed_tx")
  status        String    @default("pending") @map("status")
  blockNumber   BigInt?   @map("block_number")
  blockHash     String?   @map("block_hash")
  failureReason String?   @map("failure_reason")
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([documentId, version])
  @@index([status])
  @@map("document_anchors")
}
```
