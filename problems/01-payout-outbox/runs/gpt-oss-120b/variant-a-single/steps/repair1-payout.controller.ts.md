# repair1-payout.controller.ts

## reasoning

```
We need to write controller fixing imports. Likely missing files, but we can create placeholder imports? We must reference existing modules: payout.service, dto. Assume they exist. Use proper NestJS decorators. Also handle unknown err type. Use try-catch with unknown and cast to Error. Return appropriate response. Use NestJS HttpException? Simplify.

Implement class with @Controller('payouts'), @Post(). method create(@Body() dto: CreatePayoutDto). Call this.payoutService.createPayout(dto). Return result.

Import needed: Controller, Post, Body, HttpException, HttpStatus, Injectable? Not needed.

Add // ASSUMPTION: existence of CreatePayoutDto, PayoutService with method createPayout returning something.

Also need to handle idempotency key duplicate error maybe thrown as some custom error; we just rethrow.

Implement.
```

## reply

```typescript
// src/payout/payout.controller.ts
// ---------------------------------------------------------------
// Payout controller – validates input and delegates to the service.
// ---------------------------------------------------------------

// ASSUMPTION: The following modules exist in the codebase:
// - ./payout.service exporting a class PayoutService with a method
//   `createPayout(dto: CreatePayoutDto): Promise<any>`.
// - ./dto/create-payout.dto exporting a class CreatePayoutDto that
//   contains the fields required by the POST /payouts endpoint.

import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { CreatePayoutDto } from './dto/create-payout.dto';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() dto: CreatePayoutDto) {
    try {
      // The service contains all business logic (including idempotency handling).
      const result = await this.payoutService.createPayout(dto);
      return result;
    } catch (err: unknown) {
      // Ensure we always throw a NestJS HttpException with a predictable shape.
      // If the error is already an HttpException we re‑throw it, otherwise we
      // wrap it in a generic 500 response.
      if (err instanceof HttpException) {
        throw err;
      }

      const message = err instanceof Error ? err.message : 'Unexpected error';
      throw new HttpException(
        {
          error: {
            code: 'internal_server_error',
            message,
            details: {},
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
```
