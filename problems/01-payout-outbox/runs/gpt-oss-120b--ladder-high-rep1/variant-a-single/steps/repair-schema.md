# repair-schema

## reasoning

```
We need to remove previewFeatures bigInt. Provide corrected schema without that line or empty previewFeatures. Return whole file. Assume original had that line. We'll output schema without previewFeatures or with empty array. Probably just delete previewFeatures line. Provide file content.
```

## reply

```prisma
generator client {
  provider = "prisma-client-js"
  // previewFeatures line removed because "bigInt" is not a known preview feature
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id                Int       @id @default(autoincrement())
  balance           BigInt    @default(0) // settled balance in minor units
  availableBalance  BigInt    @default(0) // funds not reserved for pending payouts
  payouts           Payout[]
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}

model Payout {
  id                 Int        @id @default(autoincrement())
  accountId          Int
  amount             BigInt
  destinationAddress String
  status             PayoutStatus @default(CREATED)
  idempotencyKey    String      @unique
  providerTxHash    String?     // filled when transfer succeeds
  attempts          Int         @default(0)
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt

  account            Account     @relation(fields: [accountId], references: [id])

  @@index([status])
}

enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

model Message {
  id          Int      @id @default(autoincrement())
  type        String
  payload     Json
  processedAt DateTime? // null = not processed yet
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([type])
}
```
