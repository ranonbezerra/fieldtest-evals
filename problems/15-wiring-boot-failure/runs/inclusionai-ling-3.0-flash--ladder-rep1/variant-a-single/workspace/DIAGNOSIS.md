# DIAGNOSIS — Why the API Would Not Start

## Defect 1: `QUEUES` used before initialization (TDZ cycle)

**What was unresolvable:**
`QUEUES` is declared as a `const` in `jobs.module.ts`. `notifications.service.ts`
imports `QUEUES` from `jobs.module.ts`. At the same time, `jobs.module.ts` imports
`NotificationsModule`, which registers `NotificationsService`. Under ESM evaluation
order the graph is:

1. `jobs.module.ts` begins evaluation → imports `NotificationsModule`
2. `notifications.service.ts` begins evaluation → reads `QUEUES` from
   `jobs.module.ts`
3. `QUEUES` is still in the Temporal Dead Zone (its `const` declaration has not
   executed yet — we are still at the top of `jobs.module.ts`)
4. `ReferenceError: Cannot access 'QUEUES' before initialization`

Nest never gets a chance to log anything because the process dies during
**module evaluation**, before any framework code runs.

**Why neither `tsc` nor the unit suite could see it:**
- `tsc` resolves the import *graph* for type-checking; it says nothing about the
  **order** in which modules execute at runtime. Every import is structurally
  valid, so typecheck is green.
- The unit suite (`users.service.spec.ts`) instantiates `UsersService` directly
  with a hand-rolled fake Prisma. It never loads `AppModule`, never evaluates
  `JobsModule`, and never touches `NotificationsService`. The real module graph
  is never exercised.

**Minimal fix:**
Move `QUEUES` and `QueueName` into `src/jobs/queues.ts` — a file that imports
nothing and has no module dependencies. Both `jobs.module.ts` (re-export) and
`notifications.service.ts` (direct import) now resolve `QUEUES` from this
standalone file, eliminating the evaluation-order cycle. This is a structural
break, not `forwardRef`.

---

## Defect 2: `ExportService` not exported from `UsersModule`

**What was unresolvable:**
`ExportsController` (in `ExportsModule`) injects `ExportService` via its
constructor. `ExportService` is a provider of `UsersModule`, but `UsersModule`
only exports `UsersService`. When Nest attempts to resolve the dependency for
`ExportsController`, `ExportService` is invisible in the `ExportsModule` scope,
and the container cannot wire it.

**Why neither `tsc` nor the unit suite could see it:**
- TypeScript has no knowledge of Nest's module boundaries or DI container
  resolution. An import path that resolves to a real class satisfies the type
  checker completely.
- The unit suite tests `UsersService` in isolation with a fake Prisma. It never
  instantiates `ExportsController`, `ExportsModule`, or `AppModule`, so the
  missing cross-module visibility is never observed.

**Minimal fix:**
Add `ExportService` to the `exports` array of `UsersModule`, making it available
to any module that imports `UsersModule` (here, `ExportsModule`).

---

## Why these survived a green build and green tests

Both defects are **runtime wiring** problems that live in the space between
TypeScript's type system and Nest's dependency container. `tsc` verifies that
imported symbols exist and have compatible types; it does not evaluate module
initialization order or resolve DI graphs. Unit tests with faked repositories
instantiate services directly, bypassing the module graph entirely. The only way
to surface these defects is to build the real application context — which is what
`test/app.wiring.spec.ts` does.
