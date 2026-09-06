# 01-schema.prisma

## reasoning

```
Let me analyze the PLAN.md to understand exactly what the Prisma schema needs:

From Section 2 (Data model):

### `refresh_tokens` table:
- `id`: uuid PK, default gen_random_uuid()
- `token_hash`: varchar(64) UNIQUE, NOT NULL
- `family_id`: uuid, NOT NULL, INDEXED
- `user_id`: varchar(255), NOT NULL
- `expires_at`: timestamptz, NOT NULL
- `created_at`: timestamptz, NOT NULL, default now()
- `retired_at`: timestamptz, NULLABLE

### `audit_events` table:
- `id`: uuid PK, default gen_random_uuid()
- `family_id`: uuid, NOT NULL, INDEXED
- `token_id`: uuid, NULLABLE
- `event_type`: audit_event_type enum, NOT NULL
- `created_at`: timestamptz, NOT NULL, default now()

### Enum `audit_event_type`:
Values: `ROTATED`, `REJECTED_MALFORMED`, `REJECTED_UNKNOWN`, `REJECTED_EXPIRED`, `REUSE_COMPROMISE`

Now, from the conventions:
- Table and column: `snake_case` (via Prisma `@map`/`@@map`)
- So the model names in Prisma will be PascalCase (RefreshToken, AuditEvent) but the actual DB table names need `@@map("refresh_tokens")` and `@@map("audit_events")`.
- Column names in Prisma will be camelCase in the model but mapped to snake_case via `@map()`.

Wait, let me reconsider. The convention says "Table and column: snake_case (via Prisma @map/@@map)". This means the actual DB identifiers are snake_case, and we use `@map`/`@@map` to map from the Prisma model's PascalCase/camelCase field names.

Actually, looking more carefully at Prisma conventions:
- Model names are PascalCase in the schema (e.g., `model RefreshToken`)
- Field names can be camelCase, mapped to snake_case via `@map`
- Table name is snake_case via `@@map`

Let me think about the fields:

For RefreshToken:
- `id` → stays `id` (single word, same in snake_case)
- `tokenHash` → mapped to `token_hash`
- `familyId` → mapped to `family_id`
- `userId` → mapped to `user_id`
- `expiresAt` → mapped to `expires_at`
- `createdAt` → mapped to `created_at`
- `retiredAt` → mapped to `retired_at`

For AuditEvent:
- `id` → stays `id`
- `familyId` → mapped to `family_id`
- `tokenId` → mapped to `token_id`
- `eventType` → mapped to `event_type`
- `createdAt` → mapped to `created_at`

The datasource and generator blocks are needed. From the conventions:
- PostgreSQL as database
- Prisma as ORM

The datasource would use `DATABASE_URL` environment variable (from the Environment section: "Configuration comes from environment variables only. DATABASE_URL for Postgres.")

For the enum, in Prisma enums are defined as `enum AuditEventType`. The values listed are: `ROTATED`, `REJECTED_MALFORMED`, `REJECTED_UNKNOWN`, `REJECTED_EXPIRED`, `REUSE_COMPROMISE`. These are already in a format that works for Prisma enum values.

Wait, the plan says the enum type is `audit_event_type` (snake_case) for the DB. In Prisma, the enum name in the schema is PascalCase by convention but we can use `@@map` or just name it. Actually, for Prisma enums, the name in the schema IS the type name used in generated code. The DB type name can be controlled... actually in Prisma, enums don't have a `@map` on the enum itself in older versions. Let me think...

Actually in Prisma, you can't use `@map` on an enum to rename the database type. The enum name in the schema is used as the type name in the database by default. But wait - actually looking at Prisma docs, you CAN'T rename enums with `@map`. The enum name in the Prisma schema becomes the PostgreSQL type name.

Hmm, but the convention says "Table and column: snake_case (via Prisma @map/@@map)". Enums are types, not tables or columns. So maybe the enum can just be `AuditEventType` in Prisma and it'll create a type called `audit_event_type` in Postgres? No, actually Prisma creates the enum type with the exact name you give it.

Wait, let me reconsider. In Prisma:
- `model` names → table names (unless `@@map` is used)
- `enum` names → PostgreSQL enum type names

So if I write `enum AuditEventType`, Postgres will have a type called `"AuditEventType"`. If the convention wants snake_case, I might need to name it `audit_event_type` in Prisma.

But actually, the convention says "Table and column: snake_case (via Prisma @map/@@map)". It specifically mentions tables and columns. Enums are type names, not table or column names. The column that references the enum (`event_type`) will be snake_case via `@map`. The enum type name itself is a type, not a table or column.

Hmm, but to be safe and consistent with the snake_case convention for DB objects, I think I should name the enum to match what the DB would use. But Prisma doesn't support `@map` on enums...

Actually, looking at this more carefully - in Prisma, you CANNOT use `@map` on an enum. The enum name in the Prisma schema is directly used as the PostgreSQL type name. So if I want the Postgres type to be `audit_event_type`, I'd need to write `enum audit_event_type` in the Prisma schema.

But wait - that's not valid Prisma syntax. Prisma enum names must be PascalCase (or at least follow identifier rules). Actually, let me check - Prisma allows any valid identifier for enum names. So `enum audit_event_type` might actually work syntactically... but it would be unusual.

Actually, I just recalled: Prisma does NOT support `@map` for enums. The name you give the enum in the schema IS the database type name. So to have a snake_case enum in Postgres, you'd write `enum audit_event_type` in Prisma.

But this conflicts with the typical Prisma convention of PascalCase for model/enum names. However, the task says "Table and column: snake_case (via Prisma @map/@@map)" - it specifically mentions tables and columns, not enums/types.

I think the safest approach is:
- Use `enum AuditEventType` in Prisma (PascalCase, standard Prisma convention)
- The generated DB type will be `AuditEventType` 
- The column mapping to snake_case is handled by `@map("event_type")` on the field

Actually wait, I just want to double-check: does Prisma allow `@map` on an enum field to control the column name? Yes, it does. The field `eventType AuditEventType @map("event_type")` will create a column named `event_type` of type `AuditEventType` (or whatever the enum is named).

I'll go with `enum AuditEventType` since:
1. The convention specifically says "Table and column" for snake_case
2. Enums are type names, not tables or columns
3. It's standard Prisma convention

Let me also think about the `datasource` and `generator` blocks. These are required in any Prisma schema file.

The datasource:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

The generator:
```prisma
generator client {
  provider = "prisma-client-js"
}
```

These are standard and implied by the stack (Prisma + PostgreSQL, DATABASE_URL env var).

Now let me also think about indexes:
- `family_id` on refresh_tokens is INDEXED → `@@index([familyId])`
- `token_hash` is UNIQUE → `@unique` on the field (or `@@unique`)
- `family_id` on audit_events is INDEXED → `@@index([familyId])`

For the `id` fields with `gen_random_uuid()`:
In Prisma: `id String @id @default(uuid())`

Wait, but the plan says `uuid` type. In Prisma with PostgreSQL, you can use either `String @id @default(uuid())` which maps to `uuid` in Postgres, or use the native type. Actually, Prisma's `String` type with `@default(uuid())` will create a `uuid` column in Postgres. But to be explicit, I could... actually no, Prisma doesn't have a `Uuid` type. You use `String @id @default(uuid())` and it becomes a `uuid` column.

Hmm, but the plan explicitly says the type is `uuid`. In Prisma, you represent this as `String @id @default(uuid())`. The database column will be `uuid`. This is the standard Prisma approach.

Actually wait - I need to reconsider. The `family_id` and `token_id` columns are also `uuid`. So they'd be `String` in Prisma. That's fine.

Let me also consider: the plan mentions `varchar(255)` for `user_id`. In Prisma, this would be `String @db.VarChar(255)`.

And `varchar(64)` for `token_hash` → `String @db.VarChar(64)`.

Let me write the schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AuditEventType {
  ROTATED
  REJECTED_MALFORMED
  REJECTED_UNKNOWN
  REJECTED_EXPIRED
  REUSE_COMPROMISE
}

model RefreshToken {
  id        String    @id @default(uuid())
  tokenHash String    @unique @map("token_hash") @db.VarChar(64)
  familyId  String    @map("family_id")
  userId    String    @map("user_id") @db.VarChar(255)
  expiresAt DateTime  @map("expires_at")
  createdAt DateTime  @default(now()) @map("created_at")
  retiredAt DateTime? @map("retired_at")

  @@index([familyId])
  @@map("refresh_tokens")
}

model AuditEvent {
  id        String       @id @default(uuid())
  familyId  String       @map("family_id")
  tokenId   String?      @map("token_id")
  eventType AuditEventType @map("event_type")
  createdAt DateTime     @default(now()) @map("created_at")

  @@index([familyId])
  @@map("audit_events")
}
```

Wait, I need to double-check the `@map` usage. In Prisma:
- `@map("column_name")` on a field maps the field to a snake_case column name
- `@@map("table_name")` on a model maps the model to a snake_case table name

This looks correct.

One thing I'm unsure about: should `family_id` in the index reference the mapped name or the Prisma field name? In Prisma, `@@index([familyId])` uses the Prisma field name, and it automatically maps to the correct column. So `@@index([familyId])` is correct.

Let me also verify: the plan says `id` is `uuid PK, default gen_random_uuid()`. In Prisma, `@default(uuid())` generates a UUID. The underlying Postgres column type will be `uuid`. This is correct.

I think the schema is complete. Let me finalize it.
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

enum AuditEventType {
  ROTATED
  REJECTED_MALFORMED
  REJECTED_UNKNOWN
  REJECTED_EXPIRED
  REUSE_COMPROMISE
}

model RefreshToken {
  id        String    @id @default(uuid())
  tokenHash String    @unique @map("token_hash") @db.VarChar(64)
  familyId  String    @map("family_id")
  userId    String    @map("user_id") @db.VarChar(255)
  expiresAt DateTime  @map("expires_at")
  createdAt DateTime  @default(now()) @map("created_at")
  retiredAt DateTime? @map("retired_at")

  @@index([familyId])
  @@map("refresh_tokens")
}

model AuditEvent {
  id        String         @id @default(uuid())
  familyId  String         @map("family_id")
  tokenId   String?        @map("token_id")
  eventType AuditEventType @map("event_type")
  createdAt DateTime       @default(now()) @map("created_at")

  @@index([familyId])
  @@map("audit_events")
}
```
