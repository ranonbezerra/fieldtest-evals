# repair1-payout.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payout/payout.service.ts`:

1. `src/payout/payout.service.ts(2,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.`
2. `src/payout/payout.service.ts(3,62): error TS2307: Cannot find module './payout.errors' or its corresponding type declarations.`
3. `src/payout/payout.service.ts(4,90): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.`
4. `src/payout/payout.service.ts(23,55): error TS7006: Parameter 'tx' implicitly has an 'any' type.`

So the file imports from:
- `./payout.repository` (line 2)
- `./payout.errors` (line 3)
- `./payout.types` (line 4)

And on line 23, there's a parameter `tx` that implicitly has an 'any' type.

The "Cannot find module" errors mean those files don't exist yet. But the task says "Change nothing the messages do not name." The messages name `payout.service.ts` and tell me to rewrite it. The missing modules are referenced by the service, so I need to either:
1. Create those modules (but the task says "Change nothing the messages do not name" and only asks me to rewrite `payout.service.ts`)
2. The task says "Rewrite `src/payout/payout.service.ts` complete, fixing what these messages require of this file."

Wait, let me re-read: "Rewrite `src/payout/payout.service.ts` complete, fixing what these messages require of this file."

So I'm only producing `src/payout/payout.service.ts`. The other files (`payout.repository.ts`, `payout.errors.ts`, `payout.types.ts`) are separate files that need to exist. The compiler errors about them not being found are because they don't exist yet, but I'm not asked to create them.

Actually wait - the task says "fixing what these messages require of this file." The "Cannot find module" errors are about the other files not existing. I can't fix those from within `payout.service.ts` alone. But I need to write the service such that when those modules exist, it will compile.

Let me look at what the service needs based on the errors and the reference material:

From the errors:
- Line 2: imports from `./payout.repository` 
- Line 3: imports from `./payout.errors`
- Line 4: imports from `./payout.types`
- Line 23: a parameter `tx` with implicit any type

The `tx` parameter issue suggests the service uses a transaction callback. Looking at the first error in the list (which is about `payout.repository.ts`), it shows a `Prisma.TransactionClient` type issue. But for the service, the `tx` parameter on line 23 is implicitly any.

Let me think about what the service should look like based on the requirements:

1. `POST /payouts` - creates a payout if account has sufficient funds, idempotent via `idempotencyKey`
2. Asynchronous processing via message queue
3. No overdraft under concurrency
4. Track lifecycle (created → processing → sent → completed / failed / needs-review)
5. Double-entry ledger
6. Retry with bounded attempts

The service needs to:
- Call the repository to create a payout (within a transaction for atomicity)
- Create a message for async processing
- Handle idempotency
- Handle the balance check

Let me think about what imports the service needs:

From `./payout.repository`:
- `PayoutRepository` class (injected)

From `./payout.errors`:
- Some error classes (e.g., `InsufficientFundsError`, `PayoutNotFoundError`, etc.)

From `./payout.types`:
- Types like `CreatePayoutDto`, `Payout`, etc.

Now, the `tx` parameter on line 23 - this suggests the service is calling a transaction method on the repository, something like:

```typescript
await this.repository.createPayoutInTransaction((tx) => { ... })
```

The issue is that `tx` needs a type annotation. Since the repository's transaction method would accept a callback with a `Prisma.TransactionClient` parameter, the service needs to type it.

But wait - the service shouldn't directly use Prisma (per the layering rules). The transaction callback type comes from Prisma though. Let me think...

Actually, looking at the Prisma schema reference, the service would call the repository, and the repository handles the Prisma transaction internally. The `tx` parameter in the service would be typed based on what the repository exposes.

Hmm, but if the repository's method signature is:
```typescript
createPayoutInTransaction(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>
```

Then the service would call:
```typescript
await this.repository.createPayoutInTransaction(async (tx: Prisma.TransactionClient) => { ... })
```

But that would mean the service imports `Prisma` which might be fine as a type-only import.

Actually, let me reconsider. The service should have zero Prisma client calls. But it can import the `Prisma` namespace for types. The `Prisma.TransactionClient` type is just a type, not a client call.

Let me draft the service:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutRepository } from './payout.repository';
import { InsufficientFundsError, PayoutNotFoundError } from './payout.errors';
import { CreatePayoutDto, Payout, PayoutStatus } from './payout.types';
```

Wait, but the task says the file has exactly these imports on lines 2, 3, 4. Let me count:
- Line 1: some import (maybe `@nestjs/common`)
- Line 2: import from `./payout.repository`
- Line 3: import from `./payout.errors`
- Line 4: import from `./payout.types`

So line 1 is likely `import { Injectable } from '@nestjs/common';` or similar.

Now for the `tx` parameter on line 23. The service is doing something like:

```typescript
await this.repository.createInTransaction(async (tx) => {
  // ...
});
```

And the fix is to type `tx` explicitly. But what type? It depends on what the repository exposes. Since I'm told to fix what the messages require of this file, and the message says "Parameter 'tx' implicitly has an 'any' type", I need to add a type annotation.

The most reasonable type for a Prisma transaction client in a service that shouldn't directly use Prisma would be... well, the type still comes from Prisma. The service can import `Prisma` for the type.

Actually, let me reconsider the architecture. The service calls the repository. The repository method that does the transaction would have a signature like:

```typescript
async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>
```

And the service calls:
```typescript
await this.repository.withTransaction(async (tx: Prisma.TransactionClient) => {
  const account = await tx.account.findUnique({ where: { id: dto.accountId } });
  // ...
});
```

But wait - that would be the service making Prisma calls (through the tx client), which violates the layering rule. The service should have "Zero raw SQL, zero Prisma client calls."

So the pattern must be different. The repository should expose domain-level methods, and the transaction is an implementation detail of the repository. The service would call something like:

```typescript
await this.repository.createPayout(dto.accountId, dto.amount, dto.destinationAddress, dto.idempotencyKey);
```

And the repository internally handles the transaction.

But then where does the `tx` parameter on line 23 come from? Maybe the service is passing a callback to the repository for the transaction? Like:

```typescript
await this.repository.createPayoutInTransaction(async (tx) => {
  // domain operations
});
```

Hmm, but that's still the service touching the transaction client.

Let me look at this differently. Maybe the repository has a method like:

```typescript
reserveAndCreatePayout(accountId: string, amount: bigint, destinationAddress: string, idempotencyKey: string): Promise<Payout>
```

And the service just calls that. No `tx` parameter needed.

But the error explicitly says line 23 has a `tx` parameter with implicit any. So the current (broken) code has this. I need to fix it.

Options:
1. The service passes a typed callback to the repository
2. Remove the `tx` parameter entirely by restructuring

Given the constraint "Change nothing the messages do not name" - the message names the `tx` parameter on line 23 as having an implicit any type. The fix is to add a type annotation. So I should keep the structure but add the type.

What type should `tx` be? Since the repository is the only layer that touches the database, and the service is passing a callback that operates within a transaction, the type would be `Prisma.TransactionClient`. The service would need to import `Prisma` for this type.

Wait, but that means the service is importing from `@prisma/client`. Is that a "Prisma client call"? No, importing a type is not a client call. The rule says "Zero raw SQL, zero Prisma client calls." Importing a type is fine.

Actually, let me reconsider. Maybe the repository defines its own type for the transaction callback parameter, and the service imports that from the repository. Like:

```typescript
// In payout.repository.ts
export type TxClient = Prisma.TransactionClient;

// In payout.service.ts
import { PayoutRepository, TxClient } from './payout.repository';
```

That would be cleaner from a layering perspective - the service doesn't directly reference Prisma types.

But I'm told to fix what the messages require. The message just says the parameter is implicitly any. I need to give it a type. Let me go with importing `Prisma` from `@prisma/client` for the type, since that's the most straightforward fix and the layering rule is about not making client calls, not about not importing types.

Actually, re-reading the constraints: "service holds the logic. Zero raw SQL, zero Prisma client calls." - This is about runtime calls, not type imports. So `import { Prisma } from '@prisma/client'` for a type is fine.

Now let me think about what the complete service looks like:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutRepository } from './payout.repository';
import { InsufficientFundsError, PayoutNotFoundError } from './payout.errors';
import { CreatePayoutDto } from './payout.types';
```

Wait, but the error says line 2 is the repository import, line 3 is errors, line 4 is types. So line 1 must be something else. Let me count:

```
Line 1: import { Injectable } from '@nestjs/common';
Line 2: import { PayoutRepository } from './payout.repository';
Line 3: import { InsufficientFundsError } from './payout.errors';
Line 4: import { CreatePayoutDto } from './payout.types';
```

But wait, I also need `Prisma` for the type. That would be another import line. Unless I use a different approach.

Hmm, let me think about this differently. What if the repository exports a type for the transaction client? Or what if I use a generic approach?

Actually, the simplest fix for the `tx` parameter is:

```typescript
await this.repository.withTransaction(async (tx: Prisma.TransactionClient) => {
```

This requires importing `Prisma`. Let me put it on line 1 or add it.

Let me re-examine. The errors for `payout.service.ts` are:
1. Line 2: Cannot find module './payout.repository'
2. Line 3: Cannot find module './payout.errors'
3. Line 4: Cannot find module './payout.types'
4. Line 23: Parameter 'tx' implicitly has an 'any' type

The "Cannot find module" errors will be resolved when those files exist. My job is to write the service so that when those files exist, it compiles.

For the `tx` parameter, I need to add a type. Let me write the complete service.

Let me think about what the service does:

1. `createPayout(dto: CreatePayoutDto)` - main entry point
   - Uses a transaction to:
     - Check/create the account
     - Check available balance (settled + reserved - already reserved? Or just settled?)
     
Wait, looking at the schema:
- `settledBalance` - the confirmed balance
- `reservedBalance` - amount reserved for in-progress payouts

Available funds = settledBalance (the reserved is already deducted from the usable amount, or is it that available = settled - reserved?)

Actually, let me think about this more carefully. The typical pattern:
- `settledBalance` = total money in the account
- `reservedBalance` = amount currently being processed (reserved)
- Available = settledBalance - reservedBalance

When creating a payout:
- Check: settledBalance - reservedBalance >= amount
- Reserve: reservedBalance += amount

When payout completes (transfer confirmed):
- settledBalance -= amount
- reservedBalance -= amount
- (Net effect: settled decreases by amount, reserved unchanged)

When payout fails:
- reservedBalance -= amount
- (The money goes back to available)

This makes sense with the double-entry ledger.

Now, for the service structure:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutRepository } from './payout.repository';
import { InsufficientFundsError, PayoutNotFoundError } from './payout.errors';
import { CreatePayoutDto, Payout } from './payout.types';

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(dto: CreatePayoutDto): Promise<Payout> {
    return this.repository.withTransaction(async (tx: Prisma.TransactionClient) => {
      // Check idempotency
      const existing = await this.repository.findPayoutByIdempotencyKey(tx, dto.accountId, dto.idempotencyKey);
      if (existing) return existing;

      // Check balance
      const account = await this.repository.findAccount(tx, dto.accountId);
      const available = account.settledBalance - account.reservedBalance;
      if (available < dto.amount) {
        throw new InsufficientFundsError(...);
      }

      // Reserve and create
      const payout = await this.repository.reserveAndCreatePayout(tx, dto);
      await this.repository.createMessage(tx, { type: 'payout:process', payload: { payoutId: payout.id } });
      return payout;
    });
  }
}
```

Hmm wait, but the service should have "Zero raw SQL, zero Prisma client calls." If the service is passing `tx` to repository methods, is that a "Prisma client call"? The service is using the transaction client to call repository methods... 

Actually, I think the pattern here is that the repository methods accept an optional transaction client. The service gets the transaction from `withTransaction` and passes it along. The service isn't making Prisma calls directly - it's passing the client to the repository.

But actually, looking at the error more carefully - the first error in the list is about `payout.repository.ts` line 79, which is about the `withTransaction` callback type. The error says:

```
Argument of type '(tx: TxClient) => Promise<T>' is not assignable to parameter of type '(prisma: Omit<PrismaClient<...>, ...>) => Promise<...>'.
```

This suggests the repository defines a `TxClient` type that's narrower than what Prisma's `$transaction` expects. The fix for the repository would be to use `Prisma.TransactionClient` instead of a custom `TxClient` type, or to properly type the callback.

But for the service, the issue is just that `tx` is implicitly any. The service is calling something like:

```typescript
this.repository.withTransaction(async (tx) => { ... })
```

And `tx` needs a type. If the repository's `withTransaction` is properly typed, then `tx` would be inferred. But since the repository file has its own errors, the inference fails and `tx` becomes implicit any.

The fix for the service is to explicitly type `tx`. The question is: what type?

If the repository properly types its method as:
```typescript
async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>
```

Then in the service, `tx` would be inferred as `Prisma.TransactionClient`. But since the repository has errors, inference breaks.

For the service to compile independently (or at least fix the implicit any), I should explicitly annotate `tx: Prisma.TransactionClient`.

Now, let me think about what imports I need:
- `@nestjs/common` for `@Injectable`
- `@prisma/client` for `Prisma` (type only)
- `./payout.repository` for `PayoutRepository`
- `./payout.errors` for error classes
- `./payout.types` for DTOs/types

But the error messages say lines 2, 3, 4 are the local imports. So line 1 is the first import. Let me structure it:

```typescript
import { Injectable } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { InsufficientFundsError, PayoutNotFoundError } from './payout.errors';
import { CreatePayoutDto, Payout } from './payout.types';
```

But I also need `Prisma`. I could add it as another import. Or I could use a type import.

Actually, wait. Let me reconsider. The `tx` parameter issue - maybe the service doesn't need to explicitly type it if the repository is properly typed. But since I'm told to fix the service, and the error is in the service, I should add the explicit type.

Let me add `import { Prisma } from '@prisma/client';` as a separate line.

But the constraint says "Change nothing the messages do not name." The messages name:
- The imports on lines 2, 3, 4 (cannot find module)
- The `tx` parameter on line 23 (implicit any)

Adding a new import line for `Prisma` is necessary to fix the `tx` type annotation. That's within scope.

Let me now write the complete service. I need to think about what methods the service should have based on the requirements:

1. `createPayout(dto)` - handles the POST /payouts logic
2. Maybe a `processPayout(payoutId)` method for the worker to call?

Looking at the worker errors:
```
src/payout/payout.worker.ts(3,34): error TS2307: Cannot find module './payout.repository'
src/payout/payout.worker.ts(4,49): error TS2307: Cannot find module './payout.provider'
src/payout/payout.worker.ts(5,75): error TS2307: Cannot find module './payout.types'
```

The worker imports from repository, provider, and types. So the worker probably calls the repository directly (for message processing) and the provider (for the actual transfer). The worker might not need the service.

So the service's main responsibility is the `createPayout` method. Let me also think about what the worker does:
- Polls for pending messages
- For each message, processes the payout (calls provider, updates status)
- Handles retries

The worker probably doesn't use the service - it uses the repository and provider directly.

So the service just needs:
- `createPayout(dto: CreatePayoutDto): Promise<Payout>`

Let me also think about what `payout.errors` exports. Based on the requirements:
- `InsufficientFundsError` - when balance is insufficient
- Maybe `PayoutNotFoundError` - for looking up payouts
- Maybe `InvalidPayoutError` or similar

And `payout.types` exports:
- `CreatePayoutDto` - the request body
- `Payout` - the payout entity (or a subset)
- `PayoutStatus` - the status enum (or re-exported from Prisma)

Let me write the service now:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutRepository } from './payout.repository';
import { InsufficientFundsError } from './payout.errors';
import { CreatePayoutDto, Payout } from './payout.types';

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(dto: CreatePayoutDto): Promise<Payout> {
    return this.repository.withTransaction(async (tx: Prisma.TransactionClient) => {
      // Idempotency check
      const existing = await this.repository.findByAccountAndIdempotencyKey(
        tx,
        dto.accountId,
        dto.idempotencyKey,
      );
      if (existing) {
        return existing;
      }

      // Check available balance
      const account = await this.repository.findAccountById(tx, dto.accountId);
      if (!account) {
        throw new Error('Account not found'); // or a specific error
      }

      const available = account.settledBalance - account.reservedBalance;
      if (available < dto.amount) {
        throw new InsufficientFundsError(available, dto.amount);
      }

      // Reserve funds and create payout atomically
      const payout = await this.repository.reserveFundsAndCreatePayout(
        tx,
        dto.accountId,
        dto.amount,
        dto.destinationAddress,
        dto.idempotencyKey,
      );

      // Enqueue processing message
      await this.repository.enqueueMessage(tx, {
        type: 'payout:process',
        payload: { payoutId: payout.id },
      });

      return payout;
    });
  }
}
```

Wait, but the line numbers matter. The error says line 23 has the `tx` parameter. Let me count lines in my draft:

```
1:  import { Injectable } from '@nestjs/common';
2:  import { Prisma } from '@prisma/client';
3:  import { PayoutRepository } from './payout.repository';
4:  import { InsufficientFundsError } from './payout.errors';
5:  import { CreatePayoutDto, Payout } from './payout.types';
6:  
7:  @Injectable()
8:  export class PayoutService {
9:    constructor(private readonly repository: PayoutRepository) {}
10: 
11:   async createPayout(dto: CreatePayoutDto): Promise<Payout> {
12:     return this.repository.withTransaction(async (tx: Prisma.TransactionClient) => {
```

That puts `tx` on line 12, not line 23. The original file has it on line 23. But I'm rewriting the file, so the line numbers will change. The important thing is that the `tx` parameter is explicitly typed.

Actually, I realize I don't need to match the exact line numbers of the original broken file. I'm rewriting it completely. The errors tell me what's wrong, and I fix those issues in my rewrite.

Let me also consider: should the service handle the "account not found" case with a specific error? Looking at the error envelope requirement, I should probably have a `PayoutNotFoundError` or `AccountNotFoundError`. But the task says I should only fix what the messages require. The messages for `payout.service.ts` are:
1. Cannot find module './payout.repository' (line 2)
2. Cannot find module './payout.errors' (line 3)
3. Cannot find module './payout.types' (line 4)
4. Parameter 'tx' implicitly has an 'any' type (line 23)

So I need to:
- Import from `./payout.repository` (the file will exist when created)
- Import from `./payout.errors` (the file will exist when created)
- Import from `./payout.types` (the file will exist when created)
- Type the `tx` parameter

The "Cannot find module" errors are not something I can fix in this file alone - they'll be resolved when the other files exist. My job is to write the service correctly assuming those files exist.

Let me also think about whether I need `PayoutNotFoundError` from the errors file. The service might need it for looking up payouts by id (if there's a GET endpoint). But the requirements only mention `POST /payouts`. Let me keep it minimal.

Actually, looking at the test file errors:
```
test/payout.spec.ts(7,40): error TS2307: Cannot find module '../src/payout/payout.errors' or its corresponding type declarations.
```

The test imports from errors. What errors would it need? Probably `InsufficientFundsError` at minimum.

Let me also look at the test errors:
```
test/payout.spec.ts(48,5): error TS2353: Object literal may only specify known properties, and 'transfer' does not exist in type 'TestProvider'.
test/payout.spec.ts(48,22): error TS7006: Parameter 'params' implicitly has an 'any' type.
test/payout.spec.ts(54,21): error TS7006: Parameter 'txHash' implicitly has an 'any' type.
```

These are test file issues, not service issues. I don't need to fix them.

OK let me finalize my service. I'll keep it focused on what the requirements ask:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutRepository } from './payout.repository';
import { InsufficientFundsError } from './payout.errors';
import { CreatePayoutDto, Payout } from './payout.types';

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(dto: CreatePayoutDto): Promise<Payout> {
    return this.repository.withTransaction(
      async (tx: Prisma.TransactionClient) => {
        const existing = await this.repository.findByAccountAndIdempotencyKey(
          tx,
          dto.accountId,
          dto.idempotencyKey,
        );
        if (existing) {
          return existing;
        }

        const account = await this.repository.findAccountById(tx, dto.accountId);
        const available = account.settledBalance - account.reservedBalance;

        if (available < dto.amount) {
          throw new InsufficientFundsError(available, dto.amount);
        }

        const payout = await this.repository.reserveFundsAndCreatePayout(
          tx,
          dto.accountId,
          dto.amount,
          dto.destinationAddress,
          dto.idempotencyKey,
        );

        await this.repository.enqueueMessage(tx, {
          type: 'payout:process',
          payload: { payoutId: payout.id },
        });

        return payout;
      },
    );
  }
}
```

This looks good. The `tx` parameter is explicitly typed as `Prisma.TransactionClient`, which fixes the implicit any error. The imports are correct for the modules that will exist.

Wait, one concern: the `account` returned by `findAccountById` - what if it's null/undefined? Should I handle that? The requirements say "if the account has sufficient available funds" - implying the account should exist. If it doesn't, that's a different error. But the task says "Do exactly what the task asks. Do not create a file it does not call for, and do not improve code you were not asked to change."

The compiler errors don't mention a null check issue, so I'll leave it as is. If the repository method returns `Account | null`, TypeScript would complain about using `account.settledBalance` without a null check. But since I don't know the exact return type of the repository method, and the errors don't mention this, I'll assume the repository method returns a non-nullable Account (or throws if not found).

Actually, let me add a non-null assertion or a check to be safe. But the errors don't mention this... Let me not add it. If the repository method is typed to return `Account` (not `Account | null`), then no null check is needed.

Let me finalize. I think my solution is correct. Let me double-check against all the service errors:

1. ✅ Line 2 (now line 3): imports from `./payout.repository` - will resolve when file exists
2. ✅ Line 3 (now line 4): imports from `./payout.errors` - will resolve when file exists
3. ✅ Line 4 (now line 5): imports from `./payout.types` - will resolve when file exists
4. ✅ Line 23 (now line 14): `tx` parameter explicitly typed as `Prisma.TransactionClient`

I think this is complete. Let me write the final version.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutRepository } from './payout.repository';
import { InsufficientFundsError } from './payout.errors';
import { CreatePayoutDto, Payout } from './payout.types';

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(dto: CreatePayoutDto): Promise<Payout> {
    return this.repository.withTransaction(
      async (tx: Prisma.TransactionClient) => {
        const existing = await this.repository.findByAccountAndIdempotencyKey(
          tx,
          dto.accountId,
          dto.idempotencyKey,
        );
        if (existing) {
          return existing;
        }

        const account = await this.repository.findAccountById(tx, dto.accountId);
        const available = account.settledBalance - account.reservedBalance;

        if (available < dto.amount) {
          throw new InsufficientFundsError(available, dto.amount);
        }

        const payout = await this.repository.reserveFundsAndCreatePayout(
          tx,
          dto.accountId,
          dto.amount,
          dto.destinationAddress,
          dto.idempotencyKey,
        );

        await this.repository.enqueueMessage(tx, {
          type: 'payout:process',
          payload: { payoutId: payout.id },
        });

        return payout;
      },
    );
  }
}
```
