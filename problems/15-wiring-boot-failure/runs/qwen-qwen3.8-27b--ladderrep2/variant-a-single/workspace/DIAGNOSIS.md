# Diagnosis — the API will not start

## Shape of the failure

`pnpm start` is `pnpm build && node dist/main.js`. The process died with:

    ReferenceError: Cannot access 'QUEUES' before initialization
        at file:///.../dist/notifications/notifications.service.js:5:29

before Nest printed a single line. That places the first failure at **ESM module
evaluation**, not at dependency injection: `dist/main.js` imports
`dist/app.module.js`, whose imports pull in the feature modules, and a cycle in
that import graph forced one module to read a binding before its initialiser had
run. The throw happens while the compiled modules evaluate, before
`bootstrap()` executes — which is exactly why there was no Nest output at all.

Three defects were stacked, and they surface in this order:

1. an import cycle that crashed the process at module evaluation;
2. `ExportService` registered as a provider of `UsersModule` but never
   exported, so `ExportsModule` could not inject it;
3. `DeliveryRepository` injected by `NotificationsService` but registered in no
   module at all.

## Defect 1 — `QUEUES` hosted inside `jobs.module.ts` creates an import cycle (TDZ crash)

**What was unresolvable.** `notifications/notifications.service.ts` imported the
`QUEUES` constant from `jobs/jobs.module.ts`, while the jobs module (through
`RetryProcessor`) depends on the notifications module. With `AppModule`
importing `JobsModule` before `NotificationsModule`, the compiled graph
evaluates:

`app.module.js` → `jobs.module.js` → (its imports first) →
`notifications.module.js` → `notifications.service.js` → back to
`jobs.module.js`.

At that point `jobs.module.js` is on the evaluation stack and has not executed
its body, so its `const QUEUES` is in the temporal dead zone. Line 5 of the
compiled `notifications.service.js` — `const DELIVERY_QUEUE = QUEUES.delivery;`
— reads that binding and throws. No Nest code has run yet.

The crash site is a function of import order, not of which side is "wrong": if
`NotificationsModule` were evaluated first, the same cycle would throw in
`retry.processor.js` instead, because its emitted decorator metadata
(`design:paramtypes`) reads `NotificationsService` before that module's body has
run. The defect is the cycle; whatever edge reads an uninitialised binding first
is what throws.

**Why `tsc` could not see it.** `tsc` checks declarations and types. `QUEUES`
has a perfectly valid type, so the import type-checks whatever order the modules
happen to evaluate in. Whether a *value* binding is initialised when another
module's top-level code reads it is a property of ESM graph evaluation at
runtime; the type system has no model of evaluation order or of the temporal
dead zone. A cyclic import that is type-valid but value-hazardous is expected to
produce a green build.

**Why the unit suite could not see it.** The suite never imports `AppModule` —
or any jobs/notifications file at all. It constructs `UsersService` directly
against a hand-built fake, so the import graph containing the cycle is never
evaluated. No test puts two edges of the cycle on the stack.

**Minimal fix.** Move `QUEUES` (and the derived `QueueName` type) out of the
module file into `src/jobs/queues.constants.ts`, a leaf that imports nothing.
`notifications.service.ts` now imports the constant from there. The real
`JobsModule` → `NotificationsModule` edge is kept; the fake reverse edge is
gone.

## Defect 2 — `ExportService` in `UsersModule.providers` but not in `UsersModule.exports`

**What was unresolvable.** Once the process could load its modules,
`NestFactory.create(AppModule)` failed while building `ExportsModule`:

    Nest can't resolve dependencies of the ExportsController (?)

`ExportsController` injects `ExportService`. That token is registered as a
provider of `UsersModule`, but `UsersModule` exported only `UsersService`, so
the token is not visible to `ExportsModule`'s injector — and `ExportsModule`
imports `UsersModule` without owning the provider itself.

**Why `tsc` could not see it.** `providers` and `exports` are plain arrays of
class tokens. The type system verifies that `ExportService` exists and that the
controller's constructor is well typed; it does not model the DI container's
visibility rule (a token is visible to a module only if it is in that module's
own `providers` or in an `imports`ed module's `exports`). Token visibility is
runtime container state.

**Why the unit suite could not see it.** No test builds the real module graph,
so nothing ever resolves `ExportService` through a container. Constructing a
class by hand with a fake bypasses the container entirely.

**Minimal fix.** Add `ExportService` to `UsersModule`'s `exports`. The consumer
(`ExportsModule`) already imports `UsersModule`, so nothing changes on the
consumer side.

## Defect 3 — `DeliveryRepository` injected but registered in no module

**What was unresolvable.** After the export fix, the boot failed one step later:

    Nest can't resolve dependencies of the NotificationsService (?, ConfigService)

`NotificationsService`'s constructor takes `DeliveryRepository`, but no module
lists it in `providers`, so the container has no way to construct it.

**Why `tsc` could not see it.** Same class as defect 2: the class exists and
type-checks. The missing piece is a runtime registration, which the type system
does not check.

**Why the unit suite could not see it.** No test touches `NotificationsService`
or `DeliveryRepository`; the only suite that exists constructs `UsersService`
with a fake. The fake-based style is precisely what makes provider registration
invisible.

**Minimal fix.** Add `DeliveryRepository` to `NotificationsModule.providers`.
It is used only inside the notifications module, so it does not need to be
exported.

## Why this class of problem survives a green build and a green test run

- **`tsc` checks declarations; it does not evaluate the graph.** It cannot see
  (a) evaluation-order / temporal-dead-zone hazards in a cyclic import graph,
  or (b) which tokens a Nest injector can see from which module. All three
  defects are expressible in perfectly well-typed code.
- **The unit suite tests classes in isolation.** Every test constructs a single
  class with hand-made fakes. All three defects live in the *assembled* module
  graph, which is only evaluated when a real application context is built —
  which no test did.

So: anything that is only true of the assembled graph (evaluation order,
provider registration, token visibility) is invisible to both tools. The
complement is a check that assembles the graph.

## The check added

`test/wiring.spec.ts`, run by `pnpm test`. It does what the reported command
does:

1. compiles the app with the project's own `tsc -p tsconfig.build.json` — the
   exact output `pnpm start` runs;
2. starts the compiled `dist/main.js` on a scratch port;
3. fails if the process exits before it logs `listening on` (the child's output
   is included in the failure), or if it hangs past a deadline;
4. issues a real `POST /exports` against the running server and asserts the
   response;
5. always shuts the server down, on both the success and the failure path.

Against the broken wiring it fails where the incident did: defect 1 kills the
child at module evaluation with the same `ReferenceError`; defects 2 and 3 make
`NestFactory.create` throw, and the child exits non-zero before the listening
log. After the three fixes it passes. It is deliberately not a typecheck (green
before the fix) and not a fake-repository unit test (green before the fix).

## Why no `forwardRef`

`forwardRef` is for a cycle that is genuine at runtime — two modules that really
need each other's providers. Here the cycle was an artefact: the only real
dependency is `JobsModule` → `NotificationsModule` (the retry processor resends
through the notifications service). The reverse edge existed solely because a
plain constant was hosted inside a module file, so importing the constant
dragged the whole module — and its provider graph — along with it. Moving the
constant to a leaf file breaks the cycle at the source. Using `forwardRef`
instead would have kept the temporal-dead-zone trap in place for whatever symbol
lands in that cycle next, so it was not used.
