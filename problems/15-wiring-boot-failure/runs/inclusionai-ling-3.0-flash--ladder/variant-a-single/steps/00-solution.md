# solution

## reasoning

```
Let me analyze the problem carefully.

The error is:
```
ReferenceError: Cannot access 'QUEUES' before initialization
    at file:///.../dist/notifications/notifications.service.js:5:29
```

Let me trace the import graph to find cycles.

1. `AppModule` imports: ConfigModule, PrismaModule, UsersModule, NotificationsModule, ExportsModule, JobsModule

2. Let me trace each module's imports:
   - `ConfigModule` - imports nothing (global)
   - `PrismaModule` - imports nothing (global)
   - `UsersModule` - imports nothing, provides UsersService, ExportService
   - `NotificationsModule` - imports nothing, provides NotificationsService
   - `ExportsModule` - imports UsersModule, provides ExportsController
   - `JobsModule` - imports NotificationsModule, provides RetryProcessor

3. Now let me trace the actual TypeScript imports:
   - `NotificationsService` (in notifications.service.ts) imports `QUEUES` from `../jobs/jobs.module.js`
   - `RetryProcessor` (in retry.processor.ts) imports `NotificationsService` from `../notifications/notifications.service.js`
   - `ExportsController` (in exports.controller.ts) imports `ExportService` from `../users/export.service.js`
   - `ExportService` (in export.service.ts) imports `PrismaService` from `../prisma/prisma.service.js`

So the cycle is:
- `JobsModule` imports `NotificationsModule`
- `NotificationsService` imports from `JobsModule` (QUEUES)

This creates an import cycle at the module level: JobsModule → NotificationsModule → (via NotificationsService importing QUEUES from jobs.module) → JobsModule

The `QUEUES` constant is defined in `jobs.module.ts` and imported by `notifications.service.ts`. This means when Node.js evaluates `notifications.service.ts` (which happens because `NotificationsModule` needs to evaluate `NotificationsService`), it needs to evaluate `jobs.module.ts`. But `jobs.module.ts` imports `NotificationsModule` (which in turn needs `NotificationsService`), creating a temporal dead zone issue.

The fix: Move `QUEUES` (and `QueueName` type) to its own file that imports nothing, like `src/jobs/queue.constant.ts` or `src/jobs/queues.ts`.

Now let me identify all the defects:

**Defect 1: Import cycle via QUEUES**
- `JobsModule` imports `NotificationsModule`
- `NotificationsService` imports `QUEUES` from `JobsModule`
- This is a cycle: at runtime, when evaluating `JobsModule`, it needs `NotificationsModule`, which needs `NotificationsService`, which needs `QUEUES` from `JobsModule` — but `JobsModule` hasn't finished evaluating yet.
- Fix: Move `QUEUES` and `QueueName` to a separate file (e.g., `src/jobs/queue.constant.ts`) that imports nothing.

**Defect 2: UsersModule doesn't export ExportService**
- `ExportsController` imports `ExportService` from `../users/export.service.js`
- `ExportsModule` imports `UsersModule`
- But `UsersModule` only exports `UsersService`, not `ExportService`
- Wait, actually in NestJS, the controller injects `ExportService` which needs to be available. Since `ExportsModule` imports `UsersModule`, and `ExportService` is a provider in `UsersModule` but not exported, it won't be available to `ExportsModule`'s controller.
- Actually wait - let me re-read. `ExportsController` is in `ExportsModule`. It needs `ExportService`. `ExportService` is provided in `UsersModule`. But `UsersModule` doesn't export `ExportService`. So `ExportsModule` can't access it through the import.
- This means `ExportService` needs to be exported from `UsersModule`.

Wait, let me reconsider. The issue says "every provider used across a module boundary is in the owner's exports and the consumer's imports." So if `ExportsModule` uses `ExportService` (via the controller), and `ExportService` lives in `UsersModule`, then `UsersModule` must export it.

Currently `UsersModule` exports only `UsersService`. So `ExportService` is not exported. This is a wiring defect.

**Defect 3: UsersModule doesn't provide/export ExportService**
Looking at the wiring: `ExportsController` injects `ExportService`. `ExportService` is in `UsersModule`'s providers but not in its `exports`. `ExportsModule` imports `UsersModule`. So Nest won't be able to resolve `ExportService` for `ExportsController`.

Let me also check if there are other issues...

Let me check `NotificationsModule`:
- It provides `NotificationsService` and exports it. Good.

But wait - does `NotificationsModule` need `ConfigService`? Yes, `NotificationsService` needs `ConfigService`. But `ConfigModule` is global and is imported by `AppModule`. Since it's global, any module can use it. Good.

Does `NotificationsModule` need `DeliveryRepository`? `NotificationsService` needs `DeliveryRepository`. But `DeliveryRepository` is not in `NotificationsModule`'s providers! Looking at the module:

```ts
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

`NotificationsService` needs `DeliveryRepository`, but `DeliveryRepository` is not listed as a provider of `NotificationsModule`. This is another wiring defect!

Actually wait, let me re-read the task. The `DeliveryRepository` is in `src/notifications/delivery.repository.ts`. It needs to be a provider of `NotificationsModule` since `NotificationsService` depends on it.

So the defects are:

1. **Import cycle** (QUEUES in jobs.module.ts imported by notifications.service.ts): Fix by moving QUEUES/QueueName to own file.

2. **UsersModule doesn't export ExportService**: `ExportsController` needs `ExportService`, which is provided in `UsersModule` but not exported. Fix: add `ExportService` to `UsersModule`'s exports.

3. **NotificationsModule doesn't provide DeliveryRepository**: `NotificationsService` depends on `DeliveryRepository`, but `DeliveryRepository` isn't in `NotificationsModule`'s providers. Fix: add `DeliveryRepository` to `NotificationsModule`'s providers.

Now let me think about the check that fails when wiring is wrong. I need to write a test that builds the real application context. This would be a test that creates a NestJS application with AppModule and verifies it initializes.

Let me now plan all the files I need to change/create:

1. **Create** `src/jobs/queue.constant.ts` - Move QUEUES and QueueName here
2. **Modify** `src/jobs/jobs.module.ts` - Import QUEUES from new file, remove its definition
3. **Modify** `src/notifications/notifications.service.ts` - Import QUEUES from new file
4. **Modify** `src/notifications/notifications.module.ts` - Add DeliveryRepository to providers
5. **Modify** `src/users/users.module.ts` - Add ExportService to exports
6. **Create** `test/app.wiring.spec.ts` - A test that builds the real app context
7. **Create** `DIAGNOSIS.md`

Let me also check if there are any other issues. Let me trace through the complete dependency graph more carefully.

After fixing:
- `AppModule` imports: ConfigModule, PrismaModule, UsersModule, NotificationsModule, ExportsModule, JobsModule
- `ConfigModule`: global, provides ConfigService
- `PrismaModule`: global, provides PrismaService
- `UsersModule`: provides UsersService, ExportService; exports UsersService, ExportService
- `NotificationsModule`: provides NotificationsService, DeliveryRepository; exports NotificationsService
- `ExportsModule`: imports UsersModule; provides ExportsController
- `JobsModule`: imports NotificationsModule; provides RetryProcessor

`RetryProcessor` needs `NotificationsService` and `PrismaService` - both available (NotificationsService from NotificationsModule which JobsModule imports, PrismaService from global).
`NotificationsService` needs `DeliveryRepository` (now in NotificationsModule) and `ConfigService` (global). Good.
`ExportsController` needs `ExportService` (from UsersModule which ExportsModule imports). Good.
`ExportService` needs `PrismaService` (global). Good.
`UsersService` needs `PrismaService` (global). Good.

Now, the `ExportService` is exported from `UsersModule`. But the `ExportsController` references it via `import { ExportService, type ExportJob } from '../users/export.service.js'`. That's a direct import, which is fine for TypeScript. NestJS needs to be able to resolve the dependency at injection time. Since `ExportService` is now exported from `UsersModule` and `ExportsModule` imports `UsersModule`, Nest will find it.

Wait, but there's a subtlety. The ExportsController directly imports ExportService from the file path. In NestJS, when the controller is being constructed, Nest needs to find ExportService in the module's provider registry. Since UsersModule is imported by ExportsModule and ExportService is now exported from UsersModule, Nest will be able to inject it.

Now let me also think about the `type ExportJob` import. It's a TypeScript type, so it's erased at runtime. No issue there.

Let me write out all the files now.

Actually, let me reconsider the structure. The `QUEUE` constant and type need to be in a file that imports nothing, so there's no cycle. Let me call it `src/jobs/queue.constant.ts`.

Now, for the wiring check test. I'll write a Vitest test that creates a NestJS application using AppModule and verifies it starts up properly. This will fail when the wiring is broken and pass when it's fixed.

Let me draft the test:

```ts
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { ExportService } from '../src/users/export.service.js';
import { RetryProcessor } from '../src/jobs/retry.processor.js';

describe('Application wiring', () => {
  it('builds the real application context', async () => {
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(app.get(NotificationsService)).toBeDefined();
    expect(app.get(ExportService)).toBeDefined();
    expect(app.get(RetryProcessor)).toBeDefined();
    await app.close();
  });
});
```

Hmm, but `compile()` actually creates the app context. If there are unresolved dependencies, it will throw. But I should also test that it actually starts. Let me use `NestFactory` directly or use `Test.createTestingModule`.

Actually, the spec says "something that builds the real application context." Using `Test.createTestingModule` with `AppModule` should be sufficient since it resolves the DI graph. Let me make it robust.

Wait, actually there's a concern. The test might need a database or other infrastructure. But looking at the PrismaService, it's a stand-in that doesn't connect. And ConfigService just reads from env with defaults. So it should be fine.

Let me also check if we need `reflect-metadata` import. The main.ts does `import 'reflect-metadata'` before creating the app. In tests, we might need it too. Actually, `reflect-metadata` is typically imported by NestJS internally, but let me include it to be safe.

Now let me write DIAGNOSIS.md:

**Defect 1: QUEUES temporal dead zone (import cycle)**
- What: `NotificationsService` imports `QUEUES` from `JobsModule`, but `JobsModule` imports `NotificationsModule` which provides `NotificationsService`. This creates an import cycle.
- Why tsc missed it: TypeScript's compiler resolves type information, not runtime evaluation order. It sees no type errors.
- Why tests missed it: Unit tests instantiate services directly with fakes and don't evaluate the module graph.
- Fix: Move `QUEUES` and `QueueName` to `queue.constant.ts`, which imports nothing.

**Defect 2: UsersModule doesn't export ExportService**
- What: `ExportsController` injects `ExportService`, which is defined in `UsersModule` but not exported. Cross-module provider access fails.
- Why tsc missed it: TypeScript only checks types; it doesn't verify NestJS provider visibility across module boundaries.
- Why tests missed it: The unit test for `UsersService` doesn't involve `ExportsModule` or `ExportService` injection.
- Fix: Add `ExportService` to `UsersModule`'s exports.

**Defect 3: NotificationsModule doesn't provide DeliveryRepository**
- What: `NotificationsService` depends on `DeliveryRepository`, but `DeliveryRepository` isn't listed in `NotificationsModule`'s providers.
- Why tsc missed it: `DeliveryRepository` exists and is importable; TypeScript doesn't track which module owns a provider.
- Why tests missed it: Unit tests construct `NotificationsService` directly with a fake repository.
- Fix: Add `DeliveryRepository` to `NotificationsModule`'s providers.

Now let me finalize all files. Let me write them out:

### New file: src/jobs/queue.constant.ts
```ts
/** Queue names. Imported all over the application. */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
```

### Modified: src/jobs/jobs.module.ts
```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { QUEUES, QueueName } from './queue.constant.js';
import { RetryProcessor } from './retry.processor.js';

@Module({
  imports: [NotificationsModule],
  providers: [RetryProcessor],
})
export class JobsModule {}
```

Wait, `QueueName` is no longer used in the module file. Let me check... it was never used in jobs.module.ts. But it was defined there. Since it's a type, it needs to be exported somewhere for others to use. Let me keep it in queue.constant.ts since that's where QUEUES now lives.

### Modified: src/notifications/notifications.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { QUEUES } from '../jobs/queue.constant.js';
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

### Modified: src/notifications/notifications.module.ts
```ts
import { Module } from '@nestjs/common';
import { DeliveryRepository } from './delivery.repository.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  providers: [DeliveryRepository, NotificationsService],
  exports: [DeliveryRepository, NotificationsService],
})
export class NotificationsModule {}
```

Hmm, should I export `DeliveryRepository`? Let me check if any other module needs it. `RetryProcessor` doesn't use it directly (it uses `NotificationsService` which internally uses it). So exporting it might not be necessary, but it doesn't hurt. Actually, the convention says "every provider that a module owns is in that module's providers" and "every provider used across a module boundary is in the owner's exports." Since no other module directly uses `DeliveryRepository`, I'll keep it in providers but not necessarily export it. Actually, let me just include it in both for consistency, or just in providers. Let me keep it simple: add it to providers only.

Wait, but the spec says "every module that should own a provider owns it." Does NotificationsModule own DeliveryRepository? Yes, it uses it. Should it export it? Only if another module needs to inject it. No other module injects it directly, so I'll just add it to providers.

```ts
@Module({
  providers: [DeliveryRepository, NotificationsService],
  exports: [NotificationsService],
})
```

Actually, hmm. Let me reconsider. The original module only had NotificationsService. Now we need to add DeliveryRepository. But should we export it? The original didn't export it because there was nothing else. But now, is it used by other modules? No. I'll keep it non-exported.

Wait, actually - let me re-examine. The RetryProcessor in JobsModule needs NotificationsService (which it gets through importing NotificationsModule). And NotificationsService internally needs DeliveryRepository (which it gets because it's a provider in NotificationsModule). This is fine.

### Modified: src/users/users.module.ts
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

### New file: test/app.wiring.spec.ts
```ts
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ExportService } from '../src/users/export.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { RetryProcessor } from '../src/jobs/retry.processor.js';
import { DeliveryRepository } from '../src/notifications/delivery.repository.js';

describe('Application wiring', () => {
  it('builds the real application context', async () => {
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(app.get(NotificationsService)).toBeInstanceOf(NotificationsService);
    expect(app.get(ExportService)).toBeInstanceOf(ExportService);
    expect(app.get(RetryProcessor)).toBeInstanceOf(RetryProcessor);
    expect(app.get(DeliveryRepository)).toBeInstanceOf(DeliveryRepository);
    await app.close();
  });
});
```

### New file: DIAGNOSIS.md

Now let me also think about whether there are any more defects. The task says "more than one defect."

Let me re-trace very carefully:

After moving QUEUES to its own file (fix 1), the import cycle is broken. Now let me trace:

1. `AppModule` imports all modules.
2. ConfigModule - global, no issues.
3. PrismaModule - global, no issues.
4. UsersModule - provides UsersService, ExportService. Exports only UsersService. → DEFECT: ExportService not exported.
5. NotificationsModule - provides NotificationsService. → DEFECT: Missing DeliveryRepository.
6. ExportsModule - imports UsersModule. Provides ExportsController which needs ExportService. → Requires fix 2.
7. JobsModule - imports NotificationsModule. Provides RetryProcessor.

After fixing 2 and 3, everything should work.

But wait, are there any more subtle issues? Let me check the `ExportsController` more carefully:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ExportService, type ExportJob } from '../users/export.service.js';
```

This directly imports from the file. In NestJS, when Nest instantiates the controller, it needs to resolve `ExportService` as a provider. It looks in the module's providers and imported modules' exports. Since `ExportsModule` imports `UsersModule`, and after our fix `UsersModule` exports `ExportService`, Nest will find it. Good.

I think those are the three defects. Let me finalize.

Actually wait - let me also check if `ExportService` and `ExportJob` are properly accessible. The `ExportsController` imports `ExportJob` as a type. That's fine, it's just a type import.

One more thing: the `ExportService` file defines both `ExportService` class and `ExportJob` interface. When `UsersModule` exports `ExportService`, it's exporting the class. The `ExportsController` can then inject it. Good.

Let me also verify there aren't any other missing providers. Let me go through each provider and check all their constructor dependencies are met:

- `ConfigService`: no deps ✓ (global)
- `PrismaService`: no deps ✓ (global)
- `UsersService`: needs PrismaService ✓ (global)
- `ExportService`: needs PrismaService ✓ (global)
- `DeliveryRepository`: needs PrismaService ✓ (global)
- `NotificationsService`: needs DeliveryRepository (in NotificationsModule) and ConfigService (global) ✓
- `RetryProcessor`: needs PrismaService (global) and NotificationsService (from NotificationsModule, imported by JobsModule) ✓
- `ExportsController`: needs ExportService (from UsersModule, exported, imported by ExportsModule) ✓

All good!

Now let me also think about the `ExportJob` type. It's defined in `src/users/export.service.ts`. Is it exported properly? Yes, `export interface ExportJob`. And the controller imports it with `type ExportJob`. Good.

One thing I want to double-check: in the `ExportsModule`, it imports `UsersModule`. When NestJS processes this, it sees that `ExportsModule` has a controller that needs `ExportService`. It looks at `UsersModule`'s exports and finds `ExportService`. Good.

Let me also verify that the `ExportService` needs to be in `exports` of `UsersModule`, not just `providers`. The spec says "every provider used across a module boundary is in the owner's exports and the consumer's imports." Since `ExportsModule` uses `ExportService` (across the boundary from `UsersModule`), it must be exported. ✓

Now, let me also consider: should I export `UsersService` from `UsersModule`? It already does, and nothing else needs it across a boundary. That's fine.

Let me finalize everything now. Let me think about whether the test needs `reflect-metadata`. Looking at the main.ts, it imports it. In NestJS testing, `Test.createTestingModule` should handle this internally. But to be safe, I'll include it.

Actually, I realize I should check if `test` directory is included in tsconfig.json - yes it is: `"include": ["src/**/*.ts", "test/**/*.ts"]`. And tsconfig.build.json only includes `src/**/*.ts`. The test file won't be compiled to dist, which is correct - it runs via vitest.

Let me also check: will the vitest test be able to resolve `../src/app.module.js` from `test/app.wiring.spec.ts`? The path from test/ to src/ is `../src/`. And since `"type": "module"` is set, we need `.js` extensions, which I've included. Good.

Now, there might be an issue with `Test.createTestingModule` trying to actually import the module using Node's ESM resolution. The `AppModule` imports all the other modules, which in turn import their providers. If any of those providers try to do something at module evaluation time (like accessing a variable before initialization), the test would fail. But after our fix, the QUEUES cycle is broken, so this should be fine.

Let me write the final output now.

Actually, one more thought: should the `ExportJob` type be in its own file? The task says "If a fix requires moving a symbol to its own file, move it." But `ExportJob` doesn't cause any cycle issues - it's just a type. Let me leave it where it is.

Let me also reconsider the `QueueName` export. It was in `jobs.module.ts` originally. Now it's in `queue.constant.ts`. Is anything in the codebase using `QueueName`? Let me check... Looking at all the files, I don't see any explicit use of `QueueName` type. But it's good to keep it in the same file as `QUEUES` for coherence.

Now let me write the complete solution.

Hmm, wait. Let me re-examine the `DeliveryRepository` issue more carefully. Looking at the original `NotificationsModule`:

```ts
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
```

`NotificationsService` needs `DeliveryRepository`. When NestJS tries to instantiate `NotificationsService`, it can't find `DeliveryRepository` because it's not a provider of `NotificationsModule` and it's not available from any imported module (NotificationsModule doesn't import anything). This would cause a runtime error when Nest tries to create the provider.

But wait - would this error be the same as the QUEUES error? No. The QUEUES error happens at module evaluation time (when the JS files are being loaded/evaluated), before Nest even starts. The DeliveryRepository missing error would happen at Nest's provider instantiation phase, after modules are loaded. The task says "fixing each one reveals the next" - so after fixing the QUEUES cycle, the next error would be about missing DeliveryRepository.

Good, that confirms it's a separate defect.

Let me also make sure I understand the order of errors. When `pnpm start` runs:
1. Build runs (tsc), succeeds.
2. Node loads dist/main.js → loads AppModule → loads all imported modules.
3. During module loading, Node evaluates `notifications.service.js`, which tries to access `QUEUES` from `jobs.module.js`. But `jobs.module.js` is in the middle of being evaluated (it was triggered by being imported by AppModule via JobsModule → imports NotificationsModule → needs NotificationsService → needs QUEUES from jobs.module). This is the temporal dead zone issue.

After fixing the cycle:
4. All modules load successfully.
5. Nest starts wiring, creates providers.
6. Tries to create NotificationsService, needs DeliveryRepository → not in NotificationsModule's providers. Error!

After fixing that:
7. Nest continues, creates all providers.
8. Tries to create ExportsController, needs ExportService → not exported from UsersModule. Error!

After fixing that:
9. Everything starts. Nest logs "listening on...".

This matches the "stacked defects" description in the task.

OK, I'm confident in my analysis. Let me write the final answer.

Let me also double-check the DIAGNOSIS.md format and content. The task says: "for each defect, what was unresolvable, why neither tsc nor the unit suite could see it, and the minimal fix."

Let me finalize all files now.

One more consideration: The `test/app.wiring.spec.ts` should be a test that "fails when the wiring is wrong." So I should verify that it would fail on the original code and pass on the fixed code. 

On original code:
- Import cycle would cause `QUEUES` ReferenceError when Test.createTestingModule tries to import AppModule → test fails ✓
- Even if that worked, NotificationsModule is missing DeliveryRepository → test fails ✓
- Even if that worked, UsersModule doesn't export ExportService → test fails ✓

On fixed code:
- All wiring is correct → test passes ✓

Perfect. The test serves as the check.

Let me also make sure I'm not missing anything about the `forwardRef` requirement. The task says "Do not reach for forwardRef unless the cycle is genuine." The cycle I identified is genuine (JobsModule imports NotificationsModule, and NotificationsService imports from JobsModule), but it's resolved structurally by moving QUEUES to its own file. So no forwardRef needed. ✓

Let me finalize.
```

## reply

### src/jobs/queue.constant.ts
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
import { QUEUES, QueueName } from './queue.constant.js';
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
import { QUEUES } from '../jobs/queue.constant.js';
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

### test/app.wiring.spec.ts
```ts
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { DeliveryRepository } from '../src/notifications/delivery.repository.js';
import { ExportsController } from '../src/exports/exports.controller.js';
import { ExportService } from '../src/users/export.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { RetryProcessor } from '../src/jobs/retry.processor.js';
import { UsersService } from '../src/users/users.service.js';

describe('Application wiring', () => {
  it('builds the real application context with all providers resolved', async () => {
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(app.get(NotificationsService)).toBeInstanceOf(NotificationsService);
    expect(app.get(DeliveryRepository)).toBeInstanceOf(DeliveryRepository);
    expect(app.get(ExportService)).toBeInstanceOf(ExportService);
    expect(app.get(UsersService)).toBeInstanceOf(UsersService);
    expect(app.get(RetryProcessor)).toBeInstanceOf(RetryProcessor);
    expect(app.get(ExportsController)).toBeInstanceOf(ExportsController);

    await app.close();
  });

  it('resolves all cross-module provider dependencies', async () => {
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // ExportsController depends on ExportService, which lives in UsersModule.
    const controller = app.get(ExportsController);
    expect(controller).toBeInstanceOf(ExportsController);
    // The injection token is the ExportService instance, not a stub.
    expect(app.get(ExportService)).toBe(app.get(ExportsController).exports);

    // RetryProcessor depends on NotificationsService, which depends on DeliveryRepository.
    const processor = app.get(RetryProcessor);
    expect(processor).toBeInstanceOf(RetryProcessor);
    expect(processor.notifications).toBe(app.get(NotificationsService));

    await app.close();
  });
});
```

### DIAGNOSIS.md
```md
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
```
