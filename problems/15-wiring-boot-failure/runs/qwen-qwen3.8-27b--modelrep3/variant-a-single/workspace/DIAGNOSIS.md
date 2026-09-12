# DIAGNOSIS — why the application would not start

The process died during **ESM module evaluation**, before `NestFactory` ran —
which is why Nest never logged anything. There are three independent defects;
fixing each one unmasks the next.

## Defect 1 — circular import: `QUEUES` read before initialization (process crash)

**What was unresolvable.**
`ReferenceError: Cannot access 'QUEUES' before initialization` at
`dist/notifications/notifications.service.js:5`. The import graph contained a
cycle:

```
notifications/notifications.service.ts
  → jobs/jobs.module.ts                    (imports QUEUES)
    → notifications/notifications.module.ts (jobs.module imports it)
      → notifications/notifications.service.ts (the module provides the service)
```

`jobs.module.ts` imports `notifications.module` *before* its own body executes,
so while `notifications.service` evaluates
`const DELIVERY_QUEUE = QUEUES.delivery`, the `QUEUES` binding in the
half-evaluated `jobs.module` namespace is still in the temporal dead zone. The
process aborts at import time; no framework code ever runs.

**Why `tsc` could not see it.**
TypeScript checks names and types, not evaluation order. The cycle is legal
TypeScript: `QUEUES` exists, is correctly typed, and every import resolves.
The failure is purely about *when* module bodies execute, which `tsc` does not
model.

**Why the unit suite could not see it.**
The only spec (`test/users.service.spec.ts`) imports `users.service` and
`prisma.service`. The cyclic subgraph (`jobs` ↔ `notifications`) is never
loaded, so the bad edge is never evaluated.

**Minimal fix.**
Move `QUEUES` (and the `QueueName` type derived from it) to a leaf module,
`src/jobs/queues.ts`, which imports nothing, and import from there in
`notifications.service.ts`. The source graph is now a DAG
(`jobs.module → notifications.module → notifications.service → queues`), so no
`forwardRef` is needed: there is no Nest-level module cycle to paper over
(`JobsModule → NotificationsModule` is one-way), and `forwardRef` would only
mask a genuine DI cycle.

## Defect 2 — `ExportService` used across a module boundary without being exported

**What was unresolvable** (visible only after defect 1 is fixed): at bootstrap,
Nest cannot construct `ExportsController`:

```
Nest can't resolve dependencies of 'ExportsController' (?)
```

`ExportService` is a provider in `UsersModule`, but `UsersModule` exported only
`UsersService`. `ExportsModule` imports `UsersModule` and its controller
injects `ExportService`, which is invisible across the module boundary.

**Why `tsc` and the unit suite could not see it.**
The import in `exports.controller.ts` is a normal value import and
typechecks fine. Whether a provider is visible from another module is runtime
metadata on the `@Module` decorator, outside the type system; and no spec
builds a module graph (the users spec fakes Prisma and tests `UsersService`
in isolation).

**Minimal fix.**
Add `ExportService` to the `exports` array in `src/users/users.module.ts`
(`ExportsModule` already imports `UsersModule`).

## Defect 3 — `DeliveryRepository` has no owning module

**What was unresolvable** (visible only after defect 2 is fixed): Nest cannot
construct `NotificationsService`:

```
Nest can't resolve dependencies of 'NotificationsService' (?)
```

Its constructor injects `DeliveryRepository`, but no module lists that class in
`providers` — not even `NotificationsModule`, where the file lives and where
it is the only consumer.

**Why `tsc` and the unit suite could not see it.**
Same reasons as defect 2: the constructor's parameter types are valid
TypeScript, and provider ownership is runtime module metadata; no spec
constructs `NotificationsService`.

**Minimal fix.**
Add `DeliveryRepository` to the `providers` array in
`src/notifications/notifications.module.ts`. Nothing outside the notifications
feature injects it, so it does not need to be exported.

## Why the defects hid in sequence

Defect 1 crashes at import time, before the framework exists, so it produced
no Nest diagnostics at all. Once module evaluation succeeded, the injector
surfaced the missing `DeliveryRepository` first (in this graph
`NotificationsModule` initializes before `ExportsModule`), and fixing that
surfaced the missing `ExportService` export. All three are invisible to
`pnpm typecheck` and to a unit suite that fakes the repository, because module
wiring is runtime behaviour of the compiled artifact.

## The check that fails when the wiring is wrong

`test/wiring.spec.ts` builds the app exactly as `pnpm start` does
(`pnpm build && node dist/main.js`), starts the **compiled process** on an
ephemeral port, and asserts:

- the process actually logs `listening` — a module-evaluation crash (e.g. a
  re-introduced circular import) or any unresolvable provider (a provider with
  no owning module, or one used across a boundary without an export) aborts
  bootstrap, the process exits, and the check fails with the captured output;
- `POST /exports` returns the job produced by `ExportService`, proving the
  `ExportsModule → UsersModule` boundary is wired end to end, and the
  `requestedBy` value flows into the job id;
- the process is still serving after the first request, then is shut down
  cleanly.

A passing typecheck is not this check (it ignores runtime module metadata),
and a unit test with the repository faked is not this check (it never loads
the module graph). This check exercises the same artifact that failed to
start.
