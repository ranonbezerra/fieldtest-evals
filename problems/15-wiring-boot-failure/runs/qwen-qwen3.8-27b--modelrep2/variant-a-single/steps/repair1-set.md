# repair1-set

## reasoning

```
Let me analyze the errors as a whole:

1. `NestDependencyError` is not exported from `@nestjs/core`. In NestJS, there's no `NestDependencyError` exported. The error thrown when a provider can't be resolved is typically a `NestDependencyError` but it's not a public export. The actual error class that Nest throws when it can't resolve a dependency is from `@nestjs/core` but it's not a stable public API. Let me think about what to use instead.

Actually, looking at NestJS source, `NestDependencyError` does exist internally but may not be exported in the version being used. The standard way to test for dependency errors is to just check that `init()` rejects, or to catch the error and check its message/type.

Wait, let me reconsider. In newer versions of NestJS, `NestDependencyError` might not be exported. The error that gets thrown is typically an instance of `NestDependencyError` which extends `Error`. Since it's not exported, I should just check that `init()` rejects (with any error) or check the error message.

2. `NestApplication` is not a type export from `@nestjs/common`. The correct type is `INestApplication` which IS exported. So I should use `INestApplication` instead.

3. `NestFactory.create` doesn't accept `port` in options. The `NestApplicationOptions` type doesn't have a `port` property. The `port` is set via `app.listen(port)` or `app.setPort(port)` after creation. But since we're just calling `init()` and not `listen()`, we don't need port at all.

4. Same issue with the second call to `NestFactory.create`.

So the distinct mistakes are:
1. `NestDependencyError` is not exported — need to remove that import and adjust the assertion to just check that `init()` rejects (or check the error differently).
2. `NestApplication` should be `INestApplication` (import as type from `@nestjs/common`).
3. `port` is not a valid option for `NestFactory.create` — remove it.
4. `logger: false` — let me check if this is valid. Actually, `logger` IS a valid option in `NestApplicationOptions`. Looking at the error more carefully:

```
Object literal may only specify known properties, and 'port' does not exist in type 'NestApplicationOptions'.
```

So `logger` is fine, but `port` is not. The error says `'port' does not exist in type 'NestApplicationOptions'`. So I just need to remove `port: 0`.

Let me re-read the errors:
- Error at line 3: `NestDependencyError` not exported from `@nestjs/core`
- Error at line 4: `NestApplication` not exported from `@nestjs/common`, suggests `INestApplication`
- Error at line 15: `port` doesn't exist in `NestApplicationOptions`
- Error at line 49: same as line 15

So the fixes are:
1. Remove `NestDependencyError` from the import. For the test that checks the error, I'll just use `rejects.toThrow()` without specifying the error class, or I can check the error message.
2. Change `NestApplication` to `INestApplication` (it's already imported as a type, just need to use the right name).
3. Remove `port: 0` from both `NestFactory.create` calls.

Let me write the fixed file:

```ts
import { describe, expect, it } from 'vitest';
import { Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { ExportService } from '../src/users/export.service.js';
import { UsersModule } from '../src/users/users.module.js';
import { RetryProcessor } from '../src/jobs/retry.processor.js';

describe('AppModule wiring', () => {
  it('boots: every provider resolves and cross-module providers are exported', async () => {
    const app: INestApplication = await NestFactory.create(AppModule, {
      logger: false,
    });
    try {
      await app.init();

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

    const app: INestApplication = await NestFactory.create(ExportProbeModule, {
      logger: false,
    });
    try {
      await expect(app.init()).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
});
```

Wait, but the task says "Change exactly what the compiler requires." Let me think about whether `rejects.toThrow()` without arguments is sufficient. The original intent was to check for a specific error type. But since `NestDependencyError` isn't exported, I can't reference it. I could check the error message, but that's fragile. `rejects.toThrow()` without args will pass for any thrown error, which is what we need here — we want to verify that `init()` fails when the export is missing.

Actually, I could also just use `rejects.toBeDefined()` or `rejects.toThrow()`. The `rejects.toThrow()` is the most appropriate since it asserts that a throw happens.

Let me also reconsider: the import `import type { NestApplication } from '@nestjs/common'` — the error says it should be `INestApplication`. So I change it to `INestApplication`.

And `NestDependencyError` — I remove it from the `@nestjs/core` import entirely, leaving just `NestFactory`.

This looks correct. Let me finalize.
```

## reply

### test/app.module.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { ExportService } from '../src/users/export.service.js';
import { UsersModule } from '../src/users/users.module.js';
import { RetryProcessor } from '../src/jobs/retry.processor.js';

describe('AppModule wiring', () => {
  it('boots: every provider resolves and cross-module providers are exported', async () => {
    const app: INestApplication = await NestFactory.create(AppModule, {
      logger: false,
    });
    try {
      await app.init();

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

    const app: INestApplication = await NestFactory.create(ExportProbeModule, {
      logger: false,
    });
    try {
      await expect(app.init()).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
});
```
