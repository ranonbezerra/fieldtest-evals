# repair2-wiring.spec.ts

## reasoning

```
Let me analyze the compiler errors:

1. `src/export/export.module.ts(2,31): error TS2307: Cannot find module './export.service.js'` — This means `src/export/export.service.ts` doesn't exist.
2. `src/users/users.module.ts(3,33): error TS2307: Cannot find module './users.repository.js'` — This means `src/users/users.repository.ts` doesn't exist.
3. `test/wiring.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing'` — The package isn't installed.
4. `test/wiring.spec.ts(6,31): error TS2307: Cannot find module '../src/export/export.service.js'` — Same as #1, the file doesn't exist.

My task is to rewrite `test/wiring.spec.ts` only, fixing what these messages require of *this file*. The errors that affect `test/wiring.spec.ts` are:
- Line 1, col 22: `@nestjs/testing` not found
- Line 6, col 31: `../src/export/export.service.js` not found

For `@nestjs/testing` — this is a dependency that needs to be installed. But I can only change `test/wiring.spec.ts`. I can't install packages. So I need an ASSUMPTION line about this. Wait, actually the task says "Rewrite `test/wiring.spec.ts` complete, fixing what these messages require of this file." So I need to fix the file. If `@nestjs/testing` isn't available, I might need to add an ASSUMPTION line. But wait — the plan says to use `Test.createTestingModule`. If `@nestjs/testing` isn't installed, that's a problem. Let me add an ASSUMPTION line.

Actually, let me reconsider. The task says "Change nothing the messages do not name." The messages name:
- `test/wiring.spec.ts` line 1 importing `@nestjs/testing`
- `test/wiring.spec.ts` line 6 importing `../src/export/export.service.js`

For the `@nestjs/testing` issue: This is a missing dependency. I should add an ASSUMPTION line noting that `@nestjs/testing` needs to be installed as a devDependency. But I can't fix it from within the file itself unless I use a different approach. The plan explicitly says to use `Test.createTestingModule({ imports: [AppModule] }).compile()`. So I should keep that and add an ASSUMPTION.

For `../src/export/export.service.js`: The file doesn't exist. Looking at the plan, it says `src/export/export.module.ts` has `providers: [ExportService]`. The plan's manifest lists `src/export/export.module.ts` as reading `src/export/export.service.ts`. But the compiler says `export.service.ts` doesn't exist. 

Wait, let me re-read. The error in `src/export/export.module.ts(2,31)` says it can't find `./export.service.js`. This means the file was never created. But my task is only to fix `test/wiring.spec.ts`. The plan says `ExportService` exists — it's just that the file wasn't created yet (or was named differently).

Since I can only change `test/wiring.spec.ts`, and the plan requires importing `ExportService` from `../src/export/export.service.js`, but that file doesn't exist, I need to add an ASSUMPTION line.

Actually wait — let me re-read the constraints more carefully: "Change nothing the messages do not name." The messages name specific files and lines. For `test/wiring.spec.ts`, the messages are on line 1 (import of `@nestjs/testing`) and line 6 (import of `../src/export/export.service.js`).

So my rewrite needs to:
1. Address the `@nestjs/testing` import — add ASSUMPTION that it needs to be installed
2. Address the `../src/export/export.service.js` import — add ASSUMPTION that this file needs to be created

But I still need to write the complete file that satisfies the plan. Let me think about what the file should contain based on the plan:

From PLAN.md section 5 (Tests):
- `compiles the full DI graph` — Every provider resolvable
- `resolves NotificationsService` — specific provider from original stack trace
- `resolves ExportService in UsersModule context` — cross-module export/import
- `resolves RetryProcessor in NotificationsModule context` — retry processor exported and imported
- `QUEUES is a frozen, importable const` — structural guarantee

From section 4 (Control flow - Wiring-check boot):
1. Import `AppModule`
2. `Test.createTestingModule({ imports: [AppModule] })`
3. Override `PrismaService` with dummy
4. `.compile()`
5. Assert providers are retrievable

Now, for the PrismaService override — I need to know what token to use. Typically it's the class itself as the injection token. The plan says "Mock `PrismaService` at the provider level via a test-only module override." I'll use `.overrideProvider(PrismaService).useValue({...})`.

But wait — do I need to import `PrismaService`? If it's in a common module or somewhere... Let me think. The plan doesn't explicitly say where `PrismaService` lives, but in a typical NestJS+Prisma setup, it's in `src/prisma/prisma.service.ts` or `src/common/prisma.service.ts`. Since I can't see the actual file structure beyond what's given, I'll import it from a reasonable location. Actually, looking at the layout convention: `src/<feature>/<feature>.service.ts`. Prisma might be its own feature or in common. Let me use `../src/prisma/prisma.service.js` as a reasonable assumption, or maybe it's already re-exported from somewhere.

Hmm, but the task says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly." I don't have a compiler error about `PrismaService`, so maybe it's already importable. Let me just use a reasonable path.

Actually, let me reconsider. The task is specifically about fixing `test/wiring.spec.ts` for the errors listed. The errors are:
1. `@nestjs/testing` not found (line 1)
2. `../src/export/export.service.js` not found (line 6)

The other errors (export.module.ts, users.module.ts) are in other files — I shouldn't change those.

So my file needs to:
- Still import from `@nestjs/testing` (plan requires it) → ASSUMPTION about installing the package
- Still import `ExportService` from `../src/export/export.service.js` (plan requires it) → ASSUMPTION about the file needing to be created

Let me write the complete file now. I'll follow the plan's test cases and structure.

For the `QUEUES` import, the plan says it should be from `../src/common/queues.js`.

Let me draft:

```ts
// ASSUMPTION: `@nestjs/testing` must be installed as a devDependency (pnpm add -D @nestjs/testing).
// ASSUMPTION: `src/export/export.service.ts` must exist for this import to resolve; it is named by the plan but was not yet created.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { ExportService } from '../src/export/export.service.js';
import { RetryProcessor } from '../src/retry/retry.processor.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { QUEUES } from '../src/common/queues.js';

describe('wiring', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('compiles the full DI graph', () => {
    expect(app).toBeDefined();
  });

  it('resolves NotificationsService', () => {
    const service = app.get(NotificationsService);
    expect(service).toBeInstanceOf(NotificationsService);
  });

  it('resolves ExportService in UsersModule context', () => {
    const service = app.get(ExportService);
    expect(service).toBeInstanceOf(ExportService);
  });

  it('resolves RetryProcessor in NotificationsModule context', () => {
    const processor = app.get(RetryProcessor);
    expect(processor).toBeInstanceOf(RetryProcessor);
  });

  it('QUEUES is a frozen, importable const', () => {
    expect(QUEUES).toBeFrozen();
    expect(QUEUES.notifications).toBe('notifications');
    expect(QUEUES.retries).toBe('retries');
  });
});
```

Wait, I need `vi` for the mock. Let me import it from vitest.

Also, the plan says the QUEUES const has `notifications` and `retries` keys. Let me keep that assertion.

Let me also think about whether I need `vi.fn()` — I should import `vi` from vitest.

Let me also reconsider: the plan says "No Prisma `$connect` call" in the wiring test. Using `useValue` with a dummy object satisfies this — we never call `$connect`, we just provide a dummy.

One more thought: the plan says `.compile()` is the key step. But to actually test that providers are resolvable via `app.get()`, we need to call `init()` or at least have the module instantiated. Actually, `.compile()` alone should resolve the DI graph and throw if anything is missing. But `app.get()` requires the module to be instantiated. Let me use `moduleRef` directly after compile, or use `app.init()`.

Actually, looking at NestJS testing docs, `Test.createTestingModule().compile()` returns a `TestingModule` which extends `ModuleRef`. You can call `.get()` on it directly after compile. But the typical pattern is to create a NestApplication from it. Let me use the simpler pattern:

```ts
const moduleRef = await Test.createTestingModule({...}).compile();
// then use moduleRef.get(Provider)
```

This avoids needing to call `init()` which might trigger lifecycle hooks. The plan says "compile() walks the full DI graph exactly as production would" — so compile alone should be sufficient for wiring validation.

But wait, does `.get()` work on a compiled but not initialized module? Yes, in NestJS testing modules, `.get()` works after `.compile()`. The providers are instantiated lazily on first access.

Let me refine:

```ts
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { ExportService } from '../src/export/export.service.js';
import { RetryProcessor } from '../src/retry/retry.processor.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { QUEUES } from '../src/common/queues.js';

describe('wiring', () => {
  let moduleRef: TestModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();
  });

  it('compiles the full DI graph', () => {
    expect(moduleRef).toBeDefined();
  });

  it('resolves NotificationsService', () => {
    const service = moduleRef.get(NotificationsService);
    expect(service).toBeInstanceOf(NotificationsService);
  });

  it('resolves ExportService in UsersModule context', () => {
    const service = moduleRef.get(ExportService);
    expect(service).toBeInstanceOf(ExportService);
  });

  it('resolves RetryProcessor in NotificationsModule context', () => {
    const processor = moduleRef.get(RetryProcessor);
    expect(processor).toBeInstanceOf(RetryProcessor);
  });

  it('QUEUES is a frozen, importable const', () => {
    expect(QUEUES).toBeFrozen();
    expect(QUEUES.notifications).toBe('notifications');
    expect(QUEUES.retries).toBe('retries');
  });
});
```

I need to import `TestModule` type from `@nestjs/testing`. Let me check — yes, `TestModule` is exported from `@nestjs/testing`.

Now, about the `PrismaService` import path — I'm guessing `../src/prisma/prisma.service.js`. The layout convention says `src/<feature>/<feature>.service.ts`. If Prisma is a feature, it would be at that path. But I'm not 100% sure. However, the task says "If a message refers to a shape you cannot see, say so in an ASSUMPTION line." The compiler errors don't mention `PrismaService`, so maybe it's fine. But I should still be careful. Let me add an ASSUMPTION about the PrismaService path since I can't see it in the errors.

Actually, re-reading the task: "If a message refers to a shape you cannot see" — this means if a compiler error mentions something I can't determine. The errors don't mention PrismaService at all, so I don't need an ASSUMPTION for it. But if I'm guessing the path wrong, that would create a new error. Let me think...

The safest approach: since the errors only name `@nestjs/testing` and `export.service.js` for this file, I should focus on those. For `PrismaService`, I'll use a reasonable path and if it's wrong, that's outside the scope of what these specific errors require me to fix. But I should still be reasonable.

Given the layout `src/<feature>/<feature>.service.ts`, and Prisma being a common infrastructure concern, it could be:
- `src/prisma/prisma.service.ts`
- `src/common/prisma.service.ts`

I'll go with `src/prisma/prisma.service.js` as it follows the `<feature>` pattern and Prisma is commonly its own module in NestJS apps.

Let me finalize the file.
```

## reply

```ts
// ASSUMPTION: `@nestjs/testing` must be installed as a devDependency (pnpm add -D @nestjs/testing).
// ASSUMPTION: `src/export/export.service.ts` must exist for this import to resolve; the plan names it but the file has not yet been created.
// ASSUMPTION: `PrismaService` lives at `src/prisma/prisma.service.ts` per the <feature>/<feature>.service.ts layout convention.

import { Test, type TestModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { ExportService } from '../src/export/export.service.js';
import { RetryProcessor } from '../src/retry/retry.processor.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { QUEUES } from '../src/common/queues.js';

describe('wiring', () => {
  let moduleRef: TestModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();
  });

  it('compiles the full DI graph', () => {
    expect(moduleRef).toBeDefined();
  });

  it('resolves NotificationsService', () => {
    const service = moduleRef.get(NotificationsService);
    expect(service).toBeInstanceOf(NotificationsService);
  });

  it('resolves ExportService in UsersModule context', () => {
    const service = moduleRef.get(ExportService);
    expect(service).toBeInstanceOf(ExportService);
  });

  it('resolves RetryProcessor in NotificationsModule context', () => {
    const processor = moduleRef.get(RetryProcessor);
    expect(processor).toBeInstanceOf(RetryProcessor);
  });

  it('QUEUES is a frozen, importable const', () => {
    expect(QUEUES).toBeFrozen();
    expect(QUEUES.notifications).toBe('notifications');
    expect(QUEUES.retries).toBe('retries');
  });
});
```
