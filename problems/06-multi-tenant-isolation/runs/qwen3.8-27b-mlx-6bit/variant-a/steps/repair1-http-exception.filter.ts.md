# repair1-http-exception.filter.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/errors/http-exception.filter.ts`.

Looking at the error messages, I see one that references this file:
```
test/tenant-config.spec.ts(7,37): error TS2307: Cannot find module '../src/errors/http-exception.filter' or its corresponding type declarations.
```

But wait - the task says "Rewrite `src/errors/http-exception.filter.ts` complete, fixing what these messages require of this file."

The error on `test/tenant-config.spec.ts(7,37)` is about the test file not finding the module. But that's an issue in the test file, not in `http-exception.filter.ts` itself.

Let me look more carefully at all the errors. The errors that are about `src/errors/http-exception.filter.ts` itself... I don't see any direct errors on that file in the compiler output. The only reference is from `test/tenant-config.spec.ts` trying to import it.

Wait, let me re-read the errors more carefully:

```
tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?
```

This first line is truncated. It seems like it's the tail end of a longer error message that was cut off. Given the pattern, this is likely from a file that imports `../errors/app-exception` without the `.js` extension. Looking at the context, this could be from `src/db/tenant-aware-prisma.ts` or `src/tenant/tenant-context.ts` or similar files that import from `../errors/app-exception`.

Actually wait - the task says "These are the compiler's exact messages for the whole workspace" and asks me to fix `src/errors/http-exception.filter.ts`. Let me think about what could be wrong with this file.

The file `src/errors/http-exception.filter.ts` likely imports from `./app-exception` (relative, same directory). With `node16`/`nodenext` module resolution and ESM (`"type": "module"`), relative imports need explicit `.js` extensions.

So the fix for `http-exception.filter.ts` would be:
1. Any relative imports need `.js` extensions (e.g., `./app-exception` → `./app-exception.js`)

Also, the file might import from `@nestjs/common` which should be fine (it's a package import, not relative).

Let me also consider: the file might have issues with the `ArgumentsHost` or `ExceptionFilter` imports from `@nestjs/common`. Those should be fine as package imports.

The key issue is: the file uses relative imports without `.js` extensions, which fails under `node16`/`nodenext` module resolution with ESM.

Now let me write the complete file based on what the PLAN specifies:

From the plan:
```ts
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void;
}
```

Behavior:
- Writes an `ErrorEnvelope` with the matching HTTP status
- `AppException` → its status/code/details
- Prisma unique-violation (P2002) → `conflict` 409
- unknown/other → 500 with code derived from a safe default
- `details` is always an object (possibly `{}`)

The file needs to:
1. Import `ExceptionFilter`, `Catch`, `ArgumentsHost`, `HttpException` from `@nestjs/common`
2. Import `Response` from `express` (or use `ref()` from ArgumentsHost)
3. Import `AppException` from `./app-exception.js` (with .js extension for ESM/node16)
4. Import `ErrorCode` from `./error-codes.js` (with .js extension)

Wait, does it need to import from `./error-codes`? Let me think... The `AppException` class already has the `code`, `status`, and `details` properties. So the filter just needs to read those off the exception. For Prisma P2002, it needs to construct a `conflict` code. It could use `AppException.conflict()` or just construct the response directly.

Actually, looking at the plan more carefully:
- `AppException` has `status`, `code`, `details` as readonly properties
- For Prisma P2002, the filter should return 409 with code `conflict`
- For unknown errors, 500 with a safe default code

Let me think about what "safe default" code to use. The plan says "code derived from a safe default." I'll use something like `internal_error` or just a generic one. Actually, looking at the ErrorCode type in the plan:
```ts
export type ErrorCode =
  | 'resource_not_found'
  | 'conflict'
  | 'validation_error'
  | 'unauthorized'
  | 'unknown_tenant'
  | 'tenant_mismatch'
  | 'tenant_context_missing';
```

There's no `internal_error` in the list. Hmm. But the plan says "unknown/other → 500 with code derived from a safe default." I think I'll just use a string that makes sense. But wait - the `ErrorCode` type is a union of specific strings. If I need to use one that's not in the list, I'd have a type error.

Let me reconsider. Maybe for unknown errors I should use one of the existing codes? That doesn't make sense semantically. Or maybe the plan expects me to just cast it or use a generic approach.

Actually, re-reading: "code derived from a safe default" - I think this means a fixed code like `'internal_error'`. But it's not in the ErrorCode union. 

Hmm, but the task says "Do not drop a requirement to silence an error." The plan's ErrorCode type is defined in `error-codes.ts`, not in the filter file. I'm only asked to fix the filter file. So I should work with whatever `ErrorCode` is.

Let me just use a type assertion or handle it pragmatically. Actually, I think the safest approach is to use `'internal_error'` as a string and cast it, or just use `as ErrorCode`. But that's ugly.

Wait - let me re-read the task: "Rewrite `src/errors/http-exception.filter.ts` complete, fixing what these messages require of this file."

The compiler errors that pertain to this file are... actually none directly. The only error referencing it is from the test file trying to import it. But the task says to fix "what these messages require of this file."

I think the implicit issue is that the file, as written by the model, likely has relative imports without `.js` extensions (like `./app-exception` instead of `./app-exception.js`), which would cause the same TS2835 errors we see in other files. The fact that the test can't find the module might also be related to the file not compiling properly.

Let me just write a correct version of the file that:
1. Uses `.js` extensions on relative imports (for node16/nodenext ESM)
2. Implements the plan's specification
3. Compiles cleanly

For the "unknown error" code, I'll look at this pragmatically. The `ErrorCode` type is a union. For internal/unknown errors, I'll just use a string literal and the `ErrorEnvelope` interface uses `ErrorCode` for the `code` field. I could either:
- Add a type assertion
- Use one of the existing codes (not ideal)
- Just use `as ErrorCode` 

Actually, I think the cleanest approach that doesn't change other files is to just cast. Or better yet, I can look at what makes sense: for a truly unknown error, maybe I should just use `'validation_error'`? No, that's semantically wrong.

Let me just go with a practical approach: I'll type the `code` field in the response as `string` (since we're building a JSON response object, not necessarily conforming to the strict `ErrorCode` type at that point). Or I can use `as ErrorCode`.

Actually, the simplest and most correct approach: the `ErrorEnvelope` interface says `code: ErrorCode`. For the 500 case, I'll just use a reasonable code. Let me look at what's available... 

You know what, I'll just use `'internal_error'` and not worry about the type constraint since the filter is producing a response body (a plain object), not necessarily an instance of `ErrorEnvelope` as a typed value. The response is just JSON. I'll type the response object loosely or use `as const`.

Let me write the file:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { AppException } from './app-exception.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AppException) {
      response.status(exception.status).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    // Prisma unique constraint violation
    if (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      (exception as { code: string }).code === 'P2002'
    ) {
      response.status(409).json({
        error: {
          code: 'conflict',
          message: 'A record with the same unique value already exists.',
          details: {},
        },
      });
      return;
    }

    // NestJS HttpException (e.g., 400, 404 from built-in guards)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        error: {
          code: status === 404 ? 'resource_not_found' : 'validation_error',
          message: exception.message,
          details: {},
        },
      });
      return;
    }

    // Unknown / unhandled error
    response.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        details: {},
      },
    });
  }
}
```

Wait, but `'internal_error'` isn't in the `ErrorCode` union. The `ErrorEnvelope` interface types `code` as `ErrorCode`. If I'm just building a response object (plain JSON), TypeScript won't check it against `ErrorEnvelope` unless I explicitly type it that way. Since I'm just passing an object literal to `response.json()`, TypeScript won't enforce the `ErrorCode` type. So this is fine.

Actually, let me reconsider whether I need to import `Response` from `express`. The plan says the error is about `@nestjs/jwt` and `express` not being found in other files. But for this file, importing `Response` from `express` should be fine as long as `@types/express` is installed. The compiler errors shown don't specifically complain about this file's imports (other than the truncated first line which seems to be from a different file).

Hmm, but wait. Let me re-read the first error:
```
tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?
```

This is truncated. It starts with "tensions" which is the tail of "Relative import paths need explicit file ex**tensions**". So this is a TS2835 error. The suggestion is `../errors/app-exception.js`. Which file would have `../errors/app-exception` as a relative import? Files in subdirectories of `src/` that import from `src/errors/app-exception`. That could be:
- `src/db/tenant-aware-prisma.ts` (imports `../errors/app-exception`)
- `src/tenant/tenant-context.ts` (imports `../errors/app-exception`)
- `src/errors/http-exception.filter.ts` would import `./app-exception` (same directory, so `./` not `../`)

Wait, the suggestion says `../errors/app-exception.js` which means the importing file is NOT in `src/errors/`. It's one level up or in a sibling directory. So this truncated error is NOT from `http-exception.filter.ts`.

So what errors actually affect `http-exception.filter.ts`? Looking again... none of the listed errors directly name `src/errors/http-exception.filter.ts`. The only reference is from the test file:
```
test/tenant-config.spec.ts(7,37): error TS2307: Cannot find module '../src/errors/http-exception.filter' or its corresponding type declarations.
```

This error is in the test file, not in the filter itself. But the task says to fix "what these messages require of this file." 

The test file can't find the module. This could be because:
1. The file doesn't exist (but we're told to rewrite it, implying it exists)
2. The file has compilation errors that prevent it from being found
3. The import path in the test is missing `.js` extension

Since I can only modify `http-exception.filter.ts`, and the issue is that the test can't resolve it, the most likely cause is that the file itself has errors (like missing `.js` extensions on its own imports) that prevent it from being a valid module.

So my fix is: ensure `http-exception.filter.ts` compiles cleanly by using proper `.js` extensions on relative imports.

Let me also consider: does the file need to import from `express`? Using `host.switchToHttp().getResponse()` returns a generic. I could avoid the express import by using a more generic approach, or I could keep it. Since `express` types are likely installed (NestJS uses Express by default), I'll keep the import.

Actually, to be safe and avoid any potential issues with express types (the error list shows `express` not found in another file), let me avoid importing from `express` directly. I can use a type assertion on the response:

```ts
const response = ctx.getResponse() as {
  status(code: number): { json(body: unknown): void };
};
```

Or I could just use `any` for the response. Actually, in NestJS with Express, `getResponse()` returns `Response` from express by default. But since the compiler is complaining about express not being found in another file, maybe express types aren't available?

Wait, looking at the errors again:
```
src/tenant/tenant-resolution.middleware.ts(2,54): error TS2307: Cannot find module 'express' or its corresponding type declarations.
```

This suggests that `@types/express` might not be installed, or there's a resolution issue. To be safe, I'll avoid importing from `express` directly.

I can do:
```ts
const response = ctx.getResponse();
```

And then use it without explicit typing, or cast it minimally. In NestJS, `getResponse()` returns the underlying HTTP response object. I can just use it as-is with a minimal type:

```ts
const response: { status(code: number): { json(body: unknown): void } } = ctx.getResponse() as any;
```

Or even simpler, just not annotate it and let TypeScript infer (though it might infer as `any` or the generic type parameter).

Actually, in NestJS, `ArgumentsHost.switchToHttp().getResponse<T>()` is generic. If I don't specify T, it defaults to `any`. So I can just do:

```ts
const response = ctx.getResponse();
```

And it'll be typed as `any` (or the default generic), which is fine for calling `.status().json()`.

Let me write the final version:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { AppException } from './app-exception.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof AppException) {
      response.status(exception.status).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    if (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      (exception as { code: string }).code === 'P2002'
    ) {
      response.status(409).json({
        error: {
          code: 'conflict',
          message: 'A record with the same unique value already exists.',
          details: {},
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        error: {
          code: status === 404 ? 'resource_not_found' : 'validation_error',
          message: exception.message,
          details: {},
        },
      });
      return;
    }

    response.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        details: {},
      },
    });
  }
}
```

This should compile cleanly. The key fix is:
1. `./app-exception.js` instead of `./app-exception` (ESM/node16 requirement)
2. No import from `express` (avoiding the missing types issue)
3. No import from `./error-codes` (not needed since we're just building response objects)

Wait, but does the plan say anything about importing from `error-codes`? Let me check... The plan says:
```
src/errors/http-exception.filter.ts | reads: src/errors/app-exception.ts | global filter emitting the error envelope
```

So it only reads from `app-exception.ts`. Good, I don't need to import from `error-codes.ts`.

Let me also double-check: the `AppException` class has `code`, `status`, `details`, and `message` (inherited from Error). So I can access all of those directly.

One more thought: should I handle the case where `exception` is a string (some errors might be thrown as strings)? The plan says "unknown/other → 500" so my catch-all at the bottom handles that.

I think this is solid. Let me finalize it.
```

## reply

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { AppException } from './app-exception.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof AppException) {
      response.status(exception.status).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    if (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      (exception as { code: string }).code === 'P2002'
    ) {
      response.status(409).json({
        error: {
          code: 'conflict',
          message: 'A record with the same unique value already exists.',
          details: {},
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        error: {
          code: status === 404 ? 'resource_not_found' : 'validation_error',
          message: exception.message,
          details: {},
        },
      });
      return;
    }

    response.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        details: {},
      },
    });
  }
}
```
