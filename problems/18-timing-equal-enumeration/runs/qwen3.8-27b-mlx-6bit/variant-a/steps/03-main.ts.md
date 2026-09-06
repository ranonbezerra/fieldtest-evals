# 03-main.ts

## reasoning

```
Let me analyze what `src/main.ts` needs to contain based on the plan:

From the plan's section 3:
> ### `src/main.ts`
> Bootstraps Nest, applies global `ValidationPipe({ whitelist: true })`, global exception filter that maps `AuthFailureError → 401` and `ValidationError → 400` into the standard envelope.

From the plan's error table:
| Condition | HTTP | `code` | Raised by |
|---|---|---|---|
| Missing / malformed `email` or `password` | 400 | `validation_failed` | Global filter (from `ValidationPipe`) |
| Sign-in: wrong password **or** unknown email | 401 | `invalid_credentials` | `AuthService.signIn` → `AuthFailureError` |

The error envelope format:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

So I need:
1. Import NestFactory, AppModule
2. Bootstrap the app
3. Apply global ValidationPipe with `whitelist: true`
4. Create a global exception filter that:
   - Catches `AuthFailureError` → 401 with `{ error: { code: "invalid_credentials", message: "...", details: {} } }`
   - Catches validation errors (from ValidationPipe, which throws `BadRequestException`) → 400 with `{ error: { code: "validation_failed", message: "...", details: {} } }`
5. Listen on a port (from environment variable, presumably)

Let me think about the details:

- `AuthFailureError` is exported from `src/auth/auth.service.ts` based on the plan.
- The ValidationPipe with `whitelist: true` will throw a `BadRequestException` when validation fails. I need to catch that in the exception filter.
- The environment variable for port - the plan doesn't specify a PORT env var explicitly, but the conventions say "Configuration comes from environment variables only." I'll use `process.env.PORT` with a default.

Wait, let me reconsider. The plan says "global exception filter that maps `AuthFailureError → 401` and `ValidationError → 400` into the standard envelope." The "ValidationError" here refers to what the ValidationPipe throws, which is a `BadRequestException` in NestJS.

Let me think about the structure:

```typescript
import { ValidationPipe, ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AuthFailureError } from './auth/auth.service.js';
import { Response, Request } from 'express';

@Catch(AuthFailureError, BadRequestException)
class GlobalExceptionFilter implements ExceptionFilter { ... }
```

Wait, actually in NestJS, the ValidationPipe by default throws `BadRequestException`. So I should catch that.

Let me think about ESM imports. The project uses `"type": "module"` so imports need `.js` extensions? Actually in NestJS with TypeScript, you typically don't add `.js` extensions in the source - the build tooling handles that. But with ESM... Let me think. Actually, in modern NestJS projects with ESM, you do use `.js` extensions in imports. But looking at the plan's manifest, it says `src/main.ts | reads: src/app.module.ts` - no extension shown. Let me just use the standard NestJS import style without extensions, as that's what most NestJS projects do even with ESM (the TypeScript compiler or ts-node handles resolution).

Actually wait - the conventions say `ESM, "type": "module"`. In a true ESM setup with TypeScript, you'd need `.js` extensions. But NestJS documentation typically shows imports without extensions. Let me go with the convention that's most standard for NestJS - no extensions in imports, as the build process (tsc or similar) handles it.

Hmm, but actually in strict ESM with `"type": "module"`, Node.js requires file extensions. However, TypeScript with `moduleResolution: "bundler"` or `"node16"` handles this differently. Since I can't see the tsconfig, I'll go with no extensions as that's the most common NestJS pattern and the plan doesn't specify otherwise.

Let me write the file:

```typescript
import {
  ValidationPipe,
  BadRequestException,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Response } from 'express';
import { AppModule } from './app.module.js';
import { AuthFailureError } from './auth/auth.service.js';

@Catch(AuthFailureError, BadRequestException)
class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AuthFailureError) {
      response.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'invalid_credentials',
          message: 'Invalid credentials.',
          details: {},
        },
      });
      return;
    }

    // BadRequestException from ValidationPipe
    const status = exception instanceof BadRequestException
      ? HttpStatus.BAD_REQUEST
      : HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(status).json({
      error: {
        code: 'validation_failed',
        message: exception.message,
        details: {},
      },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
}

void bootstrap();
```

Wait, I need to reconsider. The `@Catch` decorator with multiple exception types - does that work in NestJS? Yes, you can pass multiple exceptions to `@Catch`.

But actually, should I catch ALL exceptions or just these two? The plan says "global exception filter that maps `AuthFailureError → 401` and `ValidationError → 400` into the standard envelope." It doesn't say to catch all exceptions. Let me stick with just these two.

Actually, for robustness, I might want a catch-all that also produces the envelope format. But the plan specifically says to map those two, so I'll stick with just those.

Let me also reconsider the `details` field. The convention says `details` is "an object, never null." So `{}` is correct for validation errors.

For the validation error message - should it be a generic message or include the specific validation failure? The plan says "message is developer-facing English." I'll use a generic message since the specifics of which field failed might be useful but the plan doesn't specify including them. Actually, let me include a reasonable message. The convention shows `message` as developer-facing. I'll use something like "Validation failed." as a generic message, and could put specifics in `details`. But the plan says the error code is `validation_failed` and doesn't elaborate on message content. Let me keep it simple.

Actually, looking more carefully - the `BadRequestException` from ValidationPipe already has a message property with the validation error details. I could use that as the message. But for consistency and to avoid leaking internal validation messages, a generic "Validation failed." is safer.

Let me finalize:

```typescript
import {
  ValidationPipe,
  BadRequestException,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Response } from 'express';
import { AppModule } from './app.module.js';
import { AuthFailureError } from './auth/auth.service.js';

@Catch(AuthFailureError, BadRequestException)
class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AuthFailureError) {
      response.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'invalid_credentials',
          message: 'Invalid credentials.',
          details: {},
        },
      });
      return;
    }

    response.status(HttpStatus.BAD_REQUEST).json({
      error: {
        code: 'validation_failed',
        message: 'Validation failed.',
        details: {},
      },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
}

void bootstrap();
```

This looks good. Let me double-check against the plan:
- ✅ Bootstraps Nest
- ✅ Applies global ValidationPipe({ whitelist: true })
- ✅ Global exception filter that maps AuthFailureError → 401
- ✅ Global exception filter that maps ValidationError (BadRequestException) → 400
- ✅ Uses the standard error envelope format
- ✅ `code` is snake_case: `invalid_credentials`, `validation_failed`
- ✅ `message` is developer-facing English
- ✅ `details` is an object, never null

I think this is complete and correct.
```

## reply

```typescript
import {
  ValidationPipe,
  BadRequestException,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Response } from 'express';
import { AppModule } from './app.module.js';
import { AuthFailureError } from './auth/auth.service.js';

@Catch(AuthFailureError, BadRequestException)
class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AuthFailureError) {
      response.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'invalid_credentials',
          message: 'Invalid credentials.',
          details: {},
        },
      });
      return;
    }

    response.status(HttpStatus.BAD_REQUEST).json({
      error: {
        code: 'validation_failed',
        message: 'Validation failed.',
        details: {},
      },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
}

void bootstrap();
```
