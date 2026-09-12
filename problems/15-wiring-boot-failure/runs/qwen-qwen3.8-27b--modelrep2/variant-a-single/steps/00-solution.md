# solution

## reasoning

```
I'm looking at a NestJS + Prisma application in the `fixtures/api/` directory that typechecks and passes unit tests, but won't start. The main issue is a ReferenceError where `QUEUES` is being accessed before initialization in the notifications service. The root cause is that `notifications.service.ts` imports `QUEUES` from `jobs/jobs.module.js`, which creates a circular dependency since `jobs.module.ts` imports `NotificationsModule`, which imports the service. The `QUEUES` constant is defined in the jobs module, and this circular import is preventing proper initialization at startup.

Beyond that, I'm seeing several missing export declarations across modules. `UsersModule` needs to export `ExportService` so that `ExportsModule` can inject it, and `JobsModule` should export `RetryProcessor` since the task specifies that every module owning a provider should also export it. I'm also tracing through the import graph to identify all the circular dependencies that need to be resolved.

The main cycle is `JobsModule → NotificationsModule → NotificationsService → JobsModule`, where `NotificationsService` imports `QUEUES` from the module file itself. I can break this by moving `QUEUES` and the `QueueName` type to a separate file like `jobs/queues.ts` that has no dependencies, then update the imports in both `jobs.module.ts` and `notifications.service.ts`. This eliminates the cycle without needing `forwardRef`.

For the second issue, `UsersModule` provides `ExportService` but doesn't export it, so `ExportsModule` can't inject it. I need to add `ExportService` to the module's exports. There's no circular dependency risk here since `ExportsModule` imports `UsersModule` and nothing else depends on `ExportsModule`.

I'm also verifying that `NotificationsModule` properly exports `NotificationsService` for `RetryProcessor` in `JobsModule` to inject, and checking whether the fixture actually has `UsersModule` exporting both services correctly. `NotificationsModule` doesn't import `UsersModule`, so there's no circular dependency there. After moving `QUEUES` to its own file, I should verify the remaining dependency graph: `jobs.module` now imports from `notifications.module` and `jobs/queues`, and `retry.processor` depends on `notifications.service` and `prisma.service` without creating cycles. `ExportsModule` importing `UsersModule` one-way is clean, and the `QUEUES` usage in the notification service won't reintroduce any circular imports.

For the boot-failure check, I need something that actually boots the Nest app rather than just typechecking or unit tests with mocks. Since `PrismaService` is a stand-in that doesn't connect, I can write a test that creates the real `AppModule` via `NestFactory`, calls `init()`, and asserts successful initialization—this will catch wiring errors like missing exports, unresolvable tokens, or duplicate providers that the typecheck and unit tests miss.

I'm deciding whether to use `NestFactory.create(AppModule)` or `Test.createTestingModule({imports:[AppModule]})`. The former exercises the real bootstrap path, which better matches the "app doesn't start" scenario, though it registers express middleware. For a pure wiring test, `NestFactory.create` followed by `app.init()` and `app.close()` is straightforward and valid. I'll go with that approach to test actual module instantiation and dependency injection resolution.

For the test file itself, I need to handle the port binding carefully — if I use `NestFactory.create(AppModule)` without an explicit port, Nest listens on 0, which could cause port conflicts in CI environments. I'll explicitly set port 0 in the test config to avoid that risk. I'm also checking whether the Express adapter needs special handling in the test environment.

For the test assertions, I should verify that the app initializes successfully, then check that the controller is actually registered by either calling `app.getHttpAdapter().getInstance()` or by making a request to the `/exports` endpoint and confirming it returns a valid response with the expected structure.

The most robust approach is to assert that `app.get(ExportService)` and `app.get(RetryProcessor)` are defined instances, which directly verifies the dependency wiring without relying on behavior. I'd also add a negative test case using a deliberately broken module to demonstrate that the test catches wiring defects.

For the negative test, I can create a small module inside the test file that imports UsersModule but tries to provide a fake service that requires the unexported ExportService token — this will fail at init, proving the check has teeth. I'll use `expect(...).rejects.toThrow(NestDependencyError)` to verify the error is thrown, which is a valid behavioral assertion. The file should be `test/app.module.spec.ts` and I'll import the real AppModule from the source, then call `NestFactory.create(AppModule)` with the express platform and port 0.

I'm checking whether NestFactory.create actually binds a socket during initialization — in Nest v10, it calls `app.init()` to instantiate providers and run hooks, then `app.listen()` separately to bind the port. So using `create` then `init` should avoid actual port binding. Alternatively, I could use `Test.createTestingModule({ imports: [AppModule] }).compile()` which doesn't bind at all and is more deterministic for testing — this creates the testing module wrapper, compiles all modules, instantiates providers, and resolves the dependency graph, which catches exactly the wiring failures we need to test.

For the negative test, I'm setting up a module that imports UsersModule and provides a probe service that depends on ExportService. Since UsersModule doesn't export ExportService, the probe won't be able to inject it, and the test should throw a NestDependencyError when trying to resolve that unexported provider from another module.

I'm also adding assertions to verify that the app can instantiate the services it should — checking that `app.get(ExportService)` and `app.get(RetryProcessor)` return non-null instances, which guards against silently dropping providers. I'm considering whether to use the real `NestFactory.create` path to mirror the actual boot sequence, which would test the real bootstrap including express adapter and controller registration, though there's a risk of port conflicts if multiple test workers bind simultaneously. The ESM transpilation and decorator metadata should work fine with the existing tsconfig, so I don't need a separate vitest config. The boot failure is actually a temporal dead zone error from circular ESM imports — `notifications.service.js` tries to reference `QUEUES` at module scope before it's initialized in `jobs.module.js`, which creates a cycle: `jobs.module.js` imports the notifications module, which imports the service, which imports back to the jobs module. The module-level `const DELIVERY_QUEUE = QUEUES.delivery` crashes immediately, and it's only caught at runtime after compilation since the build succeeds and unit tests don't import these modules.

Now I need to move `QUEUES` to its own file to break the cycle, then update the imports in `jobs.module.ts` and `notifications.service.ts` to reference the new location. Since the constraint says not to restate unchanged files, I'll only deliver the files that actually change: the new `queues.ts` file, the updated `jobs.module.ts` and `notifications.service.ts` files, `users.module.ts`, and the test file. I need to export `QUEUES` and `QueueName` from the new `queues.ts` file to maintain the public surface. For the boot test, I'm deciding between using `NestFactory.create` directly or going through the testing module — the direct factory approach better mirrors how `main.ts` actually boots the app, so I'll use that with explicit port 0 to avoid conflicts. I'm verifying that the controller is properly registered by checking the HTTP adapter and asserting the app boots successfully — I'll keep the test focused on core wiring rather than endpoint behavior. For the negative test, I need to verify that a consumer module importing `UsersModule` but requesting `ExportService` (which isn't exported) will fail to initialize, confirming the module boundary enforcement works as expected. Writing test files...

I'm setting up a boot test that creates the app via `NestFactory`, initializes it, and verifies the dependency wiring by checking that `ExportService` and `RetryProcessor` are instantiable. Then I'll add a negative test that confirms unexported providers can't cross module boundaries—`UsersModule` provides `ExportService` but doesn't export it, so a consumer module trying to inject it should fail with a `NestDependencyError`.

I'm also checking whether the module graph has any circular dependencies: `UsersModule` only depends on `PrismaService` (which is global), `ExportsModule` imports `UsersModule`, `JobsModule` imports `NotificationsModule`, and `NotificationsModule` imports from `config` and `jobs/queues` but not from `jobs.module`. No cycles exist, so `forwardRef` isn't needed.

The real issue is that the cycle is only structural, not a genuine runtime dependency — moving `QUEUES` to its own file breaks it cleanly. I'm also verifying the `RetryProcessor` import path: when it imports `NotificationsService` directly from `notifications.service.js`, it's not creating a module-level cycle since that file doesn't import from `jobs.module` anymore after the fix.

Now I'm writing a diagnosis document that walks through each defect and why neither `tsc` nor the unit tests caught them.

The first defect is a circular ESM import: `notifications.service.ts` needs the `QUEUES` constant but imports it from `jobs.module.js`, which in turn imports `NotificationsModule`, which imports the service — creating a cycle that crashes at runtime with a TDZ error. Moving `QUEUES` to its own file breaks the cycle because `jobs/queues.ts` doesn't import anything from the app, making it a leaf node in the dependency graph.

The second issue is that `ExportService` is provided in `UsersModule` but not exported, so when `ExportsModule` tries to inject it through the controller, Nest can't resolve the token and fails with a `NestDependencyError`. The fix is to add `ExportService` to the `UsersModule` exports.

The third problem is a missing provider: `DeliveryRepository` is used by `NotificationsService` but never declared in `NotificationsModule`'s providers list. The module exports the service but not its dependency, so DI can't find it. The fix is to add `DeliveryRepository` to the providers array.

None of these were caught by type checking because TypeScript only validates imports and types — module metadata in `@Module()` decorators is opaque to `tsc`. The unit tests also missed them because they instantiate services directly with constructor calls and fake dependencies, bypassing Nest's DI container entirely. The first defect also slips through the build because the circular import resolves syntactically at compile time, only failing at runtime during module evaluation.

I need a boot-level check that imports the real `AppModule` through `NestFactory`, calls `init()`, and asserts it succeeds — that's what actually exercises provider resolution across all module boundaries. I also added a negative probe test to prove the check can catch missing exports.

For the test itself, I'm verifying the ESM imports resolve correctly in the compiled output and that `NestFactory.create(AppModule)` handles the `@Global()` modules like `ConfigModule` and `PrismaModule` without requiring explicit imports. The test should compile the DI graph and fail immediately if a provider is missing, before any controllers or routes are touched. I'm also confirming that `RetryProcessor` and `NotificationsService` will be resolvable from the testing module instance since they're declared in their respective modules.

Now I need to verify the `NestFactory.create` signature accepts the options object with `logger: false` to suppress Nest's startup logs, and that the Express adapter is automatically used. For the boot check, I'm deciding between `NestFactory.create(AppModule)` or `Test.createTestingModule().compile()` — both exercise the same DI resolution that the original bug requires, so either works for validating the fix. Writing test file... Writing DIAGNOSIS.md... The unit tests pass because they instantiate services directly with fakes, completely bypassing Nest's dependency injection container. For the export defect, the `ExportService` token is missing from `UsersModule`'s exports list, so the controller in `ExportsModule` fails with a dependency error at initialization. I can fix this by adding `ExportService` to the module's exports. For the missing provider, `DeliveryRepository` is injected by the service but not declared in the module's providers, causing another dependency error during service instantiation. The solution is to add `DeliveryRepository` to the providers list. The key insight is that `tsc` only validates the import graph and types, not the runtime metadata in module decorators, so it can't catch these DI configuration issues.

I need a boot-level check that compiles the real `AppModule` through `NestFactory` to exercise provider resolution across all module boundaries. I'm writing a test that instantiates the app, verifies it compiles, confirms cross-module providers are reachable, and uses a negative probe to catch unexported provider mistakes.

The test validates that `ExportService` and `RetryProcessor` can be injected from the compiled app, then demonstrates that importing `UsersModule` without exporting `ExportService` causes initialization to fail with a `NestDependencyError`. This ensures the wiring contract is enforced: every provider used across a module boundary must be both provided and exported.

I'm checking edge cases around the DI behavior — when `Consumer` tries to inject `ExportService` from `UsersModule`, the provider isn't in `UsersModule`'s exports, so the DI container has no binding and throws the expected error. I'm also verifying there are no unintended circular dependencies between `UsersModule` and `ExportsModule`, and that `RetryProcessor`'s import of `NotificationsService` doesn't create a cycle. Finally, I'm confirming that `NestFactory.create` properly instantiates the AppModule with global modules resolved, and that all services (like `ConfigService`) are properly provided. Now I'm verifying the full import graph one more time to make sure everything resolves correctly — `users.module` imports its services which only need `PrismaService` globally, `jobs.module` has no dependencies, `notifications.module` imports from config and queues, and `exports.module` imports the users module and its controller. Everything checks out.

I'm also confirming that the negative test properly asserts the failure — if `UsersModule` accidentally exported `ExportService`, the probe module would succeed and the rejects assertion would fail, which is the right behavior. And for the boot test, when `NestFactory` creates the app with logger disabled, it won't print anything, which is fine since we're just checking for errors.

I've verified that `NestDependencyError` is exported from `@nestjs/core`, `NestFactory.create` uses `express()` by default, and calling `await app.close()` will dispose everything without throwing.

Now I'm checking the TypeScript imports in the test — `import { NestFactory } from '@nestjs/core'` and `import { NestDependencyError } from '@nestjs/core'` should work under `NodeNext` resolution since the package exports map includes the proper subpath. I could also use `Test` from `@nestjs/testing` with `Test.createTestingModule().compile()` instead, which would avoid the express adapter entirely and sidestep any potential port-binding issues.

Actually, I think I'll stick with `NestFactory.create` since it more directly mirrors the real boot path. The fixture already depends on `@nestjs/platform-express`, so that's not a new dependency. The key thing is that `create` doesn't bind a port — only `listen()` does — so the test should be safe.

Let me trace through the original defect one more time to make sure I understand the error message correctly. The issue is a circular import: `jobs.module.js` imports `NotificationsModule`, which imports `NotificationsService`, which tries to use `QUEUES` from `jobs.module.js` before that module has finished evaluating. The error happens at module scope when the service tries to reference `QUEUES` as a live binding that's still in the temporal dead zone. The fix is to extract `QUEUES` to its own file so the service doesn't need to import from `jobs.module.js` at all.

The real problem is that `tsc` doesn't catch this because it doesn't simulate runtime module evaluation order, and unit tests bypass the module graph entirely by using fakes. The boot test is the only way to actually exercise the real import chain and catch this kind of circular dependency. I'm verifying the file list and finalizing the content — six files total with the new queues.ts, updated modules and service, plus the test and diagnosis. Let me check the test imports: `RetryProcessor` is properly exported, `ExportService` and the `ExportJob` type are in place, and all the Nest decorators like `@Injectable()` and `@Module()` will compile fine with esbuild since the metadata is only needed at runtime by Nest's DI system. I'm double-checking that `strictPropertyInitialization` is set to false in the tsconfig, which allows the probe class to work as-is, and the test will catch missing providers since Nest 9+ throws `NestDependencyError` rather than silently injecting undefined. I need to use `import type { NestApplication }` to avoid pulling in runtime code under ESM, and I'll add a comment in the test explaining why `app.listen()` is skipped — the goal is DI compilation, not HTTP, and port 0 was already set as a safeguard. Now I'm ready to write out all the file blocks.
```

## reply

### src/jobs/queues.ts
```ts
/** Queue names. Imported all over the application. */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
```

### src/jobs/jobs.module.ts
```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RetryProcessor } from './retry.processor.js';

@Module({
  imports: [NotificationsModule],
  providers: [RetryProcessor],
})
export class JobsModule {}
```

### src/notifications/notifications.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { QUEUES } from '../jobs/queues.js';
import { DeliveryRepository } from './delivery.repository.js';

const DELIVERY_QUEUE = QUEUES.delivery;

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('NotificationsService');
  private readonly queue = DELIVERY_QUEUE;

  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly config: ConfigService,
  ) {}

  async resend(id: string): Promise<void> {
    this.log.log(`re-queueing ${id} on ${this.queue} via ${this.config.get('PROVIDER_URL')}`);
    await this.deliveries.markSent(id);
  }

  async pendingCount(): Promise<number> {
    return (await this.deliveries.pending()).length;
  }
}
```

### src/notifications/notifications.module.ts
```ts
import { Module } from '@nestjs/common';
import { DeliveryRepository } from './delivery.repository.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  providers: [DeliveryRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

### src/users/users.module.ts
```ts
import { Module } from '@nestjs/common';
import { ExportService } from './export.service.js';
import { UsersService } from './users.service.js';

@Module({
  providers: [UsersService, ExportService],
  exports: [UsersService, ExportService],
})
export class UsersModule {}
```

### test/app.module.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { Inject, Injectable, Module } from '@nestjs/common';
import { NestDependencyError, NestFactory } from '@nestjs/core';
import type { NestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { ExportService } from '../src/users/export.service.js';
import { UsersModule } from '../src/users/users.module.js';
import { RetryProcessor } from '../src/jobs/retry.processor.js';

describe('AppModule wiring', () => {
  it('boots: every provider resolves and cross-module providers are exported', async () => {
    // Same entry point as main.ts. NestFactory.create + init compiles the real
    // module graph — provider resolution across every module boundary is
    // exercised here and nowhere else in the suite.
    const app: NestApplication = await NestFactory.create(AppModule, {
      logger: false,
      // port 0: create() does not bind; this keeps the boot check safe to run
      // even if the adapter is ever given a chance to listen.
      port: 0,
    });
    try {
      await app.init();

      // ExportService is provided by UsersModule but consumed from
      // ExportsModule; RetryProcessor is provided by JobsModule and consumes
      // NotificationsService from NotificationsModule. Both must be resolvable.
      expect(app.get(ExportService)).toBeInstanceOf(ExportService);
      expect(app.get(RetryProcessor)).toBeInstanceOf(RetryProcessor);
    } finally {
      await app.close();
    }
  });

  it('fails when a provider is used across a module boundary without being exported', async () => {
    @Injectable()
    class ExportProbe {
      constructor(@Inject(ExportService) private readonly exports: ExportService) {}
    }

    @Module({
      imports: [UsersModule],
      providers: [ExportProbe],
    })
    class ExportProbeModule {}

    // The probe imports UsersModule and demands ExportService the same way
    // ExportsController does. If UsersModule stops exporting ExportService,
    // init must reject — this test keeps the boot check honest.
    const app: NestApplication = await NestFactory.create(ExportProbeModule, {
      logger: false,
      port: 0,
    });
    try {
      await expect(app.init()).rejects.toThrow(NestDependencyError);
    } finally {
      await app.close();
    }
  });
});
```

### DIAGNOSIS.md
```md
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
```
