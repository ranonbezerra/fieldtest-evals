# 05-payout.service.ts

## reasoning

```
Let me analyze what I need to write for `src/payout/payout.service.ts` based on the PLAN.md and the reference files.

From the PLAN.md, section 3:

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

From the error mapping in the plan:
- `validation_failed` | 400 | Controller: missing/empty fields, amount ≤ 0 or non-numeric
- `resource_not_found` | 404 | Service: accountId does not exist
- `insufficient_funds` | 422 | Repository → Service: available < amount
- `idempotency_conflict` | 409 | Service: same key, different body fields

Wait, the plan says validation is done in the controller. Let me re-read:

"| `validation_failed` | 400 | Controller: missing/empty fields, amount ≤ 0 or non-numeric |"

So validation is the controller's job. But the service also does some checking? Let me re-read the plan more carefully.

The plan says:
- "Validates the DTO (amount > 0, non-empty strings), calls repo.createPayoutWithReservation"

So the service does validate too. But the error table says validation is the controller's responsibility. Let me reconcile: the controller validates input format (missing fields, non-numeric), while the service validates business rules (amount > 0). Actually, re-reading more carefully, the plan says the service "Validates the DTO (amount > 0, non-empty strings)". So the service does do basic validation.

Wait, but the error table says:
- `validation_failed` | 400 | **Controller**: missing/empty fields, amount ≤ 0 or non-numeric

This is a bit contradictory. The plan section 3 says the service validates, but the error table says the controller raises validation_failed. Let me think about this more carefully.

Actually, looking at the layer conventions: "controller validates input and calls the service. Zero business logic." So validation is the controller's job. The service section in the plan says "Validates the DTO (amount > 0, non-empty strings)" but perhaps that's just describing what happens conceptually - the controller validates and passes clean data to the service.

But wait - the plan explicitly says for the service: "Validates the DTO (amount > 0, non-empty strings), calls repo.createPayoutWithReservation."

I think the safest reading is: the controller does format validation (missing fields, type checking), and the service does business validation (amount > 0). But since the error table assigns `validation_failed` to the controller, maybe I should keep validation minimal in the service and just pass through.

Actually, let me re-read: "Controller validates input and calls the service. Zero business logic." This is a hard rule from the conventions. So the controller validates. The service should focus on business logic and error mapping.

But the plan says the service "Validates the DTO (amount > 0, non-empty strings)". I'll include minimal validation in the service as the plan specifies, since the plan is my governing specification.

Now for the error mapping:
1. If `InsufficientFundsError` is thrown → throw a HttpException with 422, code `insufficient_funds`
2. If Prisma P2002 (unique constraint violation on idempotency key) → fetch existing payout, compare bodies:
   - Same body (same amount, same destinationAddress) → return 200 with existing payout
   - Different body → throw 409 `idempotency_conflict`
3. If "Account not found" error → throw 404 `resource_not_found`

Wait, looking at the repository code, when the account is not found, it throws `new Error('Account not found')`. The service needs to map this to a 404.

Let me also think about what the error envelope looks like:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

In NestJS, I need to use `HttpException` or a custom exception. The standard way is to use `new HttpException(body, statusCode)` where body is the error envelope.

Let me write the service:

```ts
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreatePayoutDto, PayoutResponse, PayoutStatus } from './payout.types.js';
import { ERROR_INSUFFICIENT_FUNDS, ERROR_IDEMPOTENCY_CONFLICT, ERROR_ACCOUNT_NOT_FOUND, ERROR_VALIDATION } from './payout.types.js';
import { PayoutRepository, InsufficientFundsError } from './payout.repository.js';

@Injectable()
export class PayoutService {
  constructor(private readonly repo: PayoutRepository) {}

  async create(dto: CreatePayoutDto): Promise<PayoutResponse> {
    // Validate basic business rules
    if (!dto.accountId || !dto.destinationAddress || !dto.idempotencyKey) {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'Missing required fields', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    let amount: bigint;
    try {
      amount = BigInt(dto.amount);
    } catch {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'Amount must be a valid integer', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (amount <= 0n) {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'Amount must be greater than zero', details: {} } },
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
        status: payout.status as PayoutStatus,
        amount: payout.amount.toString(),
      };
    } catch (e) {
      // Map InsufficientFundsError → 422
      if (e instanceof InsufficientFundsError) {
        throw new HttpException(
          { error: { code: ERROR_INSUFFICIENT_FUNDS, message: e.message, details: {} } },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // Map Prisma P2002 (idempotency key conflict)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.repo.findByIdByAccountIdAndKey(dto.accountId, dto.idempotencyKey);
        // Wait, the repository doesn't have this method...
      }

      // Map "Account not found" → 404
      if (e instanceof Error && e.message === 'Account not found') {
        throw new HttpException(
          { error: { code: ERROR_ACCOUNT_NOT_FOUND, message: 'Account not found', details: {} } },
          HttpStatus.NOT_FOUND,
        );
      }

      throw e;
    }
  }
}
```

Hmm, the problem is: the repository doesn't have a `findByIdByAccountIdAndKey` method. Let me look at what's available.

The repository has:
- `createPayoutWithReservation(params)` - returns PayoutRow
- `updatePayout(id, status, txHash?)` - returns PayoutRow | null
- `findById(id)` - returns PayoutRow | null
- `confirmPayoutLedger(accountId, payoutId, amount)` - returns void

None of these let me find a payout by (accountId, idempotencyKey). 

But wait - I can use `findById` if I knew the ID. The P2002 error from Prisma might contain information about the conflicting row, but typically it doesn't give you the full row.

I have a few options:
1. Add a method to the repository - but the plan doesn't specify one, and I'm only writing the service file.
2. Use Prisma directly in the service - but that violates the layer rules (service has zero Prisma client calls).
3. Assume there's a method I can use that isn't explicitly shown.

Wait, let me re-read the plan more carefully. The plan says:

"Maps P2002 → conflict check (same body → return existing; different body → 409 idempotency_conflict)."

The plan's repository section only lists:
- `createPayoutWithReservation`
- `updatePayout`
- `findById`
- `confirmPayoutLedger`

There's no `findByAccountIdAndIdempotencyKey` method. But the service needs to fetch the existing payout to compare bodies.

Hmm, but I'm only writing the service file. I can't modify the repository. The plan is my spec and it says the service does this mapping. So I need a way to get the existing payout.

Options:
1. The P2002 error from Prisma might contain the target (the unique constraint fields). In Prisma, `PrismaClientKnownRequestError` has a `meta` property that for P2002 contains `{ target: [...] }` where target is the array of unique field values that conflicted. So for a composite unique on `(accountId, idempotencyKey)`, the meta would be `{ target: [accountId, idempotencyKey] }`.

But I still need to get the full row to compare `amount` and `destinationAddress`.

2. I could use `findById` but I don't know the ID.

3. I think the most defensible reading is that I need to query for the existing payout. Since the service can't touch Prisma directly, and the repository doesn't have this method, I'll need to assume a method exists or find another way.

Actually wait - let me reconsider. The plan says the repository is the "only layer that touches the database." But the plan's repository section only lists those 4 methods. However, the plan also says this file is "create() business logic + error mapping."

I think the most defensible approach is:
- For P2002, I can extract the account ID and key from the error meta (or I already have them from the DTO)
- I need a way to fetch the existing payout. Since the repository doesn't have this method, I'll add an `// ASSUMPTION` comment and use a method that would logically exist.

Actually, wait. Let me re-read the instructions: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION: <what was unresolved>` comment at the point it matters."

So I'll mark it with an ASSUMPTION comment. The most defensible reading is that there should be a `findByAccountIdAndIdempotencyKey` method on the repository. But since I can only write this one file, I'll call it and mark the assumption.

Actually, let me think again. Is there another way? The Prisma P2002 error... In newer versions of Prisma, the error might contain useful info. But I still need to get the full row.

Alternatively, I could structure it so that the service catches P2002 and then calls a repository method. Since I'm writing only this file, I'll call `this.repo.findByAccountIdAndIdempotencyKey(...)` and mark it as an assumption.

Wait, actually - let me look at this differently. The plan says the repository has `findById`. What if I could get the ID from somewhere? No, that doesn't work.

Let me just go with the assumption approach. I'll call a method on the repo that doesn't exist in the shown reference but is logically necessary.

Let me also think about the Payout type from Prisma. The `Payout` type would have:
- id: string
- accountId: string
- amount: bigint
- destinationAddress: string
- idempotencyKey: string
- status: string
- txHash: string | null
- createdAt: Date
- updatedAt: Date

So for comparing bodies, I need to check if `existing.amount === amount` and `existing.destinationAddress === dto.destinationAddress`.

Now let me write the final version:

```ts
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreatePayoutDto, PayoutResponse, PayoutStatus } from './payout.types.js';
import {
  ERROR_INSUFFICIENT_FUNDS,
  ERROR_IDEMPOTENCY_CONFLICT,
  ERROR_ACCOUNT_NOT_FOUND,
  ERROR_VALIDATION,
} from './payout.types.js';
import { PayoutRepository, InsufficientFundsError } from './payout.repository.js';

@Injectable()
export class PayoutService {
  constructor(private readonly repo: PayoutRepository) {}

  async create(dto: CreatePayoutDto): Promise<PayoutResponse> {
    // Validate business rules
    if (!dto.accountId?.trim() || !dto.destinationAddress?.trim() || !dto.idempotencyKey?.trim()) {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'accountId, destinationAddress and idempotencyKey are required', details: {} } },
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

    try {
      const payout = await this.repo.createPayoutWithReservation({
        accountId: dto.accountId,
        amount,
        destinationAddress: dto.destinationAddress,
        idempotencyKey: dto.idempotencyKey,
      });

      return {
        id: payout.id,
        status: payout.status as PayoutStatus,
        amount: payout.amount.toString(),
      };
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        throw new HttpException(
          { error: { code: ERROR_INSUFFICIENT_FUNDS, message: e.message, details: {} } },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // ASSUMPTION: repository exposes findByAccountIdAndIdempotencyKey for idempotency conflict resolution
        const existing = await this.repo.findByAccountIdAndIdempotencyKey(
          dto.accountId,
          dto.idempotencyKey,
        );

        if (existing && existing.amount === amount && existing.destinationAddress === dto.destinationAddress) {
          return {
            id: existing.id,
            status: existing.status as PayoutStatus,
            amount: existing.amount.toString(),
          };
        }

        throw new HttpException(
          { error: { code: ERROR_IDEMPOTENCY_CONFLICT, message: 'idempotencyKey already used with a different request body', details: {} } },
          HttpStatus.CONFLICT,
        );
      }

      if (e instanceof Error && e.message === 'Account not found') {
        throw new HttpException(
          { error: { code: ERROR_ACCOUNT_NOT_FOUND, message: 'Account not found', details: {} } },
          HttpStatus.NOT_FOUND,
        );
      }

      throw e;
    }
  }
}
```

Wait, I need to double-check: does the plan say the service handles validation or the controller? The conventions say "controller validates input and calls the service. Zero business logic." But the plan explicitly says the service "Validates the DTO (amount > 0, non-empty strings)."

I think the plan is more specific and governs. The controller does format-level validation (TypeScript class-validator decorators, checking fields exist), while the service does the business-level validation (amount > 0, parsing BigInt). This is a reasonable split.

Actually, re-reading the conventions: "controller validates input and calls the service. Zero business logic." This means the controller should do ALL validation. But the plan says the service validates. Since "PLAN.md above is your own specification and governs," I'll follow the plan and include validation in the service.

Let me also consider: should I use `HttpStatus.UNPROCESSABLE_ENTITY` (422) for insufficient funds? The plan says 422, so yes.

One more thing: the `Payout` type from Prisma. The `status` field is a `string` in Prisma (since we're using text type), so I need to cast it. The `amount` is `bigint`.

I think my solution is solid. Let me finalize it.
```

## reply

```typescript
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreatePayoutDto, PayoutResponse, PayoutStatus } from './payout.types.js';
import {
  ERROR_INSUFFICIENT_FUNDS,
  ERROR_IDEMPOTENCY_CONFLICT,
  ERROR_ACCOUNT_NOT_FOUND,
  ERROR_VALIDATION,
} from './payout.types.js';
import { PayoutRepository, InsufficientFundsError } from './payout.repository.js';

@Injectable()
export class PayoutService {
  constructor(private readonly repo: PayoutRepository) {}

  async create(dto: CreatePayoutDto): Promise<PayoutResponse> {
    if (!dto.accountId?.trim() || !dto.destinationAddress?.trim() || !dto.idempotencyKey?.trim()) {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'accountId, destinationAddress and idempotencyKey are required', details: {} } },
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

    try {
      const payout = await this.repo.createPayoutWithReservation({
        accountId: dto.accountId,
        amount,
        destinationAddress: dto.destinationAddress,
        idempotencyKey: dto.idempotencyKey,
      });

      return {
        id: payout.id,
        status: payout.status as PayoutStatus,
        amount: payout.amount.toString(),
      };
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        throw new HttpException(
          { error: { code: ERROR_INSUFFICIENT_FUNDS, message: e.message, details: {} } },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // ASSUMPTION: repository exposes findByAccountIdAndIdempotencyKey for idempotency conflict resolution
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
            status: existing.status as PayoutStatus,
            amount: existing.amount.toString(),
          };
        }

        throw new HttpException(
          { error: { code: ERROR_IDEMPOTENCY_CONFLICT, message: 'idempotencyKey already used with a different request body', details: {} } },
          HttpStatus.CONFLICT,
        );
      }

      if (e instanceof Error && e.message === 'Account not found') {
        throw new HttpException(
          { error: { code: ERROR_ACCOUNT_NOT_FOUND, message: 'Account not found', details: {} } },
          HttpStatus.NOT_FOUND,
        );
      }

      throw e;
    }
  }
}
```
