# repair1-payouts.controller.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payouts/payouts.controller.ts`:

1. `src/payouts/payouts.controller.ts(2,49): error TS2307: Cannot find module './payouts.service' or its corresponding type declarations.`

This is the only error that directly names `src/payouts/payouts.controller.ts`. The fix is to use the `.js` extension in the import path (since we're using ESM with `node16`/`nodenext` module resolution).

Looking at the other errors, they reference:
- `src/payouts/payouts.service.ts(4,45): error TS2835: Relative import paths need explicit file extensions` — this tells us the project uses `--moduleResolution` of `node16` or `nodenext`, which means all relative imports need `.js` extensions.

So the fix for `payouts.controller.ts` is to change the import of `./payouts.service` to `./payouts.service.js`.

Now let me reconstruct the controller based on the plan:

From the plan:
```ts
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Post('execute')
  execute(@Body() body: { effectiveDate: string }): Promise<{ sent: number; rejected: number }>;

  @Post('reconcile')
  reconcile(@Body() body: { date: string }): Promise<ReconcileResult>;
}
```

The controller should:
- Import from `@nestjs/common` for decorators
- Import `PayoutsService` from `./payouts.service.js`
- Import `ReconcileResult` type from `./payouts.service.js`
- Be a NestJS controller with `@Controller('payouts')`
- Have `POST execute` and `POST reconcile` endpoints
- Validate input dates (the plan mentions `invalid_date_format` error code)

Wait, let me re-read the instructions: "Change nothing the messages do not name." The only error naming this file is line 2, column 49 — the module resolution issue. So I need to fix the import path.

But I also need to write the "complete content" of the file. Let me think about what the file should contain based on the plan and the conventions.

The plan says:
- `POST /payouts/execute` with body `{ effectiveDate: string }`
- `POST /payouts/reconcile` with body `{ date: string }`
- Controller validates input (date format) and calls the service
- Error code `invalid_date_format` for bad dates

The controller should have:
- `@Controller('payouts')`
- Inject `PayoutsService`
- Two POST endpoints
- Date validation

Let me write the complete file. The key fix is `.js` extension on the import.

Actually, wait - I need to be careful. The instruction says "Rewrite `src/payouts/payouts.controller.ts` complete, fixing what these messages require of this file." and "Change nothing the messages do not name."

The only message that names this file is:
```
src/payouts/payouts.controller.ts(2,49): error TS2307: Cannot find module './payouts.service' or its corresponding type declarations.
```

So the fix is to change `./payouts.service` to `./payouts.service.js` on line 2.

But I need to provide the "complete content" of the file. I'll write it based on the plan, making sure the import uses `.js` extension.

Let me think about what imports the controller needs:
- `@Controller`, `@Post`, `@Body` from `@nestjs/common`
- `PayoutsService` and `ReconcileResult` from `./payouts.service.js`

The plan says the controller validates input. The error codes include `invalid_date_format`. I'll add basic date validation.

Let me write it:

```ts
import { Controller, Post, Body } from '@nestjs/common';
import { PayoutsService, ReconcileResult } from './payouts.service.js';

@Controller('payouts')
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Post('execute')
  async execute(@Body() body: { effectiveDate: string }): Promise<{ sent: number; rejected: number }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate)) {
      throw new Error('invalid_date_format');
    }
    const effectiveDate = new Date(`${body.effectiveDate}T00:00:00.000Z`);
    return this.service.executePayments(effectiveDate);
  }

  @Post('reconcile')
  async reconcile(@Body() body: { date: string }): Promise<ReconcileResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      throw new Error('invalid_date_format');
    }
    return this.service.reconcile(body.date);
  }
}
```

Hmm, but the plan says errors use the single envelope `{ error: { code, message, details } }`. The controller "validates input and calls the service. Zero business logic." So maybe I should use a proper exception that maps to the error envelope. In NestJS, you'd typically use an `HttpException` or a custom exception filter.

But wait — the instruction says "Change nothing the messages do not name." The only error is the module resolution. So I should keep the file as close to what it presumably was, just fixing the import path. But I don't have the original file content — I only know it had an import on line 2 at column 49 that referenced `./payouts.service`.

Let me think about this differently. The task says "Rewrite `src/payouts/payouts.controller.ts` complete, fixing what these messages require of this file." So I need to produce a complete, working file. The primary fix is the `.js` extension. The rest should follow the plan.

Given the conventions about errors (single envelope), I should use a proper approach. But since the controller has "zero business logic" and just validates input, I'll throw an appropriate exception. In a typical NestJS setup with a global exception filter, you might throw a specific error. But since I don't know the exact exception mechanism used in this codebase, and the plan says the controller validates and the error envelope is `{ error: { code, message, details } }`, I'll use a simple approach that's consistent with NestJS conventions.

Actually, let me reconsider. The plan says:
- Controller validates input and calls the service. Zero business logic.
- Error code `invalid_date_format` when controller receives a bad date string.

I'll keep it simple and just throw an error with the appropriate structure, or use HttpException. Actually in NestJS the standard way would be to throw an `HttpException` with a custom body, or have a global exception filter. Since I don't know the exact setup, I'll keep it minimal — just validate and call the service. The error handling envelope would be handled by a global filter (which isn't in this file's scope).

Let me just write a clean, minimal controller that:
1. Has the correct import with `.js` extension
2. Validates date format (basic regex)
3. Calls the service methods

I'll keep it simple and not over-engineer the error throwing since the plan says "zero business logic" in the controller.
```

## reply

```ts
import { Controller, Post, Body } from '@nestjs/common';
import { PayoutsService, ReconcileResult } from './payouts.service.js';

@Controller('payouts')
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Post('execute')
  async execute(
    @Body() body: { effectiveDate: string },
  ): Promise<{ sent: number; rejected: number }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate)) {
      throw new Error('invalid_date_format');
    }
    const effectiveDate = new Date(`${body.effectiveDate}T00:00:00.000Z`);
    return this.service.executePayments(effectiveDate);
  }

  @Post('reconcile')
  async reconcile(@Body() body: { date: string }): Promise<ReconcileResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      throw new Error('invalid_date_format');
    }
    return this.service.reconcile(body.date);
  }
}
```
