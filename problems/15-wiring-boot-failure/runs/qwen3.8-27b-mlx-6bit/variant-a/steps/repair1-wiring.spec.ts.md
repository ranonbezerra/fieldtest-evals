# repair1-wiring.spec.ts

## reasoning

```
Let me analyze the compiler errors that relate to `test/wiring.spec.ts`:

1. `test/wiring.spec.ts(1,42): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.`
   - Need to use `@nestjs/testing` but it's not found. This is a module resolution issue - likely the package isn't installed or the import path is wrong. But I can't change package.json. Let me think... Actually, looking at the workspace, `@nestjs/testing` should be available as a dev dependency in a NestJS project. The error says "Cannot find module" which means it's either not installed or the types aren't available. Since I can only modify `test/wiring.spec.ts`, I need to work with what's available.

   Wait - let me re-read the constraint: "Change nothing the messages do not name." So I should only fix things in `test/wiring.spec.ts`. The `@nestjs/testing` error is in this file. Let me think about how to handle this.

   Actually, looking more carefully at the errors - many of them are about other files not being found (like `./notifications.module`, `./export.service`, etc.). These are errors in OTHER files, not in `test/wiring.spec.ts`. The instruction says "Rewrite `test/wiring.spec.ts` complete, fixing what these messages require of this file."

   So I only need to fix the errors that are IN `test/wiring.spec.ts`:
   - Line 1: `Cannot find module '@nestjs/testing'`
   - Line 8: `Cannot find module '../src/export/export.service.js'`
   - Line 100: `Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'typeof import(...src/common/queues...)'`

   For the `@nestjs/testing` issue - this is a dependency that should be in the project. Since I can't install packages, and the error says it can't be found... Hmm, but the plan says to use `Test.createTestingModule`. Let me think about this differently.

   Actually, wait. The task says "Change nothing the messages do not name." The messages DO name `test/wiring.spec.ts(1,42)` - that's in this file. So I need to address it. But the root cause is likely a missing package. Since I can only modify this file, maybe I should add an ASSUMPTION line noting that `@nestjs/testing` should be a dev dependency.

   Actually, re-reading more carefully: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

   The `@nestjs/testing` module not being found is a dependency issue, not something I can fix by changing the import syntax. The correct import IS `@nestjs/testing`. So I'll keep it and add an ASSUMPTION note.

   Wait, but actually - maybe the issue is that `@nestjs/testing` needs to be imported differently in ESM? No, in NestJS the standard import is `import { Test } from '@nestjs/testing'`. That should work.

   Let me reconsider. The error is `TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.` This means TypeScript can't resolve the types. In a proper NestJS project with `@nestjs/testing` as a devDependency, this would work. Since I'm told to only modify this file, and the correct import IS from `@nestjs/testing`, I'll keep it and note the assumption.

   For line 8: `Cannot find module '../src/export/export.service.js'` - The import path uses `.js` extension (ESM convention). But the actual file might not exist yet or might be at a different path. Looking at the other errors, `src/export/export.module.ts(2,31): error TS2307: Cannot find module './export.service'` - this suggests `src/export/export.service.ts` doesn't exist. But wait, the plan says ExportService should be there. 

   Actually, looking at the errors more carefully - there are MANY "Cannot find module" errors for files that SHOULD exist. This suggests the workspace is in a broken state where files haven't been created yet, or they're at wrong paths. But my task is only to fix `test/wiring.spec.ts`.

   The import `'../src/export/export.service.js'` - if the file doesn't exist, I can't fix that by changing the import. But maybe I should import it without the `.js` extension? In ESM with TypeScript, you use `.js` extensions in imports that resolve to `.ts` files. But if the file doesn't exist at all, no import will work.

   Hmm, but wait - the task says "Change nothing the messages do not name." The message names line 8 of `test/wiring.spec.ts`. So I need to address it. The import is for `ExportService` which the test needs to verify is resolvable. If the file doesn't exist, I have a problem.

   Let me re-read the constraint: "If satisfying the compiler seems to require abandoning something the plan specified, keep the plan and add one `// ASSUMPTION:` line saying what you could not reconcile."

   So for the missing modules, I should add ASSUMPTION lines noting that these files are expected to exist as part of the other fixes.

   For line 100: The error is about using a string to index the `QUEUES` object. The `QUEUES` const has type `{ notifications: 'notifications'; retries: 'retries' }` (due to `as const`). You can't index it with an arbitrary string. The fix is to use a specific key or cast appropriately.

   Let me now think about what the test file should look like based on the plan:

   The plan specifies these tests:
   1. `compiles the full DI graph` - compile the testing module
   2. `resolves NotificationsService` - get NotificationsService from the module
   3. `resolves ExportService in UsersModule context` - verify cross-module wiring
   4. `resolves RetryProcessor in NotificationsModule context` - verify retry processor wiring
   5. `QUEUES is a frozen, importable const` - verify QUEUES is from leaf file

   Now let me think about the structure:

   ```typescript
   import { Test } from '@nestjs/testing'; // ASSUMPTION: @nestjs/testing must be a devDependency
   import { AppModule } from '../src/app.module.js';
   import { NotificationsService } from '../src/notifications/notifications.service.js';
   import { ExportService } from '../src/export/export.service.js'; // ASSUMPTION: this file is expected to exist
   import { RetryProcessor } from '../src/retry/retry.processor.js'; // ASSUMPTION: this file is expected to exist
   import { QUEUES, QueueName } from '../src/common/queues.js';
   import { describe, it, expect } from 'vitest';
   ```

   Wait, but looking at the reference file for `notifications.service.ts`, it imports from `'../common/queues.js'` and `'../retry/retry.processor.js'`. So the ESM `.js` extension convention is used.

   Now for the `QUEUES` indexing issue on line 100. The original test probably had something like:
   ```typescript
   const queueName: string = 'notifications';
   expect(QUEUES[queueName]).toBe('notifications');
   ```
   
   This would fail because `QUEUES` is typed as `{ readonly notifications: "notifications"; readonly retries: "retries" }` and you can't index it with a `string`.

   The fix: use a literal key or use the `QueueName` type:
   ```typescript
   const queueName: QueueName = 'notifications';
   expect(QUEUES[queueName]).toBe('notifications');
   ```

   Or just use literal keys:
   ```typescript
   expect(QUEUES.notifications).toBe('notifications');
   expect(QUEUES.retries).toBe('retries');
   ```

   Now, about the `@nestjs/testing` issue. In a standard NestJS project with pnpm, `@nestjs/testing` is typically a devDependency. The fact that TypeScript can't find it suggests it's not installed. But I can't install it from within a test file. I'll keep the import and add an ASSUMPTION.

   Actually wait - let me reconsider. The task says "Rewrite `test/wiring.spec.ts` complete, fixing what these messages require of this file." The messages that name this file are:
   1. Line 1: `@nestjs/testing` not found
   2. Line 8: `../src/export/export.service.js` not found  
   3. Line 100: string indexing on QUEUES

   For #1 and #2, these are "Cannot find module" errors. The modules either don't exist or aren't installed. I can't fix this by changing the import path (since the correct path IS what's used). So I'll add ASSUMPTION lines.

   For #3, I can fix this by using the `QueueName` type or literal property access.

   Let me also consider: do I need to mock PrismaService? The plan says yes: "Test overrides the `PrismaService` provider with a dummy object." But where is PrismaService? It's probably in `src/prisma/prisma.service.ts` or similar. Since I don't see it in the errors, it probably exists. But to be safe, I'll reference it by its expected location.

   Actually, looking at the layout convention: `src/<feature>/<feature>.module.ts`, etc. PrismaService would likely be in a common or prisma module. Let me think about what makes sense.

   The plan says: "Mock `PrismaService` at the provider level via a test-only module override" and "Test overrides the `PrismaService` provider with a dummy object (`{ $connect: vi.fn(), $disconnect: vi.fn() }`) so no DB connection is attempted."

   I'll need to import PrismaService from wherever it lives. Since I don't have the exact path, I'll make an assumption. Given the conventions, it's likely `src/prisma/prisma.service.js` or `src/common/prisma.service.js`.

   Actually, let me look at what's available. The errors don't mention any PrismaService import failing, so maybe it's not imported in the test file currently. Let me think about whether I need it...

   The plan says to override PrismaService so no DB connection is attempted. If the services depend on PrismaService (via repositories), then without mocking it, the `compile()` call would fail because PrismaService's `onModuleInit` or constructor might try to connect.

   But actually, `Test.createTestingModule().compile()` only instantiates providers - it doesn't call lifecycle hooks like `onModuleInit` by default. Wait, actually in NestJS testing module, `compile()` does instantiate providers but I believe lifecycle hooks are NOT called during `compile()`. They're called during `app.init()` or when you use `moduleRef` from `createNestApplication`.

   Hmm, but if a repository's constructor calls `prismaService.$connect()`, that would be a problem. But typically PrismaService extends PrismaClient and the connection happens in `onModuleInit`.

   Let me just follow the plan and add the PrismaService override to be safe. I'll need to know where it is. Given the project structure, I'll assume `src/prisma/prisma.service.js`.

   Wait, actually - let me reconsider. The plan's manifest doesn't list a PrismaService file. Let me look at what the manifest says:
   - `src/common/queues.ts`
   - `src/retry/retry.module.ts`
   - `src/retry/retry.processor.ts`
   - `src/notifications/notifications.module.ts`
   - `src/notifications/notifications.service.ts`
   - `src/users/users.module.ts`
   - `src/export/export.module.ts`
   - `src/app.module.ts`
   - `test/wiring.spec.ts`
   - `DIAGNOSIS.md`

   No PrismaService in the manifest. But the services likely use repositories that use Prisma. Let me look at the users module error: `src/users/users.module.ts(3,33): error TS2307: Cannot find module './users.repository'` - so there IS a users repository.

   I think the safest approach is to follow the plan's guidance and mock PrismaService. But since I don't know its exact import path, I'll add an ASSUMPTION.

   Actually, you know what - let me reconsider the whole approach. The plan says:
   > "Test overrides the `PrismaService` provider with a dummy object (`{ $connect: vi.fn(), $disconnect: vi.fn() }`) so no DB connection is attempted."

   In NestJS testing, you override a provider like:
   ```typescript
   .overrideProvider(PrismaService)
   .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
   ```

   I need to import PrismaService for this. Let me assume it's at `src/prisma/prisma.service.js` based on common NestJS patterns with the project's conventions.

   Hmm, but actually - if I'm not sure about the path, and the compiler errors don't mention a failed PrismaService import (meaning the current file doesn't import it), maybe I should just note it as an assumption and use a reasonable path.

   Let me write the test file now:

```typescript
import { Test } from '@nestjs/testing'; // ASSUMPTION: @nestjs/testing must be installed as a devDependency; not currently resolvable by the compiler
import { describe, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
// ASSUMPTION: src/export/export.service.ts is expected to exist as part of the export feature fix
import { ExportService } from '../src/export/export.service.js';
// ASSUMPTION: src/retry/retry.processor.ts is expected to exist as part of the retry feature fix
import { RetryProcessor } from '../src/retry/retry.processor.js';
import { QUEUES, QueueName } from '../src/common/queues.js';
// ASSUMPTION: PrismaService is expected at this path; used to override the provider so no DB connection is attempted
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('DI wiring', () => {
  it('compiles the full DI graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();

    expect(moduleRef).toBeDefined();
  });

  it('resolves NotificationsService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();

    const service = moduleRef.get(NotificationsService);
    expect(service).toBeInstanceOf(NotificationsService);
  });

  it('resolves ExportService in UsersModule context', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();

    const service = moduleRef.get(ExportService);
    expect(service).toBeInstanceOf(ExportService);
  });

  it('resolves RetryProcessor in NotificationsModule context', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();

    const processor = moduleRef.get(RetryProcessor);
    expect(processor).toBeInstanceOf(RetryProcessor);
  });

  it('QUEUES is a frozen, importable const', () => {
    expect(Object.isFrozen(QUEUES)).toBe(true);
    const name: QueueName = 'notifications';
    expect(QUEUES[name]).toBe('notifications');
    expect(QUEUES.retries).toBe('retries');
  });
});
```

Wait, I need `vi` from vitest. Let me add that import.

Actually, looking at the vitest imports: `import { describe, it, expect } from 'vitest'` - I also need `vi`. So: `import { describe, it, expect, vi } from 'vitest'`.

Now let me reconsider the structure. The plan says:
> "If `compile()` returns without throwing, the wiring is valid. The test asserts that a specific provider (e.g., `NotificationsService`) is retrievable from the compiled module as a final positive check."

So the first test just needs to assert that compile succeeds (doesn't throw). The subsequent tests verify specific providers.

Let me also think about whether I should use `beforeEach` or create the module in each test. Creating it fresh in each test is cleaner and avoids state leakage.

Actually, I realize I should double-check: does `QUEUES` need to be frozen? The plan says "QUEUES is a frozen, importable const". Looking at the queues.ts definition:
```ts
export const QUEUES = {
  notifications: 'notifications',
  retries: 'retries',
} as const;
```

`as const` makes it deeply readonly but does NOT freeze it at runtime. So `Object.isFrozen(QUEUES)` would be `false` unless the implementation explicitly freezes it. 

Hmm, but the plan says to test that it's frozen. If the actual implementation doesn't freeze it, this test would fail. But the plan is what I should follow. Let me keep the assertion. If the implementation needs to add `Object.freeze()`, that's a separate concern (and the task says "Change wiring, not behaviour" - freezing a const object is arguably part of ensuring it's a true constant).

Actually wait - the task says I should only fix `test/wiring.spec.ts`. I shouldn't be changing `src/common/queues.ts`. So if `QUEUES` isn't frozen, my test would fail. But the plan says to write this test...

I think the right approach is: the plan specifies this test, so I write it. If it fails because `QUEUES` isn't frozen, that's a problem with the queues.ts file, not with my test. My job is to write the test as the plan specifies.

Let me finalize the file. One more consideration: the `vi.fn()` usage. In vitest, `vi` is imported from 'vitest'. That's correct.

Let me also reconsider whether I really need to import PrismaService. If the repositories use it and the testing module tries to instantiate them, then yes I need the override. Without it, the PrismaClient constructor might fail or try to connect.

Actually, PrismaClient doesn't connect in its constructor - it connects lazily or on `$connect()`. So `compile()` might actually work without the override. But the plan explicitly says to add it, so I will.

Let me write the final version:
```

## reply

```typescript
import { Test } from '@nestjs/testing'; // ASSUMPTION: @nestjs/testing must be installed as a devDependency; the compiler cannot currently resolve it
import { describe, it, expect, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
// ASSUMPTION: src/export/export.service.ts is expected to exist as part of the export feature fix
import { ExportService } from '../src/export/export.service.js';
// ASSUMPTION: src/retry/retry.processor.ts is expected to exist at this path as part of the retry feature fix
import { RetryProcessor } from '../src/retry/retry.processor.js';
import { QUEUES, QueueName } from '../src/common/queues.js';
// ASSUMPTION: PrismaService is expected at this path; overriding it prevents a live DB connection during compile()
import { PrismaService } from '../src/prisma/prisma.service.js';

const prismaMock = { $connect: vi.fn(), $disconnect: vi.fn() };

describe('DI wiring', () => {
  it('compiles the full DI graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    expect(moduleRef).toBeDefined();
  });

  it('resolves NotificationsService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    const service = moduleRef.get(NotificationsService);
    expect(service).toBeInstanceOf(NotificationsService);
  });

  it('resolves ExportService in UsersModule context', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    const service = moduleRef.get(ExportService);
    expect(service).toBeInstanceOf(ExportService);
  });

  it('resolves RetryProcessor in NotificationsModule context', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    const processor = moduleRef.get(RetryProcessor);
    expect(processor).toBeInstanceOf(RetryProcessor);
  });

  it('QUEUES is a frozen, importable const', () => {
    expect(Object.isFrozen(QUEUES)).toBe(true);
    const name: QueueName = 'notifications';
    expect(QUEUES[name]).toBe('notifications');
    expect(QUEUES.retries).toBe('retries');
  });
});
```
