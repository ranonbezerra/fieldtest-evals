# Diagnosis — the API will not start after last week's merges

`pnpm start` died before Nest logged anything:

    ReferenceError: Cannot access 'QUEUES' before initialization
        at file:///.../dist/notifications/notifications.service.js:5:29

A `ReferenceError` during import means the process died while Node was
evaluating the module graph — before `main.ts` ran, before the framework
existed. Three defects were stacked; fixing one revealed the next.

## Defect 1 — a value import cycle, read in the temporal dead zone

The module graph contained a cycle of *value* imports:

- `notifications.service.ts` imported `QUEUES` from `jobs.module.ts`
- `jobs.module.ts` imported `NotificationsModule` (and `retry.processor.ts`
  imported `NotificationsService`)

so: `jobs.module -> notifications.module -> notifications.service -> jobs.module`.

In an ESM cycle, every module in the cycle is mid-evaluation when another
member of the cycle reads from it. A `const` binding is in the temporal dead
zone until the module's own body reaches its initializer, so the first
cross-cycle read of an uninitialised binding throws. In the observed run that
read is `const DELIVERY_QUEUE = QUEUES.delivery` in `notifications.service.js`
— `jobs.module.js` is suspended inside its imports, its `const QUEUES` is bound
but not initialised, hence `Cannot access 'QUEUES' before initialization`.

**Why tsc could not see it.** `tsc` resolves the import graph for *types*.
`QUEUES` has a well-formed type and the specifier resolves, so there is no
type error; a value-level import cycle is legal TypeScript. The type system
has no model of the order in which modules *execute*, so evaluation-order
crashes are by construction invisible to it.

**Why the unit suite could not see it.** The existing spec imports
`users.service.ts` — a leaf of the graph that does not touch the cycle — and
hand-constructs the service with a fake. Nothing in the suite evaluated
`app.module.ts` or `notifications.service.ts`, so the cycle never ran.

**Minimal fix.** Move `QUEUES` and `QueueName` into `src/jobs/queues.ts`, a
file that imports nothing. `notifications.service.ts` imports the leaf;
`jobs.module.ts` is off the cycle. The `jobs -> notifications` edge that
remains (RetryProcessor needs NotificationsService) is one-way and genuine.

## Defect 2 — `ExportService` provided but not exported

With defect 1 fixed, the process reached `NestFactory.create` and the
container failed with `Nest can't resolve dependencies of the
ExportsController (?)`.

`ExportsController` injects `ExportService`. That service is a provider of
`UsersModule`, but `UsersModule` only exported `UsersService` — so the
provider was invisible across the boundary into `ExportsModule`, even though
`ExportsModule` correctly imports `UsersModule`.

**Why tsc could not see it.** `providers` / `exports` / `imports` are runtime
metadata in the argument to `@Module`. tsc checks that `ExportService` is a
valid class reference inside those arrays; it has no notion of provider
*visibility* across module boundaries, so the omission is invisible to the
type system.

**Why the unit suite could not see it.** No test builds `ExportsModule` or
`AppModule`, and `ExportService` has no spec. The container is only ever
initialised by `main.ts` — which the suite never runs.

**Minimal fix.** Add `ExportService` to `UsersModule`'s `exports`. It was
already in `providers`, and `ExportsModule` already imports `UsersModule`;
the missing piece was the export on the owner's side.

## Defect 3 — `DeliveryRepository` missing from `NotificationsModule`'s providers

With defect 2 fixed, the container got further and failed on
`NotificationsService`, which injects `DeliveryRepository`. The class exists
and typechecks, but it was not listed in any module's `providers`, so the
container had no way to create it.

**Why tsc could not see it.** Same class of problem as defect 2: registering a
class as a provider is runtime metadata, not a type fact.

**Why the unit suite could not see it.** There was no notifications spec and
no test that initialises a container.

**Minimal fix.** Add `DeliveryRepository` to `NotificationsModule`'s
`providers`. It is used only inside that module, so it stays unexported.

## Why no `forwardRef`

After defect 1's fix, the only edge between the two features is
`JobsModule -> NotificationsModule` — a genuine one-way dependency. Nothing in
notifications needs jobs at runtime beyond the constant name. There is no
mutual runtime need, so a `forwardRef` would have papered over a misplaced
constant instead of breaking a real cycle.

## The check: `test/app-context.spec.ts`

The new spec compiles the app (`tsc -p tsconfig.build.json`) and boots the
real `dist/main.js` on an ephemeral port, asserting that Nest logs
`Nest application successfully started`. That line is printed only after the
container has been built, so any of the three defects above kills the process
before it appears: the test fails on the broken wiring and passes on the fixed
wiring. It runs under `pnpm test`, so a regression surfaces at merge time.

Why it spawns the compiled app instead of calling `NestFactory.create()`
in-process: vitest transforms TypeScript with esbuild, which does not emit
`design:paramtypes`. A container built inside vitest could not resolve
constructor dependencies even on correct wiring. The faithful check is to
build with tsc (which emits the decorator metadata) and boot the result.
