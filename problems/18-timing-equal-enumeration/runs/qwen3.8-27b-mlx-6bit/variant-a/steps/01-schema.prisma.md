# 01-schema.prisma

## reasoning

```
The user wants me to write the `prisma/schema.prisma` file based on the PLAN.md specification.

From the plan, the data model is:

**Table `users`** (Prisma model `User`, `@@map("users")`)

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` (String in Prisma) | PK, default `uuid()` |
| `email` | `citext`-equivalent via Prisma `String @unique` | Unique, NOT NULL |
| `password_hash` | `String` (Prisma `passwordHash`, `@map("password_hash")`) | NOT NULL |
| `created_at` | `timestamptz` (Prisma `DateTime @default(now())`, `@map("created_at")`) | NOT NULL |

One migration: `init` — creates the table.

Let me construct the schema.prisma file:

- datasource: PostgreSQL, url from env `DATABASE_URL`
- generator: client (prisma-client-js or prisma-client)
- model User with:
  - id: String, @id, @default(uuid())
  - email: String, @unique
  - passwordHash: String, @map("password_hash")
  - createdAt: DateTime, @default(now()), @map("created_at")
  - @@map("users")

The plan says "citext-equivalent via Prisma `String @unique`" — so just a plain String with @unique, no special citext extension.

The plan says the generator config is part of this file. Standard Prisma generator would be:

```
generator client {
  provider = "prisma-client-js"
}
```

And datasource:

```
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

This aligns with the environment convention: "Configuration comes from environment variables only. `DATABASE_URL` for Postgres."

Let me write the complete file.
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

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at")

  @@map("users")
}
```
