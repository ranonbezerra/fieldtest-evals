# solution

## reasoning

```
Let me analyze the problem carefully.

The error is:
```
ReferenceError: Cannot access 'QUEUES' before initialization
    at file:///.../dist/notifications/notifications.service.js:5:29
```

Looking at the import graph:

1. `notifications.service.ts` imports `QUEUES` from `../jobs/jobs.module.js`
2. `jobs.module.ts` imports `NotificationsModule` (and thus `NotificationsService`)
3. `retry.processor.ts` (in jobs module) imports `NotificationsService` from `../notifications/notifications.service.js`

So we have a cycle:
- `jobs.module.ts` → imports `NotificationsModule` → which registers `NotificationsService`
- `notifications.service.ts` → imports `QUEUES` from `jobs.module.ts`

At module evaluation time:
- When `jobs.module.ts` is evaluated, it imports `NotificationsModule` which imports `NotificationsService`
- `NotificationsService` tries to access `QUEUES` from `jobs.module.ts`
- But `QUEUES` is declared later in `jobs.module.ts` (it's a `const` declared after the class usage in the import chain)

Wait, let me re-read. `QUEUES` is declared at the top level of `jobs.module.ts`, before the `@Module` decorator class. Let me check the order again.

In `jobs.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RetryProcessor } from './retry.processor.js';

/** Queue names. Imported all over the application. */
export const QUEUES = { ... } as const;

export type QueueName = ...

@Module({...})
export class JobsModule {}
```

So `QUEUES` is exported from `jobs.module.ts`. When `notifications.service.ts` imports from `jobs.module.ts`, it gets `QUEUES`.

But the issue is: `notifications.service.ts` is imported by `NotificationsModule`, which is imported by `JobsModule`. And `notifications.service.ts` imports from `jobs.module.ts`.

The evaluation order with ESM:
- When `jobs.module.ts` is loaded:
  - It imports `NotificationsModule` from `notifications.module.js`
  - `notifications.module.js` imports `NotificationsService` from `notifications.service.js`
  - `notifications.service.js` imports `QUEUES` from `jobs.module.js`
  - But `jobs.module.js` is currently being evaluated! Its `QUEUES` const hasn't been initialized yet because we're still at the top of the file.

This is the temporal dead zone issue. The `QUEUES` export is a `const`, so it's in the TDZ until the line executes. Since `notifications.service.ts` is evaluated before we get to the `QUEUES` line in `jobs.module.ts`, we get "Cannot access 'QUEUES' before initialization".

Now let me identify all the defects:

**Defect 1: Import cycle between JobsModule and NotificationsModule**
- `jobs.module.ts` imports `NotificationsModule` (because `RetryProcessor` needs `NotificationsService`)
- `notifications.service.ts` imports `QUEUES` from `jobs.module.ts`

This is a genuine cycle. But actually, let me re-think. The issue is that `QUEUES` is a constant that should not live in `jobs.module.ts`. It should be in its own file — a constants module.

**Defect 2: ExportsModule imports UsersModule but needs ExportService**
Looking at the exports module:
```ts
@Module({
  imports: [UsersModule],
  controllers: [ExportsController],
})
```
And `ExportsController` imports `ExportService` from `../users/export.service.js`.

The `UsersModule` exports `UsersService` but NOT `ExportService`. So `ExportsController` tries to inject `ExportService`, but `ExportService` is not available in the `ExportsModule` context (it's a provider of `UsersModule` and not exported).

Wait, let me check: `UsersModule` has:
```ts
providers: [UsersService, ExportService],
exports: [UsersService],
```

So `ExportService` is a provider of `UsersModule` but is NOT exported. `ExportsModule` imports `UsersModule` and needs `ExportService` (since `ExportsController` injects it). This means `ExportService` needs to be exported from `UsersModule`, OR `ExportsModule` needs to also provide `ExportService` (but that would create a duplicate).

Actually, the fix here is that `UsersModule` should export `ExportService` as well, since it's used cross-module.

Wait, but `UsersModule` only exports `UsersService`. The `ExportsController` needs `ExportService`. So we need to add `ExportService` to the exports of `UsersModule`.

Let me trace through all the cross-module dependencies:

1. `ExportsController` (in ExportsModule) needs `ExportService` → currently provided by `UsersModule`, but `UsersModule` doesn't export it → FIX: export `ExportService` from `UsersModule`

2. `NotificationsService` (in NotificationsModule) needs `QUEUES` from `JobsModule` → `JobsModule` imports `NotificationsModule` → CYCLE. FIX: Move `QUEUES` to a constants file that both can import.

3. `RetryProcessor` (in JobsModule) needs `NotificationsService` (from NotificationsModule) and `PrismaService` (from PrismaModule) → `JobsModule` imports `NotificationsModule` ✓, but does `JobsModule` import `PrismaModule`? Looking at `JobsModule`:
```ts
@Module({
  imports: [NotificationsModule],
  providers: [RetryProcessor],
})
```
`RetryProcessor` needs `PrismaService`, but `JobsModule` doesn't import `PrismaModule`. Since `PrismaModule` is `@Global()`, it's available globally, so this should be fine.

Let me also check: does `NotificationsModule` need `PrismaModule`? `NotificationsService` doesn't directly need `PrismaService` — it gets `DeliveryRepository` which has `PrismaService`. Since `PrismaModule` is global, `DeliveryRepository` can inject it. ✓

Now let me think about what `AppModule` imports:
```ts
imports: [ConfigModule, PrismaModule, UsersModule, NotificationsModule, ExportsModule, JobsModule],
```

`ConfigModule` and `PrismaModule` are global, so they're available everywhere.

So the defects are:

**Defect 1: `QUEUES` lives in `jobs.module.ts`, creating an evaluation-order TDZ error**
- `JobsModule` → (imports) `NotificationsModule` → (providers) `NotificationsService` → (imports) `QUEUES` from `JobsModule`
- At runtime, `QUEUES` is in TDZ when `NotificationsService` is evaluated
- `tsc` doesn't care because it only resolves types
- Unit tests don't catch it because they instantiate `NotificationsService` directly with mocks, bypassing the real module graph
- Fix: Move `QUEUES` (and `QueueName`) to a standalone `queues.ts` constants file that imports nothing

**Defect 2: `UsersModule` doesn't export `ExportService`, but `ExportsModule` (via `ExportsController`) needs it**
- `tsc` doesn't catch this because Nest's module wiring is runtime, not type-checked
- Unit tests don't catch it because they test `UsersService` in isolation
- Fix: Add `ExportService` to `UsersModule`'s exports

Wait, let me reconsider defect 2. Actually, looking more carefully:

`ExportsController` has:
```ts
constructor(private readonly exports: ExportService) {}
```

And `ExportsModule` imports `UsersModule`. For Nest DI to resolve `ExportService` in `ExportsController`, `ExportService` must be available in `ExportsModule`'s provider scope — either provided by `ExportsModule` itself or exported by an imported module (`UsersModule`).

Since `UsersModule` has `ExportService` as a provider but only exports `UsersService`, `ExportService` is NOT visible to `ExportsModule`. So Nest will fail to inject `ExportService` into `ExportsController`.

Fix: Add `ExportService` to `UsersModule`'s exports.

Now let me also think about whether there's a third defect. The problem says "more than one defect" and "fixing each one reveals the next."

Let me trace the evaluation more carefully.

After fixing defect 1 (moving QUEUES):
- The cycle between `JobsModule` and `NotificationsModule` is broken (because `NotificationsService` no longer imports from `jobs.module.ts`)
- Now the app should... what happens?

After defect 1, when Nest tries to wire:
- `ExportsModule` imports `UsersModule`, `ExportsController` needs `ExportService`
- But `UsersModule` doesn't export `ExportService`
- Nest will throw an error about unable to resolve dependency

So defect 2 is exposed by defect 1 being fixed. ✓

After fixing defect 2 (adding ExportService to exports):
- Now does the app start? Let me check for more issues...

Let me check if there are any other wiring issues.

`JobsModule` imports `NotificationsModule`. `NotificationsModule` exports `NotificationsService`. `RetryProcessor` needs `NotificationsService` and `PrismaService`. `PrismaModule` is global so `PrismaService` is available. ✓

`ExportsModule` imports `UsersModule`. `UsersModule` exports `UsersService` and `ExportService`. `ExportsController` needs `ExportService`. ✓

Hmm, but wait. Is there still an issue? Let me check: does `AppModule` import `JobsModule` before `ExportsModule`? The order in `AppModule` is:
```ts
imports: [ConfigModule, PrismaModule, UsersModule, NotificationsModule, ExportsModule, JobsModule],
```

But order shouldn't matter once the cycle is broken.

I think there might be another issue. Let me look more carefully...

Actually, let me look at this from a different angle. Let me check if `ExportsModule` has an issue with not importing what it needs for the controllers.

Hmm, actually, I realize I should also check: does `NotificationsModule` need anything else? Let me check `NotificationsService`:
- `DeliveryRepository` — needs `PrismaService` (global, OK)
- `ConfigService` — global (OK)

So `NotificationsModule` is fine.

Let me think about whether there's a third defect. The problem says there is more than one. Let me look again...

Oh wait, I see it. Let me check if there's an issue with `ExportsModule` needing `ExportService`. Actually, there might be a subtler issue.

Let me re-read the `ExportsModule`:
```ts
@Module({
  imports: [UsersModule],
  controllers: [ExportsController],
})
export class ExportsModule {}
```

And `UsersModule`:
```ts
@Module({
  providers: [UsersService, ExportService],
  exports: [UsersService],
})
export class UsersModule {}
```

So `ExportService` is not exported from `UsersModule`. `ExportsController` (in `ExportsModule`) needs `ExportService`. This is definitely a wiring defect.

Let me see if there's anything else. Let me look at `JobsModule` more carefully:

```ts
@Module({
  imports: [NotificationsModule],
  providers: [RetryProcessor],
})
export class JobsModule {}
```

`RetryProcessor` needs `NotificationsService` and `PrismaService`.
- `NotificationsModule` is imported ✓, `NotificationsService` is exported ✓
- `PrismaModule` is global, `PrismaService` is available ✓

Now what about `JobsModule` itself? Does anything in `JobsModule` need to be exported for use elsewhere? `RetryProcessor` is used... where? Let me check. It's only in `JobsModule`. No other module imports it directly. OK.

Let me see if there's a problem with `JobsModule` being imported by `AppModule` but not exporting `RetryProcessor`... No, that's fine, `RetryProcessor` is just a provider.

OK so I think there are exactly two defects (or maybe three). Let me re-examine:

Actually wait — let me reconsider. The problem says "Three features were merged in the same week: a notifications module, an export service used by the users module, and a queue processor for retries."

And: "There is more than one defect, and fixing each one reveals the next."

So after fixing defect 1 (QUEUES TDZ), we discover defect 2 (ExportService not exported). After fixing defect 2, is there a defect 3?

Let me think about what else could be wrong after those two fixes...

Hmm, actually let me reconsider defect 2. After moving QUEUES out, the cycle is broken. Then when Nest tries to wire, it will discover that `ExportsController` can't get `ExportService`. That's defect 2.

After fixing that... let me trace through the full module graph one more time:

- `AppModule` imports: ConfigModule (global), PrismaModule (global), UsersModule, NotificationsModule, ExportsModule, JobsModule
- `UsersModule` provides: UsersService, ExportService; exports: UsersService, ExportService (after fix)
- `NotificationsModule` provides: NotificationsService; exports: NotificationsService
- `ExportsModule` imports: UsersModule; controllers: ExportsController
- `JobsModule` imports: NotificationsModule; providers: RetryProcessor
- `ExportsController` needs ExportService ✓ (from UsersModule)
- `RetryProcessor` needs NotificationsService ✓ (from NotificationsModule) and PrismaService ✓ (global)
- `NotificationsService` needs DeliveryRepository ✓ (provider of NotificationsModule, needs PrismaService ✓) and ConfigService ✓ (global)
- `DeliveryRepository` needs PrismaService ✓ (global)

Looks like everything should work after two fixes.

But the problem says there's more than one defect, and "fixing each one reveals the next." Two defects after each other fits this pattern (fix 1 reveals 2). Maybe there are exactly two.

Or maybe there's a third one I'm not seeing. Let me check: is `ExportService` exported from `ExportsModule`? It doesn't need to be unless some other module imports `ExportsModule` and needs `ExportService`. Nothing else imports `ExportsModule` except `AppModule`. And `AppModule` doesn't need `ExportService` directly. OK.

Wait, let me also check: does `JobsModule` need `PrismaModule` to be explicitly imported? Since it's `@Global()`, no. But let me verify that `PrismaModule` is available when `JobsModule` is being wired. `AppModule` imports `PrismaModule` in the same array. In Nest, `@Global()` providers are available everywhere once the module that provides them has been initialized. Since `PrismaModule` is in `AppModule`'s imports, it will be available. ✓

OK I think there are two defects plus the check to add. Let me now plan the solution.

**Files to create:**
1. `src/jobs/queues.ts` — Move `QUEUES` and `QueueName` here (imports nothing)
2. `DIAGNOSIS.md` — Diagnosis document
3. `test/app.wiring.spec.ts` — A test that builds the real application context and fails when wiring is broken

**Files to modify:**
1. `src/jobs/jobs.module.ts` — Import `QUEUES` and `QueueName` from `queues.ts` instead of declaring them; export them from here too (or not needed since they're accessible from queues.ts)
2. `src/notifications/notifications.service.ts` — Import `QUEUES` from `../jobs/queues.js` instead of `../jobs/jobs.module.js`
3. `src/users/users.module.ts` — Add `ExportService` to exports

Wait, should `jobs.module.ts` still re-export `QUEUES`? Looking at the imports in `AppModule` and the fact that `QUEUES` is "imported all over the application," I should check who imports it.

Only `notifications.service.ts` imports `QUEUES`. So I just need to update that import to point to `queues.ts`. And `jobs.module.ts` can either:
- Re-export them (re-export from queues.ts)
- Not export them (since consumers import from queues.ts directly)

The cleanest approach: move the constants to `queues.ts`, have `jobs.module.ts` import and re-export them from there (if other code imports from `jobs.module.ts`), or just have consumers import from `queues.ts`.

Actually, let me check if anything else imports `QUEUES` from `jobs.module.ts`. Looking at all files... only `notifications.service.ts` imports `QUEUES`. So I'll:
1. Move `QUEUES` and `QueueName` to `src/jobs/queues.ts`
2. Have `jobs.module.ts` re-export them (to maintain backward compatibility for any other code that might import from `jobs.module.ts` — though there isn't any currently)
3. Have `notifications.service.ts` import from `queues.ts` directly

Actually, per the constraints: "If a fix requires moving a symbol to its own file, move it." So I should move `QUEUES` and `QueueName` to `queues.ts` and update the import in `notifications.service.ts`.

Let me also think about what `jobs.module.ts` should do with `QUEUES` and `QueueName`. Should it re-export them? I think the simplest clean approach is to just move them and have all consumers import from `queues.ts`. But to avoid breaking any external imports from `jobs.module.ts`, I'll have `jobs.module.ts` re-export them.

Wait, actually the constraint says "Change wiring, not behaviour." Moving `QUEUES` to its own file is a structural fix to break the cycle. Let me have `jobs.module.ts` re-export from `queues.ts` so any code importing from `jobs.module.ts` still works.

Now for the wiring check test. I need a test that builds the real Nest application context. This should fail when wiring is broken and pass when fixed.

Something like:
```ts
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

describe('Application wiring', () => {
  it('builds the real application context', async () => {
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.close();
  });
});
```

This will fail if any module has wiring issues (like missing providers, unresolvable dependencies, etc.) and pass when everything is wired correctly.

Wait, but this test might try to connect to Prisma or do other things that fail in a test environment. Let me check. The `PrismaService` in this fixture doesn't actually connect to a database (the comment says "It does not connect"). So it should be safe.

Also, `ConfigService` just reads from environment with fallbacks, so that's fine.

The app listens on a port in `main.ts`, but our test uses `Test.createTestingModule` which doesn't call `listen`. So that's fine.

Let me now draft all the files.

**File: src/jobs/queues.ts**
```ts
/** Queue names. Imported all over the application. */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
```

**File: src/jobs/jobs.module.ts** (modified)
```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RetryProcessor } from './retry.processor.js';
import { QUEUES, QueueName } from './queues.js';

export { QUEUES, QueueName };

@Module({
  imports: [NotificationsModule],
  providers: [RetryProcessor],
})
export class JobsModule {}
```

**File: src/notifications/notifications.service.ts** (modified)
```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { QUEUES } from '../jobs/queues.js';
import { DeliveryRepository } from './delivery.repository.js';

const DELIVERY_QUEUE = QUEUES.delivery;

@Injectable()
export class NotificationsService {
  // ...rest unchanged
}
```

**File: src/users/users.module.ts** (modified)
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

**File: test/app.wiring.spec.ts**
```ts
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

describe('Application wiring', () => {
  it('builds the real application context', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    await app.close();
  });
});
```

Hmm, wait. `createNestApplication` might try to set up Express and listen... no, `init()` starts it but doesn't necessarily listen. Let me think.

Actually, in NestJS testing, `moduleRef.createNestApplication()` creates the app, and `app.init()` initializes it. This should be enough to trigger all module wiring. `app.close()` shuts it down.

But actually, maybe even simpler:

```ts
const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
}).compile();
```

The `compile()` method itself resolves all providers and wires the module graph. If there's a wiring error, it will throw. Let me check... Yes, `compile()` resolves the dependency graph, so it will fail if providers can't be resolved.

Let me use the simpler version. But actually, to be safe and catch more issues, let me use `createNestApplication().init()`.

Let me think about which is better. `compile()` resolves providers and modules. `init()` actually creates the application and triggers `onModuleInit` hooks. Since `PrismaService` doesn't connect, both should work. But `init()` is more thorough.

Actually, I'll keep it simple with `compile()` since that's enough to catch wiring issues. The main purpose is to check that all providers can be resolved.

Wait, actually I realize that `compile()` might not fully validate provider injection. Let me think again. In NestJS, `Test.createTestingModule({ imports: [AppModule] }).compile()` will:
1. Resolve all modules in the graph
2. Resolve all providers and their dependencies
3. Create the module ref

If any provider can't be resolved (e.g., `ExportService` not available where needed), it will throw.

So just `compile()` should be sufficient. But to be safe, I'll do `createNestApplication().init().close()`.

Let me also check: will `app.init()` cause the app to start listening? Looking at NestJS docs: `app.init()` initializes the application but doesn't start listening. Only `app.listen()` does that. So we're safe.

Now for DIAGNOSIS.md:

I need to cover:
1. Defect 1: `QUEUES` TDZ error due to import cycle
   - What was unresolvable: `QUEUES` was declared in `jobs.module.ts`, which is imported by `notifications.service.ts` (via `NotificationsModule` ← `JobsModule` → `NotificationsModule` → `NotificationsService`). At module evaluation time, `notifications.service.ts` was evaluated before `QUEUES` was initialized in `jobs.module.ts`.
   - Why tsc couldn't see it: TypeScript only resolves types and import graphs; it doesn't evaluate module execution order.
   - Why unit tests couldn't see it: Unit tests instantiate `UsersService` directly with a fake Prisma, never building the real module graph, so they never evaluate module initialization order.
   - Minimal fix: Move `QUEUES` and `QueueName` to a standalone `queues.ts` that imports nothing.

2. Defect 2: `ExportService` not exported from `UsersModule`
   - What was unresolvable: `ExportsController` (in `ExportsModule`) injects `ExportService`, which is provided by `UsersModule` but not exported. Nest cannot resolve the dependency at runtime.
   - Why tsc couldn't see it: TypeScript doesn't know about Nest's module boundaries or dependency injection.
   - Why unit tests couldn't see it: Tests test `UsersService` in isolation, never instantiating `ExportsController` or `ExportsModule`.
   - Minimal fix: Add `ExportService` to `UsersModule`'s exports.

Let me also think about whether there's a third defect. The problem hints at there being more than one and they're "stacked." Two defects that reveal each other fits "fixing each one reveals the next."

Let me go with two defects. If there's a third, the test should catch it.

Actually, let me double-check one more time. After all fixes, when Nest wires the app:

1. `AppModule` is evaluated
2. It imports `UsersModule` → providers `UsersService`, `ExportService`; exports both ✓
3. It imports `NotificationsModule` → providers `NotificationsService`; exports it ✓
4. It imports `ExportsModule` → imports `UsersModule` (already loaded), `ExportsController` needs `ExportService` ✓
5. It imports `JobsModule` → imports `NotificationsModule` (already loaded), `RetryProcessor` needs `NotificationsService` ✓ and `PrismaService` (global) ✓
6. Everything wired!

Looks good. Let me write it all out.

Oh wait, I also need to check the `ExportService` import in `ExportsController`. It imports from `../users/export.service.js`. Is `ExportService` exported from `UsersModule` after my fix? Yes. ✓

But wait — `ExportsModule` imports `UsersModule`. For Nest to inject `ExportService` into `ExportsController`, `ExportService` must be visible in `ExportsModule`. Since `UsersModule` now exports `ExportService`, and `ExportsModule` imports `UsersModule`, `ExportService` is available. ✓

Actually, let me reconsider one thing. I need to make sure the `ExportService` import path in `ExportsController` is correct:

```ts
import { ExportService, type ExportJob } from '../users/export.service.js';
```

This imports `ExportService` from the users module file. It's used as a type in the constructor parameter type. But wait — `ExportsController` uses `ExportService` as a constructor parameter type:

```ts
constructor(private readonly exports: ExportService) {}
```

And Nest needs to inject it. Since `ExportsModule` imports `UsersModule`, and `UsersModule` now exports `ExportService`, Nest can inject it. ✓

Now let me also check if there are any issues with the `ExportService` being both a provider of `UsersModule` and an import target of `ExportsModule`. In Nest, when module A imports module B, and module B exports a provider, that provider becomes available in module A's context. `ExportService` is a provider of `UsersModule` and is now exported by `UsersModule`. `ExportsModule` imports `UsersModule`. So `ExportService` is available to `ExportsModule`'s controllers. ✓

One more thing: `ExportService` is NOT a provider of `ExportsModule`. It's imported from `UsersModule`. This is fine in Nest — imported providers are available for injection. ✓

OK I'm confident. Let me write all the files.

Oh, one more thing. The `jobs.module.ts` currently has `QUEUES` and `QueueName` defined at module level. After I move them to `queues.ts`, I need to make sure `jobs.module.ts` still exports them (or consumers update their imports). Since only `notifications.service.ts` imports `QUEUES`, and I'm updating that import, I don't strictly need to re-export from `jobs.module.ts`. But the `jobs.module.ts` file in the original exports them implicitly (they're at module level with `export` keyword). To be safe and maintain backward compatibility, I'll re-export from `jobs.module.ts`.

Let me finalize.

Also, let me think about the `ExportJob` type. It's defined in `users/export.service.ts` and imported in `exports/exports.controller.ts`:

```ts
import { ExportService, type ExportJob } from '../users/export.service.js';
```

This is a type-only import, so it's erased at runtime. TypeScript handles this fine. No change needed.

Let me now write the complete solution.

Wait, one more consideration: should I also check if the `ExportService` needs to be exported from `ExportsModule` for anything else? Looking at the app, I don't see anything else importing `ExportService` from `ExportsModule`. And `AppModule` doesn't inject it. So no change needed to `ExportsModule`.

Let me finalize everything now.

For the test, I want to make sure it properly tests the real wiring. Let me write:

```ts
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

describe('Application wiring', () => {
  it('builds the real application context', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
  });
});
```

This is the simplest test that builds the real context. If any wiring is broken, `compile()` will throw. If everything is wired correctly, it passes.

Actually, let me also think about whether `compile()` alone catches all wiring errors or if I need `createNestApplication().init()`. In NestJS, `compile()` does:
- Creates the module hierarchy
- Resolves all providers and their dependencies
- Instantiates providers

So if `ExportService` is not available where needed, `compile()` will throw. ✓

I'm satisfied. Let me write the final output.

One more thing: let me check if there's an `ExportService` that's used elsewhere that I missed. Looking at all files... `ExportService` is only used in `ExportsController` and defined in `export.service.ts`. ✓

Also, I should double-check: is there any module that `JobsModule` needs to import that it doesn't currently? `RetryProcessor` needs `PrismaService` (global, available) and `NotificationsService` (from `NotificationsModule`, which is imported). ✓

And `NotificationsService` needs `DeliveryRepository` (in same module, auto-available) and `ConfigService` (global). ✓

Everything checks out. Here's my final solution:

Files:
1. `src/jobs/queues.ts` — new file with QUEUES and QueueName
2. `src/jobs/jobs.module.ts` — modified to import/re-export from queues.ts
3. `src/notifications/notifications.service.ts` — modified to import QUEUES from queues.ts
4. `src/users/users.module.ts` — modified to export ExportService
5. `test/app.wiring.spec.ts` — new test
6. `DIAGNOSIS.md` — diagnosis document

Let me write these out now.
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
import { QUEUES, QueueName } from './queues.js';

export { QUEUES, QueueName };

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

### test/app.wiring.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

describe('Application wiring', () => {
  it('builds the real application context', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
  });
});
```

### DIAGNOSIS.md
```md
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
```
