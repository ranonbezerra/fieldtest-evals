# 06-payout.controller.ts

## reasoning

```
Let me analyze what's needed for `src/payout/payout.controller.ts` based on the PLAN.md and references.

From the plan:
- `POST /payouts` endpoint
- Controller validates input and calls the service. Zero business logic.
- The controller is declared by the module.

From the plan section 3:
```ts
@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  create(@Body() dto: CreatePayoutDto): Promise<PayoutResponse>;
}
```

From the manifest:
- `src/payout/payout.controller.ts` reads: `src/payout/payout.service.ts`, `src/payout/payout.types.ts`

Now, the plan says:
- Controller validates input and calls the service. Zero business logic.

But looking at the service code already written (payout.service.ts), it already does validation (checking empty strings, parsing amount, checking > 0). So the controller's "input validation" role is minimal - it just passes the body to the service.

Wait, let me re-read the convention: "controller validates input and calls the service. Zero business logic."

But the service already handles validation. The controller should just be a thin layer that receives the request body and delegates to the service. The validation in the service is actually business-adjacent (amount parsing, checking > 0), but the plan put it in the service.

Looking at the plan more carefully for the controller:
- `@Controller('payouts')`
- `@Post()`
- `create(@Body() dto: CreatePayoutDto): Promise<PayoutResponse>`

The plan says the controller does "POST /payouts endpoint, input validation". But the service already does the validation. So the controller just passes through.

Let me look at what imports are needed:
- `@nestjs/common`: `Controller`, `Post`, `Body`
- `./payout.service.js`: `PayoutService`
- `./payout.types.js`: `CreatePayoutDto`, `PayoutResponse`

The file should be ESM (`.js` extensions in imports based on the convention `"type": "module"` and the reference files using `.js` extensions).

Let me write the controller:

```ts
import { Controller, Post, Body } from '@nestjs/common';
import type { CreatePayoutDto, PayoutResponse } from './payout.types.js';
import { PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  create(@Body() dto: CreatePayoutDto): Promise<PayoutResponse> {
    return this.service.create(dto);
  }
}
```

This is clean, minimal, follows the plan exactly. The controller:
- Is decorated with `@Controller('payouts')` (kebab-case plural endpoint)
- Has a single `@Post()` handler
- Receives the body as `CreatePayoutDto`
- Delegates entirely to `PayoutService.create()`
- Zero business logic

The "input validation" mentioned in the manifest for this file is handled by the service (as seen in the reference payout.service.ts), which is consistent with the plan's design where the service does the validation. The controller's role is simply to receive and route.

Let me make sure I'm not adding anything the plan doesn't name. The plan names exactly: `@Controller('payouts')`, class `PayoutController`, constructor with `PayoutService`, method `@Post() create(@Body() dto: CreatePayoutDto): Promise<PayoutResponse>`. That's it.
```

## reply

```ts
import { Controller, Post, Body } from '@nestjs/common';
import type { CreatePayoutDto, PayoutResponse } from './payout.types.js';
import { PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  create(@Body() dto: CreatePayoutDto): Promise<PayoutResponse> {
    return this.service.create(dto);
  }
}
```
