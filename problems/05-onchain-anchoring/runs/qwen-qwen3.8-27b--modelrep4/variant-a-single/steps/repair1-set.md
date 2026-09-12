# repair1-set

## reasoning

```
Let me analyze the errors:

1. `src/anchor/anchor.controller.ts(51,35)`: `Type 'object' is not assignable to type 'Record<string, unknown>'` — this is on line 51. Looking at the controller code, the `readVerificationRequest` method has:
   ```ts
   if (typeof record.content !== 'object' || record.content === null || Array.isArray(record.content)) {
     throw new AnchorBadRequestError('content must be a JSON object', { field: 'content' });
   }
   return { documentId, version, content: record.content };
   ```
   
   The issue is that after the type guard `typeof record.content !== 'object' || record.content === null || Array.isArray(record.content)`, TypeScript narrows `record.content` to `object` (since it's from `Record<string, unknown>`, the type is `unknown`, and after excluding non-objects, null, and arrays, it's `object`). But the return type declares `content: Record<string, unknown>`. The fix is to cast it: `content: record.content as Record<string, unknown>`.

   Wait, let me re-read. `record` is `Record<string, unknown>`, so `record.content` is `unknown`. After the guard `typeof record.content !== 'object' || record.content === null || Array.isArray(record.content)`, TypeScript narrows to `object` (not `Record<string, unknown>`). The return type expects `Record<string, unknown>`.

   The fix: cast `record.content as Record<string, unknown>` on line 51.

2. `src/common/exception.filter.ts(1,32)`: `Individual declarations in merged declaration 'ExceptionFilter' must be all exported or all local.` and `Import declaration conflicts with local declaration of 'ExceptionFilter'.`

   Looking at the file:
   ```ts
   import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
   ```
   
   It imports `ExceptionFilter` from `@nestjs/common` (the interface) AND declares a class also named `ExceptionFilter`. This is a conflict. The import of `ExceptionFilter` (the interface) conflicts with the local class declaration.

   The fix: rename the import to avoid the conflict. We can use a type import alias:
   ```ts
   import { ArgumentsHost, Catch, type ExceptionFilter as ExceptionFilterInterface, HttpException, HttpStatus } from '@nestjs/common';
   ```
   
   Wait, but the class implements `ExceptionFilter` (the interface). If we alias it, we need to use the alias in the `implements` clause. Let me look at the class:
   ```ts
   export class ExceptionFilter implements ExceptionFilter {
   ```
   
   So we need to:
   1. Rename the import: `import { ArgumentsHost, Catch, type ExceptionFilter as NestExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';`
   2. Change the implements: `export class ExceptionFilter implements NestExceptionFilter {`

   Actually, a simpler approach: just remove `ExceptionFilter` from the import since the class itself is the implementation. But we still need the interface for `implements`. Let me use the alias approach.

   Wait, actually the simplest fix is to just not import `ExceptionFilter` and instead reference it differently. But `implements` needs the type. Let me use:
   
   ```ts
   import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter as NestExceptionFilter } from '@nestjs/common';
   ```
   
   Then:
   ```ts
   export class ExceptionFilter implements NestExceptionFilter {
   ```

   Actually, even simpler - we can just use a type-only import separately or alias it inline. Let me go with the inline alias.

Let me write out the fixed files.
```

## reply

### src/anchor/anchor.controller.ts
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';
import { AnchorBadRequestError } from './anchor.errors.js';

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchoring: AnchorService) {}

  /** POST /anchors — anchor a published (document, version). */
  @Post()
  anchorDocument(@Body() body: unknown) {
    const { documentId, version } = AnchorController.readIdPair(body);
    return this.anchoring.anchorDocument(documentId, version);
  }

  /** POST /anchors/verifications — verify content against the stored anchor. */
  @Post('verifications')
  verify(@Body() body: unknown) {
    const { documentId, version, content } = AnchorController.readVerificationRequest(body);
    return this.anchoring.verify(documentId, version, content);
  }

  private static readIdPair(body: unknown): { documentId: string; version: string } {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AnchorBadRequestError('request body must be a JSON object');
    }
    const record = body as Record<string, unknown>;
    if (typeof record.documentId !== 'string' || record.documentId.length === 0 || record.documentId.length > 255) {
      throw new AnchorBadRequestError('documentId must be a non-empty string of at most 255 characters', {
        field: 'documentId',
      });
    }
    if (typeof record.version !== 'string' || record.version.length === 0 || record.version.length > 255) {
      throw new AnchorBadRequestError('version must be a non-empty string of at most 255 characters', {
        field: 'version',
      });
    }
    return { documentId: record.documentId, version: record.version };
  }

  private static readVerificationRequest(body: unknown): {
    documentId: string;
    version: string;
    content: Record<string, unknown>;
  } {
    const { documentId, version } = AnchorController.readIdPair(body);
    const record = body as Record<string, unknown>;
    if (typeof record.content !== 'object' || record.content === null || Array.isArray(record.content)) {
      throw new AnchorBadRequestError('content must be a JSON object', { field: 'content' });
    }
    return { documentId, version, content: record.content as Record<string, unknown> };
  }
}
```

### src/common/exception.filter.ts
```ts
import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter as NestExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ApiException } from './api-exception.js';

const GENERIC_CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable_entity',
  500: 'internal_error',
  503: 'service_unavailable',
};

/** Maps every thrown error to the single { error: { code, message, details } } envelope. */
@Catch()
export class ExceptionFilter implements NestExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = this.describe(exception);
    res.status(status).json({ error: { code, message, details } });
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
  } {
    if (exception instanceof ApiException) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : String((body as Record<string, unknown>).message ?? exception.message);
      return { status, code: GENERIC_CODE_BY_STATUS[status] ?? 'error', message, details: {} };
    }
    const error = exception instanceof Error ? exception : new Error(String(exception));
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: `unexpected error: ${error.message}`,
      details: { exception: error.name },
    };
  }
}
```
