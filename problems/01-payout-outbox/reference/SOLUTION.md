# Reference solution — annotated core

Full runnable app optional; this file is the judging anchor. It contains the crux:
schema, creation transaction, and worker.

## schema.prisma (core)

```prisma
model Account {
  id      String @id @default(uuid())
  // Minor units. BigInt everywhere — never floats for money.
  // balance = gross settled balance: changes ONLY on confirmed settlement.
  // held    = sum of active reservations. Available = balance - held.
  balance BigInt
  held    BigInt @default(0)
  payouts Payout[]
}

enum PayoutStatus { CREATED PROCESSING SENT COMPLETED FAILED MANUAL_REVIEW }

model Payout {
  id             String       @id @default(uuid())
  accountId      String
  amount         BigInt
  destination    String
  idempotencyKey String       @unique          // creation idempotency (M5)
  status         PayoutStatus @default(CREATED)
  attempts       Int          @default(0)
  providerRef    String?                        // txHash / endToEndId
  account        Account      @relation(fields: [accountId], references: [id])
}

model OutboxMessage {
  id          String    @id @default(uuid())
  payoutId    String    @unique                 // one message per payout
  processedAt DateTime?                         // consumer dedup marker (M4)
  createdAt   DateTime  @default(now())
}

enum LedgerType { HOLD CAPTURE RELEASE SETTLEMENT }

model LedgerEntry {
  id       String     @id @default(uuid())
  payoutId String
  type     LedgerType
  amount   BigInt
  createdAt DateTime  @default(now())
}
```

## Creation — one transaction, three effects

```ts
async createPayout(dto: CreatePayoutDto) {
  return this.prisma.$transaction(async (tx) => {
    // M5 — retried request returns the existing payout, reserves nothing.
    const existing = await tx.payout.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return existing;

    // M1+M2 — RESERVE: check + hold as ONE atomic act. balance untouched.
    // A SELECT-then-UPDATE would race; the WHERE clause cannot.
    const reserved = await tx.$executeRaw`
      UPDATE "Account" SET "held" = "held" + ${dto.amount}
      WHERE "id" = ${dto.accountId}
        AND "balance" - "held" >= ${dto.amount}`;
    if (reserved === 0) throw new InsufficientFundsError();

    const payout = await tx.payout.create({ data: { ...dto, status: 'CREATED' } });
    await tx.ledgerEntry.create({
      data: { payoutId: payout.id, type: 'HOLD', amount: dto.amount },
    });

    // M3 — outbox INSIDE the same transaction. Atomic with the payout row.
    await tx.outboxMessage.create({ data: { payoutId: payout.id } });
    return payout;
  });
}
```

## Worker — dedup, provider call outside any tx, classify, settle

```ts
async processMessages() {
  const msgs = await this.prisma.outboxMessage.findMany({
    where: { processedAt: null }, take: 10,
  });
  for (const msg of msgs) {
    // M4 — claim the message atomically; a redelivered/raced copy updates 0 rows.
    const claimed = await this.prisma.outboxMessage.updateMany({
      where: { id: msg.id, processedAt: null },
      data: { processedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const payout = await this.markProcessing(msg.payoutId); // guarded transition
    try {
      // Provider call OUTSIDE any DB transaction (graded criterion 2).
      const res = await this.provider.transfer({
        to: payout.destination, amount: payout.amount,
        reference: payout.id,                      // provider-side idempotency
      });
      await this.settle(payout, res);              // M6 below
    } catch (e) {
      await this.handleFailure(payout, e);         // classify (graded 3)
    }
  }
}

// M6 — settlement only on confirmation: capture hold + settle balance + ledger.
async settle(payout: Payout, res: { ref: string }) {
  await this.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "Account"
      SET "held" = "held" - ${payout.amount},
          "balance" = "balance" - ${payout.amount}
      WHERE "id" = ${payout.accountId}`;
    await tx.ledgerEntry.createMany({ data: [
      { payoutId: payout.id, type: 'CAPTURE',    amount: payout.amount },
      { payoutId: payout.id, type: 'SETTLEMENT', amount: payout.amount },
    ]});
    await tx.payout.update({ where: { id: payout.id },
      data: { status: 'COMPLETED', providerRef: res.ref } });
  });
}

// M7 — transient: bounded retries. Exhausted: park, do NOT release the hold.
// Permanent (provider says definitively "no transfer happened"): release.
async handleFailure(payout: Payout, e: unknown) {
  if (isPermanentRejection(e)) return this.release(payout);   // definitive only
  if (payout.attempts + 1 >= MAX_ATTEMPTS)
    return this.park(payout, 'MANUAL_REVIEW');                // human decides
  await this.scheduleRetry(payout);
}
```

## Why not X (common wrong answers)

- **Debit at creation** — passes happy-path tests, loses money on crash between
  debit and provider failure handling.
- **Enqueue to a broker after commit** — lost message = stuck payout; before
  commit = ghost payout.
- **Auto-release on retry exhaustion** — a timeout is not a "no". The transfer
  may have gone through; releasing reopens double payment.
- **`Number` for amounts** — precision loss + `JSON.stringify` on BigInt throws;
  serializer must handle it explicitly.
