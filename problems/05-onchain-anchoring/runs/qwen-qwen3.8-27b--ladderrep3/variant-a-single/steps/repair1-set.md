# repair1-set

## reasoning

```
Let me analyze the errors as a whole:

1. `src/app.module.ts(2,30): error TS2307: Cannot find module './anchor/anchor.module.js'` — The file `src/anchor/anchor.module.ts` doesn't exist yet. This is a missing file that needs to be created.

2. `src/common/error-envelope.filter.ts(2,31): error TS2307: Cannot find module 'express'` — The `express` package types aren't available. We need to either add `@types/express` or change the import.

3. `src/common/error-envelope.filter.ts(3,35): error TS2307: Cannot find module '../anchor/anchor.types.js'` — The file `src/anchor/anchor.types.ts` doesn't exist yet.

4. `src/common/error-envelope.filter.ts(26,24): error TS18046: 'exception' is of type 'unknown'.` (multiple instances) — The `exception` variable is typed as `unknown` (from the `catch(exception: unknown, ...)` signature), and then it's being accessed directly without narrowing. Looking at the code, line 26 is inside the `if (exception instanceof AnchorDomainError)` block, so it should be narrowed. But wait — if the import of `AnchorDomainError` fails (error #3), then the `instanceof` check won't work, and TypeScript won't narrow the type. So the root cause is the missing import.

So the distinct mistakes are:
1. Missing file `src/anchor/anchor.module.ts`
2. Missing file `src/anchor/anchor.types.ts`
3. Missing `express` types (need to handle the `Response` import)

For the `express` issue — since we can't install packages, and the code uses `import type { Response } from 'express'`, we need to either:
- Use a different approach that doesn't require express types
- Or the project should have `@types/express` as a dev dependency

Since I can only return files I changed (not package.json), and the instruction says "Change exactly what the compiler requires", I need to fix the import. The simplest fix that doesn't require adding dependencies is to use a type assertion or a local type definition.

Actually wait — let me reconsider. The convention says I should fix what the compiler requires. The `express` module not being found means either:
1. The package isn't installed (I can't fix that by changing files alone without touching package.json)
2. We should use a different import path

Actually, in NestJS projects, `@types/express` is typically a dependency. If it's not installed, I can't fix it by changing source files alone unless I change the import. But the instruction says "Change exactly what the compiler requires" — and the compiler is saying it can't find the module.

The cleanest fix that only involves changing the files that have errors is to replace the `import type { Response } from 'express'` with a local type or use `any`. But that's not ideal.

Actually, looking more carefully — the task says "Fix all of them in one reply" and "Return only the files you changed." The files with errors are:
- `src/app.module.ts`
- `src/common/error-envelope.filter.ts`

But the root causes are missing files:
- `src/anchor/anchor.module.ts`
- `src/anchor/anchor.types.ts`

And a missing dependency for `express`.

Let me think about what files I need to return:

1. `src/anchor/anchor.types.ts` — needs to be created with the `AnchorDomainError` class
2. `src/anchor/anchor.module.ts` — needs to be created
3. `src/common/error-envelope.filter.ts` — the express import issue needs fixing
4. `src/app.module.ts` — once `anchor.module.ts` exists, the import should resolve

Wait, but the instruction says "Return only the files you changed." If I create new files, those are "changed" in the sense that they now exist. And `src/app.module.ts` doesn't need to change if `anchor.module.ts` exists.

For the express issue — I think the proper fix is to replace the `import type { Response } from 'express'` with a minimal local type or use a different approach. In NestJS, you can use `@nestjs/common`'s types or just define a minimal interface.

Actually, the simplest and most correct fix: use `Record<string, any>` or define a minimal `Response` interface locally. Or better yet, use the `ServerResponse` from `http` module which is built-in.

Wait, let me look at what the code actually uses from `Response`:
- `ctx.getResponse<Response>()` — gets the response
- `res.status(status).json(...)` — calls status and json

The minimal type needed is something like:
```ts
interface Response {
  status(code: number): Response;
  json(body: unknown): void;
}
```

But actually, the cleanest approach in a NestJS project where `@types/express` might not be installed is to just use the `http` module's `ServerResponse` or define a minimal local type.

Hmm, but actually the real issue might be that `@types/express` simply isn't in the dependencies. Since I can't modify `package.json` (it's not in the error list), I need to work around it in the source file.

Let me define a minimal local type that satisfies what's used:

```ts
type Response = {
  status(code: number): this;
  json(body: unknown): void;
};
```

This is the cleanest fix that only changes the file that has the error.

Now for `anchor.types.ts`, I need to define `AnchorDomainError` based on how it's used in the filter:
- `exception.httpStatus` — a number
- `exception.code` — a string
- `exception.message` — inherited from Error
- `exception.details` — `Record<string, unknown>`

For `anchor.module.ts`, I need to create a minimal NestJS module. Looking at the layout convention:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

The module should import and declare the relevant providers. But I only need to make the import resolve — I shouldn't create files that aren't required by the errors. The error is just "Cannot find module './anchor/anchor.module.js'". So I need to create a minimal module file.

But wait — if I create `anchor.module.ts` that references `anchor.controller.ts`, `anchor.service.ts`, etc., those files don't exist and will cause new errors. So I should create a minimal module that just exists without referencing non-existent files.

Actually, let me re-read the instructions: "Do not add features, do not rename anything the errors do not mention, do not reorganise." and "Change exactly what the compiler requires."

The compiler requires:
1. `src/anchor/anchor.module.ts` to exist (so the import in `app.module.ts` resolves)
2. `src/anchor/anchor.types.ts` to exist (so the import in `error-envelope.filter.ts` resolves)
3. The `express` import to resolve
4. The type narrowing to work (which will work once #2 is fixed)

For #1, a minimal module:
```ts
import { Module } from '@nestjs/common';

@Module({})
export class AnchorModule {}
```

For #2, the `AnchorDomainError` class:
```ts
export class AnchorDomainError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AnchorDomainError';
  }
}
```

For #3, replace the express import with a local type.

Let me check: does `src/app.module.ts` need to change? No — once `anchor.module.ts` exists, the import will resolve. The file content is fine as-is.

So the files I need to return are:
1. `src/anchor/anchor.types.ts` (new file)
2. `src/anchor/anchor.module.ts` (new file)
3. `src/common/error-envelope.filter.ts` (modified to fix express import)

Let me write them out.
```

## reply

Looking at the errors as a whole, there are three distinct mistakes:

1. **Missing file `src/anchor/anchor.types.ts`** — causes both the TS2307 and the TS18046 errors (the `instanceof` narrowing fails when the import is unresolvable).
2. **Missing file `src/anchor/anchor.module.ts`** — causes the TS2307 in `app.module.ts`.
3. **Missing `express` types** — the `import type { Response } from 'express'` cannot resolve.

`src/app.module.ts` itself is correct once the module file exists, so it needs no change.

### src/anchor/anchor.types.ts
```ts
export class AnchorDomainError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AnchorDomainError';
  }
}
```

### src/anchor/anchor.module.ts
```ts
import { Module } from '@nestjs/common';

@Module({})
export class AnchorModule {}
```

### src/common/error-envelope.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { AnchorDomainError } from '../anchor/anchor.types.js';

type Response = {
  status(code: number): this;
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
