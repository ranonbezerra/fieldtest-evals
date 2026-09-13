# DIAGNOSIS

## Defect 1 – Circular import causing `ReferenceError: Cannot access 'QUEUES' before initialization`

**What was unresolvable?**  
`notifications.service.ts` imported the constant `QUEUES` from `jobs.module.ts`.  
`jobs.module.ts` imported `NotificationsModule`, which in turn imported
`notifications.service.ts`. This created a circular ES‑module import. At runtime,
the constant was accessed before it was initialized, so Node threw a
`ReferenceError` and the application died before Nest could start.

**Why `tsc` & unit tests missed it?**  
TypeScript type‑checking only validates type information; it does not evaluate
module execution order. The circular dependency does not produce a type error.
The unit test suite never builds the full Nest module graph – it creates
`UsersService` with a fake `PrismaService` directly – therefore the problematic
import chain is never executed.

**Minimal fix**  
Move the queue constants to a module that has no dependencies (`src/jobs/queues.ts`)
and import that file wherever the constants are needed. This breaks the cycle
without altering behaviour.

---

## Defect 2 – Missing provider `DeliveryRepository` in `NotificationsModule`

**What was unresolvable?**  
`NotificationsService` declares a constructor parameter `DeliveryRepository`,
but `NotificationsModule` never listed this class in its `providers` array. At
runtime Nest could not resolve the token and would throw an injection error.

**Why `tsc` & unit tests missed it?**  
TypeScript does not verify that every injected token has a corresponding provider.
The existing unit tests never instantiate `NotificationsService`, so the missing
provider never surfaces.

**Minimal fix**  
Add `DeliveryRepository` to the `providers` array of `NotificationsModule`.

---

## Defect 3 – `ExportService` not exported from `UsersModule`

**What was unresolvable?**  
`ExportsController` (in the `ExportsModule`) injects `ExportService`. The
`ExportService` is provided by `UsersModule`, but `UsersModule` only exported
`UsersService`. Consequently the token was unavailable to `ExportsModule`,
leading to a Nest injection error.

**Why `tsc` & unit tests missed it?**  
The TypeScript compiler does not check Nest’s provider export semantics, and the
test suite does not cover the `ExportsController`.

**Minimal fix**  
Export `ExportService` from `UsersModule` by adding it to the `exports` array.

---

## Wiring‑validation test

A new integration test `test/app.wiring.spec.ts` builds the real Nest
application context with `Test.createTestingModule({ imports: [AppModule] })`.
If any provider is missing or any import cycle remains, Nest throws during
`compile()`. The test therefore fails on the broken wiring and passes once the
above fixes are applied.

---

## Summary

The three defects were invisible to static type checking and to the existing
unit tests because they only involve runtime module loading and Nest’s
dependency‑injection metadata. By extracting shared constants, ensuring all
required providers are declared, and correctly exporting cross‑module services,
the application now starts, and a dedicated test guards against regression. 
