# repair2-set

## reasoning

```
The error is on line 27, column 26 of `src/common/api-exception-filter.ts`. Let me look at the file:

```typescript
} else if (exception instanceof HttpException) {
  status = exception.getStatus();
  code = this.codeForStatus(status);
```

Wait, line 27... let me count the lines:

1: import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
2: import { DomainException } from './domain-exception.js';
3: (blank)
4: interface ErrorEnvelope {
5:   error: { code: string; message: string; details: Record<string, unknown> };
6: }
7: (blank)
8: /**
9:  * Every error leaves the API in the single envelope
10:  * { error: { code, message, details } }; details is always an object.
11:  */
12: @Catch()
13: export class ApiExceptionFilter implements ExceptionFilter {
14:   catch(exception: unknown, host: ArgumentsHost): void {
15:     const response = host.switchToHttp().getResponse();
16:     const { status, body } = this.toEnvelope(exception);
17:     response.status(status).json(body);
18:   }
19: (blank)
20:   private toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
21:     let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
22:     let code = 'internal_error';
23:     let message = 'unexpected error';
24:     let details: Record<string, unknown> = {};
25: (blank)
26:     if (exception instanceof DomainException) {
27:       status = exception.status;
28:       code = exception.code;
29:       message = exception.message;
30:       details = exception.details;
31:     } else if (exception instanceof HttpException) {
32:       status = exception.getStatus();
...

So line 27 is `status = exception.status;` where `exception` is a `DomainException`.

The error says: `Property 'status' is private and only accessible within class 'HttpException'.`

This is interesting. The issue is that `DomainException` likely extends `HttpException`, and `HttpException` has a private `status` property. When the code does `exception instanceof DomainException`, TypeScript narrows the type to `DomainException`, but if `DomainException` extends `HttpException`, the `status` property from `HttpException` is private and not re-declared in `DomainException`.

Wait, but the error says "Property 'status' is private and only accessible within class 'HttpException'". This means `DomainException` extends `HttpException` and the `status` property is inherited from `HttpException` where it's private.

The fix: Instead of accessing `exception.status` directly (which is private on `HttpException`), use `exception.getStatus()` which is the public method on `HttpException`.

So line 27 should be:
```typescript
status = exception.getStatus();
```

This is the only error. Let me fix just this one file.
```

## reply

The single mistake: `DomainException` extends `HttpException`, whose `status` field is `private`. The public accessor is `getStatus()`. Line 27 accesses the private field directly instead of calling the public method.

### src/common/api-exception-filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { DomainException } from './domain-exception.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/**
 * Every error leaves the API in the single envelope
 * { error: { code, message, details } }; details is always an object.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const { status, body } = this.toEnvelope(exception);
    response.status(status).json(body);
  }

  private toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'unexpected error';
    let details: Record<string, unknown> = {};

    if (exception instanceof DomainException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = this.codeForStatus(status);
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : this.messageFromBody(body);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    return { status, body: { error: { code, message, details } } };
  }

  private codeForStatus(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) return 'validation_failed';
    if (status === HttpStatus.NOT_FOUND) return 'resource_not_found';
    if (status === HttpStatus.CONFLICT) return 'conflict';
    return 'http_error';
  }

  private messageFromBody(body: unknown): string {
    if (typeof body === 'object' && body !== null) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('; ');
    }
    return 'request failed';
  }
}
```
