# repair1-anchoring.controller.ts

## reasoning

```
Let me analyze the compiler errors to understand what's happening with `src/anchoring/anchoring.controller.ts`.

Looking at the error messages:
1. `src/anchoring/anchoring.service.ts(2,52): error TS2307: Cannot find module './chain-client.interface' or its corresponding type declarations.`
2. `src/anchoring/anchoring.service.ts(3,48): error TS2307: Cannot find module './anchoring.repository' or its corresponding type declarations.`
3. `src/app.module.ts(2,33): error TS2307: Cannot find module './anchoring/anchoring.module' or its corresponding type declarations.`
4. `test/anchoring.spec.ts` - multiple module not found errors

Wait, the task says "Rewrite `src/anchoring/anchoring.controller.ts` complete, fixing what these messages require of this file." But looking at the error messages, none of them directly reference `src/anchoring/anchoring.controller.ts`. The errors are about:
- Type incompatibility in `anchoring.repository.ts` (status string vs union type)
- Module not found errors in `anchoring.service.ts`, `app.module.ts`, and `test/anchoring.spec.ts`

The module not found errors suggest that files like `chain-client.interface.ts`, `anchoring.repository.ts`, `anchoring.module.ts`, `anchoring.service.ts`, `anchor-worker.service.ts`, and `anchoring.controller.ts` don't exist yet (or can't be resolved).

Wait, but the task says "Rewrite `src/anchoring/anchoring.controller.ts` complete, fixing what these messages require of this file." This is a bit confusing because the errors don't directly mention the controller file.

Let me re-read: "These are the compiler's exact messages for the whole workspace — not a summary of them"

So the errors are for the whole workspace. The task is to write `src/anchoring/anchoring.controller.ts` such that it fixes what these messages require of THIS file specifically.

Looking at the test file imports:
```
test/anchoring.spec.ts(8,37): error TS2307: Cannot find module '../src/anchoring/anchoring.controller' or its corresponding type declarations.
```

This means the test imports from `../src/anchoring/anchoring.controller`. So the controller file needs to exist and export what the test expects.

Now, the instructions say "Change nothing the messages do not name." So I need to write the controller file that:
1. Exists at `src/anchoring/anchoring.controller.ts`
2. Exports what the test expects (the test imports from it)
3. Follows the PLAN.md specifications

From the PLAN.md, the controller should:
- Be at `src/anchoring/anchoring.controller.ts`
- Have class `AnchoringController`
- Constructor takes `AnchoringService`
- Has two endpoints:
  - `POST documents/:documentId/versions/:version/anchor`
  - `POST documents/:documentId/versions/:version/verify`
- Validates that `content` is a non-null object and `version` is a positive integer; returns 400 with the standard error envelope otherwise
- Uses `AnchoringErrorFilter` or handles errors

Wait, but the PLAN says the controller validates input and calls the service. Zero business logic. And there's an error filter mentioned.

Let me look at what the test imports:
```
test/anchoring.spec.ts(8,37): error TS2307: Cannot find module '../src/anchoring/anchoring.controller' or its corresponding type declarations.
```

So the test imports something from `../src/anchoring/anchoring.controller`. I need to export `AnchoringController`.

Now, the key constraint is: "Change nothing the messages do not name." The messages that are relevant to this file are:
- `test/anchoring.spec.ts(8,37): error TS2307: Cannot find module '../src/anchoring/anchoring.controller'`

This just means the file needs to exist and export what's expected.

But wait - I also need to think about what the controller imports. The controller will import from `./anchoring.service` and potentially `./chain-client.interface`. Those modules have their own errors (can't find them), but that's not my problem to fix here - I'm only fixing what the messages require of THIS file.

Let me write the controller according to the plan:

```typescript
import { Controller, Post, Param, Body, HttpCode } from '@nestjs/common';
import { AnchoringService, AnchorResult, VerifyResult } from './anchoring.service';

@Controller()
export class AnchoringController {
  constructor(private readonly service: AnchoringService) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: Record<string, unknown> },
  ): Promise<AnchorResult> {
    // validate
    const versionNum = parseInt(version, 10);
    if (!Number.isInteger(versionNum) || versionNum <= 0) {
      throw new BadRequestException({ error: { code: 'invalid_input', message: 'version must be a positive integer', details: {} } });
    }
    if (!body || typeof body.content !== 'object' || body.content === null) {
      throw new BadRequestException({ error: { code: 'invalid_input', message: 'content must be a non-null object', details: {} } });
    }
    return this.service.anchorDocument(documentId, versionNum, body.content);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: Record<string, unknown> },
  ): Promise<VerifyResult> {
    const versionNum = parseInt(version, 10);
    if (!Number.isInteger(versionNum) || versionNum <= 0) {
      throw new BadRequestException({ error: { code: 'invalid_input', message: 'version must be a positive integer', details: {} } });
    }
    if (!body || typeof body.content !== 'object' || body.content === null) {
      throw new BadRequestException({ error: { code: 'invalid_input', message: 'content must be a non-null object', details: {} } });
    }
    return this.service.verify(documentId, versionNum, body.content);
  }
}
```

Wait, but the plan says the controller returns 400 with the standard error envelope. The standard error envelope is:
```json
{ "error": { "code": "snake_case", "message": "...", "details": {} } }
```

Using `BadRequestException` with an object as the argument will make NestJS return that object as the response body. But actually, NestJS `HttpException` constructor takes either a string or an object. If I pass an object, it uses that as the response body. But the HTTP status is 400.

Actually, looking more carefully at how NestJS handles this - `new BadRequestException({ error: ... })` will set the response body to `{ error: ... }` and status 400. That matches the error envelope.

But wait - the plan mentions an `AnchoringErrorFilter` for handling service errors. The controller itself just handles input validation (400s). The service throws `AnchoringError` which would be caught by the filter.

Let me also think about whether I need `HttpCode(200)` - the plan uses POST but doesn't specify a different status code, so default 201 for POST is fine, or I could use `@HttpCode(200)`. The plan doesn't specify, so I'll leave it as default.

Actually, re-reading the plan: "Controller validates that `content` is a non-null object and `version` is a positive integer; returns 400 with the standard error envelope otherwise."

So the controller's job is:
1. Validate input
2. Call service
3. Let errors from service propagate (handled by filter)

Let me also consider: do I need to import `BadRequestException`? Yes, from `@nestjs/common`.

Now let me think about what the test file likely imports. It imports `AnchoringController` from the controller file. The test probably instantiates it with a mock service and tests the validation logic.

Let me finalize my controller:

```typescript
import { Body, Controller, HttpCode, Param, Post, BadRequestException } from '@nestjs/common';
import { AnchoringService, AnchorResult, VerifyResult } from './anchoring.service';

@Controller()
export class AnchoringController {
  constructor(private readonly service: AnchoringService) {}

  @Post('documents/:documentId/versions/:version/anchor')
  @HttpCode(200)
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: Record<string, unknown> },
  ): Promise<AnchorResult> {
    this.validateInput(version, body);
    return this.service.anchorDocument(documentId, parseInt(version, 10), body.content!);
  }

  @Post('documents/:documentId/versions/:version/verify')
  @HttpCode(200)
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: Record<string, unknown> },
  ): Promise<VerifyResult> {
    this.validateInput(version, body);
    return this.service.verify(documentId, parseInt(version, 10), body.content!);
  }

  private validateInput(version: string, body: { content?: Record<string, unknown> }): void {
    const v = Number(version);
    if (!Number.isInteger(v) || v <= 0) {
      throw new BadRequestException({
        error: { code: 'invalid_input', message: 'version must be a positive integer', details: {} },
      });
    }
    if (body == null || typeof body.content !== 'object' || body.content === null) {
      throw new BadRequestException({
        error: { code: 'invalid_input', message: 'content must be a non-null object', details: {} },
      });
    }
  }
}
```

Hmm, but wait. The plan says the endpoint path is `documents/:documentId/versions/:version/anchor`. In NestJS, if I use `@Controller()` with no path, and `@Post('documents/:documentId/versions/:version/anchor')`, that gives the full path `/documents/:documentId/versions/:version/anchor`. That's correct.

Actually, I realize I should double-check: does the plan say anything about `@HttpCode(200)`? It doesn't explicitly. POST defaults to 201 in NestJS. Since the plan doesn't specify, I'll leave it without `@HttpCode` to keep it minimal. Actually, for an "action" endpoint like this (not creating a resource in the traditional REST sense), 200 might be more appropriate. But the plan doesn't specify, so I'll leave it as default 201 to not add anything not asked for.

Wait, actually let me reconsider. The plan says "Do exactly what the task asks. Do not create a file it does not call for, and do not improve code you were not asked to change." So I should keep it minimal.

Let me also reconsider whether I need the `!` non-null assertion. After `validateInput` throws if content is null/undefined/not an object, TypeScript won't know that `body.content` is defined. I could restructure to avoid the assertion, or use it. Let me just extract it:

```typescript
private validateInput(version: string, body: { content?: Record<string, unknown> }): number {
  const v = Number(version);
  if (!Number.isInteger(v) || v <= 0) {
    throw new BadRequestException({
      error: { code: 'invalid_input', message: 'version must be a positive integer', details: {} },
    });
  }
  if (body == null || typeof body.content !== 'object' || body.content === null) {
    throw new BadRequestException({
      error: { code: 'invalid_input', message: 'content must be a non-null object', details: {} },
    });
  }
  return v;
}
```

Then in the endpoint: `const versionNum = this.validateInput(version, body);` and use `body.content!`.

Actually, I think the simplest approach that compiles cleanly is to just use the non-null assertion after validation. Let me go with that.

One more thought: the error messages mention that `src/anchoring/anchoring.service.ts` can't find modules. This means the service file might not exist yet either. But my job is only to write the controller file. The controller imports from `./anchoring.service` - if that file doesn't exist, the controller will also have a "cannot find module" error. But the task says "fixing what these messages require of this file" - the only message that names this file is the test's import. So I just need to make sure the file exists and exports `AnchoringController`.

The imports in my controller (`./anchoring.service`) will have their own resolution issues, but those are other files' problems. The task is specifically about this file.

Let me write the final version. I'll keep it clean and aligned with the plan.
```

## reply

```typescript
import { Body, Controller, Param, Post, BadRequestException } from '@nestjs/common';
import { AnchoringService, AnchorResult, VerifyResult } from './anchoring.service';

@Controller()
export class AnchoringController {
  constructor(private readonly service: AnchoringService) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: Record<string, unknown> },
  ): Promise<AnchorResult> {
    const versionNum = this.validateInput(version, body);
    return this.service.anchorDocument(documentId, versionNum, body.content!);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: Record<string, unknown> },
  ): Promise<VerifyResult> {
    const versionNum = this.validateInput(version, body);
    return this.service.verify(documentId, versionNum, body.content!);
  }

  private validateInput(version: string, body: { content?: Record<string, unknown> }): number {
    const v = Number(version);
    if (!Number.isInteger(v) || v <= 0) {
      throw new BadRequestException({
        error: { code: 'invalid_input', message: 'version must be a positive integer', details: {} },
      });
    }
    if (body == null || typeof body.content !== 'object' || body.content === null) {
      throw new BadRequestException({
        error: { code: 'invalid_input', message: 'content must be a non-null object', details: {} },
      });
    }
    return v;
  }
}
```
