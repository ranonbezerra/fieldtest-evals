# repair2-payout.repository.ts

## reasoning

```
Let me analyze the compiler errors to understand what's needed:

1. `src/payout/payout.repository.ts(4,31): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.`
   - The file imports from `../prisma/prisma.service.js` which doesn't exist. I need to handle this.

2. `src/outbox/outbox.service.ts(2,28): error TS2459: Module '"./outbox.repository.js"' declares 'OutboxMessageRow' locally, but it is not exported.`
   - This is in outbox.repository.ts, not payout.repository.ts. I'm told to only change what the messages name in payout.repository.ts.

3. `test/payout.spec.ts(51,33): error TS2345: ... Property 'prisma' is missing in type '{...}' but required in type 'PayoutRepository'.`
   - The test creates a mock object with methods but the `PayoutRepository` class has a required `prisma` property (from the constructor parameter `private readonly prisma: PrismaService`). The test is passing a plain object that doesn't have `prisma`.
   - To fix this, I need to make the class not require `prisma` as a public/required property. But wait - the plan says the repository uses Prisma. The issue is that `private readonly prisma: PrismaService` makes it a required property on the class type.
   - Actually, looking more carefully: when you use `constructor(private readonly prisma: PrismaService)`, TypeScript creates a public property `prisma` on the class. The test mock doesn't have this property, so it can't be assigned to `PayoutRepository`.
   - The fix: I need to not use parameter properties (or make the prisma property not part of the public type). But the plan says the repository is the only layer that touches the database and uses Prisma.
   - Wait, let me re-read the error: "Property 'prisma' is missing in type '{ createPayoutWithReservation: Mock<Procedure>; ... }' but required in type 'PayoutRepository'."
   - The test is creating a mock with only the methods, not a full class instance. For this to work, the `prisma` property should not be required on the type.
   - One approach: use a regular constructor parameter (not a parameter property) and assign it to a private field. But that still creates a property on the class...
   - Actually, in TypeScript, `constructor(private readonly prisma: PrismaService)` creates a public property. If I use `constructor(prisma: PrismaService) { this.prisma = prisma; }` with `private readonly prisma: PrismaService`, it's still a property.
   - The real fix for the test issue: the test needs to be able to create a mock that satisfies the `PayoutRepository` type. The way to do this is to either:
     1. Export an interface for the repository methods and have the test mock that interface
     2. Make `prisma` not a required property (impossible if it's needed)
     3. Use `as any` or `as PayoutRepository` in the test

   But wait - I'm told "Change nothing the messages do not name." The message names `src/payout/payout.repository.ts` as the file to fix. The test file error says the mock can't be assigned to `PayoutRepository` because `prisma` is missing.

   Hmm, but I'm told to rewrite `src/payout/payout.repository.ts` fixing what the messages require of THIS file. The test error is about the test not matching the repository type. If I can't change the test, I need to make the repository type not require `prisma` as a public property.

   One way: define the class without exposing `prisma` as a type-level property. I could use a non-parameter-property approach:
   ```ts
   export class PayoutRepository {
     private prisma: PrismaService;
     constructor(prisma: PrismaService) {
       this.prisma = prisma;
     }
   }
   ```
   
   Wait, but `private` properties in TypeScript are still part of the type for assignability purposes... Actually no! In TypeScript, `private` members DO affect structural typing. A class with a `private` property cannot be assigned from an object literal that doesn't have that property.

   Actually, let me reconsider. In TypeScript:
   - `private` members are checked nominally for class types - you can only assign one class instance to another if they're the same class or have compatible private members.
   - Actually no, `private` members in TypeScript create a "nominal" barrier. An object literal `{ createPayoutWithReservation: ... }` cannot be assigned to `PayoutRepository` if `PayoutRepository` has any `private` or `protected` members, because the object literal doesn't come from that class.

   Wait, that's exactly the issue! If I make `prisma` a `private` property (not `public`), then the type check becomes nominal - you can only assign a `PayoutRepository` to a `PayoutRepository`. But the test is trying to assign a plain object to `PayoutRepository`, which would fail.

   Hmm, but the error says "Property 'prisma' is missing" - this means `prisma` is currently a public property (from the parameter property `private readonly prisma`). Wait no - `private readonly` makes it private. Let me re-read...

   Actually, `constructor(private readonly prisma: PrismaService)` creates a property that is `private readonly`. In TypeScript's structural type system, private members DO participate in type compatibility. Specifically:
   - Two types are compatible if they have the same structure AND their private/protected members come from the same declaration.
   - An object literal cannot satisfy a type with private members because it doesn't originate from that class.

   But the error message says "Property 'prisma' is missing" which suggests it's being treated as a public property. Let me look at this differently.

   Actually, I think the issue might be different. When you have `constructor(private readonly prisma: PrismaService)`, the resulting class has a public property `prisma` of type `PrismaService`. No wait - `private readonly` means it's private.

   Let me think again. In TypeScript:
   ```ts
   class Foo {
     constructor(private readonly prisma: PrismaService) {}
   }
   ```
   This is equivalent to:
   ```ts
   class Foo {
     private readonly prisma: PrismaService;
     constructor(prisma: PrismaService) {
       this.prisma = prisma;
     }
   }
   ```

   Now, can you assign `{ someMethod: ... }` to `Foo`? No, because `Foo` has a private member, making it nominally typed. You'd get an error like "Type '{...}' is missing the following properties from type 'Foo': prisma" or "Property 'prisma' is private in type 'Foo' but not in type '{...}'".

   The actual error message is: "Property 'prisma' is missing in type '{...}' but required in type 'PayoutRepository'."

   This suggests that `prisma` is being seen as a required public property. This would happen if the parameter property wasn't actually making it private... or if there's something else going on.

   Wait - I just realized. The error is from the perspective of the test file. The test is doing something like:
   ```ts
   const mockRepo = { createPayoutWithReservation: vi.fn(), ... };
   someFunction(mockRepo as PayoutRepository);
   ```
   or passing it where `PayoutRepository` is expected.

   If `prisma` is a parameter property with `private readonly`, the TypeScript compiler would indeed report it as required. The fix from the repository file's perspective: I need to make the class not expose `prisma` in its public type.

   Actually, the cleanest solution that keeps the plan intact: I'll keep using Prisma internally but not as a parameter property. Instead, I'll store it in a way that doesn't appear in the public type. But in TypeScript, any instance property (even private) affects assignability...

   Wait, I need to re-examine. Let me look at what actually happens:

   ```ts
   class A {
     private x: number;
     constructor(x: number) { this.x = x; }
     method(): void {}
   }
   
   const a: A = { method: () => {} } as any; // works with as any
   const b: A = { method: () => {} } as A; // error? 
   ```

   Actually in strict mode:
   ```ts
   const obj = { method: () => {} };
   const a: A = obj; // Error: Property 'x' is missing in type '{ method: () => void; }' but required in type 'A'.
   ```

   Hmm, actually I'm not sure private properties show up like that. Let me think...

   In TypeScript, when checking assignability:
   - If the target type has a `private` or `protected` member, the source must be the same class (or subclass).
   - The error message for this is typically: "Type 'X' is not assignable to type 'A'. Types have separate declarations of a private property 'x'."

   But the error we see is: "Property 'prisma' is missing in type '{...}' but required in type 'PayoutRepository'."

   This error pattern ("Property X is missing") is the one you get for PUBLIC required properties. For private properties, you'd get a different error.

   So maybe the original code has `prisma` as a public property? Let me look at the reference code for `outbox.repository.ts`:
   ```ts
   constructor(private readonly prisma: PrismaService) {}
   ```

   This makes `prisma` private. But the error for the outbox test (line 266) says the same thing: "Property 'prisma' is missing in type '{...}' but required in type 'OutboxRepository'."

   So it seems like TypeScript IS reporting private parameter properties as "missing" when you try to assign an object literal. Let me verify my understanding...

   Actually, I just recalled: in TypeScript, `private` members DO create a nominal type barrier. The exact error depends on the situation:
   - If you try to assign a different class instance: "Type 'B' is not assignable to type 'A'. Types have separate declarations of a private property 'prisma'."
   - If you try to assign an object literal: "Property 'prisma' is missing in type '{...}' but required in type 'A'."

   Yes! That's it. Object literals get the "missing property" error, while class instances get the "separate declarations" error.

   So the fix: I need to make `PayoutRepository` not have any private/protected members that would prevent an object literal from being assigned to it. But I still need Prisma internally...

   Options:
   1. Don't use a class - use an interface + factory function
   2. Make `prisma` not a property (e.g., pass it to methods)
   3. Use a module-level variable (bad practice)
   4. Make the class have no private members and accept prisma differently

   Actually, the simplest fix that maintains the architecture: define an interface for the public methods, and have the class implement it. Then in tests, you can mock the interface instead of the class.

   But wait - the test error says the argument is not assignable to `PayoutRepository` (the class type), not an interface. If I can't change the test, I need `PayoutRepository` to be assignable from a plain object with just the methods.

   The only way to do that in TypeScript is to have NO private or protected members on the class. If all members are public, then structural typing applies and an object with the same shape is assignable.

   So: make `prisma` a public property? That's ugly but works. Or: don't store it as a property at all.

   Actually wait - what if I use a `#prisma` (ES2022 private field)? Those are truly private at the JS level and TypeScript treats them differently - they don't participate in structural typing!

   ```ts
   class PayoutRepository {
     #prisma: PrismaService;
     constructor(prisma: PrismaService) { this.#prisma = prisma; }
   }
   ```

   With `#prisma`, the TypeScript type of the class would only show the public methods. An object literal with those methods would be assignable to the class type!

   Let me verify: yes, `#` private fields are not part of the TypeScript type's public interface. They're erased from the type. So `{ createPayoutWithReservation: ..., updatePayout: ... }` would be assignable to `PayoutRepository`.

   This is the cleanest solution. Let me use `#prisma` instead of `private readonly prisma`.

   Now for the first error: `Cannot find module '../prisma/prisma.service.js'`

   The file doesn't exist in the workspace. I need to either:
   - Create it (but I'm told to only rewrite payout.repository.ts)
   - Use a different import approach
   - Add an ASSUMPTION comment

   Since I can only modify `src/payout/payout.repository.ts`, and the module doesn't exist, I'll add an ASSUMPTION line. But I still need to reference PrismaService somehow for the code to be type-correct...

   Actually, looking at the outbox.repository.ts reference, it has the same issue with the same comment:
   ```ts
   // ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
   import { PrismaService } from '../prisma/prisma.service.js';
   ```

   So the pattern is: keep the import, add an ASSUMPTION comment. The module will exist when the full project is assembled.

   Now let me also look at what methods the test expects on PayoutRepository:
   - `createPayoutWithReservation`
   - `updatePayout`
   - `findById`
   - `findByAccountIdAndIdempotencyKey` (this is in the test mock but NOT in the plan's repository interface!)
   - `confirmPayoutLedger`

   The plan lists:
   - `createPayoutWithReservation`
   - `updatePayout`
   - `findById`
   - `confirmPayoutLedger`

   But the test mock also has `findByAccountIdAndIdempotencyKey`. This method is needed for the idempotency conflict detection (when P2002 is caught, we need to fetch the existing row). The plan mentions this in the service description: "The service catches it, fetches the existing row, and either returns 200 (same body) or 409 (different body)."

   So I need to add `findByAccountIdAndIdempotencyKey` to the repository. This is implied by the plan's service logic even though it wasn't explicitly listed in the repo interface section.

   Now let me also check: the test at line 51 passes an object with these methods to something that expects `PayoutRepository`. If I use `#prisma`, the class type will only expose public methods, and the object literal with those methods should be assignable.

   Let me write the complete file:

```ts
import { Injectable } from '@nestjs/common';
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';
import type { PayoutStatus } from './payout.types.js';

interface PayoutRow {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

@Injectable()
export class PayoutRepository {
  #prisma: PrismaService;

  constructor(prisma: PrismaService) {
    this.#prisma = prisma;
  }

  async createPayoutWithReservation(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRow> {
    return this.#prisma.$transaction(async (tx) => {
      const account = await tx.$queryRawUnsafe<
        { balance: bigint } | undefined
      >(
        'SELECT balance FROM accounts WHERE id = $1 FOR UPDATE',
        params.accountId,
      );

      if (!account) {
        throw new Error('Account not found');
      }

      const reserved = await tx.$queryRawUnsafe<{ total: bigint | null }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM payouts WHERE account_id = $1 AND status IN ('created', 'processing', 'sent')`,
        params.accountId,
      );

      const available = account.balance - (reserved.total ?? 0n);
      if (available < params.amount) {
        throw new InsufficientFundsError(
          `Available balance ${available} is less than requested amount ${params.amount}`,
        );
      }

      const [payout] = await tx.$queryRawUnsafe<PayoutRow[]>(
        `INSERT INTO payouts (id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'created', NULL, now(), now())
         RETURNING id, account_id AS "accountId", amount, destination_address AS "destinationAddress", idempotency_key AS "idempotencyKey", status, tx_hash AS "txHash", created_at AS "createdAt", updated_at AS "updatedAt"`,
        params.accountId,
        params.amount,
        params.destinationAddress,
        params.idempotencyKey,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO outbox_messages (id, payout_id, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'pending', 0, NULL, NULL, now(), now())`,
        payout.id,
        JSON.stringify({ to: params.destinationAddress, amount: params.amount.toString() }),
      );

      return payout;
    });
  }

  async updatePayout(id: string, status: PayoutStatus, txHash?: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRawUnsafe<PayoutRow[]>(
      `UPDATE payouts SET status = $2, tx_hash = COALESCE($3, tx_hash), updated_at = now() WHERE id = $1
       RETURNING id, account_id AS "accountId", amount, destination_address AS "destinationAddress", idempotency_key AS "idempotencyKey", status, tx_hash AS "txHash", created_at AS "createdAt", updated_at AS "updatedAt"`,
      id,
      status,
      txHash ?? null,
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRawUnsafe<PayoutRow[]>(
      `SELECT id, account_id AS "accountId", amount, destination_address AS "destinationAddress", idempotency_key AS "idempotencyKey", status, tx_hash AS "txHash", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM payouts WHERE id = $1`,
      id,
    );
    return rows[0] ?? null;
  }

  async findByAccountIdAndIdempotencyKey(accountId: string, idempotencyKey: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRawUnsafe<PayoutRow[]>(
      `SELECT id, account_id AS "accountId", amount, destination_address AS "destinationAddress", idempotency_key AS "idempotencyKey", status, tx_hash AS "txHash", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM payouts WHERE account_id = $1 AND idempotency_key = $2`,
      accountId,
      idempotencyKey,
    );
    return rows[0] ?? null;
  }

  async confirmPayoutLedger(accountId: string, payoutId: string, amount: bigint): Promise<void> {
    await this.#prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO ledger_entries (id, account_id, debit, credit, reference_type, reference_id, created_at)
         VALUES (gen_random_uuid(), $1, $2, 0, 'payout', $3, now())`,
        accountId,
        amount,
        payoutId,
      );

      const result = await tx.$executeRawUnsafe<{ count: number }[]>(
        `UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING 1 AS count`,
        accountId,
        amount,
      );

      if (!result || result.length === 0) {
        throw new Error('Overdraft detected: balance insufficient for ledger confirmation');
      }
    });
  }
}
```

Wait, I need to think about whether `#prisma` will actually solve the test assignability issue. Let me trace through:

With `#prisma`, the TypeScript public type of `PayoutRepository` is:
```ts
{
  createPayoutWithReservation(params: {...}): Promise<PayoutRow>;
  updatePayout(id: string, status: PayoutStatus, txHash?: string): Promise<PayoutRow | null>;
  findById(id: string): Promise<PayoutRow | null>;
  findByAccountIdAndIdempotencyKey(accountId: string, idempotencyKey: string): Promise<PayoutRow | null>;
  confirmPayoutLedger(accountId: string, payoutId: string, amount: bigint): Promise<void>;
}
```

The test mock has:
```ts
{
  createPayoutWithReservation: Mock<Procedure>;
  updatePayout: Mock<Procedure>;
  findById: Mock<Procedure>;
  findByAccountIdAndIdempotencyKey: Mock<...>;
  confirmPayoutLedger: Mock<...>;
}
```

`Mock<Procedure>` is `(...args: any[]) => any` which is assignable to any function type. So yes, this should work!

But wait - I also need to make sure `PayoutRow` is exported if it's used in return types that the test needs to see. Actually, since the methods return `Promise<PayoutRow>`, and `PayoutRow` is an interface defined in the same file, it needs to be exported for the test to reference it (or at least for TypeScript to resolve the type).

Actually, for assignability checking, TypeScript doesn't need the interface to be exported - it just needs to be able to resolve the type. Since the test file imports `PayoutRepository` from this module, and `PayoutRow` is used in the method signatures, TypeScript will resolve it. But if the test explicitly references `PayoutRow`, it would need to be exported.

Looking at the test errors, they don't mention `PayoutRow` specifically, so I'll keep it unexported for now. Actually, let me export it to be safe - it's a public API of the repository.

Hmm, but the instruction says "Change nothing the messages do not name." The messages don't say anything about PayoutRow needing to be exported. I'll keep it as an internal interface (not exported) unless needed.

Actually, for the return types to be properly typed when the test uses them, it's fine if PayoutRow isn't exported - TypeScript will still check the types correctly through the method signatures.

Let me also double-check: the `$queryRawUnsafe` with `bigint` - does Prisma/PostgreSQL handle bigint natively? In PostgreSQL, `bigint` is returned as a string by the node-pg driver by default (or as a number if it fits). Prisma's `$queryRaw` might handle this differently.

Actually, this could be a problem. The `bigint` type in JavaScript is a real type, but PostgreSQL drivers typically return bigints as strings. Let me think about this...

For the purposes of making it compile (which is what's asked), the types I declare are what matter. At runtime, there might be issues with bigint serialization, but the task is to fix compile errors.

Let me also reconsider: should I use Prisma's typed query builder (model methods) instead of raw SQL? The plan says "repository is the only layer that touches the database" and the convention says "zero raw SQL, zero Prisma client calls" for the service layer. The repository CAN use Prisma client calls.

But the plan explicitly shows raw SQL patterns like `SELECT … FOR UPDATE` and `FOR UPDATE SKIP LOCKED`. Prisma doesn't support `FOR UPDATE` natively (well, it has some support in newer versions via `$queryRaw`). So using raw SQL in the repository is appropriate and consistent with the plan.

Actually, let me reconsider the approach. The plan shows:
- `createPayoutWithReservation` uses a transaction with SELECT FOR UPDATE
- The outbox repository (reference) uses `$queryRaw` for the FOR UPDATE SKIP LOCKED part and Prisma model methods for simple updates

I'll follow a similar pattern: use `$queryRaw`/`$executeRaw` for things that need raw SQL (FOR UPDATE, complex queries) and Prisma model methods for simple CRUD where possible.

Actually, for consistency and to keep it simple (and since the plan shows raw SQL patterns), I'll use raw SQL throughout. This also avoids issues with Prisma's BigInt handling in some edge cases.

Wait, one more thing: the `$queryRawUnsafe` vs `$queryRaw` distinction. `$queryRaw` uses tagged templates (safe), `$queryRawUnsafe` uses string interpolation (unsafe). For parameterized queries, I should use `$queryRaw` with tagged templates where possible.

Let me revise to use `$queryRaw` (tagged template) where I can:

```ts
const account = await tx.$queryRaw<{ balance: bigint }[]>`
  SELECT balance FROM accounts WHERE id = ${params.accountId}::uuid FOR UPDATE
`;
```

This is safer and more idiomatic. Let me rewrite with this approach.

Actually, I realize there might be an issue with `$queryRaw` and bigint. The tagged template version of `$queryRaw` in Prisma does handle parameters correctly. Let me use that.

Let me also think about the `PayoutRow` interface. In the raw SQL results, PostgreSQL returns column names in snake_case. I can either:
1. Use aliases in the SQL to get camelCase
2. Map from snake_case to camelCase in code

The outbox repository reference uses aliases in the SQL (e.g., `payout_id` is selected as-is and then mapped in code). Let me follow that pattern - select with snake_case and map in code.

Actually, looking at the outbox repository more carefully:
```ts
const rows: RawOutboxMessage[] = await tx.$queryRaw`
  SELECT id, payout_id, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at
  FROM outbox_messages
  ...
`;
```

It selects snake_case columns into a `RawOutboxMessage` interface, then maps to `OutboxMessageRow` (camelCase). I'll follow this pattern.

Let me write the final version:

```ts
import { Injectable } from '@nestjs/common';
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';
import type { PayoutStatus } from './payout.types.js';

export interface PayoutRow {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawPayoutRow {
  id: string;
  account_id: string;
  amount: bigint;
  destination_address: string;
  idempotency_key: string;
  status: string;
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

function mapRow(raw: RawPayoutRow): PayoutRow {
  return {
    id: raw.id,
    accountId: raw.account_id,
    amount: raw.amount,
    destinationAddress: raw.destination_address,
    idempotencyKey: raw.idempotency_key,
    status: raw.status as PayoutStatus,
    txHash: raw.tx_hash,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

const SELECT_PAYOUT = `id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at`;

@Injectable()
export class PayoutRepository {
  #prisma: PrismaService;

  constructor(prisma: PrismaService) {
    this.#prisma = prisma;
  }

  async createPayoutWithReservation(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRow> {
    return this.#prisma.$transaction(async (tx) => {
      const accounts = await tx.$queryRaw<{ balance: bigint }[]>`
        SELECT balance FROM accounts WHERE id = ${params.accountId}::uuid FOR UPDATE
      `;

      if (accounts.length === 0) {
        throw new Error('Account not found');
      }

      const reserved = await tx.$queryRaw<{ total: bigint | null }[]>`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payouts
        WHERE account_id = ${params.accountId}::uuid
          AND status IN ('created', 'processing', 'sent')
      `;

      const available = accounts[0].balance - (reserved[0]?.total ?? 0n);
      if (available < params.amount) {
        throw new InsufficientFundsError(
          `Available balance ${available.toString()} is less than requested amount ${params.amount.toString()}`,
        );
      }

      const [payout] = await tx.$queryRaw<RawPayoutRow[]>`
        INSERT INTO payouts (id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at)
        VALUES (gen_random_uuid(), ${params.accountId}::uuid, ${params.amount}, ${params.destinationAddress}, ${params.idempotencyKey}, 'created', NULL, now(), now())
        RETURNING ${SELECT_PAYOUT}
      `;

      await tx.$executeRaw`
        INSERT INTO outbox_messages (id, payout_id, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at)
        VALUES (gen_random_uuid(), ${payout.id}::uuid, ${JSON.stringify({ to: params.destinationAddress, amount: params.amount.toString() })}::jsonb, 'pending', 0, NULL, NULL, now(), now())
      `;

      return mapRow(payout);
    });
  }

  async updatePayout(id: string, status: PayoutStatus, txHash?: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRaw<RawPayoutRow[]>`
      UPDATE payouts
      SET status = ${status}, tx_hash = COALESCE(${txHash ?? null}, tx_hash), updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING ${SELECT_PAYOUT}
    `;
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findById(id: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRaw<RawPayoutRow[]>`
      SELECT ${SELECT_PAYOUT} FROM payouts WHERE id = ${id}::uuid
    `;
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findByAccountIdAndIdempotencyKey(accountId: string, idempotencyKey: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRaw<RawPayoutRow[]>`
      SELECT ${SELECT_PAYOUT} FROM payouts WHERE account_id = ${accountId}::uuid AND idempotency_key = ${idempotencyKey}
    `;
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async confirmPayoutLedger(accountId: string, payoutId: string, amount: bigint): Promise<void> {
    await this.#prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO ledger_entries (id, account_id, debit, credit, reference_type, reference_id, created_at)
        VALUES (gen_random_uuid(), ${accountId}::uuid, ${amount}, 0, 'payout', ${payoutId}::uuid, now())
      `;

      const result = await tx.$queryRaw<{ count: number }[]>`
        UPDATE accounts SET balance = balance - ${amount}
        WHERE id = ${accountId}::uuid AND balance >= ${amount}
        RETURNING 1 AS count
      `;

      if (result.length === 0) {
        throw new Error('Overdraft detected: balance insufficient for ledger confirmation');
      }
    });
  }
}
```

Hmm wait, I'm using a template literal constant `SELECT_PAYOUT` inside tagged template literals. This might not work correctly with Prisma's `$queryRaw` because the tagged template parser needs to see the full template. Let me inline the column list instead.

Actually, looking at Prisma's `$queryRaw` documentation - it uses a tagged template literal. The parser intercepts the template and the expressions. If I use a variable for part of the SQL string, it should still work because JavaScript template literals are resolved before being passed to the tag function. The tag function receives the cooked string parts and the values. So `SELECT ${SELECT_PAYOUT} FROM ...` would become `SELECT id, account_id, ... FROM ...` in the first string part, which is fine.

Wait no - that's not how tagged templates work. In a tagged template:
```ts
tag`Hello ${name}, welcome to ${place}`
```
The tag function receives:
- strings: ["Hello ", ", welcome to ", ""]
- values: [name, place]

So if I write:
```ts
const cols = "id, account_id";
tx.$queryRaw`SELECT ${cols} FROM table`
```
The tag function receives:
- strings: ["SELECT ", " FROM table"]
- values: [cols]

This means `cols` would be treated as a parameter value, not inlined into the SQL! That's wrong.

So I need to either:
1. Inline the column list in each query
2. Use `$queryRawUnsafe` with string concatenation for the static parts

Let me just inline the columns. It's repetitive but correct.

Actually wait - let me double check. In Prisma's `$queryRaw`, the tagged template works like this:
- String parts are SQL
- Expression parts (between backticks and ${}) are parameters

So `` tx.$queryRaw`SELECT id, name FROM users WHERE id = ${id}` `` would:
- Use "SELECT id, name FROM users WHERE id = " and "" as SQL parts
- Bind `id` as a parameter

If I do `` tx.$queryRaw`SELECT ${cols} FROM users` ``, it would:
- Use "SELECT " and " FROM users" as SQL parts
- Bind `cols` as a parameter (which would be wrong - it'd try to pass the string "id, name" as a parameter)

So yes, I must inline the column list. Let me do that.

Let me also reconsider: should I use `$queryRaw` (tagged) or `$queryRawUnsafe` (string)? For maximum clarity and to avoid any issues, I'll use tagged templates with all SQL inlined.

One more consideration: the `bigint` type in Prisma's raw queries. When you use `$queryRaw` with a parameter that is a `bigint`, Prisma should handle the serialization to PostgreSQL's `bigint` type. The return type from PostgreSQL for a `bigint` column... in node-pg, it's returned as a string by default. But Prisma might handle this differently.

For compilation purposes, I'll type the results as `bigint` and add an ASSUMPTION if needed. Actually, let me not over-think this - the task is to fix compile errors, not runtime behavior.

Let me finalize the file. I'll keep it clean and focused on what's needed to fix the compile errors while maintaining the plan's architecture.

Actually, one more thought: do I need to export `PayoutRow`? The test might reference it in type annotations. Looking at the test error messages, they don't specifically mention `PayoutRow`. But it's good practice to export it since it's part of the repository's public API (return types). I'll export it.

Also, I should export `InsufficientFundsError` since the service needs to catch it.

Let me write the final version now.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';
import type { PayoutStatus } from './payout.types.js';

export interface PayoutRow {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawPayoutRow {
  id: string;
  account_id: string;
  amount: bigint;
  destination_address: string;
  idempotency_key: string;
  status: string;
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

function mapRow(raw: RawPayoutRow): PayoutRow {
  return {
    id: raw.id,
    accountId: raw.account_id,
    amount: raw.amount,
    destinationAddress: raw.destination_address,
    idempotencyKey: raw.idempotency_key,
    status: raw.status as PayoutStatus,
    txHash: raw.tx_hash,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

@Injectable()
export class PayoutRepository {
  #prisma: PrismaService;

  constructor(prisma: PrismaService) {
    this.#prisma = prisma;
  }

  /**
   * Atomically: SELECT FOR UPDATE on the account row, compute available balance,
   * check sufficiency, INSERT payout + outbox message in one transaction.
   */
  async createPayoutWithReservation(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRow> {
    return this.#prisma.$transaction(async (tx) => {
      const accounts = await tx.$queryRaw<{ balance: bigint }[]>`
        SELECT balance FROM accounts WHERE id = ${params.accountId}::uuid FOR UPDATE
      `;

      if (accounts.length === 0) {
        throw new Error('Account not found');
      }

      const reserved = await tx.$queryRaw<{ total: bigint | null }[]>`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payouts
        WHERE account_id = ${params.accountId}::uuid
          AND status IN ('created', 'processing', 'sent')
      `;

      const available = accounts[0].balance - (reserved[0]?.total ?? 0n);
      if (available < params.amount) {
        throw new InsufficientFundsError(
          `Available balance ${available.toString()} is less than requested amount ${params.amount.toString()}`,
        );
      }

      const rows = await tx.$queryRaw<RawPayoutRow[]>`
        INSERT INTO payouts (id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at)
        VALUES (gen_random_uuid(), ${params.accountId}::uuid, ${params.amount}, ${params.destinationAddress}, ${params.idempotencyKey}, 'created', NULL, now(), now())
        RETURNING id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at
      `;

      const payout = rows[0];

      await tx.$executeRaw`
        INSERT INTO outbox_messages (id, payout_id, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at)
        VALUES (gen_random_uuid(), ${payout.id}::uuid, ${JSON.stringify({ to: params.destinationAddress, amount: params.amount.toString() })}::jsonb, 'pending', 0, NULL, NULL, now(), now())
      `;

      return mapRow(payout);
    });
  }

  /** UPDATE payouts SET status, tx_hash, updated_at WHERE id. Returns updated row or null. */
  async updatePayout(id: string, status: PayoutStatus, txHash?: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRaw<RawPayoutRow[]>`
      UPDATE payouts
      SET status = ${status}, tx_hash = COALESCE(${txHash ?? null}, tx_hash), updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at
    `;
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  /** Single-row read by id. */
  async findById(id: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRaw<RawPayoutRow[]>`
      SELECT id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at
      FROM payouts WHERE id = ${id}::uuid
    `;
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  /** Lookup by the unique (account_id, idempotency_key) pair. Returns row or null. */
  async findByAccountIdAndIdempotencyKey(accountId: string, idempotencyKey: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRaw<RawPayoutRow[]>`
      SELECT id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at
      FROM payouts WHERE account_id = ${accountId}::uuid AND idempotency_key = ${idempotencyKey}
    `;
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  /**
   * Atomic ledger post + balance decrement:
   * INSERT ledger_entries (debit=amount, credit=0) + UPDATE accounts SET balance = balance - amount
   * with a guard. In one transaction.
   */
  async confirmPayoutLedger(accountId: string, payoutId: string, amount: bigint): Promise<void> {
    await this.#prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO ledger_entries (id, account_id, debit, credit, reference_type, reference_id, created_at)
        VALUES (gen_random_uuid(), ${accountId}::uuid, ${amount}, 0, 'payout', ${payoutId}::uuid, now())
      `;

      const result = await tx.$queryRaw<{ count: number }[]>`
        UPDATE accounts SET balance = balance - ${amount}
        WHERE id = ${accountId}::uuid AND balance >= ${amount}
        RETURNING 1 AS count
      `;

      if (result.length === 0) {
        throw new Error('Overdraft detected: balance insufficient for ledger confirmation');
      }
    });
  }
}
```
