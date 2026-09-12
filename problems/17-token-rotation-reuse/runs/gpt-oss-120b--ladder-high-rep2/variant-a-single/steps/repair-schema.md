# repair-schema

## reasoning

```
We need to fix schema: likely missing User model definition. Provide minimal User model with id. Also maybe RefreshToken model exists. Add User model before usage.

Return full schema.
```

## reply

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/.prisma/client"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// -----------------------------------------------------------------------------
// Models
// -----------------------------------------------------------------------------

model RefreshToken {
  id            String   @id @default(uuid()) @map("id")
  token         String   @unique @map("token")
  userId        String   @map("user_id")
  createdAt     DateTime @default(now()) @map("created_at")
  expiresAt     DateTime @map("expires_at")
  retiredAt     DateTime? @map("retired_at")
  // Relations
  user          User     @relation(fields: [userId], references: [id])

  @@map("refresh_tokens")
}

// Minimal User model required for relations
model User {
  id            String          @id @default(uuid()) @map("id")
  email         String          @unique @map("email")
  passwordHash  String          @map("password_hash")
  createdAt     DateTime        @default(now()) @map("created_at")
  // Relations
  refreshTokens RefreshToken[]  @relation("UserRefreshTokens")

  @@map("users")
}
```
