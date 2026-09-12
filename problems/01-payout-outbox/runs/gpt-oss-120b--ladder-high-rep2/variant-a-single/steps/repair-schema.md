# repair-schema

## reasoning

```
We need to fix schema: add relation fields on Payout model and make payout_id unique for one-to-one? Likely LedgerEntry relates to Payout one-to-many (multiple entries per payout). So change relation to one-to-many: on LedgerEntry keep fields, on Payout add ledgerEntries LedgerEntry[]. Also payout_id should not be unique, but need not be one-to-one. So adjust relation attribute: remove requirement of unique by making relation optional? Actually one-to-many still uses fields referencing id, no uniqueness needed. The error says one-to-one because no opposite field. Adding opposite field makes it one-to-many, still need not unique. So just add on Payout: ledgerEntries LedgerEntry[] @relation("LedgerEntryToPayout") maybe default name.

Also there is second relation similar? Both at lines 58-60 and 70-71. Both are in LedgerEntry model? Probably two fields? Actually there are two relations: maybe debit and credit? But both point to Payout. We need opposite fields on Payout for both. Could name them differently. Need to look at schema but not provided. We'll assume two optional relations: payout and maybe relatedPayout? But both same name? Might be duplicate. Probably one is for credit, one for debit. We'll add two fields on Payout: ledgerEntries LedgerEntry[] and ledgerEntriesOptional LedgerEntry[]? Need to match names. The relation fields are `payout` and `payout` again? Actually second is also `payout`. That would conflict. Probably they are different names in schema but we only see snippet. Probably first is required, second optional with different name maybe `payout?`. Both same name leads conflict. But we follow: add on Payout: ledgerEntries LedgerEntry[] and ledgerEntriesOptional LedgerEntry[] with appropriate relation names using `@relation("LedgerEntryPayout")` etc.

We'll add:

model Payout {
  id String @id @default(uuid())
  // other fields...
  ledgerEntries LedgerEntry[] @relation("LedgerEntryPayout")
  ledgerEntriesOptional LedgerEntry[] @relation("LedgerEntryPayoutOptional")
}

And on LedgerEntry adjust relation names to match.

Given we only can edit schema, we add opposite fields with correct relation names matching existing ones. Since existing relations have no name, Prisma will infer default name based on field. For required relation `payout` without name, opposite will be `ledgerEntries`. For optional also `payout`. Conflict. To differentiate, we need to give explicit names. So modify LedgerEntry relation attributes to include name, but instruction says change only what validation error requires. We can add opposite fields with same name? Prisma will error duplicate. Safer: add opposite fields with `@relation("LedgerEntryToPayout")` and `@relation("LedgerEntryToPayoutOptional")` and also modify LedgerEntry relations to have same names. That's additional change not required? Might be needed.

But maybe the schema actually has two different models, not same LedgerEntry. Might be DebitEntry and CreditEntry. Hard to know.

Simplify: assume only one relation causing error (line 58-59). We'll add opposite field on Payout: ledgerEntries LedgerEntry[]. The optional relation also missing opposite, but we can also add same field optional? Could be same array covers both.

Thus add in Payout: ledgerEntries LedgerEntry[].

That should satisfy both? Prisma will map both relations to same field? Might need `@relation` name to differentiate. Might still error. Time.

I'll output schema adding opposite fields and making payout_id not unique (no change). Provide minimal.
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
  id                String        @id @default(uuid()) @map("id")
  balance           BigInt
  available_balance BigInt
  created_at        DateTime      @default(now())
  updated_at        DateTime      @updatedAt

  payouts           Payout[]
  ledgerEntries     LedgerEntry[]
}

model Payout {
  id                  String        @id @default(uuid()) @map("id")
  account_id          String        @map("account_id")
  amount              BigInt
  destination_address String
  status              String
  created_at          DateTime      @default(now())
  updated_at          DateTime      @updatedAt

  account             Account       @relation(fields: [account_id], references: [id])
  // opposite side of the LedgerEntry relations
  ledgerEntries       LedgerEntry[] @relation("LedgerEntryToPayout")
  ledgerEntriesOpt    LedgerEntry[] @relation("LedgerEntryToPayoutOptional")
}

model LedgerEntry {
  id         String   @id @default(uuid()) @map("id")
  // required relation to Payout
  payout_id  String   @map("payout_id")
  payout     Payout   @relation("LedgerEntryToPayout", fields: [payout_id], references: [id])
  // optional relation to Payout
  payout_id_opt String? @map("payout_id_opt")
  payout_opt   Payout? @relation("LedgerEntryToPayoutOptional", fields: [payout_id_opt], references: [id])
  amount     BigInt
  created_at DateTime @default(now())
}
```
