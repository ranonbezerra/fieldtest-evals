# repair2-anchoring.controller.ts

## reasoning

```
The error for `src/anchoring/anchoring.controller.ts` is:

```
src/anchoring/anchoring.controller.ts(2,62): error TS2307: Cannot find module './anchoring.service' or its corresponding type declarations.
```

This means the file has an import from `./anchoring.service` that can't be resolved. The file itself exists (it's being compiled), but the module it imports doesn't exist yet.

Wait — but the task says "Rewrite `src/anchoring/anchoring.controller.ts` complete, fixing what these messages require of this file."

The only error naming this file is line 2, column 62: `Cannot find module './anchoring.service'`. 

The issue is that the controller imports from `./anchoring.service` but that file doesn't exist (or isn't resolving). However, the task says I should only change `src/anchoring/anchoring.controller.ts` and fix what the messages require of *this* file.

The error is that `./anchoring.service` can't be found. The other files have similar errors — they all reference each other but none of the modules resolve. This suggests the files don't actually exist on disk yet, or they're empty/corrupt.

But I'm only asked to rewrite `src/anchoring/anchoring.controller.ts`. The error says it can't find `./anchoring.service`. Since I can only modify this one file, and the plan says the controller imports from `./anchoring.service`, I need to keep that import. The file `anchoring.service.ts` presumably needs to be created separately — but I'm told to change nothing the messages don't name, and only rewrite this one file.

So what can I do to fix the error in THIS file? The error is that `./anchoring.service` can't be found. Since I can only modify this file, and the module genuinely doesn't exist on disk, there's not much I can do to make the import resolve without creating the other file.

Wait, let me re-read: "Rewrite `src/anchoring/anchoring.controller.ts` complete, fixing what these messages require of this file."

The message says: `Cannot find module './anchoring.service' or its corresponding type declarations.`

This means the file `src/anchoring/anchoring.service.ts` doesn't exist. Since I'm only allowed to modify `anchoring.controller.ts`, and the import is required by the plan, I should keep the import as-is. The error will be resolved when `anchoring.service.ts` is created.

But wait — maybe the issue is something else. Maybe the file exists but has a different name or extension. Let me think about what "fixing what these messages require of this file" means.

Actually, I think the task is simpler than I'm making it. The compiler errors show that `anchoring.controller.ts` imports from `./anchoring.service` which doesn't exist. The fix for THIS file is just to have the correct import statement that will resolve once `anchoring.service.ts` is created. Since I'm only writing this file, I should write it correctly with the proper import, and the error will go away once the other files are created.

So I just need to write the complete `src/anchoring/anchoring.controller.ts` according to the plan, with the correct import from `./anchoring.service`. The error will be resolved when all files are in place.

Let me write the controller per the plan:

- `AnchoringController` with constructor taking `AnchoringService`
- `@Post('documents/:documentId/versions/:version/anchor')` — validates input, calls service
- `@Post('documents/:documentId/versions/:version/verify')` — validates input, calls service
- Controller validates `content` is a non-null object and `version` is a positive integer; returns 400 with error envelope otherwise.

Per the plan, the controller:
- Validates input
- Calls the service
- Zero business logic

Let me also think about what imports are needed:
- `@Controller`, `@Post`, `@Param`, `@Body` from `@nestjs/common`
- `AnchoringService`, `AnchorResult`, `VerifyResult` from `./anchoring.service`

For error handling — the plan says there's an `AnchoringErrorFilter`. But that would be in a separate file. The controller itself just needs to validate and call the service.

Wait, looking more carefully at the plan: "Controller validates that `content` is a non-null object and `version` is a positive integer; returns 400 with the standard error envelope otherwise."

So for validation failures, the controller itself returns the 400. For service-level errors (duplicate_anchor, resource_not_found, broadcast_failed), the error filter handles those.

Let me write this:

```typescript
import { Controller, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AnchoringService, AnchorResult, VerifyResult } from './anchoring.service';

@Controller()
export class AnchoringController {
  constructor(private readonly service: AnchoringService) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<AnchorResult> {
    const validated = this.validate(version, body?.content);
    return this.service.anchorDocument(documentId, validated.version, validated.content);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<VerifyResult> {
    const validated = this.validate(version, body?.content);
    return this.service.verify(documentId, validated.version, validated.content);
  }

  private validate(version: string, content: unknown): { version: number; content: Record<string, unknown> } {
    const num = Number(version);
    if (!Number.isInteger(num) || num < 1) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: `version must be a positive integer, got "${version}"`, details: { version } } },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (content === null || content === undefined || typeof content !== 'object' || Array.isArray(content)) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: 'content must be a non-null object', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
    return { version: num, content: content as Record<string, unknown> };
  }
}
```

This looks good. The import from `./anchoring.service` is correct per the plan. When that file exists, the error will resolve.

Let me double-check: the plan says the controller has zero business logic — it validates input and calls the service. The validation of version being a positive integer and content being a non-null object is input validation, which the plan explicitly assigns to the controller. Good.

I think this is complete and correct.
```

## reply

```typescript
import { Controller, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AnchoringService, AnchorResult, VerifyResult } from './anchoring.service';

@Controller()
export class AnchoringController {
  constructor(private readonly service: AnchoringService) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<AnchorResult> {
    const validated = this.validate(version, body?.content);
    return this.service.anchorDocument(documentId, validated.version, validated.content);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<VerifyResult> {
    const validated = this.validate(version, body?.content);
    return this.service.verify(documentId, validated.version, validated.content);
  }

  private validate(
    version: string,
    content: unknown,
  ): { version: number; content: Record<string, unknown> } {
    const num = Number(version);
    if (!Number.isInteger(num) || num < 1) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: `version must be a positive integer, got "${version}"`, details: { version } } },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (content === null || content === undefined || typeof content !== 'object' || Array.isArray(content)) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: 'content must be a non-null object', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
    return { version: num, content: content as Record<string, unknown> };
  }
}
```
