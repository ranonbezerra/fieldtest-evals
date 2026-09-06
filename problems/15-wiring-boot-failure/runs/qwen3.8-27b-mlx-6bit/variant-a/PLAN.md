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
