# 04-main.ts

## reasoning

```
Let me analyze what `src/main.ts` needs to do based on the plan:

1. Bootstrap: NestFactory, global exception filter mapping domain errors to the error envelope
2. The error envelope format is: `{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }`
3. Domain errors: `ResourceNotFound` (code: 'resource_not_found') and `ConflictError` (code: 'conflict')

From the plan:
- `src/main.ts` reads: nothing (no dependencies listed)
- It bootstraps the NestJS app and sets up a global exception filter

The exceptions are defined in `src/classification/types.ts`:
```ts
export class ResourceNotFound extends Error { code = 'resource_not_found'; }
export class ConflictError      extends Error { code = 'conflict'; }
```

I need to:
1. Import NestFactory from `@nestjs/common` or `@nestjs/core`
2. Import AppModule from `./app.module`
3. Create a global exception filter that catches domain errors (ResourceNotFound, ConflictError) and maps them to the error envelope
4. For other errors, return a generic 500 with the envelope format
5. Bootstrap and listen

Let me think about the HTTP status codes:
- `ResourceNotFound` → 404
- `ConflictError` → 409

The error envelope:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

I'll use NestJS's `ExceptionFilter` interface. The filter needs to:
- Catch `ResourceNotFound` → 404, code 'resource_not_found'
- Catch `ConflictError` → 409, code 'conflict'
- Catch any other error → 500, code 'internal_error' (or similar)

Let me think about the imports. Since this is ESM with `"type": "module"`, I need to be careful about import syntax. In NestJS with ESM, you still use standard imports.

The `ExceptionFilter` interface from `@nestjs/common`:
```ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
```

Let me write the complete file:

```ts
import { NestFactory } from '@nestjs/core';
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { AppModule } from './app.module';
import { ResourceNotFound, ConflictError } from './classification/types';

@Catch()
class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    let status: number;
    let code: string;
    let message: string;

    if (exception instanceof ResourceNotFound) {
      status = 404;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof ConflictError) {
      status = 409;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = 'http_error';
      message = exception.message;
    } else {
      status = 500;
      code = 'internal_error';
      message = 'An unexpected error occurred';
    }

    response.status(status).json({
      error: {
        code,
        message,
        details: {},
      },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(3000);
}

void bootstrap();
```

Wait, I need to think about whether the port should be configurable. The plan says "Configuration comes from environment variables only." but it doesn't explicitly mention a port env var. Let me just use 3000 or check if there's a PORT env variable. The convention says "Configuration comes from environment variables only. `DATABASE_URL` for Postgres." It only mentions DATABASE_URL specifically. I'll use a PORT env variable with default 3000 to be safe, but actually the plan doesn't mention this. Let me just use 3000 to keep it simple and not add something the plan doesn't call for.

Actually, looking more carefully at the discipline rule: "Do exactly what the task asks. Do not create a file it does not call for, and do not improve code you were not asked to change." So I should keep it minimal. Just bootstrap and the filter.

Let me also consider: should I use `@Catch()` decorator? The `@Catch()` without arguments catches all exceptions, which is what we want for a global filter. Yes.

One more thought: the `HttpNotFoundException` and similar NestJS built-in exceptions might also come through. The plan only defines two domain errors. I'll handle HttpException as a catch-all for NestJS's own exceptions, and anything else as 500.

Actually, let me reconsider. The plan says the errors are raised by services and mapped by the filter. The two domain errors are `ResourceNotFound` and `ConflictError`. I should handle those specifically, and then have a fallback for everything else (including NestJS's own HttpExceptions and unexpected errors).

Let me finalize the file.
```

## reply

```ts
import { NestFactory } from '@nestjs/core';
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ResourceNotFound, ConflictError } from './classification/types.js';

@Catch()
class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    let status: number;
    let code: string;
    let message: string;

    if (exception instanceof ResourceNotFound) {
      status = 404;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof ConflictError) {
      status = 409;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = 'http_error';
      message = exception.message;
    } else {
      status = 500;
      code = 'internal_error';
      message = 'An unexpected error occurred';
    }

    response.status(status).json({
      error: {
        code,
        message,
        details: {},
      },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(3000);
}

void bootstrap();
```
