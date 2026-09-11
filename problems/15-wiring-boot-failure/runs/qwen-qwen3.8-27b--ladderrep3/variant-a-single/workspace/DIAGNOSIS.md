# Diagnosis — the API will not start

```
$ pnpm start
ReferenceError: Cannot access 'QUEUES' before initialization
    at file:///.../dist/notifications/notifications.service.js:5:29
```

Nest never logged anything. The process died while Node was *evaluating the ESM
import graph* — before `NestFactory.create(AppModule)` ever ran — so dependency
injection could not be the first cause. Three defects were stacked; each fix
exposed the next. Order of discovery: (1) TDZ crash at evaluation, (2)
`ExportsController` unresolvable, (3) `NotificationsService` unresolvable.

## Defect 1 — import cycle `jobs` ⇄ `notifications` (TDZ crash at module evaluation)

**What was unresolvable.** `notifications.service.ts` imported `QUEUES` from
`jobs/jobs.module.ts` and dereferenced it at the top level of the module body
(`const DELIVERY_QUEUE = QUEUES.delivery`). At the same time, `jobs.module.ts`
was part of the notifications module's own import chain: `JobsModule` imports
`NotificationsModule` and `RetryProcessor` consumes `NotificationsService`. The
cycle `jobs.module → notifications.module → notifications.service → jobs.module`
was real.

Because `app.module.ts` lists its imports alphabetically, `jobs.module.js` was
entered *before* `notifications.module.js`. Its import of `notifications.module.js`
pulled in `notifications.service.js` while `jobs.module.js` was still paused
between "evaluate imports" and "run its own body" — so its `const QUEUES`
declaration had not executed and the binding sat in the temporal dead zone. The
first statement of `notifications.service.js` to touch it threw, at
module-evaluation time. (Had `app.module.ts` listed the imports in reverse
order, the same bug would have thrown on the `NotificationsModule` binding
inside `jobs.module.js`'s `@Module` decorator instead. The import order in
`app.module.ts` only decides *which identifier* the stack names; the class of
bug is identical.)

**Why `tsc` could not see it.** The type checker is order-independent: types
resolve lazily, cyclic type references are legal, and nothing in this graph is a
type error. TypeScript does not model ESM evaluation order or cross-file `const`
TDZ. `tsc -p tsconfig.build.json` therefore succeeded and dutifully emitted the
same cycle into `dist/`, where Node then tripped over it. "Typechecks cleanly"
says nothing about the order modules execute at runtime.

**Why the unit suite could not see it.** The only spec (`users.service.spec.ts`)
constructs `UsersService` with a hand-built fake Prisma and never imports
`AppModule`, `jobs.module`, or anything in `notifications`. The cyclic graph is
sim never evaluated in the test process. Green.

**Minimal fix.** Move the shared symbol out of the module file into a leaf that
imports nothing: `src/jobs/queues.ts` now owns `QUEUES` and `QueueName`.
`jobs/jobs.module.ts` no longer defines it; `notifications.service.ts` imports
it from `../jobs/queues.js`. The import cycle is broken structurally. The
remaining module edge (`JobsModule → NotificationsModule`) is one-way and exists
because `RetryProcessor` genuinely injects `NotificationsService` — a real,
legal dependency, not a cycle.

## Defect 2 — `ExportService` used across a module boundary without being exported

**What was unresolvable.** `ExportsModule` hosts `ExportsController`, whose
constructor injects `ExportService` — a provider *owned* by `UsersModule`.
`UsersModule.exports` listed only `UsersService`, so `ExportService` was
invisible from `ExportsModule`. After the TDZ crash was fixed, boot failed with:

```
Nest can't resolve dependencies of the ExportsController (?). Please make sure
that the argument ExportService at index [0] is available in the ExportsModule
context.
```

**Why `tsc` could not see it.** The controller's
`import { ExportService } from '../users/export.service.js'` is a perfectly valid
type-level import; the file exists and the types match. Module-boundary
enforcement lives in `@Module()` decorator metadata and is enforced only by the
DI container at runtime.

**Why the unit suite could not see it.** No test assembles a module that
contains `ExportsController`, so that boundary is never exercised.

**Minimal fix.** Add `ExportService` to `UsersModule`'s `exports`. The consumer
side was already correct: `ExportsModule` imports `UsersModule`.

## Defect 3 — `DeliveryRepository` provided nowhere

**What was unresolvable.** `NotificationsService` injects `DeliveryRepository`,
but the class appeared in no `providers` array anywhere in the application
(`NotificationsModule` listed only `NotificationsService`). After the export
was fixed, boot failed again:

```
Nest can't resolve dependencies of the NotificationsService (?, ConfigService).
Please make sure that the argument DeliveryRepository at index [0] is available
in the NotificationsModule context.
```

**Why `tsc` could not see it.** `@Injectable()` and the constructor signature
are fine in isolation. `providers: [...]` is just data inside a decorator — the
type system has nothing to check it against.

**Why the unit suite could not see it.** The suite contains no notifications
tests at all.

**Minimal fix.** Add `DeliveryRepository` to `NotificationsModule.providers`.
It stays private to the module — nothing outside injects it, so no `exports`
change is needed.

## Why no `forwardRef`

`forwardRef` is for a *genuine* runtime mutual dependency between two modules.
Here the "cycle" was a shared constant riding in a module file that both sides
happened to import; extracting it to a leaf removed the cycle entirely. After
the extraction no two modules need each other, so `forwardRef` would have papered
over a defect instead of fixing it. It is not used.

## The check that fails when the wiring is wrong

`test/app.module.spec.ts` builds the **real application context** —
`NestFactory.create(AppModule)`, the exact call `src/main.ts` makes — with the
real providers (no faked repositories) and asserts that every cross-boundary
provider resolves, plus behavioural assertions through resolved services
(`ExportService.enqueue`, `RetryProcessor.sweep`). It is part of `pnpm test`:

- with defect 1 present, importing `AppModule` in the spec crashes at
  module-evaluation time (the same TDZ `ReferenceError`) — the suite fails
  before a single assertion runs;
- with defect 2 or 3 present, `NestFactory.create` rejects with
  "Nest can't resolve dependencies" — the test fails;
- on the fixed wiring it passes.

A passing `tsc` and the faked-repository unit tests are green in all three
broken states; this check is not.

## Verification

- `pnpm typecheck` — green (was already).
- `pnpm test` — old spec still green; new wiring spec green, and red on any
  regression of the three defects above.
- `pnpm start` — Nest logs startup and the process reaches
  `listening on <PORT>`.
