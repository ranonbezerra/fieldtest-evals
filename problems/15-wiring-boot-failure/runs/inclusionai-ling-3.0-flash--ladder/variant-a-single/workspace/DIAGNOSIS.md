# DIAGNOSIS — Wiring defects and why the tooling missed them

## Defect 1: Import cycle via `QUEUES` constant

**What was unresolvable:** `NotificationsService` (in `notifications.service.ts`)
imported the `QUEUES` constant from `JobsModule` (`jobs.module.ts`). At the same
time, `JobsModule` imported `NotificationsModule`, which registers
`NotificationsService`. This created an evaluation cycle:

```
AppModule → JobsModule → NotificationsModule → NotificationsService → QUEUES (from JobsModule)
                                                          ↑                     |
                                                          |_____________________|
```

When Node.js loaded the compiled modules, `JobsModule` began evaluating, triggered
`NotificationsModule`, triggered `NotificationsService`, which tried to read
`QUEUES` from `JobsModule` — but `JobsModule`'s execution had not completed, so
`QUEUES` was in the temporal dead zone. Hence `ReferenceError: Cannot access 'QUEUES' before initialization`.

**Why `tsc` could not see it:** TypeScript's compiler resolves import graphs for
type-checking, not for runtime evaluation order. All imports resolved to valid
symbols; no type error was reported.

**Why unit tests could not see it:** The unit tests (`users.service.spec.ts`)
instantiate services directly with faked repositories. They never load the
`AppModule` or any Nest module graph, so the evaluation order of the real module
files is never exercised.

**Minimal fix:** Moved `QUEUES` and `QueueName` out of `jobs.module.ts` into their
own file `src/jobs/queue.constant.ts`, which imports nothing and is therefore
reachable from any module without creating a cycle. `jobs.module.ts` now imports
from `queue.constant.ts`; `notifications.service.ts` also imports from
`queue.constant.ts`. The cycle is structurally eliminated — no file in the cycle
depends on a file that depends back on it.

**`forwardRef` not used:** The cycle was not a genuine need for two modules to
instantiate each other at runtime. It was a shared constant misplaced inside a
module file that happened to be part of the cycle. Moving the constant is the
correct fix.

---

## Defect 2: `NotificationsModule` does not provide `DeliveryRepository`

**What was unresolvable:** `NotificationsService` has a constructor dependency
on `DeliveryRepository`, but `NotificationsModule` only listed
`NotificationsService` in its `providers`. NestJS could not instantiate
`NotificationsService` because its `DeliveryRepository` dependency was unresolvable.

**Why `tsc` could not see it:** TypeScript checks that `DeliveryRepository` is a
valid class with a compatible constructor. It does not track which Nest module
registers which provider. From the compiler's perspective, the types are correct —
`DeliveryRepository` exists, is injectable, and satisfies the type annotation.

**Why unit tests could not see it:** The unit tests never build the Nest module
graph. A hypothetical test for `NotificationsService` would pass a fake
repository directly to the constructor, bypassing Nest's provider resolution
entirely.

**Minimal fix:** Added `DeliveryRepository` to `NotificationsModule`'s
`providers` array.

---

## Defect 3: `UsersModule` does not export `ExportService`

**What was unresolvable:** `ExportsController` (in `ExportsModule`) injects
`ExportService`, which is registered as a provider in `UsersModule`. But
`UsersModule` only listed `UsersService` in its `exports`. When NestJS tried to
resolve `ExportService` for `ExportsController` via the `ExportsModule → UsersModule`
import chain, it found the provider but could not access it across the module
boundary.

**Why `tsc` could not see it:** TypeScript does not enforce NestJS module
boundary rules. `ExportService` is a valid, exported class from
`users/export.service.ts` — the TypeScript import in `exports.controller.ts`
resolves correctly. The framework-level visibility rule (provider must be in
`exports` to be usable across modules) is a Nest concern, not a TypeScript one.

**Why unit tests could not see it:** The unit tests cover `UsersService` in
isolation. No test builds `ExportsModule` or attempts to inject `ExportService`
through a module graph, so the missing export is never noticed.

**Minimal fix:** Added `ExportService` to `UsersModule`'s `exports` array so it
is visible to any module that imports `UsersModule`.
