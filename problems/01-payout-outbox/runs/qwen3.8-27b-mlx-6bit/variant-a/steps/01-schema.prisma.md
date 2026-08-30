# 01-schema.prisma

## reasoning

```
We need answer user's request: write exactly one file prisma/schema.prisma based on PLAN.md. Need produce fenced code block only. Need reason in same language as user's request (English). Need ensure schema matches plan exactly. Let's analyze plan.

We need produce Prisma schema with datasource, generator? Plan says Prisma schema + migration. File: prisma/schema.prisma. Need include generator client, datasource db postgresql url env("DATABASE_URL"). Model names? Plan says tables mapped snake_case. It lists **`accounts`** (`@@map("accounts")`) etc. Prisma model names likely PascalCase? Convention: Class PascalCase, table snake_case via @@map. For models, likely Account, Payout, PayoutMessage, LedgerEntry? Need infer. Plan uses model names lowercase in bullets but says @@map. We need choose defensible: Prisma convention PascalCase model names; map to snake_case tables. But plan says "accounts" (`@@map("accounts")`) maybe model name accounts? In Prisma model names are PascalCase generally but can be any identifier? Usually model Account. Need align with plan: It says Table and column snake_case via @map/@@map. So model names probably PascalCase. But plan's section 2 headings: **`accounts`** (`@@map("accounts")`). It might mean table name. Use model Account @@@map? Actually @@map("accounts"). Similarly Payout, PayoutMessage, LedgerEntry.

Need fields exactly:
Account:
- id String @id @default(cuid()) @map("id")? They say `id: String @id @default(cuid())` — `@map("id")`. In Prisma, mapping id to id unnecessary but can include. Need include? Plan says @map("id"). We can include for all fields to be explicit. But if model field id maps id, okay.
- settledBalance BigInt @default(0) @map("settled_balance")
- reservedAmount BigInt @default(0) @map("reserved_amount")
- createdAt DateTime @default(now()) @map("created_at")

Payout:
- id String @id @default(cuid()) @map("id")
- accountId String @map("account_id"), relation to accounts. Need relation attribute? Prisma requires relation if foreign key? We can define relation fields: account Account @relation(fields: [accountId], references: [id])? Plan says relation to accounts. Should include. In PayoutMessage also relation to payouts and maybe account? It says payoutId @unique, relation to payouts; accountId String. Could include account relation too? Plan only says relation to payouts for payoutId, accountId is string. But if PayoutMessage has accountId and maybe relation? It says `payoutId: String @unique` — `@map("payout_id")`, relation to `payouts`; `accountId: String` — `@map("account_id")`. It doesn't explicitly say relation to accounts for message. But we can add account relation? Need not over-add? It says implement exactly plan. Adding relation fields might be okay if implied by accountId? But "Do not add ... feature". Relations are schema structure. Plan says relation to accounts for payout.accountId, relation to payouts for message.payoutId. For ledger_entries: accountId, payoutId; plan doesn't explicitly mention relations but double-entry. Could include relations? Need decide.

Prisma schema with BigInt and enums. Need unique index on PayoutMessage: @@unique([accountId, idempotencyKey], map: "uq_messages_account_idem"). Also payoutId @unique.

Enum PayoutStatus: CREATED, PROCESSING, SENT, COMPLETED, FAILED, NEEDS_REVIEW. In Prisma enum values can be uppercase. Map? Not specified. Use as is.
MessageStatus: PENDING, PROCESSING, DONE, DEAD.
LedgerDirection: CREDIT, DEBIT.

Need migrations? Only schema file requested. No migration file.

Need consider Prisma relation names and back-relations. If we add account relation in Payout, need Account has payouts Payout[]. If PayoutMessage has payout relation, Payout has message PayoutMessage? Since payoutId unique one-to-one. Could include. But plan only says relation to payouts. Adding back-relations is necessary in Prisma if using relation fields. If we don't add relation fields, just foreign key columns without relation? Prisma allows plain scalar FK without relation. But plan says "relation to accounts". In Prisma, relation is via `account Account @relation(...)`. That requires back-relation. Could be considered part of implementing relation. Need include minimal relations to satisfy.

Need think about schema validity with BigInt and defaults. Prisma supports BigInt @default(0). Yes.

Need datasource:
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

Need maybe previewFeatures? Not needed.

Potential issue: Model names and @@map: If model Account @@@? Actually attribute is @@map. Use `model Account { ... @@map("accounts") }`.

Need columns mapping: For each field include @map. Plan explicitly says id @map("id") etc. We can include all.

Need unique constraints: PayoutMessage payoutId @unique maps payout_id. Add @@unique([accountId, idempotencyKey], map: "uq_messages_account_idem"). Also maybe @@index? Not in plan. Don't add.

Need relation fields:
Option 1:
model Account {
 id String @id @default(cuid()) @map("id")
 settledBalance BigInt @default(0) @map("settled_balance")
 reservedAmount BigInt @default(0) @map("reserved_amount")
 createdAt DateTime @default(now()) @map("created_at")
 payouts Payout[]
 messages PayoutMessage[]? If message has account relation. But plan doesn't say message relation to account. Ledger entries? Could have ledgerEntries LedgerEntry[] if relation.
}

model Payout {
 id String @id @default(cuid()) @map("id")
 account Account @relation(fields: [accountId], references: [id])
 accountId String @map("account_id")
 amount BigInt @map("amount")
 destinationAddress String @map("destination_address")
 status PayoutStatus @default(CREATED) @map("status")
 txHash String? @map("tx_hash")
 attempts Int @default(0) @map("attempts")
 lastError String? @map("last_error")
 createdAt DateTime @default(now()) @map("created_at")
 processedAt DateTime? @map("processed_at")
 completedAt DateTime? @map("completed_at")
 message PayoutMessage? // one-to-one because payoutId unique
 ledgerEntries LedgerEntry[]? if relation
}

model PayoutMessage {
 id String @id @default(cuid()) @map("id")
 payout Payout @relation(fields: [payoutId], references: [id])
 payoutId String @unique @map("payout_id")
 accountId String @map("account_id")
 idempotencyKey String @map("idempotency_key")
 status MessageStatus @default(PENDING) @map("status")
 attempts Int @default(0) @map("attempts")
 createdAt DateTime @default(now()) @map("created_at")
 claimedAt DateTime? @map("claimed_at")
}

model LedgerEntry {
 id String @id @default(cuid()) @map("id")
 account Account @relation(fields: [accountId], references: [id])? if add relation
 accountId String @map("account_id")
 payout Payout @relation(fields: [payoutId], references: [id])? if add relation
 payoutId String @map("payout_id")
 direction LedgerDirection @map("direction")
 amount BigInt @map("amount")
 createdAt DateTime @default(now()) @map("created_at")
}

But adding ledger entry relations not explicitly in plan? It says double-entry ledger, account's settled balance; fields accountId, payoutId. It doesn't say relation to accounts/payouts. But if we add account and payout relations, need back-relations. Is that "add feature"? Relations are not features; but plan only named relation for payout.accountId and message.payoutId. Could avoid relations except those specified to minimize. But if we specify `account Account @relation(...)` for Payout, need back relation in Account. That's okay. For LedgerEntry, we can leave plain accountId/payoutId no relation. For PayoutMessage, plan says relation to payouts, so include payout relation and back message in Payout. Does it also require account relation? It only says accountId String; no relation. But maybe because unique (accountId, idempotencyKey), no FK needed. We can leave accountId plain in message. However if Payout has account relation, message could have account relation optional but not necessary.

Need check Prisma one-to-one relation: Payout.message PayoutMessage? and PayoutMessage.payout Payout @relation(fields: [payoutId], references: [id]). Since payoutId unique, Prisma infers one-to-one? If Payout side `message PayoutMessage?` optional. Good.

Need if Account has payouts Payout[] and Payout.account relation. If LedgerEntry no relation, no back.

Could also include `@@map` for enums? Not needed.

Need consider field order: plan lists fields in order. Use same order. For relations, where place? Usually after scalar or before. For Payout: plan lists accountId relation to accounts. We can put `account Account @relation(fields: [accountId], references: [id])` after accountId or before. It doesn't matter. Need keep fields? Could include relation field not in plan? It is necessary for relation. But "Do not add an export, a feature or a file the plan does not name." Relation field maybe not named but relation is. Fine.

Need maybe use `String` for BigInt? No, plan says BigInt.

Potential issue with Prisma and `@default(0)` for BigInt: In Prisma, default for BigInt must be integer literal? Yes `@default(0)` works.

Potential issue: `cuid()` default in Prisma is okay. Could use `cuid(2)`? Plan says cuid(). Use exactly.

Potential issue: Need map table names: `@@map("accounts")`, `@@map("payouts")`, `@@map("payout_messages")`, `@@map("ledger_entries")`.

Potential issue: Need map unique index name exactly "uq_messages_account_idem". Use `map: "uq_messages_account_idem"`.

Potential issue: Need enum names maybe map? Not specified. Use as is.

Need maybe include `relation` attributes with map? No.

Need maybe add `@@index([status])` for pending messages? Not in plan. Do not add.

Need maybe add `@@index([accountId, status])`? No.

Need maybe include `onUpdate`/`onDelete`? Not specified. Avoid.

Need maybe include `previewFeatures = ["postgresqlExtensions"]`? No.

Need maybe include comments? Could include minimal comments? User asks complete file. Comments okay but not necessary. Plan says code and comments English. We can omit comments to avoid extra. But maybe include no comments.

Need final only fenced block with schema. Ensure no explanation.

Let's consider if model names should be lowercase as plan headings? Prisma model names can be lowercase but convention PascalCase. The codebase conventions: Class: PascalCase. Prisma models are not classes but often PascalCase. Use PascalCase.

Need ensure no missing relation back if using Payout.account and PayoutMessage.payout. Account must have `payouts Payout[]`. Payout must have `message PayoutMessage?`.

What about PayoutMessage.accountId plain but unique with idempotencyKey. No FK. That's okay. But if Account has `messages PayoutMessage[]` not needed. Avoid.

What about LedgerEntry plain accountId/payoutId, no FK. That's okay. But maybe the plan says "payoutId" relation? It doesn't. It says account's settled balance changes only when provider confirms; ledger entries per side. Could leave plain.

Need think if Prisma requires relation field names not conflict with scalar fields? If Payout has `account Account` and `accountId String`, fine. PayoutMessage has `payout Payout` and `payoutId String`, fine.

Could there be a problem with one-to-one optional relation where PayoutMessage.payout is required and Payout.message optional. Since payoutId unique and non-null, every message has a payout. Good.

Need maybe add `@relation` on Payout.message? In one-to-one, only one side needs fields. PayoutMessage has fields. Payout.message can be `PayoutMessage?` without @relation. Good.

Need maybe add `@relation` on Account.payouts? No, Payout.account has fields.

Need maybe add `@@unique` on PayoutMessage with map: In Prisma syntax:
`@@unique([accountId, idempotencyKey], map: "uq_messages_account_idem")`
Yes.

Need maybe add `@@index([payoutId])`? payoutId @unique creates index.

Need maybe include `status PayoutStatus @default(CREATED)` etc.

Need maybe include `lastError String?` maps last_error.

Need maybe include `txHash String?` maps tx_hash.

Potential issue: Prisma enum values cannot contain hyphens; NEEDS_REVIEW okay.

Need maybe include `provider = "prisma-client-js"` in generator. Since NestJS + Prisma, yes.

Need maybe include `url = env("DATABASE_URL")`. Yes.

Now final content:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum MessageStatus {
  PENDING
  PROCESSING
  DONE
  DEAD
}

enum LedgerDirection {
  CREDIT
  DEBIT
}

model Account {
  id             String   @id @default(cuid()) @map("id")
  settledBalance BigInt   @default(0) @map("settled_balance")
  reservedAmount BigInt   @default(0) @map("reserved_amount")
  createdAt      DateTime @default(now()) @map("created_at")

  payouts Payout[]

  @@map("accounts")
}

model Payout {
  id                 String       @id @default(cuid()) @map("id")
  account            Account      @relation(fields: [accountId], references: [id])
  accountId          String       @map("account_id")
  amount             BigInt       @map("amount")
  destinationAddress String       @map("destination_address")
  status             PayoutStatus @default(CREATED) @map("status")
  txHash             String?      @map("tx_hash")
  attempts           Int          @default(0) @map("attempts")
  lastError          String?      @map("last_error")
  createdAt          DateTime     @default(now()) @map("created_at")
  processedAt        DateTime?    @map("processed_at")
  completedAt        DateTime?    @map("completed_at")

  message PayoutMessage?

  @@map("payouts")
}

model PayoutMessage {
  id               String        @id @default(cuid()) @map("id")
  payout           Payout        @relation(fields: [payoutId], references: [id])
  payoutId         String        @unique @map("payout_id")
  accountId        String        @map("account_id")
  idempotencyKey   String        @map("idempotency_key")
  status           MessageStatus @default(PENDING) @map("status")
  attempts         Int           @default(0) @map("attempts")
  createdAt        DateTime      @default(now()) @map("created_at")
  claimedAt        DateTime?     @map("claimed_at")

  @@unique([accountId, idempotencyKey], map: "uq_messages_account_idem")
  @@map("payout_messages")
}

model LedgerEntry {
  id        String          @id @default(cuid()) @map("id")
  accountId String          @map("account_id")
  payoutId  String          @map("payout_id")
  direction LedgerDirection @map("direction")
  amount    BigInt          @map("amount")
  createdAt DateTime        @default(now()) @map("created_at")

  @@map("ledger_entries")
}
```

Need check alignment not important.

Could there be a requirement for `id` @map("id")? Yes included.

Need consider if Prisma model field `account` relation and `accountId` scalar order: In Prisma, list of fields in @relation can be before or after. Good.

Need consider if `PayoutMessage.payout` required relation with `payoutId @unique`; if Payout.message optional, okay. But because PayoutMessage.payout is required, every message must have payout. Good.

Need consider if `Payout.account` required relation; Payout.accountId non-null. Good.

Need consider if `Account.payouts` list optional? It's required type Payout[] (empty allowed). Good.

Potential hidden issue: Prisma does not allow `@default(0)` for BigInt in some versions? It does since Prisma 3.15? Yes.

Potential hidden issue: `cuid()` for String id and BigInt amounts okay.

Potential hidden issue: In Prisma, enum default syntax `@default(CREATED)` no quotes. Yes.

Potential hidden issue: The plan says "Amounts are in minor units. Do not use floating point for money." BigInt okay.

Potential hidden issue: The plan says "The account's settled balance changes only when provider confirms transfer." Schema has settledBalance and reservedAmount. Good.

Potential hidden issue: The plan says "Ledger is double-entry: one ledger_entry per side of a balance change; account settled balance is derived as sum of entries. The repository maintains settledBalance/reservedAmount as cached columns updated in same transaction as ledger writes." Schema has ledger_entries with direction CREDIT/DEBIT. But double-entry usually entries have account and maybe counterparty? Plan only fields accountId, payoutId, direction, amount. Good.

Need maybe include `payout Payout @relation` in LedgerEntry? Not specified. If omitted, no FK. Is that okay for "double-entry-style ledger"? Could be fine. But if tests need relation? Tests likely use Prisma client with scalar fields. No need.

Could the plan's "relation to accounts" for Payout mean only logical relation, not Prisma relation? But using Prisma relation is defensible. If we omit all relations, simpler and closer to fields. But if plan explicitly says relation to payouts for message, maybe include. Need weigh adding relations vs not. The instruction: "Implement exactly what the plan specifies for this file. Do not add an export, a feature or a file the plan does not name." Relations are part of schema. The plan says relation to accounts and relation to payouts. So include those. For ledger entries, no explicit relation; omit.

Need maybe include `accountId` in PayoutMessage with relation to Account? It says unique (accountId, idempotencyKey) and account owns funds. But not explicit relation. Omit to avoid extra back-relation.

Need maybe include `payoutId` in LedgerEntry with relation to Payout? It says payoutId field, not relation. Omit.

Need maybe include `accountId` in LedgerEntry with relation to Account? It says account's settled balance derived from entries; but not explicit relation. Omit.

Could omitting FK relations for ledger entries be seen as incomplete? The plan data model lists only fields, no relation. So okay.

Need maybe include `@map` on relation fields? No.

Need maybe include `@@index([status])` for worker polling findPendingMessages? Plan says fetch pending messages. But not in schema plan. Do not add.

Need maybe include `@@index([payoutId])`? unique.

Need maybe include `@@index([accountId, idempotencyKey])`? unique covers.

Need maybe include `@@index([accountId, status])` for payout? No.

Need final only fenced block. Ensure language tag maybe prisma. User says one fenced block. Use ```prisma.

Double-check no trailing explanation.

One more thought: Prisma schema with `model Account { ... payouts Payout[] }` and `model Payout { ... message PayoutMessage? }`. If PayoutMessage has required payout relation, and Payout.message optional, the database will have payout_id NOT NULL in payout_messages. Good.

Potential issue: Since PayoutMessage has `@@unique([accountId, idempotencyKey])`, and Payout has account relation, but PayoutMessage.accountId is not FK. If account deleted, messages remain. Not relevant.

Potential issue: The plan says `payoutId: String @unique` — relation to payouts. If Payout.message is optional one-to-one, Prisma will create payout_id unique. Good.

Potential issue: If Payout.account relation is required, Account.payouts list. Good.

Need maybe use `String @id @default(cuid())` but plan says cuid() no quotes. Good.

Potential issue: In Prisma, `@map("id")` on id field is allowed but redundant. Yes.

Potential issue: `reservedAmount BigInt @default(0)` maybe needs `@default(0n)`? No, Prisma uses integer literal.

Potential issue: The schema should not include migration. Good.

Let's produce final.
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

enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum MessageStatus {
  PENDING
  PROCESSING
  DONE
  DEAD
}

enum LedgerDirection {
  CREDIT
  DEBIT
}

model Account {
  id             String   @id @default(cuid()) @map("id")
  settledBalance BigInt   @default(0) @map("settled_balance")
  reservedAmount BigInt   @default(0) @map("reserved_amount")
  createdAt      DateTime @default(now()) @map("created_at")

  payouts Payout[]

  @@map("accounts")
}

model Payout {
  id                 String       @id @default(cuid()) @map("id")
  account            Account      @relation(fields: [accountId], references: [id])
  accountId          String       @map("account_id")
  amount             BigInt       @map("amount")
  destinationAddress String       @map("destination_address")
  status             PayoutStatus @default(CREATED) @map("status")
  txHash             String?      @map("tx_hash")
  attempts           Int          @default(0) @map("attempts")
  lastError          String?      @map("last_error")
  createdAt          DateTime     @default(now()) @map("created_at")
  processedAt        DateTime?    @map("processed_at")
  completedAt        DateTime?    @map("completed_at")

  message PayoutMessage?

  @@map("payouts")
}

model PayoutMessage {
  id             String        @id @default(cuid()) @map("id")
  payout         Payout        @relation(fields: [payoutId], references: [id])
  payoutId       String        @unique @map("payout_id")
  accountId      String        @map("account_id")
  idempotencyKey String        @map("idempotency_key")
  status         MessageStatus @default(PENDING) @map("status")
  attempts       Int           @default(0) @map("attempts")
  createdAt      DateTime      @default(now()) @map("created_at")
  claimedAt      DateTime?     @map("claimed_at")

  @@unique([accountId, idempotencyKey], map: "uq_messages_account_idem")
  @@map("payout_messages")
}

model LedgerEntry {
  id        String          @id @default(cuid()) @map("id")
  accountId String          @map("account_id")
  payoutId  String          @map("payout_id")
  direction LedgerDirection @map("direction")
  amount    BigInt          @map("amount")
  createdAt DateTime        @default(now()) @map("created_at")

  @@map("ledger_entries")
}
```
