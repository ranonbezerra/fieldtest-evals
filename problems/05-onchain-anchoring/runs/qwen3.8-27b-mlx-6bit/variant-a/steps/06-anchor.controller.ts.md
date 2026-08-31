# 06-anchor.controller.ts

## reasoning

```
The task is to write the `src/anchor/anchor.controller.ts` file. Let me check what the plan specifies:

From PLAN.md section 3:
```
`src/anchor/anchor.controller.ts`
- `class AnchorController` — `@Controller('anchors')`
  - `@Post(':documentId/:version/anchor') anchor(@Param() p, @Body() body: { content: unknown }): Promise<AnchorProof>`
  - `@Post(':documentId/:version/verify') verify(@Param() p, @Body() body: { content: unknown }): Promise<VerifyResult>`
  - Validates input shape, delegates to service; zero business logic.
```

Layer conventions: the controller validates input and calls the service. Zero business logic.

So the controller should:
- Be a NestJS controller with `@Controller('anchors')`
- Have two POST endpoints:
  - `POST /anchors/:documentId/:version/anchor` — body `{ content: unknown }`
  - `POST /anchors/:documentId/:version/verify` — body `{ content: unknown }`
- Validate input shape (documentId is a string, version is a number, content exists)
- Delegate to `AnchorService.anchorDocument` and `AnchorService.verify`

Error envelope: the plan says errors use a single envelope with snake_case codes; HTTP mapping: 404 for `resource_not_found`, 409 for `duplicate_anchor`, 400 for `hash_mismatch`. But wait — the plan says the controller "validates input shape, delegates to service; zero business logic." The error envelope mapping is... hmm. Where does the error envelope get applied? The plan's manifest for the controller only says "endpoint validation and delegation to the service."

The convention says:
```
## Errors — one envelope
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

The plan says: "Errors use the single envelope with `code` in snake_case; HTTP mapping: 404 for `resource_not_found`, 409 for `duplicate_anchor`, 400 for `hash_mismatch`."

But the controller's spec is "validates input shape, delegates to service; zero business logic." Should the controller include an exception filter? The plan doesn't mention an exception filter in the file list. Let me re-check the manifest:

```
src/anchor/anchor.controller.ts | reads: src/anchor/anchor.service.ts | AnchorController endpoints
```

The manifest only names the controller file containing "AnchorController endpoints." The plan doesn't mention an exception filter file. So the controller should just be the controller class. The error envelope mapping is probably handled elsewhere (or assumed), but the plan says "do not add exports, features, or files the plan doesn't name." So I should only write the `AnchorController` class.

Actually, wait — should I include an exception filter within the same file? The plan says "do not add exports, features, or files the plan doesn't name." An exception filter would be an additional export. The manifest says the controller file contains "AnchorController endpoints." So just the controller class.

Now, what validation should the controller do? "Validates input shape" — meaning:
- `documentId` must be a non-empty string (params are strings from the route)
- `version` must be a valid integer/number
- `body` must have a `content` property (must exist)

If validation fails, throw a 400. What error? The plan's HTTP mapping only lists `resource_not_found` (404), `duplicate_anchor` (409), `hash_mismatch` (400). For invalid input, a common code would be `invalid_input` or `validation_error`. The plan doesn't name it explicitly. Hmm.

The convention says errors use a single envelope with snake_case codes as the contract. For invalid input, I need some code. The plan doesn't specify a code for validation errors. Options:
1. Use NestJS's `BadRequestException` with a message — but that doesn't match the envelope.
2. Throw an error that gets mapped to the envelope — but no filter is defined in this file.

Hmm, the instructions say: "If a symbol you need is genuinely missing from both the plan and references, do not silently guess or work around it: write the file using the most defensible interpretation and mark it at the point where it matters with a single `// ASSUMPTION: <what is unresolved>` comment."

So for the validation error code, I can use `invalid_input` with an ASSUMPTION comment. Or, more simply: the controller just validates and throws `BadRequestException`. The convention says "Errors — one envelope" with `code` as the contract. But without a filter, NestJS's default exception handling produces `{ statusCode, message, error }` for HttpException.

Let me think about what's most defensible. The plan states in section 1 (assumptions): "Errors use the single envelope with `code` in snake_case; HTTP mapping: 404 for `resource_not_found`, 409 for `duplicate_anchor`, 400 for `hash_mismatch`." This suggests the envelope is applied somewhere — probably a global filter that's out of scope for this file (the plan doesn't name such a file, and the manifest only lists what's in the plan). The service throws domain errors (`ResourceNotFoundError`, `DuplicateAnchorError`, `CanonicalizationError`). The controller throws for invalid input.

Given the file is just a controller with "zero business logic" and only "validates input shape, delegates to service," the most defensible approach is:

- Validate params/body; on failure, throw `BadRequestException` with a clear message.
- Delegate to the service.

But should I use the envelope? Since no filter exists in this file and the plan doesn't name one, using NestJS's `BadRequestException` is standard. But the convention says one envelope... The envelope mapping probably happens in a filter (not part of this task). For validation errors, I could throw a `BadRequestException` with a message describing the problem.

Hmm, but actually, let me reconsider. Maybe I should keep it minimal and defensible: use `BadRequestException` for shape validation failures. That's the standard NestJS way, and it keeps the controller free of business logic. The envelope concern is handled at a higher level (out of scope here).

Alternatively, I could define validation that returns a 400 with an envelope-shaped message. But constructing the envelope in the controller would be duplicating what a filter should do, and the plan doesn't name an envelope helper.

Let me check the reference workspace — I only have `anchor.service.ts` as a read-only reference. The controller file doesn't exist in the reference (that's what I'm writing). So I need to write it fresh.

Imports needed:
- `@Controller`, `@Post`, `@Param`, `@Body` from `@nestjs/common`
- `AnchorService`, `AnchorProof`, `VerifyResult` from `./anchor.service`

Validation logic:
- `documentId`: string from route param; check non-empty.
- `version`: parse to integer; check it's a valid integer (and maybe >= 1? The plan uses Int for version. Let me just check it parses as a finite integer).
- `body`: must be an object with a `content` property that is not undefined. The plan says body: `{ content: unknown }`. So check `body` is an object and `'content' in body`.

Should I validate that content is not null? `unknown` allows anything; canonicalization would throw on non-serializable stuff. But content `null` is JSON-serializable (canonical form "null"). Hmm, the plan says `hashContent` throws `CanonicalizationError` on non-serializable input (e.g. circular references). `null` is serializable. But is anchoring `null` content meaningful? The plan doesn't say to reject it. "Do not add features the plan doesn't name." So I'll only check that `content` is present (not undefined). Actually — in a JSON body, you can't have `undefined`; the key is either missing or has a value. So check that body is an object and has a `content` key.

Let me write the validation:

```typescript
private parseVersion(raw: string): number {
  const version = Number(raw);
  if (!Number.isInteger(version)) {
    throw new BadRequestException(`version must be an integer, got "${raw}"`);
  }
  return version;
}
```

Wait — "zero business logic" — is parameter parsing business logic? No, it's input validation, which the plan explicitly assigns to the controller ("validates input shape").

Now, what about `documentId`? Route params are always strings. Check non-empty: `if (!documentId) throw new BadRequestException(...)`. The route `:documentId` won't match an empty segment, so this is almost a no-op, but it's harmless defensive validation.

Body validation:

```typescript
private extractContent(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('content' in body)) {
    throw new BadRequestException('body must be an object with a "content" field');
  }
  return (body as { content: unknown }).content;
}
```

Hmm, but the plan's signature says `@Body() body: { content: unknown }`. In NestJS, the body is typed as declared but at runtime it's whatever was sent. Validating the shape is what "validates input shape" means.

Now, error codes: should validation errors use the envelope? Let me reconsider the whole thing. The convention block is part of "the codebase" conventions that always hold: "Errors — one envelope... `code` is snake_case and is the contract." So all errors from the API should use that envelope. The plan maps specific codes to HTTP statuses. For validation, a defensible code is `invalid_input`.

But how does the envelope get produced? Without a filter in this file, I'd have to construct it manually. But the plan says the controller has zero business logic and only validates + delegates. Adding envelope construction would be adding a feature not named...

Hmm, this is genuinely ambiguous. The instructions say to mark with an ASSUMPTION comment where something is genuinely missing. Let me think about what's most defensible:

Option A: Throw `BadRequestException` (NestJS standard). The envelope is handled by a global filter that's out of scope for this file (the plan doesn't name one, and the manifest only lists what's in the plan). This keeps the controller minimal and matches "validates input shape, delegates to service."

Option B: Throw a custom error with envelope shape. But no filter exists, and NestJS won't serialize it as the envelope by default — a plain Error becomes 500. So Option B without a filter is broken.

Option C: Return a 400 response with the envelope manually using `@Res` — that's ugly and adds complexity not in the plan.

Option A is most defensible: use `BadRequestException` for validation failures. Domain errors from the service (`ResourceNotFoundError`, etc.) propagate; a filter (out of scope) maps them. Actually wait — without a filter, `ResourceNotFoundError` (a plain Error) would become 500 in NestJS. But that's a wiring concern for `app.module.ts`/main.ts, which isn't part of this task. The plan's manifest doesn't include main.ts changes... The plan says "in this build, `ChainClient` (bound to `FakeChainClient`)." The plan is for the whole feature, but I'm only writing the controller. So I should just write the controller per spec and not worry about global filters.

Actually, let me reconsider: should I add an ASSUMPTION comment about the validation error code/envelope? The instructions say to mark with an ASSUMPTION when a symbol is genuinely missing. The envelope for validation errors is a genuine gap: the plan names codes for `resource_not_found`, `duplicate_anchor`, `hash_mismatch` but not for invalid input. If I use `BadRequestException`, no code symbol is needed — it's a NestJS built-in. So I'm not guessing a missing symbol; I'm using the framework's standard. I think that's clean enough without an ASSUMPTION comment. But hmm, one could argue the convention demands the envelope...

Let me weigh: the task says "implement exactly what the plan specifies for this file." The plan specifies: two endpoints, validate input shape, delegate to service, zero business logic. Using `BadRequestException` for invalid shape is the standard NestJS way to express "400" and matches the plan's HTTP mapping intent (400 for client errors). I'll go with that. No ASSUMPTION comment needed since I'm not inventing a symbol — `BadRequestException` is from `@nestjs/common`, which the plan implicitly uses (it specifies NestJS decorators).

Hmm, but wait. Let me reconsider whether I should include the envelope in the message... No, keep it simple.

Now, about returning `VerifyResult` — the plan says verify returns either proof or mismatch report. The plan maps 400 for `hash_mismatch`... interesting — does that mean a mismatch should be a 400 error? But the service returns `{ ok: false, mismatch }` as a result, not throwing. The plan's `verify` signature returns `Promise<VerifyResult>`, and the endpoint returns `Promise<VerifyResult>`. So the mismatch is a 200 response with `{ ok: false, ... }`. The "400 for hash_mismatch" mapping might be aspirational or for a different design; but the service (shown read-only) returns the result, and the controller delegates. I must not add business logic to the controller like "if !ok throw 400" — that would be interpreting the plan's HTTP mapping in a way that contradicts the service contract shown. The read-only service file is authoritative for behavior: `verify` returns `VerifyResult`. So the controller just returns it.

Similarly, `anchorDocument` returns `AnchorProof` (or throws `DuplicateAnchorError`/`CanonicalizationError`). The controller just delegates.

Now, let me also consider: should the controller catch service errors and map them to HTTP? The plan says "zero business logic" and "delegates to the service." Error mapping (envelope + status) is not business logic per se, but the plan doesn't name any mapping in the controller, and the manifest says "endpoint validation and delegation to the service." So no try/catch mapping. Errors propagate.

Let me write the file:

```typescript
import { BadRequestException, Body, Controller, Post, Param } from '@nestjs/common';
import type { AnchorProof, VerifyResult } from './anchor.service';
import { AnchorService } from './anchor.service';

interface AnchorRequest {
  content: unknown;
}

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchors: AnchorService) {}

  @Post(':documentId/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') versionRaw: string,
    @Body() body: AnchorRequest,
  ): Promise<AnchorProof> {
    const version = this.parseVersion(versionRaw);
    const content = this.extractContent(body);
    return this.anchors.anchorDocument(documentId, version, content);
  }

  @Post(':documentId/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') versionRaw: string,
    @Body() body: AnchorRequest,
  ): Promise<VerifyResult> {
    const version = this.parseVersion(versionRaw);
    const content = this.extractContent(body);
    return this.anchors.verify(documentId, version, content);
  }

  private parseVersion(raw: string): number {
    const version = Number(raw);
    if (!Number.isInteger(version)) {
      throw new BadRequestException(`version must be an integer, received "${raw}"`);
    }
    return version;
  }

  private extractContent(body: unknown): unknown {
    if (typeof body !== 'object' || body === null || !('content' in body)) {
      throw new BadRequestException('request body must be an object with a "content" field');
    }
    return (body as AnchorRequest).content;
  }
}
```

Wait — the plan's signature: `anchor(@Param() p, @Body() body: { content: unknown })`. It uses a single `@Param() p` object. I could match that style:

```typescript
@Post(':documentId/:version/anchor')
async anchor(@Param() params: { documentId: string; version: string }, @Body() body: AnchorRequest): Promise<AnchorProof>
```

Either is fine. The plan's shorthand `@Param() p` suggests passing the whole params object. Let me match the plan more closely and use `@Param() params`.

Should I also validate that `documentId` is non-empty? Route params can't be empty (Express route matching requires a non-empty segment for `:documentId`). But defensively, checking is cheap. Hmm, "do exactly what the task asks" — validating input shape includes ensuring documentId is a usable string. I'll include a small check for non-empty string. Actually, is that over-engineering? The plan says "validates input shape." documentId's shape is "string" — guaranteed by the framework. I think a minimal check is fine and defensible; but adding too many checks risks "adding features." Let me keep it: non-empty check for documentId, integer check for version, shape check for body. Those are the three input pieces.

Hmm, one more consideration: should `version` be >= 1? The plan uses Int for version; clinical reports are probably versioned from 1. But the plan doesn't specify a lower bound. I won't add one — "do not add features the plan doesn't name." Just integer check.

Now, about `content` being present: what if the client sends `{ "content": null }`? `'content' in body` is true, and content = null. Then `hashContent(null)` → canonicalize(null) → "null" → hash. Is that OK? The plan doesn't forbid it. Fine.

Also: should I use `class-validator` DTOs? The plan doesn't name a DTO class or `ValidationPipe`. Using `@Body() body: { content: unknown }` with manual checks matches the plan's signature. I'll avoid class-validator since it's not in the plan.

Now, about naming: the plan says `@Controller('anchors')` — kebab-case plural endpoint base. Good.

Method names: `anchor` and `verify` per the plan.

Service injection name: `AnchorService`. I'll inject as `private readonly anchorService: AnchorService`.

Let me also double-check the import style in the reference service file: it uses `import type { ... } from './anchor.repository';` and `import { DuplicateAnchorError } from './anchor.repository';` — separate type-only imports. Good, I'll follow that style: `import type { AnchorProof, VerifyResult } from './anchor.service';` and `import { AnchorService } from './anchor.service';`.

ESM, strict TS. `private readonly` in constructor params — fine.

One more thought on the error envelope: the convention says all errors use the envelope. If my `BadRequestException` propagates without a filter, the response won't be the envelope. But as I reasoned, the filter is out of scope for this file, and the plan doesn't name one. The most defensible reading: the controller uses standard NestJS exceptions for validation; envelope mapping is a cross-cutting concern handled at the app level (out of scope). I'm fairly confident this is right.

Actually, wait. Let me reconsider one more time whether to add an ASSUMPTION comment. The instructions: "If a symbol you need is genuinely missing from both the plan and references, do not silently guess or work around it: write the file using the most defensible interpretation and mark it at the point where it matters with a single `// ASSUMPTION: <what is unresolved>` comment."

Do I need any missing symbol? `BadRequestException` exists in `@nestjs/common`. The plan specifies NestJS + decorators. So no missing symbol. The envelope code for validation errors is a design gap, but I'm not inventing a code — I'm using the framework's exception. I don't think an ASSUMPTION comment is needed. Hmm, but one could argue the choice of `BadRequestException` vs. a custom envelope error is an unresolved point... The plan explicitly says "400 for `hash_mismatch`" and lists HTTP mappings, implying 400 is the client-error status. `BadRequestException` = 400. That's consistent. I'll proceed without an ASSUMPTION comment.

Hmm, actually let me reconsider once more. The convention is strong: "Errors — one envelope ... `code` is snake_case and is the contract." If I throw `BadRequestException('...')`, the response body is `{ statusCode: 400, message: '...', error: 'Bad Request' }` — not the envelope. That violates the codebase convention... unless a global filter transforms it, which isn't in the plan. But the plan's own HTTP mapping (404/409/400) implies a filter exists somewhere that maps domain errors to status + code. The plan's manifest doesn't include it, but the plan also says "no hand-written migration files here" and other things are noted as out of scope. The controller spec is explicit: "validates input shape, delegates to service; zero business logic."

Given the constraint "implement exactly what the plan specifies for this file. Do not add exports, features, or files the plan doesn't name," adding an exception filter class in this file would add an export not named. So `BadRequestException` it is.

Alternatively, I could throw a `BadRequestException` with a message that includes the code... no, that's hacky.

Final answer: just the controller class with two endpoints and private validation helpers.

Let me also think about whether `anchor` should return `Promise<AnchorProof>` — yes, per the plan. And `verify` returns `Promise<VerifyResult>` — yes.

Let me also double-check the route: `@Post(':documentId/:version/anchor')` → POST `/anchors/:documentId/:version/anchor`. The plan says endpoints are kebab-case plural — `anchors` is the base; the sub-paths `anchor`/`verify` are action names per the plan. Good.

Let me write the final file:

```typescript
import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import type { AnchorProof, VerifyResult } from './anchor.service';
import { AnchorService } from './anchor.service';

interface AnchorRequestBody {
  content: unknown;
}

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version/anchor')
  async anchor(
    @Param() params: { documentId: string; version: string },
    @Body() body: AnchorRequestBody,
  ): Promise<AnchorProof> {
    const version = this.parseVersion(params.version);
    const content = this.extractContent(body);
    return this.anchorService.anchorDocument(params.documentId, version, content);
  }

  @Post(':documentId/:version/verify')
  async verify(
    @Param() params: { documentId: string; version: string },
    @Body() body: AnchorRequestBody,
  ): Promise<VerifyResult> {
    const version = this.parseVersion(params.version);
    const content = this.extractContent(body);
    return this.anchorService.verify(params.documentId, version, content);
  }

  private parseVersion(raw: string): number {
    const version = Number(raw);
    if (!Number.isInteger(version)) {
      throw new BadRequestException(`version must be an integer, received "${raw}"`);
    }
    return version;
  }

  private extractContent(body: unknown): unknown {
    if (typeof body !== 'object' || body === null || !('content' in body)) {
      throw new BadRequestException('request body must be an object with a "content" field');
    }
    return (body as AnchorRequestBody).content;
  }
}
```

Wait, should I validate that documentId is non-empty? Let me add it to be thorough about "validates input shape":

```typescript
private assertDocumentId(documentId: string): void {
  if (typeof documentId !== 'string' || documentId.length === 0) {
    throw new BadRequestException('documentId must be a non-empty string');
  }
}
```

Hmm, is that necessary? Route params are always non-empty strings. Adding it is defensive but arguably part of validating input shape. I'll include a combined validation to keep the controller tidy. Actually, let me keep it minimal but complete: validate documentId non-empty, version integer, body shape. Three small private helpers, or inline. I think inline in each endpoint would duplicate; a small private method is cleaner.

Actually, let me structure it as one `validate` per endpoint... no, two small helpers is fine. Let me finalize:

```typescript
import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import type { AnchorProof, VerifyResult } from './anchor.service';
import { AnchorService } from './anchor.service';

interface AnchorRequestBody {
  content: unknown;
}

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version/anchor')
  async anchor(
    @Param() params: { documentId: string; version: string },
    @Body() body: AnchorRequestBody,
  ): Promise<AnchorProof> {
    const documentId = this.requireDocumentId(params.documentId);
    const version = this.requireVersion(params.version);
    const content = this.requireContent(body);
    return this.anchorService.anchorDocument(documentId, version, content);
  }

  @Post(':documentId/:version/verify')
  async verify(
    @Param() params: { documentId: string; version: string },
    @Body() body: AnchorRequestBody,
  ): Promise<VerifyResult> {
    const documentId = this.requireDocumentId(params.documentId);
    const version = this.requireVersion(params.version);
    const content = this.requireContent(body);
    return this.anchorService.verify(documentId, version, content);
  }

  private requireDocumentId(documentId: string): string {
    if (typeof documentId !== 'string' || documentId.length === 0) {
      throw new BadRequestException('documentId must be a non-empty string');
    }
    return documentId;
  }

  private requireVersion(raw: string): number {
    const version = Number(raw);
    if (!Number.isInteger(version)) {
      throw new BadRequestException(`version must be an integer, received "${raw}"`);
    }
    return version;
  }

  private requireContent(body: unknown): unknown {
    if (typeof body !== 'object' || body === null || !('content' in body)) {
      throw new BadRequestException('request body must be an object with a "content" field');
    }
    return (body as AnchorRequestBody).content;
  }
}
```

This looks good. Comments in English — I have none, which is fine ("code and comments in English" — no requirement to have comments).

One concern: `Number(raw)` accepts things like "1e2" → 100, which is an integer. "1.5" → not integer → rejected. " 3 " → Number(" 3 ") = 3, accepted (trims whitespace). Fine.

Also `Number('')` = 0 — but empty version param can't happen via the route.

Should version accept negative numbers? `Number('-1')` = -1, integer → accepted. The plan doesn't restrict. Fine.

Double-checking strict TS: `params` is typed as `{ documentId: string; version: string }` — NestJS passes an object with those keys. OK.

`body as AnchorRequestBody` after the `'content' in body` check — safe.

I think this is complete and matches the plan. No extra exports (just `AnchorController` is exported; `AnchorRequestBody` interface is not exported — good, the plan doesn't name it as an export; it's a local type).

Wait, is it OK to have a local interface not named in the plan? "Do not add exports, features, or files the plan doesn't name." A local (non-exported) helper type for typing the body is not an added export or feature — it's implementation detail. The plan itself types the body as `{ content: unknown }`. I could just inline `{ content: unknown }` and skip the interface entirely. That would be even closer to the plan. Let me do that — use `@Body() body: { content: unknown }` directly, and in `requireContent` take `unknown`. That eliminates the extra type entirely.

Final:

```typescript
import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import type { AnchorProof, VerifyResult } from './anchor.service';
import { AnchorService } from './anchor.service';

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version/anchor')
  async anchor(
    @Param() params: { documentId: string; version: string },
    @Body() body: { content: unknown },
  ): Promise<AnchorProof> {
    const documentId = this.requireDocumentId(params.documentId);
    const version = this.requireVersion(params.version);
    const content = this.requireContent(body);
    return this.anchorService.anchorDocument(documentId, version, content);
  }

  @Post(':documentId/:version/verify')
  async verify(
    @Param() params: { documentId: string; version: string },
    @Body() body: { content: unknown },
  ): Promise<VerifyResult> {
    const documentId = this.requireDocumentId(params.documentId);
    const version = this.requireVersion(params.version);
    const content = this.requireContent(body);
    return this.anchorService.verify(documentId, version, content);
  }

  private requireDocumentId(documentId: string): string {
    if (typeof documentId !== 'string' || documentId.length === 0) {
      throw new BadRequestException('documentId must be a non-empty string');
    }
    return documentId;
  }

  private requireVersion(raw: string): number {
    const version = Number(raw);
    if (!Number.isInteger(version)) {
      throw new BadRequestException(`version must be an integer, received "${raw}"`);
    }
    return version;
  }

  private requireContent(body: unknown): unknown {
    if (typeof body !== 'object' || body === null || !('content' in body)) {
      throw new BadRequestException('request body must be an object with a "content" field');
    }
    return (body as { content: unknown }).content;
  }
}
```

This is my final answer. The reply should be just the fenced block, nothing else.
```

## reply

```typescript
import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import type { AnchorProof, VerifyResult } from './anchor.service';
import { AnchorService } from './anchor.service';

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version/anchor')
  async anchor(
    @Param() params: { documentId: string; version: string },
    @Body() body: { content: unknown },
  ): Promise<AnchorProof> {
    const documentId = this.requireDocumentId(params.documentId);
    const version = this.requireVersion(params.version);
    const content = this.requireContent(body);
    return this.anchorService.anchorDocument(documentId, version, content);
  }

  @Post(':documentId/:version/verify')
  async verify(
    @Param() params: { documentId: string; version: string },
    @Body() body: { content: unknown },
  ): Promise<VerifyResult> {
    const documentId = this.requireDocumentId(params.documentId);
    const version = this.requireVersion(params.version);
    const content = this.requireContent(body);
    return this.anchorService.verify(documentId, version, content);
  }

  private requireDocumentId(documentId: string): string {
    if (typeof documentId !== 'string' || documentId.length === 0) {
      throw new BadRequestException('documentId must be a non-empty string');
    }
    return documentId;
  }

  private requireVersion(raw: string): number {
    const version = Number(raw);
    if (!Number.isInteger(version)) {
      throw new BadRequestException(`version must be an integer, received "${raw}"`);
    }
    return version;
  }

  private requireContent(body: unknown): unknown {
    if (typeof body !== 'object' || body === null || !('content' in body)) {
      throw new BadRequestException('request body must be an object with a "content" field');
    }
    return (body as { content: unknown }).content;
  }
}
```
