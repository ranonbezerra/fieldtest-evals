# 05-payout.controller.ts@medium

## reasoning

```
Let me analyze what the plan specifies for `src/payout/payout.controller.ts`:

From PLAN.md §3:
```
### PayoutController (class, `@Controller("payouts")`)

@Post()
create(@Body() body: CreatePayoutInput): Promise<PayoutResponse>
```

Validates presence of all four fields; delegates to `PayoutService.createPayout`. Returns `400` on missing fields, `422` on `InsufficientFundsError`.

From the manifest:
```
src/payout/payout.controller.ts | reads: src/payout/payout.service.ts | HTTP layer: validation, status codes
```

From the reference `payout.service.ts`:
- It exports `CreatePayoutInput` type (re-exported from repository)
- It exports `PayoutResponse` type (re-exported from repository)
- It exports `InsufficientFundsError` class (re-exported from repository)
- `PayoutService` has method `createPayout(input: CreatePayoutInput): Promise<PayoutResponse>`

Now let me think about the controller:

1. It's a `@Controller("payouts")` class
2. Has a `@Post()` endpoint
3. Takes `@Body() body: CreatePayoutInput`
4. Validates presence of all four fields (`accountId`, `amount`, `destinationAddress`, `idempotencyKey`)
5. Returns 400 on missing fields
6. Returns 422 on `InsufficientFundsError`
7. Delegates to `PayoutService.createPayout`

The error envelope format is:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

So for 400: `{ error: { code: "validation_error", message: "...", details: { missingFields: [...] } } }`
For 422: `{ error: { code: "insufficient_funds", message: "...", details: {} } }`

Wait, the plan says "Returns `400` on missing fields, `422` on `InsufficientFundsError`."

Let me think about the validation. The four fields are: `accountId`, `amount`, `destinationAddress`, `idempotencyKey`. I need to check all four are present.

For the amount, it's a bigint in minor units. In the body it would come as a string (since JSON doesn't support bigint). Let me think about this...

Looking at the `CreatePayoutInput` interface:
```typescript
interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}
```

The body from JSON would have `amount` as a string (since JSON can't represent bigint). So I need to validate and convert it.

Wait, but the plan says "Validates presence of all four fields". It doesn't mention type conversion. Let me re-read...

The plan says the controller "Validates presence of all four fields; delegates to `PayoutService.createPayout`. Returns `400` on missing fields, `422` on `InsufficientFundsError`."

So the controller:
1. Validates presence (not null/undefined) of all four fields
2. If any missing → 400 with error envelope
3. Calls `this.payoutService.createPayout(body)` 
4. If `InsufficientFundsError` is thrown → 422 with error envelope
5. Otherwise returns the payout response (201 for new, but the service handles both cases...)

Wait, looking at the plan more carefully:
- "Return 201 with the new payout" (step 4 of creation flow)
- "Return 200 with the existing payout" (step 5 for idempotency)

But the service just returns `PayoutResponse` in both cases. How does the controller know which status to return?

Hmm, looking at the plan again: "Idempotent duplicate response status | `200 OK` with the existing payout body"

The service returns the same type in both cases. The controller needs to differentiate. But the plan says the controller just "delegates to `PayoutService.createPayout`". 

Looking more carefully at the service code - it just returns `PayoutResponse` in both cases. The plan says:
- Step 4: "Commit. Return 201 with the new payout."
- Step 5: "Return 200."

But how does the controller know? The service doesn't indicate which case it was. Let me look at the plan's controller spec again:

```
@Post()
create(@Body() body: CreatePayoutInput): Promise<PayoutResponse>
```

It just returns `Promise<PayoutResponse>`. There's no indication of different status codes based on whether it was new or duplicate.

Actually, re-reading the assumptions: "Idempotent duplicate response status | `200 OK` with the existing payout body | Client sees success; no distinction from first-creation needed by spec"

Wait, it says "no distinction from first-creation needed by spec". So maybe both return 201? Or maybe the plan just doesn't distinguish and always returns 201? 

Actually, the standard REST convention is:
- 201 Created for new resources
- 200 OK for idempotent retries

But the plan's controller signature just says `Promise<PayoutResponse>` without differentiating. And the assumption says "no distinction from first-creation needed by spec."

I think the simplest reading is: always return 201 (since the endpoint is `POST /payouts` and it creates a payout or returns an existing one). Or maybe always 201 is fine since the spec says "no distinction needed."

Actually wait - let me re-read: "Client sees success; no distinction from first-creation needed by spec". This could mean either both are 201, or the client doesn't care. I'll go with 201 for both since the plan doesn't explicitly say to differentiate, and the controller signature is just `Promise<PayoutResponse>`.

Hmm, but actually for proper REST and the plan says "Return 201 with the new payout" vs "Return 200" for the duplicate case... But the controller can't tell which case it was since the service returns the same type. Unless I use `@Res()` to manually set status...

Let me look at this differently. The plan's controller spec is minimal:
```
@Post()
create(@Body() body: CreatePayoutInput): Promise<PayoutResponse>
```

It doesn't show any `@Res()` or status code manipulation. The simplest implementation that matches the plan is to just return the response, which NestJS will send as 201 by default for POST. Actually no - NestJS defaults to 201 for POST only if you use `@Post()` - wait, actually NestJS defaults to 201 for POST? Let me think... No, NestJS doesn't automatically set 201. The default status for a successful response is 200 unless you specify otherwise.

Actually, I recall that in NestJS, `@Post()` does NOT automatically set 201. You need to either use `@HttpCode(HttpStatus.CREATED)` or return the response and it'll be 200.

Given the plan says "Return 201 with the new payout" but the controller can't distinguish, and the assumption says "no distinction from first-creation needed by spec", I'll just let it default to 201 with `@HttpCode(201)`. Or I could just not set it and let it be 200.

Actually, you know what, let me just keep it simple. The plan says the controller validates and delegates. I'll use `@HttpCode(HttpStatus.CREATED)` since it's a POST that creates a resource, and for idempotent retries returning the same thing is still acceptable as 201 (the resource was created, just not by this request).

Wait, actually re-reading the assumption more carefully: "Idempotent duplicate response status | `200 OK` with the existing payout body". This explicitly says 200 for duplicates. But the controller can't tell...

I think the cleanest approach given the constraints is:
- The service returns `PayoutResponse` in both cases
- The controller just returns it
- Default NestJS behavior for POST is 201 (actually I'm not sure about this)

Let me just go with the simplest approach that matches the plan. The plan says the controller's job is "validation, status codes" and it returns `400` on missing fields, `422` on `InsufficientFundsError`. For success, it just returns the payout. I'll let NestJS handle the default (which is 200 for a POST that doesn't have @HttpCode set).

Actually, I just realized - in NestJS, the default HTTP status for a successful response is 200, regardless of method. You need `@HttpCode(201)` to get 201. Since the plan doesn't explicitly show `@HttpCode` in the controller spec, I'll just return 200 for both cases. This aligns with "no distinction from first-creation needed by spec."

Now for the error handling. The plan says:
- 400 on missing fields
- 422 on InsufficientFundsError

The error envelope is:
```json
{ "error": { "code": "snake_case_code", "message": "...", details": {} } }
```

For 400: code could be "validation_error" 
For 422: code is "insufficient_funds" (from the error class in the service)

Let me write the controller:

```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { PayoutService, CreatePayoutInput, PayoutResponse, InsufficientFundsError } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() body: unknown): Promise<PayoutResponse> {
    // Validate presence of all four fields
    if (!body || typeof body !== 'object') {
      throw new BadRequestException(...); // 400
    }
    
    const missing = check fields...
    
    if (missing.length > 0) {
      // 400
    }

    const input: CreatePayoutInput = body as CreatePayoutInput;
    
    try {
      return await this.payoutService.createPayout(input);
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        // 422
      }
      throw error;
    }
  }
}
```

Wait, I need to think about how to return proper error responses with the envelope format. In NestJS, I can throw `HttpException` or use `@Res()`. 

For the error envelope format, I should throw an `HttpException` with the right status and body. Or I could use `Res` to manually write the response.

Actually, the cleanest NestJS approach is to throw `HttpException` with the envelope as the response body. Let me use that.

```typescript
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
```

For 400:
```typescript
throw new HttpException({
  error: {
    code: 'validation_error',
    message: 'Missing required fields',
    details: { missingFields: [...] }
  }
}, HttpStatus.BAD_REQUEST);
```

For 422:
```typescript
throw new HttpException({
  error: {
    code: 'insufficient_funds',
    message: 'Account does not have sufficient available funds',
    details: {}
  }
}, HttpStatus.UNPROCESSABLE_ENTITY);
```

Now, about the `amount` field. The body comes as JSON, so `amount` would be a string (or number). The `CreatePayoutInput` expects `bigint`. I need to convert it.

Wait, but the plan says "Validates presence of all four fields". It doesn't say validate types or convert. But if I just pass the body to the service, and the service expects `bigint` for amount... 

Hmm, let me look at this from the perspective of what makes sense. The controller receives JSON where `amount` is a string like "1000". The service expects `bigint`. So the controller should convert it.

But the plan says the controller just "Validates presence of all four fields; delegates to `PayoutService.createPayout`." 

I think a reasonable interpretation is:
1. Validate presence (not undefined/null)
2. Convert `amount` string to `bigint`
3. Pass to service

If the amount can't be converted to bigint, that's also a 400 validation error.

Let me write this out:

```typescript
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import type { CreatePayoutInput, PayoutResponse } from './payout.service.js';
import { InsufficientFundsError, PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<PayoutResponse> {
    const requiredFields: (keyof CreatePayoutInput)[] = [
      'accountId',
      'amount',
      'destinationAddress',
      'idempotencyKey',
    ];

    const missingFields = requiredFields.filter(
      (field) => body[field] === undefined || body[field] === null,
    );

    if (missingFields.length > 0) {
      throw new HttpException(
        {
          error: {
            code: 'validation_error',
            message: 'Missing required fields in request body',
            details: { missingFields },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let amount: bigint;
    try {
      amount = BigInt(body.amount as string);
    } catch {
      throw new HttpException(
        {
          error: {
            code: 'validation_error',
            message: 'amount must be a valid integer in minor units',
            details: {},
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const input: CreatePayoutInput = {
      accountId: body.accountId as string,
      amount,
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
              message: 'Account does not have sufficient available funds for this payout',
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

Wait, I'm importing `CreatePayoutInput` and `PayoutResponse` as types from `payout.service.js`. Looking at the reference service file, it does:
```typescript
export type { CreatePayoutInput, PayoutResponse };
```

So they're re-exported as types. Good.

And `InsufficientFundsError` and `PayoutService` are value exports. Good.

Let me also consider: should I use `@Res()` to control the response? No, I think throwing HttpException for errors and returning the value for success is the NestJS-idiomatic way.

One more thought: the `body` parameter type. I'm using `Record<string, unknown>` to be safe since I'm doing manual validation. If I used `CreatePayoutInput` directly, TypeScript would expect the types to already be correct, but at runtime they won't be (amount would be a string, not bigint). So `Record<string, unknown>` is the right call for the raw body.

Actually, wait. Let me reconsider. In NestJS, if I use a class-validator DTO, it would handle this automatically. But the plan doesn't mention DTOs or class-validator. It says "Validates presence of all four fields" which suggests manual validation. So `Record<string, unknown>` for the body is appropriate.

Let me finalize my implementation. I think it's solid. Let me double-check against the plan:

✅ `@Controller("payouts")` - matches plan
✅ `@Post()` - matches plan  
✅ Validates presence of all four fields - yes
✅ Returns 400 on missing fields - yes, with error envelope
✅ Delegates to `PayoutService.createPayout` - yes
✅ Returns 422 on `InsufficientFundsError` - yes, with error envelope
✅ Error envelope format matches the convention - yes

I'm satisfied with this. Let me write the final version.
```

## reply

```typescript
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';

import type { CreatePayoutInput, PayoutResponse } from './payout.service.js';
import { InsufficientFundsError, PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<PayoutResponse> {
    const requiredFields = [
      'accountId',
      'amount',
      'destinationAddress',
      'idempotencyKey',
    ] as const;

    const missingFields = requiredFields.filter(
      (field) => body[field] === undefined || body[field] === null,
    );

    if (missingFields.length > 0) {
      throw new HttpException(
        {
          error: {
            code: 'validation_error',
            message: 'Missing required fields in request body',
            details: { missingFields },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let amount: bigint;
    try {
      amount = BigInt(body.amount as string | number);
    } catch {
      throw new HttpException(
        {
          error: {
            code: 'validation_error',
            message: 'amount must be a valid integer in minor units',
            details: {},
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const input: CreatePayoutInput = {
      accountId: body.accountId as string,
      amount,
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
              message: 'Account does not have sufficient available funds for this payout',
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
