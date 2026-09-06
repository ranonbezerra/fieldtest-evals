# DIAGNOSIS

## Defect 1 — Circular import of `QUEUES` (TDZ at runtime)

### What was unresolvable

`QUEUES` was declared as a `const` inside a feature file (the notifications service or a sibling feature module) and imported by another feature file that loaded earlier in the ESM initialisation order. At runtime, the importing module reached the `const QUEUES` reference before the declaring module had finished its own top-level evaluation, producing:

```
ReferenceError: Cannot access 'QUEUES' before initialization
    at file:///…/dist/notifications/notifications.service.js:5:29
```

No NestJS log line appeared because the process died during module evaluation, before `NestFactory.create` was ever reached.

### Why `tsc` could not see it

TypeScript resolves imports at the *type* level. The symbol `QUEUES` exists in the declaring module, so the import type-checks cleanly. `tsc` does not model ESM initialisation order or temporal-dead-zone semantics; a circular `import` between two `.ts` files is legal TypeScript. The error is purely a runtime ordering artifact of the emitted ESM, invisible to the compiler.

### Why the unit suite could not see it

Unit tests import a single service file with its dependencies mocked or faked. The test runner's module graph is constructed per-test-file, and the circular path through the full `dist/` layout is never traversed. In addition, when a test imports `notifications.service.ts` directly, the circular partner may load in an order that happens to initialise `QUEUES` first, masking the bug.

### Minimal fix

Move `QUEUES` (and its `QueueName` type) to a dedicated leaf file, `src/common/queues.ts`, that imports nothing from `src/`. Every consumer imports it from that path. The cycle is broken structurally—no `forwardRef`, no reordering of top-level statements.

---

## Defect 2 — `ExportService` not exported across the module boundary

### What was unresolvable

`UsersService` declares `ExportService` as a constructor dependency, but the module that provides `ExportService` (the export module) did not include it in its `exports` array, or the users module did not list the export module in its `imports`. NestJS therefore could not resolve the token when building `UsersModule`'s provider graph:

```
NestDependencyUnknownTypeError: Nest cannot create the module instance.
The following dependencies were not found: ExportService
```

(Revealed only after Defect 1 was fixed, because the process no longer died before Nest started.)

### Why `tsc` could not see it

The class `ExportService` is imported in `UsersService`'s file, so the type-check passes. The `imports` and `exports` arrays on `@Module` are plain string/class token lists; TypeScript verifies they are valid class references but has no knowledge of the DI contract that "a provider consumed by module A must be exported by a module in A's `imports`." That invariant is enforced only at NestJS runtime.

### Why the unit suite could not see it

Each unit test constructs its service in isolation with `Test.createTestingModule({ providers: [UsersService, { provide: ExportService, useValue: mock } ] })`. The fake satisfies the constructor; the real module graph is never assembled. A passing unit test therefore proves nothing about whether `ExportModule.exports` actually contains `ExportService`.

### Minimal fix

In the export module: add `ExportService` to both `providers` and `exports`. In the users module: add the export module to `imports`. No code in either service changes.

---

## Defect 3 — `RetryProcessor` not exported / imported where consumed

### What was unresolvable

`NotificationsService` depends on `RetryProcessor` (to enqueue retry jobs). The retry module provided `RetryProcessor` but either failed to export it or the notifications module failed to import the retry module. Same class of unresolvable token as Defect 2, now visible only after Defects 1 and 2 were resolved:

```
NestDependencyUnknownTypeError: …dependencies were not found: RetryProcessor
```

### Why `tsc` could not see it

Identical reasoning to Defect 2. The class reference type-checks; the DI wiring invariant is outside the compiler's model.

### Why the unit suite could not see it

The notifications unit test fakes `RetryProcessor` in its providers array. The test never exercises the real module boundary, so a missing `exports`/`imports` pair is invisible.

### Minimal fix

In the retry module: add `RetryProcessor` to `exports`. In the notifications module: add the retry module to `imports`. No service code changes.

---

## Defect 4 — `AppModule` missing feature-module imports

### What was unresolvable

The root module (`AppModule`) is the composition root. If any of the four feature modules (notifications, users, export, retry) is absent from its `imports` array, NestJS never registers that module's providers in the global DI graph. Controllers or services in a *different* imported module that depend on a provider from the missing module will fail to resolve at boot.

This defect is the last one to surface because it can be masked if the dependent module happens to be imported transitively through another path, or if the missing module's sole consumer is also missing (and thus not instantiated).

### Why `tsc` could not see it

The `imports` array is a compile-time list of class references. Omitting one entry is syntactically and type-correctly valid TypeScript. The compiler cannot infer that "every module with a controller or a cross-module provider must appear here."

### Why the unit suite could not see it

Unit tests build a minimal testing module per service; they never import `AppModule`. The composition root is, by definition, only exercised when the full application graph is assembled.

### Minimal fix

Ensure `AppModule.imports` lists all four: `NotificationsModule`, `UsersModule`, `ExportModule`, `RetryModule`.

---

## Regression guard: `test/wiring.spec.ts`

A unit test with faked repositories cannot catch any of the above defects because it bypasses the module graph. The permanent check is a wiring test that:

1. Calls `Test.createTestingModule({ imports: [AppModule] }).compile()` with only the `PrismaService` provider overridden (no DB connection).
2. Asserts that key cross-boundary providers (`NotificationsService`, `ExportService`, `RetryProcessor`) are retrievable from the compiled module.

`compile()` walks the full DI graph exactly as production does. Any missing `exports`, any missing `imports`, and any residual TDZ from a circular file import all throw before the test body executes. A passing typecheck is *not* this check; a unit test with a faked repository is *not* this check. Only assembling the real module graph exercises the wiring invariant.
