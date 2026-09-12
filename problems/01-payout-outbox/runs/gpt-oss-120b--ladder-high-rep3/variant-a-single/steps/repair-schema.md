# repair-schema

## reasoning

```
We need to add @unique to payoutId field. Provide corrected schema.
```

## reply

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id                 String   @id @default(uuid())
  balance            Int
  availableBalance   Int
  payouts            Payout[]
  ledgerEntries      LedgerEntry[]
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@map("accounts")
}

model Payout {
  id                  String    @id @default(uuid())
  accountId           String    @map("account_id")
  amount              Int
  destinationAddress  String    @map("destination_address")
  idempotencyKey      String    @unique
  status              PayoutStatus @default(PENDING)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  account             Account   @relation(fields: [accountId], references: [id])
  ledgerEntry        LedgerEntry? @relation(fields: [ledgerEntryId], references: [id])
  ledgerEntryId       String?   @map("ledger_entry_id")
  messages            Message[] 

  @@map("payouts")
  @@index([accountId])
}

model LedgerEntry {
  id            String   @id @default(uuid())
  accountId     String   @map("account_id")
  amount        Int
  type          LedgerEntryType
  relatedId     String?  @map("related_id")
  createdAt     DateTime @default(now())

  account       Account  @relation(fields: [accountId], references: [id])
  payout        Payout?  @relation(fields: [payoutId], references: [id])
  payoutId      String?  @unique @map("payout_id")

  @@map("ledger_entries")
}

model Message {
  id          String   @id @default(uuid())
  payload     Json
  processedAt DateTime?
  retryCount  Int      @default(0)
  createdAt   DateTime @default(now())

  payout      Payout   @relation(fields: [payoutId], references: [id])
  payoutId    String   @unique @map("payout_id")

  @@map("messages")
}
```
