# 08-anchoring.controller.ts

## reasoning

```
Let me analyze the plan carefully to write the controller file.

From PLAN.md, the controller specification:

```ts
export class AnchoringController {
  constructor(service: AnchoringService);

  @Post('documents/:documentId/versions/:version/anchor')
  anchor(@Param() p, @Body() body: { content: Record<string, unknown> }): Promise<AnchorResult>;

  @Post('documents/:documentId/versions/:version/verify')
  verify(@Param() p, @Body() body: { content: Record<string, unknown> }): Promise<VerifyResult>;
}
```

Controller validates that `content` is a non-null object and `version` is a positive integer; returns 400 with the standard error envelope otherwise.

The error filter section says:
- `AnchoringErrorFilter` catches `AnchoringError` and `Prisma.PrismaClientKnownRequestError` (code `P2002`) and maps to `{ error: { code, message, details } }` with appropriate HTTP status (409 for duplicate, 404 for not-found, 502 for broadcast failure).

So the plan says "Error envelope helper (in controller or a small `src/anchoring/error.filter.ts`)". Since I'm only writing the controller file, and the plan says "in controller or a small `src/anchoring/error.filter.ts`", I'll put the filter in the controller file since the manifest doesn't list a separate error.filter.ts file.

Wait, let me re-check the manifest:
```
src/anchoring/anchoring.controller.ts | reads: src/anchoring/anchoring.service.ts | REST endpoints, input validation, error filter
```

Yes, the controller file handles: REST endpoints, input validation, error filter. So the error filter goes in this file.

Let me think about what I need:
1. Imports from NestJS: `Controller`, `Post`, `Param`, `Body`, `UseFilters`, `ExceptionFilter`, `Catch`
2. From NestJS HTTP: `HttpException`, or use `Response`
3. `AnchoringService`, `AnchorResult`, `VerifyResult` from the service
4. `AnchoringError` from the service
5. For 400 validation errors, I need to return the error envelope

Let me think about the error filter:
- Catches `AnchoringError`:
  - `duplicate_anchor` → 409
  - `resource_not_found` → 404
  - `broadcast_failed` → 502
- Catches Prisma P2002 → 409 (duplicate)

For input validation (400):
- `content` must be a non-null object
- `version` must be a positive integer

The standard error envelope is:
```json
{ "error": { "code": "snake_case", "message": "...", "details": {} } }
```

Now, for the Prisma error, I need to be careful. The plan says to catch `Prisma.PrismaClientKnownRequestError` with code `P2002`. But I don't want to import Prisma directly in the controller... Actually, looking at the service code, it already handles P2002 by throwing `AnchoringError('duplicate_anchor', ...)`. So the Prisma P2002 case might be a safety net. But the plan explicitly says to handle it in the filter.

Actually, looking more carefully at the service:
```ts
} catch (err: unknown) {
  if (this.isUniqueViolation(err)) {
    throw new AnchoringError('duplicate_anchor', ...);
  }
  throw err;
}
```

So the service already converts P2002 to AnchoringError. But the plan still says the filter should catch Prisma errors too, as a safety net. I'll include it but keep it minimal.

Wait, actually for the Prisma import - I need `@prisma/client` to get the error type. But actually, I can just check for the `code` property without importing Prisma directly. Let me think...

Actually, looking at this more carefully, the service already handles P2002. The filter is a safety net. I'll check for it by duck-typing (checking if `err.code === 'P2002'` and `err instanceof Object`). But the plan specifically says "Prisma.PrismaClientKnownRequestError". Let me just import it.

Hmm, but the plan says the controller "reads: src/anchoring/anchoring.service.ts" only. It doesn't mention reading from @prisma/client. Let me just handle it by checking the shape without importing Prisma.

Actually, I'll use a simpler approach: in the filter, I'll check if the error has a `code` property equal to 'P2002'. This is duck-typing and avoids the Prisma import.

Let me now write the controller:

```ts
import {
  Controller,
  Post,
  Param,
  Body,
  UseFilters,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { Response } from 'express';
import { AnchoringService, AnchorResult, VerifyResult, AnchoringError } from './anchoring.service';

@UseFilters(AnchoringErrorFilter)
@Controller()
export class AnchoringController {
  constructor(private readonly service: AnchoringService) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: Record<string, unknown> },
  ): Promise<AnchorResult> {
    // validate version
    const parsedVersion = Number(version);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
      throw new BadRequestError('version must be a positive integer');
    }
    // validate content
    if (!body || typeof body.content !== 'object' || body.content === null || Array.isArray(body.content)) {
      throw new BadRequestError('content must be a non-null object');
    }
    return this.service.anchorDocument(documentId, parsedVersion, body.content);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: Record<string, unknown> },
  ): Promise<VerifyResult> {
    const parsedVersion = Number(version);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
      throw new BadRequestError('version must be a positive integer');
    }
    if (!body || typeof body.content !== 'object' || body.content === null || Array.isArray(body.content)) {
      throw new BadRequestError('content must be a non-null object');
    }
    return this.service.verify(documentId, parsedVersion, body.content);
  }
}
```

Wait, but for the 400 errors, I need to return the standard error envelope. If I throw a regular Error, NestJS will return its default format. I need either:
1. A custom exception that the filter catches
2. Or use `@Res()` to manually write the response

The plan says the filter handles AnchoringError and Prisma errors. For 400s, I could either:
- Throw an AnchoringError with a specific code
- Or use a separate mechanism

Actually, looking at the plan again: "Controller validates that `content` is a non-null object and `version` is a positive integer; returns 400 with the standard error envelope otherwise."

I think the cleanest approach is to have the controller throw a custom error for validation, and the filter handles it. Or I can use NestJS's `BadRequestException` but that won't give me the right envelope format.

Let me think about this differently. The error envelope is:
```json
{ "error": { "code": "snake_case", "message": "...", "details": {} } }
```

For validation errors, the code would be something like `invalid_input` or `validation_error`.

I'll create a small helper in the controller file that sends the error response. Actually, the simplest approach: I'll have the filter handle all errors including a validation-specific error type. Or better, I can just have the controller use `@Res()` for validation errors and let the filter handle service-level errors.

Actually, the cleanest NestJS pattern: throw a custom exception and catch it in the filter. Let me define a simple approach:

I'll make the filter catch:
1. `AnchoringError` → maps code to status
2. Validation errors (I'll define them as a simple class or just check for a property)

Actually, let me reconsider. The simplest approach that matches the plan:

The filter catches `AnchoringError` (with its code field determining status) and Prisma P2002. For validation, I'll throw an `AnchoringError` with code `invalid_input` and map it to 400.

Wait, but `AnchoringError` is defined in the service file. Let me check if I can reuse it... Yes, the controller reads from `src/anchoring/anchoring.service.ts` which exports `AnchoringError`.

So my approach:
- For validation failures, throw `new AnchoringError('invalid_input', '...')` 
- The filter maps:
  - `duplicate_anchor` → 409
  - `resource_not_found` → 404  
  - `broadcast_failed` → 502
  - `invalid_input` → 400

This keeps everything in one error type and the filter handles all cases uniformly.

Let me write this out properly now.

For the Prisma P2002 case in the filter - since the service already converts it to `AnchoringError('duplicate_anchor')`, this is truly a safety net. I'll include a check for it in the filter but it should rarely (if ever) trigger.

Let me finalize:

```ts
import {
  Controller,
  Post,
  Param,
  Body,
  UseFilters,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { Response } from 'express';
import { AnchoringService, AnchorResult, VerifyResult, AnchoringError } from './anchoring.service';

@UseFilters(AnchoringErrorFilter)
@Controller()
export class AnchoringController {
  constructor(private readonly service: AnchoringService) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: Record<string, unknown> },
  ): Promise<AnchorResult> {
    this.validateInput(version, body);
    return this.service.anchorDocument(documentId, Number(version), body.content);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: Record<string, unknown> },
  ): Promise<VerifyResult> {
    this.validateInput(version, body);
    return this.service.verify(documentId, Number(version), body.content);
  }

  private validateInput(version: string, body: unknown): void {
    const parsed = Number(version);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new AnchoringError('invalid_input', 'version must be a positive integer');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AnchoringError('invalid_input', 'request body must be an object');
    }
    const content = (body as Record<string, unknown>).content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      throw new AnchoringError('invalid_input', 'content must be a non-null object');
    }
  }
}

@Catch()
export class AnchoringErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: Parameters<ExceptionFilter['catch']>[1]): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AnchoringError) {
      const status = this.mapCodeToStatus(exception.code);
      response.status(status).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: {},
        },
      });
      return;
    }

    // Safety net: Prisma unique constraint violation
    if (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: string }).code === 'P2002'
    ) {
      response.status(409).json({
        error: {
          code: 'duplicate_anchor',
          message: 'A duplicate anchor already exists',
          details: {},
        },
      });
      return;
    }

    // Fallback
    response.status(500).json({
      error: {
        code: 'internal_error',
        message: exception instanceof Error ? exception.message : 'Internal server error',
        details: {},
      },
    });
  }

  private mapCodeToStatus(code: string): number {
    switch (code) {
      case 'duplicate_anchor':
        return 409;
      case 'resource_not_found':
        return 404;
      case 'broadcast_failed':
        return 502;
      case 'invalid_input':
        return 400;
      default:
        return 500;
    }
  }
}
```

Hmm, I need to think about the `host` parameter type. In NestJS, `ExceptionFilter.catch` receives `(exception: T, host: ArgumentsHost)`. Let me use the proper import.

Actually, looking at NestJS docs, the signature is:
```ts
catch(exception: any, host: ArgumentsHost): void;
```

I need to import `ArgumentsHost` from `@nestjs/common`.

Let me also reconsider: the plan says "Error envelope helper (in controller or a small `src/anchoring/error.filter.ts`)". Since I'm only writing the controller file and the manifest doesn't list a separate error filter file, it goes in the controller.

Let me also double-check: the plan says the controller validates and "returns 400 with the standard error envelope otherwise." My approach of throwing AnchoringError('invalid_input') and having the filter catch it achieves this.

One more thought: should I use `@Res()` instead? No, the filter approach is cleaner and more NestJS-idiomatic.

Let me also make sure the `host` type is correct. In NestJS:
```ts
import { ArgumentsHost } from '@nestjs/common';

catch(exception: unknown, host: ArgumentsHost): void {
  const response = host.switchToHttp().getResponse<Response>();
  ...
}
```

This should work.

Final check on the plan requirements:
- ✅ `POST /documents/:documentId/versions/:version/anchor`
- ✅ `POST /documents/:documentId/versions/:version/verify`
- ✅ Validates content is non-null object
- ✅ Validates version is positive integer
- ✅ Returns 400 with standard error envelope for validation failures
- ✅ Error filter maps AnchoringError codes to proper HTTP status
- ✅ Safety net for Prisma P2002

I think this is complete. Let me write the final version.
```

## reply

```typescript
import {
  Controller,
  Post,
  Param,
  Body,
  UseFilters,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
} from '@nestjs/common';
import { Response } from 'express';
import {
  AnchoringService,
  AnchorResult,
  VerifyResult,
  AnchoringError,
} from './anchoring.service';

@UseFilters(AnchoringErrorFilter)
@Controller()
export class AnchoringController {
  constructor(private readonly service: AnchoringService) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: Record<string, unknown> },
  ): Promise<AnchorResult> {
    this.validateInput(version, body);
    return this.service.anchorDocument(documentId, Number(version), (body as { content: Record<string, unknown> }).content);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: Record<string, unknown> },
  ): Promise<VerifyResult> {
    this.validateInput(version, body);
    return this.service.verify(documentId, Number(version), (body as { content: Record<string, unknown> }).content);
  }

  private validateInput(version: string, body: unknown): void {
    const parsed = Number(version);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new AnchoringError('invalid_input', 'version must be a positive integer');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AnchoringError('invalid_input', 'request body must be an object');
    }
    const content = (body as Record<string, unknown>).content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      throw new AnchoringError('invalid_input', 'content must be a non-null object');
    }
  }
}

@Catch()
export class AnchoringErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AnchoringError) {
      const status = this.mapCodeToStatus(exception.code);
      response.status(status).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: {},
        },
      });
      return;
    }

    if (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: string }).code === 'P2002'
    ) {
      response.status(409).json({
        error: {
          code: 'duplicate_anchor',
          message: 'A duplicate anchor already exists',
          details: {},
        },
      });
      return;
    }

    response.status(500).json({
      error: {
        code: 'internal_error',
        message: exception instanceof Error ? exception.message : 'Internal server error',
        details: {},
      },
    });
  }

  private mapCodeToStatus(code: string): number {
    switch (code) {
      case 'duplicate_anchor':
        return 409;
      case 'resource_not_found':
        return 404;
      case 'broadcast_failed':
        return 502;
      case 'invalid_input':
        return 400;
      default:
        return 500;
    }
  }
}
```
