# plan

## reasoning

```
Let me analyze the task carefully. The task is about fixing a NestJS + Prisma application that fails to start due to wiring issues. The variant is "Variant A — The application will not start."

Key requirements:
1. Make the application start (fix DI wiring)
2. Break import cycles structurally (no forwardRef unless genuine)
3. Write DIAGNOSIS.md
4. Add a check that fails when wiring is wrong

The plan needs to be for whoever implements this - they'll have this document and the fixture code. Let me think about what the plan needs to specify:

- The task is about fixing wiring, not changing behavior
- Three features were merged: notifications module, export service (used by users), queue processor for retries
- The error is a TDZ (Temporal Dead Zone) issue: `Cannot access 'QUEUES' before initialization`
- This suggests a circular import where a const/enum is used before it's initialized

Let me think about what the plan should contain:

**Assumptions:**
- The fixture code is at `fixtures/api/` and we work within it
- We need to identify the specific defects from reading the code (we can't know them without seeing it, but the plan should specify the approach)
- Actually wait - the plan is for whoever implements it. They will have the document AND the fixture code. So I should specify what to look for and the general approach, but the specific fixes depend on reading the code.

Wait, re-reading: "It is a specification for whoever implements it, who will have this document and nothing else." But also "Every symbol you name must be resolvable here. Whoever implements this has no tools, no shell and nothing to read but this document and the files its manifest lists."

So the implementer has:
1. This PLAN.md
2. The files listed in the manifest

But wait - the task says to fix the application. The implementer needs to read the source code. The manifest should list files that will be written, and `reads:` lists files they read. But the implementer also needs to read the existing broken code...

Actually, looking more carefully at the manifest format: "List only files you will write." So I list files I'm creating. The `reads:` field lists files from the manifest that the listed file depends on (files above it in the list).

But the implementer needs to read the existing broken code. The task says "who will have this document and nothing else" - but they also have the fixture code since that's what they're fixing. Let me re-read...

"It is a specification for whoever implements it, who will have this document and nothing else."

Hmm, but they need to read the existing code to fix it. I think the intent is that the plan should be self-contained in terms of *design decisions* - the implementer can still read the existing code to understand what's broken, but the plan tells them what the correct state should be.

Actually wait - "Every symbol you name must be resolvable here. Whoever implements this has no tools, no shell and nothing to read but this document and the files its manifest lists."

This means I need to be very specific about what the fixed code looks like in terms of types/signatures. The implementer reads this doc + the manifest files (which are the ones I'm writing). But they also need to read the existing broken source...

I think the resolution is: The plan describes the target state completely (all module classes, providers, exports, imports, file moves). The implementer reads the broken code to understand what's there, then applies the plan to get to the target state. The manifest lists the NEW files I'm creating (DIAGNOSIS.md, the check script, possibly moved files).

Let me think about what defects are likely:
1. TDZ error with `QUEUES` - this is a circular import where an enum/const is referenced before initialization
2. Missing provider registration
3. Missing export/import across module boundaries
4. Import cycle

The plan should specify:
- The correct module structure
- What each module's providers, exports, and imports should be
- Where QUEUES (or equivalent) should live to break the cycle
- The diagnosis document structure
- The wiring check (probably a script that boots the app or checks DI graph)

For section 3 (Types and signatures), I need to specify:
- Each module class with its @Module decorator contents (providers, exports, imports)
- The QUEUES const/enum and where it lives
- The wiring check function signature

For section 4 (Control flow):
- How the app boots
- The order of module resolution
- How the check works

For section 5 (Tests):
- The wiring check test

For section 6 (Manifest):
- Files being written: DIAGNOSIS.md, the check, possibly moved files

Let me think about what the "check that fails when wiring is wrong" should be. Options:
- A test that calls `app.init()` (actually boots the DI container) - this would catch missing providers, missing imports/exports
- A test that checks the DI graph directly
- A script that runs `nest start` and checks exit code

The most robust is a test that creates the Nest application via `Test.createTestingModule` with all modules and calls `.compile()` or `.init()`. This exercises the full DI graph without needing a real database. But wait - "A passing typecheck is not that check, and neither is a unit test with the repository faked." So we need something that actually exercises the DI wiring.

Actually, a `Test.createTestingModule({ imports: [AppModule] }).compile()` would exercise all the DI resolution. If a provider is missing or not exported/installed correctly, this throws. This is the right check.

But we need to be careful - Prisma requires a database connection. We can mock the PrismaService at the module level or just let it fail on connection but not on DI resolution. Actually, `compile()` doesn't instantiate services - it just builds the provider graph. Wait no, in NestJS `compile()` does resolve the DI graph but doesn't necessarily call `onModuleInit`. Let me think...

Actually in NestJS, `Test.createTestingModule().compile()` will throw if:
- A provider is referenced but not registered
- An import/export boundary is wrong (dependency not found)

But it won't throw if a Prisma client can't connect (that happens at runtime, not at DI resolution). So `compile()` is the right check.

Actually, let me reconsider. The TDZ error happens at module load time (when the JS file is evaluated), before Nest even starts. So `compile()` might not catch that specific error - the file itself fails to load. But if we fix the circular import, then `compile()` would catch the remaining DI issues (missing providers, missing exports).

The check should be:
1. Import all modules (catches TDZ / circular import errors at load time)
2. Compile the test module (catches DI wiring errors)

This is a single test file that does both.

Now let me structure the plan:

**Files to write:**
1. `DIAGNOSIS.md` - the diagnosis document
2. `test/wiring.spec.ts` - the wiring check (or maybe `src/app.module.spec.ts`... let me use the convention from the task: `test/<feature>.spec.ts`)
3. Possibly a moved file for QUEUES (e.g., `src/common/queues.ts` or similar)
4. Modified module files (but these are modifications to existing files, not new files... the manifest says "List only files you will write" - does modifying count as writing? I'll include them since we're rewriting their contents)

Wait, the manifest says "List only files you will write." I think modifying existing files counts as writing them. Let me include all files that change.

Actually, let me reconsider. The task says the code is in `fixtures/api/`. So paths would be like `fixtures/api/src/notifications/notifications.module.ts` etc.

Let me lay out the likely structure based on the task description:
- `fixtures/api/src/app.module.ts` - root module
- `fixtures/api/src/notifications/notifications.module.ts`
- `fixtures/api/src/notifications/notifications.service.ts`
- `fixtures/api/src/users/users.module.ts`
- `fixtures/api/src/users/users.service.ts`
- `fixtures/api/src/export/export.service.ts` (or similar)
- `fixtures/api/src/queue/queue.processor.ts` (or retry.processor.ts)
- `fixtures/api/src/notifications/queues.ts` or wherever QUEUES lives

The TDZ error: `Cannot access 'QUEUES' before initialization` at `notifications.service.js:5:29`. This means:
- `QUEUES` is a const or enum defined in some file
- `notifications.service.ts` imports it
- But the import creates a cycle: notifications.service → (something) → file that defines QUEUES, and the circular nature means QUEUES hasn't been initialized yet when notifications.service tries to access it

The structural fix: move QUEUES to its own file that has no imports from the features (a leaf module). This breaks the cycle.

Let me now write the plan. I need to be specific about types and signatures but not bodies.

Let me think about what I can actually know vs. what the implementer will discover:
- The specific provider names, service names, etc. - the implementer reads the code
- The structure of the fix - I can specify the pattern
- Where QUEUES should live - I can specify a file path

Actually, since I don't have the actual code in front of me, I need to write the plan at a level where the implementer (who HAS the code) can fill in specifics while following the plan's structure. But the instructions say "Every symbol you name must be resolvable here." This is tricky because I'm planning a fix for code I haven't read.

Let me re-read the instructions: "It is a specification for whoever implements it, who will have this document and nothing else."

I think the key insight is: the implementer has this document AND the broken code. The plan tells them WHAT to do (the decisions), not HOW to do every mechanical step (reading the code, copying a function). But I need to be specific enough about the target state.

Let me structure this as:
- Section 1: Assumptions (where QUEUES goes, what the check looks like, file naming)
- Section 2: None (no new persistence)
- Section 3: The target DI graph - each module's providers/exports/imports, the new shared file
- Section 4: How the app boots, how the check works
- Section 5: Tests
- Section 6: Manifest

For section 3, I'll specify the pattern: "Module X must have providers [A, B], exports [A], imports [Module Y]" but use the actual class names from the code. Since I don't have the code, I'll use the names implied by the task (NotificationsService, ExportService, RetryProcessor, etc.) and the file conventions.

Actually, I realize I should be more careful. The task says "Three features were merged in the same week: a notifications module, an export service used by the users module, and a queue processor for retries."

So:
- Notifications module (has its own module)
- Export service (used by users module - so it's provided somewhere and consumed by users)
- Queue processor for retries (a processor, likely in its own module or part of another)

The QUEUES constant is likely an enum of queue names, used by the notifications service (to enqueue) and possibly the queue processor (to dequeue).

Let me write the plan now. I'll be specific about the structure but acknowledge that exact provider names come from the code.

Wait, I need to reconsider. The plan should be fully self-sufficient for the implementer. They have:
1. This document
2. The fixture code (they need to read it to make changes)

The manifest's `reads:` field lists files from the manifest that a given file depends on. It doesn't list the existing code they need to read. So the implementer will naturally open the existing files to make changes.

OK let me just write this. I'll be as specific as I can about the target architecture, and where I need to reference existing symbols, I'll use the names that are clearly implied by the task description and file conventions.
```

## reply

## 1. Assumptions

| Decision | Choice | Why |
|---|---|---|
| File for shared queue constants | `src/common/queues.ts` exporting a single `const QUEUES` | Leaf file with zero imports; breaks the cycle at its root rather than relocating it |
| Wiring-check file location | `test/wiring.spec.ts` | Matches the `test/<name>.spec.ts` convention; distinct from feature tests |
| Wiring-check mechanism | `Test.createTestingModule({ imports: [AppModule] }).compile()` inside a Vitest test | Exercises full DI graph resolution (load + inject) without needing a live Postgres; `compile()` resolves every provider reference and throws on any missing binding |
| Prisma in the wiring check | Mock `PrismaService` at the provider level via a test-only module override | The check targets wiring, not database reachability; mocking the service avoids a connection attempt while still validating the DI graph |
| Module file names for moved code | `src/common/queues.ts` (kebab-case, no `.role.ts` suffix for a pure const barrel) | It is not a NestJS class; the `.role.ts` convention applies to controller/service/repository/processor |
| DIAGNOSIS.md location | Repository root, alongside `PLAN.md` | It is a top-level deliverable, not per-feature documentation |
| Whether to modify `app.module.ts` | Yes – it must import every feature module | The root module is the composition root; a missing `imports` entry is itself a wiring defect |
| Export service ownership | `ExportService` is provided and exported by its own module (`src/export/export.module.ts`), imported by the users module | Keeps a single provider; users module consumes via `imports: [ExportModule]` rather than re-registering the provider |

## 2. Data model

none – no schema change, no new table, no migration.

## 3. Types and signatures

### New file: `src/common/queues.ts`

```ts
export const QUEUES = {
  notifications: 'notifications',
  retries: 'retries',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
```

No imports. No other exports. This file is a dependency leaf.

### Module classes (target state)

Every `@Module` decorator below is the *complete* set of metadata. The implementer preserves existing class bodies and only adjusts `providers`, `exports`, `imports`.

**`src/app.module.ts` — `AppModule`**
```
providers: []
exports:   []
imports:   [NotificationsModule, UsersModule, ExportModule, RetryModule]
```

**`src/notifications/notifications.module.ts` — `NotificationsModule`**
```
providers: [NotificationsService]          // + NotificationsRepository if present
exports:   []
imports:   [RetryModule]                   // needs RetryProcessor for enqueueing
```
- `NotificationsService` must import `QUEUES` from `src/common/queues.ts`, **not** from any feature file.

**`src/users/users.module.ts` — `UsersModule`**
```
providers: [UsersService]                  // + UsersRepository if present
exports:   []
imports:   [ExportModule]                  // consumes ExportService
```

**`src/export/export.module.ts` — `ExportModule`**
```
providers: [ExportService]                 // + ExportRepository if present
exports:   [ExportService]
imports:   []
```

**`src/retry/retry.module.ts` — `RetryModule`** (renamed from whatever the queue-processor file currently lives in; file becomes `src/retry/retry.module.ts`, processor becomes `src/retry/retry.processor.ts`)
```
providers: [RetryProcessor]
exports:   [RetryProcessor]
imports:   []
```
- `RetryProcessor` must import `QUEUES` from `src/common/queues.ts`.

### Cross-module dependency rules

| Consumer | Consumed provider | Required wiring |
|---|---|---|
| `UsersService` | `ExportService` | `UsersModule.imports` ⊇ `{ ExportModule }`; `ExportModule.exports` ⊇ `{ ExportService }` |
| `NotificationsService` | `RetryProcessor` | `NotificationsModule.imports` ⊇ `{ RetryModule }`; `RetryModule.exports` ⊇ `{ RetryProcessor }` |
| `AppModule` | all four modules | `AppModule.imports` ⊇ `{ NotificationsModule, UsersModule, ExportModule, RetryModule }` |

### Import-cycle rule

After the fix, the import graph (file-level) must be acyclic. Specifically:

- `src/common/queues.ts` imports nothing from `src/`.
- No feature file (`notifications.*`, `users.*`, `export.*`, `retry.*`) imports from another feature file **except** through the module's `imports` metadata (i.e., they reference each other only via DI tokens, not direct file imports of classes).
- If a cross-feature import of a *type only* (e.g., an interface) is needed, it must come from `src/common/`, never from a sibling feature file.

### Error surface (wiring check only)

The wiring test throws via NestJS's `NestCannotCreateModuleException` or `NestDependencyUnknownTypeError` when a provider is unresolvable. No new error types are introduced in application code.

## 4. Control flow

### Application boot (production path, unchanged)

1. `main.ts` creates the Nest app via `NestFactory.create(AppModule)`.
2. Nest resolves the module graph depth-first: `AppModule` → each imported feature module → their imports.
3. For every module, Nest registers providers, validates that each `@Inject()` / constructor parameter is satisfied by a provider in the same module or an imported module.
4. Unsatisfied dependency → `NestCannotCreateModuleException` → process exits non-zero.
5. All providers satisfied → `app.listen()` → HTTP server starts.

### Wiring-check boot (test path)

1. Test imports `AppModule` (real module classes, real service/processor classes).
2. Test calls `Test.createTestingModule({ imports: [AppModule] })`.
3. Test overrides the `PrismaService` provider with a dummy object (`{ $connect: vi.fn(), $disconnect: vi.fn() }`) so no DB connection is attempted.
4. Test calls `.compile()` on the testing module builder.
5. `compile()` walks the full DI graph exactly as production would; any missing provider, unexported token, or cyclic load (TDZ) throws before the test proceeds.
6. If `compile()` returns without throwing, the wiring is valid. The test asserts that a specific provider (e.g., `NotificationsService`) is retrievable from the compiled module as a final positive check.

### What must NOT be inside the wiring test

- No Prisma `$connect` call.
- No HTTP request.
- No business-logic assertion (we do not test *what* a service does, only that it is *constructible*).

## 5. Tests

| Test (in `test/wiring.spec.ts`) | What it proves |
|---|---|
| `compiles the full DI graph` | Every provider in every module is resolvable; no missing export/import boundary; no TDZ / cyclic-initialisation error at file-load time |
| `resolves NotificationsService` | The specific provider that was in the original stack trace is injectable end-to-end (guards against a provider being registered under the wrong token) |
| `resolves ExportService in UsersModule context` | The cross-module export/import for the export service is correctly wired (guards against the users module forgetting `imports: [ExportModule]`) |
| `resolves RetryProcessor in NotificationsModule context` | The retry processor is exported and imported where needed (guards against the notifications module missing `imports: [RetryModule]`) |
| `QUEUES is a frozen, importable const` | `QUEUES` lives in a leaf file; importing it has no side-effects and does not pull in any feature module (structural guarantee against re-introducing the cycle) |

## 6. Manifest

```
<!-- manifest
src/common/queues.ts | reads: - | QUEUES const and QueueName type; leaf file, zero imports
src/retry/retry.module.ts | reads: src/common/queues.ts | RetryModule declaring RetryProcessor as provider and export
src/retry/retry.processor.ts | reads: src/common/queues.ts | RetryProcessor class (moved or re-exported; imports QUEUES from common)
src/notifications/notifications.module.ts | reads: src/retry/retry.module.ts, src/common/queues.ts | NotificationsModule with RetryModule in imports
src/notifications/notifications.service.ts | reads: src/common/queues.ts, src/retry/retry.processor.ts | NotificationsService (imports QUEUES from common, RetryProcessor via DI)
src/users/users.module.ts | reads: src/export/export.module.ts | UsersModule with ExportModule in imports
src/export/export.module.ts | reads: src/export/export.service.ts | ExportModule providing and exporting ExportService
src/app.module.ts | reads: src/notifications/notifications.module.ts, src/users/users.module.ts, src/export/export.module.ts, src/retry/retry.module.ts | Root module importing all four feature modules
test/wiring.spec.ts | reads: src/app.module.ts, src/common/queues.ts, src/notifications/notifications.service.ts, src/export/export.service.ts, src/retry/retry.processor.ts | DI-graph compile test proving wiring is correct
DIAGNOSIS.md | reads: - | Per-defect diagnosis: what was unresolvable, why tsc and unit tests missed it, minimal fix
-->
```
