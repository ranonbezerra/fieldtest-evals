# Diagnosis — why the application would not start

## Symptom

`pnpm start` died with:

    ReferenceError: Cannot access 'QUEUES' before initialization
        at file:///.../dist/notifications/notifications.service.js:5:29

Nest never logged anything. That is the tell: the process died during ESM
module evaluation, before `NestFactory.create` ever ran — this was not a
dependency-injection error, it was a module-linking crash. Three independent
wiring defects were present; fixing each one revealed the next.

## Defect 1 — an import cycle read `QUEUES` before its initialisation

`jobs/jobs.module.ts` both declared `QUEUES` and imported
`NotificationsModule`; `notifications/notifications.service.ts` imported
`QUEUES` back from `jobs.module.ts`. In the compiled output that is the cycle
`jobs.module.js → notifications.module.js → notifications.service.js → jobs.module.js`.

`app.module.ts` lists its imports alphabetically, so `jobs.module.js` begins
evaluating before `notifications.module.js`. While `jobs.module.js` is still
in its import phase, `notifications.service.js` reaches its top-level
`const DELIVERY_QUEUE = QUEUES.delivery;`. The `const QUEUES` declaration in
`jobs.module.js` has not executed yet: in ESM the binding already exists (that
is what makes the cycle legal to link) but it is in its temporal dead zone, so
the read throws and the process exits.

- What was unresolvable: nothing could be resolved — evaluation of the module
  graph aborted before the framework started.
- Why `tsc` could not see it: TypeScript checks names and types, not module
  evaluation order. A cyclic import that typechecks is still cyclic, and
  "is this binding initialised when this top-level line runs" is a question
  about ESM linking order, which is outside typechecking.
- Why the unit suite could not see it: the only spec constructs
  `UsersService` with a hand-built fake and never imports the `jobs` or
  `notifications` files, so the cyclic pair is never linked or evaluated.
- Minimal fix: move `QUEUES` and `QueueName` to a leaf module,
  `src/queues/queues.ts`, that imports nothing, and point
  `notifications.service.ts` at it. The file-level cycle is gone;
  `JobsModule → NotificationsModule` remains as the single one-directional
  edge it should have been.

**No `forwardRef`.** `forwardRef` repairs cycles in the *injection* graph
(provider A needs B and B needs A). There is no such cycle here — the only
cycle was at the module-evaluation level, through a plain constant. After the
move, the DI graph is acyclic (`jobs → notifications`, `exports → users`,
global `config`/`prisma` with no back edges), so `forwardRef` would mask the
defect instead of solving it.

## Defect 2 — `NotificationsService` injects `DeliveryRepository`, which no module provided

(Revealed once Defect 1 is fixed: the process now reaches
`NestFactory.create` and dies there instead.)

`DeliveryRepository` exists as a class, but it appears in no module's
`providers`. Nest's injector cannot construct `NotificationsService`, whose
constructor requires it, and startup aborts with "Nest can't resolve
dependencies of the NotificationsService".

- What was unresolvable: the `DeliveryRepository` token required by
  `NotificationsService`'s constructor.
- Why `tsc` could not see it: provider *registration* is runtime metadata in
  `@Module({ providers: [...] })`. The import and the constructor parameter
  typecheck perfectly.
- Why the unit suite could not see it: no spec touches the notifications
  feature; the existing spec exercises `UsersService` in isolation.
- Minimal fix: add `DeliveryRepository` to `NotificationsModule.providers`.

## Defect 3 — `ExportService` is provided by `UsersModule` but not exported; `ExportsModule`'s controller injects it

(Revealed once Defect 2 is fixed.)

`ExportsModule` imports `UsersModule` so that `ExportsController` can inject
`ExportService`. `UsersModule` lists `ExportService` in `providers` but not
in `exports`, so the token is invisible outside the module and the
controller's dependency is unresolvable: "Nest can't resolve dependencies of
the ExportsController".

- What was unresolvable: the `ExportService` token inside `ExportsModule`'s
  scope.
- Why `tsc` could not see it: the controller's import of
  `../users/export.service.js` typechecks; module scope (`exports`) is
  runtime wiring metadata, invisible to the compiler.
- Why the unit suite could not see it: no spec instantiates
  `ExportsController` or builds `ExportsModule`; scope is only enforced when
  Nest builds the module tree.
- Minimal fix: add `ExportService` to `UsersModule.exports`. Ownership stays
  in the module that declares the provider; `ExportsModule` consumes it
  across the boundary.

## Why a typecheck and the unit suite are not a wiring check

`pnpm typecheck` reasons file by file about names and types; it never orders
module evaluation and never builds the DI graph. The unit suite constructs
single classes with faked collaborators; it never links the compiled graph
and never runs the injector over the real module tree. All three defects are
properties of the *graph* — evaluation order, provider registration, module
scope — and are therefore invisible to both.

## The check that fails when the wiring is wrong

`test/app.wiring.spec.ts` (run by `pnpm test`) does the one thing the two
above don't: it builds with the project's own tsconfig, spawns the compiled
`dist/main.js` — the exact path `pnpm start` uses — and round-trips
`POST /exports`, a route whose controller crosses a module boundary
(`ExportsModule` consuming `UsersModule`).

It fails when:

| Broken wiring | Observed failure |
| --- | --- |
| module-evaluation cycle / TDZ read (Defect 1) | the child prints the `ReferenceError` to stderr and exits non-zero before the listen log |
| provider missing (Defect 2) | Nest throws "can't resolve dependencies" at startup; the child exits non-zero |
| cross-module provider not exported (Defect 3) | the same startup throw, named after the consumer |
| controller not declared by its module | the probe receives 404 instead of 201 |
| an injected collaborator is not live | the probe receives 500 instead of 201 |
