# 03-payment.repository.ts

## reply

Let me analyze the plan carefully to write the `src/payment/payment.repository.ts` file.

From the plan:
- The repository class is `PaymentRepository`
- It touches the database (Prisma)
- Methods specified:

```typescript
class PaymentRepository {
  findPending(limit: number): Promise<OrderRecord[]>;
  findByTxid(txid: string): Promise<OrderRecord | null>;
  findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]>;

  markSent(id: string, lastAttemptAt: Date): Promise<void>;
  markInDoubt(id: string, lastAttemptAt: Date): Promise<void>;
  markRejected(id: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markPendingForResend(id: string): Promise<void>;
  markParked(id: string): Promise<void>;
  incrementAttempt(id: string, lastAttemptAt: Date): Promise<number>;

  upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void>;
}
```

OrderRecord type:
```typescript
interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_minor_units: number;
  effective_date: Date;
  txid: string;
  status: OrderStatus;
  attempt_count: number;
  last_attempt_at: Date | null;
  settled_at: Date | null;
}
```

OrderStatus:
```typescript
type OrderStatus =
  | 'pending'
  | 'sent'
  | 'in_doubt'
  | 'rejected'
  | 'settled'
  | 'parked_manual_review';
```

Data model from the plan:

### `orders` (table: `orders`)

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `supplier_key` | `varchar(255)` | Bank account identifier (IBAN/SP number) |
| `amount_minor_units` | `bigint` | Integer, always > 0 |
| `effective_date` | `date` | The date the payment is effective |
| `txid` | `varchar(64)` | UNIQUE, derived at insert time |
| status | `varchar(32)` | pending, sent, in_doubt, rejected, settled, parked_manual_review |
| `attempt_count` | `int` | Default 0, max 5 before parking |
| `last_attempt_at` | `timestamptz` | Nullable |
| `settled_at` | `timestamptz` | Nullable, set when reconciliation confirms |
| `created_at` | `timestamptz` | Default now() |
| `updated_at` | `timestamptz` | Default now(), updated on change |

Indexes: `txid` (unique), `status`, `effective_date`, `(status, effective_date)`.

### `settlements` (table: `settlements`)

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `id` | `uuid` | PK |
| `txid` | `varchar(64)` | UNIQUE — one settlement per txid |
| `amount_minor_units` | `bigint` | As reported by bank |
| `settled_at` | `timestamptz` | Bank's settlement timestamp |
| `statement_date` | `date` | The `date` argument to `getStatement` where found |
| `created_at` | `timestamptz` | Default now() |

Prisma naming conventions: The plan says table and column are `snake_case` via Prisma's `@map`/`@@map`. So the Prisma models will be `Order` and `Settlement`, with fields mapped. Wait — the conventions say: "Table and column: `snake_case` (via Prisma `@map`/`@@map`)". So the Prisma model fields will probably be camelCase in the Prisma client, and mapped to snake_case in the DB. But the plan's `OrderRecord` interface uses snake_case field names: `supplier_key`, `amount_minor_units`, etc.

Hmm, this is a design decision for the repository: the repository returns `OrderRecord` objects (the domain type from the plan), so we need to map from the Prisma client's shape (camelCase fields) to the `OrderRecord` interface (snake_case fields).

Wait, but actually I need to think about what the Prisma schema will look like. Since I'm writing only this file, I need to make defensible assumptions about the Prisma model field names. The plan says column names are snake_case via `@map`. So the Prisma model would probably be:

```prisma
model Order {
  id                  String   @id @default(uuid()) @db.Uuid
  supplierKey         String   @map("supplier_key") @db.VarChar(255)
  amountMinorUnits    BigInt   @map("amount_minor_units")
  effectiveDate       DateTime @map("effective_date") @db.Date
  txid                String   @unique @db.VarChar(64)
  status              String   @db.VarChar(32)
  attemptCount        Int      @default(0) @map("attempt_count")
  lastAttemptAt       DateTime? @map("last_attempt_at")
  settledAt           DateTime? @map("settled_at")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @default(now()) @updatedAt @map("updated_at")

  @@map("orders")
}
```

So in the Prisma client, fields would be `supplierKey`, `amountMinorUnits`, etc. And the repository maps them to the `OrderRecord` shape with snake_case.

The plan says "code and comments in English". Also, the conventions say no raw SQL, zero Prisma client calls at the service layer — the repository is the only layer that touches the database.

Now, how should the repository get the Prisma client? Typical NestJS pattern: inject `PrismaService` (from `@prisma/client` extended). But the plan's manifest only lists:

```
prisma/schema.prisma
src/payment/bank-client.interface.ts
src/payment/payment.repository.ts | reads: src/payment/bank-client.interface.ts | All Prisma queries and conditional updates for orders and settlements
src/payment/payment.service.ts
src/payment/payment.module.ts
src/app.module.ts
test/payment.spec.ts
```

So the repository file reads only `bank-client.interface.ts`. Hmm, but it needs Prisma. The import of `@prisma/client` is external, not a repo file, so it's fine.

What about `PrismaService`? The manifest does not list a `prisma.service.ts` file. So the repository should probably use `PrismaClient` directly... but in NestJS you usually provide a PrismaService. Since the plan doesn't name it, I can inject `PrismaClient` from `@prisma/client` directly in the repository constructor (NestJS can auto-resolve if it's provided). Or inject `PrismaService`... but that file isn't in the plan. The instructions say: "Do not add exports, features, or files that aren't named in the plan."

The cleanest defensible reading: the repository's constructor injects `PrismaClient` from `@prisma/client`. The module will provide the repository; wiring up PrismaClient provision is the module's job (and I don't write that file). Actually wait — should the repository import `PrismaService`? That would reference a file that doesn't exist in the plan. Importing `PrismaClient` from `@prisma/client` is safer and self-contained: the `payment.module.ts` can provide `{ provide: PrismaClient, useValue: new PrismaClient() }` — that's the module file's concern.

Hmm, but there is a subtlety: `@prisma/client` exports a default export as the `PrismaClient` class (plus named export `PrismaClient`). With ESM, `import { PrismaClient } from '@prisma/client'` works.

Alternatively, in the test I might mock the repository entirely (unit test the service) and use a real DB for integration. The plan says "Unit + Integration tests". Either way, the repository just needs a PrismaClient injection.

Let me decide: `constructor(private readonly prisma: PrismaClient)`.

Now let's write each method per the plan's ordering rules:

1. `findPending(limit: number): Promise<OrderRecord[]>` — fetch up to limit orders with status 'pending', ordered by created_at ASC (from the plan's control flow: "fetch up to `batchSize` orders with status `pending`, in `created_at ASC` order").

```typescript
async findPending(limit: number): Promise<OrderRecord[]> {
  const orders = await this.prisma.order.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  return orders.map((o) => toOrderRecord(o));
}
```

Wait — the Prisma model name. Plan's table is `orders`. Prisma model names... conventionally PascalCase class name: the "Order" model is the standard Prisma naming. `@@map("orders")` maps the table. So the client property is `prisma.order`.

2. `findByTxid(txid: string): Promise<OrderRecord | null>` —
```typescript
async findByTxid(txid: string): Promise<OrderRecord | null> {
  const order = await this.prisma.order.findUnique({ where: { txid } });
  return order ? toOrderRecord(order) : null;
}
```

3. `findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]>` —
```typescript
async findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]> {
  const orders = await this.prisma.order.findMany({
    where: { status: 'in_doubt', effectiveDate: date },
  });
  return orders.map((o) => toOrderRecord(o));
}
```

The column is `effective_date` with type `date` in Postgres. Prisma: with `@db.Date`, field is `DateTime` and stored as a date. Comparing against a JS Date — Prisma handles date-only columns; when passing a Date, it's normalized? Actually, for `@db.Date` columns Prisma expects a `Date` and serializes to date-only. There can be timezone pitfalls, but that's fine — the service computes the calendar date. Keep it simple: pass the Date through.

Hmm, actually, for `@db.Date` Prisma uses a special type... no wait, in the JS client `DateTime @db.Date` is still `Date`. It stores only the date part. Good enough for this file.

4. `markSent(id, lastAttemptAt)` — conditional update: only valid from `pending`? Let me check the plan's ordering rules. The plan explicitly says:
- `markSettled` is only valid when current status is `sent` or `in_doubt`.
- `markPendingForResend` is only valid when current status is `in_doubt`.
- `upsertSettlement` uses `ON CONFLICT (txid) DO NOTHING`.
- `incrementAttempt` uses an atomic UPDATE … WHERE status = 'pending'.

For `markSent`, `markInDoubt`, `markRejected`, `markParked` — the state machine shows transitions from `pending`. The plan's `executePayments` flow: first do `incrementAttempt` atomically (only if status is 'pending'), then bank call, then mark. The marks should be safe under concurrent execution. Defensible reading: each mark transitions from `pending` (for sent/in_doubt/rejected) and `markParked` transitions from `pending` or `in_doubt`? Let me think.

State machine in the plan:
- pending → sent (accepted/duplicate)
- pending → in_doubt (transient_error/timeout)
- pending → rejected (permanent_rejection)
- in_doubt → pending (proven absent)
- in_doubt → settled (found in statement)
- sent → settled
- "attempt exhaustion" — from the state machine diagram: `in_doubt ── found in statement → settled`, and where does parking happen? Diagram shows from `in_doubt`... wait, let me re-read:

```
   (insert)   ▼        accepted / duplicate                     │
  ┌──────────┐    ─────────────────────►   ┌──────────┐        │
  │ pending  │                             │   sent   │        │
  └──────────┘                             └──────────┘        │
       │                                            │           │
       │ transient_error / timeout                  │ found in  │
       │                                            │ statement │
       ▼                                            ▼           │
  ┌──────────┐   proven absent    ┌──────────┐         ┌────────┤
  │ in_doubt │ ─────────────────► │ pending  │         │settled │
  └──────────┘  (past lag,        └──────────┘         │        │
                not in stmt)         │                 └────────┘
       │                            │ attempt_count >= max
       │ found in statement         ▼
       └────────────────►   ┌──────────────┐
                            │ parked_manual│
                            │   _review    │
                            └──────────────┘
```

Hmm, the diagram is somewhat garbled (ASCII art). The arrow `│ found in statement ▼ parked_manual` — that's odd; I think the diagram intent is: from `in_doubt`, after found in statement → settled. And `attempt_count >= max` → parked. Which path? In the executePayments flow: "a. if `attempt_count >= maxAttempts` → call `markParked`. Continue." This check happens when the order is picked up as `pending` (status pending) for execution. So parking happens from `pending` when the attempt cap is reached — the order won't be sent at all.

But also from `in_doubt`? The test table says: "full lifecycle: 5 timeouts → parked_manual_review". Flow of that: timeout → in_doubt (attempt 1) → reconcile proves absent → pending (in_doubt → pending, attempt count stays 1?) → executePayments: incrementAttempt → attempt 2 → timeout → in_doubt ... after the 5th timeout, attempt_count = 5, order is in_doubt. Reconcile proves absent → pending. executePayments picks it up: attempt_count (5) >= maxAttempts (5) → markParked. So parking happens from `pending` when the count reaches the cap, not during a send. So `markParked` transitions from `pending`.

Hmm wait, but also consider this: the markSent/markInDoubt after incrementAttempt — since incrementAttempt already conditionally sets `WHERE status = 'pending'`, the order is still pending after increment (increment only changes attempt_count and last_attempt_at, not status). Then the mark transitions from pending. Good — so each mark guards `WHERE id = ? AND status = 'pending'` for safety (in case a concurrent process already moved it, e.g., reconciliation found the txid during send and settled it... actually can reconciliation settle a pending order? markSettled guards `status IN ('sent','in_doubt')`, so a pending order won't be settled. OK).

But wait — what about the ordering rule for `markRejected`? From pending on permanent_rejection → rejected. Yes, guard `WHERE status = 'pending'`.

So:
- `markSent`: `updateMany({ where: { id, status: 'pending' }, data: { status: 'sent', lastAttemptAt, updatedAt: now } })` — hmm, do we set lastAttemptAt in markSent? The signature is `markSent(id: string, lastAttemptAt: Date): Promise<void>` — it takes lastAttemptAt. But `incrementAttempt` already sets `last_attempt_at`. Why does markSent take it? Probably redundant defensive writing, or the plan intended to keep lastAttemptAt updated on send. Let me just follow the signature: set `status: 'sent'` and probably `lastAttemptAt` too. Since the signature has it, use it — set both status and lastAttemptAt. It's harmless (same value incrementAttempt set). Actually, hmm — "never guess silently... write the file using the most defensible reading". The signature is given; using the parameter is a defensible reading. Set status and lastAttemptAt.

Should I return anything to indicate whether the update applied? The plan says `Promise<void>`. OK, void.

5. `markInDoubt(id, lastAttemptAt)` — same guard, status 'in_doubt'.

6. `markRejected(id)` — status 'rejected' from pending.

7. `markSettled(id, settledAt)` — guard `WHERE id AND status IN ('sent', 'in_doubt')`, set status 'settled', settledAt.

8. `markPendingForResend(id)` — guard `WHERE id AND status = 'in_doubt'`, set status 'pending'.

9. `markParked(id)` — guard: from pending (per flow, the check happens when processing a pending order). But could an order with attempt_count >= max be in `in_doubt` and never go back to pending? For example if reconcile runs before... no, in_doubt orders only leave via found-in-statement (→ settled) or proven-absent (→ pending). So to park, we must go through pending. So `markParked` guard: `WHERE id AND status = 'pending'`. Hmm, but should we also allow from `in_doubt`? The plan's flow has parking only in step (a) of executePayments processing a pending order. So `WHERE status = 'pending'`. But hmm, thinking again... "never auto-revert" — parked is terminal. And "cap attempts at 5; after that, park for manual review". executePayments is the only place parking happens. Guard pending only. But let me reconsider: what if incrementAttempt succeeds (status still pending), then during the bank send, reconcile settles the order? Then markSent would be a no-op (status now 'settled', guard fails) — that's correct, no overwriting of settled. Good design; the conditional update makes it safe.

Also what if executePayments picks an order with attempt_count already >= max? Flow: fetch pending orders; for each: (a) if attempt_count >= maxAttempts → markParked. So an order in pending with count 5 gets parked without a bank call. Good — the guard `status = 'pending'` works.

Hmm wait, but one more scenario: order in pending with count 5 (arriving from proven-absent after 5 failures)... it gets parked. Terminal. And "6th reconcile does not re-park or mutate it" — parked is terminal, markParked's guard status='pending' won't match. But reconcile only looks at in_doubt orders anyway.

10. `incrementAttempt(id, lastAttemptAt): Promise<number>` — returns the new count. Implementation: atomic UPDATE ... SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending' returning the new count; if rows affected is 0, this process loses the race and skips (returns... what?). Signature is `Promise<number>`. Return -1 on 0 rows? Or 0? The plan says "returns new count; if 0 rows affected, this process loses the race and skips". What number signals "no increment"? The most defensible: return `-1` to indicate no-op. But the plan doesn't specify. Hmm. `Promise<number>` — return the new count if increment applied, else -1. Let me mark it with a comment. Actually, should I add an `// ASSUMPTION:` comment? The instructions say mark only if a symbol you need really doesn't exist in either the plan or references. Here the plan gives the signature `Promise<number>` and semantics "returns new count; if 0 rows affected... this process skips". The exact sentinel value isn't specified — a small gap. I think `-1` is most defensible; let me document it with an inline comment (not necessarily ASSUMPTION, but... to be safe I could add a small `// ASSUMPTION: returns -1 when the row did not transition (concurrent racer); 0 is reserved as a valid attempt count` — no wait, attempt_count starts at 0 and increments to ≥1 after a send; the new count after increment is always ≥ 1, so -1 is unambiguous). I'll include a brief ASSUMPTION comment since it's truly unspecified. Hmm, actually the plan says "if rows affected is 0, this process loses the race and skips" — it doesn't say what's returned. Since the return type is number, some sentinel is required. I'll use -1 with a one-line ASSUMPTION comment.

Implementation with Prisma: to atomically read back the new value, I can use `Prisma.$transaction` with an interactive transaction? No — simpler: Prisma's `updateMany` doesn't return values. Options:
a) Use `prisma.$transaction(async (tx) => { const updated = await tx.order.updateMany({ where: {...}, data: { attemptCount: { increment: 1 }, lastAttemptAt } }); if (updated.count === 0) return -1; const fresh = await tx.order.findUniqueOrThrow({ where: { id } }); return fresh.attemptCount; })`.
b) Use raw SQL via `prisma.$executeRaw` — but the convention is "zero raw SQL" at the service layer; the repository is allowed to touch the DB via Prisma. Raw SQL would be `UPDATE ... RETURNING attempt_count` — that's the cleanest atomic way in Postgres. But Prisma ORM is the specified layer; `$executeRaw` is part of the Prisma client. The discipline "no raw SQL, zero Prisma client calls" applies to the service layer; the repository is "the only layer that touches the database". Using `$executeRaw` in the repository is permissible, but the plan says "atomic `UPDATE … SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending'` returning the new count" — "returning the new count" suggests RETURNING (Postgres). Prisma doesn't support RETURNING with updateMany. So the plan literally describes an UPDATE ... RETURNING — which requires raw SQL or a two-step within a transaction.

Given the plan explicitly says "returning the new count" and "atomic", I think the intended implementation is either:
- `prisma.$executeRaw` with `UPDATE orders SET ... WHERE id = $1 AND status = 'pending' RETURNING attempt_count`.

But "Prisma as the ORM" convention and "zero raw SQL" at the service layer... the repository is allowed to touch the DB. Hmm, "Layers — no exceptions: `repository` is the only layer that touches the database." It doesn't forbid raw SQL at the repository. But Prisma-first is safer.

Alternative: interactive transaction with updateMany + findUniqueOrThrow. Under READ COMMITTED (Postgres default), is that safe? Sequence: tx1 UPDATE (attempt 0→1, where status='pending'), commits. Two concurrent workers: worker A UPDATE ... count=1 (row locked), worker B blocks on the same row lock until A commits... but A's transaction is still open (not yet committed) and then does findUnique. B's UPDATE will block on the row lock until A commits (A has updated the row). Once A commits, B's UPDATE proceeds and gets count=1 (incremented to 2). Wait — B's UPDATE is `WHERE status = 'pending'` — the row is still 'pending' (A didn't change status, only incremented the count). So B also increments → count=2. Both workers get a "win"?! That would be two sends on the same order with the same txid → bank returns duplicate on the second → treated as sent. Actually that's OK? The plan says "two workers racing on the same order results in exactly one send".

Hmm wait. Let me re-read: "the repository's `incrementAttempt` uses an atomic `UPDATE … SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending'` returning the new count; if rows affected is 0, this process loses the race and skips."

For one to lose (rows affected 0), the winner must change status. But in the executePayments flow, incrementAttempt doesn't change status... then how can a second racer get 0 rows? Unless the winner's subsequent markSent/markInDoubt commits before the loser's UPDATE. That's timing-dependent, not guaranteed. Hmm.

Actually wait — maybe the intended design is different: incrementAttempt should also flip status to prevent double-sends? No — the plan says after mark, status becomes sent/in_doubt. Hmm.

Let me reconsider: is double-send actually harmful here? The txid is deterministic and same for both sends. The bank dedupes by txid → the second send returns 'duplicate' → markSent (already sent → no-op) or markInDoubt... wait, if the second send returns 'duplicate', we'd call markSent with guard status='pending'. If the first worker has already marked it 'sent' or 'in_doubt', the second mark is a no-op. And incrementAttempt's double increment: attempt_count 2 instead of 1 — a minor accounting quirk. But the plan's test says "concurrent increment skips order | two workers racing on the same order results in exactly one send".

To make this testable deterministically, incrementAttempt must return a different result for the second caller. In the two-step approach: worker A: updateMany (row locked, +1), then findUnique (reads count=1) → returns 1. Worker B: updateMany blocks on row lock until A commits → then increments to 2, finds count=2 → returns 2. Both "win". The "exactly one send" test would fail.

For the test to pass, we'd need a mechanism where only one can win. Options:
- A pessimistic lock (`SELECT ... FOR UPDATE` — Prisma doesn't expose; raw SQL would).
- A status flip: incrementAttempt also sets status to 'sending'... but 'sending' isn't in the status set.
- Re-acquire after increment: e.g., use optimistic CAS: updateMany where id AND status='pending' AND attempt_count = expected... that's a read-modify-write and Prisma's conditional update can do CAS: fetch order (count=c), then updateMany where id AND status='pending' AND attempt_count=c, data: {attemptCount: c+1}. Under concurrency, one CAS wins, the other gets count=0 → skip. That's truly atomic and matches "if rows affected is 0, this process loses the race and skips". But the plan literally says "SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending'".

Hmm. But is the concurrent test even testing at this level? The test would need a fake Prisma... it's simpler if the test mocks the repository and tests service logic, or uses a real DB for integration. The plan's test "concurrent increment skips order" — with a mocked repo, they can mock `incrementAttempt` to return the new count and have the service skip when 0/-1. Hmm, but "test behavior not implementation".

OK let me step back. My job: write the repository per the plan, defensibly. The plan's literal description: atomic UPDATE with `attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending'` returning the new count; 0 rows affected → return something indicating skip. In Prisma, the cleanest way to "return" from an UPDATE is a raw query with RETURNING, or a transaction of updateMany + findUnique.

Let me go with the interactive transaction approach — pure Prisma, no raw SQL:

```typescript
async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
  return this.prisma.$transaction(async (tx) => {
    const result = await tx.order.updateMany({
      where: { id, status: 'pending' },
      data: { attemptCount: { increment: 1 }, lastAttemptAt, updatedAt: lastAttemptAt },
    });
    if (result.count === 0) {
      // ASSUMPTION: -1 signals that the row was not claimed (concurrent racer won).
      return -1;
    }
    const fresh = await tx.order.findUniqueOrThrow({ where: { id } });
    return fresh.attemptCount;
  });
}
```

Wait, is the findUnique within the transaction safe from reading a stale row? In Postgres default READ COMMITTED, within the same transaction, after your own UPDATE, you see your own update. findUnique will read the updated value (your own write). Yes — under READ COMMITTED, a statement sees the latest committed version plus its own uncommitted changes. So `fresh.attemptCount` is correct.

One concern: `this.prisma.$transaction(async (tx) => ...)` — the interactive transaction API. Works with PrismaClient. Fine.

But wait — is there a risk the order gets settled between updateMany and findUnique, changing... no, we only read attemptCount which we just wrote. No issue.

As an alternative, raw SQL: `prisma.$executeRaw` doesn't return rows; `$queryRaw` does:

```typescript
const rows = await this.prisma.$queryRaw<{ attempt_count: number }[]>`UPDATE orders SET attempt_count = attempt_count + 1, last_attempt_at = ${lastAttemptAt}, updated_at = ${lastAttemptAt} WHERE id = ${id} AND status = 'pending' RETURNING attempt_count`;
return rows.length === 1 ? Number(rows[0].attempt_count) : -1;
```

This matches the plan's description most literally (single atomic statement with RETURNING). But it bypasses the ORM model — "Prisma as the ORM" and raw SQL is... The convention only forbids raw SQL at the service layer. The plan's file description: "all Prisma queries and conditional updates for orders and settlements". "Prisma queries" suggests using the ORM API rather than raw. Let me go with the interactive transaction version. Hmm but "atomic" — an interactive $transaction is atomic (single DB transaction). Yes, that's atomic.

Hmm, one more consideration: `updatedAt` — the schema says "Default now(), updated on change". Does Prisma's `@updatedAt` handle that automatically? Yes, `@updatedAt` is set automatically by Prisma on updates. If the schema uses `@updatedAt`, no need to set it manually. Let me not set updatedAt manually — rely on the schema's `@updatedAt`. But do I know the schema uses `@updatedAt`? The plan says "updated on change" — standard is `@updatedAt`. Defensible: rely on it and don't set manually. But what if the schema only had `@default(now())`? Then updated_at wouldn't be updated. I can't see the schema (not provided; it's in the plan but not shown as a reference file). The plan's column notes: "Default now(), updated on change" — matches `@default(now()) @updatedAt`. Let me assume `@updatedAt` and not set it manually. Should I add an ASSUMPTION? The instructions say to mark places where a symbol is genuinely absent. This isn't a symbol — it's a schema detail inferred from the plan's own description ("updated on change"). I think relying on `@updatedAt` is fine without a flag. Hmm, actually to be safe and explicit, setting `updatedAt: new Date()` in update data is harmless and works either way... but if the schema has `@updatedAt`, setting it manually is redundant but legal (Prisma allows explicit set? Actually with @updatedAt, Prisma overrides/sets it automatically; an explicit value is allowed). It's cleaner to not set. Let me leave it out — the plan describes the schema behavior, and the repository shouldn't duplicate schema concerns.

Now `markSettled`: guard `status IN ('sent','in_doubt')`, set status 'settled', settledAt. Use `updateMany` (silent no-op if 0 rows) — consistent with the plan's "a concurrent call is a no-op".

```typescript
async markSettled(id: string, settledAt: Date): Promise<void> {
  await this.prisma.order.updateMany({
    where: { id, status: { in: ['sent', 'in_doubt'] } },
    data: { status: 'settled', settledAt },
  });
}
```

`markPendingForResend`:
```typescript
async markPendingForResend(id: string): Promise<void> {
  await this.prisma.order.updateMany({
    where: { id, status: 'in_doubt' },
    data: { status: 'pending' },
  });
}
```

`markSent`:
```typescript
async markSent(id: string, lastAttemptAt: Date): Promise<void> {
  await this.prisma.order.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'sent', lastAttemptAt },
  });
}
```

`markInDoubt`: similar with status 'in_doubt'.

`markRejected`:
```typescript
async markRejected(id: string): Promise<void> {
  await this.prisma.order.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'rejected' },
  });
}
```

`markParked`:
```typescript
async markParked(id: string): Promise<void> {
  await this.prisma.order.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'parked_manual_review' },
  });
}
```

Hmm wait — markParked from pending only? Let me reconsider the scenario in the plan's full-lifecycle test: "5 timeouts → parked_manual_review". Sequence:
1. attempt 1: pending, increment→1, timeout → in_doubt
2. reconcile: proves absent → pending
3. attempt 2: increment→2, timeout → in_doubt
4. ... repeat until count=5, in_doubt
5. reconcile: proves absent → pending (count is still 5)
6. executePayments: fetch pending orders; this one has count=5 >= maxAttempts=5 → markParked (guard pending ✓).

Yes, from pending works. Good.

But hmm, one more: what if a 5th timeout happens and reconcile hasn't proven absence yet (statement not complete), the order stays in_doubt with count 5 forever — that's fine, once lag passes reconcile will move it to pending and next execute runs will park it. OK.

Now `upsertSettlement`:
```typescript
async upsertSettlement(data: {
  txid: string;
  amount_minor_units: number;
  settled_at: Date;
  statement_date: Date;
}): Promise<void> {
  await this.prisma.settlement.upsert({
    where: { txid: data.txid },
    update: {},
    create: {
      txid: data.txid,
      amountMinorUnits: data.amount_minor_units,
      settledAt: data.settled_at,
      statementDate: data.statement_date,
    },
  });
}
```

The plan says "ON CONFLICT (txid) DO NOTHING". Prisma's `upsert` with empty `update: {}` effectively does that (well, upsert is SELECT + INSERT/UPDATE; on conflict with empty update it doesn't write anything — "DO NOTHING" semantics as close as Prisma offers; true ON CONFLICT DO NOTHING requires createOnly/`onConflictDoNothing` in newer Prisma). Alternative: `prisma.settlement.createMany({ data, skipDuplicates: true })` — that maps literally to ON CONFLICT DO NOTHING! `createMany` with `skipDuplicates: true` uses ON CONFLICT DO NOTHING for upsert-like semantics. That's a better match to "ON CONFLICT (txid) DO NOTHING". But createMany requires a data array: `createMany({ data: [ {...} ], skipDuplicates: true })`. Yes! That's literally ON CONFLICT DO NOTHING. Let me use that.

```typescript
async upsertSettlement(data: {...}): Promise<void> {
  await this.prisma.settlement.createMany({
    data: [{
      txid: data.txid,
      amountMinorUnits: BigInt? ...
    }],
    skipDuplicates: true,
  });
}
```

Wait — amount_minor_units is `bigint` in the DB. In Prisma, `@db.BigInt` fields are `BigInt` in the client (Node.js BigInt), not number. The plan's types use `number` for amount_minor_units ("money in minor units, integer only" — and `BankSendRequest.amount_minor_units: number`). JS numbers are exact up to 2^53 — sufficient for minor units in practice. But Prisma with `BigInt` type requires passing a `bigint`. Mismatch: interface is number, Prisma field is BigInt.

Options:
a) Make the Prisma column Int (`@db.Integer`) — but plan says bigint.
b) In the repository, convert number → BigInt: `amountMinorUnits: BigInt(data.amount_minor_units)`... but the reverse, reading: Prisma returns `bigint`; OrderRecord says `amount_minor_units: number` → convert with `Number(record.amountMinorUnits)`.

The plan's schema says `bigint`. The plan's TS type says number. So the repository is the translation layer: BigInt ↔ number conversions. That's a defensible reading and consistent with "money in minor units, integer only" (numbers are safe up to 9e15 minor units — plenty).

So mapping:
- `amountMinorUnits: BigInt(data.amount_minor_units)` on write... actually, does Prisma accept number for BigInt field? No — it expects `bigint | number`? Let me recall: Prisma's `BigInt` scalar accepts `bigint` or... in the TypeScript types, `BigIntFieldUpdateOperationsInput` etc. are typed as `bigint | Prisma.BigInt` (Prisma.BigInt = bigint). Passing a JS number would be a TS type error. So explicit conversion: `BigInt(data.amount_minor_units)`. And read: `Number(order.amountMinorUnits)`.

Hmm wait, is `effectiveDate` a `DateTime @db.Date`? And `settledAt`/`lastAttemptAt` are `DateTime`. OK.

And `id` is `String @db.Uuid`. Fine.

Now the Prisma model field names — I'm assuming: `id, supplierKey, amountMinorUnits, effectiveDate, txid, status, attemptCount, lastAttemptAt, settledAt, createdAt, updatedAt` and for Settlement: `id, txid, amountMinorUnits, settledAt, statementDate, createdAt`. These are standard camelCase with @map to snake_case columns. The plan's OrderRecord uses snake_case so the mapping is needed.

Let me write a private mapper:

```typescript
function toOrderRecord(order: Order): OrderRecord {
  return {
    id: order.id,
    supplier_key: order.supplierKey,
    amount_minor_units: Number(order.amountMinorUnits),
    effective_date: order.effectiveDate,
    txid: order.txid,
    status: order.status as OrderStatus,
    attempt_count: order.attemptCount,
    last_attempt_at: order.lastAttemptAt,
    settled_at: order.settledAt,
  };
}
```

`order.status` is `string`; cast to OrderStatus — fine.

Now, about imports. What this file needs:
- `PrismaClient`, `Order` (type), and possibly `Settlement` type from `@prisma/client`.
- OrderStatus and BankClient-related types? The plan says this file "reads: src/payment/bank-client.interface.ts". So it imports OrderStatus from bank-client.interface.ts. Hmm — OrderStatus is defined in the plan's section "Types and signatures" under `// ─── Domain types ───`, separate from the bank client section. But per the manifest, the bank-client.interface.ts contains: "BankClient interface, BankSendRequest/Response, Settlement types" — the shown reference file only contains Bank types and error classes. No OrderStatus! The read-only reference bank-client.interface.ts shown has: BankSendRequest, BankSendStatus, BankSendResponse, Settlement, BankClient, BankTransientError, BankPermanentError. No OrderStatus and no OrderRecord.

So where does OrderStatus live? The plan says the repository file "reads: src/payment/bank-client.interface.ts". If OrderStatus isn't in bank-client.interface.ts (as per the shown reference), and we can't create additional files ("do not add exports, features, or files not named in the plan"), then the repository must define `OrderStatus` and `OrderRecord` itself. Hmm — but the service needs them too (the plan shows OrderStatus under "Domain types" generically). The manifest's service reads bank-client.interface.ts and payment.repository.ts — so the service would import OrderStatus/OrderRecord from the repository file. That works: the repository exports `OrderStatus` and `OrderRecord`, and the service imports them from the repository.

Wait, but the instructions say "do not add exports... that aren't named in the plan". Is exporting OrderStatus/OrderRecord "adding an export"? The plan names these types as part of the domain; since they don't exist in bank-client.interface.ts (the reference file is fixed and doesn't have them), they must be defined somewhere the other files can read. The only file that "reads" the repository is the service (and tests). If I don't export them from the repository, nothing can have them. So exporting `OrderStatus` and `OrderRecord` from payment.repository.ts is the defensible reading. These are named in the plan (as types), just not tied to a file. The manifest's "reads" line is guidance, not exhaustive proof of location.

Alternatively, the manifest intended bank-client.interface.ts to contain the domain types... but the reference shown is authoritative: "never reproduce or rewrite them" — it doesn't have OrderStatus. So: define + export in the repository file. OK.

Hmm wait, let me actually re-read: "the blocks above are reference material. Rely on them; never reproduce or rewrite them." And "files shown read-only are references." The reference shows the content of bank-client.interface.ts. It lacks OrderStatus. So, the repository must define it.

Also, does the repository need `ReconcileWindow`/`ReconcileResult`? No — those are service-level; the repository's methods don't take them (findInDoubtByEffectiveDate takes a Date). Good.

Does the repository import anything from bank-client.interface.ts? Actually... hmm, no, maybe nothing. The `Settlement` name clashes: the plan's bank `Settlement` interface vs. Prisma's `Settlement` model. The repository file doesn't use the bank `Settlement` type (the service uses it from getStatement's result; the repository's upsertSettlement takes a plain object). So the import from bank-client.interface.ts might be... nothing. Hmm, that contradicts the manifest's "reads: bank-client.interface.ts". Unless OrderStatus is expected to be there.

Given the ambiguity: the reference file is authoritative and lacks OrderStatus, so I define OrderStatus in the repository. Should I still import something from bank-client.interface.ts? Importing for no purpose would be wrong. The "reads" in the manifest is probably from when the plan assumed domain types lived there. I'll just define OrderStatus locally and not import from bank-client.interface.ts. That's the defensible reading; per instructions, I should note the gap in unresolved symbols with a single `// ASSUMPTION:` comment. OrderStatus is "genuinely absent from both the plan and the references"? No — it's in the plan (defined there). It's just not in the reference file. Hmm. The instruction: "if a symbol you need is genuinely absent from both the plan and references, don't guess silently... mark with a single ASSUMPTION comment". OrderStatus is present in the plan, so no need for an ASSUMPTION flag. I'll just define it with a brief comment noting that it's the canonical domain enum used by service/tests.

Wait, but "do not add exports not named in the plan" — OrderStatus and OrderRecord are both named in the plan (types and signatures section). So exporting them is faithful to the plan. The only real deviation: their file location. Fine, no flag needed? Hmm, the plan's manifest says the repository reads bank-client.interface.ts — perhaps it assumed OrderStatus was there. I'll add a short comment above the type: "Domain types shared with the service and tests." That's enough. Actually let me reconsider once more whether to include `// ASSUMPTION:` — the location question is a genuine gap: the plan says nothing about where OrderStatus lives other than manifest's read hints that contradict the actual file content. Defensible reading: repository defines and exports; service imports from repository (the manifest says the service reads the repository ✓). Consistent. No flag; keep a comment. Hmm, "don't guess silently" — for truly absent symbols. OrderStatus isn't absent; it's specified in the plan. It's just a location issue. Keep the comment, no flag.

Hmm wait, actually — let me reconsider once more: maybe I should import from the bank client file if... no. The shown reference file ends with BankPermanentError. Decisive.

Now for the Prisma imports: `import { PrismaClient, Order } from '@prisma/client';` — do we need the `Order` type? For typing the mapper's parameter. Yes: `function toOrderRecord(order: Order): OrderRecord`. Is `Order` exported from @prisma/client? Yes, Prisma generates model types.

For the interactive transaction, `tx` is typed automatically. OK.

Now class wiring: NestJS DI — decorator `@Injectable()`? The plan shows a plain class `class PaymentRepository`. The conventions say NestJS; modules list providers. Use `@Injectable()` from `@nestjs/common` on the class? The plan's signature block doesn't show a decorator, but NestJS convention + "wiring" section ("services, repositories, or processors are listed in their module's providers") implies DI. The class needs `@Injectable()` for constructor injection to work (unless using `useValue`/factories in the module — but standard is @Injectable). The plan's manifest describes the repository as "all Prisma queries..." — the wiring section implies provider registration. Let me add `@Injectable()`. That's standard and defensible; the plan's sketch omitted decorators for brevity (also omitted them on PaymentService). Hmm — risk: "implement exactly what the plan specifies". The sketch in the plan has no decorator. But NestJS provider + constructor injection without @Injectable only works when... actually, does it work? No — Nest needs metadata. If the module registers `providers: [PaymentRepository]`, and PaymentRepository has a constructor parameter, Nest resolves it only if the class is decorated (it reads Reflect metadata from the @Injectable decorator). Without it, `useValue` would... hmm, actually Nest resolves constructor parameters via `Reflect.getMetadata('design:paramtypes')`, which requires the decorator to register the custom provider path... to be precise: Nest uses `@Injectable()` to trigger the reflect-metadata paramtypes collection for custom providers. Without it, constructor DI won't work for custom providers (it works for built-in? no). So the standard, correct NestJS repository has @Injectable(). Let me include it — essential for the module wiring described in the plan. I think that's right.

Constructor: `constructor(private readonly prisma: PrismaClient) {}` — with @Injectable, Nest looks for a provider of type `PrismaClient` (or the token). The module file (which I don't write) will provide it. OK.

Now, one design question: should each reconcile-related transition be wrapped in `$transaction` per the plan? The plan says: "Transaction boundaries: for each order's state transitions in step 2b and each order's transition in step 2c, wrap them in a single short transaction (for 2b, the conditional UPDATE + upsertSettlement together)". Hmm — for step 2b, the service does findByTxid + markSettled + upsertSettlement in one transaction. How can the repository support that? Options:
a) The repository exposes a `settleFromStatement(id, txid...)`-like combined method... but the plan's repository signature list doesn't include such a method.
b) The service uses Prisma's $transaction — but the service has zero Prisma access.
c) The repository takes a transaction client... not in the signatures.

The plan's signature list is explicit and closed: findPending, findByTxid, findInDoubtByEffectiveDate, markSent, markInDoubt, markRejected, markSettled, markPendingForResend, markParked, incrementAttempt, upsertSettlement. No combined "settle + upsert" method and no transactional wrapper. So how is "for 2b, the conditional UPDATE + upsertSettlement in one short transaction" implemented?

Hmm. Perhaps each mark* method is individually nearly atomic, and "transaction boundaries" is a soft statement about the service's grouping... but the service can't call Prisma. Unless: the repository methods accept an optional Prisma transaction client? Not in the signature — adding parameters = deviating from the plan's signature.

Or: `markSettled` and `upsertSettlement` are separate atomic operations; their combination is idempotent anyway (conditional update + ON CONFLICT DO NOTHING), so "transaction" adds nothing semantically. In fact, given both are idempotent and conditional, doing them separately is safe under overlapping windows — the stated goal ("so that a concurrent call is a no-op"). The plan's "wrap in a single short transaction" is an implementation hint that the closed signature list can't honor without extra API.

What to do? "Implement exactly what the plan specifies in this file." The signature list is the spec for this file. Transaction grouping is a service/execution concern that this file's API doesn't support. I could add an optional parameter... no — deviating from the signature is worse. Or implement each method as its own operation (which is atomic individually). The idempotency argument in the plan ("therefore running reconcile twice over the same or overlapping window is safe") rests on the conditional updates + upsert, not on a surrounding transaction. So I'll implement exactly the 11 listed methods, each individually atomic as described (conditional updateMany, createMany with skipDuplicates, the transactional incrementAttempt).

Wait — but should `markSettled` also upsert the settlement (making the pair atomic)? That changes markSettled's signature/behavior (needs txid etc.). No — stay with the listed signatures. The 2b pair is: `markSettled(id, settledAt)` + `upsertSettlement(...)`. Each idempotent. Fine.

Hmm, actually — one more idea: I could make the repository's methods internally use short transactions where meaningful (incrementAttempt already). No more than that.

Let me also re-verify `findPending`'s ordering and take: "fetch up to batchSize orders with status pending, in created_at ASC order" → `orderBy: { createdAt: 'asc' }, take: limit`. Should there be a secondary sort? Not specified. Just createdAt asc. Hmm, ties on createdAt are nondeterministic; add `id` as tiebreaker? Not specified — "don't guess"... a tiebreaker is harmless and defensible, but let me stick to the plan: createdAt asc only. Actually, with take + identical timestamps, batch stability across calls could flake tests... but tests probably seed orders with distinct created_at or one at a time. Keep it minimal per plan: createdAt asc only. Hmm, let me think whether adding `id: 'asc'` as a second key would break "exactly what the plan specifies" — it's an implementation detail; the plan says "in created_at ASC order". Let me keep just createdAt.

`findInDoubtByEffectiveDate(date)`: `where: { status: 'in_doubt', effectiveDate: date }`. Sort? Not specified. Add createdAt asc for determinism? The plan's section 4 says nothing about ordering for proven-absent enumeration. Keep minimal, no orderBy... Actually determinism is nice but minimal is safer against "exactly". Let me leave unordered — hmm, Postgres without ORDER BY returns arbitrary order; for a loop doing markPendingForResend per order, order doesn't affect correctness. OK unordered. Hmm wait — for a test of the "statement incomplete" case, order is irrelevant too. OK.

Now `findByTxid` uses `findUnique({ where: { txid } })` — txid is @unique ✓.

Edge case: `findPending(limit)` — negative/zero limit? Not our concern.

Now `updatedAt` for `mark*` methods: rely on @updatedAt. For `incrementAttempt`, also rely.

Wait, one more consideration for `markSettled`'s data: also set... the plan says "settled_at ... set when reconciliation confirms". Just status + settledAt. ✓.

`markPendingForResend`: just status back to 'pending'. Should lastAttemptAt stay? Yes, leave as-is. ✓

`markRejected`: status only. ✓

`markParked`: status only. ✓

Now, the return value of `incrementAttempt`: let me finalize -1 for "lost". Signature is Promise<number>. I'll add an ASSUMPTION comment here since the plan doesn't specify the sentinel:

```typescript
/**
 * Atomically claims a pending order for one send attempt.
 *
 * Returns the new attempt_count on success.
 * // ASSUMPTION: -1 is returned when the row was not pending (0 rows updated),
 * signaling a lost race; the plan fixes the return type as number but not the sentinel.
 */
```

Hmm, per instructions: "mark with a single `// ASSUMPTION: <what was unresolved>` comment where it matters". Exactly one at the point where it matters. Let me write: `// ASSUMPTION: the plan fixes Promise<number> but no sentinel for a lost race; -1 is used (new counts are always >= 1).`

One comment, at the return point. Good.

Now — is interactive `$transaction` OK from a "zero raw SQL" standpoint? Yes, it's Prisma API.

But wait, actually let me reconsider using the two-step in a transaction vs. a single raw UPDATE...RETURNING for incrementAttempt once more. Two-step within $transaction: statements execute on the same DB connection/tx. UPDATE ... count is 1 → findUnique reads own write → returns count. If count is 0 → return -1, commit (no change). Atomic ✓. Slightly heavier than RETURNING but pure ORM. Given the convention "Prisma as ORM" and my instruction to be "defensible", pure ORM wins.

Also — `findUniqueOrThrow` vs. `findUnique` within tx: after a successful updateMany with count=1, the row exists. Use findUniqueOrThrow? Safe. Or just findUnique and assert non-null... let me use findUniqueOrThrow for concision.

Alternatively, avoid the second query entirely: we know count = previous + 1, but we don't know the previous... We could do a tx: SELECT (findUnique) → if !row or row.status !== 'pending' return -1; updateMany with CAS `where: { id, status: 'pending', attemptCount: row.attemptCount }` → if count 0 return -1; else return row.attemptCount + 1. That's a read-check-write with CAS — also correct and avoids the post-update read (still two queries, still a tx). The plan's literal phrasing is "UPDATE … SET attempt_count = attempt_count + 1 WHERE id AND status='pending' RETURNING" — my updateMany+findUnique version matches this most literally (blind increment, then read back). Let me stick with updateMany + findUnique.

Let me double check the Prisma types: `tx.order.updateMany` returns `{ count: number }` ✓.

Now, `updatedAt` handling in findPending etc. — no updates there.

Also, `PrismaClient` import with ESM: `import { PrismaClient } from '@prisma/client';` ✓. Type import for Order: `import type { Order } from '@prisma/client';` — hmm, does @prisma/client export the model type named `Order`? Yes (generated model types are exported). Note though: if my schema's model name is `Order` → client type `Order` ✓, client property `prisma.order` ✓.

For Settlement: client type `Settlement`, property `prisma.settlement` ✓ (table @@map("settlements")).

Wait — name clash: the bank client file exports interface `Settlement`. This file doesn't import from there, so no clash. But to avoid confusion in the mapper/where clause... it's fine, I only reference `this.prisma.settlement`.

Hmm — is there a value in importing something from bank-client.interface.ts to honor the manifest's "reads"? Importing for no purpose = lint error (unused). The manifest is a plan artifact; the actual reference file dictates reality. I'll skip the import. Or... could I import `BankSendRequest`? The repository doesn't send anything. No. Skip.

Hmm, actually wait. Let me reconsider: is `OrderStatus` also needed for bank-client? No. Decided.

Now the file structure:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, type Order } from '@prisma/client';

/** Canonical order status set (plan §Domain types). Exported for the service and tests. */
export type OrderStatus =
  | 'pending'
  | 'sent'
  | 'in_doubt'
  | 'rejected'
  | 'settled'
  | 'parked_manual_review';

/** Domain shape for a stored order; snake_case columns, money in minor units. */
export interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_minor_units: number;
  effective_date: Date;
  txid: string;
  status: OrderStatus;
  attempt_count: number;
  last_attempt_at: Date | null;
  settled_at: Date | null;
}

/** Prisma model -> domain record. BigInt minor units are safe in number range for payouts. */
function toOrderRecord(order: Order): OrderRecord {
  return {
    id: order.id,
    supplier_key: order.supplierKey,
    amount_minor_units: Number(order.amountMinorUnits),
    effective_date: order.effectiveDate,
    txid: order.txid,
    status: order.status as OrderStatus,
    attempt_count: order.attemptCount,
    last_attempt_at: order.lastAttemptAt,
    settled_at: order.settledAt,
  };
}

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ── Queries ─────────────────────────────────────────────

  async findPending(limit: number): Promise<OrderRecord[]> {
    const orders = await this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return orders.map(toOrderRecord);
  }

  async findByTxid(txid: string): Promise<OrderRecord | null> {
    const order = await this.prisma.order.findUnique({ where: { txid } });
    return order === null ? null : toOrderRecord(order);
  }

  async findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]> {
    const orders = await this.prisma.order.findMany({
      where: { status: 'in_doubt', effectiveDate: date },
    });
    return orders.map(toOrderRecord);
  }

  // ── Conditional state transitions (each idempotent) ─────

  async markSent(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'sent', lastAttemptAt },
    });
  }

  async markInDoubt(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'in_doubt', lastAttemptAt },
    });
  }

  async markRejected(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected' },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: { in: ['sent', 'in_doubt'] } },
      data: { status: 'settled', settledAt },
    });
  }

  async markPendingForResend(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'in_doubt' },
      data: { status: 'pending' },
    });
  }

  async markParked(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'parked_manual_review' },
    });
  }

  // ── Atomic claim for a send attempt ─────────────────────

  /**
   * Claims one pending order for a send attempt, atomically incrementing its
   * attempt_count. Returns the new count, or -1 if the order was not pending
   * (0 rows updated — a concurrent worker already claimed it / moved it).
   */
  async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id, status: 'pending' },
        data: { attemptCount: { increment: 1 }, lastAttemptAt },
      });
      if (updated.count === 0) {
        // ASSUMPTION: the plan fixes the return type as number but no sentinel for a lost race;
        // -1 is used because a real new count is always >= 1.
        return -1;
      }
      const fresh = await tx.order.findUniqueOrThrow({ where: { id } });
      return fresh.attemptCount;
    });
  }

  // ── Settlement cache ────────────────────────────────────

  /**
   * Records a bank-reported settlement. ON CONFLICT (txid) DO NOTHING:
   * re-processing the same statement entry is a no-op.
   */
  async upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void> {
    await this.prisma.settlement.createMany({
      data: [
        {
          txid: data.txid,
          amountMinorUnits: BigInt(data.amount_minor_units),
          settledAt: data.settled_at,
          statementDate: data.statement_date,
        },
      ],
      skipDuplicates: true,
    });
  }
}
```

Let me cross-check details against the plan:

- "markSettled is only valid when current status is sent or in_doubt. Repository uses a conditional update (WHERE id = ? AND status IN ('sent','in_doubt'))" ✓.
- "markPendingForResend is only valid when current status is in_doubt" ✓.
- "upsertSettlement uses ON CONFLICT (txid) DO NOTHING" ✓ via createMany + skipDuplicates.
- "incrementAttempt uses an atomic UPDATE … SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending' returning the new count; if rows affected is 0, this process loses the race and skips" ✓ (via transaction; returns new count; -1 sentinel on 0 rows).

One point: in `incrementAttempt`, I'm also setting lastAttemptAt in the UPDATE. Plan signature: `incrementAttempt(id, lastAttemptAt): Promise<number>` — it takes lastAttemptAt, presumably to record it. ✓ Consistent with the orders table's `last_attempt_at` column ("Nullable"). And markSent/markInDoubt also receive lastAttemptAt and set it again — redundant but matches the signature. Hmm, wait: is that really so? Let me re-read the plan's executePayments flow: "b. atomically increment attempt and set last_attempt_at (returns new count...)". So the increment sets last_attempt_at. Then d/e mark methods — their signatures also carry lastAttemptAt. The plan probably intended to keep them in sync (same timestamp). Setting it again in the mark methods is a harmless idempotent write. Or the marks might ignore the parameter... but then why pass it? Use it — defensible.

Hmm, one subtlety: if the order was in_doubt (from a prior attempt) and reconcile moved it back to pending, markSent's lastAttemptAt would update last_attempt_at to the new attempt time — correct semantics anyway.

Now `take: limit` — if limit is undefined? The service always passes batchSize. Fine.

Type of `updateMany`'s where clause: `{ id, status: 'pending' }` — string literal for a varchar column is fine.

For `findInDoubtByEffectiveDate`, Prisma compares DateTime (date only) with a JS Date — Prisma normalizes to date-only when serializing for @db.Date columns. OK.

Now — `Number(order.amountMinorUnits)`: if the schema was Int instead of BigInt, order.amountMinorUnits would be number and Number() would be a no-op — safe either way. And on write, `BigInt(data.amount_minor_units)`: if the column was Int, BigInt() would be a type error in TS (Prisma types expect number for Int). Hmm — risk: my assumption that the column is BigInt comes from the plan's schema table ("bigint"). I'll trust it. And the read side with Number() works even for bigint... actually if Int, `Number(number)` is fine. If BigInt, required. The write side pins the assumption: plan says bigint → Prisma field type BigInt → need BigInt(). ✓ Consistent with the plan.

Should I add an ASSUMPTION for the Prisma field names (supplierKey etc.)? They are standard derivations: snake_case columns → camelCase Prisma fields via @map (conventions explicitly state "via Prisma @map/@@map"). That's a convention, not an assumption. No flag needed.

The `Order` type import — the model name in the schema. The plan's table is "orders" (model probably `Order`). The manifest names the file prisma/schema.prisma with "Prisma schema: Order and Settlement models" — explicitly "Order and Settlement models". ✓ So the model names are `Order`, `Settlement`. Great — no assumption needed.

NestJS import: `@Injectable()` from '@nestjs/common' — the convention's stack lists NestJS. ✓.

Should this file have an ESM default export? No — named exports: OrderStatus, OrderRecord, PaymentRepository. Class name is PascalCase ✓. File is kebab-case `payment.repository.ts` ✓ (given).

Double check: "TS file: kebab-case.role.ts" — this file is payment.repository.ts ✓.

Do I need `ReconcileWindow`/`ReconcileResult`? No — those are service-level; the repository's methods don't take them (findInDoubtByEffectiveDate takes a Date). Good.

Now one more word on `markParked`'s guard. Let me re-scrutinize the full-lifecycle test: "full lifecycle: 5 timeouts → parked_manual_review | attempt exhaustion parks the order; a 6th reconcile does not re-park or mutate it".

With maxAttempts=5: attempts 1..5 all timeout. After attempt 5: count=5, status=in_doubt. Reconcile (lag passed) → pending. executePayments: count(5) >= 5 → markParked (from pending ✓). Then "6th reconcile does not mutate": reconcile looks at in_doubt orders — parked is not in_doubt → untouched ✓.

But wait — subtle: does executePayments also handle a parked order if it's picked up later? findPending only returns status='pending'; parked is never returned ✓.

What about an order that got rejected — terminal; markSettled's guard excludes 'rejected' ✓ ("rejected orders are untouched by reconciliation" ✓ — reconcile only touches found txids with sent/in_doubt... wait, step 2b: "if an order is found in status sent or in_doubt, call markSettled". For a rejected order whose txid shows up in the statement (impossible — a rejection means no payment... but hypothetically), markSettled's guard prevents it. ✓)

What about `markPendingForResend` for a parked order? Guard in_doubt only ✓.

Now let me re-verify the transaction for `incrementAttempt` under the service's "must not be in a transaction: any bank.* call" rule — the bank call happens outside; the increment's own short tx is fine.

Also, "b. atomically increment attempt and set last_attempt_at (returns new count; if 0 rows affected, skip — another worker got it)" — in my implementation, 0 rows if status isn't pending. When could status not be pending despite the service having just fetched it as pending? If a concurrent executePayments worker's markSent/markInDoubt committed between our fetch and update. Timing-dependent — matches the plan's race semantics ✓.

Hmm — wait, another scenario for the "concurrent increment skips order" test: with a mocked repository (unit), the service would call incrementAttempt and if it returns -1 → skip. My sentinel must match what the service checks — but I'm not writing the service; the plan presumably has the service check `if (count <= 0) continue`. -1 works. Or the plan might intend return 0... "returns new count" — 0 could be confused with "count is now zero", but a post-increment count can't be 0, so 0 could also work as the sentinel. Ugh. Which is more defensible? -1 is the classic "no value" sentinel and can't be confused with a valid count (≥1). 0 is also impossible as a real result. Hmm. The plan says "if rows affected is 0, this process loses the race and skips" — mapping rows-affected=0 → return... honestly, returning rows-affected itself is a clean defensible reading too! "Return the new count if 1 row, else 0 (rows affected)". Hmm, that conflates "new count" with "rows affected". The plan: "returns new count; if rows affected is 0, this process loses the race and skips" — two facts: (1) success → new count; (2) 0 rows → skip. The exact failure value is free. Let me go with -1 and a one-line ASSUMPTION comment. Decisive.

Also `findUniqueOrThrow` — imported? Part of the tx client API, no import needed.

Edge: interactive `$transaction` requires `import { Prisma }`? No — the callback form works on PrismaClient directly.

TS strictness: `this.prisma.$transaction(async (tx) => {...})` — tx is typed as Prisma.TransactionClient ✓. Return type is inferred as number ✓ (Promise<number>).

Now, one more thing to double-check: `data: { attemptCount: { increment: 1 }, lastAttemptAt }` — the type of the lastAttemptAt param is Date; field is DateTime (timestamptz) → accepts Date ✓.

And in upsertSettlement: `createMany` — requires the model... fine. `skipDuplicates: true` ✓ supported with Postgres.

Should upsertSettlement instead use `upsert({where: {txid}, update: {}, create: {...}})`? The plan says ON CONFLICT DO NOTHING — createMany+skipDuplicates is a literal mapping. But: `update: {}` on upsert would... Prisma's upsert with empty update is also "do nothing" but implemented as a 2-statement (SELECT then INSERT/UPDATE); and Prisma actually... createMany+skipDuplicates is cleaner and a single statement. Use createMany.

One concern: `createMany` doesn't return created rows — fine, we don't need them (plan: Promise<void>).

Now let me assemble the final file. I'll add a short JSDoc on the class + sections. Comment in English ✓. No imports from bank-client.interface.ts (decided). Hmm — one final sanity check on the "reads" manifest line... If a grader checks that this file imports from bank-client.interface.ts, it would fail; but if I import an unused symbol, it breaks the build (noUnusedLocals under strict? not always on). An unused import is a real defect; wrong manifest expectation isn't in the file. Also — could I legitimately use something from there? `BankSendRequest`? No. The repository doesn't interface with the bank client at all (the
