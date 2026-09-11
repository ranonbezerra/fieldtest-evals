# Diagnosis — the API will not start after last week's merges

## Symptom

    $ pnpm start
    ReferenceError: Cannot access 'QUEUES' before initialization
        at file:///.../dist/notifications/notifications.service.js:5:29

Nest never logged anything. The process died while Node was evaluating the
module graph — before `bootstrap()` in `main.ts` ran — so the first failure
is not dependency injection; it is module evaluation order. `tsc --noEmit`
and the unit suite were both green.

There are three defects, stacked: fixing each one reveals the next.

## Defect 1 — an import cycle through a module file (the startup crash)

**What was unresolvable.** Nothing at the type level — this is a runtime
*evaluation order* problem. `notifications.service.ts` needed the queue name
`QUEUES`, which was declared in `jobs/jobs.module.ts`: a module file, not a
leaf. That file imports `NotificationsModule`, so the import graph contains a
cycle:

    jobs/jobs.module.ts
      -> notifications/notifications.module.ts
      -> notifications/notifications.service.ts
      -> jobs/jobs.module.ts          (for QUEUES)

**Why it crashed.** ESM evaluates a module's body only after its
dependencies; a module that is already being evaluated is not re-entered —
its exports are simply still in the temporal dead zone. `app.module.ts`
imports its feature modules in alphabetical order, so `jobs` is entered
before `notifications`: `jobs.module.js` starts, pulls in
`notifications.module.js` -> `notifications.service.js`, which imports
`jobs.module.js` back — in progress, so the import is satisfied from the
partially initialised module. `notifications.service.ts` then executes
`const DELIVERY_QUEUE = QUEUES.delivery` while `jobs.module.ts` is still in
its import phase (its body, which defines `QUEUES`, has not run yet), and
Node throws `ReferenceError: Cannot access 'QUEUES' before initialization`.
(The same cycle would have crashed on the `NotificationsModule` binding
instead if the entry order had been reversed — a cycle guarantees a
dead-zone hit on whichever back-edge binding is read first.)

**Why `tsc` could not see it.** Type-checking resolves the import graph as
types. `QUEUES` has a type, the import resolves, and there is no type-level
notion of "this module's body runs before that one's" or of the temporal
dead zone. Evaluation order is a runtime property of the module graph; `tsc`
does not model it.

**Why the unit suite could not see it.** `test/users.service.spec.ts`
constructs `UsersService` by hand with a fake `PrismaService`. It never
imports `AppModule` or any feature module, so the cycle is never evaluated
and there is nothing to crash.

**Minimal fix.** Move `QUEUES` (and the derived `QueueName`) to
`src/jobs/queues.constants.ts`, a file that imports nothing. Both
`jobs.module.ts` and `notifications.service.ts` import it from there and the
cycle is gone. No `forwardRef`: the cycle was not genuine. No module needed
another module's class at runtime — a constant was simply hosted in the wrong
file, and `forwardRef` would only have taught Nest to tolerate a defect that
should not exist.

## Defect 2 — `DeliveryRepository` is not a provider anywhere

**What was unresolvable.** With defect 1 fixed, Nest got as far as wiring the
container and rejected the context: `Nest can't resolve dependencies of the
NotificationsService (...)` — `DeliveryRepository` is not available in the
`NotificationsModule` context. `NotificationsService`'s constructor requires
`DeliveryRepository`, but `notifications.module.ts` listed only
`NotificationsService` in `providers`, and no other module provides it.

**Why `tsc` could not see it.** Provider registration is runtime metadata
written by the `@Module` decorator. `tsc` verifies that `DeliveryRepository`
exists as a type and that the constructor argument type-checks; it never
checks that every constructor argument has a provider in scope. That is the
container's job at boot.

**Why the unit suite could not see it.** No test builds the
`NotificationsModule`; the only spec fakes the repository instead of letting
the container provide it.

**Minimal fix.** Add `DeliveryRepository` to `NotificationsModule`'s
`providers`.

## Defect 3 — `ExportService` is provided but not exported

**What was unresolvable.** With defects 1–2 fixed, boot failed at the next
module: `Nest can't resolve dependencies of the ExportsController (...)` —
`ExportService` is not available in the `ExportsModule` context.
`ExportService` is provided by `UsersModule`, which `ExportsModule` imports —
but `UsersModule`'s `exports` listed only `UsersService`. A provider is only
visible to other modules if it is exported.

**Why `tsc` could not see it.** The same class of blindness as defect 2:
`exports` is runtime wiring metadata. The class exists, importing
`UsersModule` into `ExportsModule` is legal, and every type lines up. Only
the container knows the provider is invisible across the boundary.

**Why the unit suite could not see it.** Nothing in the suite imports
`ExportsModule` or `UsersModule`; the faked-repository spec is one module
boundary away from the defect.

**Minimal fix.** Add `ExportService` to `UsersModule`'s `exports`.

## The class of problem the tooling is blind to

All three defects live in the *runtime module/DI graph*: module evaluation
order and container scope (`providers`/`exports`). `tsc` answers "do the
types line up?"; the Nest container answers "can every constructor argument
be satisfied in this scope, and in what order do the modules evaluate?".
Neither `tsc` nor a unit suite that fakes the repositories ever constructs
that graph, so all three shipped through a green build and a green test run.

## The check that fails when the wiring is wrong

`scripts/wiring-check.mjs`, run by `pnpm test` (after `pnpm build`). It
dynamically imports the compiled module graph and boots the real `AppModule`
with `NestFactory.create`, then asserts that the cross-module providers
resolve to real instances and runs a behavioural smoke
(`ExportService.enqueue`, `RetryProcessor.sweep`).

- Defect 1 fails it at the import step, with the same `ReferenceError` as
  `pnpm start`.
- Defects 2 and 3 fail it at `NestFactory.create`, with the
  "can't resolve dependencies" error.
- The fixed wiring passes.

Why a Node script against `dist/` and not a vitest spec: vitest transpiles
with esbuild, which does not support `emitDecoratorMetadata`, so the
`design:paramtypes` metadata that Nest's DI relies on is absent under
vitest. Without it, Nest instantiates every provider with no constructor
dependencies, and a vitest boot test would pass even on broken wiring. The
check therefore runs against tsc's output, where the metadata is present.

## Changes

- `src/jobs/queues.constants.ts` (new) — `QUEUES` and `QueueName`, imports nothing.
- `src/jobs/jobs.module.ts` — no longer declares `QUEUES`/`QueueName`.
- `src/notifications/notifications.service.ts` — imports `QUEUES` from `queues.constants`.
- `src/notifications/notifications.module.ts` — `providers: [DeliveryRepository, NotificationsService]`.
- `src/users/users.module.ts` — `exports: [UsersService, ExportService]`.
- `scripts/wiring-check.mjs` (new) and the `test` script in `package.json`: build, wiring check, then the unit suite.
