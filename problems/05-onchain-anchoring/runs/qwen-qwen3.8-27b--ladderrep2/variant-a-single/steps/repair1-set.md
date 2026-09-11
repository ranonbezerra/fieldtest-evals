# repair1-set

## reasoning

```
The errors are clear: `codeForStatus` is called without `this.` on lines 38 and 52. It's a private method on the class, so it needs to be accessed via `this.codeForStatus`.

Let me look at the file:

Line 38: `body: { error: { code: codeForStatus(status), message: res, details: {} } },`
Line 52: `return { status, body: { error: { code: codeForStatus(status), message, details } } };`

Both need `this.` prefix. That's it. One distinct mistake, applied in two places.
```

## reply

### src/all-exceptions.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AnchorDomainError } from './anchoring/errors.js';

/**
 * Single error envelope for the whole API:
 *   { "error": { "code": "snake_case", "message": "...", "details": {} } }
 * `code` is the contract; `message` is developer-facing English; `details` is
 * always an object.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.describe(exception);
    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    body: { error: { code: string; message: string; details: Record<string, unknown> } };
  } {
    if (exception instanceof AnchorDomainError) {
      return {
        status: exception.httpStatus,
        body: { error: { code: exception.code, message: exception.message, details: exception.details } },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return {
          status,
          body: { error: { code: this.codeForStatus(status), message: res, details: {} } },
        };
      }
      const obj = res as Record<string, unknown>;
      const message =
        typeof obj.message === 'string'
          ? obj.message
          : Array.isArray(obj.message)
            ? obj.message.join('; ')
            : exception.message;
      const details: Record<string, unknown> = {};
      if (Array.isArray(obj.message)) {
        details.validation = obj.message;
      }
      return { status, body: { error: { code: this.codeForStatus(status), message, details } } };
    }

    this.logger.error('unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'internal_error', message: 'an unexpected error occurred', details: {} } },
    };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case 400:
        return 'invalid_request';
      case 404:
        return 'resource_not_found';
      case 409:
        return 'conflict';
      case 422:
        return 'unprocessable_entity';
      default:
        return 'http_error';
    }
  }
}
```
