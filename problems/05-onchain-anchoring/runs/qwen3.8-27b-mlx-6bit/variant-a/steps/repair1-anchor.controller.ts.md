# repair1-anchor.controller.ts

## reasoning

```
Let me analyze the compiler errors related to `src/anchor/anchor.controller.ts`.

Looking at the error list:
1. `src/anchor/anchor.module.ts(2,34): error TS2307: Cannot find module './anchor.controller'` — this references the controller, but the task says to fix `anchor.controller.ts` for what these messages require of this file.
2. `test/anchor.controller.spec.ts(3,34): error TS2307: Cannot find module '../src/anchor/anchor.controller'` — the test imports the controller.

Wait, but there's no error directly pointing at `src/anchor/anchor.controller.ts` itself in the list. Let me re-read.

The first line is cut off: "ule './anchor.service' or its corresponding type declarations." — this is probably from `src/anchor/anchor.controller.ts` itself: `Cannot find module './anchor.service' or its corresponding type declarations.` The message is truncated at the beginning. So the controller has an import of `./anchor.service` that fails due to TS2835 (relative import paths need explicit file extensions) — no wait, the truncated message is TS2307 "Cannot find module".

Actually the first line: `ule './anchor.service' or its corresponding type declarations.` — this is the tail of "Cannot find module './anchor.service' or its corresponding type declarations." The file prefix is cut off, but presumably it's `src/anchor/anchor.controller.ts(1,XX): error TS2307: Cannot find module './anchor.service'...`.

So the errors that pertain to `src/anchor/anchor.controller.ts`:
- TS2307: Cannot find module './anchor.service' (line 1, probably)

The task: "Rewrite `src/anchor/anchor.controller.ts` in full, fixing what these messages require of this file."

So I need to write a controller that:
1. Imports `./anchor.service.js` (with explicit `.js` extension, since moduleResolution is node16/nodenext).
2. Follows the plan: `@Controller('anchors')`, endpoints `@Post(':documentId/:version/anchor')` and `@Post(':documentId/:version/verify')`, validate input shape, delegate to service, zero business logic.

Also the test file `test/anchor.controller.spec.ts` imports:
- Line 3: `../src/anchor/anchor.controller` (fails with TS2307 — hmm, but that's a test file issue; the task says to fix only what these messages require of this file, i.e., the controller).
- Line 8: `../src/anchor/anchor.service`

Wait, but the test file's errors are TS2307 "Cannot find module '../src/anchor/anchor.controller'" — that's because the controller file itself doesn't compile (it has errors, so TS can't resolve its types? No — TS2307 means the module file doesn't exist or can't be found). Hmm.

Actually, TS2307 "Cannot find module" happens when the file doesn't exist at all, or when import resolution fails. If `src/anchor/anchor.controller.ts` exists but has compile errors, the import from the test would still resolve (the module exists), and you'd get errors about the types it exports, not TS2307.

Hmm, wait. Actually, if the controller file imports `./anchor.service` without extension and moduleResolution is nodenext, then `./anchor.service` doesn't resolve to a file, so that import fails. But the controller module itself exists as `anchor.controller.ts`. Importing `../src/anchor/anchor.controller` from the test should resolve to `anchor.controller.ts`...

Unless — wait. The task says "`src/anchor/anchor.controller.ts` doesn't compile". Maybe the file doesn't exist? The errors say "Cannot find module './anchor.controller'" from anchor.module.ts and "Cannot find module '../src/anchor/anchor.controller'" from the test. If the file existed, those would resolve fine (TS2307 is about module resolution, not about type errors inside the module).

Hmm, but actually — in nodenext resolution, `import ... from './anchor.controller'` (without extension) fails with TS2835/TS2307. The module.ts error is TS2307 for './anchor.controller' — consistent with missing extension in the import path in module.ts. But the task says to change nothing the messages don't name, and only rewrite the controller file. So module.ts's errors remain (they're about module.ts's own imports, which I can't fix from the controller file).

Wait, let me re-read: "Change nothing the messages don't name." And "Rewrite `src/anchor/anchor.controller.ts` in full, fixing what these messages require of this file."

So I only produce the controller file. The errors in other files (module.ts, repository.ts, service.ts, chain.ts, tests) are out of scope — presumably other tasks fix them. My job: make the controller correct per the plan and per what the messages require of it.

What do the messages require of the controller file?
- The truncated first line: `src/anchor/anchor.controller.ts(?)... Cannot find module './anchor.service'` — so the controller currently imports `./anchor.service` and it fails. To fix within this file, I import with explicit extension: `./anchor.service.js`.

Hmm wait, but actually — does the truncated line belong to the controller? The list starts with "ule './anchor.service' or its corresponding type declarations." and then continues with `src/anchor/anchor.module.ts(2,34)`. The lines seem to be in file order: the first (truncated) line is from a file that sorts before `src/anchor/anchor.module.ts`... Files: `src/anchor/anchor.controller.ts`, `src/anchor/anchor.module.ts`, `src/anchor/anchor.repository.ts`, `src/anchor/anchor.service.ts`, `src/anchor/chain.ts`, `test/...`. In alphabetical order, `anchor.controller.ts` < `anchor.module.ts`. So yes, the truncated first line is from `src/anchor/anchor.controller.ts`: `Cannot find module './anchor.service' or its corresponding type declarations.`

So the controller's only error is the import of `./anchor.service` (TS2307, likely due to missing `.js` extension under nodenext).

Therefore the fix: rewrite the controller with `import { AnchorService } from './anchor.service.js';` and proper NestJS decorators.

Now, what should the controller contain per the plan?

From PLAN.md section 3:
```
`src/anchor/anchor.controller.ts`
- `class AnchorController` — `@Controller('anchors')`
  - `@Post(':documentId/:version/anchor') anchor(@Param() p, @Body() body: { content: unknown }): Promise<AnchorProof>`
  - `@Post(':documentId/:version/verify') verify(@Param() p, @Body() body: { content: unknown }): Promise<VerifyResult>`
  - Validate input shape, delegate to service; zero business logic.
```

Also from the plan's assumptions: "Errors use a single envelope with `code` in snake_case; HTTP mapping: 404 for `resource_not_found`, 409 for `duplicate_anchor`, 400 for `hash_mismatch`."

Hmm, so error handling — where does the envelope come from? The plan says errors use a single envelope. Typically in NestJS you'd have exception filters. But the plan doesn't specify an exception filter file. The manifest only lists: schema.prisma, canonical.ts, chain.ts, anchor.repository.ts, anchor.service.ts, anchor.controller.ts, anchor.module.ts, and the three test files. No exception filter file.

So how do errors get the envelope? Options:
1. The controller catches service errors and returns the envelope directly (with appropriate HTTP status).
2. A global exception filter — but that's not in the manifest, and I can't create files not requested... well actually the task says "do not create files it doesn't ask for" — and here I'm only asked to rewrite the controller file. So no new files.

Given that the error envelope is part of the contract and the controller is the HTTP boundary, the controller should map service exceptions to the envelope with status codes. The plan says "controller validates input and calls service. Zero business logic." Mapping exceptions to HTTP error envelopes is arguably presentation, not business logic.

But wait — the test file `test/anchor.controller.spec.ts` imports the controller and service. Its errors are only TS2307 for module resolution (lines 3 and 8). I can't see the test's contents, so I have to guess at what it expects. Hmm. The instructions say: "If a message references a shape you can't see, don't guess repeatedly — say so in an `// ASSUMPTION:` line."

Let me think about what the controller spec probably tests: "endpoint validation and delegation to service" (per manifest). Probably:
- POST /anchors/:documentId/:version/anchor with body {content} → calls service.anchorDocument and returns proof.
- POST /anchors/:documentId/:version/verify → calls service.verify and returns result.
- Validation: missing content → 400? Invalid version (non-integer) → 400?

Since I can't see the test, I should write a controller that is reasonable and follows the plan. Key requirements:
- `@Controller('anchors')`
- Two POST endpoints with kebab-case plural routes: `:documentId/:version/anchor` and `:documentId/:version/verify`.

Wait — "Endpoint: kebab-case, plural." The plan explicitly specifies `@Post(':documentId/:version/anchor')`. Hmm, "anchor" and "verify" are verbs here... The plan says exactly these routes, so I follow the plan.

Validation: "Validate input shape, delegate to service; zero business logic." So:
- `documentId` must be a non-empty string (params are always strings, but could be empty).
- `version` must parse as a positive integer? The service takes `version: number`. NestJS params come in as strings, so the controller must convert. That's input validation/coercion — allowed at controller level.
- `body.content` must be present (and probably an object? The plan says content is a structured JSON object; `hashContent(value: unknown)`).

Now, how does the controller return errors? Per the envelope contract:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

The service throws `DuplicateAnchorError`, `ResourceNotFoundError`, `CanonicalizationError`. The controller should catch these and return the envelope with status:
- `resource_not_found` → 404
- `duplicate_anchor` → 409
- canonicalization → 400 (plan says 400 for `hash_mismatch`... hmm, that's for verify mismatch? Actually in the plan, verify returns a mismatch report as a result `{ok:false, mismatch}` — not an error. So what gets 400? "HTTP mapping: 404 for `resource_not_found`, 409 for `duplicate_anchor`, 400 for `hash_mismatch`." Hmm, maybe canonicalization errors map to 400 with code like `invalid_content`. The plan's assumption list only gives those three mappings. For canonicalization errors, a 400 with code `invalid_content` seems reasonable.

But wait — should the controller be doing this mapping, or is there a global filter? Since no filter file exists in the manifest and I can only write the controller, I'll do the mapping in the controller via try/catch. This keeps "zero business logic" — the mapping is presentation.

Alternatively, throw NestJS HttpException subclasses with the envelope as response body. E.g., `throw new NotFoundException({ error: {...} })`. That's cleaner NestJS style. Either works. Let me use HttpException with the envelope body — that way the response is exactly the envelope and status is set.

Hmm, but actually, let me reconsider. Maybe simpler and more robust: catch errors in each handler and return the envelope with `@HttpCode`. But POST defaults to 201. The success response for anchor is a proof — what status? Probably 200 or 201. The plan doesn't specify. NestJS POST defaults to 201 Created. For anchor (creating an anchor record), 201 is appropriate. For verify, it's a read — maybe 200. I'll set `@HttpCode(201)` for anchor and `@HttpCode(200)` for verify to be explicit.

Hmm, but the test... I can't see it. If the test uses `supertest` to check status codes, guessing wrong would fail. But I can't see the test; the instructions acknowledge this: "If a message references a shape you can't see, don't guess repeatedly — say so in an `// ASSUMPTION:` line." The compiler messages don't reference the controller's response shape — they only reference the failed module import. So I have latitude on details, and I should note assumptions where I'm guessing at invisible shapes.

Let me keep it simple and faithful to the plan:

```typescript
import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  AnchorService,
  AnchorProof,
  VerifyResult,
} from './anchor.service.js';

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchors: AnchorService) {}

  @Post(':documentId/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<AnchorProof> {
    ...validate...
    return this.anchors.anchorDocument(documentId, parsedVersion, body.content);
  }

  @Post(':documentId/:version/verify')
  async verify(...) { ... }
}
```

Error mapping: try/catch around service calls:

```typescript
private toResponseError(err: unknown): never {
  if (err instanceof CanonicalizationError) throw new BadRequestException(envelope('invalid_content', ...));
  if (err instanceof DuplicateAnchorError) throw new ConflictException(envelope('duplicate_anchor', ...));
  if (err instanceof ResourceNotFoundError) throw new NotFoundException(envelope('resource_not_found', ...));
  throw err;
}
```

Wait — but `CanonicalizationError` is in `canonical.ts`, and the service rethrows it. The controller would need to import from `./canonical.js`. Is that OK? The manifest says the controller reads only `src/anchor/anchor.service.ts`. Hmm, but the service's error types `DuplicateAnchorError` and `ResourceNotFoundError` are defined in anchor.service.ts per the plan. `CanonicalizationError` is in canonical.ts.

The manifest line: `src/anchor/anchor.controller.ts | reads: src/anchor/anchor.service.ts`. So the controller should only import from anchor.service.js. Then how does it distinguish CanonicalizationError?

Options:
- Check `err instanceof Error && err.name === 'CanonicalizationError'`? Ugly.
- Or, the service wraps canonicalization errors... no, the plan says anchorDocument "throws `CanonicalizationError` (bad content)".

Alternatively, the controller validates input shape before calling the service: if `content` is missing → 400 with code `invalid_content`. And for the CanonicalizationError thrown by the service (e.g., circular reference — which can't happen over HTTP JSON anyway! JSON bodies can't have circular references). Right! Over HTTP, the body is JSON-parsed, so content is always JSON-serializable. CanonicalizationError can only happen in programmatic use (tests calling the service directly). So at the controller, the main validation is: content present and is an object? The plan says content is a structured JSON object.

Hmm, but wait: should the controller still defensively handle CanonicalizationError? Since I can only import from anchor.service.js per the manifest... let me check: does anchor.service.ts re-export CanonicalizationError? The plan's manifest says the service reads canonical.ts and lists its exports: "AnchorService (anchorDocument, verify, runConfirmationPass, runRecoverySweep), AnchorProof, MismatchReport, VerifyResult, ResourceNotFoundError". No mention of CanonicalizationError export from the service.

OK, my decision: the controller validates input shape (documentId non-empty, version a positive integer string, body.content present and an object — actually `unknown` but must be defined; maybe just `!== undefined`). For service errors, map `DuplicateAnchorError` → 409 `duplicate_anchor`, `ResourceNotFoundError` → 404 `resource_not_found`. For anything else, rethrow (NestJS default 500).

But hmm, what about CanonicalizationError from the service? Over HTTP it can't happen (JSON body). But if the test calls the controller method directly with a circular object... The controller spec tests "endpoint validation and delegation to service". It probably:
- calls `anchor` with valid params/body → expects service.anchorDocument called with correct args, returns proof.
- calls `verify` similarly.
- invalid version → 400?
- missing content → 400?

Since I can't see it, I'll implement reasonable validation returning the envelope with 400 for bad input.

Now — a critical question: does the controller return the envelope directly (with @HttpCode) or throw HttpException? If the test asserts on response body/status via supertest, either works. If the test calls the controller method directly and expects a thrown exception... hmm.

Let me think about what's most standard for this codebase style: "Errors — one envelope" with `code` as contract. NestJS's typical approach: exception filter that formats HttpException into the envelope. But no filter file. So either the controller throws HttpException with envelope body, or returns it.

I'll go with throwing HttpException subclasses with the envelope as payload:
- `new BadRequestException({ error: { code, message, details } })` — response body is exactly the envelope.

Actually wait, `new BadRequestException(object)` sets the response body to that object. Yes: `HttpException(response: string | Record<string, any>, status)`. So `new NotFoundException({ error: {...} })` produces body `{ error: {...} }` with status 404.

For input validation failures, same: `throw new BadRequestException({ error: { code: 'invalid_input', message: ..., details: {...} } })`.

Hmm, what code for validation errors? The plan doesn't specify. `invalid_input` seems reasonable in snake_case. I'll note as an assumption.

Now, version parsing: `version` param is a string like "3". Validate `/^\d+$/` and > 0? The plan's data model has version as Int. Should version be ≥ 1? Not specified. I'll require a non-negative... hmm. "versioned clinical reports" — version 0 is possible but unusual. Let me require a positive integer (≥ 1)? That's a guess. Safer: non-negative integer? Hmm.

Actually, let me not over-restrict: require the param to be a string representing an integer (regex `^-?\d+$`? no — negative versions make no sense). I'll use `/^\d+$/` and parseInt, and require ≥ 1? Let me think about what the test would do. The controller spec probably uses version "1" or "2" in URLs. Edge case tests might use "abc" or missing content. Negative/zero unlikely to be tested. I'll accept `/^\d+$/` (0 or above) — hmm, but 0...

Let me go with requiring a positive integer: `const n = Number(version); if (!/^\d+$/.test(version) || n < 1) → 400`. And note as assumption. Actually, I'll keep it simpler and just check `/^\d+$/` and parseInt — allowing 0. Hmm.

I keep going back and forth. Decision: `/^\d+$/` regex, parseInt, no additional range check beyond that. Version 0 is technically fine as an Int. This minimizes assumptions. Actually wait — but then `Number("007")` = 7, and "007" passes the regex. Fine, it's an edge case; parseInt handles it.

documentId: must be a non-empty string. `if (!documentId)` → 400.

body.content: must be present. `if (body === undefined || body === null || typeof body.content !== 'object' ...)` hmm. What is valid content? "structured JSON" — an object (or array?). The plan says `content: unknown` in the body type. I'll require `body.content !== undefined && body.content !== null`. Should I require it to be an object? JSON could technically be a string or number, but "structured content" implies an object. Requiring `typeof === 'object'` (excluding null) seems reasonable for "structured JSON". Hmm, but that's an assumption. I'll require present and non-null; if it's a primitive, canonicalize will happily hash it... The plan's canonicalize takes `unknown`.

Let me do: content must be defined and not null. That's minimal validation ("validate input shape" — shape = presence of the content field). I'll note as assumption.

Now, imports with `.js` extension (nodenext requirement):
- `import { AnchorService, ... } from './anchor.service.js';`
- NestJS imports: `@nestjs/common` — no extension needed (bare specifier).

Types to import from service: `AnchorService`, `AnchorProof`, `VerifyResult`. Per the plan, these are exported from anchor.service.ts.

Wait — but there's a subtlety: anchor.service.ts itself currently doesn't compile (has TS2307 for './anchor.repository' etc.). But that's being fixed elsewhere; my file just needs to be correct assuming the service compiles per plan.

Also, should I import `DuplicateAnchorError` and `ResourceNotFoundError` from './anchor.service.js'? Yes, per the plan they're defined there.

Now let me write the envelope helper:

```typescript
function envelope(code: string, message: string, details: Record<string, unknown> = {}): object {
  return { error: { code, message, details } };
}
```

`details` is an object, never null. Good.

Handlers:

```typescript
@Post(':documentId/:version/anchor')
async anchor(
  @Param('documentId') documentId: string,
  @Param('version') version: string,
  @Body() body: { content?: unknown },
): Promise<AnchorProof> {
  const parsed = this.parseParams(documentId, version);
  if (parsed instanceof BadRequestException) throw parsed; // ugly
}
```

Better: a private validation method that throws directly:

```typescript
private assertValid(documentId: string, version: string, body: { content?: unknown }): number {
  if (!documentId) throw new BadRequestException(envelope('invalid_input', 'documentId must be a non-empty string', { field: 'documentId' }));
  if (!/^\d+$/.test(version)) throw new BadRequestException(envelope('invalid_input', 'version must be a non-negative integer', { field: 'version' }));
  if (body === null || body === undefined || body.content === undefined || body.content === null) throw new BadRequestException(envelope('invalid_input', 'content is required', { field: 'content' }));
  return parseInt(version, 10);
}
```

Hmm wait, `@Body() body: { content?: unknown }` — NestJS parses JSON body; if the body is `{}`, body = {}. If no body, body = undefined? Actually with @Body() and no body, it's undefined. OK.

Then:

```typescript
try {
  return await this.anchors.anchorDocument(documentId, parsedVersion, body.content);
} catch (err) {
  throw this.toHttpError(err);
}
```

And:

```typescript
private toHttpError(err: unknown): never {
  if (err instanceof DuplicateAnchorError) {
    throw new ConflictException(envelope('duplicate_anchor', err.message, {}));
  }
  if (err instanceof ResourceNotFoundError) {
    throw new NotFoundException(envelope('resource_not_found', err.message, {}));
  }
  throw err;
}
```

Wait, `toHttpError` returning `never` while rethrowing — fine.

Hmm, one concern: `err.message` — the error's message is developer-facing English per convention. The service errors presumably have messages. Using `err.message` for the envelope's message is consistent with "message is developer-facing English".

But what if `err` isn't an Error? `instanceof` checks handle that; otherwise rethrow.

Now for the verify endpoint:

```typescript
@Post(':documentId/:version/verify')
async verify(
  @Param('documentId') documentId: string,
  @Param('version') version: string,
  @Body() body: { content?: unknown },
): Promise<VerifyResult> {
  const parsedVersion = this.assertValid(documentId, version, body);
  try {
    return await this.anchors.verify(documentId, parsedVersion, body.content);
  } catch (err) {
    throw this.toHttpError(err);
  }
}
```

Success status: POST defaults to 201. For verify, 201 is weird (nothing created). Add `@HttpCode(HttpStatus.OK)` to verify, and for anchor... 201 Created is semantically correct (anchor record created). But on duplicate → 409. I'll leave anchor at default 201 and set verify to 200 explicitly. Hmm, or should anchor also be 200? The plan doesn't say. I'll leave anchor at default (201) — actually, let me be explicit with `@HttpCode(HttpStatus.CREATED)` for clarity? "Do exactly what the task asks" — explicitness is fine but default is 201 anyway. I'll add `@HttpCode(HttpStatus.OK)` only for verify where the default would be wrong.

Hmm wait, actually — is POST right for verify? The plan says `@Post(':documentId/:version/verify')`. Yes, follow the plan.

Now — `@Controller('anchors')` gives base path `/anchors`. Routes: `/anchors/:documentId/:version/anchor` and `/anchors/:documentId/:version/verify`. Kebab-case plural: "anchors" ✓. The subpaths "anchor"/"verify" are per plan.

Now, the `// ASSUMPTION:` lines I need:

1. The test file's expected shape (status codes, error codes for validation) is invisible → note assumption.
2. CanonicalizationError can't be imported per manifest (controller reads only anchor.service.ts) and can't occur over HTTP JSON → note assumption.
3. Version validation rules (non-negative integer) — assumption.
4. `invalid_input` code for validation errors — assumption (the plan only specifies codes for resource_not_found, duplicate_anchor, hash_mismatch).

Wait, the plan mentions `hash_mismatch` → 400. But per the plan, verify returns a mismatch as a result `{ok:false, mismatch}`, not an error. So when would `hash_mismatch` be a 400? Maybe... hmm. The plan's assumption says "HTTP mapping: 404 for `resource_not_found`, 409 for `duplicate_anchor`, 400 for `hash_mismatch`." Maybe the intended design is that verify throws HashMismatchError → 400? But the plan's section 3 says verify "returns VerifyResult" with `{ok:false, mismatch}`. Slight contradiction within the plan. I'll follow section 3 (return VerifyResult as body) since that's the concrete signature, and note the assumption. Actually — hmm, should verify return 200 with `{ok:false,...}` or 400? The signature says it returns VerifyResult; I'll return it with 200. And note as assumption that mismatch is a successful response body per plan section 3, not a 400.

Let me double-check the import style too: ESM with nodenext → `import { ... } from './anchor.service.js';` ✓. NestJS decorator imports are fine.

One more consideration: constructor parameter naming. `private readonly anchors: AnchorService`. Fine.

Should the controller class export the types? No.

Let me also consider: does the test import something specific from the controller file, like a constant? Line 3 of `test/anchor.controller.spec.ts` imports from '../src/anchor/anchor.controller' — probably just `AnchorController`. Line 8 imports from '../src/anchor/anchor.service' — probably `AnchorService` or error classes. I'll export `AnchorController` (named export, per the plan's "class AnchorController").

Now let me carefully write the final file.

```typescript
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  AnchorProof,
  AnchorService,
  DuplicateAnchorError,
  ResourceNotFoundError,
  VerifyResult,
} from './anchor.service.js';

// The error envelope is the one contract for all failures (see repo conventions).
function errorEnvelope(code: string, message: string, details: Record<string, unknown>): object {
  return { error: { code, message, details } };
}

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<AnchorProof> {
    const parsedVersion = this.validateInput(documentId, version, body);
    try {
      return await this.anchorService.anchorDocument(documentId, parsedVersion, body.content);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Post(':documentId/:version/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<VerifyResult> {
    const parsedVersion = this.validateInput(documentId, version, body);
    try {
      return await this.anchorService.verify(documentId, parsedVersion, body.content);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  private validateInput(documentId: string, version: string, body: { content?: unknown }): number {
    if (typeof documentId !== 'string' || documentId.length === 0) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'documentId must be a non-empty string', { field: 'documentId' }),
      );
    }
    // ASSUMPTION: version is validated as a base-10 unsigned integer string; the plan fixes the data type (Int) but not the HTTP-level rule.
    if (!/^\d+$/.test(version)) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'version must be a non-negative integer', { field: 'version' }),
      );
    }
    if (body === null || body === undefined || body.content === null || body.content === undefined) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'body.content is required', { field: 'content' }),
      );
    }
    return Number.parseInt(version, 10);
  }

  private toHttpException(error: unknown): never {
    if (error instanceof DuplicateAnchorError) {
      throw new ConflictException(errorEnvelope('duplicate_anchor', error.message, {}));
    }
    if (error instanceof ResourceNotFoundError) {
      throw new NotFoundException(errorEnvelope('resource_not_found', error.message, {}));
    }
    // ASSUMPTION: CanonicalizationError is not mapped here because the controller only imports from anchor.service.js (per the plan manifest) and a JSON-transported body cannot be non-serializable; unexpected errors fall through to NestJS's default 500 handling.
    throw error;
  }
}
```

Wait — one issue: `body.content` after validation is still of type `unknown` (could be undefined per the type), but we've checked it's not null/undefined. Passing `body.content` to service which takes `unknown` — fine type-wise.

Hmm, but TS narrowing: `body.content === null || body.content === undefined` — after the throw, in the subsequent code TS knows `body.content` is not null/undefined? For property access on a parameter, TS does narrow `body.content` after the check within the same function... actually narrowing on `body.content` works if `body` is a const parameter — yes, TS narrows property accesses. But we return `parsedVersion` from validateInput and use `body.content` in the caller — no narrowing there. The type is `unknown`, so it's fine anyway.

Another consideration: `@Body() body: { content?: unknown }` — if the client sends a body that's not an object (e.g., a JSON string), NestJS will give body = "somestring" and `body.content` would be undefined → 400. OK.

Now, about the truncated error line: it said "Cannot find module './anchor.service'" — my import uses './anchor.service.js' which resolves under nodenext. ✓

Are there other errors that "require" something of the controller file? Let me scan the list again:

- `src/anchor/anchor.module.ts(2,34): TS2307 './anchor.controller'` — module.ts's import lacks `.js`; not fixable from the controller file. Out of scope ("change nothing the messages don't name" — well, the message names './anchor.controller' as a module path... hmm. Does fixing this require me to do something in the controller file? No — the fix is in module.ts (add .js). I can't touch module.ts. So nothing for me.)

Wait, actually, hmm: could the TS2307 in module.ts be because the controller file doesn't exist? If `anchor.controller.ts` is missing entirely, then './anchor.controller' (even with .js) would fail. But the task says "src/anchor/anchor.controller.ts doesn't compile" — implying it exists. And the test's TS2307 for '../src/anchor/anchor.controller'... if the file exists with errors, the import would resolve. Unless the file is empty or has a syntax error preventing parse? A syntax error in the imported file would show errors for that file and the import would still resolve (with any-typed exports?). Hmm, actually with a syntax error, the module might not export anything properly, but TS2307 is specifically "module not found".

Wait — maybe the file exists at a different name? Like `anchor.controller.ts` is missing and there's some other file? I can't know. The task explicitly says: rewrite `src/anchor/anchor.controller.ts` in full. So I produce it; existence is resolved by my output. The TS2307 in module/test would then be due to missing `.js` extension in their imports (TS2835-style failures reported as TS2307? no — TS2835 is a separate error for missing extension; TS2307 is for truly unresolvable).

Hmm, under nodenext, `import './anchor.controller'` (no extension) → error TS2835 "Relative import paths need explicit file extensions" — that's what we see for chain.ts etc. But module.ts shows TS2307 for './anchor.controller'. Interesting — maybe because the file doesn't exist at all, TS reports TS2307 instead of TS2835? Actually I think if the file doesn't exist, you get TS2307. If the file exists but extension is missing, you get TS2835. So: `./chain` (exists) → TS2835; `./anchor.controller` (doesn't exist?) → TS2307.

But the task says the controller "doesn't compile" with these messages... and the first truncated line is from the controller (TS2307 for './anchor.service'). Contradiction: if the controller file didn't exist, it wouldn't have its own error line.

Unless... the truncated first line is from a different file! Let me re-examine: "ule './anchor.service' or its corresponding type declarations." Which file imports './anchor.service'? anchor.module.ts (line 3: TS2307 './anchor.service' — yes! module.ts line 3 is `Cannot find module './anchor.service'`). But that's already listed separately as `src/anchor/anchor.module.ts(3,31)`. And anchor.service.ts imports './anchor.repository' (lines 1, 2), not './anchor.service'.

Hmm wait, the module.ts errors listed: line 2 → './anchor.controller', line 3 → './anchor.service', line 4 → './anchor.repository', line 5 → chain (TS2835). So module.ts has 4 errors, all listed. The truncated first line must be from a file before anchor.module.ts alphabetically: `src/anchor/anchor.controller.ts`. So the controller has a TS2307 for './anchor.service'.

But then why does module.ts get TS2307 for './anchor.controller' instead of TS2835? Maybe... the controller file exists but its contents are such that it's not a valid module? No, TS2307 is resolution.

Or: maybe the file exists as `anchor.controller.ts` but... hmm, actually you know what — maybe TS reports TS2307 when the resolved file (with .ts substitution) exists but the import path without extension under nodenext fails to resolve, AND the file has no... no wait, chain.ts got TS2835 for './canonical' and canonical.ts probably exists.

Let me not overthink this. Possibility: the controller file currently contains something like `export * from './anchor.service'` and the error is on that line. And module.ts's TS2307 for './anchor.controller' is... maybe the file is actually named slightly differently, or is empty (0 bytes)? An empty .ts file exists → import resolves fine.

Another possibility: TS2307 vs TS2835 — I recall that under nodenext, missing extension gives TS2835 as an *additional* diagnostic, and if the file truly can't be found you get TS2307. For './anchor.controller' from module.ts: if `anchor.controller.ts` exists, TS2835. It shows TS2307 → the file probably doesn't exist on disk. But then the truncated first error line can't be from it...

Unless the truncated line is from `src/anchor/canonical.ts`?? No wait, canonical.ts would sort before chain.ts... Order in the list: [truncated], anchor.module.ts, anchor.repository.ts, anchor.service.ts, chain.ts, test/*. Alphabetically: anchor.controller.ts < anchor.module.ts < anchor.repository.ts < anchor.service.ts < chain.ts. And canonical.ts sorts after anchor.service.ts? "anchor.service.ts" vs "canonical.ts": 'a' < 'c', so canonical.ts comes after chain.ts? "chain.ts" vs "canonical.ts": 'ch' vs 'ca' → 'a' < 'h', so canonical.ts < chain.ts. So full alphabetical order: anchor.controller, anchor.module, anchor.repository, anchor.service, canonical, chain, test/*. The list has chain.ts but no canonical.ts errors (canonical.ts probably compiles fine). So the truncated first line = anchor.controller.ts. ✓

So the controller exists (has at least one error line) but module.ts can't find './anchor.controller'?? Strange. Unless the controller file has a BOM or is named with different casing... I really can't resolve this mystery.

Actually — wait. Maybe the truncated line is the tail of a longer message that includes the file, and the whole first line was something like:
`src/anchor/anchor.controller.ts(1,29): error TS2307: Cannot find module './anchor.service' or its corresponding type declarations.`
Truncated to just the tail. And module.ts's TS2307 for './anchor.controller' is...

Oh! Maybe I'm wrong about TS2835 vs TS2307. Let me recall: in TypeScript with moduleResolution nodenext, `import x from './foo'` where foo.ts exists: you get error TS2835 "Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './foo.js'?" — yes, that's the standard.

But if foo.ts doesn't exist: TS2307 "Cannot find module './foo' or its corresponding type declarations."

Given module.ts shows TS2307 for './anchor.controller' while showing TS2835 for './chain' (line 5), the consistent explanation: anchor.controller.ts doesn't exist on disk, chain.ts does.

Then the truncated first line is not from anchor.controller.ts... What other file could import './anchor.service' and sort before anchor.module.ts? None. Hmm, unless the error order isn't alphabetical but by... tsc reports errors in file order per tsconfig's file list, which is usually alphabetical-ish but can vary.

Or maybe the truncated line is from `test/anchor.controller.spec.ts`? No, that imports '../src/anchor/anchor.service' (line 8, listed) and '../src/anchor/anchor.controller' (line 3, listed). Both listed.

Hmm wait — maybe the truncated line is actually the continuation of a message from a file like `src/anchor/canonical.ts`... no.

Let me count: which files import './anchor.service'? anchor.module.ts (listed, line 3). anchor.controller.ts (probably, truncated line). test/anchor.controller.spec.ts imports '../src/anchor/anchor.service' (listed, line 8). So the truncated line is most likely anchor.controller.ts's import of './anchor.service'.

OK, here's a resolution to the mystery: maybe the file exists as `src/anchor/anchor.controller.ts` but the module.ts import is `./anchor.controller` and... you know, there's actually a subtlety: TS2835 is reported when the extensionless import could be fixed by adding .js. If the target file exists but is excluded from compilation (e.g., not in tsconfig include), you get TS2307. Whatever — it doesn't matter for my task. The task is clear: produce a complete, correct `src/anchor/anchor.controller.ts` per plan, with the `.js` extension import to satisfy nodenext. Whether module.ts's error clears is module.ts's problem (needs `.js` in its own import — a separate task presumably).

Hmm, wait, actually one more thought: maybe the intended reading is simpler — the whole error list is "the compiler's exact messages for the entire workspace", and my file rewrite should fix all errors that pertain to the controller: i.e., the TS2307 for './anchor.service' inside it (truncated line). And the TS2307s referencing '../src/anchor/anchor.controller' (module.ts line 2, test line 3) would be fixed by the file existing/compiling — if they're currently failing because the file is missing/broken. If I produce a valid file, those resolve (assuming their import paths... no wait, they'd still need .js extension under nodenext → TS2835 would appear instead).

Ugh. But "change nothing the messages don't name" — I can only output the controller file. The reply format is fixed: "Reply with the complete contents of src/anchor/anchor.controller.ts in a single fenced block, and nothing else." So I can't fix module.ts or the tests. Fine.

So my deliverable: a complete controller file that:
1. Imports from './anchor.service.js' (fixes the TS2307/TS2835-class import errors within this file).
2. Implements the plan's controller spec.
3. Contains `// ASSUMPTION:` lines where I'm guessing at invisible shapes.

Let me also double-check the service's exported names per plan: `AnchorService`, `AnchorProof`, `MismatchReport`, `VerifyResult`, `DuplicateAnchorError`, `ResourceNotFoundError`, `AnchorRecord`, `NewAnchor`, `AnchorState`. I'll import `AnchorService`, `AnchorProof`, `VerifyResult`, `DuplicateAnchorError`, `ResourceNotFoundError`. All per plan from anchor.service.ts. ✓

One more: should the controller handle `CanonicalizationError`? Per plan, anchorDocument/verify throw it for bad content. Over HTTP, JSON body → always serializable → can't happen. But the controller spec might test it by calling the method directly with a circular object! Hmm. "test/anchor.controller.spec.ts | ... endpoint validation and delegation to service". If it tests CanonicalizationError → 400, I'd need to catch it. But importing from './canonical.js' would violate the manifest's "reads: src/anchor/anchor.service.ts" line...

Hmm, but does the manifest strictly govern imports? The manifest is part of the plan. "PLAN.md above still governs." The manifest says the controller reads only anchor.service.ts. To catch CanonicalizationError without importing it, I could check `error instanceof Error && error.name === 'CanonicalizationError'`. That's hacky but avoids the import. Is it worth it?

The plan's error mapping assumption says: "400 for `hash_mismatch`" — not canonicalization. So the plan doesn't even specify a mapping for CanonicalizationError at HTTP level. Given JSON transport can't produce it, I'll leave it unmapped (falls through to 500) and note the assumption. Actually hmm wait — but if the controller spec calls `controller.anchor(...)` directly with a circular content object and expects a 400... I'm speculating. The manifest description says the controller test covers "endpoint validation and delegation to service" — validation (input shape) and delegation. I'll stick with my design and note the assumption clearly.

Actually, let me reconsider using `error.name` check — it's defensive and cheap:

```typescript
if (error instanceof Error && error.name === 'CanonicalizationError') {
  throw new BadRequestException(errorEnvelope('invalid_content', error.message, {}));
}
```

Hmm. "Do exactly what the task asks. Do not improve code you weren't asked to change." Adding speculative handling is scope creep. But this is a new file I'm writing from scratch, so everything is "the task". Still, the plan governs: it specifies three HTTP mappings. I'll implement exactly those two that can occur (duplicate, not-found) plus input validation 400s, and note the rest as assumptions. Cleaner.

Wait, one more: for input validation, which code? The plan's codes: resource_not_found, duplicate_anchor, hash_mismatch. No code specified for validation errors. I'll use `invalid_input` and note as assumption.

And the success status for anchor: 201 (POST default). I'll leave it as default — no, let me be explicit with `@HttpCode(HttpStatus.CREATED)`? The plan doesn't specify. Explicit is better than implicit magic. Hmm, "do exactly what the task asks" — either satisfies. I'll add explicit `@HttpCode(HttpStatus.CREATED)` for anchor and `@HttpCode(HttpStatus.OK)` for verify, with an assumption note that status codes beyond the error mapping are not fixed by the plan.

Hmm actually, let me minimize assumption noise: I'll put a few concise `// ASSUMPTION:` lines.

Also: details object — "details is an object, never null." For validation errors, I include `{ field: ... }`. For service errors, `{}`. Good.

Let me also think about: `@Param('documentId')` vs `@Param() params`. The plan shows `@Param() p`. Either works; naming is cleaner. I'll use named params.

Edge: URL param `version` in the route — NestJS route `:documentId/:version/anchor`. ✓

Now, TypeScript strictness: `body.content` is of type `unknown`; passing to service (param `content: unknown`) ✓.

`private validateInput(...): number` — throws or returns. Fine.

Let me confirm: import `HttpCode`, `HttpStatus` from @nestjs/common ✓. `BadRequestException`, `ConflictException`, `NotFoundException` ✓.

Final file:

```typescript
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  AnchorProof,
  AnchorService,
  DuplicateAnchorError,
  ResourceNotFoundError,
  VerifyResult,
} from './anchor.service.js';

// Single error envelope: { error: { code, message, details } } — `code` is the contract.
function errorEnvelope(code: string, message: string, details: Record<string, unknown>): object {
  return { error: { code, message, details } };
}

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version/anchor')
  @HttpCode(HttpStatus.CREATED)
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<AnchorProof> {
    const parsedVersion = this.validateInput(documentId, version, body);
    try {
      return await this.anchorService.anchorDocument(documentId, parsedVersion, body.content);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Post(':documentId/:version/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<VerifyResult> {
    const parsedVersion = this.validateInput(documentId, version, body);
    try {
      return await this.anchorService.verify(documentId, parsedVersion, body.content);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  // Input-shape validation only; all anchoring logic lives in the service.
  private validateInput(documentId: string, version: string, body: { content?: unknown }): number {
    if (documentId.length === 0) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'documentId must be a non-empty string', { field: 'documentId' }),
      );
    }
    // ASSUMPTION: the plan fixes `version` as an Int but not the HTTP-level rule; it is accepted here as a base-10 unsigned integer string.
    if (!/^\d+$/.test(version)) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'version must be a non-negative integer', { field: 'version' }),
      );
    }
    if (body === null || body === undefined || body.content === null || body.content === undefined) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'body.content is required and must not be null', { field: 'content' }),
      );
    }
    return Number.parseInt(version, 10);
  }

  // ASSUMPTION: the plan fixes only three error mappings (404 resource_not_found, 409 duplicate_anchor, 400 hash_mismatch); a verify mismatch is returned as a 200 body per the plan's VerifyResult signature, and CanonicalizationError cannot arise from a JSON-transported body, so both are left to the plan's result shape / default handling.
  private toHttpException(error: unknown): never {
    if (error instanceof DuplicateAnchorError) {
      throw new ConflictException(errorEnvelope('duplicate_anchor', error.message, {}));
    }
    if (error instanceof ResourceNotFoundError) {
      throw new NotFoundException(errorEnvelope('resource_not_found', error.message, {}));
    }
    throw error;
  }
}
```

Wait — `documentId.length === 0`: `@Param` values are always strings, so `typeof` check is unnecessary; but under strict TS, the param type is `string`, fine.

Hmm, one thing: the plan says the controller "validates input and calls service. Zero business logic." My validateInput is validation ✓, toHttpException is error presentation ✓.

Also the plan's signature: `anchor(@Param() p, @Body() body: { content: unknown })`. Mine uses named params and `{ content?: unknown }` — a reasonable refinement (content optional in the type so I can validate presence). Fine.

Now, assumption lines: the instructions say "add a single `// ASSUMPTION:` line stating what you couldn't reconcile" for cases where satisfying the compiler would require abandoning a plan requirement — and "if a message references a shape you can't see, don't guess repeatedly — say so in an `// ASSUMPTION:` line."

Do the compiler messages reference shapes I can't see? The test file's errors:
- `test/anchor.service.spec.ts(113,5): TS2740: Type 'Promise<Row | null>' is missing properties from type 'Row'` — that's a test file issue, not mine.
- `test/anchor.service.spec.ts(159,42): TS2339: Property 'state' does not exist on type 'never'` — test file.
- `test/anchor.service.spec.ts(430,71): TS2322: Type 'null' is not assignable to type 'string | undefined'` — test file.

None of these are about the controller's shape. The only messages that pertain to my file: the truncated first line (TS2307 './anchor.service'). So strictly, I only need to fix the import. Everything else in my file is plan-driven reconstruction.

Should I include ASSUMPTION lines? The instructions permit/require them where I'm guessing at invisible shapes. My guesses: success status codes, validation error code (`invalid_input`), version rule, and the CanonicalizationError/mismatch mapping. I'll include concise assumption comments. That's honest and follows the guidance.

Let me trim to keep it clean — maybe 3 assumption lines:
1. Version rule.
2. Error mapping beyond the plan's three (mismatch as 200 body; CanonicalizationError unreachable over HTTP).
3. Success status codes + `invalid_input` code not fixed by the plan.

Actually, I could combine 2 and 3. Let me finalize with three short lines.

One more check on imports: do I need `MismatchReport`? No — VerifyResult covers it.

Also, should the controller file have a default export? No, named class export per plan ("class AnchorController").

Let me confirm the decorator order: `@Post(...)` then `@HttpCode(...)` — either order works.

Also, ESM: no `export default`. ✓

I think the file is solid. Let me write the final answer: a single fenced block with the complete contents, nothing else.

Wait — "Reply with the complete contents of src/anchor/anchor.controller.ts in a single fenced block, and nothing else." So no prose outside the fence. I'll comply.

Let me do one last review of strict TS issues:
- `errorEnvelope` returns `object` — passed to HttpException constructor which accepts `string | Record<string, any>`? The signature: `constructor(response: string | object, status: number, description?: string)`. `object` is assignable ✓.
- `body === null || body === undefined` — body's type is `{ content?: unknown }`; comparing to null/undefined is allowed (no strict null check violation; TS allows `===` between object types and null/undefined? Under strictNullChecks, comparing `{content?: unknown}` to `null` — TS allows comparison if the types overlap... actually, does TS error on `===` between unrelated types? For null/undefined vs object type: TS allows `x === null` for any x (no error). Yes, that's fine.
- `body.content === null` — content is `unknown`; comparing unknown to null is fine.
- After the check, `body.content` is still `unknown` at the call site (separate function) — fine.
- `Number.parseInt(version, 10)` ✓.
- Private methods used before declaration — fine in TS classes.
- `this.toHttpException(error)` returns `never` and throws — `throw this.toHttpException(error)` ✓.

One concern: `async anchor(...): Promise<AnchorProof>` — with `@HttpCode(HttpStatus.CREATED)`, fine.

Also: unused imports? I import HttpCode and HttpStatus — both used. BadRequestException, ConflictException, NotFoundException — used. Body, Controller, Param, Post — used. ✓

Final answer below.
```

## reply

```typescript
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  AnchorProof,
  AnchorService,
  DuplicateAnchorError,
  ResourceNotFoundError,
  VerifyResult,
} from './anchor.service.js';

// Single error envelope: { error: { code, message, details } } — `code` is the contract.
function errorEnvelope(code: string, message: string, details: Record<string, unknown>): object {
  return { error: { code, message, details } };
}

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version/anchor')
  @HttpCode(HttpStatus.CREATED)
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<AnchorProof> {
    const parsedVersion = this.validateInput(documentId, version, body);
    try {
      return await this.anchorService.anchorDocument(documentId, parsedVersion, body.content);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Post(':documentId/:version/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<VerifyResult> {
    const parsedVersion = this.validateInput(documentId, version, body);
    try {
      return await this.anchorService.verify(documentId, parsedVersion, body.content);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  // Input-shape validation only; all anchoring logic lives in the service.
  private validateInput(documentId: string, version: string, body: { content?: unknown }): number {
    if (documentId.length === 0) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'documentId must be a non-empty string', { field: 'documentId' }),
      );
    }
    // ASSUMPTION: the plan fixes `version` as an Int but not the HTTP-level rule; it is accepted here as a base-10 unsigned integer string.
    if (!/^\d+$/.test(version)) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'version must be a non-negative integer', { field: 'version' }),
      );
    }
    if (body === null || body === undefined || body.content === null || body.content === undefined) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'body.content is required and must not be null', { field: 'content' }),
      );
    }
    return Number.parseInt(version, 10);
  }

  // ASSUMPTION: the plan fixes only the error mappings 404 resource_not_found and 409 duplicate_anchor for service failures; a verify mismatch is returned as a successful VerifyResult body per the plan's signature, and CanonicalizationError cannot arise from a JSON-transported body, so neither is mapped here.
  // ASSUMPTION: success status codes (201 for anchor, 200 for verify) and the `invalid_input` validation code are not fixed by the plan; they follow the repo conventions.
  private toHttpException(error: unknown): never {
    if (error instanceof DuplicateAnchorError) {
      throw new ConflictException(errorEnvelope('duplicate_anchor', error.message, {}));
    }
    if (error instanceof ResourceNotFoundError) {
      throw new NotFoundException(errorEnvelope('resource_not_found', error.message, {}));
    }
    throw error;
  }
}
```
