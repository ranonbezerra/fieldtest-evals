# repair2-set

## reasoning

```
The error is in `src/common/error-envelope.filter.ts` at line 5, column 25. The error is TS2526: A 'this' type is available only in a non-static member of a class or interface.

Looking at the file, line 5 is:
```ts
type Response = {
  status(code: number): this;
  json(body: unknown): void;
};
```

The issue is that `this` is used in a type alias (a standalone type), not in a class or interface. In TypeScript, `this` types are only valid in non-static members of a class or interface, not in type aliases.

The fix is to replace `this` with the concrete type. Since `status()` should return the response object itself (for chaining), we can use `Response` itself, but that would be circular. The standard approach is to either:
1. Use `unknown` or a specific return type
2. Change the type to an interface (but `this` still wouldn't work in an interface type alias)
3. Use a different approach

Actually, the cleanest fix is to just not use `this` and instead type it as returning something that allows chaining. The simplest fix that preserves the intent is to change `status(code: number): this` to `status(code: number): Response` — but wait, that's circular since we're defining Response.

Actually, the simplest and most correct fix is to just remove the return type or use a concrete type. Since this is a local type used only for the `getResponse()` cast, the return type of `status()` doesn't really matter for the code. We can just make it return `void` or omit the return type, or we can change the approach.

Looking at how it's used:
```ts
const res = ctx.getResponse<Response>();
res.status(status).json({ error: { code, message, details } });
```

The `status()` call is chained with `.json()`. So `status()` needs to return something that has `.json()`. The simplest fix that works:

Option 1: Change `this` to `Response` — this is circular in a type alias. Actually in TypeScript, type aliases CAN reference themselves. Let me think... No, actually you can't use a type alias within its own definition in a self-referential way like that for a property type. Wait, actually you CAN. Type aliases can be recursive. `type Response = { status(code: number): Response; json(body: unknown): void; }` should work.

Actually let me verify: TypeScript does allow recursive type aliases. So `type Response = { status(code: number): Response; json(body: unknown): void; }` is valid.

But wait, the original intent with `this` was to be more precise (it would return the same subtype). But since we're casting to `Response` anyway, using `Response` as the return type is fine.

Alternatively, the simplest fix: just change `this` to `Response`.

Let me go with that.
```

## reply

### src/common/error-envelope.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { AnchorDomainError } from '../anchor/anchor.types.js';

type Response = {
  status(code: number): Response;
  json(body: unknown): void;
};

/**
 * The single error envelope for the whole API:
 *
 *   { "error": { "code": "snake_case_code", "message": "...", "details": {} } }
 *
 * `code` is the contract, `message` is developer-facing English, and `details`
 * is always an object, never null.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const { status, code, message, details } = this.describe(exception);
    res.status(status).json({ error: { code, message, details } });
  }

  private describe(exception: unknown): { status: number; code: string; message: string; details: Record<string, unknown> } {
    if (exception instanceof AnchorDomainError) {
      return { status: exception.httpStatus, code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === 'string' ? response : String((response as Record<string, unknown>).message ?? exception.message);
      const code = STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'invalid_input');
      return { status, code, message, details: {} };
    }
    if (exception instanceof Error) {
      this.logger.error(`unhandled error: ${exception.message}`);
    }
    return { status: 500, code: 'internal_error', message: 'Internal server error', details: {} };
  }
}

const STATUS_CODES: Record<number, string> = {
  400: 'invalid_input',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'resource_not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'invalid_input',
};
```
