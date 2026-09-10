# repair1-payout.controller.ts

## reasoning

```
Let me analyze the compiler errors to understand what's needed for `src/payout/payout.controller.ts`.

Looking at the error messages, none of them directly reference `src/payout/payout.controller.ts`. The errors are in:
- `src/payout/payout.repository.ts`
- `src/payout/payout.service.ts`
- `src/payout/payout.worker.ts`
- `test/payout.spec.ts`

But the task says "Rewrite `src/payout/payout.controller.ts` complete, fixing what these messages require of this file."

The key issue is that `src/payout/payout.service.ts` has errors:
- `Cannot find module './payout.repository'`
- `Cannot find module './payout.errors'`
- `Cannot find module './payout.types'`

And `src/payout/payout.worker.ts` has errors:
- `Cannot find module './payout.repository'`
- `Cannot find module './payout.provider'`
- `Cannot find module './payout.types'`

The test file imports:
- `../src/payout/payout.repository`
- `../src/payout/payout.service`
- `../src/payout/payout.worker`
- `../src/payout/payout.errors`
- `../src/payout/payout.provider`
- `../src/payout/payout.types`

So the missing modules are:
- `payout.repository`
- `payout.errors`
- `payout.types`
- `payout.provider`

The controller itself isn't directly named in the errors. But the task says to rewrite it "complete, fixing what these messages require of this file."

Wait - the task says "These are the compiler's exact messages for the whole workspace." The controller file must exist (it's being compiled), but the errors listed don't directly mention it. However, the task is asking me to rewrite it.

Looking at the error in `payout.service.ts`:
- `Parameter 'tx' implicitly has an 'any' type` at line 23, column 55

This suggests the service has a transaction callback with an untyped parameter.

The controller needs to:
1. Import from the service
2. Handle `POST /payouts` with body `{ accountId, amount, destinationAddress, idempotencyKey }`
3. Validate input and call the service

Since the errors don't directly name the controller file, but the task asks me to rewrite it, I need to figure out what the controller should look like based on:
- The conventions (controller validates input, calls service, zero business logic)
- The API spec (POST /payouts)
- The error envelope format
- The fact that it needs to import the service

The controller needs to import `PayoutService` from `./payout.service`. The service file exists (it has errors in it, but it exists). So the controller should be able to import it.

Let me think about what the controller needs:
- It's a NestJS controller for the payouts feature
- POST /payouts endpoint
- Body: `{ accountId, amount, destinationAddress, idempotencyKey }`
- It validates input and calls the service
- Zero business logic in the controller

The controller should use DTOs or inline validation. Given the conventions say "kebab-case.role.ts", the file is `payout.controller.ts`.

Let me write the controller. It needs to:
1. Be a `@Controller('payouts')` (kebab-case, plural)
2. Have a `@Post()` handler
3. Accept the body with the four fields
4. Call the service
5. Return the result

For validation, I can use class-validator or just do manual checks. Given the conventions don't mention class-validator, and to keep it simple, I'll do basic validation in the controller.

Actually, looking more carefully at the conventions: "controller validates input and calls the service. Zero business logic."

The amount is in minor units (BigInt), so the controller needs to handle that.

Let me write the controller:

```typescript
import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { PayoutService } from './payout.service';

interface CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPayout(@Body() body: CreatePayoutDto) {
    // Validate input
    if (!body.accountId || typeof body.accountId !== 'string') {
      throw new ... 
    }
    // ...
    return this.payoutService.createPayout({
      accountId: body.accountId,
      amount: body.amount,
      destinationAddress: body.destinationAddress,
      idempotencyKey: body.idempotencyKey,
    });
  }
}
```

Wait, but for the error envelope, the `AllExceptionsFilter` handles converting exceptions to the proper format. So I should throw `HttpException` with the proper code.

Looking at the exception filter, it reads `code` from the response body object. So I need to throw an `HttpException` with a body that has `code`, `message`, and `details`.

Actually, looking at the filter more carefully:
```typescript
const bodyObj = body as Record<string, unknown>;
if (typeof bodyObj.code === 'string') {
  code = bodyObj.code;
}
```

So I need to throw something like:
```typescript
throw new HttpException({ code: 'invalid_request', message: '...', details: {} }, HttpStatus.BAD_REQUEST);
```

Let me think about what validation the controller needs:
- `accountId` must be a non-empty string
- `amount` must be a positive integer (bigint)
- `destinationAddress` must be a non-empty string
- `idempotencyKey` must be a non-empty string

Now, the amount in the JSON body will come as a number or string. Since we're using BigInt, the JSON will likely have it as a number or string. In the controller, I should validate it's a valid positive integer and convert to BigInt.

Actually, for the controller, the amount coming from JSON will be a number (JSON doesn't support bigint natively). I should validate it's a positive integer and convert it. But wait - "Amounts are in minor units. Do not use floating point for money." This means I should handle it carefully.

Let me write the controller now. I'll keep it focused on validation and delegation to the service.
```

## reply

```typescript
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { PayoutService } from './payout.service';

interface CreatePayoutDto {
  accountId: string;
  amount: number | string;
  destinationAddress: string;
  idempotencyKey: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPayout(@Body() body: CreatePayoutDto) {
    if (!body.accountId || typeof body.accountId !== 'string') {
      throw new HttpException(
        { code: 'invalid_request', message: 'accountId must be a non-empty string', details: {} },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!body.destinationAddress || typeof body.destinationAddress !== 'string') {
      throw new HttpException(
        { code: 'invalid_request', message: 'destinationAddress must be a non-empty string', details: {} },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!body.idempotencyKey || typeof body.idempotencyKey !== 'string') {
      throw new HttpException(
        { code: 'invalid_request', message: 'idempotencyKey must be a non-empty string', details: {} },
        HttpStatus.BAD_REQUEST,
      );
    }

    let amount: bigint;
    try {
      amount = BigInt(body.amount);
    } catch {
      throw new HttpException(
        { code: 'invalid_request', message: 'amount must be a valid integer', details: {} },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (amount <= 0n) {
      throw new HttpException(
        { code: 'invalid_request', message: 'amount must be a positive integer', details: {} },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.payoutService.createPayout({
      accountId: body.accountId,
      amount,
      destinationAddress: body.destinationAddress,
      idempotencyKey: body.idempotencyKey,
    });
  }
}
```
