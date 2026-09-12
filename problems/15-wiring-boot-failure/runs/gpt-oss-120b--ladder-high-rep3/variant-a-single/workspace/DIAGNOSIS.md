# DIAGNOSIS

## Defect 1 – Circular import causing `ReferenceError: Cannot access 'QUEUES' before initialization`

- **What was unresolvable:**  
  `src/notifications/notifications.service.ts` imported `QUEUES` from `src/jobs/jobs.module.ts`.  
  `JobsModule` (in `jobs.module.ts`) imported `NotificationsModule`.  
  This created a circular ES‑module dependency: while evaluating `notifications.service.ts` the
  `QUEUES` binding from `jobs.module.ts` had not been initialised yet, leading to the runtime
  `ReferenceError`.

- **Why `tsc` missed it:**  
  TypeScript only checks types and the static import graph; it does **not** execute module
  top‑level code, so it cannot detect a run‑time TDZ (temporal dead zone) caused by a circular
  import.

- **Why the unit suite missed it:**  
  The unit tests instantiate services in isolation with handcrafted fakes and never build the
  full Nest application graph, therefore the circular import chain is never evaluated.

- **Minimal fix:**  
  Extract the queue constants (and the `QueueName` type) into a dedicated file
  `src/jobs/queues.constants.ts` that has no imports from other feature modules.  
  Import this file wherever the constants are needed (both `jobs.module.ts` and
  `notifications.service.ts`).  Remove the constant definition from `jobs.module.ts`.  
  This breaks the cycle without using `forwardRef`.

---

## Defect 2 – `ExportService` not exported from `UsersModule`

- **What was unresolvable:**  
  `ExportsController` (in `src/exports/exports.controller.ts`) depends on `ExportService`.  
  `ExportsModule` imports `UsersModule`, but `UsersModule` only exported `UsersService`.  
  Consequently Nest could not resolve `ExportService` when constructing the controller.

- **Why `tsc` missed it:**  
  The compiler only verifies that the class `ExportService` exists and is imported correctly;
  it does not understand Nest’s provider‑registration rules.

- **Why the unit suite missed it:**  
  The test suite only covers `UsersService`; it never creates `ExportsModule` or the controller,
  so the missing export never surfaces.

- **Minimal fix:**  
  Add `ExportService` to the `exports` array of `UsersModule`.

---

## Defect 3 – `DeliveryRepository` not registered in `NotificationsModule`

- **What was unresolvable:**  
  `NotificationsService` injects `DeliveryRepository`, but `NotificationsModule` did not list
  `DeliveryRepository` in its `providers`. Nest could not resolve this dependency during
  application bootstrap.

- **Why `tsc` missed it:**  
  TypeScript sees a valid import of the class but does not verify that the class is registered
  as a Nest provider.

- **Why the unit suite missed it:**  
  There are no unit tests for `NotificationsService`; the existing tests use hand‑crafted fakes,
  so the DI wiring issue never appears.

- **Minimal fix:**  
  Register `DeliveryRepository` as a provider in `NotificationsModule`.

---

## Additional safeguard

A new integration test `test/app-wiring.spec.ts` creates a real Nest application context with
`AppModule`. The test will fail if any of the above wiring problems remain because Nest will
throw a DI error during bootstrap. This test ensures that future merges cannot silently
re‑introduce the same class of errors.

```ts
import { describe, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';

describe('Application wiring', () => {
  it('boots without DI errors', async () => {
    const app = await NestFactory.createApplicationContext(AppModule);
    await app.close();
  });
});
```

Running `pnpm test` now validates correct wiring, and `pnpm start` successfully boots the
Nest application, logging the startup message as expected.
