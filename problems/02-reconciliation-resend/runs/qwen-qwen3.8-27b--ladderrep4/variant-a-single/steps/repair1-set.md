# repair1-set

## reasoning

```
Let me analyze the two errors:

1. `src/common/exception-filter.ts(20,33)`: `Property 'getMessage' does not exist on type 'HttpException'. Did you mean 'message'?`

Looking at the file, line 20 is:
```ts
const message = exception.getMessage();
```

The error says `HttpException` doesn't have `getMessage` but suggests `message`. In NestJS, `HttpException` has a `getResponse()` method that returns the response body, and a `message` property. Actually, let me think about this more carefully.

In NestJS, `HttpException` is an abstract class. It has:
- `getStatus(): number`
- `getResponse(): any`

It does NOT have `getMessage()`. The `message` property is from `Error` base class.

So the fix is to use `exception.message` instead of `exception.getMessage()`.

Wait, but looking at the code more carefully:
```ts
const status = exception.getStatus();
const message = exception.getMessage();
```

The fix should be:
```ts
const status = exception.getStatus();
const message = exception.message;
```

2. `src/payout/payout.module.ts(13,52)`: `Object literal may only specify known properties, and 'timezone' does not exist in type 'ScheduleModuleOptions'.`

Line 13 is:
```ts
imports: [PrismaModule, ScheduleModule.forRoot({ timezone: 'UTC' })],
```

`ScheduleModule.forRoot()` doesn't accept a `timezone` option. The fix is to simply call `ScheduleModule.forRoot()` without any options.

Now let me write the corrected files.
```

## reply

### src/common/exception-filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

/**
 * The single error envelope for the API:
 *   { "error": { "code": "snake_case", "message": "...", "details": {} } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiError) {
      this.write(response, exception.status, exception.code, exception.message, exception.details);
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = exception.message;
      this.write(
        response,
        status,
        status === 404 ? 'resource_not_found' : 'request_rejected',
        typeof message === 'string' ? message : 'Request rejected',
        {},
      );
      return;
    }
    this.write(response, 500, 'internal_error', 'Unexpected server error', {});
  }

  private write(
    response: Response,
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown>,
  ): void {
    response.status(status).json({ error: { code, message, details } });
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BankGateway } from './bank-gateway.js';
import { PayoutConfig } from './payout-config.js';
import { PayoutController } from './payout.controller.js';
import { PayoutProcessor } from './payout.processor.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PAYOUT_ORDER_STORE } from './payout.types.js';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    BankGateway,
    PayoutConfig,
    PayoutProcessor,
    { provide: PAYOUT_ORDER_STORE, useClass: PayoutRepository },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```
