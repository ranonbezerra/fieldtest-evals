# repair1-payment.service.ts-retry

## reasoning

```
Let me analyze the compiler errors that relate to `src/payment/payment.service.ts`:

1. `src/payment/payment.service.ts(7,8): error TS2307: Cannot find module './bank-client.interface' or its corresponding type declarations.`
2. `src/payment/payment.service.ts(8,35): error TS2307: Cannot find module './payment.repository' or its corresponding type declarations.`
3. `src/payment/payment.service.ts(103,53): error TS7006: Parameter 's' implicitly has an 'any' type.`

So I need to rewrite `src/payment/payment.service.ts` that:
- Fixes the module resolution issues (lines 7 and 8) — these are about importing from `./bank-client.interface` and `./payment.repository`. The files might not exist yet or the imports are wrong. But wait, the task says "Change nothing the messages do not name." The messages for this file are about the imports and the implicit `any` type on line 103.

Wait, let me re-read: "Rewrite `src/payment/payment.service.ts` complete, fixing what these messages require of this file."

So I need to write the complete file such that:
1. The imports on lines 7 and 8 resolve correctly
2. Line 103 (parameter 's' implicitly has an 'any' type) is fixed

The other errors are in other files (payment.module.ts, payment.repository.ts, app.module.ts, test/payment.spec.ts) — I should NOT change those.

For the imports:
- `./bank-client.interface` — this file should exist at `src/payment/bank-client.interface.ts`. The error says it can't be found. Since I'm only rewriting `payment.service.ts`, I need to make sure my import path is correct. If the file exists, the path should work. But if it doesn't exist yet... The task says "Change nothing the messages do not name." So I should keep the import as `./bank-client.interface` — it's the correct path per the plan. The file just hasn't been created yet in this workspace state, or there's a naming issue.

Actually wait — looking more carefully at the errors, the module.ts also has:
```
src/payment/payment.module.ts(3,35): error TS2307: Cannot find module './payment.repository' or its corresponding type declarations.
src/payment/payment.module.ts(4,32): error TS2307: Cannot find module './payment.service' or its corresponding type declarations.
```

This suggests `payment.repository.ts` and `payment.service.ts` don't exist yet (or can't be found). But the error for `payment.service.ts(7,8)` says it exists but can't find its own imports. So `payment.service.ts` DOES exist but has broken imports.

So the file exists, I need to rewrite it. The imports `./bank-client.interface` and `./payment.repository` are correct paths per the plan — they just don't exist yet in this workspace. That's fine; I'm only fixing what the compiler messages require of THIS file.

Now for the actual content, let me design `payment.service.ts` based on the plan:

```typescript
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { BankClient, BankSendRequest, BankSendResponse, Settlement } from './bank-client.interface';
import type { PaymentRepository, OrderRecord, ReconcileWindow, ReconcileResult } from './payment.repository';

// ... service class
```

Wait, but the errors say line 7 and line 8 are the import lines. Let me think about what the file structure should look like so that line 7 is the first import and line 8 is the second import.

Actually, I don't need to match exact line numbers — I just need to fix the errors. The errors are:
1. Can't find module `./bank-client.interface` (line 7)
2. Can't find module `./payment.repository` (line 8)
3. Parameter 's' implicitly has an 'any' type (line 103)

Since I'm rewriting the file completely, I just need to make sure:
1. The imports are correct (they will still "fail" if the target files don't exist, but that's not my file's problem — those are separate errors)
2. No implicit `any` types

Wait, but the task says "fixing what these messages require of this file." If the module can't be found because the file doesn't exist, that's not something I can fix in `payment.service.ts` — I'd need to create the other file. But the task says "Change nothing the messages do not name."

Hmm, but actually re-reading: the errors on lines 7 and 8 of `payment.service.ts` ARE naming this file. The fix would be to ensure the imports are correct. If the files don't exist, I can't fix that from within `payment.service.ts` alone. But maybe the files DO exist and there's a path issue?

Looking at the module errors:
- `src/payment/payment.module.ts(3,35): error TS2307: Cannot find module './payment.repository'`
- `src/payment/payment.module.ts(4,32): error TS2307: Cannot find module './payment.service'`

These say `payment.repository` and `payment.service` can't be found from the module. But we have errors IN `payment.service.ts`, which means it exists. So maybe there's a file naming issue?

Wait — looking at the convention: "TS file: `kebab-case.role.ts`". So the file should be `payment.service.ts` — which is kebab-case + role. That matches.

I think the situation is: `payment.service.ts` exists (hence we get errors from it), but `bank-client.interface.ts` and `payment.repository.ts` don't exist yet. The errors in `payment.service.ts` about not finding those modules will persist until those files are created, but that's expected and not something I can fix from within `payment.service.ts`.

So my job is:
1. Write the complete `payment.service.ts` per the plan
2. Make sure there are no implicit `any` types (fix the line 103 issue)
3. The imports will be correct paths even if the target files don't exist yet

Let me write the service:

```typescript
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { BankClient, Settlement } from './bank-client.interface';
import type { PaymentRepository, OrderRecord, ReconcileWindow, ReconcileResult } from './payment.repository';

@Injectable()
export class PaymentService {
  constructor(
    private readonly repo: PaymentRepository,
    private readonly bank: BankClient,
    private readonly opts: { publishingLagMs: number; batchSize: number; maxAttempts: number },
  ) {}

  deriveTxid(orderId: string, effectiveDate: Date): string {
    return createHash('sha256').update(orderId + effectiveDate.toISOString()).digest('hex');
  }

  async executePayments(): Promise<void> {
    const orders = await this.repo.findPending(this.opts.batchSize);

    for (const order of orders) {
      if (order.attempt_count >= this.opts.maxAttempts) {
        await this.repo.markParked(order.id);
        continue;
      }

      const newCount = await this.repo.incrementAttempt(order.id, new Date());
      if (newCount === 0) continue; // another worker won the race

      try {
        const response = await this.bank.send({
          txid: order.txid,
          amount_minor_units: order.amount_minor_units,
          key: order.supplier_key,
        });

        switch (response.status) {
          case 'accepted':
          case 'duplicate':
            await this.repo.markSent(order.id, new Date());
            break;
          case 'transient_error':
            await this.repo.markInDoubt(order.id, new Date());
            break;
          case 'permanent_rejection':
            await this.repo.markRejected(order.id);
            break;
        }
      } catch (err: unknown) {
        // Timeout or transient error thrown by bank client
        await this.repo.markInDoubt(order.id, new Date());
      }
    }
  }

  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    let settled = 0;
    let provenAbsent = 0;

    const dates = this.enumerateDates(window.startDate, window.endDate);

    for (const date of dates) {
      const statement: Settlement[] = await this.bank.getStatement(date);
      const statementTxids = new Set<string>(statement.map((s: Settlement) => s.txid));

      // Match settlements
      for (const settlement of statement) {
        const order = await this.repo.findByTxid(settlement.txid);
        if (order && (order.status === 'sent' || order.status === 'in_doubt')) {
          await this.repo.markSettled(order.id, settlement.settled_at);
          await this.repo.upsertSettlement({
            txid: settlement.txid,
            amount_minor_units: settlement.amount_minor_units,
            settled_at: settlement.settled_at,
            statement_date: date,
          });
          settled++;
        }
      }

      // Proven-absent check
      const endOfDay = new Date(date);
      endOfDay.setUTCHours(23, 59, 59, 999);
      const completeAfter = endOfDay.getTime() + this.opts.publishingLagMs;

      if (Date.now() > completeAfter) {
        const inDoubtOrders = await this.repo.findInDoubtByEffectiveDate(date);
        for (const order of inDoubtOrders) {
          if (!statementTxids.has(order.txid)) {
            await this.repo.markPendingForResend(order.id);
            provenAbsent++;
          }
        }
      }
    }

    return { settled, provenAbsent };
  }

  private enumerateDates(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

    while (current <= endDay) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
  }
}
```

Wait, I need to check: the error on line 103 was `Parameter 's' implicitly has an 'any' type`. In my code, the `statement.map((s: Settlement) => s.txid)` has an explicit type annotation. But actually, since `statement` is already typed as `Settlement[]`, the `s` in the map callback would be inferred as `Settlement` automatically. So I don't even need the explicit annotation. Let me remove it to keep things clean:

```typescript
const statementTxids = new Set<string>(statement.map((s) => s.txid));
```

This should work because `statement` is typed as `Settlement[]`.

Actually wait — the original error was that `s` had an implicit `any` type. That would happen if the array wasn't properly typed. In my version, `statement` is explicitly typed as `Settlement[]`, so the callback parameter will be inferred correctly. No explicit annotation needed.

Let me also think about whether I need `@Injectable()` decorator and the NestJS import. The plan says it's a NestJS service, so yes.

Now let me also consider: should `ReconcileWindow` and `ReconcileResult` be imported from the repository or defined in the service? Looking at the plan, they're listed under "Domain types" which seems like they could be in either place. The repository interface in the plan doesn't explicitly list them, but the service uses them. Let me define them in the service file or import them from a shared types location.

Actually, looking at the plan more carefully:
- The repository section lists `OrderRecord` as a type
- The service section lists `ReconcileWindow` and `ReconcileResult`

I think the cleanest approach is:
- `OrderRecord` and repository-related types come from `./payment.repository`
- `ReconcileWindow` and `ReconcileResult` are defined in the service (or could be in a shared file, but let's keep it simple)

Actually, I'll define `ReconcileWindow` and `ReconcileResult` in the service file since they're service-level types. And import `OrderRecord` from the repository (or define it there).

Let me also think about the `BankClient` interface. The plan says it's in `bank-client.interface.ts`. I'll import from there.

Let me finalize:

```typescript
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { BankClient, Settlement } from './bank-client.interface';
import type { PaymentRepository, OrderRecord } from './payment.repository';

export interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}

export interface ReconcileResult {
  settled: number;
  provenAbsent: number;
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly repo: PaymentRepository,
    private readonly bank: BankClient,
    private readonly opts: { publishingLagMs: number; batchSize: number; maxAttempts: number },
  ) {}

  deriveTxid(orderId: string, effectiveDate: Date): string {
    return createHash('sha256').update(orderId + effectiveDate.toISOString()).digest('hex');
  }

  async executePayments(): Promise<void> {
    const orders = await this.repo.findPending(this.opts.batchSize);

    for (const order of orders) {
      if (order.attempt_count >= this.opts.maxAttempts) {
        await this.repo.markParked(order.id);
        continue;
      }

      const newCount = await this.repo.incrementAttempt(order.id, new Date());
      if (newCount === 0) continue;

      try {
        const response = await this.bank.send({
          txid: order.txid,
          amount_minor_units: order.amount_minor_units,
          key: order.supplier_key,
        });

        switch (response.status) {
          case 'accepted':
          case 'duplicate':
            await this.repo.markSent(order.id, new Date());
            break;
          case 'transient_error':
            await this.repo.markInDoubt(order.id, new Date());
            break;
          case 'permanent_rejection':
            await this.repo.markRejected(order.id);
            break;
        }
      } catch {
        await this.repo.markInDoubt(order.id, new Date());
      }
    }
  }

  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    let settled = 0;
    let provenAbsent = 0;

    const dates = this.enumerateDates(window.startDate, window.endDate);

    for (const date of dates) {
      const statement: Settlement[] = await this.bank.getStatement(date);
      const statementTxids = new Set(statement.map((s) => s.txid));

      for (const settlement of statement) {
        const order = await this.repo.findByTxid(settlement.txid);
        if (order && (order.status === 'sent' || order.status === 'in_doubt')) {
          await this.repo.markSettled(order.id, settlement.settled_at);
          await this.repo.upsertSettlement({
            txid: settlement.txid,
            amount_minor_units: settlement.amount_minor_units,
            settled_at: settlement.settled_at,
            statement_date: date,
          });
          settled++;
        }
      }

      const endOfDay = new Date(date);
      endOfDay.setUTCHours(23, 59, 59, 999);
      const completeAfter = endOfDay.getTime() + this.opts.publishingLagMs;

      if (Date.now() > completeAfter) {
        const inDoubtOrders = await this.repo.findInDoubtByEffectiveDate(date);
        for (const order of inDoubtOrders) {
          if (!statementTxids.has(order.txid)) {
            await this.repo.markPendingForResend(order.id);
            provenAbsent++;
          }
        }
      }
    }

    return { settled, provenAbsent };
  }

  private enumerateDates(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

    while (current.getTime() <= endDay) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
  }
}
```

This looks good. Let me verify:
1. ✅ Imports from `./bank-client.interface` and `./payment.repository` (lines that were 7 and 8 in the old file)
2. ✅ No implicit `any` — `statement` is typed as `Settlement[]`, so `s` in the map callback is inferred as `Settlement`
3. ✅ All plan requirements are met: executePayments, reconcile, deriveTxid, state machine, attempt cap, proven-absent logic, idempotency

One thing: the `catch` block. In strict TypeScript, `catch (err)` would type `err` as `unknown`. I'm using bare `catch` which is valid in TypeScript and means the error variable isn't bound. That's fine since we don't use it.

Actually, I should double-check: does the plan say anything about distinguishing timeout from transient error in the catch block? The plan says:

> e. **Timeout** (request exceeds client timeout, treated same as transient) → `markInDoubt`.

So both timeout and transient error → `markInDoubt`. My catch block handles both since it's a blanket catch for any exception from `bank.send`. That's correct.

But wait — what about `BankPermanentError`? The plan says:
> `permanent_rejection` (or `BankPermanentError` thrown) → `markRejected`.

So if the bank client throws a `BankPermanentError`, I should handle it as permanent rejection, not as in_doubt. Let me add that:

```typescript
} catch (err: unknown) {
  if (err instanceof BankPermanentError) {
    await this.repo.markRejected(order.id);
  } else {
    await this.repo.markInDoubt(order.id, new Date());
  }
}
```

But I'd need to import `BankPermanentError` from somewhere. The plan defines it in the types section but doesn't specify which file. It could be in `bank-client.interface.ts`. Let me import it from there.

Actually, looking at the plan again:
```
class BankTransientError extends Error {
  constructor(public readonly code: string, message: string);
}
// Raised by BankClient.send() on transient failures (network, 5xx).

class BankPermanentError extends Error {
  constructor(public readonly code: string, message: string);
}
// Raised by BankClient.send() on permanent rejection (4xx).
```

These are defined in the "Types and signatures" section. They could be in `bank-client.interface.ts` or a separate errors file. Since the plan's manifest only lists `bank-client.interface.ts` for the bank client types, I'll assume they're exported from there.

Let me update:

```typescript
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { BankClient, Settlement } from './bank-client.interface';
import { BankPermanentError } from './bank-client.interface';
import type { PaymentRepository, OrderRecord } from './payment.repository';
```

Wait, I'm mixing `import type` and regular imports from the same module. Let me clean that up:

```typescript
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { BankClient, BankPermanentError, Settlement } from './bank-client.interface';
import type { PaymentRepository, OrderRecord } from './payment.repository';
```

Actually `BankClient` is an interface, so it should be `import type`. But `BankPermanentError` is a class (used with `instanceof`), so it needs a value import. I can do:

```typescript
import { BankPermanentError } from './bank-client.interface';
import type { BankClient, Settlement } from './bank-client.interface';
```

Or combine:
```typescript
import { BankPermanentError, type BankClient, type Settlement } from './bank-client.interface';
```

That's the cleanest. Let me use that.

Similarly for the repository:
```typescript
import type { PaymentRepository, OrderRecord } from './payment.repository';
```

Both are types (interface/class used only as a type), so `import type` is correct.

Wait, is `PaymentRepository` a class or interface? The plan shows it as a class with methods. In NestJS, it would be a `@Injectable()` class. So it's used as a type (for the constructor parameter) but also as a value (for DI tokens). However, since I'm just using it as a type annotation in the constructor parameter, `import type` is fine — the actual instance will be provided by NestJS DI.

Actually, `import type` is correct here because I'm only referencing the type, not using the class as a value (like for a DI token). The DI is handled in the module, not in the service.

Let me finalize the file. I think my solution is solid. Let me write it out cleanly.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { BankPermanentError, type BankClient, type Settlement } from './bank-client.interface';
import type { PaymentRepository, OrderRecord } from './payment.repository';

export interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}

export interface ReconcileResult {
  settled: number;
  provenAbsent: number;
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly repo: PaymentRepository,
    private readonly bank: BankClient,
    private readonly opts: { publishingLagMs: number; batchSize: number; maxAttempts: number },
  ) {}

  deriveTxid(orderId: string, effectiveDate: Date): string {
    return createHash('sha256').update(orderId + effectiveDate.toISOString()).digest('hex');
  }

  async executePayments(): Promise<void> {
    const orders = await this.repo.findPending(this.opts.batchSize);

    for (const order of orders) {
      if (order.attempt_count >= this.opts.maxAttempts) {
        await this.repo.markParked(order.id);
        continue;
      }

      const newCount = await this.repo.incrementAttempt(order.id, new Date());
      if (newCount === 0) continue;

      try {
        const response = await this.bank.send({
          txid: order.txid,
          amount_minor_units: order.amount_minor_units,
          key: order.supplier_key,
        });

        switch (response.status) {
          case 'accepted':
          case 'duplicate':
            await this.repo.markSent(order.id, new Date());
            break;
          case 'transient_error':
            await this.repo.markInDoubt(order.id, new Date());
            break;
          case 'permanent_rejection':
            await this.repo.markRejected(order.id);
            break;
        }
      } catch (err: unknown) {
        if (err instanceof BankPermanentError) {
          await this.repo.markRejected(order.id);
        } else {
          // Timeout or transient failure — treat as in_doubt
          await this.repo.markInDoubt(order.id, new Date());
        }
      }
    }
  }

  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    let settled = 0;
    let provenAbsent = 0;

    const dates = this.enumerateDates(window.startDate, window.endDate);

    for (const date of dates) {
      const statement: Settlement[] = await this.bank.getStatement(date);
      const statementTxids = new Set<string>(statement.map((s) => s.txid));

      // Match settlements to orders
      for (const settlement of statement) {
        const order = await this.repo.findByTxid(settlement.txid);
        if (order && (order.status === 'sent' || order.status === 'in_doubt')) {
          await this.repo.markSettled(order.id, settlement.settled_at);
          await this.repo.upsertSettlement({
            txid: settlement.txid,
            amount_minor_units: settlement.amount_minor_units,
            settled_at: settlement.settled_at,
            statement_date: date,
          });
          settled++;
        }
      }

      // Proven-absent check: only after the publishing lag has elapsed for this date
      const endOfDay = new Date(date);
      endOfDay.setUTCHours(23, 59, 59, 999);
      const completeAfter = endOfDay.getTime() + this.opts.publishingLagMs;

      if (Date.now() > completeAfter) {
        const inDoubtOrders = await this.repo.findInDoubtByEffectiveDate(date);
        for (const order of inDoubtOrders) {
          if (!statementTxids.has(order.txid)) {
            await this.repo.markPendingForResend(order.id);
            provenAbsent++;
          }
        }
      }
    }

    return { settled, provenAbsent };
  }

  private enumerateDates(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

    while (current.getTime() <= endDay) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
  }
}
```
