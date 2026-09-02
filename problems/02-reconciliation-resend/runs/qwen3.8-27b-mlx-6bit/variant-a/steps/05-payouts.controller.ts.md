# 05-payouts.controller.ts

## reasoning

```
Let me analyze what's needed for `src/payouts/payouts.controller.ts` based on the plan:

From the plan (Section 3):
```ts
// ---- src/payouts/payouts.controller.ts ----

export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Post('execute')
  execute(@Body() body: { effectiveDate: string }): Promise<{ sent: number; rejected: number }>;

  @Post('reconcile')
  reconcile(@Body() body: { date: string }): Promise<ReconcileResult>;
}
```

From the plan's error section:
- `invalid_date_format` — Controller receives a date string that is not `YYYY-MM-DD`.

So the controller needs to:
1. Have two POST endpoints: `/payouts/execute` and `/payouts/reconcile`
2. Validate date format in the controller (since the plan says "Controller receives a date string that is not YYYY-MM-DD")
3. Call the service methods

The convention says: `controller` validates input and calls the service. Zero business logic.

Let me think about what imports I need:
- `@nestjs/common`: `Controller`, `Post`, `Body`
- `./payouts.service`: `PayoutsService`, `ReconcileResult`

For date validation, the plan says the controller should raise `invalid_date_format` error. I need to validate that the date string matches `YYYY-MM-DD` format. Since the controller has "zero business logic", validation of input format is appropriate here.

Let me think about the error envelope:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

For invalid date format, I'd throw a `BadRequestException` or create a custom exception. But looking at the conventions, the error envelope is standard. In NestJS, I could use `BadRequestException` with a custom message, but the plan specifies a specific error code format.

Actually, let me re-read the conventions: "Errors — one envelope" with `code` as `snake_case`. In NestJS, the typical way to do this is with a custom exception or by catching and formatting. But since the plan just says the controller raises `invalid_date_format`, I'll use a simple approach.

Looking at the plan more carefully:
- `POST /payouts/execute` with body `{ effectiveDate: string }`
- `POST /payouts/reconcile` with body `{ date: string }`

The controller validates the date format. Let me write a simple regex check for `YYYY-MM-DD`.

For the error, I'll throw a `BadRequestException` with the appropriate structure. Actually, in NestJS with the standard error handling, I could throw a `BadRequestException` and have a global exception filter format it. But the plan doesn't mention a global exception filter in this file.

Let me keep it simple: validate the date format, and if invalid, throw a `BadRequestException`. The global exception filter (which would be in the app module or main.ts) handles formatting into the envelope. But wait - the plan says the error code is `invalid_date_format` specifically. A `BadRequestException` would give HTTP 400 but not necessarily the right code in the envelope.

Looking at this more carefully, I think the cleanest approach that stays within "controller validates input" is to throw a `BadRequestException` with a message. The actual envelope formatting would be handled by a global filter. But since I'm only writing this one file, I'll just validate and throw appropriately.

Actually, let me reconsider. The plan says:
- `invalid_date_format` — Controller receives a date string that is not `YYYY-MM-DD`.

I'll validate the format with a regex and throw a `BadRequestException` if it doesn't match. The specifics of the error envelope are a cross-cutting concern handled by the exception filter (not in scope for this file).

Let me write the controller:

```ts
import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { PayoutsService, ReconcileResult } from './payouts.service';

@Controller('payouts')
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Post('execute')
  async execute(@Body() body: { effectiveDate: string }): Promise<{ sent: number; rejected: number }> {
    if (!this.isValidDate(body.effectiveDate)) {
      throw new BadRequestException('effectiveDate must be in YYYY-MM-DD format');
    }
    const date = new Date(`${body.effectiveDate}T00:00:00.000Z`);
    return this.service.executePayments(date);
  }

  @Post('reconcile')
  async reconcile(@Body() body: { date: string }): Promise<ReconcileResult> {
    if (!this.isValidDate(body.date)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format');
    }
    return this.service.reconcile(body.date);
  }

  private isValidDate(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }
}
```

Wait, the plan says the service's `executePayments` takes a `Date` object: `executePayments(effectiveDate: Date)`. And `reconcile` takes a string: `reconcile(date: string)`.

So for execute, I need to parse the date string into a Date. For reconcile, I pass the string through.

Let me also check: should the `parseUTCDate` logic be in the controller or is it already in the service? Looking at the service reference, `reconcile` internally calls `this.parseUTCDate(date)`. And `executePayments` takes a `Date` directly. So the controller needs to convert the string to a Date for execute, and pass the string as-is for reconcile.

This looks right. Let me finalize.
```

## reply

```ts
import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { PayoutsService, ReconcileResult } from './payouts.service';

@Controller('payouts')
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Post('execute')
  async execute(
    @Body() body: { effectiveDate: string },
  ): Promise<{ sent: number; rejected: number }> {
    this.assertValidDate(body.effectiveDate, 'effectiveDate');
    const effectiveDate = new Date(`${body.effectiveDate}T00:00:00.000Z`);
    return this.service.executePayments(effectiveDate);
  }

  @Post('reconcile')
  async reconcile(@Body() body: { date: string }): Promise<ReconcileResult> {
    this.assertValidDate(body.date, 'date');
    return this.service.reconcile(body.date);
  }

  private assertValidDate(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date string`);
    }
  }
}
```
