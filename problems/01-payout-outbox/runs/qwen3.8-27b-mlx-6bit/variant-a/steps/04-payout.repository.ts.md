# 04-payout.repository.ts

## reasoning

```
Let me analyze the PLAN.md to understand exactly what `src/payout/payout.repository.ts` needs to contain.

From the plan:

```ts
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically: SELECT … FOR UPDATE on the account row, compute
   * available = balance − Σ(payouts.amount WHERE status IN ('created','processing','sent')),
   * check available >= amount, INSERT payout (status='created') + outbox_message (status='pending')
   * in one $transaction. Returns the payout row.
   * Throws Prisma.PrismaClientKnownRequestError (code P2002) on idempotency conflict.
   * Throws a custom InsufficientFundsError when available < amount.
   */
  createPayoutWithReservation(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRow>;

  /** UPDATE payouts SET status, tx_hash, updated_at WHERE id = $. Returns updated row or null. */
  updatePayout(id: string, status: PayoutStatus, txHash?: string): Promise<PayoutRow | null>;

  /** Single-row read by id. */
  findById(id: string): Promise<PayoutRow | null>;

  /**
   * Atomic ledger post + balance decrement:
   * INSERT ledger_entries (debit=amount, credit=0, reference_type='payout', reference_id)
   * + UPDATE accounts SET balance = balance − amount WHERE id = accountId AND balance >= amount.
   * In one $transaction. Throws OverdraftError if the guard fails (should never happen
   * if reservation logic is correct, but defensive).
   */
  confirmPayoutLedger(accountId: string, payoutId: string, amount: bigint): Promise<void>;
}
```

Now I need to figure out:
1. What is `PrismaService`? It's not explicitly defined in the references, but it's a standard NestJS pattern - a service that wraps `PrismaClient`. I'll import it from somewhere. Since the plan says "repository is the only layer that touches the database" and it uses `PrismaService`, I'll import it from a standard location. Looking at the layout, there's no explicit `prisma.service.ts` mentioned in the manifest. This is a common pattern where `PrismaService extends PrismaClient`. I'll import it from `../prisma/prisma.service.js` or similar. Wait, let me look at the manifest more carefully.

The manifest doesn't list a `prisma.service.ts` file. But the plan references `PrismaService` in the repository. This is a standard NestJS+Prisma pattern. Since the plan doesn't define it in any file I need to write, and it's not in the references, I'll use an ASSUMPTION comment for the import path. Actually, looking more carefully, the convention in NestJS+Prisma projects is typically `src/prisma/prisma.service.ts`. But since it's not in the manifest, maybe it's defined elsewhere or maybe I should just import `PrismaClient` directly? 

Wait - the plan says the constructor takes `PrismaService`. So it must exist somewhere. Since it's not in my file to write, I'll import it from a reasonable path. Let me use `../prisma/prisma.service.js` as the import path with an assumption comment.

Actually, looking at this more carefully - the plan is my specification and it says `private readonly prisma: PrismaService`. The file isn't in the manifest for me to write, so it must be provided elsewhere. I'll import it from `../prisma/prisma.service.js` - this is the most standard location for a NestJS Prisma service.

2. What is `PayoutRow`? The plan references it but doesn't define it explicitly. It would be the Prisma model type for payouts. I can use `Prisma.PayoutGetPayload` or just define it as a type. Actually, in Prisma, the generated types would give us `Prisma.PayoutGetPayload<{ include: {} }>` or we can just use the model type. Let me think about this...

Actually, since I don't have the Prisma schema file content (it's in the plan's data model section but not as a reference file), I need to infer the types. The plan says:

payouts table:
- id: uuid (pk)
- account_id: uuid (fk)
- amount: bigint
- destination_address: text
- idempotency_key: text
- status: text
- tx_hash: text?
- created_at: timestamptz
- updated_at: timestamptz

So `PayoutRow` would be the Prisma-generated type. I can import it from `@prisma/client`. In Prisma, the generated types are available as `Prisma.Payout` (the model type) or we can use `Prisma.PayoutGetPayload`. Let me just define `PayoutRow` as a local type or import from Prisma client.

Actually, the cleanest approach is to use the Prisma generated types. `import { Payout } from '@prisma/client'` would give us the model type. But the plan calls it `PayoutRow`. I'll define it as a type alias or just use the Prisma model type directly.

Wait, let me re-read the plan. It says `Promise<PayoutRow>` - this suggests `PayoutRow` is a type that exists. Since it's not defined in any reference file, I'll define it locally in this file or import it from Prisma. The most defensible approach is to type it using the Prisma client's generated types.

Let me define: `type PayoutRow = Prisma.PayoutGetPayload<{ include: {} }>` or simply use the model name from `@prisma/client`.

Actually, in Prisma with the schema as described, the model would be called `Payout` (or whatever the Prisma model name is). Looking at the table name `payouts` with `@@map`, the Prisma model would likely be `Payout`. The generated type would be `Prisma.Payout` (the "scalar" type) or we can use the payload type.

Let me just import `{ Prisma }` from `@prisma/client` and use `Prisma.PayoutGetPayload<{ include: {} }>` or define a local interface. Actually the simplest is to just use the model type directly. In Prisma, `import { Payout } from '@prisma/client'` gives you the runtime model, while `import { Prisma } from '@prisma/client'` gives you the namespace with types.

I think the cleanest approach that matches the plan's naming is:

```ts
import { Prisma, Payout } from '@prisma/client';
type PayoutRow = Omit<Payout, 'id' | 'account_id' | ...>;
```

No wait, that's overcomplicating. Let me just use the Prisma client type directly. In a typical Prisma setup:

```ts
import { PrismaClient, Payout } from '@prisma/client';
```

The `Payout` type from `@prisma/client` is the full row type. I'll just alias it as `PayoutRow`.

Now let me think about the implementation details:

### `createPayoutWithReservation`

This needs to:
1. In a `$transaction`:
   - SELECT the account row FOR UPDATE (need raw SQL for FOR UPDATE, or use Prisma's interactive transaction)
   - Compute reserved amount (sum of payouts with status in created, processing, sent)
   - Check available >= amount
   - INSERT payout (status='created')
   - INSERT outbox_message (status='pending', attempts=0)
2. Return the payout row

For FOR UPDATE, Prisma doesn't natively support it in its query builder. We'd need to use `$queryRaw` or an interactive transaction with raw SQL. Actually, in Prisma, you can use `prisma.$transaction(async (tx) => { ... })` for interactive transactions, and within that you can use `tx.$queryRaw` for the FOR UPDATE part.

Wait, but the plan says "zero raw SQL" in the service layer, and the repository is the only layer that touches the database. So raw SQL in the repository is fine.

Let me think about how to do this with Prisma:

```ts
async createPayoutWithReservation(params) {
  return this.prisma.$transaction(async (tx) => {
    // Lock the account row
    const [account] = await tx.$queryRaw`
      SELECT id, balance FROM accounts WHERE id = ${params.accountId} FOR UPDATE
    `;
    
    if (!account) {
      throw new Error('Account not found');
    }
    
    // Compute reserved amount
    const reservedResult = await tx.payout.aggregate({
      where: {
        accountId: params.accountId,
        status: { in: ['created', 'processing', 'sent'] },
      },
      _sum: { amount: true },
    });
    
    const reserved = reservedResult._sum.amount ?? 0n;
    const available = (account.balance as bigint) - reserved;
    
    if (available < params.amount) {
      throw new InsufficientFundsError(...);
    }
    
    // Create payout
    const payout = await tx.payout.create({
      data: {
        accountId: params.accountId,
        amount: params.amount,
        destinationAddress: params.destinationAddress,
        idempotencyKey: params.idempotencyKey,
        status: 'created',
      },
    });
    
    // Create outbox message
    await tx.outboxMessage.create({
      data: {
        payoutId: payout.id,
        payload: { to: params.destinationAddress, amount: params.amount.toString() },
        status: 'pending',
        attempts: 0,
      },
    });
    
    return payout;
  });
}
```

Wait, but the plan says "Throws a custom InsufficientFundsError when available < amount." I need to define or import this error. Since it's not in the references, I'll define it in this file or import it. Actually, looking at the plan more carefully, it mentions error codes but not specific error classes. The service maps errors to HTTP responses. Let me define a simple error class here, or I could just throw an Error with a specific code.

Actually, re-reading the plan: "Throws Prisma.PrismaClientKnownRequestError (code P2002) on idempotency conflict. Throws a custom InsufficientFundsError when available < amount."

So I need:
1. Let P2002 propagate (it's thrown by Prisma automatically on unique constraint violation)
2. Define/throw an `InsufficientFundsError`

I'll define the error class in this file since it's used here. Wait, but the plan says "Do not add an export, a feature or a file the plan does not name." The plan does reference `InsufficientFundsError` in the repository description, so defining it here is appropriate.

Similarly, `OverdraftError` is mentioned for `confirmPayoutLedger`.

### `updatePayout`

```ts
async updatePayout(id: string, status: PayoutStatus, txHash?: string) {
  try {
    return await this.prisma.payout.update({
      where: { id },
      data: { status, txHash, updatedAt: new Date() },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return null;
    }
    throw e;
  }
}
```

### `findById`

```ts
async findById(id: string) {
  return this.prisma.payout.findUnique({ where: { id } });
}
```

### `confirmPayoutLedger`

```ts
async confirmPayoutLedger(accountId: string, payoutId: string, amount: bigint) {
  await this.prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.create({
      data: {
        accountId,
        debit: amount,
        credit: 0n,
        referenceType: 'payout',
        referenceId: payoutId,
      },
    });
    
    const result = await tx.$queryRaw`
      UPDATE accounts SET balance = balance - ${amount} 
      WHERE id = ${accountId} AND balance >= ${amount}
    `;
    
    // Check if any row was updated
    // ... need to check rowCount
  });
}
```

Hmm, for the UPDATE with guard, I need to check if a row was actually updated. With `$queryRaw`, I can use `RETURNING` or check the result. In PostgreSQL, `UPDATE ... RETURNING id` would return the updated row, or I can use `$executeRaw` which returns the number of affected rows.

Let me use `$executeRaw`:
```ts
const count = await tx.$executeRaw`
  UPDATE accounts SET balance = balance - ${amount} 
  WHERE id = ${accountId} AND balance >= ${amount}
`;
if (count === 0) {
  throw new OverdraftError(...);
}
```

Now, about the Prisma model names. Based on the schema:
- `accounts` table → Prisma model likely `Account` (with `@@map("accounts")`)
- `payouts` table → Prisma model likely `Payout` (with `@@map("payouts")`)
- `outbox_messages` table → Prisma model likely `OutboxMessage` (with `@@map("outbox_messages")`)
- `ledger_entries` table → Prisma model likely `LedgerEntry` (with `@@map("ledger_entries")`)

The columns use snake_case with `@map`, so in Prisma the field names would be camelCase.

For the `$queryRaw` with FOR UPDATE, I need to reference the actual table name (snake_case) in SQL.

Let me also think about the `payload` field in outbox_messages. The plan says it's `jsonb` with `{ to: string, amount: bigint }`. Since Prisma handles BigInt as strings in JSON, I'll store it as a string representation. Actually, looking at the plan: `payload | jsonb | { to: string, amount: bigint }`. In JSON, bigint would be stored as a string. So `payload: { to: destinationAddress, amount: amount.toString() }`.

Wait, but when the worker reads it back, it needs to convert to bigint again. That's fine - that's the outbox service's concern, not this file's.

Let me also consider: the plan mentions `PayoutRow` type. I'll define it using the Prisma generated type. In Prisma, after generating, you get types like:

```ts
import { Payout } from '@prisma/client';
// Payout is the full row type with all fields
```

So `type PayoutRow = Payout` would work, or I can just use `Payout` directly.

Actually wait - I need to be careful. The Prisma model names depend on the schema. Since I don't have the actual schema file, I'm inferring from the plan's data model. The plan uses snake_case table names with `@@map`, so the Prisma model names would be PascalCase versions.

Let me finalize my approach:

1. Import from `@prisma/client`: `Prisma` (for PrismaClientKnownRequestError and types)
2. Import `PrismaService` from `../prisma/prisma.service.js` (ASSUMPTION)
3. Define error classes: `InsufficientFundsError`, `OverdraftError`
4. Implement the four methods

Actually, for the `PayoutRow` type - since the plan uses it as a return type, and it's not defined in any reference file, I should define it. The most natural way in a Prisma project is to use the generated model type:

```ts
import { Payout } from '@prisma/client';
type PayoutRow = Payout;
```

But wait, I'm not 100% sure the Prisma model is called `Payout`. It could be `Payout` with `@@map("payouts")`. Let me go with that assumption since it's the standard Prisma convention (PascalCase model name, snake_case table name via @@map).

Similarly for the service import path - `PrismaService` is a common pattern but its location varies. I'll use `../prisma/prisma.service.js` with an assumption comment.

Let me write the complete file now:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, Payout } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PayoutStatus } from './payout.types.js';

// ASSUMPTION: PrismaService is provided at ../prisma/prisma.service.js
// ASSUMPTION: Prisma model names are Account, Payout, OutboxMessage, LedgerEntry (PascalCase, @@map to snake_case)

type PayoutRow = Payout;

export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export class OverdraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverdraftError';
  }
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPayoutWithReservation(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRow> {
    return this.prisma.$transaction(async (tx) => {
      // Lock the account row to serialize concurrent creates
      const [account] = await tx.$queryRaw<{ id: string; balance: bigint }[]>`
        SELECT id, balance FROM accounts WHERE id = ${params.accountId} FOR UPDATE
      `;

      if (!account) {
        throw new Prisma.PrismaClientKnownRequestError(
          'Account not found',
          { code: 'P2025', clientVersion: '0.0.0' },
        );
      }

      // Sum all reserved amounts (created, processing, sent)
      const reservedResult = await tx.payout.aggregate({
        where: {
          accountId: params.accountId,
          status: { in: ['created', 'processing', 'sent'] },
        },
        _sum: { amount: true },
      });

      const reserved = reservedResult._sum.amount ?? 0n;
      const available = account.balance - reserved;

      if (available < params.amount) {
        throw new InsufficientFundsError(
          `Available funds ${available} are less than requested amount ${params.amount}`,
        );
      }

      // Create the payout
      const payout = await tx.payout.create({
        data: {
          accountId: params.accountId,
          amount: params.amount,
          destinationAddress: params.destinationAddress,
          idempotencyKey: params.idempotencyKey,
          status: 'created',
        },
      });

      // Create the outbox message
      await tx.outboxMessage.create({
        data: {
          payoutId: payout.id,
          payload: { to: params.destinationAddress, amount: params.amount.toString() },
          status: 'pending',
          attempts: 0,
        },
      });

      return payout;
    });
  }

  async updatePayout(id: string, status: PayoutStatus, txHash?: string): Promise<PayoutRow | null> {
    try {
      return await this.prisma.payout.update({
        where: { id },
        data: { status, txHash, updatedAt: new Date() },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return null;
      }
      throw e;
    }
  }

  async findById(id: string): Promise<PayoutRow | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  async confirmPayoutLedger(accountId: string, payoutId: string, amount: bigint): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Post the ledger entry (debit from account)
      await tx.ledgerEntry.create({
        data: {
          accountId,
          debit: amount,
          credit: 0n,
          referenceType: 'payout',
          referenceId: payoutId,
        },
      });

      // Decrement balance with an overdraft guard
      const updated = await tx.$executeRaw`
        UPDATE accounts SET balance = balance - ${amount}
        WHERE id = ${accountId} AND balance >= ${amount}
      `;

      if (updated === 0) {
        throw new OverdraftError(
          `Balance guard failed for account ${accountId}: balance < ${amount}`,
        );
      }
    });
  }
}
```

Wait, I need to reconsider the error for "account not found". The plan says:
- "Throws Prisma.PrismaClientKnownRequestError (code P2002) on idempotency conflict." - This is thrown automatically by Prisma when the unique constraint is violated on INSERT.
- "Throws a custom InsufficientFundsError when available < amount."

For account not found, the plan's control flow says: "(if no row → ROLLBACK, throw resource_not_found)". But the repository shouldn't be throwing HTTP-level errors. Let me re-read...

Actually, looking at the plan's service description: "Maps P2002 → conflict check (same body → return existing; different body → 409 idempotency_conflict). Maps InsufficientFundsError → 422." And for account not found: "Service: accountId does not exist" → 404.

So the repository should signal that the account wasn't found somehow. The simplest way is to return null or throw a specific error. But the plan's signature says it returns `Promise<PayoutRow>` - no null option. So it must throw.

I could throw a standard `Prisma.PrismaClientKnownRequestError` with code P2025 (record not found), which the service can then map to 404. Or I could define my own error. Let me use the Prisma P2025 approach since it's what Prisma would naturally throw for a findUnique that returns null, and the service can catch it.

Actually, let me just throw a plain Error with a recognizable message, or better yet, I'll check if the account exists first using Prisma's findUnique and throw if null. But that changes the transaction structure...

Actually, the simplest and most defensible approach: after the FOR UPDATE query returns no row, I'll throw an error that the service can map. Let me use a specific error class or just check and throw. The plan says the service handles "resource_not_found" for accountId not existing. So I need the repository to signal this.

Let me just throw a `Prisma.PrismaClientKnownRequestError` with code 'P2025' (the standard "record not found" code). The service can catch this and map to 404.

Hmm, but constructing a PrismaClientKnownRequestError manually is awkward (needs clientVersion). Let me instead just define it differently. I'll throw a generic Error and let the service handle it, or I'll do a separate check.

Actually, the cleanest approach: I'll do the FOR UPDATE query, and if no row is found, I'll throw a specific error. Since the plan mentions "resource_not_found" as an error code handled by the service, and the repository is where this detection happens, I'll just throw a simple Error with a recognizable message. But that's not great for type safety.

Let me look at this differently. The plan says the repository "Throws Prisma.PrismaClientKnownRequestError (code P2002) on idempotency conflict" - meaning it lets Prisma's natural error propagate. For the account not found case, I'll just let the FOR UPDATE return empty and throw a standard error.

You know what, I think the most pragmatic approach is:
- For account not found: throw a simple `Error('Account not found')` or better, I can use Prisma's findUnique outside the transaction to check first... but that breaks atomicity.

Actually, let me just throw an Error with a specific message. The service layer will catch it and map appropriately. This is the most defensible reading since the plan doesn't specify a particular error class for this case in the repository.

Wait, I just re-read: the plan says the service "Maps ... resource_not_found" for "accountId does not exist". So the service needs to detect this. The simplest way is for the repository to throw something recognizable.

I'll go with: if the FOR UPDATE returns no row, throw a `Prisma.PrismaClientKnownRequestError` - but I can't easily construct one. Let me just throw a regular Error with a specific message that the service can check, or better yet, I'll define a small error class.

Actually, you know what - let me just not overthink this. The plan says the repository throws on insufficient funds (custom error) and lets P2002 propagate. For account not found, the most natural thing in a Prisma context is to let it be detected. I'll check for the missing account and throw an Error. The service will catch it.

Let me simplify: I'll throw `new Error('Account not found')` and the service can check for it. Or even better, since we're in a transaction and using $queryRaw, I'll just check the result and throw.

Final decision: I'll keep it simple and throw a standard Error for the not-found case. The service maps it. This is the most defensible reading since the plan doesn't specify a particular error class for this in the repository layer.

Actually wait - I just realized I should look at this from a different angle. In the plan's control flow for payout creation:

```
SELECT balance FROM accounts WHERE id = $accountId FOR UPDATE
(if no row → ROLLBACK, throw resource_not_found)
```

"throw resource_not_found" - this suggests throwing an error that carries the code "resource_not_found". But in the repository, we don't deal with HTTP codes. The service maps to HTTP. So the repository throws something, and the service maps it.

I'll go with a simple approach: throw an Error with the message indicating account not found, and let the service handle it. Or I could just check the Prisma account existence separately... but that breaks the FOR UPDATE semantics.

OK final answer: I'll throw a plain Error. The service layer will catch it and map to the appropriate HTTP response. This is clean separation of concerns.

Let me also reconsider: do I need the `Payout` import from `@prisma/client`? If I use it as the return type, yes. Let me verify this makes sense with Prisma's generated types.

In a typical Prisma setup with:
```prisma
model Payout {
  id                String    @id @default(uuid())
  accountId         String    @map("account_id")
  amount            BigInt
  destinationAddress String   @map("destination_address")
  idempotencyKey    String    @map("idempotency_key")
  status            String
  txHash            String?   @map("tx_hash")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  @@map("payouts")
}
```

The generated `Payout` type from `@prisma/client` would be:
```ts
type Payout = {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  txHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

So `type PayoutRow = Payout` makes sense.

Now let me finalize the file. One more consideration: the `$queryRaw` template literal with bigint. Prisma's raw query supports BigInt in parameters. Let me verify the syntax is correct.

For `$executeRaw` with BigInt:
```ts
await tx.$executeRaw`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${accountId} AND balance >= ${amount}`;
```

This should work in Prisma 5+. The BigInt value is passed as a parameter.

For the FOR UPDATE query:
```ts
const rows = await tx.$queryRaw<{ id: string; balance: bigint }[]>`SELECT id, balance FROM accounts WHERE id = ${params.accountId} FOR UPDATE`;
```

This should also work.

One issue: in the `confirmPayoutLedger`, I'm using `$executeRaw` which returns a number (rows affected). That's correct for the guard check.

Let me write the final version now. I'll also make sure to handle the `payload` field correctly. The plan says it's jsonb with `{ to: string, amount: bigint }`. In Prisma, when writing JSON, BigInt values need to be serialized as strings since JSON doesn't support BigInt natively. So I'll store `amount` as a string in the JSON payload.

Wait, actually Prisma's JSON type might handle BigInt differently. Let me just store it as a string to be safe: `amount: params.amount.toString()`. The worker can parse it back with `BigInt(payload.amount)`.

Let me finalize.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, Payout } from '@prisma/client';
// ASSUMPTION: PrismaService (extends PrismaClient) is provided at this path per standard NestJS+Prisma layout
import { PrismaService } from '../prisma/prisma.service.js';
import type { PayoutStatus } from './payout.types.js';

type PayoutRow = Payout;

export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export class OverdraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverdraftError';
  }
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically reserves funds and creates a payout + outbox message.
   * Throws Prisma.PrismaClientKnownRequestError (code P2002) on idempotency conflict.
   * Throws InsufficientFundsError when available < amount.
   */
  async createPayoutWithReservation(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRow> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent creates by locking the account row
      const rows = await tx.$queryRaw<{ id: string; balance: bigint }[]>`
        SELECT id, balance FROM accounts WHERE id = ${params.accountId} FOR UPDATE
      `;

      if (rows.length === 0) {
        throw new Error('Account not found');
      }

      const account = rows[0];

      // Compute total reserved (non-terminal) amounts
      const agg = await tx.payout.aggregate({
        where: {
          accountId: params.accountId,
          status: { in: ['created', 'processing', 'sent'] },
        },
        _sum: { amount: true },
      });

      const reserved = agg._sum.amount ?? 0n;
      const available = account.balance - reserved;

      if (available < params.amount) {
        throw new InsufficientFundsError(
          `Available ${available} is less than requested ${params.amount}`,
        );
      }

      const payout = await tx.payout.create({
        data: {
          accountId: params.accountId,
          amount: params.amount,
          destinationAddress: params.destinationAddress,
          idempotencyKey: params.idempotencyKey,
          status: 'created',
        },
      });

      await tx.outboxMessage.create({
        data: {
          payoutId: payout.id,
          payload: { to: params.destinationAddress, amount: params.amount.toString() },
          status: 'pending',
          attempts: 0,
        },
      });

      return payout;
    });
  }

  /** UPDATE payouts SET status, tx_hash, updated_at WHERE id. Returns updated row or null. */
  async updatePayout(id: string, status: PayoutStatus, txHash?: string): Promise<PayoutRow | null> {
    try {
      return await this.prisma.payout.update({
        where: { id },
        data: { status, txHash, updatedAt: new Date() },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return null;
      }
      throw e;
    }
  }

  /** Single-row read by id. */
  async findById(id: string): Promise<PayoutRow | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  /**
   * Atomic ledger post + balance decrement.
   * Throws OverdraftError if the guard fails (defensive; should not happen
   * if reservation logic is correct).
   */
  async confirmPayoutLedger(accountId: string, payoutId: string, amount: bigint): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.create({
        data: {
          accountId,
          debit: amount,
          credit: 0n,
          referenceType: 'payout',
          referenceId: payoutId,
        },
      });

      const updated = await tx.$executeRaw`
        UPDATE accounts SET balance = balance - ${amount}
        WHERE id = ${accountId} AND balance >= ${amount}
      `;

      if (updated === 0) {
        throw new OverdraftError(
          `Balance guard failed for account ${accountId}: balance < ${amount}`,
        );
      }
    });
  }
}
```
