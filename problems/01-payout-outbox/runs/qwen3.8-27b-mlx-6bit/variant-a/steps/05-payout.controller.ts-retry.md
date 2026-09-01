# 05-payout.controller.ts-retry

## reasoning

```
Let me analyze what the plan specifies for `payout.controller.ts`:

From PLAN.md §3:
- `@Controller("payouts")`
- `@Post()` method `create(@Body() body: CreatePayoutInput): Promise<PayoutResponse>`
- Validates presence of all four fields; delegates to `PayoutService.createPayout`
- Returns `400` on missing fields, `422` on `InsufficientFundsError`

From the reference `payout.service.ts`:
- `PayoutService` is exported with `createPayout(input: CreatePayoutInput): Promise<PayoutResponse>`
- `InsufficientFundsError` is re-exported from the service (which re-exports it from the repository)
- `CreatePayoutInput` and `PayoutResponse` are re-exported types

From the naming conventions:
- File: `kebab-case.role.ts` → `payout.controller.ts` ✓
- Class: `PascalCase` → `PayoutController`

From the error envelope convention:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```
So errors should use this envelope.

Now, the plan says:
- Returns `400` on missing fields
- Returns `422` on `InsufficientFundsError`

For the error envelope, I need to use the standard format. For 400 (validation), a code like `validation_error` makes sense. For 422, the `InsufficientFundsError` has `code = "insufficient_funds"`.

Let me think about how to structure this:

1. Controller class `PayoutController` with `@Controller('payouts')`
2. Constructor injects `PayoutService`
3. `@Post()` method that:
   - Validates the body has all four fields (`accountId`, `amount`, `destinationAddress`, `idempotencyKey`)
   - Returns 400 with error envelope if any missing
   - Calls `this.payoutService.createPayout(input)`
   - Catches `InsufficientFundsError` and returns 422 with error envelope
   - Returns the payout response on success (201 is implied by NestJS for POST)

Wait, the plan says "Returns `400` on missing fields, `422` on `InsufficientFundsError`." It doesn't explicitly say 201 for success, but POST typically returns 201. NestJS by default returns 201 for POST.

For the error envelope, I should use `@Res()` or throw exceptions. Actually, looking at the conventions more carefully - "Errors — one envelope" - this suggests I should use a consistent error format. In NestJS, the cleanest way is to either:
1. Use `@Res()` and manually set status + body
2. Throw HttpException with the right shape

Actually, looking at this more carefully - NestJS has a built-in way to handle this. I could use `@Res()` to have full control, or I could throw custom exceptions.

But the simplest approach that matches the plan's specification (controller validates, delegates, maps errors) is to use `@Res()` for the error cases and let the normal return handle success. Or better yet, I can throw `HttpException` instances with the right status and body.

Wait, but the plan says "Zero business logic" in the controller. Mapping an error to a status code is not really business logic - it's HTTP concern, which is the controller's job.

Let me think about what's cleanest:

Option A: Use `@Res()` and manually handle everything
Option B: Throw exceptions for error cases, return normally for success

I think Option B is cleaner and more NestJS-idiomatic. I'll throw `new HttpException({ error: { code, message, details } }, statusCode)` for error cases.

Actually wait - let me reconsider. The convention says the controller "validates input and calls the service." It doesn't say it can throw. But throwing an exception to set a status code is a standard controller responsibility.

Let me go with throwing HttpException for the error cases:
- 400: `validation_error` code when fields are missing
- 422: `insufficient_funds` code (from the error's `.code`)

For the amount field - the plan says amounts are in minor units (bigint). The body will come as a string or number from JSON. I need to handle that. Looking at `CreatePayoutInput`, `amount` is `bigint`. So I need to convert the input.

Actually, looking at the plan more carefully:
- `CreatePayoutInput` has `amount: bigint`
- The JSON body will have amount as a string (since JSON doesn't support bigint)

So the controller needs to:
1. Validate all four fields are present
2. Convert `amount` to bigint (or BigInt)
3. Pass to service

Let me also think about what "validates presence of all four fields" means. It means checking that `accountId`, `amount`, `destinationAddress`, and `idempotencyKey` are all present (not undefined/null/empty).

Let me write this:

```typescript
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';

import { PayoutService } from './payout.service.js';
import type { CreatePayoutInput, PayoutResponse } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  create(@Body() body: Record<string, unknown>): PayoutResponse | never {
    const missing = this.validateBody(body);
    if (missing.length > 0) {
      throw new HttpException(
        { error: { code: 'validation_error', message: `Missing required fields: ${missing.join(', ')}`, details: { missing } } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const input: CreatePayoutInput = {
      accountId: body.accountId as string,
      amount: BigInt(body.amount as string | number),
      destinationAddress: body.destinationAddress as string,
      idempotencyKey: body.idempotencyKey as string,
    };

    try {
      return this.payoutService.createPayout(input); // Wait, this is async
    } catch (error) { ... }
  }
}
```

Wait, `createPayout` is async. So the method needs to be async too. Let me fix that.

Also, I need to catch `InsufficientFundsError` specifically. The service re-exports it, so I can import it from the service.

Let me also think about whether `BigInt(body.amount)` could throw - if amount is not a valid integer string. That would be a validation error too. But the plan only says "validates presence of all four fields" - it doesn't say validate the format of amount. However, if `BigInt()` throws, that would be an unhandled error (500). 

Hmm, the plan is specific: "Validates presence of all four fields; delegates to PayoutService.createPayout. Returns 400 on missing fields, 422 on InsufficientFundsError." It doesn't mention validating the format of amount. I'll keep it simple and just check presence. If `BigInt()` throws on a non-numeric string, that's an edge case the plan doesn't address. I could wrap it in a try-catch and return 400, but that might be adding something the plan doesn't call for.

Actually, let me re-read: "Do exactly what the task asks. Do not create a file it does not call for, and do not improve code you were not asked to change." So I should stick to what the plan says: validate presence, map errors. If BigInt throws, let it be a 500 (NestJS default). That's the most defensible reading.

Wait, but actually if I use `@Body() body: CreatePayoutInput` directly, NestJS would pass the raw object and `amount` would be a string/number from JSON, not a bigint. The type annotation is just for TypeScript - at runtime it's whatever JSON gives. So I need to do the conversion.

Let me finalize my approach:

```typescript
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';

import { InsufficientFundsError, PayoutService } from './payout.service.js';
import type { CreatePayoutInput, PayoutResponse } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<PayoutResponse> {
    const required = ['accountId', 'amount', 'destinationAddress', 'idempotencyKey'] as const;
    const missing = required.filter((field) => body[field] === undefined || body[field] === null);
    
    if (missing.length > 0) {
      throw new HttpException(
        {
          error: {
            code: 'validation_error',
            message: `Missing required fields: ${missing.join(', ')}`,
            details: { missing },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const input: CreatePayoutInput = {
      accountId: body.accountId as string,
      amount: BigInt(body.amount as string | number),
      destinationAddress: body.destinationAddress as string,
      idempotencyKey: body.idempotencyKey as string,
    };

    try {
      return await this.payoutService.createPayout(input);
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new HttpException(
          {
            error: {
              code: 'insufficient_funds',
              message: error.message,
              details: {},
            },
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw error;
    }
  }
}
```

Wait, I need to double-check: the plan says `InsufficientFundsError` has `code = "insufficient_funds"`. So I could use `error.code` directly. Let me do that for consistency.

Also, should I check for empty strings? The plan says "validates presence of all four fields" - presence, not non-emptiness. I'll stick with just checking undefined/null.

Actually, let me reconsider the `body` type. Using `Record<string, unknown>` is a bit loose but appropriate since we're doing manual validation (the plan says the controller validates, not a DTO/pipes). This is consistent with "Zero business logic" - we're just checking shape.

Let me also verify the import paths. The reference shows `./payout.repository.js` with `.js` extension (ESM convention). So I should use `./payout.service.js`.

One more thought: the plan says the endpoint is `kebab-case, plural` → `POST /payouts`. With `@Controller('payouts')` and `@Post()`, that gives us `POST /payouts`. ✓

I think this is solid. Let me write the final version.
```

## reply

```typescript
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';

import { InsufficientFundsError, PayoutService } from './payout.service.js';
import type { CreatePayoutInput, PayoutResponse } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<PayoutResponse> {
    const required = ['accountId', 'amount', 'destinationAddress', 'idempotencyKey'] as const;
    const missing = required.filter((field) => body[field] === undefined || body[field] === null);

    if (missing.length > 0) {
      throw new HttpException(
        {
          error: {
            code: 'validation_error',
            message: `Missing required fields: ${missing.join(', ')}`,
            details: { missing },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const input: CreatePayoutInput = {
      accountId: body.accountId as string,
      amount: BigInt(body.amount as string | number),
      destinationAddress: body.destinationAddress as string,
      idempotencyKey: body.idempotencyKey as string,
    };

    try {
      return await this.payoutService.createPayout(input);
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new HttpException(
          {
            error: {
              code: error.code,
              message: error.message,
              details: {},
            },
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw error;
    }
  }
}
```
