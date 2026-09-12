# DIAGNOSIS — boot failure

`pnpm start` dies before Nest has logged a single line:

    ReferenceError: Cannot access 'QUEUES' before initialization
        at file:///…/dist/notifications/notifications.service.js:5:29

That is not a Nest error. `NestFactory.create(AppModule)` never ran: the
process died while Node evaluated the ESM import graph, at a top-level read
that hit the temporal dead zone. There are three defects, and fixing one
reveals the next.

## Defect 1 — an import cycle through a constant defined in a module file

The cycle, as shipped:

    notifications.service.ts  ->  jobs.module.ts            (import { QUEUES })
    jobs.module.ts            ->  notifications.module.ts   (imports: [NotificationsModule])
    notifications.module.ts   ->  notifications.service.ts  (providers: [NotificationsService])

- **What was unresolvable.** Nothing at the type level — the failure is pure
  evaluation order. `jobs.module.ts` declares `const QUEUES`;
  `notifications.service.ts` reads it at the top level
  (`const DELIVERY_QUEUE = QUEUES.delivery`). Because the three modules form
  a cycle, Node evaluates the body of `notifications.service.js` while
  `jobs.module.js` has not yet run its own body, so `QUEUES` is still in the
  temporal dead zone and the read throws. Whichever edge of the cycle is read
  first supplies the crash frame (here the `QUEUES` read at
  `notifications.service.js:5`); the root cause is the same.
- **Why `tsc` could not see it.** TypeScript checks that imports resolve and
  that types agree; it does not simulate ESM evaluation order. A cycle of
  value imports is legal TypeScript as long as no *type* is referenced before
  its declaration — the TDZ is a property of the emitted runtime, not of the
  type graph.
- **Why the unit suite could not see it.** The only spec imports `UsersService`
  and constructs it by hand with a fake `PrismaService`; it never loads the
  `jobs`/`notifications` graph, so the cycle is never evaluated. Constructing
  classes directly bypasses both ESM order and the DI container.
- **Minimal fix.** Move `QUEUES` and `QueueName` into their own leaf file,
  `src/jobs/queues.ts` (which imports nothing from the application), and
  import them from there in `notifications.service.ts`. The edge
  `notifications.service.ts -> jobs.module.ts` disappears and the module
  graph is acyclic.
- **Why not `forwardRef`.** `forwardRef` is for a genuine circular dependency
  between modules or providers inside the Nest container. There is no such
  cycle here: `JobsModule` legitimately depends on `NotificationsModule`, and
  the back edge was only a constant that happened to live in a module class
  file. `forwardRef` also could not fix this particular crash, which happens
  before Nest starts.

## Defect 2 — `NotificationsModule` does not provide `DeliveryRepository`

With the cycle broken, the app reaches bootstrap and dies with:

    Nest can't resolve dependencies of the NotificationsService (?)

`NotificationsService`'s constructor injects `DeliveryRepository`, but the
module declared only `providers: [NotificationsService]`. The repository is
provided nowhere: not in its own module, not by a global module, and not
exported by any module the notifications module imports — so the container
has no instance to inject.

- **Why `tsc` could not see it.** Provider registration is runtime metadata.
  `@Module({ providers: [...] })` is an array literal that is not typed
  against the providers' constructor dependencies; the service's `import {
  DeliveryRepository }` typechecks fine. The missing fact is a *registration*,
  which the type system does not model.
- **Why the unit suite could not see it.** No spec builds a container. The
  existing style (construct the service, fake the repository) replaces exactly
  the registration that is missing.
- **Minimal fix.** Add `DeliveryRepository` to `NotificationsModule`'s
  `providers`. The module owns its repository; it is not exported because no
  other module injects it.

## Defect 3 — `UsersModule` provides `ExportService` but does not export it

With defect 2 fixed, bootstrap dies one module later:

    Nest can't resolve dependencies of the ExportsController (?)

`ExportsController` (in `ExportsModule`) injects `ExportService`.
`ExportsModule` does import `UsersModule`, and `UsersModule` does provide
`ExportService` — but a consumer module can only inject what the provider
module *exports*, and `UsersModule`'s exports were `[UsersService]` only.

- **Why `tsc` could not see it.** Same reason as defect 2: the controller's
  import of the `ExportService` class is valid TypeScript; the
  `providers`/`exports`/`imports` contract is runtime metadata, not types.
- **Why the unit suite could not see it.** No spec touches `ExportsModule` or
  any container.
- **Minimal fix.** Add `ExportService` to `UsersModule`'s `exports`.

## The check that fails when the wiring is wrong

`test/wiring.spec.ts`. A typecheck cannot see these defects (wiring is
runtime metadata; the first crash is an ESM evaluation-order problem), and a
unit test with a faked repository cannot see them either (the container is
never built). The spec therefore compiles the app with the project's `tsc` —
the same transform `pnpm start` uses — and exercises the compiled output the
way the runtime does:

1. **Container check.** Builds the real Nest container from the compiled
   `AppModule` and asserts that every cross-module provider is resolvable:
   `ExportService` (provided in one module, consumed in another),
   `NotificationsService`, `DeliveryRepository` (the module's own
   repository), and `RetryProcessor` (whose module has no route, so a module
   orphaned from `AppModule` or a provider dropped from `JobsModule` would
   not otherwise change any observable behaviour).
2. **Boot check.** Runs the compiled `dist/main.js` as a child process — the
   same artifact `pnpm start` runs — and fails unless it reaches
   `listening on <port>` and `POST /exports` answers `201` with the exported
   job. This catches the TDZ crash and every bootstrap DI failure (the
   process exits non-zero before listening), and an `ExportsModule` dropped
   from `AppModule` (the route 404s).

The checks deliberately run the **compiled** output: vitest transforms TS
with esbuild, which cannot emit the `design:paramtypes` metadata that Nest's
constructor injection depends on, so an in-process check against the sources
would fail even on correct wiring. Running the compiled artifact measures the
same thing `pnpm start` measures.
