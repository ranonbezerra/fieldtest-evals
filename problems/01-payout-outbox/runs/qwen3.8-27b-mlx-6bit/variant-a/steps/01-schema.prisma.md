# 01-schema.prisma

## reasoning

```
We need answer user's request: write exactly one file prisma/schema.prisma complete fenced block nothing else. Need follow plan. Need think in English? User request English. Need produce final only code block.

We need construct Prisma schema per plan. Stack: TypeScript, NestJS, Prisma, PostgreSQL. ESM irrelevant. Conventions: table/column snake_case via @map/@@map. Need all tables, columns, relations, @@map.

Plan data model:
- datasource db? Need include generator and datasource? A complete schema.prisma must have generator client and datasource. Plan says all tables etc. Should include.
- provider = "postgresql"
- url = env("DATABASE_URL")

Models:
Account? Plan says accounts @@map. id String PK, settled_balance BigInt @map("settled_balance"), reserved_amount BigInt @map("reserved_amount"), created_at DateTime default now.
Need relation to payouts? Plan says payouts account_id FK accounts.id. ledger_entries account_id FK. Could include relations. Need decide field names. Prisma model names PascalCase: Account, Payout, LedgerEntry, Message. Table map snake_case.
Fields:
model Account {
  id String @id
  settledBalance BigInt @map("settled_balance")
  reservedAmount BigInt @map("reserved_amount")
  createdAt DateTime @default(now()) @map("created_at")
  payouts Payout[]
  ledgerEntries LedgerEntry[]
}

But plan's repository getAccount returns Account. Prisma generated type Account includes relations maybe okay.

Payout:
id String @id (uuid? Plan says PK uuid but Prisma can use @default(uuid())? Should we add default? Plan: id String, PK (uuid). Could use @default(uuid()) to generate. But if repository createPayoutWithMessage maybe passes id? Plan doesn't specify id generation in code. Could use @default(uuid()) to be safe. But if tests create directly with id? Not relevant. Need maybe cuid? Plan says uuid. Use @default(uuid()).
accountId String @map("account_id")
amount BigInt
destinationAddress String @map("destination_address")
idempotencyKey String @unique @map("idempotency_key")
status String
txHash String? @map("tx_hash")
attempts Int @default(0) @map("attempts")
createdAt DateTime @default(now()) @map("created_at")
updatedAt DateTime @updatedAt @map("updated_at")
account Account @relation(fields: [accountId], references: [id])
ledgerEntries LedgerEntry[]
message Message? // one-to-one unique

Need maybe index on status? Not specified. Do not add extra? Plan says all tables columns relations @@map. Could add indexes if plan? It doesn't mention indexes besides unique idempotencyKey and message payout_id unique. Avoid extra features? Indexes are schema but not requested. Maybe no indexes except unique.

LedgerEntry:
id String @id @default(uuid())
payoutId String? @map("payout_id")
accountId String @map("account_id")
type String
amount BigInt
createdAt DateTime @default(now()) @map("created_at")
payout Payout? @relation(fields: [payoutId], references: [id])
account Account @relation(fields: [accountId], references: [id])

Message:
id String @id @default(uuid())
payoutId String @unique @map("payout_id")
status String
attempts Int @default(0) @map("attempts")
lastError String? @map("last_error")
createdAt DateTime @default(now()) @map("created_at")
updatedAt DateTime @updatedAt @map("updated_at")
payout Payout @relation(fields: [payoutId], references: [id])

Need @@map:
Account @@map("accounts")
Payout @@map("payouts")
LedgerEntry @@map("ledger_entries")
Message @@map("messages")

Potential issue BigInt in Prisma with PostgreSQL: supported. Need maybe @db.BigInt? For BigInt default is native bigint? In Prisma, BigInt maps to BIGINT. No need @db.BigInt but can add. If add @db.BigInt, okay. But plan says BIGINT/Postgres bigint. Could add for explicitness. But if using @default? no.

Need generator client provider maybe "prisma-client-js". Complete schema:
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

Need ensure no enums because plan uses String statuses. Good.

Potential relation naming: Payout has message Message? and ledgerEntries LedgerEntry[]. LedgerEntry payout relation optional. Message payout relation required. Need unique on message payoutId. If Payout.message is optional one-to-one, Prisma requires relation on Message side with unique field. Good.

Need account relation fields. For LedgerEntry, both payout and account. Payout has ledgerEntries. Account has payouts and ledgerEntries.

Need consider plan says ledger_entries payout_id String? FK -> payouts.id, account_id FK. Good.

Potential issue: Payout.message relation with optional on Payout side and Message required. In Prisma, one-to-one optional can be indicated by `message Message?` on Payout side. The required side is Message with payoutId @unique. Good.

Need maybe `onUpdate`/`onDelete`? Not specified. Avoid extra. But FK constraints default. Could be okay.

Need maybe `created_at` on ledger_entries only. Yes.

Need maybe account `reserved_amount` default? Plan doesn't specify default but balance likely 0. Should we add @default(0)? Plan: reserved_amount BigInt — held by in-flight payouts. It doesn't explicitly say default. But for accounts, initial balance? It says settled_balance BigInt — confirmed spendable funds; reserved_amount BigInt. Could have default(0) for both? Data model didn't mention defaults except created_at. Should we add default 0? It is defensible and safe. But instruction: implement exactly plan. If plan didn't specify default, adding may be extra? Defaults are column attributes. Could be considered necessary for account creation. But tests may create account with balances. If no default, must provide values. Not harmful? The plan says all columns; defaults not specified except created_at. It explicitly says `attempts Int, default 0`. For balances no default. To be exact, omit defaults for settled_balance and reserved_amount? But a real schema often default 0. However if account creation in tests or app requires explicit. The plan doesn't name an account creation endpoint. It may be seeded. If no default, inserting account requires values, okay. Adding default 0 could deviate but likely acceptable. Need choose most defensible. Since plan says "settled_balance BigInt — confirmed, spendable funds" no default. I'd omit defaults to exactly plan. But if DB migration creates accounts, maybe need default 0. Yet no account creation in API. The plan's manifest only schema. I'd maybe add @default(0) because balances should start zero and safe. But "Do not add a feature or file plan does not name" not about defaults. Still, exactness: include only specified columns and constraints. Defaults are constraints. It specified default for attempts and created_at. So omit balance defaults.

Need maybe `id` default uuid? Plan says PK (uuid). That implies generated uuid. Include @default(uuid()). For message and ledger entries too. Good.

Need maybe `updatedAt` default? @updatedAt handles. Plan says updated_at DateTime for payouts and messages. Include.

Potential issue with Prisma reserved word? `type` is okay.

Need final only fenced block. Ensure no explanation. Could use ```prisma.

Double-check plan: "Table and column: snake_case (via Prisma @map/@@map)." We map all non-id? id column can be id. For fields with underscores map. Good.

Potential issue: `@map` on `id`? Not needed, column id. If want snake_case no.

Potential issue: Prisma model `Message` might conflict with global? okay.

Need maybe include comments? Not necessary. Could include minimal. But final content complete.

Let's think if plan requires "relations" explicitly: account_id FK, payout_id FK, ledger account. We include.

Potential issue: In Prisma, for one-to-one optional Payout.message, if Message.payoutId unique, the optional side can be `message Message?`. Good.

Potential issue: If Payout has `ledgerEntries LedgerEntry[]` and LedgerEntry has `payout Payout?`, relation name default. Good.

Potential issue: If Account has both payouts and ledgerEntries, no relation names needed.

Need maybe `@@index` for payout status? Not in plan. No.

Need maybe `@@unique([accountId, idempotencyKey])`? Plan says idempotency key globally unique. So only @unique on idempotencyKey.

Need maybe message payout_id unique yes.

Need maybe ledger entry type values? String.

Need maybe BigInt @db.BigInt. If include, migration uses BIGINT. Without, also BIGINT. Could include for explicitness. But if provider postgresql, BigInt maps to BIGINT by default. Adding @db.BigInt okay. But if plan says via Prisma, no need. I might omit to keep simple.

Need ensure ESM? irrelevant.

Potential hidden requirement: "Every schema change ships with a migration" but only schema file requested. No migration.

Now final. But need maybe include `// ASSUMPTION` if unresolved? I don't think any. Could there be ambiguity about account balance defaults? We can choose no default. No need assumption? If we choose no default, plan didn't specify. But if truly absent, maybe mark? The instruction says if symbol genuinely absent from plan and references, do not guess: write most defensible and mark with ASSUMPTION. Here symbol not absent, just default unspecified. Not necessary.

Need maybe include `previewFeatures = ["postgresqlExtensions"]`? No.

Let's draft:
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id             String    @id
  settledBalance BigInt    @map("settled_balance")
  reservedAmount BigInt    @map("reserved_amount")
  createdAt      DateTime  @default(now()) @map("created_at")

  payouts        Payout[]
  ledgerEntries  LedgerEntry[]

  @@map("accounts")
}

model Payout {
  id                String    @id @default(uuid())
  accountId         String    @map("account_id")
  amount            BigInt
  destinationAddress String   @map("destination_address")
  idempotencyKey    String    @unique @map("idempotency_key")
  status            String
  txHash            String?   @map("tx_hash")
  attempts          Int       @default(0) @map("attempts")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  account           Account   @relation(fields: [accountId], references: [id])
  ledgerEntries     LedgerEntry[]
  message           Message?

  @@map("payouts")
}

model LedgerEntry {
  id         String    @id @default(uuid())
  payoutId   String?   @map("payout_id")
  accountId  String    @map("account_id")
  type       String
  amount     BigInt
  createdAt  DateTime  @default(now()) @map("created_at")

  payout     Payout?   @relation(fields: [payoutId], references: [id])
  account    Account   @relation(fields: [accountId], references: [id])

  @@map("ledger_entries")
}

model Message {
  id         String    @id @default(uuid())
  payoutId   String    @unique @map("payout_id")
  status     String
  attempts   Int       @default(0) @map("attempts")
  lastError  String?   @map("last_error")
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt @map("updated_at")

  payout     Payout    @relation(fields: [payoutId], references: [id])

  @@map("messages")
}

Check formatting. Good.

Could there be issue with `BigInt` and `@db.BigInt` not included? no.

Need final fenced block only. Ensure no trailing explanation.
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
  id             String    @id
  settledBalance BigInt    @map("settled_balance")
  reservedAmount BigInt    @map("reserved_amount")
  createdAt      DateTime  @default(now()) @map("created_at")

  payouts        Payout[]
  ledgerEntries  LedgerEntry[]

  @@map("accounts")
}

model Payout {
  id                 String    @id @default(uuid())
  accountId          String    @map("account_id")
  amount             BigInt
  destinationAddress String    @map("destination_address")
  idempotencyKey     String    @unique @map("idempotency_key")
  status             String
  txHash             String?   @map("tx_hash")
  attempts           Int       @default(0) @map("attempts")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  account            Account   @relation(fields: [accountId], references: [id])
  ledgerEntries      LedgerEntry[]
  message            Message?

  @@map("payouts")
}

model LedgerEntry {
  id        String   @id @default(uuid())
  payoutId  String?  @map("payout_id")
  accountId String   @map("account_id")
  type      String
  amount    BigInt
  createdAt DateTime @default(now()) @map("created_at")

  payout    Payout?  @relation(fields: [payoutId], references: [id])
  account   Account  @relation(fields: [accountId], references: [id])

  @@map("ledger_entries")
}

model Message {
  id        String    @id @default(uuid())
  payoutId  String    @unique @map("payout_id")
  status    String
  attempts  Int       @default(0) @map("attempts")
  lastError String?   @map("last_error")
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  payout    Payout    @relation(fields: [payoutId], references: [id])

  @@map("messages")
}
```
