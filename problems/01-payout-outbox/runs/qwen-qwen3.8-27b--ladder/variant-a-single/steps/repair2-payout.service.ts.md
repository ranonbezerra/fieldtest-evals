# repair2-payout.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payout/payout.service.ts`:

1. `src/payout/payout.service.ts(3,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.`
2. `src/payout/payout.service.ts(4,40): error TS2307: Cannot find module './payout.errors' or its corresponding type declarations.`
3. `src/payout/payout.service.ts(5,41): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.`

So the file `src/payout/payout.service.ts` imports from:
- `./payout.repository` (line 3)
- `./payout.errors` (line 4)
- `./payout.types` (line 5)

These modules don't exist yet. But the task says "Change nothing the messages do not name." So I need to make the service file compile by ensuring it correctly references these modules. The modules themselves don't exist, but that's a problem for those other files to solve - I'm only asked to fix `src/payout/payout.service.ts`.

Wait, let me re-read: "Rewrite `src/payout/payout.service.ts` complete, fixing what these messages require of this file."

The messages that name this file are:
- Line 3: Cannot find module './payout.repository'
- Line 4: Cannot find module './payout.errors'
- Line 5: Cannot find module './payout.types'

These are import errors. The modules don't exist. But I'm told to "Change nothing the messages do not name." The messages say these modules can't be found. Since I can only modify `payout.service.ts`, I need to figure out what the service should look like.

Looking at the other errors, I can see what modules exist and what they export:
- `./payout.repository` - imported by `payout.module.ts`, `payout.worker.ts`, `test/payout.spec.ts`
- `./payout.errors` - imported by `test/payout.spec.ts`
- `./payout.types` - imported by `payout.worker.ts`, `test/payout.spec.ts`
- `./payout.provider` - imported by `payout.module.ts`, `payout.worker.ts`, `test/payout.spec.ts`
- `./payout.worker` - imported by `payout.module.ts`, `test/payout.spec.ts`

So these modules are expected to exist but don't yet. My task is just to write `payout.service.ts` that correctly imports from them and implements the service logic.

Now let me think about what the service needs to do based on the variant-a requirements:

1. `POST /payouts` — creates a payout if the account has sufficient available funds
2. Idempotency via `idempotencyKey`
3. Async processing via message table
4. Concurrency safety for balance
5. Track payout lifecycle
6. Double-entry ledger
7. Provider can fail transiently, retry bounded times

The service layer should:
- Hold business logic
- Call the repository (not Prisma directly)
- Not have raw SQL

Let me think about what the service needs:
- `createPayout(accountId, amount, destinationAddress, idempotencyKey)` - the main creation method
- It needs to check available balance, reserve funds, create payout, and enqueue a message
- All within a transaction for atomicity

The repository would handle the actual DB operations. The service orchestrates.

Now, what would `payout.repository` export? Based on the schema and requirements, it would likely export a `PayoutRepository` class with methods for:
- Creating payouts
- Checking balances
- Reserving funds
- Creating messages
- Updating payout status
- Creating ledger entries

What would `payout.errors` export? Probably error classes like `InsufficientFundsError`, `AccountNotFoundError`, etc.

What would `payout.types` export? Probably types/interfaces like `PayoutStatus`, `CreatePayoutInput`, etc.

Let me think about what the service looks like:

```typescript
import { Injectable } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { InsufficientFundsError, AccountNotFoundError } from './payout.errors';
import { CreatePayoutInput, CreatePayoutResult } from './payout.types';
```

The service needs to:
1. Look up the account
2. Check if the account has sufficient available funds (settledBalance - reservedBalance >= amount)
3. Reserve the amount (increment reservedBalance)
4. Create the payout record
5. Create a message for async processing
6. All in a transaction

Wait, but the idempotency check - if the same idempotencyKey is retried, it should return the existing payout without creating a new one or reserving funds again.

Let me think about the structure:

```typescript
@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    // 1. Check idempotency - if a payout already exists with this key for this account, return it
    // 2. Check account exists
    // 3. Check sufficient funds
    // 4. Reserve funds + create payout + create message (transaction)
  }
}
```

Now, the key question is: what exact names do the other modules export? Since I can't see them, I need to make reasonable assumptions and document them.

Looking at the test file import:
```
test/payout.spec.ts(5,40): error TS2307: Cannot find module '../src/payout/payout.errors' or its corresponding type declarations.
```

And the worker:
```
src/payout/payout.worker.ts(4,38): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
```

Let me make reasonable assumptions about the exports:

For `payout.repository`:
- `PayoutRepository` class

For `payout.errors`:
- Error classes. Common patterns: `InsufficientFundsError`, `AccountNotFoundError`

For `payout.types`:
- `CreatePayoutInput` interface with `{ accountId, amount, destinationAddress, idempotencyKey }`
- Maybe `CreatePayoutResult` or similar

Actually, since I'm told to "fix what these messages require of this file" and the messages are just "Cannot find module" - the issue is that the modules don't exist. But I can only modify `payout.service.ts`. 

Wait, I think the task is asking me to write the complete `payout.service.ts` file that would work correctly assuming the other modules exist with the right exports. The "fix" is to write a proper implementation that correctly imports and uses these modules.

Let me write a complete, well-structured service:

```typescript
import { Injectable } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { InsufficientFundsError, AccountNotFoundError } from './payout.errors';
import { CreatePayoutInput, CreatePayoutResult } from './payout.types';

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    // Idempotency check
    const existing = await this.repository.findPayoutByAccountAndIdempotencyKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing) {
      return { payoutId: existing.id, idempotent: true };
    }

    // Account must exist
    const account = await this.repository.findAccountById(input.accountId);
    if (!account) {
      throw new AccountNotFoundError(input.accountId);
    }

    // Check available balance
    const available = account.settledBalance - account.reservedBalance;
    if (available < input.amount) {
      throw new InsufficientFundsError(input.accountId, available, input.amount);
    }

    // Reserve funds, create payout, enqueue message — all in one transaction
    const payout = await this.repository.createPayoutWithReservation(
      input.accountId,
      input.amount,
      input.destinationAddress,
      input.idempotencyKey,
    );

    return { payoutId: payout.id, idempotent: false };
  }
}
```

Hmm, but I'm making assumptions about the repository method names. Let me think about what's most natural given the codebase conventions.

Actually, I realize I need to be more careful. The task says "Rewrite `src/payout/payout.service.ts` complete, fixing what these messages require of this file." The messages are just that the imports can't be resolved. The fix from this file's perspective is to have correct imports. But since the modules don't exist, the file won't compile regardless of what I write in it.

I think the intent is: write the complete service file as it should be, with correct imports that match what the other modules will export. The other files will be created separately.

Let me think about what makes sense for the domain:

The service needs to:
1. Handle idempotent payout creation
2. Check funds
3. Atomically reserve + create payout + enqueue message

For the repository, I'll assume it exposes methods that the service needs. The key insight is that the service should NOT call Prisma directly, and the repository should handle the DB logic.

Let me write this cleanly:

```typescript
import { Injectable } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { AccountNotFoundError, InsufficientFundsError } from './payout.errors';
import { CreatePayoutInput, CreatePayoutResult } from './payout.types';

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    // Idempotency: if a payout already exists for this (account, key) pair, return it.
    const existing = await this.repository.findPayoutByAccountAndIdempotencyKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing) {
      return { payoutId: existing.id, idempotent: true };
    }

    // Verify the account exists.
    const account = await this.repository.findAccountById(input.accountId);
    if (!account) {
      throw new AccountNotFoundError(input.accountId);
    }

    // Check available balance (settled − reserved).
    const available = account.settledBalance - account.reservedBalance;
    if (available < input.amount) {
      throw new InsufficientFundsError(available, input.amount);
    }

    // Atomically: reserve funds, create payout row, enqueue processing message.
    const payout = await this.repository.createPayoutWithReservation({
      accountId: input.accountId,
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      idempotencyKey: input.idempotencyKey,
    });

    return { payoutId: payout.id, idempotent: false };
  }
}
```

Wait, but there's a race condition issue. The check-then-act pattern (check balance, then reserve) is not safe under concurrency. The requirement says "Two racing requests must never overdraw the account."

The proper way is to do the balance check AND reservation in a single atomic operation in the repository. The repository's `createPayoutWithReservation` method should do this in a transaction with proper row locking (SELECT ... FOR UPDATE) or a conditional update.

So actually, the service might not need to check the balance separately - it should let the repository handle the atomic check-and-reserve, and the repository should throw (or return a signal) if there aren't enough funds.

Let me reconsider:

```typescript
async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
  // Idempotency check
  const existing = await this.repository.findPayoutByAccountAndIdempotencyKey(
    input.accountId,
    input.idempotencyKey,
  );
  if (existing) {
    return { payoutId: existing.id, idempotent: true };
  }

  // Atomically: check balance, reserve, create payout, enqueue message.
  // The repository handles the row lock to prevent concurrent overdraw.
  try {
    const payout = await this.repository.createPayoutWithReservation({
      accountId: input.accountId,
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      idempotencyKey: input.idempotencyKey,
    });
    return { payoutId: payout.id, idempotent: false };
  } catch (err) {
    if (err instanceof InsufficientFundsError) throw err;
    if (err instanceof AccountNotFoundError) throw err;
    throw err;
  }
}
```

Hmm, but that's a bit odd. Let me think differently.

Actually, the cleaner pattern for NestJS services is:
- The service does the orchestration logic
- The repository does the DB operations
- Errors are thrown from the repository (or the service checks)

Given that the concurrency requirement is strict, the atomic check-and-reserve should be in the repository. The service can still do a pre-check for a better error message, but the real safety comes from the repository's atomic operation.

Let me go with a design where:
1. Service checks idempotency (read)
2. Service calls repository to atomically create the payout with reservation
3. Repository throws `AccountNotFoundError` or `InsufficientFundsError` if the preconditions aren't met

This is cleaner and avoids the race condition in the service layer.

Actually wait - I should think about what's idiomatic here. The service is the "business logic" layer. The check for sufficient funds IS business logic. But the atomicity of the check+reserve is a database concern that belongs in the repository.

A good pattern:
- Service calls `repository.createPayoutWithReservation(...)` 
- Inside that repository method, it does: BEGIN; SELECT ... FOR UPDATE; check balance; if insufficient, ROLLBACK and throw; else UPDATE balance, INSERT payout, INSERT message; COMMIT
- The repository throws appropriate errors

So the service just needs to:
1. Check idempotency
2. Call the atomic repository method
3. Return the result

Let me finalize:

```typescript
import { Injectable } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { AccountNotFoundError, InsufficientFundsError } from './payout.errors';
import { CreatePayoutInput, CreatePayoutResult } from './payout.types';

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    // Idempotency: return the existing payout if this key was already used.
    const existing = await this.repository.findPayoutByAccountAndIdempotencyKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing) {
      return { payoutId: existing.id, idempotent: true };
    }

    // Atomically reserve funds, create the payout, and enqueue the processing
    // message. The repository uses a row-level lock on the account so that
    // concurrent requests cannot overdraw the balance.
    const payout = await this.repository.createPayoutWithReservation({
      accountId: input.accountId,
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      idempotencyKey: input.idempotencyKey,
    });

    return { payoutId: payout.id, idempotent: false };
  }
}
```

This is clean. The errors are thrown by the repository (AccountNotFoundError, InsufficientFundsError) and will bubble up to the controller/exception filter.

Now, do I need to import the error classes in the service? Not necessarily - they're thrown by the repository, not by the service directly. But it's fine to import them for documentation/type purposes. Actually, since the service doesn't throw them directly, I don't need to import them. Let me remove them.

Wait, but what if I want the service to do a pre-check for a better error? No, let's keep it simple. The repository handles it.

Final version:

```typescript
import { Injectable } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { CreatePayoutInput, CreatePayoutResult } from './payout.types';

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    const existing = await this.repository.findPayoutByAccountAndIdempotencyKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing) {
      return { payoutId: existing.id, idempotent: true };
    }

    const payout = await this.repository.createPayoutWithReservation({
      accountId: input.accountId,
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      idempotencyKey: input.idempotencyKey,
    });

    return { payoutId: payout.id, idempotent: false };
  }
}
```

This is clean, minimal, and correct. The service:
- Validates input via the controller (not here)
- Checks idempotency
- Delegates the atomic operation to the repository
- Returns the result

No business logic that belongs in the repository is duplicated here. No Prisma calls. No raw SQL.

Let me double-check the imports match what the compiler expects:
- Line 3 (approximately): `import { PayoutRepository } from './payout.repository';` ✓
- Line 4 (approximately): `import { ... } from './payout.errors';` - I'm not importing this anymore
- Line 5 (approximately): `import { ... } from './payout.types';` ✓

Wait, the original file had 3 imports at lines 3, 4, 5. My new file only has 2 imports (lines 2 and 3). That's fine - I'm rewriting the file, not patching it. The line numbers in the error messages refer to the old file.

Actually, let me reconsider whether I should import from `payout.errors`. If the service doesn't throw those errors, it doesn't need to import them. But maybe I should import them for the `instanceof` check pattern? No, the service doesn't catch errors from the repository - they bubble up.

I'll keep it minimal. Two imports: `PayoutRepository` and the types.

Let me also make sure the `CreatePayoutResult` type makes sense. It should have `payoutId` and `idempotent` (or similar). I'll assume that's what `payout.types` exports.

One more thought: should I add an `// ASSUMPTION:` comment? The instructions say "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

I'm guessing at the shapes of:
- `PayoutRepository` methods: `findPayoutByAccountAndIdempotencyKey`, `createPayoutWithReservation`
- `CreatePayoutInput`: `{ accountId, amount, destinationAddress, idempotencyKey }`
- `CreatePayoutResult`: `{ payoutId: string, idempotent: boolean }`

I should add an assumption line.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { CreatePayoutInput, CreatePayoutResult } from './payout.types';

// ASSUMPTION: PayoutRepository exposes findPayoutByAccountAndIdempotencyKey(accountId, key) → Payout | null
// and createPayoutWithReservation({ accountId, amount, destinationAddress, idempotencyKey }) → Payout,
// the latter performing an atomic check-and-reserve under a row-level lock.
// ASSUMPTION: CreatePayoutInput = { accountId: string; amount: bigint; destinationAddress: string; idempotencyKey: string }
// and CreatePayoutResult = { payoutId: string; idempotent: boolean }.

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    // Idempotency: return the existing payout if this (account, key) pair was already processed.
    const existing = await this.repository.findPayoutByAccountAndIdempotencyKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing) {
      return { payoutId: existing.id, idempotent: true };
    }

    // Atomically: verify balance, reserve funds, insert the payout row, and
    // enqueue the processing message. The repository holds a row-level lock on
    // the account for the duration of the transaction, preventing concurrent
    // requests from overdraw.
    const payout = await this.repository.createPayoutWithReservation({
      accountId: input.accountId,
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      idempotencyKey: input.idempotencyKey,
    });

    return { payoutId: payout.id, idempotent: false };
  }
}
```
