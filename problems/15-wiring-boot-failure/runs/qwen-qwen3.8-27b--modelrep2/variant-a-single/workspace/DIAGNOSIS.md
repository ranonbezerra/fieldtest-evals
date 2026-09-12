# Diagnosis — the application will not start

Boot output:

```
$ pnpm start
ReferenceError: Cannot access 'QUEUES' before initialization
    at file:///.../dist/notifications/notifications.service.js:5:29
```

Nest never logged anything, so this died during ES module evaluation, before the
framework ran. Three defects; each was hidden by the previous one, and only one
of them (the cycle) was a startup crash at all.

## Defect 1 — import cycle: `jobs` ⇄ `notifications` (startup crash)

**What was unresolvable:** `notifications/notifications.service.ts` read
`QUEUES` at module scope (`const DELIVERY_QUEUE = QUEUES.delivery;`), but it
imported it from `jobs/jobs.module.js`. That module imports
`NotificationsModule`, whose providers import `notifications.service.ts` back —
an import cycle:

```
jobs/jobs.module.js
  -> notifications/notifications.module.js
      -> notifications/notifications.service.js
          -> jobs/jobs.module.js   (for QUEUES)
```

Under NodeNext ESM, the cyclic re-entry leaves `QUEUES` in its temporal dead
zone while `notifications.service.js` evaluates, so the first module-scope read
throws `ReferenceError: Cannot access 'QUEUES' before initialization` before
`NestFactory.create` is ever called.

**Why `tsc` could not see it:** `tsc` typechecks; it never simulates module
evaluation order. A cyclic `import { const }` is perfectly well-typed, and ESM
TDZ violations are a runtime property of evaluation order, not of types.

**Why the unit suite could not see it:** `test/users.service.spec.ts` imports
only `UsersService`; nothing in the suite imports `notifications.service.ts` or
`jobs.module.js`, so the cycle was never evaluated. (The spec file imports with
`.js` extensions — it would reproduce the crash verbatim if it imported the
cyclic module.)

**Minimal fix:** move `QUEUES`/`QueueName` to `src/jobs/queues.ts`, a leaf
module that imports nothing, and update the two import sites. No
`forwardRef`: the "cycle" existed only because a constant lived in a module
file; the features never depended on each other at the DI level, so moving the
symbol is the genuine fix.

## Defect 2 — `ExportService` provided but not exported (boot failure)

**What was unresolvable:** `ExportsModule` imports `UsersModule` and its
controller injects `ExportService`, but `UsersModule` only exported
`UsersService`. The token is visible inside `UsersModule` and unresolvable
everywhere else: `Nest cannot find dependency 'ExportService'`
(`NestDependencyError`) at `init()`.

**Why `tsc` could not see it:** `tsc` only checks the *file* import
(`from '../users/export.service.js'`), which is valid. Nest module metadata
(`exports`) is runtime data inside a decorator; it is invisible to the
compiler.

**Why the unit suite could not see it:** no test constructs
`ExportsController` or compiles `ExportsModule`; the suite only
hand-instantiates `UsersService` with a faked `PrismaService`.

**Minimal fix:** add `ExportService` to the `exports` array of `UsersModule`.

## Defect 3 — `DeliveryRepository` never provided (boot failure)

**What was unresolvable:** `NotificationsService` injects
`DeliveryRepository`, but no module lists it in `providers` — not even
`NotificationsModule`, which is the feature that owns it. Result:
`Nest cannot find dependency 'DeliveryRepository'` at `init()`.

**Why `tsc` could not see it:** again, provider registration is decorator
metadata, not a type. The file import resolves fine.

**Why the unit suite could not see it:** the suite never resolves
`NotificationsService` through the container.

**Minimal fix:** add `DeliveryRepository` to the `providers` array of
`NotificationsModule`.

## Why no existing check caught any of this

- `tsc` validates imports and types, not the DI graph. All three defects are
  properties of `@Module()` metadata and module evaluation order, which
  compile cleanly.
- The unit suite instantiates services by hand with fakes
  (`new UsersService(fakePrisma(...))`) — the container, providers, exports and
  module boundaries are never exercised.
- Defect 1 additionally survives `pnpm build` because the circular import is
  syntactically valid TypeScript; it only detonates when Node evaluates the
  modules.

## The check that fails when wiring is wrong

`test/app.module.spec.ts` boots the **real** `AppModule` through
`NestFactory.create(...)` + `app.init()` (the same entry point `main.ts`
uses): it compiles the full module graph, so any unresolvable provider or
missing export rejects `init()`. It also asserts the cross-module providers
(`ExportService`, `RetryProcessor`) are resolvable from the compiled app, and
carries a negative probe module that proves the check rejects a consumer of a
provider that is used across a boundary without being exported.
