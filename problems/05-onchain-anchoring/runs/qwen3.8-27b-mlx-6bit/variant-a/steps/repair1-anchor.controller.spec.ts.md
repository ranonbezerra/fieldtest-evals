# repair1-anchor.controller.spec.ts

## reply

Let me analyze the compiler messages to understand what's needed.

The task is to rewrite `test/anchor.controller.spec.ts` completely, fixing what the compiler messages require of this file.

Let me look at the errors related to `test/anchor.controller.spec.ts`:

```
test/anchor.controller.spec.ts(3,34): error TS2307: Cannot find module '../src/anchor/anchor.controller' or its corresponding type declarations.
test/anchor.controller.spec.ts(8,8): error TS2307: Cannot find module '../src/anchor/anchor.service' or its corresponding type declarations.
```

So the file imports:
- Line 3, col 34: `../src/anchor/anchor.controller` — cannot find module
- Line 8, col 8: `../src/anchor/anchor.service` — cannot find module

But wait, these are "Cannot find module" errors. The reason is that the source files themselves have errors. Let me look at the other errors:

```
src/anchor/anchor.module.ts(2,34): error TS2307: Cannot find module './anchor.controller' or its corresponding type declarations.
src/anchor/anchor.module.ts(3,31): error TS2307: Cannot find module './anchor.service' or its corresponding type declarations.
src/anchor/anchor.module.ts(4,34): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
src/anchor/anchor.module.ts(5,46): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './chain.js'?
```

So the source files have import path issues. The `--moduleResolution` is `node16` or `nodenext`, which requires explicit `.js` extensions in relative imports.

Wait, but the task says "Change nothing the messages do not name." So I should only fix `test/anchor.controller.spec.ts`. But the errors in this file are TS2307 (Cannot find module) which is caused by the source modules having their own errors.

Hmm, let me think about this carefully. The task is to rewrite `test/anchor.controller.spec.ts` fixing what these messages require of THIS file. The messages that name this file are:

```
test/anchor.controller.spec.ts(3,34): error TS2307: Cannot find module '../src/anchor/anchor.controller' or its corresponding type declarations.
test/anchor.controller.spec.ts(8,8): error TS2307: Cannot find module '../src/anchor/anchor.service' or its corresponding type declarations.
```

These are "Cannot find module" errors. But the underlying cause is that the source files have their own compilation errors (TS2835 for missing .js extensions, TS2305 for Prisma exports, etc.). 

Wait, actually — the "Cannot find module" error in the test file is because the imported modules fail to compile. But that's a chain of errors. The task says "fixing what these messages require of this file."

Let me reconsider. The key insight: with `node16`/`nodenext` module resolution, relative imports need explicit `.js` extensions. So the test file's imports of `../src/anchor/anchor.controller` and `../src/anchor/anchor.service` need to be `../src/anchor/anchor.controller.js` and `../src/anchor/anchor.service.js`.

Wait, but that's not quite it. The error is TS2307 "Cannot find module" — not TS2835 "Relative import paths need explicit file extensions". Let me look at the difference.

Actually, TS2835 is the specific error for missing extensions. TS2307 is a generic "cannot find module". 

Hmm, but in the test file, the errors are TS2307, not TS2835. Why?

Let me think. When you have `import { AnchorController } from '../src/anchor/anchor.controller'` under node16 resolution, TypeScript would... actually it depends. Let me reconsider.

Actually, the reason the test file gets TS2307 instead of TS2835 might be that:
1. The source file `anchor.controller.ts` exists but fails to compile (it has errors), so... no, that would still resolve.

Wait. Let me reconsider the whole picture. Actually the "Cannot find module" in the test might be a cascading effect. But actually, I think the real issue is different.

Let me re-read: "These are the compiler's exact messages for the whole workspace — not a summary of them". So all these errors are real. The test file has two TS2307 errors.

Now, the task: "Rewrite `test/anchor.controller.spec.ts` complete, fixing what these messages require of this file."

So I need to fix the test file such that its two TS2307 errors go away. The TS2307 "Cannot find module '../src/anchor/anchor.controller'" — how do I fix that from the test file's side?

The most likely fix: add the `.js` extension. Under node16/nodenext, `import ... from '../src/anchor/anchor.controller.js'` would resolve to `anchor.controller.ts`. Without the `.js`, TypeScript can't find it.

Wait, but then why does the source file `anchor.service.ts` get TS2835 for its import of `./anchor.repository`? That's the "need explicit file extensions" error. And the test gets TS2307 "cannot find module"?

Hmm, there's an inconsistency. Let me think about why.

Actually, I bet the difference is:
- In `anchor.service.ts`, the import is `from './anchor.repository'`. TS2835 says "Did you mean './anchor.repository.js'?" — wait no, the message for anchor.service.ts line 1 col 59 is TS2307 "Cannot find module './anchor.repository'". Let me re-read.

```
src/anchor/anchor.service.ts(1,59): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
src/anchor/anchor.service.ts(2,38): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
src/anchor/anchor.service.ts(3,53): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './chain.js'?
src/anchor/anchor.service.ts(4,29): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './canonical.js'?
src/anchor/anchor.service.ts(5,39): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './canonical.js'?
```

So line 1 and 2 (imports of `./anchor.repository`) get TS2307, while lines 3,4,5 (imports of `./chain` and `./canonical`) get TS2835.

Interesting! So the difference is:
- `./anchor.repository` → TS2307 Cannot find module
- `./chain`, `./canonical` → TS2835 need explicit extension

Why would `./anchor.repository` be "cannot find module" while `./chain` is "need explicit extension"?

The answer: `anchor.repository.ts` file does NOT exist! Or it exists but... hmm.

Wait, actually let me reconsider. The TS2835 error is emitted when the file DOES exist but the extension is missing. The TS2307 "cannot find module" is emitted when the file doesn't exist at all.

So:
- `./chain` → TS2835 (file `chain.ts` exists, just needs `.js`)
- `./canonical` → TS2835 (file `canonical.ts` exists, just needs `.js`)
- `./anchor.repository` → TS2307 (file `anchor.repository.ts` does NOT exist!)

Wait, but there's a separate error:
```
src/anchor/anchor.repository.ts(1,10): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/anchor/anchor.repository.ts(2,15): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
src/anchor/anchor.repository.ts(67,9): error TS18046: 'error' is of type 'unknown'.
```

So `anchor.repository.ts` DOES exist and has its own errors. So why does importing it give TS2307?

Hmm, this is confusing. Let me reconsider.

Oh wait! Maybe the issue is that `anchor.repository.ts` fails to compile such badly that... no.

Actually, let me reconsider the mechanism of TS2835 vs TS2307.

Actually, I recall now: When `moduleResolution` is `node16`/`nodenext`, and you import a relative path without an extension, TypeScript's behavior:

1. First it tries to resolve the exact path `./anchor.repository`.
2. Since there's no file literally named `anchor.repository` (no extension), it fails.
3. Then... does it suggest `.js`? 

Actually, the TS2835 error is specifically designed for this: "Relative import paths need explicit file extensions in ECMAScript imports". This is emitted when the resolution fails due to missing extension AND a candidate with `.js` → `.ts` exists.

So both `./chain` and `./anchor.repository` should get TS2835 if the corresponding `.ts` files exist.

But `./anchor.repository` gets TS2307. This strongly suggests that at the time of resolution, `anchor.repository.ts` was not resolvable — perhaps because it's excluded, or... 

Hold on. Let me reconsider. Maybe the answer is simpler and I'm overthinking.

Actually — maybe the distinction is about whether the file has a default export or the module shape. No, that doesn't affect resolution.

Let me take yet another angle. What if the real situation is:
- `chain.ts` and `canonical.ts` exist and are clean enough that TS resolves them (with the extension error).
- `anchor.repository.ts` exists but is somehow not in the compilation... 

No. The errors for `anchor.repository.ts` are listed, so it IS in the compilation.

OK here's another thought. What if these TS2307 errors are actually a RED HERRING / cascade, and the ACTUAL fix required of the test file is just to add `.js` extensions to its imports? Let me check: the test imports `../src/anchor/anchor.controller` and `../src/anchor/anchor.service`. 

If I change them to `../src/anchor/anchor.controller.js` and `../src/anchor/anchor.service.js`, would the TS2307 go away? 

Under node16, `../src/anchor/anchor.controller.js` resolves to `../src/anchor/anchor.controller.ts`. The module would then be found (even if it has its own errors, the resolution succeeds). So yes, adding `.js` would fix the TS2307 in the test file.

But wait — if `anchor.controller.ts` has errors (which it does, transitively because it imports the broken service), would importing it still give TS2307? No. Resolution is about finding the file, not about whether it compiles cleanly. Once the file is found via the `.js` → `.ts` mapping, TS2307 goes away. The module's own errors remain but they're reported at the source file, not as "cannot find module" in the importer.

Actually, hold on. Let me reconsider whether `anchor.controller.ts` even exists and is resolvable. 

From `anchor.module.ts`:
```
src/anchor/anchor.module.ts(2,34): error TS2307: Cannot find module './anchor.controller' or its corresponding type declarations.
src/anchor/anchor.module.ts(3,31): error TS2307: Cannot find module './anchor.service' or its corresponding type declarations.
src/anchor/anchor.module.ts(4,34): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
src/anchor/anchor.module.ts(5,46): error TS2835: ... Did you mean './chain.js'?
```

So in `anchor.module.ts`:
- `./anchor.controller` → TS2307 (cannot find)
- `./anchor.service` → TS2307 (cannot find)
- `./anchor.repository` → TS2307 (cannot find)
- `./chain` → TS2835 (needs extension, file exists)

So `anchor.controller.ts`, `anchor.service.ts`, `anchor.repository.ts` all give TS2307 "cannot find module" when imported, while `chain.ts` gives TS2835.

But we KNOW `anchor.service.ts` and `anchor.repository.ts` exist (they have their own errors listed). So why TS2307?

This is the crux. Let me think very carefully about TypeScript's module resolution under `node16`/`nodenext`.

AH. I think I finally get it. The distinction between TS2835 and TS2307:

TS2835 ("Relative import paths need explicit file extensions") is emitted when TypeScript CAN find the target file but the import specifier lacks the required extension. This is a "friendly" error that even suggests the fix.

TS2307 ("Cannot find module") is emitted when TypeScript CANNOT find the target file at all.

Now, why would `anchor.service.ts` (which exists) give TS2307 but `chain.ts` (which exists) give TS2835?

The answer must be about file extension resolution. Under `nodenext`/`node16`, for a relative import to resolve, the specifier must have an extension. When you write `./chain` (no extension):
- TS tries to resolve `./chain` as a file. No file named `chain`. 
- Under node16, it does NOT try `./chain.ts` automatically for extensionless imports (that's the whole point of the extension requirement).
- So it fails to resolve → but TS is "helpful" and checks: is there a `./chain.ts` or `./chain.js`? If so, it emits TS2835 with the suggestion.

Hmm, but that logic would apply equally to `./anchor.service`. So why TS2307?

Unless... the "helpful" suggestion only fires under certain conditions. Let me recall the exact behavior.

Actually, you know what, I think I'm overanalyzing the source-side errors. The task is very specific: "Rewrite `test/anchor.controller.spec.ts` complete, fixing what these messages require of this file." And "Change nothing the messages do not name."

The messages that name `test/anchor.controller.spec.ts` are exactly two:
```
test/anchor.controller.spec.ts(3,34): error TS2307: Cannot find module '../src/anchor/anchor.controller' or its corresponding type declarations.
test/anchor.controller.spec.ts(8,8): error TS2307: Cannot find module '../src/anchor/anchor.service' or its corresponding type declarations.
```

So I need to make these two go away by editing ONLY the test file. The fix: add `.js` extensions to the import paths, matching the node16/nodenext convention.

So line 3: `import { ... } from '../src/anchor/anchor.controller.js'`
Line 8: `import { ... } from '../src/anchor/anchor.service.js'`

Wait, but line 3 col 34 and line 8 col 8 — let me figure out the structure. Line 3, column 34 is where the module specifier starts (the quote). Line 8, column 8 is where a module specifier starts too.

Hmm, actually the columns tell me where in the line the import path is. Let me not over-index on exact columns since I'm rewriting the whole file anyway.

But wait — there's a subtlety. If I add `.js` to the import, will it actually resolve? The source files `anchor.controller.ts` and `anchor.service.ts` exist (they have errors, so they're in the program). Under node16, `../src/anchor/anchor.controller.js` → resolves to `../src/anchor/anchor.controller.ts`. Yes, that works.

But hold on — would it? The source files have their own errors. But resolution is independent of those errors. So yes, adding `.js` fixes the TS2307 in the test file.

Now, but here's the thing: the task says "fixing what these messages require of this file." The TS2307 errors in the test are only fixable from the test side by adding `.js` extensions (since I can't change the source files — "Change nothing the messages do not name"). Wait, but the messages DO name the source files (they have their own errors). But the task says to rewrite ONLY `test/anchor.controller.spec.ts`. So I can only change that file.

So the fix for the test file is: use `.js` extensions in relative imports. That's the node16/nodenext convention, and it's consistent with the TS2835 errors elsewhere ("Did you mean './chain.js'?").

Now, let me also consider: the test file currently has other imports maybe? The errors only name line 3 and line 8. But I'm rewriting the whole file, so I need to make sure ALL relative imports in my new version use `.js` extensions.

Now, let me think about what the test file should contain. Per the PLAN:

```
test/anchor.controller.spec.ts | reads: src/anchor/anchor.controller.ts | endpoint validation and delegation to the service
```

So the controller test should test:
- Endpoint validation and delegation to the service.

The controller (from PLAN):
```
`src/anchor/anchor.controller.ts`
- `class AnchorController` — `@Controller('anchors')`
  - `@Post(':documentId/:version/anchor') anchor(@Param() p, @Body() body: { content: unknown }): Promise<AnchorProof>`
  - `@Post(':documentId/:version/verify') verify(@Param() p, @Body() body: { content: unknown }): Promise<VerifyResult>`
  - Validates input shape, delegates to the service; zero business logic.
```

So the controller has two endpoints:
- POST `/anchors/:documentId/:version/anchor` with body `{ content }` → returns `AnchorProof`
- POST `/anchors/:documentId/:version/verify` with body `{ content }` → returns `VerifyResult`

The controller validates input shape and delegates to the service.

Now, how do I test a NestJS controller? Two common approaches:
1. Unit test: instantiate the controller directly with a mocked service, call its methods.
2. Integration/e2e test: use `@nestjs/testing` `Test.createTestingModule` and supertest.

Given the plan says "endpoint validation and delegation to the service" and "zero business logic", a unit test that instantiates the controller with a mock service is cleanest and avoids needing a full Nest app + Prisma.

But wait — the controller "validates input shape". What does that mean? It validates that `content` is present, that `version` is a number, etc. And it maps errors to the error envelope? Let me think about the error handling.

Per the conventions:
```
## Errors — one envelope
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

And the PLAN says: "Errors use the single envelope with `code` in snake_case; HTTP mapping: 404 for `resource_not_found`, 409 for `duplicate_anchor`, 400 for `hash_mismatch`."

So the controller (or an exception filter) maps service errors to HTTP responses with the envelope. But the plan says the controller "validates input shape, delegates to the service; zero business logic." 

Hmm, where does error→envelope mapping happen? It could be in the controller (catching service errors and throwing HttpException with the envelope), or in a global exception filter. The plan doesn't explicitly say there's an exception filter. 

Let me think about what "validates input shape" means and how the controller handles errors. Since I'm only writing the test, I need to know the controller's actual behavior to test it. But I can't see the source (it has errors and I'm told not to guess at shapes I can't see — use `// ASSUMPTION:` lines).

Wait, the instructions say: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

So I should write the test based on what the PLAN specifies, and where I'm uncertain about exact shapes, add `// ASSUMPTION:` lines.

Let me reconsider the approach. The cleanest, most robust test that "tests behavior not implementation" for a controller:

Actually, the safest approach given I can't see the exact controller implementation is to test via the NestJS testing module (integration-style) using supertest. This tests the actual HTTP behavior: request in, response out. This is "behavior" testing.

But that requires the controller to be wired with a service. The service needs a repository and chain client. For the controller test, I'd provide a mock service (override the provider) OR provide fake repository + chain.

Hmm, let me think about what's cleanest and most likely to compile and pass.

Option A: Unit test — instantiate `AnchorController` directly.
```ts
const service = { anchorDocument: vi.fn(), verify: vi.fn() };
const controller = new AnchorController(service);
await expect(controller.anchor('doc1', '1', { content: {...} })).resolves.toEqual(...);
```
This requires knowing the controller's constructor signature and method signatures. The plan says methods take `@Param() p` and `@Body() body`. So the method signature is likely `anchor(documentId: string, version: string | number, body: { content: unknown })`. Actually with NestJS, `@Param()` without a key gives an object of all params. So `p` would be `{ documentId, version }`.

Hmm, this is getting into guessing territory. Let me reconsider.

Actually, let me reconsider the whole thing. The key constraint: "fixing what these messages require of this file." The messages for this file are ONLY the two TS2307 "cannot find module" errors. So strictly, the ONLY thing I need to fix is the import resolution. Everything else in the file... well, I'm rewriting it "complete", so I need to produce a complete, valid test file.

But the instruction also says: "Change nothing the messages do not name." This means I shouldn't gratuitously change things. But since I'm rewriting the whole file, I need to produce a complete file that compiles.

Wait, there's tension here. Let me re-read: "Rewrite `test/anchor.controller.spec.ts` complete, fixing what these messages require of this file." and "Change nothing the messages do not name."

I think the intent is: The test file is being rewritten completely (that's the deliverable). Within that rewrite, I fix the issues the compiler messages point to (the import resolution). And I don't go changing OTHER files. The "Change nothing the messages do not name" is about not touching other files / not refactoring beyond what's needed.

Actually, I think "Change nothing the messages do not name" means: within the scope of my changes, don't fix things that aren't causing errors. E.g., don't go "improve" the test beyond fixing the compile errors. But since I'm rewriting the whole file, I produce a complete, sensible test file that compiles.

Hmm, but actually — the current test file presumably already has content (it's not empty; it has imports on lines 3 and 8). The task is to rewrite it completely. So I have freedom to write a good test, but I must ensure it compiles given the constraints.

Let me focus on making a test that:
1. Compiles (fixes the TS2307 by using `.js` extensions).
2. Tests the controller's behavior per the PLAN: endpoint validation and delegation to the service.
3. Doesn't require seeing shapes I can't see (use `// ASSUMPTION:` where needed).

Now, the critical question: what does the controller look like exactly? I can infer from the PLAN but not see it. Let me be careful.

From the PLAN:
```
`src/anchor/anchor.controller.ts`
- `class AnchorController` — `@Controller('anchors')`
  - `@Post(':documentId/:version/anchor') anchor(@Param() p, @Body() body: { content: unknown }): Promise<AnchorProof>`
  - `@Post(':documentId/:version/verify') verify(@Param() p, @Body() body: { content: unknown }): Promise<VerifyResult>`
  - Validates input shape, delegates to the service; zero business logic.
```

So the controller:
- Route prefix `anchors`
- POST `:documentId/:version/anchor`
- POST `:documentId/:version/verify`

The method takes `@Param() p` (all params as an object) and `@Body() body`.

"Validates input shape" — probably checks that `body.content` is defined, and maybe that `version` parses to a number.

Now, for testing, the most robust approach that doesn't depend on exact method signatures is to use the NestJS testing module with supertest. This tests over HTTP, so I don't need to know the exact method signatures — just the routes and request/response shapes.

Let me design that:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AnchorController } from '../src/anchor/anchor.controller.js';
import { AnchorModule } from ... // maybe not needed
```

Wait, but I need to provide the service. The controller depends on `AnchorService`. For a controller-focused test, I'd create a testing module with the controller and provide a mock `AnchorService`.

But I need to know how the service is injected. Is it via constructor injection `constructor(private readonly anchorService: AnchorService)`? Almost certainly yes, following NestJS conventions.

So:
```ts
const moduleRef = await Test.createTestingModule({
  controllers: [AnchorController],
  providers: [{ provide: AnchorService, useValue: mockService }],
}).compile();
const app = moduleRef.createNestApplication();
await app.init();
```

Then use supertest to hit the endpoints.

But wait — does the test environment have `supertest` and `@nestjs/testing`? The conventions say "Vitest for tests." NestJS is the API framework. `@nestjs/testing` ships with `@nestjs/core`. `supertest` is a separate package. Hmm, I'm not 100% sure supertest is installed. 

Actually, many NestJS projects use `@nestjs/testing` + `supertest`. But I can't be sure it's in this project. Let me consider a safer approach that doesn't need supertest.

Alternative: Use the NestJS testing module but call the controller methods directly (not over HTTP). This still uses `Test.createTestingModule` to get dependency injection working, then `app.get(AnchorController)` and call methods. This avoids supertest.

But then I need to know the method signatures to call them. The plan gives: `anchor(@Param() p, @Body() body)`. So I'd call `controller.anchor({ documentId: 'doc1', version: '1' }, { content: {...} })`.

Hmm, but `@Param() p` — when called directly (not via HTTP), I pass the params object. So `anchor({ documentId, version }, body)`.

Actually wait, there's ambiguity: does the controller method take `@Param('documentId') documentId, @Param('version') version` or `@Param() p`? The plan says `@Param() p` (all params as one object). So the method signature is `anchor(p: { documentId: string; version: string }, body: { content: unknown })`.

But actually, I realize I should reconsider. Let me re-read the plan's controller spec very literally:

```
- `@Post(':documentId/:version/anchor') anchor(@Param() p, @Body() body: { content: unknown }): Promise<AnchorProof>`
```

Yes, `@Param() p` — a single param object. So calling directly: `controller.anchor({ documentId: 'doc1', version: '3' }, { content: data })`.

OK so here's my concern: I'm guessing at the exact method signatures and constructor. If I get them wrong, the test won't compile (which is exactly the kind of error I'm trying to avoid). 

The instruction says: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

So I should add `// ASSUMPTION:` lines where I'm making assumptions about shapes I can't see.

Let me think about the most robust design that minimizes guessing:

Approach: Integration test via NestJS testing module + supertest. This is the most "behavior" oriented and requires the least knowledge of internal method signatures — I just need routes, request body shape, and response shape. All of which the PLAN specifies:
- Routes: POST `/anchors/:documentId/:version/anchor`, POST `/anchors/:documentId/:version/verify`
- Request body: `{ content }`
- Response: `AnchorProof` or `VerifyResult`

The only things I need to know:
- How the service is provided (constructor DI — standard).
- Whether supertest is available.

For the service mock, I provide `{ provide: AnchorService, useValue: {...} }`.

But actually, do I even need to mock the service for a controller test? The plan says the controller "delegates to the service". To test delegation, I mock the service and assert it's called with the right args. That's "delegation" testing.

But wait, the conventions say: "Never assert only that a call happens." and "A test with no assertion, or one that only exercises the happy path, is worse than no test."

So I need real assertions on behavior. For a controller test:
- Test that valid input → service is called with correct args AND the response is the service's return value (delegation + pass-through).
- Test that invalid input → error envelope / 400 (validation).
- Test that service errors → proper error envelope / status.

Let me think about what "validates input shape" produces. If content is missing, the controller should return a 400 with the error envelope. If version isn't a number... hmm.

Actually, let me reconsider whether to use supertest or direct method calls.

Given uncertainty about supertest availability, and the desire for a clean unit test, let me reconsider direct instantiation.

Actually, you know what — let me reconsider the entire framing. The task is primarily about FIXING COMPILE ERRORS in this file. The "real" requirement is that the file compiles. The test content should be reasonable and match the plan, but the PRIMARY deliverable is a compiling file.

So my priorities:
1. The file must compile (no TS errors). This means correct imports with `.js` extensions, and correct usage of the imported types.
2. The test should be sensible per the plan (endpoint validation + delegation).
3. Add `// ASSUMPTION:` lines where I guess at shapes.

For (1), the safest is to import only what I'm confident exists:
- `AnchorController` from `../src/anchor/anchor.controller.js`
- `AnchorService` from `../src/anchor/anchor.service.js` (for the provider token)
- Types like `AnchorProof`, `VerifyResult` from `../src/anchor/anchor.service.js`

Wait, but do I need `AnchorService` as a value? For the provider token in the testing module, yes: `{ provide: AnchorService, useValue: mock }`. So I need to import `AnchorService` as a value.

Now, the controller's constructor: `constructor(private readonly service: AnchorService)`. If I use `Test.createTestingModule`, DI handles it. If I instantiate directly, I need the constructor signature.

Let me go with the testing module approach but WITHOUT supertest — instead, get the controller instance and call methods directly. This:
- Uses DI (so I don't need to know the exact constructor param order — well, I do need the provider token, which is `AnchorService`).
- Calls methods directly (so I need method signatures — but the plan gives them).

Hmm, but calling methods directly requires knowing the exact signature. Let me reconsider using supertest to avoid that.

Actually, let me step back and think about what's most likely to be correct and compile.

I'll go with a hybrid: Use `Test.createTestingModule` to set up DI, then get the controller and call its methods directly. This is a common NestJS unit test pattern:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AnchorController } from '../src/anchor/anchor.controller.js';
import { AnchorService, DuplicateAnchorError, ResourceNotFoundError, CanonicalizationError } from '../src/anchor/anchor.service.js';
```

Wait, but the errors for the source files mean `anchor.service.ts` has issues. But again, resolution is separate from compilation errors. As long as the file exists and exports those names, importing works (the test will compile against the declared types).

Hmm wait, but if `anchor.service.ts` has a compile error like `TS2307: Cannot find module './anchor.repository'`, then the types exported by `anchor.service.ts` might be `any` or broken. But the test would still compile (importing from a module with errors is fine; the errors are reported at the source, not the importer). Actually, when a module fails to compile, its exports might be typed as `any` in some cases, but the import statement itself doesn't error.

Actually, the key realization: The task is ONLY about making `test/anchor.controller.spec.ts` not produce errors. Errors in other files are out of scope (I'm told "Change nothing the messages do not name" — and the other files' errors are named but I'm only rewriting the test file).

Wait, re-reading: "Rewrite `test/anchor.controller.spec.ts` complete, fixing what these messages require of this file." — So I fix what the messages require OF THIS FILE. The messages that name this file are the two TS2307. So I fix those two. The other files' errors remain (not my job here).

So my test file, after rewrite, should have ZERO errors of its own. The two TS2307 go away (via `.js` extensions). And I don't introduce new errors.

Now, will importing from `anchor.service.js` (which has its own errors) cause NEW errors in my test file? Only if I use types incorrectly. If I import `AnchorService` and use it as a token, that's fine. If I import types like `AnchorProof`, that's fine as long as they're exported.

But here's a risk: if `anchor.service.ts` fails to compile such that `AnchorProof` isn't properly typed, my usage might error. But typically, even with errors in the source, the exported types are still available (the compiler does best-effort). And the specific errors in `anchor.service.ts` are about imports (TS2307, TS2835), not about the type definitions themselves. The types `AnchorProof`, `VerifyResult`, etc. are defined in `anchor.service.ts` directly (per plan), so they should be fine.

Actually wait, let me reconsider. If `anchor.service.ts` line 1-2 import `./anchor.repository` and fail (TS2307), then the types from that import (like `AnchorRecord`, `NewAnchor`) would be `any`. But `AnchorProof`, `MismatchReport`, `VerifyResult` are defined locally in `anchor.service.ts` (per plan section 3). So they're fine.

OK so my plan for the test file:
- Import `AnchorController` from `../src/anchor/anchor.controller.js`.
- Import `AnchorService` (value) and relevant types from `../src/anchor/anchor.service.js`.
- Use `Test.createTestingModule` with the controller and a mock service provider.
- Get the controller, call methods, assert behavior.

But I need to handle error mapping. The plan says the controller validates input and delegates. Where's the error→envelope mapping? 

Let me reconsider. The conventions say errors use one envelope. In NestJS, this is typically done via a global `ExceptionFilter` or by throwing `HttpException` with the envelope shape. The plan says "HTTP mapping: 404 for resource_not_found, 409 for duplicate_anchor, 400 for hash_mismatch."

But the plan's controller spec says "Validates input shape, delegates to the service; zero business logic." It doesn't mention error mapping in the controller. So maybe there's a global exception filter (not in the plan, but implied by conventions). OR the controller catches errors and throws HttpException.

Since I can't see the source, and the plan doesn't specify an exception filter, I'll assume the controller handles validation errors (400) and delegates service errors. Hmm, this is getting complicated.

Let me simplify. For the controller test, I'll focus on what's clearly specified:
1. Delegation: valid input → service method called with correct args, response = service return.
2. Validation: invalid input (e.g., missing content) → 400 error envelope.

For the validation test, I need to know how the controller signals invalid input. If it throws a NestJS `BadRequestException`, then over HTTP it's a 400. If I call the method directly, it throws `BadRequestException`.

Hmm, but the error envelope format is `{ error: { code, message, details } }`. A plain `BadRequestException` produces `{ statusCode: 400, message: ..., error: 'Bad Request' }` — NOT the envelope. So there must be a custom exception or filter for the envelope.

This is where I'm uncertain. Let me use `// ASSUMPTION:` lines.

Actually, let me reconsider the testing strategy to minimize assumptions. 

The cleanest behavior test that I'm confident about:
- Provide a mock service.
- Call the controller's anchor method with valid input.
- Assert: service.anchorDocument called with (documentId, version as number, content), and the method returns the service's proof.
- Call with invalid input (missing content).
- Assert: it rejects/throws (validation), and service.anchorDocument NOT called.

For the "invalid input" case, I'll assert that it throws (some error) and the service is not called. I won't over-specify the exact exception type to avoid guessing. But the conventions require the envelope... 

Hmm, wait. Let me reconsider. Maybe I'm overcomplicating. Let me reconsider whether the controller test should be an HTTP-level test (supertest) which would naturally exercise whatever error handling is in place.

If I use supertest:
- Valid request → 201/200 with proof.
- Invalid request (missing content) → 400 with envelope.
- Service throws DuplicateAnchorError → 409 with envelope.

But this requires supertest AND requires the error handling to be wired (exception filter). If the exception filter isn't in the test module, the envelope won't appear.

Ugh, too many unknowns. Let me go with direct method calls and be conservative:

Test 1 (delegation - anchor): 
- mock service.anchorDocument resolves to a proof.
- call controller.anchor({documentId, version}, {content}).
- assert resolves to the proof.
- assert service.anchorDocument called with correct args.

Test 2 (delegation - verify):
- mock service.verify resolves to a result.
- call controller.verify({documentId, version}, {content}).
- assert resolves to the result.

Test 3 (validation - missing content):
- call controller.anchor({documentId, version}, {}) or with undefined content.
- assert rejects (throws).
- assert service.anchorDocument NOT called.

Test 4 (validation - version not a number, maybe):
- call controller.anchor({documentId, version: 'abc'}, {content}).
- assert rejects.

For the validation tests, I'll assert that it throws AND the service is not called. I'll use `// ASSUMPTION:` for the exact exception type.

Wait, but "Never assert only that a call happens." — my tests DO assert on the return value (the proof/result) AND the error behavior, not just call counts. Good.

But also: "A test ... that only exercises the happy path, is worse than no test." — I have validation (error) tests too. Good.

Now, the version param: over HTTP it's a string. The controller must convert it to a number for the service (since `anchorDocument(documentId: string, version: number, content)`). So the controller does `Number(version)` or `parseInt`. And validates it's a valid number.

So in my direct call, I pass `version` as a string (like over HTTP) and the controller converts it. Let me pass `version: '3'` and assert service called with `version: 3` (number).

Hmm, but I'm assuming the controller converts to number. The plan says `anchorDocument(documentId: string, version: number, content)`. And the controller takes `@Param() p` where version is a string (from URL). So the controller MUST convert. I'll assume it does `Number(version)` and validates.

Actually, wait. Let me reconsider — maybe the controller uses `@Param('version', ParseIntPipe)`. But the plan says `@Param() p` (all params), so no pipe. So manual conversion. I'll assume `Number(version)`.

Let me also reconsider: does the controller validate `content` is an object? The plan says body is `{ content: unknown }`. "Validates input shape" — probably checks `content` is present (not undefined). Maybe also that it's not null. I'll test missing content → error.

Alright, let me also think about the import of types. Do I need `AnchorProof` and `VerifyResult` types? For typing the mock's return values, it'd be nice but not strictly necessary (I can use `as` or just let TS infer). To minimize risk, I might import them. But if they're not exported correctly... The plan says they're exported from `anchor.service.ts`. I'll import them.

Actually, to be safe and reduce coupling to exact type shapes, let me define the mock return values inline with the structure from the plan:
- `AnchorProof`: `{ documentId, version, contentHash, txId, blockNumber }`
- `VerifyResult`: `{ ok: true, proof } | { ok: false, mismatch }`

I'll import the types to type things properly. Let me import `AnchorProof`, `VerifyResult` from the service.

Now let me also reconsider: do I need to import `CanonicalizationError`, `DuplicateAnchorError`, `ResourceNotFoundError`? For testing the controller's error mapping, maybe. But since I'm not sure how the controller maps them, I'll keep it minimal. Actually, for a thorough test, I might want to test that when the service throws `DuplicateAnchorError`, the controller produces a 409. But again, I don't know if the controller does that or a filter does.

Let me keep the controller test focused on: delegation + input validation. That's what the plan says for this file: "endpoint validation and delegation to the service."

So my tests:
1. anchor endpoint delegates to service.anchorDocument with (documentId, version:number, content) and returns the proof.
2. verify endpoint delegates to service.verify with (documentId, version:number, content) and returns the result.
3. anchor endpoint rejects when content is missing (validation), service not called.
4. verify endpoint rejects when content is missing (validation), service not called.
5. Maybe: anchor endpoint rejects when version is not a valid number, service not called.

That covers "endpoint validation and delegation."

Now let me write it using `Test.createTestingModule`.

Wait, but there's a subtlety with `Test.createTestingModule` and getting the controller. Let me write:

```ts
import { Test } from '@nestjs/testing';
import { AnchorController } from '../src/anchor/anchor.controller.js';
import { AnchorService, type AnchorProof, type VerifyResult } from '../src/anchor/anchor.service.js';

describe('AnchorController', () => {
  let controller: AnchorController;
  const service = {
    anchorDocument: vi.fn(),
    verify: vi.fn(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AnchorController],
      providers: [{ provide: AnchorService, useValue: service }],
    }).compile();

    controller = moduleRef.get(AnchorController);
    vi.clearAllMocks();
  });

  it('delegates anchor to the service with parsed version and returns the proof', async () => {
    const proof: AnchorProof = { documentId: 'doc-1', version: 3, contentHash: 'hash', txId: 'tx-1', blockNumber: 42 };
    service.anchorDocument.mockResolvedValue(proof);

    const result = await controller.anchor({ documentId: 'doc-1', version: '3' }, { content: { patient: 'x' } });

    expect(result).toEqual(proof);
    expect(service.anchorDocument).toHaveBeenCalledWith('doc-1', 3, { patient: 'x' });
  });
  ...
});
```

Wait, but I need to be careful about the method signature. If the controller method is `anchor(p: { documentId: string; version: string }, body: { content: unknown })`, then calling `controller.anchor({ documentId: 'doc-1', version: '3' }, { content: {...} })` is correct.

But what if the controller method signature is different, e.g., `anchor(documentId: string, version: string, body: { content: unknown })` (three separate params via `@Param('documentId')`)? The plan explicitly says `@Param() p`, so it's one object. I'll go with that and add an `// ASSUMPTION:` line.

Hmm, actually, let me reconsider. The plan is the governing document. It says `@Param() p`. So the method takes a single params object. I'll trust the plan. But I'll add an `// ASSUMPTION:` noting I'm following the plan's signature since I can't see the source.

Actually, the instruction says: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly." The compiler messages don't refer to a shape I can't see — they're just module resolution errors. So strictly, I don't NEED `// ASSUMPTION:` lines for the controller signature. But it's good practice to note assumptions about shapes I'm inferring from the plan rather than seeing.

Let me reconsider — the `// ASSUMPTION:` requirement is specifically for when "a message refers to a shape you cannot see." The messages here are TS2307 (module not found) and the fix is `.js` extensions. There's no message referring to a shape I can't see. So I don't strictly need `// ASSUMPTION:` lines. But adding a couple where I infer controller method signatures from the plan is reasonable and shows diligence. Actually, let me be judicious — I'll add them where I'm genuinely inferring (controller method signatures, error behavior).

Hmm, wait. Let me reconsider the whole approach once more. There's a real risk: if I get the controller method signatures wrong, my test file will have NEW compile errors (e.g., "Expected 3 arguments, but got 2" or "Property 'anchor' does not exist"). That would be bad — I'd be introducing errors.

To minimize this risk, maybe I should use supertest (HTTP-level), which only needs routes and doesn't need method signatures. Let me reconsider supertest availability.

Actually, the safest thing that definitely compiles: test via HTTP with supertest IF available. But I don't know if supertest is installed.

Let me think about which is more likely to be available:
- `@nestjs/testing` — ships with `@nestjs/core` (which is definitely installed since it's NestJS). So `@nestjs/testing` is available.
- `supertest` — separate package, commonly installed but not guaranteed.

Given the conventions mention "Vitest for tests" and NestJS, and the plan's test file reads only `src/anchor/anchor.controller.ts`, I think a unit test (direct method calls or via testing module) is intended, not supertest. The plan says the controller test "reads: src/anchor/anchor.controller.ts" — meaning it imports the controller directly. That suggests direct instantiation or testing module, not full HTTP.

Actually "reads" in the manifest means the test file imports from that source. So `test/anchor.controller.spec.ts` imports `src/anchor/anchor.controller.ts`. That's consistent with direct method calls or testing module.

OK let me go with the testing module + direct method calls. This is the standard NestJS controller unit test pattern and doesn't need supertest.

Now, to handle the risk of wrong method signatures: I'll follow the plan's signature exactly (`anchor(p, body)` where `p = { documentId, version }`). And I'll add an `// ASSUMPTION:` line.

But actually, hold on. Let me reconsider if I even need the testing module. If the controller is `constructor(private readonly anchorService: AnchorService)`, I can just do `new AnchorController(service as unknown as AnchorService)`. That's simpler and avoids the testing module. But it requires knowing the constructor takes the service as the first (and only) param.

The plan says the controller depends on the service (delegates to it). Standard NestJS: `constructor(private readonly service: AnchorService)`. I'll assume that.

Using `new AnchorController(mockService as AnchorService)` is simplest. Let me do that. It avoids `@nestjs/testing` dependency entirely (in case it's not set up). Wait, but `@nestjs/testing` should be available. But direct instantiation is even simpler and has fewer moving parts.

Hmm, but direct instantiation with `as AnchorService` cast — the mock needs to satisfy the `AnchorService` interface. If I cast with `as unknown as AnchorService`, it compiles regardless. 

Let me go with direct instantiation:

```ts
import { AnchorController } from '../src/anchor/anchor.controller.js';
import { AnchorService, type AnchorProof, type VerifyResult } from '../src/anchor/anchor.service.js';

describe('AnchorController', () => {
  const service = {
    anchorDocument: vi.fn(),
    verify: vi.fn(),
  };
  const controller = new AnchorController(service as unknown as AnchorService);

  beforeEach(() => vi.clearAllMocks());

  it('...', async () => {
    ...
  });
});
```

This is clean. But I need `vi` from vitest — import `{ describe, it, expect, vi, beforeEach } from 'vitest'`.

Now, the risk: `new AnchorController(service as unknown as AnchorService)` — if the controller's constructor takes a different number/type of params, this errors. But per plan, it takes the service. I'll add `// ASSUMPTION:`.

Actually, wait. Let me reconsider using the testing module vs direct instantiation for robustness. 

With direct `new AnchorController(...)`, if the constructor signature differs, compile error. With testing module + DI, I provide `{ provide: AnchorService, useValue: service }` and NestJS injects it — I don't need to know the constructor signature, just that it depends on `AnchorService`. This is more robust!

But then to call methods, I still need method signatures. So the testing module doesn't help with method signature risk; it only helps with constructor risk.

Given both approaches need method signatures (unless supertest), let me just pick one. The testing module is more "proper" NestJS and handles DI. Let me use it. It also means I don't need to cast the mock to `AnchorService` (the provider does it).

Wait, with the testing module, `providers: [{ provide: AnchorService, useValue: service }]` — `service` is my mock object. NestJS will inject it wherever `AnchorService` is requested. I don't need to cast. Good.

Then `controller = moduleRef.get(AnchorController)`. Then call `controller.anchor(...)`.

Let me go with the testing module approach. It's the canonical NestJS controller unit test and most likely matches how the project is set up.

Now, let me reconsider the method call signature once more. `controller.anchor(p, body)`. What's the type of `p`? It's `@Param()` so it's `Record<string, string>` essentially (all route params as strings). So `p: { documentId: string; version: string }`. I'll pass `{ documentId: 'doc-1', version: '3' }`.

And `body: { content: unknown }`. I'll pass `{ content: {...} }`.

For the validation test (missing content), I pass `{ content: undefined }` or `{}`. Let me pass `{ content: undefined }`. Hmm, but `body: { content: unknown }` — passing `{}` means `content` is `undefined`. That should trigger validation. Let me pass `{ content: undefined }` to be explicit. Actually, to type-check, `{ content: undefined }` is assignable to `{ content: unknown }`. Good. Or I pass `body` as an object without content. Let me just do `{ content: undefined }`.

Wait, actually, I want to test the validation logic. What does "validates input shape" mean precisely? Possibilities:
- content must be present (not undefined/null).
- version must parse to a number.

I'll test both:
1. Missing content → throws, service not called.
2. Non-numeric version → throws, service not called.

For the version test: `controller.anchor({ documentId: 'doc-1', version: 'not-a-number' }, { content: {...} })` → should throw (validation) and service not called.

But wait — what if the controller uses `Number(version)` and `Number('not-a-number')` is `NaN`, and the controller checks `Number.isFinite`? Then it throws. Good. But what if the controller doesn't validate version at all and just passes `NaN`? Then it wouldn't throw, and my test would fail. Hmm.

The plan says "Validates input shape." I'll assume version is validated. But to be safe, maybe I should focus the validation test on `content` (which is more clearly part of "input shape" for the body). And include version validation as a second test with an `// ASSUMPTION:`.

Actually, let me reconsider. The safest validation test is the one most clearly implied: the body must contain `content`. Let me make that the primary validation test. And add version validation as a secondary with an assumption note.

Hmm, but actually — I realize I should think about whether the controller even does validation that throws synchronously vs. returning a 400 response. In NestJS, "validates input shape" in the controller (zero business logic) likely means: check `if (!body.content) throw new BadRequestException(...)` or similar. When called directly, this throws a `BadRequestException`. So `await controller.anchor(...)` rejects with a `BadRequestException`.

So my assertion: `await expect(controller.anchor(...)).rejects.toThrow()`. And `expect(service.anchorDocument).not.toHaveBeenCalled()`.

But to be more specific per conventions (error envelope), maybe the controller throws a custom error or the filter formats it. Since I'm calling directly (no HTTP), the filter isn't involved. So I'd see the raw exception. I'll assert it throws (generic) and not over-specify the type, with an `// ASSUMPTION:` note.

Actually, let me reconsider — should I assert on the specific exception? The conventions say errors use one envelope with a `code`. But that's the HTTP response format, produced by an exception filter. In a direct method call test, I'd see the thrown exception, not the envelope. So asserting on the envelope in a direct test is wrong.

To properly test the envelope, I'd need HTTP-level testing (supertest) with the filter wired. That's more setup and more assumptions. 

Given the constraints, I'll test:
- Delegation (happy path with real assertions on return value + args).
- Validation (throws, service not called).

And I'll note with `// ASSUMPTION:` that the HTTP error envelope mapping (status codes) is assumed to be handled by a global exception filter / controller and is not asserted here because it's outside the controller's direct-call surface.

Hmm, wait. Actually, let me reconsider whether I should test the error envelope at all. The plan's controller test description is "endpoint validation and delegation to the service." So validation + delegation. The envelope mapping might be considered part of "validation" output. But I'll keep it to "throws on invalid input."

Let me now also reconsider: is there a risk that the controller method is named differently? The plan says `anchor` and `verify`. I'll use those.

Let me also reconsider the return types. `anchor` returns `Promise<AnchorProof>`. `verify` returns `Promise<VerifyResult>`. My mock resolves to those. Good.

Now, let me also double check: the plan says `anchorDocument(documentId, version, content)` on the service. The controller calls `service.anchorDocument(documentId, Number(version), body.content)`. So I assert `service.anchorDocument` called with `('doc-1', 3, { patient: 'x' })`.

Wait, but does the controller pass `body.content` or the whole `body`? The service signature is `anchorDocument(documentId: string, version: number, content: unknown)`. So it passes `content` (the value), not the body. So `service.anchorDocument('doc-1', 3, { patient: 'x' })` where `{ patient: 'x' }` is `body.content`. Good.

Similarly `verify(documentId, version, content)` → `service.verify('doc-1', 3, { patient: 'x' })`.

Alright. Let me also think about whether I need to import `vi` and the vitest globals. The project uses Vitest. I'll import explicitly: `import { beforeEach, describe, expect, it, vi } from 'vitest';`.

Now let me reconsider the `// ASSUMPTION:` lines. The instruction: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly." 

The compiler messages for this file are TS2307 (module not found) — they don't refer to a shape. So I don't strictly need `// ASSUMPTION:` lines for the messages. But I AM inferring controller method signatures and constructor from the plan (not seeing source). To be safe and transparent, I'll add a couple of `// ASSUMPTION:` lines for the inferred shapes. This aligns with the spirit (don't guess repeatedly without noting it).

Actually, let me reconsider. Adding too many `// ASSUMPTION:` lines might be seen as noise. But the instruction explicitly provides this mechanism, so using it appropriately is good. I'll add:
- One for the controller method signature (params object + body).
- One for the constructor injection of AnchorService.
- One for the validation behavior (throws on missing content / bad version).

Let me keep them concise.

Now, let me also reconsider: the task says "Reply with the complete content of `test/anchor.controller.spec.ts` inside one fenced block, and nothing else." So my entire reply is just the fenced code block. No prose.

Let me now also reconsider whether I should worry about the other errors in the workspace. The task is ONLY about this file. So no.

But wait — there's a subtle issue. If I import from `../src/anchor/anchor.service.js` and that file has errors, does my import cause issues? Let me reconsider. The import statement `import { AnchorService } from '../src/anchor/anchor.service.js'` — under node16, `.js` → resolves to `anchor.service.ts`. The module is found (no TS2307). The module has its own errors, but that doesn't cause errors in MY file. My file compiles fine as long as I use the imported names correctly.

But here's a concern: if `anchor.service.ts` fails to export `AnchorService` properly due to its errors... no, the class is defined there and exported (per plan). The errors are in its imports, not its own definitions. So `AnchorService` is a valid export.

Also, `AnchorProof` and `VerifyResult` types are defined in `anchor.service.ts` (per plan section 3). So importing them is fine.

Wait, let me double-check the plan: 
```
`src/anchor/anchor.service.ts`
- `type AnchorState = 'pending' | 'broadcasting' | 'confirmed' | 'failed'`
- `interface AnchorRecord {...}`
- `interface NewAnchor {...}`
- `interface AnchorProof { documentId: string; version: number; contentHash: string; txId: string; blockNumber: number }`
- `interface MismatchReport {...}`
- `type VerifyResult = { ok: true; proof: AnchorProof } | { ok: false; mismatch: MismatchReport }`
- `class AnchorService {...}`
- `class DuplicateAnchorError extends Error {...}`
- `class ResourceNotFoundError extends Error {...}`
```

Yes, `AnchorProof`, `VerifyResult`, `AnchorService` are all in `anchor.service.ts`. Good.

Now, one more consideration: the plan says the controller "Validates input shape." If the controller uses a NestJS `ValidationPipe` or class-validator DTO, then the "body" might be a DTO class, not `{ content: unknown }`. But the plan explicitly says `@Body() body: { content: unknown }`, so it's a plain object, no DTO. Good, I'll trust the plan.

Let me now write the test file.

Actually, wait. Let me reconsider the testing module approach vs direct instantiation one more time, specifically for the `beforeEach` and mock reset.

With the testing module:
```ts
let controller: AnchorController;
const service = { anchorDocument: vi.fn(), verify: vi.fn() };

beforeEach(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AnchorController],
    providers: [{ provide: AnchorService, useValue: service }],
  }).compile();
  controller = moduleRef.get(AnchorController);
  vi.clearAllMocks();
});
```

This works. `service` is shared across tests (module-level const), and I clear mocks in beforeEach. Actually, creating a new module per test is a bit heavy but fine. Alternatively, create once in `beforeAll`. But `beforeEach` with clear is standard.

Hmm, actually creating the module in `beforeEach` for each test is wasteful but correct. Let me create it once in a variable at describe level and just clear mocks. But `Test.createTestingModule().compile()` is async, so I need `beforeAll` or a top-level await. Let me use `beforeEach` for simplicity, or store the app.

Actually, let me reconsider direct instantiation to keep it simple and avoid `@nestjs/testing` entirely:

```ts
const service = { anchorDocument: vi.fn(), verify: vi.fn() };
const controller = new AnchorController(service as unknown as AnchorService);

beforeEach(() => vi.clearAllMocks());
```

This is simplest. The only assumption is the constructor takes `AnchorService` as the first param. I'll note it.

But wait — is there a risk the controller has other constructor deps (like a logger)? Unlikely for this simple controller. The plan says it depends on the service. I'll assume one dep.

Between the two, direct instantiation is simpler and has fewer dependencies (no `@nestjs/testing`). But it assumes the constructor signature. The testing module assumes DI works and the service is the only dep, but doesn't assume constructor param order.

I think the testing module is slightly more robust (doesn't assume constructor signature, just DI token). But it requires `@nestjs/testing`. Since the project is NestJS, `@nestjs/testing` should be available.

Let me go with the testing module — it's the idiomatic NestJS way and more robust to constructor variations. And I'll get the controller via `moduleRef.get(AnchorController)`.

Hold on, but if I use the testing module and the controller has a constructor dep that's not provided (e.g., if it needs something else), `moduleRef.get` would throw at runtime (not compile). But per plan, it only needs the service. So providing just the service is enough.

OK, decision: testing module approach.

Wait, actually, let me reconsider potential compile issues with the testing module. `Test.createTestingModule({ controllers: [AnchorController], providers: [{ provide: AnchorService, useValue: service }] })`. 

- `AnchorController` is a class — fine.
- `AnchorService` used as a token — it's a class, so `provide: AnchorService` works.
- `useValue: service` — my mock object. Fine.

Then `moduleRef.get(AnchorController)` returns the controller instance typed as `AnchorController`. Good.

Then `controller.anchor(...)` — needs method to exist with the right signature. Per plan, yes.

Alright, let me also make sure I handle the `version` param type. In `@Param()`, all params are strings. So `p.version` is a string. The controller converts to number. I pass `version: '3'` (string). Good.

Let me write the tests now.

Test 1: anchor delegates and returns proof.
```ts
it('delegates the anchor request to the service with a parsed version and returns its proof', async () => {
  const proof: AnchorProof = { documentId: 'doc-1', version: 3, contentHash: 'h', txId: 'tx-1', blockNumber: 42 };
  service.anchorDocument.mockResolvedValue(proof);

  const result = await controller.anchor({ documentId: 'doc-1', version: '3' }, { content: { patient: 'p-9' } });

  expect(result).toEqual(proof);
  expect(service.anchorDocument).toHaveBeenCalledTimes(1);
  expect(service.anchorDocument).toHaveBeenCalledWith('doc-1', 3, { patient: 'p-9' });
});
```

Test 2: verify delegates and returns result.
```ts
it('delegates the verify request to the service with a parsed version and returns its result', async () => {
  const ok: VerifyResult = { ok: true, proof: { documentId: 'doc-1', version: 3, contentHash: 'h', txId: 'tx-1', blockNumber: 42 } };
  service.verify.mockResolvedValue(ok);

  const result = await controller.verify({ documentId: 'doc-1', version: '3' }, { content: { patient: 'p-9' } });

  expect(result).toEqual(ok);
  expect(service.verify).toHaveBeenCalledWith('doc-1', 3, { patient: 'p-9' });
});
```

Test 3: anchor rejects when content missing, service not called.
```ts
it('rejects an anchor request that carries no content and does not delegate', async () => {
  await expect(controller.anchor({ documentId: 'doc-1', version: '3' }, { content: undefined })).rejects.toThrow();
  expect(service.anchorDocument).not.toHaveBeenCalled();
});
```

Test 4: verify rejects when content missing, service not called.
```ts
it('rejects a verify request that carries no content and does not delegate', async () => {
  await expect(controller.verify({ documentId: 'doc-1', version: '3' }, { content: undefined })).rejects.toThrow();
  expect(service.verify).not.toHaveBeenCalled();
});
```

Test 5: anchor rejects when version is not numeric, service not called.
```ts
it('rejects an anchor request whose version is not numeric and does not delegate', async () => {
  await expect(controller.anchor({ documentId: 'doc-1', version: 'not-a-number' }, { content: { patient: 'p-9' } })).rejects.toThrow();
  expect(service.anchorDocument).not.toHaveBeenCalled();
});
```

Hmm, test 5 assumes version validation. Let me add an `// ASSUMPTION:` for it. Actually, let me reconsider whether to include test 5. If the controller doesn't validate version, this test fails at runtime (not compile). The task is about compile errors, but I want the test to be correct/passing. Since I can't verify runtime behavior, and the plan says "validates input shape," I'll include it but note the assumption. Actually, to reduce risk of a failing test, maybe I should keep validation tests focused on what's most certain.

The most certain validation: the body must have `content`. That's clearly "input shape." Version validation is also likely but slightly less certain. Let me include both but mark version one with an assumption.

Actually, you know what, let me reconsider the entire risk profile. The PRIMARY goal is a compiling file. The SECONDARY goal is sensible tests. Since I can't run the tests, I should write tests that are MOST LIKELY correct per the plan. The plan clearly says "Validates input shape" and "delegates to the service." 

Delegation tests (1, 2) are very safe — they just check pass-through.
Validation tests (3, 4) for missing content are fairly safe — "validates input shape" strongly implies content presence check.
Version validation (5) is a bit more speculative.

Let me include 1-4 and add 5 with an assumption note, OR drop 5. I'll include a version validation test because "input shape" for the route params (version) is part of it, and mark it. Actually, let me keep it but be ready for it to be the one that might not match. Hmm.

Let me reconsider: the instruction emphasizes not dropping requirements and using `// ASSUMPTION:` for unreconcilable shapes. It doesn't say my tests must pass at runtime (I can't run them). But a good test file should be correct. I'll write tests that align with the plan and add assumptions where I infer.

Let me finalize with tests 1-5, adding `// ASSUMPTION:` lines for:
- Controller method signatures (params object + body) — inferred from plan.
- Constructor/DI on AnchorService — inferred from plan.
- Validation behavior (throws) — inferred; note the HTTP envelope is handled elsewhere.
- Version numeric validation — inferred.

Let me write clean assumption comments.

Now, let me reconsider the imports once more for correctness under node16:
- `import { Test } from '@nestjs/testing';` — package import, no extension needed. Good.
- `import { AnchorController } from '../src/anchor/anchor.controller.js';` — relative, needs `.js`. Good.
- `import { AnchorService } from '../src/anchor/anchor.service.js';` — relative, needs `.js`. Good.
- `import type { AnchorProof, VerifyResult } from '../src/anchor/anchor.service.js';` — I can combine with the value import or separate. Let me do: `import { AnchorService, type AnchorProof, type VerifyResult } from '../src/anchor/anchor.service.js';`. This is valid TS.

Wait, does the project's tsconfig allow `type` modifier in imports? With `verbatimModuleSyntax` or `isolatedModules`, using `type` for type-only imports is good practice. It's supported in TS 4.5+. Should be fine.

Actually, to be safe with `verbatimModuleSyntax`, importing types with `type` keyword is the correct approach. Let me use it.

Now, `vi` from vitest: `import { beforeEach, describe, expect, it, vi } from 'vitest';`.

Let me also double check: do I use `vi`? Yes, for `vi.fn()` and `vi.clearAllMocks()`. Good.

Let me reconsider the `beforeEach` creating the module. Actually, creating a new testing module per test is fine but let me reconsider performance/correctness. Each `Test.createTestingModule(...).compile()` creates a fresh module with the controller and my mock service. Since `service` is a shared const, the same mock functions are used. `vi.clearAllMocks()` in beforeEach resets them. This works.

But actually, there's a subtlety: if I create the module in `beforeEach`, and each test gets a fresh controller, that's clean. Let me do that.

Alternatively, create once in `beforeAll` and reuse. But then I need to store the controller. Let
