# Wiring Defects Diagnosis

## Defect 1 – Circular import caused by `QUEUES` constant

**What happened**  
`notifications.service.ts` imported `QUEUES` from `jobs.module.ts`.  
`jobs.module.ts` imported `NotificationsModule` (which imports `notifications.service.ts`).  
At runtime this created a circular import: while evaluating `jobs.module.ts`, the `QUEUES` const had not yet been initialized, leading to:

```
ReferenceError: Cannot access 'QUEUES' before initialization
```

**Why TypeScript & unit tests missed it**  
* `tsc` only checks type information; it does not evaluate module execution order, so circular *runtime* dependencies are invisible to the compiler.  
* Unit tests stubbed the repository layer and never instantiated the full Nest module graph, therefore the problematic import chain was never evaluated.

**Minimal fix**  
Extract the constant into its own file (`src/jobs/queues.constant.ts`) that has **no imports**, and import it from there in `notifications.service.ts`.  
Remove the constant definition from `jobs.module.ts`. This breaks the circular import without using `forwardRef`.

---

## Defect 2 – `ExportService` not exported from `UsersModule`

**What happened**  
`ExportsController` (in the `ExportsModule`) injects `ExportService`.  
`ExportService` is provided in `UsersModule`, but `UsersModule` only exported `UsersService`.  
Consequently Nest could not resolve `ExportService` when building the application context.

**Why TypeScript & unit tests missed it**  
* The class `ExportService` exists and is correctly typed, so the compiler sees no problem.  
* The test suite does not cover the `ExportsController` or the module wiring; it only tests `UsersService` with a fake `PrismaService`.

**Minimal fix**  
Add `ExportService` to both the `providers` and `exports` arrays of `UsersModule`:

```ts
@Module({
  providers: [UsersService, ExportService],
  exports: [UsersService, ExportService],
})
export class UsersModule {}
```

---

## Defect 3 – `DeliveryRepository` not registered in `NotificationsModule`

**What happened**  
`NotificationsService` depends on `DeliveryRepository`, but `NotificationsModule` only listed `NotificationsService` in its `providers`.  
When Nest tried to resolve `NotificationsService`, the required `DeliveryRepository` provider was missing, causing a runtime DI error.

**Why TypeScript & unit tests missed it**  
* The constructor type `DeliveryRepository` is valid, so the compiler does not complain.  
* Unit tests for `NotificationsService` are absent; the only test suite uses a handcrafted instance of `UsersService` with a fake Prisma client, never exercising the Nest DI container.

**Minimal fix**  
Register `DeliveryRepository` in `NotificationsModule`:

```ts
@Module({
  providers: [NotificationsService, DeliveryRepository],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

---

## Why the defects survived the build

All three problems are **runtime wiring issues** that TypeScript’s static analysis does not catch. The existing test suite only exercises isolated services with manual dependency injection, never building the full Nest application graph. Therefore the failures manifested only when the application was started (`pnpm start`).

---

## Added safety net – wiring test

A new test `test/wiring.spec.ts` builds the real Nest application context using `NestFactory.create(AppModule)`. If any provider cannot be resolved or any import cycle exists, the creation promise rejects and the test fails. After the fixes, the test passes, guaranteeing that future changes that break wiring will be caught automatically.

```ts
import 'reflect-metadata';
import { test } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';

test('application boots without wiring errors', async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  await app.close();
});
```

Running `pnpm test` will now fail if the module graph is incorrectly wired, providing a regression guard against the class of bugs that previously slipped through the build and test pipeline.
