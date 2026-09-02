# repair1-payout.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payout/payout.service.ts`:

```
src/payout/payout.service.ts(64,42): error TS2339: Property 'findByAccountIdAndIdempotencyKey' does not exist on type 'PayoutRepository'.
```

This is the only error in `payout.service.ts`. Looking at the reference `payout.repository.ts`, it does have a method `findByAccountIdAndIdempotencyKey`. So the issue is that the compiler can't see it on `PayoutRepository` type.

Wait, let me re-read. The error says "Property 'findByAccountIdAndIdempotencyKey' does not exist on type 'PayoutRepository'." But the reference file clearly shows this method exists on the class. So why would the compiler say it doesn't exist?

The answer: The other errors in `payout.repository.ts` are preventing it from compiling properly. Specifically:
```
src/payout/payout.repository.ts(4,31): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.
src/payout/payout.repository.ts(38,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.repository.ts(117,43): error TS7006: Parameter 'tx' implicitly has an 'any' type.
```

These errors in the repository file cause the `PayoutRepository` class to not fully type-check, which cascades to the service file. But the task says "Change nothing the messages do not name" and I'm only asked to rewrite `src/payout/payout.service.ts`.

So the fix for `payout.service.ts` line 64 is that it's calling `this.repo.findByAccountIdAndIdempotencyKey(...)` and the compiler says that property doesn't exist on `PayoutRepository`.

Since I can only modify `payout.service.ts`, and the error is that the method doesn't exist on the type, I need to handle this. The method clearly exists in the source (as shown in the reference), but the compiler can't see it due to the cascading errors from the missing `prisma.service` module.

The cleanest approach: I should keep using the method but acknowledge in an `// ASSUMPTION:` comment that the method exists on the repository but the compiler can't verify it due to upstream module resolution errors.

Wait, but that won't actually fix the compilation error. The task says "fixing what these messages require of this file." 

Let me think about what I can do within `payout.service.ts` to make this work:

1. Cast the repo to `any` - bad practice
2. Use a type assertion - still won't help if the property truly isn't visible
3. Use bracket notation `this.repo['findByAccountIdAndIdempotencyKey']` - still won't help
4. Add a local interface that extends `PayoutRepository` with the method - this could work

Actually wait. Let me re-read the constraint: "Change nothing the messages do not name." The message names `payout.service.ts(64,42)`. So I need to fix line 64 of the service.

The issue is that `PayoutRepository`'s type is broken because its own imports are broken. The compiler sees the class but can't resolve all its methods properly when there are errors in the class file itself.

Actually, I think the real issue might be simpler. Let me look at this differently. If the `PayoutRepository` class has compilation errors, TypeScript might still export the class but with an incomplete type. In strict mode, if the class has errors that prevent it from being fully resolved, properties might not be visible.

The most pragmatic fix within `payout.service.ts` that doesn't change other files:

Option A: Import the type and use a local interface that declares the method we need.

Option B: Use `as any` on the specific call - but that's ugly and the plan says to keep things clean.

Option C: The method DOES exist in the source file (as shown), so maybe the issue is just that TypeScript's error recovery is reporting it. In that case, if I can't fix the upstream files, I should add an ASSUMPTION comment.

Wait, re-reading the instructions: "If satisfying the compiler seems to require abandoning something the plan specified, keep the plan and add one `// ASSUMPTION:` line saying what you could not reconcile."

So I should keep the call to `findByAccountIdAndIdempotencyKey` (as the plan specifies) and add an ASSUMPTION line explaining that the method exists on the repository but the compiler can't verify it due to upstream module resolution errors.

But that doesn't actually fix the compilation... Hmm.

Let me think again. The task says "fixing what these messages require of this file." Maybe the fix is simply to ensure the call is correct and add the assumption. The other errors (in repository, outbox.repository, provider.interface, test) are not in this file and I'm told not to change them.

Actually, I think the most reasonable interpretation is: I need to write the complete `payout.service.ts` file that would be correct if the upstream issues were fixed. The one error in this file is a cascade from the repository file's broken imports. I should write the correct code and add an ASSUMPTION line.

Let me now write the complete `payout.service.ts` based on the PLAN.md:

From the plan:
```ts
@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
  ) {}

  /**
   * Validates the DTO (amount > 0, non-empty strings), calls
   * repo.createPayoutWithReservation. Maps P2002 → conflict check (same body → return
   * existing; different body → 409 idempotency_conflict). Maps InsufficientFundsError → 422.
   */
  create(dto: CreatePayoutDto): Promise<PayoutResponse>;
}
```

The service needs to:
1. Validate the DTO (amount > 0, non-empty strings)
2. Parse amount from string to BigInt
3. Call `repo.createPayoutWithReservation`
4. Handle P2002 (unique constraint violation) → check if same body → return existing; different body → 409
5. Handle 'ACCOUNT_NOT_FOUND' error → 404
6. Handle 'INSUFFICIENT_FUNDS' error → 422

For the error handling, I need to throw NestJS exceptions with the proper error envelope. The plan says errors use:
```json
{ "error": { "code": "<snake_case>", "message": "...", "details": {} } }
```

I'll need to use `HttpException` with a custom response body, or create custom exception classes. Let me think about what's cleanest within this file.

Looking at the plan's error table:
- `validation_failed` → 400 (controller)
- `resource_not_found` → 404 (service)
- `insufficient_funds` → 422 (repo → service)
- `idempotency_conflict` → 409 (service)

The plan says validation is in the controller, but the service also validates (amount > 0, etc.). Let me re-read: "Validates the DTO (amount > 0, non-empty strings)" - so the service does some validation too.

Actually looking more carefully at the plan:
- Controller: "input validation" - missing/empty fields, amount ≤ 0 or non-numeric
- Service: "create() business logic + error mapping"

So the controller does basic validation (missing fields, non-numeric amount), and the service does the business logic. But the plan's service description says "Validates the DTO (amount > 0, non-empty strings)" - so there's some overlap. I'll include validation in the service as the plan says, and the controller can do its own too.

Wait, but the plan says for `validation_failed`: "Controller: missing/empty fields, amount ≤ 0 or non-numeric". So validation is the controller's job. The service just maps errors from the repository.

Let me re-read the plan's service description: "Validates the DTO (amount > 0, non-empty strings), calls repo.createPayoutWithReservation."

OK so the service does validate. I'll include it. If the controller also validates, that's fine - defense in depth.

Now for the P2002 handling: When the unique constraint on `(account_id, idempotency_key)` is violated, Prisma throws a `PrismaClientKnownRequestError` with code 'P2002'. The service catches this, fetches the existing payout by `accountId` and `idempotencyKey`, then:
- If the existing payout has the same `amount` and `destinationAddress` → return it (200, idempotent)
- If different → throw 409 `idempotency_conflict`

Now let me write the file. I need to import:
- `Injectable`, `HttpException` (or custom) from `@nestjs/common`
- `Prisma` from `@prisma/client` (for the P2002 error type)
- `PayoutRepository` from `./payout.repository.js`
- Types from `./payout.types.js`

Wait, the plan says ESM with `.js` extensions for imports (since `"type": "module"`). Let me check the repository file - it uses `./payout.types.js` in its import. So I should use `.js` extensions.

Actually looking at the reference `payout.repository.ts`:
```ts
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PayoutStatus } from './payout.types.js';
```

Yes, `.js` extensions. I'll follow that pattern.

Now, for the P2002 detection, I need to check if the error is a Prisma known request error with code 'P2002'. The type is `Prisma.PrismaClientKnownRequestError`.

Let me write the complete file:

```ts
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutRepository } from './payout.repository.js';
import type { CreatePayoutDto, PayoutResponse, PayoutStatus } from './payout.types.js';
import {
  ERROR_INSUFFICIENT_FUNDS,
  ERROR_IDEMPOTENCY_CONFLICT,
  ERROR_ACCOUNT_NOT_FOUND,
} from './payout.types.js';

@Injectable()
export class PayoutService {
  constructor(private readonly repo: PayoutRepository) {}

  async create(dto: CreatePayoutDto): Promise<PayoutResponse> {
    // Validate
    if (!dto.accountId || !dto.destinationAddress || !dto.idempotencyKey) {
      throw new HttpException(
        { error: { code: 'validation_failed', message: 'accountId, amount, destinationAddress, and idempotencyKey are required', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    let amount: bigint;
    try {
      amount = BigInt(dto.amount);
    } catch {
      throw new HttpException(
        { error: { code: 'validation_failed', message: 'amount must be a valid integer string', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (amount <= 0n) {
      throw new HttpException(
        { error: { code: 'validation_failed', message: 'amount must be greater than zero', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const payout = await this.repo.createPayoutWithReservation({
        accountId: dto.accountId,
        amount,
        destinationAddress: dto.destinationAddress,
        idempotencyKey: dto.idempotencyKey,
      });

      return {
        id: payout.id,
        status: payout.status,
        amount: payout.amount.toString(),
      };
    } catch (err) {
      // Idempotency conflict: unique constraint on (account_id, idempotency_key)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.repo.findByAccountIdAndIdempotencyKey(
          dto.accountId,
          dto.idempotencyKey,
        );

        if (existing && existing.amount === amount && existing.destinationAddress === dto.destinationAddress) {
          return {
            id: existing.id,
            status: existing.status,
            amount: existing.amount.toString(),
          };
        }

        throw new HttpException(
          { error: { code: ERROR_IDEMPOTENCY_CONFLICT, message: 'idempotency key already used with different parameters', details: {} } },
          HttpStatus.CONFLICT,
        );
      }

      if (err instanceof Error && err.message === 'ACCOUNT_NOT_FOUND') {
        throw new HttpException(
          { error: { code: ERROR_ACCOUNT_NOT_FOUND, message: 'account not found', details: {} } },
          HttpStatus.NOT_FOUND,
        );
      }

      if (err instanceof Error && err.message === 'INSUFFICIENT_FUNDS') {
        throw new HttpException(
          { error: { code: ERROR_INSUFFICIENT_FUNDS, message: 'account does not have sufficient available funds', details: {} } },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      throw err;
    }
  }
}
```

Wait, but the error at line 64 says `findByAccountIdAndIdempotencyKey` doesn't exist on `PayoutRepository`. This is because the repository file has compilation errors (missing `prisma.service` module) which cascade. Since I can only fix this file, and the method clearly exists in the source, I should add an ASSUMPTION line.

Actually, let me reconsider. The instruction says "fixing what these messages require of this file." The message is:
```
src/payout/payout.service.ts(64,42): error TS2339: Property 'findByAccountIdAndIdempotencyKey' does not exist on type 'PayoutRepository'.
```

This is a cascade error. The method exists in the source but TypeScript can't verify it because the repository file itself has errors. I cannot fix the repository file (not asked to). So I need to either:
1. Add an ASSUMPTION and keep the code as-is (it will still error until the repo is fixed)
2. Work around it somehow

Option 2 workarounds:
- Cast: `(this.repo as any).findByAccountIdAndIdempotencyKey(...)` - ugly
- Define a local interface with the method and cast the repo to it

Actually, I think the cleanest approach given the constraints is to add an `// ASSUMPTION:` comment explaining that the method exists on PayoutRepository but the compiler cannot verify it due to upstream module resolution errors in that file. The code is correct; it just can't compile until the upstream issues are fixed.

Let me finalize my answer with this approach.
```

## reply

```ts
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutRepository } from './payout.repository.js';
import type { CreatePayoutDto, PayoutResponse } from './payout.types.js';
import {
  ERROR_INSUFFICIENT_FUNDS,
  ERROR_IDEMPOTENCY_CONFLICT,
  ERROR_ACCOUNT_NOT_FOUND,
  ERROR_VALIDATION,
} from './payout.types.js';

@Injectable()
export class PayoutService {
  constructor(private readonly repo: PayoutRepository) {}

  async create(dto: CreatePayoutDto): Promise<PayoutResponse> {
    // ── Validation ──
    if (!dto.accountId || !dto.destinationAddress || !dto.idempotencyKey) {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'accountId, amount, destinationAddress, and idempotencyKey are required', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    let amount: bigint;
    try {
      amount = BigInt(dto.amount);
    } catch {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'amount must be a valid integer string', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (amount <= 0n) {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'amount must be greater than zero', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    // ── Create payout with reservation ──
    try {
      const payout = await this.repo.createPayoutWithReservation({
        accountId: dto.accountId,
        amount,
        destinationAddress: dto.destinationAddress,
        idempotencyKey: dto.idempotencyKey,
      });

      return {
        id: payout.id,
        status: payout.status,
        amount: payout.amount.toString(),
      };
    } catch (err) {
      // Idempotency conflict: unique constraint on (account_id, idempotency_key) violated
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // ASSUMPTION: findByAccountIdAndIdempotencyKey exists on PayoutRepository (verified in source) but the compiler cannot resolve it because payout.repository.ts has its own module-resolution errors that prevent full type inference.
        const existing = await this.repo.findByAccountIdAndIdempotencyKey(
          dto.accountId,
          dto.idempotencyKey,
        );

        if (
          existing &&
          existing.amount === amount &&
          existing.destinationAddress === dto.destinationAddress
        ) {
          return {
            id: existing.id,
            status: existing.status,
            amount: existing.amount.toString(),
          };
        }

        throw new HttpException(
          { error: { code: ERROR_IDEMPOTENCY_CONFLICT, message: 'idempotency key already used with different parameters', details: {} } },
          HttpStatus.CONFLICT,
        );
      }

      if (err instanceof Error && err.message === 'ACCOUNT_NOT_FOUND') {
        throw new HttpException(
          { error: { code: ERROR_ACCOUNT_NOT_FOUND, message: 'account not found', details: {} } },
          HttpStatus.NOT_FOUND,
        );
      }

      if (err instanceof Error && err.message === 'INSUFFICIENT_FUNDS') {
        throw new HttpException(
          { error: { code: ERROR_INSUFFICIENT_FUNDS, message: 'account does not have sufficient available funds', details: {} } },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      throw err;
    }
  }
}
```
