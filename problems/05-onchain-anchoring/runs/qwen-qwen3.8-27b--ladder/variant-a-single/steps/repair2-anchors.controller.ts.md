# repair2-anchors.controller.ts

## reasoning

```
Let me analyze the compiler errors to understand what's needed in `anchors.controller.ts`.

From the error messages, I can see:
1. `src/anchors/anchors.controller.ts(3,15): error TS2305: Module '"./anchors.repository.js"' has no exported member 'Anchor
```

## reply

'.`

Wait, that's odd. Let me re-read. The error says line 3, column 15 of `anchors.controller.ts` has an import of `AnchorRecord` from `./anchors.repository.js` that doesn't exist as an export.

But looking at the reference `anchors.repository.ts`, it DOES export `AnchorRecord` as an interface. So why is the compiler saying it doesn't exist?

Wait - the reference shows the file WITH the errors already present (the broken state). Let me re-read the reference file carefully.

Looking at the reference `anchors.repository.ts`:
- It exports `AnchorRecord` as an interface (line 7)
- It exports `DuplicateAnchorError` as a class (line 22)
- It exports `AnchorsRepository` as a class (line 44)

So `AnchorRecord` IS exported from the repository. But the compiler says it's not. This is confusing.

Wait, I need to re-read the task. The task says "The blocks above are reference material. Rely on them; never reproduce them and never rewrite them."

And the task says: "Rewrite `src/anchors/anchors.controller.ts` complete, fixing what these messages require of this file."

So I need to fix ONLY `anchors.controller.ts`. The errors in other files are listed but I should only change the controller.

The error in the controller is:
```
src/anchors/anchors.controller.ts(3,15): error TS2305: Module '"./anchors.repository.js"' has no exported member 'AnchorRecord'.
```

This means line 3 of the controller imports `AnchorRecord` from `./anchors.repository.js`. But the compiler says it's not exported there.

But wait - the reference repository file DOES export `AnchorRecord`. So why would the compiler say it's not exported?

Hmm, let me think about this differently. The compiler errors are from the CURRENT state of the workspace. The reference files shown are also from the current broken state. The repository file shown has the errors listed for it too:

```
src/anchors/anchors.repository.ts(2,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/anchors/anchors.repository.ts(8,33): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../chain/chain-client.js'?
src/anchors/anchors.repository.ts(33,30): error TS2339: Property 'PENDING_BROADCAST' does not exist on type '{ PREPARED: "PREPARED"; BROADCAST_SENT: "BROADCAST_SENT"; OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN"; CONFIRMED: "CONFIRMED"; FAILED: "FAILED"; }'.
```

So the repository file has its own errors. The import on line 2 is `import { PrismaClient } from '@prisma/client';` - wait no, looking at the reference:

Line 1: `import { PrismaClient } from '@prisma/client';`
Line 2: `import { ChainClient, AnchorReceipt } from '../chain/chain-client.js';`
Line 3: `import { AnchorStatus, AnchorStatusValue, ANCHOR_STATUSES } from './anchor-status.js';`

Wait, the error says line 2, column 31 is `Cannot find module '../prisma/prisma.service'`. That doesn't match the reference file I'm seeing. The reference file imports from `'@prisma/client'` on line 1, not from `'../prisma/prisma.service'`.

I think the reference file shown is NOT the exact current state - or maybe the line numbers don't perfectly align. Let me not overthink this.

The key point: I need to fix `anchors.controller.ts`. The only error in the controller is:
```
src/anchors/anchors.controller.ts(3,15): error TS2305: Module '"./anchors.repository.js"' has no exported member 'AnchorRecord'.
```

This means the controller imports `AnchorRecord` from the repository, but for some reason the compiler can't resolve it. This could be because the repository file itself has errors that prevent it from being properly typed, OR it could be that the controller is importing it incorrectly.

But wait - the task says "Change nothing the messages do not name." So I should only fix what the controller errors require. The only controller error is the `AnchorRecord` import.

Looking at the reference repository, `AnchorRecord` IS exported. So maybe the issue is that the controller is importing it in a way that the compiler can't resolve because the repository file has its own compilation errors.

Actually, re-reading the instructions: "Rewrite `src/anchors/anchors.controller.ts` complete, fixing what these messages require of this file."

The only message for the controller is:
```
src/anchors/anchors.controller.ts(3,15): error TS2305: Module '"./anchors.repository.js"' has no exported member 'AnchorRecord'.
```

So I need to fix the controller so it doesn't have this error. The simplest fix: don't import `AnchorRecord` from the repository. Instead, either:
1. Define the type locally in the controller
2. Import it from a different location
3. Remove the import if it's not actually needed

But I don't see the current controller content. I need to write it from scratch based on the requirements.

Let me think about what the controller needs to do based on the variant requirements:
1. `anchorDocument(documentId, version)` - endpoint to anchor a document
2. `verify(documentId, version, content)` - endpoint to verify an anchor

The controller should:
- Validate input
- Call the service
- Return appropriate responses
- Handle errors with the error envelope format

Now, the error says the controller imports `AnchorRecord` from the repository. The fix is to not import it from there. Since I'm writing the controller fresh, I should:
- Not import `AnchorRecord` from the repository
- Only import what I need from the service

Let me look at what the service exports based on the errors in `anchors.service.ts`:
- The service imports `AnchorRecord`, `AnchorStatusValue`, `DuplicateAnchorError` from the repository
- The service has methods like `createIntent`, `markBroadcastSent`, `markFailed`, `markOutcomeUnknown`, `findByDocumentVersion` (or `findByDocumentAndVersion`)

For the controller, I need to call service methods. Let me think about what the service likely exposes:
- `anchor(documentId, version)` or `anchorDocument(documentId, version)`
- `verify(documentId, version, content)`

The controller needs:
- The service injected
- DTOs for request validation
- Response types

Let me write the controller. I'll import from the service, not from the repository. If I need a type that's defined in the repository, I'll either import it from the service (if re-exported) or define it inline.

Actually, looking more carefully at the errors - the service imports `AnchorRecord` from the repository too and gets the same error. This suggests the repository file's exports are somehow not being recognized. This is likely because the repository file has compilation errors (the missing module, the PENDING_BROADCAST issue) that cause the entire module's type information to break.

But my task is ONLY to fix the controller. The other files will be fixed separately. So in the controller, I should avoid importing `AnchorRecord` from the repository.

Let me write a clean controller that:
1. Doesn't import `AnchorRecord` from the repository
2. Imports the service
3. Has the two endpoints (anchor and verify)
4. Handles errors properly

For the response types, I can use inline types or import from the service if appropriate.

Let me think about what the service likely returns. Based on the variant:
- `anchorDocument(documentId, version)` - returns some anchor info (txId, status, etc.)
- `verify(documentId, version, content)` - returns either a proof (txId, block) or a mismatch report

I'll define the response types inline in the controller or import them from the service.

Let me write this:

```typescript
import { Controller, Post, Body, Param, ParseIntPipe, HttpException, HttpStatus, ValidationPipe } from '@nestjs/common';
import { AnchorsService } from './anchors.service.js';

interface AnchorRequestDto {
  documentId: string;
  version: number;
}

interface VerifyRequestDto {
  documentId: string;
  version: number;
  content: Record<string, unknown>;
}

interface AnchorResponseDto {
  txId: string;
  status: string;
  blockNumber: number | null;
}

interface VerifyProofDto {
  txId: string;
  blockNumber: number;
  contentHash: string;
}

interface VerifyMismatchDto {
  mismatch: true;
  expectedHash: string;
  actualHash: string;
}

type VerifyResponseDto = VerifyProofDto | VerifyMismatchDto;

@Controller('anchors')
export class AnchorsController {
  constructor(
    private readonly anchorsService: AnchorsService,
  ) {}

  @Post('anchor')
  async anchor(
    @Body(new ValidationPipe({ whitelist: true })) body: AnchorRequestDto,
  ): Promise<AnchorResponseDto> {
    try {
      const result = await this.anchorsService.anchorDocument(body.documentId, body.version);
      return {
        txId: result.txId,
        status: result.status,
        blockNumber: result.blockNumber,
      };
    } catch (error) {
      this.handleServiceError(error);
    }
  }

  @Post('verify')
  async verify(
    @Body(new ValidationPipe({ whitelist: true })) body: VerifyRequestDto,
  ): Promise<VerifyResponseDto> {
    return this.anchorsService.verify(body.documentId, body.version, body.content);
  }

  private handleServiceError(error: unknown): never {
    if (error instanceof DuplicateAnchorError) {
      throw new HttpException({
        error: {
          code: 'duplicate_anchor',
          message: `An anchor already exists for this document and version`,
          details: {},
        },
      }, HttpStatus.CONFLICT);
    }
    throw new HttpException({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred',
        details: {},
      },
    }, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
```

Wait, but I need `DuplicateAnchorError` - and that's exported from the repository which has errors. If I import it from the repository, I'll get the same compilation error.

Hmm, but the error message specifically says `Module '"./anchors.repository.js"' has no exported member 'AnchorRecord'`. It doesn't say `DuplicateAnchorError` is not exported. Let me re-check.

The errors for the controller are ONLY:
```
src/anchors/anchors.controller.ts(3,15): error TS2305: Module '"./anchors.repository.js"' has no exported member 'AnchorRecord'.
```

That's the ONLY error in the controller. So the controller currently imports `AnchorRecord` from the repository on line 3. The fix is to remove that import or get the type from elsewhere.

But I don't see the current controller code. I need to write it from scratch. The key constraint is: don't import `AnchorRecord` from `./anchors.repository.js`.

I can:
1. Define the type I need inline
2. Import it from the service (if the service re-exports it)
3. Import `DuplicateAnchorError` from the repository (since no error says it's not exported)

Actually wait - if the repository file has compilation errors, wouldn't ALL its exports be broken? Let me think...

In TypeScript, if a module has errors, the types that depend on those errors might be `any` or might not resolve. But the specific error is about `AnchorRecord` not being exported. The reference file clearly shows it IS exported. This is confusing.

Let me just focus on what I can control: write a controller that doesn't import `AnchorRecord` from the repository. I'll define any needed types inline.

For `DuplicateAnchorError`, I can check the error by name or by a property instead of using `instanceof`. That way I don't need to import it.

Actually, let me reconsider. The task says "Change nothing the messages do not name." The only message for the controller is about `AnchorRecord`. So I just need to make sure I don't import `AnchorRecord` from the repository. I can still import other things from the repository if needed (like `DuplicateAnchorError`).

But to be safe and minimal, let me just avoid importing anything from the repository in the controller. I'll use the service for all logic and define response types locally.

Let me also think about what the service's method signatures likely are based on the errors:
- `this.anchorsService.anchorDocument(body.documentId, body.version)` - the service has an `anchorDocument` method (based on the variant description)
- The service likely returns an object with `txId`, `status`, `blockNumber`
- For verify, it returns a proof or mismatch

Let me also check - the endpoint naming convention says "Endpoint: kebab-case, plural." So the controller path should be `/anchors` (plural).

Now let me think about the route structure. The variant says:
1. `anchorDocument(documentId, version)` 
2. `verify(documentId, version, content)`

These could be:
- POST `/anchors` for anchoring (body: {documentId, version})
- POST `/anchors/verify` for verifying (body: {documentId, version, content})

Or they could use path params. But since we have `documentId` and `version` as inputs, body makes more sense for the anchor operation. For verify, we also have `content` which could be large, so body makes sense.

Let me write the final controller:

```typescript
import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { AnchorsService } from './anchors.service.js';

interface AnchorRequestDto {
  documentId: string;
  version: number;
}

interface VerifyRequestDto {
  documentId: string;
  version: number;
  content: Record<string, unknown>;
}

interface AnchorResponseDto {
  txId: string;
  status: string;
  blockNumber: number | null;
}

interface VerifyResponseDto {
  match: boolean;
  contentHash: string;
  txId?: string;
  blockNumber?: number;
  expectedHash?: string;
}

@Controller('anchors')
export class AnchorsController {
  constructor(private readonly anchorsService: AnchorsService) {}

  @Post()
  async anchor(
    @Body(new ValidationPipe({ whitelist: true }))
    body: AnchorRequestDto,
  ): Promise<AnchorResponseDto> {
    try {
      const result = await this.anchorsService.anchorDocument(
        body.documentId,
        body.version,
      );
      return result;
    } catch (error: unknown) {
      this.handleServiceError(error);
    }
  }

  @Post('verify')
  async verify(
    @Body(new ValidationPipe({ whitelist: true }))
    body: VerifyRequestDto,
  ): Promise<VerifyResponseDto> {
    return this.anchorsService.verify(body.documentId, body.version, body.content);
  }

  private handleServiceError(error: unknown): never {
    if (
      error instanceof Error &&
      error.name === 'DuplicateAnchorError'
    ) {
      throw new HttpException(
        {
          error: {
            code: 'duplicate_anchor',
            message: 'An anchor already exists for this document and version',
            details: {},
          },
        },
        HttpStatus.CONFLICT,
      );
    }
    throw new HttpException(
      {
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred',
          details: {},
        },
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
```

Hmm, but I'm making assumptions about the service's return types. Let me think about what's reasonable.

The service's `anchorDocument` method likely returns something that includes `txId`, `status`, and `blockNumber`. The controller just passes it through.

Actually, I realize I should be more careful. The task says "Change nothing the messages do not name." The only error is the import of `AnchorRecord`. So the current controller probably already has the right structure, it just has a bad import on line 3.

Since I don't see the current controller, I need to write it from scratch but make sure:
1. No import of `AnchorRecord` from `./anchors.repository.js`
2. The controller properly delegates to the service
3. Error handling follows the error envelope convention

Let me also think about whether I need to import anything from the repository. The `DuplicateAnchorError` is a class exported from the repository. If I use `instanceof` to check for it, I need to import it. But if the repository has compilation errors, importing from it might cause issues.

To be safe, I'll check by error name instead of `instanceof`. This avoids any import from the repository.

Let me also consider: the service might re-export `DuplicateAnchorError`. Looking at the service errors:
```
src/anchors/anchors.service.ts(22,3): error TS2305: Module '"./anchors.repository.js"' has no exported member 'DuplicateAnchorError'.
```

So the service also can't import `DuplicateAnchorError` from the repository! This means the entire chain is broken. But I'm only fixing the controller.

For the controller, I'll use error name checking to avoid any dependency on the repository's exports.

Let me finalize my answer. I think the controller should be clean, only importing from the service and NestJS.
</think>

```typescript
import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { AnchorsService } from './anchors.service.js';

interface AnchorRequestDto {
  documentId: string;
  version: number;
}

interface VerifyRequestDto {
  documentId: string;
  version: number;
  content: Record<string, unknown>;
}

@Controller('anchors')
export class AnchorsController {
  constructor(private readonly anchorsService: AnchorsService) {}

  @Post()
  async anchor(
    @Body(new ValidationPipe({ whitelist: true }))
    body: AnchorRequestDto,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.anchorsService.anchorDocument(
        body.documentId,
        body.version,
      );
    } catch (error: unknown) {
      this.handleServiceError(error);
    }
  }

  @Post('verify')
  async verify(
    @Body(new ValidationPipe({ whitelist: true }))
    body: VerifyRequestDto,
  ): Promise<Record<string, unknown>> {
    return this.anchorsService.verify(
      body.documentId,
      body.version,
      body.content,
    );
  }

  private handleServiceError(error: unknown): never {
    if (error instanceof Error && error.name === 'DuplicateAnchorError') {
      throw new HttpException(
        {
          error: {
            code: 'duplicate_anchor',
            message:
              'An anchor already exists for this document and version',
            details: {},
          },
        },
        HttpStatus.CONFLICT,
      );
    }
    throw new HttpException(
      {
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred',
          details: {},
        },
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
```
