# repair1-set

## reasoning

```
Let me analyze the errors as a whole to identify the distinct mistakes:

1. **TS2835: Relative import paths need explicit file extensions** — This is `moduleResolution: "node16"` or `"nodenext"` requiring `.js` extensions on relative imports. This affects files that import from `../common/api-error`, `../common/validation`, `../common/prisma-errors`, and `./helpers`. The fix is to add `.js` to those relative import paths.

2. **TS2307: Cannot find module** — These are all relative imports without `.js` extensions. The same fix applies: add `.js` to the import path. This is the same root cause as #1.

3. **TS7006: Parameter implicitly has an 'any' type** — These occur because the modules they import from can't be resolved (TS2307), so the types from those modules become `any`, and the callback parameters in `.reduce()`, `.map()`, `.find()`, etc. can't be inferred. Once the imports resolve, these should go away. BUT wait — some of these are in files where the import IS resolvable (e.g., `financial-totals.service.ts` imports from `./financial-totals.repository` which is TS2307). So fixing the imports should fix these too.

Wait, let me look more carefully. The TS7006 errors are:
- `src/financial-totals/financial-totals.service.ts(28,38)` — `acc` in reduce
- `src/financial-totals/financial-totals.service.ts(28,43)` — `row` in reduce
- `src/financial-totals/financial-totals.service.ts(29,37)` — `acc` in reduce
- `src/financial-totals/financial-totals.service.ts(29,42)` — `row` in reduce
- `src/financial-totals/financial-totals.service.ts(32,27)` — `row` in map
- `src/order-events/order-events.service.ts(28,47)` — `tx` in callback
- `src/payment-orders/payment-orders.service.ts(41,47)` — `tx` in callback
- `src/payment-orders/payment-orders.service.ts(81,47)` — `tx` in callback
- `test/concurrency.spec.ts(52,43)` — `row` in find
- `test/concurrency.spec.ts(59,29)` — `item` in every
- `test/drift-repair.spec.ts(76,38)` — `item` in find
- `test/operations.spec.ts(73,27)` — `item` in map
- `test/operations.spec.ts(108,27)` — `item` in map

These are all caused by the TS2307 errors — when the module can't be found, the imported types are `any`, and the parameters in callbacks can't be inferred. Once the imports are fixed with `.js` extensions, the types will resolve and these implicit `any` errors will go away.

Wait, but actually — the `tx` parameter in `order-events.service.ts(28,47)` and `payment-orders.service.ts(41,47)` and `(81,47)` — these are the `tx` parameters in callbacks passed to `withTransaction`. The `withTransaction` method is defined in the repositories. If the repository module can't be found, the type of `withTransaction` is unknown, so `tx` becomes implicitly `any`. Once the imports are fixed, `tx` will be typed as `Prisma.TransactionClient`.

So the distinct mistakes are:

**Mistake 1: Missing `.js` extensions on all relative imports.**

This is the ONLY distinct mistake. All TS2307 errors are because the module resolution strategy (`node16`/`nodenext`) requires explicit file extensions. All TS7006 errors are cascading from the TS2307 errors (unresolvable imports → unknown types → implicit any on callback params). All TS2835 errors are the same issue flagged differently (the compiler is suggesting the fix).

Now let me go through each file that needs changes:

**Files with TS2835 (explicit extension needed on `../common/*` imports):**
- `src/operations/operations.controller.ts` — `../common/api-error` → `../common/api-error.js`, `../common/validation` → `../common/validation.js`
- `src/order-events/order-events.controller.ts` — `../common/api-error` → `../common/api-error.js`, `../common/validation` → `../common/validation.js`
- `src/order-events/order-events.service.ts` — `../common/api-error` → `../common/api-error.js`, `../common/prisma-errors` → `../common/prisma-errors.js`
- `src/payment-orders/payment-orders.controller.ts` — `../common/api-error` → `../common/api-error.js`, `../common/validation` → `../common/validation.js`
- `src/payment-orders/payment-orders.repository.ts` — `../common/api-error` → `../common/api-error.js`
- `src/payment-orders/payment-orders.service.ts` — `../common/api-error` → `../common/api-error.js`, `../common/prisma-errors` → `../common/prisma-errors.js`

**Files with TS2307 (same fix — add `.js`):**
- `src/financial-totals/financial-totals.service.ts` — `./financial-totals.repository` → `./financial-totals.repository.js`
- `src/main.ts` — `./app.module` → `./app.module.js`, `./common/error-envelope.filter` → `./common/error-envelope.filter.js`
- `src/operations/operations.controller.ts` — `./operations.service` → `./operations.service.js`
- `src/operations/operations.module.ts` — `../prisma/prisma.module` → `../prisma/prisma.module.js`, `./operations.controller` → `./operations.controller.js`, `./operations.repository` → `./operations.repository.js`, `./operations.service` → `./operations.service.js`
- `src/operations/operations.repository.ts` — `../prisma/prisma.service` → `../prisma/prisma.service.js`
- `src/operations/operations.service.ts` — `./operations.repository` → `./operations.repository.js`
- `src/order-events/order-events.controller.ts` — `./order-events.service` → `./order-events.service.js`
- `src/order-events/order-events.module.ts` — `../operations/operations.module` → `../operations/operations.module.js`, `../prisma/prisma.module` → `../prisma/prisma.module.js`, `./order-events.controller` → `./order-events.controller.js`, `./order-events.repository` → `./order-events.repository.js`, `./order-events.service` → `./order-events.service.js`
- `src/order-events/order-events.repository.ts` — `../prisma/prisma.service` → `../prisma/prisma.service.js`
- `src/order-events/order-events.service.ts` — `../operations/operations.repository` → `../operations/operations.repository.js`, `./order-events.repository` → `./order-events.repository.js`
- `src/payment-orders/payment-orders.controller.ts` — `./payment-orders.service` → `./payment-orders.service.js`
- `src/payment-orders/payment-orders.module.ts` — `../financial-totals/financial-totals.module` → `../financial-totals/financial-totals.module.js`, `../operations/operations.module` → `../operations/operations.module.js`, `../prisma/prisma.module` → `../prisma/prisma.module.js`, `../order-events/order-events.module` → `../order-events/order-events.module.js`, `./payment-orders.controller` → `./payment-orders.controller.js`, `./payment-orders.repository` → `./payment-orders.repository.js`, `./payment-orders.service` → `./payment-orders.service.js`
- `src/payment-orders/payment-orders.repository.ts` — `../prisma/prisma.service` → `../prisma/prisma.service.js`
- `src/payment-orders/payment-orders.service.ts` — `../financial-totals/financial-totals.repository` → `../financial-totals/financial-totals.repository.js`, `../operations/operations.repository` → `../operations/operations.repository.js`, `../order-events/order-events.repository` → `../order-events/order-events.repository.js`, `./payment-orders.repository` → `./payment-orders.repository.js`
- `src/prisma/prisma.module.ts` — `./prisma.service` → `./prisma.service.js`
- `test/concurrency.spec.ts` — `./helpers` → `./helpers.js`
- `test/drift-repair.spec.ts` — `./helpers` → `./helpers.js`
- `test/helpers.ts` — all `../src/*` imports need `.js`
- `test/operations.spec.ts` — `./helpers` → `./helpers.js`

Now, what about `src/app.module.ts`? Let me check its imports:
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DriftRepairModule } from './drift-repair/drift-repair.module';
import { FinancialTotalsModule } from './financial-totals/financial-totals.module';
import { OperationsModule } from './operations/operations.module';
import { OrderEventsModule } from './order-events/order-events.module';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module';
```

These would also need `.js` extensions, but the error list doesn't mention `src/app.module.ts`. Wait, let me re-read the errors... I don't see `src/app.module.ts` in the error list. That's odd. But `src/main.ts` has `Cannot find module './app.module'`. So the import in `main.ts` needs the fix, but `app.module.ts` itself isn't flagged. That's because the errors in `app.module.ts` would be TS2307 for its own relative imports, but those aren't listed... 

Wait, actually looking again at the error list — I see errors for `src/main.ts(3,27)` about `./app.module`. But I don't see errors for `src/app.module.ts` itself. This is strange. Let me look more carefully...

Actually, I think the compiler might stop reporting errors for a file if it can't resolve one of its imports. Or maybe `app.module.ts` isn't being compiled because `main.ts` can't find it. In any case, I should fix `app.module.ts` too since it has relative imports that would fail under `node16` resolution.

Wait, but the instructions say "Change exactly what the compiler requires." and "Do not rename anything the errors do not mention." If `app.module.ts` isn't in the error list, should I fix it? 

Hmm, but if I fix `main.ts` to import `./app.module.js`, then the compiler will find `app.module.ts` and will then check its imports. So `app.module.ts` WILL get errors on the next compile. But the instructions say to fix what the compiler reports NOW.

Actually, re-reading the instructions: "Fix all of them in one reply." — "them" refers to the errors shown. But also: "You are seeing the whole set on purpose." This implies this is the complete set. So if `app.module.ts` isn't in the list, maybe the compiler didn't get to it because `main.ts` failed first.

But the spirit of the instruction is to fix all the errors so typecheck passes. If I only fix the listed errors, the next typecheck will show errors in `app.module.ts`. I think I should fix `app.module.ts` too.

Wait, let me reconsider. The instructions say "Change exactly what the compiler requires." The compiler IS requiring those fixes in `app.module.ts` — it just hasn't gotten there yet because it can't resolve `./app.module` from `main.ts`. Once I fix that, the compiler will check `app.module.ts` and find the same class of error.

I'll include `app.module.ts` in my fixes.

Let me also check `src/drift-repair/drift-repair.module.ts` and `src/drift-repair/drift-repair.service.ts` and `src/drift-repair/drift-repair.processor.ts` and `src/drift-repair/drift-repair.repository.ts` — are they in the error list?

Looking at the errors:
- `src/drift-repair/drift-repair.module.ts` — NOT in the error list
- `src/drift-repair/drift-repair.service.ts` — NOT in the error list
- `src/drift-repair/drift-repair.processor.ts` — NOT in the error list
- `src/drift-repair/drift-repair.repository.ts` — NOT in the error list

These aren't flagged because they're not imported by any file that IS being checked (or the compiler didn't get to them). But `app.module.ts` imports `./drift-repair/drift-repair.module`, and `drift-repair.module.ts` imports from other modules. Once the chain is resolved, these will need fixes too.

Similarly, `src/financial-totals/financial-totals.module.ts` and `src/financial-totals/financial-totals.controller.ts` — let me check if they're in the error list.

- `src/financial-totals/financial-totals.module.ts` — NOT in the error list
- `src/financial-totals/financial-totals.controller.ts` — NOT in the error list

But `src/financial-totals/financial-totals.service.ts` IS in the error list.

OK so the pattern is clear: the compiler is reporting errors for files it CAN resolve (i.e., files that are imported by other files it's checking, or entry points). Files that can't be resolved yet won't show their own errors until the resolution chain is fixed.

Given the instruction "Fix all of them in one reply" and the fact that this is meant to make typecheck pass, I should fix ALL files that have relative imports needing `.js` extensions, not just the ones currently showing errors. Otherwise the next typecheck will show new errors.

Let me list ALL files that need `.js` extensions added to their relative imports:

1. `src/main.ts`
2. `src/app.module.ts`
3. `src/prisma/prisma.module.ts`
4. `src/operations/operations.module.ts`
5. `src/operations/operations.controller.ts`
6. `src/operations/operations.service.ts`
7. `src/operations/operations.repository.ts`
8. `src/order-events/order-events.module.ts`
9. `src/order-events/order-events.controller.ts`
10. `src/order-events/order-events.service.ts`
11. `src/order-events/order-events.repository.ts`
12. `src/payment-orders/payment-orders.module.ts`
13. `src/payment-orders/payment-orders.controller.ts`
14. `src/payment-orders/payment-orders.service.ts`
15. `src/payment-orders/payment-orders.repository.ts`
16. `src/financial-totals/financial-totals.module.ts`
17. `src/financial-totals/financial-totals.controller.ts`
18. `src/financial-totals/financial-totals.service.ts`
19. `src/financial-totals/financial-totals.repository.ts`
20. `src/drift-repair/drift-repair.module.ts`
21. `src/drift-repair/drift-repair.service.ts`
22. `src/drift-repair/drift-repair.processor.ts`
23. `src/drift-repair/drift-repair.repository.ts`
24. `test/helpers.ts`
25. `test/operations.spec.ts`
26. `test/concurrency.spec.ts`
27. `test/drift-repair.spec.ts`

Now let me also check: does `src/common/error-envelope.filter.ts` have any relative imports? Looking at the reference:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error';
```
Yes! `./api-error` needs `.js`. But it's not in the error list. I should fix it anyway.

And `src/common/api-error.ts` and `src/common/validation.ts` and `src/common/prisma-errors.ts` — do they have relative imports? I don't have their content, but they're likely simple files without relative imports (or importing only from packages). I'll skip them since I don't have their content and they're not in the error list.

Actually wait — I only have the content of files that are shown in the reference. Let me only fix files whose content I have. For files I don't have content for (like `src/common/api-error.ts`, `src/common/validation.ts`, `src/common/prisma-errors.ts`, `src/prisma/prisma.service.ts`), I can't produce their full content.

But actually, the files I DON'T have content for are:
- `src/common/api-error.ts`
- `src/common/validation.ts`
- `src/common/prisma-errors.ts`
- `src/prisma/prisma.service.ts`

These are the "leaf" files that are imported by others. They might have their own relative imports, but I don't know. Since they're not in the error list and I don't have their content, I'll leave them alone.

Now let me also check: `src/financial-totals/financial-totals.repository.ts` — I have its content. Let me check its imports:
```ts
import { Injectable } from '@nestjs/common';
import { CompanyFinancialTotal, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
```
Yes, `../prisma/prisma.service` needs `.js`. It's not in the error list but I should fix it.

OK let me now write out all the files. I'll go through each one and add `.js` to relative imports only.

Let me be systematic. For each file, I'll list the relative imports and what they need to become:

**src/main.ts:**
- `./app.module` → `./app.module.js`
- `./common/error-envelope.filter` → `./common/error-envelope.filter.js`

**src/app.module.ts:**
- `./drift-repair/drift-repair.module` → `./drift-repair/drift-repair.module.js`
- `./financial-totals/financial-totals.module` → `./financial-totals/financial-totals.module.js`
- `./operations/operations.module` → `./operations/operations.module.js`
- `./order-events/order-events.module` → `./order-events/order-events.module.js`
- `./payment-orders/payment-orders.module` → `./payment-orders/payment-orders.module.js`

**src/prisma/prisma.module.ts:**
- `./prisma.service` → `./prisma.service.js`

**src/operations/operations.module.ts:**
- `../prisma/prisma.module` → `../prisma/prisma.module.js`
- `./operations.controller` → `./operations.controller.js`
- `./operations.repository` → `./operations.repository.js`
- `./operations.service` → `./operations.service.js`

**src/operations/operations.controller.ts:**
- `../common/api-error` → `../common/api-error.js`
- `../common/validation` → `../common/validation.js`
- `./operations.service` → `./operations.service.js`

**src/operations/operations.service.ts:**
- `./operations.repository` → `./operations.repository.js`

**src/operations/operations.repository.ts:**
- `../prisma/prisma.service` → `../prisma/prisma.service.js`

**src/order-events/order-events.module.ts:**
- `../operations/operations.module` → `../operations/operations.module.js`
- `../prisma/prisma.module` → `../prisma/prisma.module.js`
- `./order-events.controller` → `./order-events.controller.js`
- `./order-events.repository` → `./order-events.repository.js`
- `./order-events.service` → `./order-events.service.js`

**src/order-events/order-events.controller.ts:**
- `../common/api-error` → `../common/api-error.js`
- `../common/validation` → `../common/validation.js`
- `./order-events.service` → `./order-events.service.js`

**src/order-events/order-events.service.ts:**
- `../common/api-error` → `../common/api-error.js`
- `../common/prisma-errors` → `../common/prisma-errors.js`
- `../operations/operations.repository` → `../operations/operations.repository.js`
- `./order-events.repository` → `./order-events.repository.js`

**src/order-events/order-events.repository.ts:**
- `../prisma/prisma.service` → `../prisma/prisma.service.js`

**src/payment-orders/payment-orders.module.ts:**
- `../financial-totals/financial-totals.module` → `../financial-totals/financial-totals.module.js`
- `../operations/operations.module` → `../operations/operations.module.js`
- `../prisma/prisma.module` → `../prisma/prisma.module.js`
- `../order-events/order-events.module` → `../order-events/order-events.module.js`
- `./payment-orders.controller` → `./payment-orders.controller.js`
- `./payment-orders.repository` → `./payment-orders.repository.js`
- `./payment-orders.service` → `./payment-orders.service.js`

**src/payment-orders/payment-orders.controller.ts:**
- `../common/api-error` → `../common/api-error.js`
- `../common/validation` → `../common/validation.js`
- `./payment-orders.service` → `./payment-orders.service.js`

**src/payment-orders/payment-orders.service.ts:**
- `../common/api-error` → `../common/api-error.js`
- `../common/prisma-errors` → `../common/prisma-errors.js`
- `../financial-totals/financial-totals.repository` → `../financial-totals/financial-totals.repository.js`
- `../operations/operations.repository` → `../operations/operations.repository.js`
- `../order-events/order-events.repository` → `../order-events/order-events.repository.js`
- `./payment-orders.repository` → `./payment-orders.repository.js`

**src/payment-orders/payment-orders.repository.ts:**
- `../common/api-error` → `../common/api-error.js`
- `../prisma/prisma.service` → `../prisma/prisma.service.js`

**src/financial-totals/financial-totals.module.ts:**
- `../prisma/prisma.module` → `../prisma/prisma.module.js`
- `./financial-totals.controller` → `./financial-totals.controller.js`
- `./financial-totals.repository` → `./financial-totals.repository.js`
- `./financial-totals.service` → `./financial-totals.service.js`

**src/financial-totals/financial-totals.controller.ts:**
- `../common/api-error` → `../common/api-error.js`
- `../common/validation` → `../common/validation.js`
- `./financial-totals.service` → `./financial-totals.service.js`

**src/financial-totals/financial-totals.service.ts:**
- `./financial-totals.repository` → `./financial-totals.repository.js`

**src/financial-totals/financial-totals.repository.ts:**
- `../prisma/prisma.service` → `../prisma/prisma.service.js`

**src/drift-repair/drift-repair.module.ts:**
- `../financial-totals/financial-totals.module` → `../financial-totals/financial-totals.module.js`
- `../operations/operations.module` → `../operations/operations.module.js`
- `../prisma/prisma.module` → `../prisma/prisma.module.js`
- `./drift-repair.processor` → `./drift-repair.processor.js`
- `./drift-repair.repository` → `./drift-repair.repository.js`
- `./drift-repair.service` → `./drift-repair.service.js`

**src/drift-repair/drift-repair.service.ts:**
- `../financial-totals/financial-totals.repository` → `../financial-totals/financial-totals.repository.js`
- `../operations/operations.repository` → `../operations/operations.repository.js`
- `./drift-repair.repository` → `./drift-repair.repository.js`

**src/drift-repair/drift-repair.processor.ts:**
- `./drift-repair.service` → `./drift-repair.service.js`

**src/drift-repair/drift-repair.repository.ts:**
- `../prisma/prisma.service` → `../prisma/prisma.service.js`

**test/helpers.ts:**
- `../src/drift-repair/drift-repair.repository` → `../src/drift-repair/drift-repair.repository.js`
- `../src/drift-repair/drift-repair.service` → `../src/drift-repair/drift-repair.service.js`
- `../src/financial-totals/financial-totals.repository` → `../src/financial-totals/financial-totals.repository.js`
- `../src/financial-totals/financial-totals.service` → `../src/financial-totals/financial-totals.service.js`
- `../src/operations/operations.repository` → `../src/operations/operations.repository.js`
- `../src/operations/operations.service` → `../src/operations/operations.service.js`
- `../src/order-events/order-events.repository` → `../src/order-events/order-events.repository.js`
- `../src/order-events/order-events.service` → `../src/order-events/order-events.service.js`
- `../src/payment-orders/payment-orders.repository` → `../src/payment-orders/payment-orders.repository.js`
- `../src/payment-orders/payment-orders.service` → `../src/payment-orders/payment-orders.service.js`
- `../src/prisma/prisma.service` → `../src/prisma/prisma.service.js`

**test/operations.spec.ts:**
- `./helpers` → `./helpers.js`

**test/concurrency.spec.ts:**
- `./helpers` → `./helpers.js`

**test/drift-repair.spec.ts:**
- `./helpers` → `./helpers.js`

Now, there's also the first error in the list which is a type incompatibility:
```
gs>' is not assignable to type 'Promise<void>'.
```

This seems to be a truncated error. Let me look at the context. It mentions `OrderStatus`, `companyId`, `updatedAt`, `orderCount`, `totalAmount` — this looks like it's about `companyFinancialTotal.upsert()` returning a `CompanyFinancialTotal` but being used where `Promise<void>` is expected.

Looking at `src/financial-totals/financial-totals.repository.ts`, the `applyDelta` method:
```ts
private applyDelta(
    tx: Prisma.TransactionClient,
    companyId: string,
    status: OrderStatus,
    countDelta: number,
    amountDelta: Prisma.Decimal,
  ): Promise<void> {
    return tx.companyFinancialTotal.upsert({
      where: { companyId_status: { companyId, status } },
      create: { companyId, status, orderCount: countDelta, totalAmount: amountDelta },
      update: {
        orderCount: { increment: countDelta },
        totalAmount: { increment: amountDelta },
      },
    });
  }
```

The `upsert` method returns `Promise<CompanyFinancialTotal>`, but the method signature says `Promise<void>`. The fix is to not return the upsert result, or to change the return type. Since the method is meant to be a void operation (apply a delta), the fix is to `await` the upsert and not return it:

```ts
private async applyDelta(
    tx: Prisma.TransactionClient,
    companyId: string,
    status: OrderStatus,
    countDelta: number,
    amountDelta: Prisma.Decimal,
  ): Promise<void> {
    await tx.companyFinancialTotal.upsert({
      where: { companyId_status: { companyId, status } },
      create: { companyId, status, orderCount: countDelta, totalAmount: amountDelta },
      update: {
        orderCount: { increment: countDelta },
        totalAmount: { increment: amountDelta },
      },
    });
  }
```

This is a second distinct mistake: the `applyDelta` method returns a `Promise<CompanyFinancialTotal>` from the upsert call but declares a return type of `Promise<void>`.

So there are exactly **two distinct mistakes**:
1. Missing `.js` extensions on all relative imports (causing TS2835 and TS2307, which cascade to TS7006)
2. `applyDelta` returns the upsert result instead of void (type incompatibility)

Now let me write out all the files. I need to be careful to only change the import lines and the `applyDelta` method, keeping everything else identical.

Actually wait — I need to double-check: the first error message is truncated. Let me re-read it:

```
gs>' is not assignable to type 'Promise<void>'.
  Types of property 'then' are incompatible.
    Type '<TResult1 = { status: OrderStatus; companyId: string; updatedAt: Date; orderCount: number; totalAmount: Decimal; }, ...
```

The `{ status: OrderStatus; companyId: string; updatedAt: Date; orderCount: number; totalAmount: Decimal; }` is the shape of `CompanyFinancialTotal`. So yes, this is the `applyDelta` method returning `Promise<CompanyFinancialTotal>` where `Promise<void>` is expected.

OK, I'm confident in my analysis. Let me write out all the files now.
```

## reply

Looking at the full error list, I see exactly **two distinct mistakes**:

1. **Missing `.js` extensions on all relative imports** — under `moduleResolution: "node16"`, every relative import must end in `.js`. This causes all the TS2835 and TS2307 errors, which cascade into the TS7006 implicit-`any` errors (unresolvable modules → unknown types → uninferable callback params).

2. **`applyDelta` returns the `upsert` result** (`Promise<CompanyFinancialTotal>`) but declares `Promise<void>`.

I'll fix both everywhere they belong.

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
// ASSUMPTION: @nestjs/schedule (the standard NestJS scheduler) is available as a dependency;
// it drives the scheduled drift-repair job.
import { ScheduleModule } from '@nestjs/schedule';
import { DriftRepairModule } from './drift-repair/drift-repair.module.js';
import { FinancialTotalsModule } from './financial-totals/financial-totals.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { OrderEventsModule } from './order-events/order-events.module.js';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PaymentOrdersModule,
    OrderEventsModule,
    OperationsModule,
    FinancialTotalsModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/operations/operations.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  exports: [OperationsRepository, OperationsService],
})
export class OperationsModule {}
```

### src/operations/operations.controller.ts
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { isUuid, parseBoundedPositiveInt, parseIsoDate } from '../common/validation.js';
import { OperationsService } from './operations.service.js';

const ORDER_STATUSES: string[] = Object.values(OrderStatus);

@Controller('operations')
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  /**
   * Dashboard list. Query params:
   * company_id (required UUID), status (enum), from/to (ISO-8601, half-open
   * range on last_event_at), page (>=1, default 1), page_size (1..200, default 50).
   */
  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    const errors: Record<string, string> = {};
    if (!isUuid(query.company_id)) errors.company_id = 'must be a UUID';

    let status: OrderStatus | undefined;
    if (query.status !== undefined) {
      if (ORDER_STATUSES.includes(query.status)) {
        status = query.status as OrderStatus;
      } else {
        errors.status = `must be one of: ${ORDER_STATUSES.join(', ')}`;
      }
    }

    let from: Date | undefined;
    if (query.from !== undefined) {
      const parsed = parseIsoDate(query.from);
      if (parsed === null) errors.from = 'must be an ISO-8601 timestamp';
      else from = parsed;
    }
    let to: Date | undefined;
    if (query.to !== undefined) {
      const parsed = parseIsoDate(query.to);
      if (parsed === null) errors.to = 'must be an ISO-8601 timestamp';
      else to = parsed;
    }
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      errors.to = 'must be strictly after from';
    }

    const page = parseBoundedPositiveInt(query.page, 1, Number.MAX_SAFE_INTEGER, 1, errors, 'page');
    const pageSize = parseBoundedPositiveInt(query.page_size, 1, 200, 50, errors, 'page_size');

    if (Object.keys(errors).length > 0) {
      throw new ApiError('validation_failed', 'Query parameters failed validation.', 400, { fields: errors });
    }
    return this.service.list({
      companyId: query.company_id as string,
      status,
      from,
      to,
      page: page as number,
      pageSize: pageSize as number,
    });
  }
}
```

### src/operations/operations.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { Operation, OrderStatus } from '@prisma/client';
import { OperationQuery, OperationsRepository } from './operations.repository.js';

export interface OperationDto {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  last_event_at: string;
  created_at: string;
  updated_at: string;
}

export interface OperationsPageDto {
  items: OperationDto[];
  page: number;
  page_size: number;
  total_count: number;
}

@Injectable()
export class OperationsService {
  constructor(private readonly operations: OperationsRepository) {}

  /** Reads the dashboard page from the projection — no join at request time. */
  async list(query: OperationQuery): Promise<OperationsPageDto> {
    const { items, total } = await this.operations.findPage(query);
    return {
      items: items.map(toDto),
      page: query.page,
      page_size: query.pageSize,
      total_count: total,
    };
  }
}

function toDto(row: Operation): OperationDto {
  return {
    id: row.id,
    company_id: row.companyId,
    worker_id: row.workerId,
    worker_name: row.workerName,
    status: row.status,
    amount: row.amount.toFixed(4),
    currency: row.currency,
    last_event_at: row.lastEventAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
```

### src/operations/operations.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Operation, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface OperationRow {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  status: OrderStatus;
  amount: Prisma.Decimal;
  currency: string;
  lastEventAt: Date;
}

export interface OperationQuery {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dashboard page: a single indexed read on the projection.
   * Served by (company_id, [status,] last_event_at DESC); id is the
   * deterministic tiebreaker so pagination is stable.
   */
  async findPage(query: OperationQuery): Promise<{ items: Operation[]; total: number }> {
    const where: Prisma.OperationWhereInput = {
      companyId: query.companyId,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.from !== undefined || query.to !== undefined
        ? {
            lastEventAt: {
              ...(query.from !== undefined ? { gte: query.from } : {}),
              ...(query.to !== undefined ? { lt: query.to } : {}),
            },
          }
        : {}),
    };
    const items = await this.prisma.operation.findMany({
      where,
      orderBy: [{ lastEventAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    const total = await this.prisma.operation.count({ where });
    return { items, total };
  }

  /** Maintenance hook / re-derivation: upsert the read-model row for an order. */
  async upsertOperation(tx: Prisma.TransactionClient, row: OperationRow): Promise<void> {
    await tx.operation.upsert({
      where: { id: row.id },
      create: {
        id: row.id,
        companyId: row.companyId,
        workerId: row.workerId,
        workerName: row.workerName,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        lastEventAt: row.lastEventAt,
      },
      update: {
        companyId: row.companyId,
        workerId: row.workerId,
        workerName: row.workerName,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        lastEventAt: row.lastEventAt,
      },
    });
  }

  /**
   * Maintenance hook: move the row's recency forward when an event is recorded.
   * Never moves it backwards, so backfilled events stay deterministic.
   */
  async touchLastEvent(tx: Prisma.TransactionClient, orderId: string, occurredAt: Date): Promise<void> {
    const current = await tx.operation.findUnique({ where: { id: orderId }, select: { lastEventAt: true } });
    if (!current) {
      // No projection row yet (e.g. a pre-hook write); the next write or the
      // drift-repair re-derivation will create it from the source of truth.
      return;
    }
    if (occurredAt.getTime() > current.lastEventAt.getTime()) {
      await tx.operation.update({ where: { id: orderId }, data: { lastEventAt: occurredAt } });
    }
  }
}
```

### src/order-events/order-events.module.ts
```ts
import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { OrderEventsController } from './order-events.controller.js';
import { OrderEventsRepository } from './order-events.repository.js';
import { OrderEventsService } from './order-events.service.js';

@Module({
  imports: [PrismaModule, OperationsModule],
  controllers: [OrderEventsController],
  providers: [OrderEventsService, OrderEventsRepository],
  exports: [OrderEventsRepository],
})
export class OrderEventsModule {}
```

### src/order-events/order-events.controller.ts
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { asObject, isUuid, parseIsoDate } from '../common/validation.js';
import { OrderEventsService } from './order-events.service.js';

const FUTURE_SKEW_MS = 5_000;

@Controller('order-events')
export class OrderEventsController {
  constructor(private readonly service: OrderEventsService) {}

  @Post()
  create(@Body() rawBody: unknown) {
    const body = asObject(rawBody);
    const errors: Record<string, string> = {};
    if (!isUuid(body.order_id)) errors.order_id = 'must be a UUID';
    if (typeof body.type !== 'string' || body.type.length === 0 || body.type.length > 64) {
      errors.type = 'must be a non-empty string of at most 64 characters';
    }
    let occurredAt: Date | null = null;
    if (body.occurred_at === undefined) {
      occurredAt = new Date();
    } else {
      const parsed = parseIsoDate(body.occurred_at);
      if (parsed === null) {
        errors.occurred_at = 'must be an ISO-8601 timestamp';
      } else if (parsed.getTime() > Date.now() + FUTURE_SKEW_MS) {
        errors.occurred_at = 'must not be in the future';
      } else {
        occurredAt = parsed;
      }
    }
    if (Object.keys(errors).length > 0) {
      throw new ApiError('validation_failed', 'Request body failed validation.', 400, { fields: errors });
    }
    return this.service.record({
      orderId: body.order_id as string,
      type: body.type as string,
      occurredAt: occurredAt as Date,
    });
  }
}
```

### src/order-events/order-events.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { OrderEvent } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { isForeignKeyError } from '../common/prisma-errors.js';
import { OperationsRepository } from '../operations/operations.repository.js';
import { CreateOrderEventInput, OrderEventsRepository } from './order-events.repository.js';

export interface OrderEventDto {
  id: string;
  order_id: string;
  type: string;
  occurred_at: string;
}

/**
 * Simulated write path for order events. The event and the read-model
 * maintenance hook commit in ONE transaction, so the dashboard reflects the
 * new recency on the very next request.
 */
@Injectable()
export class OrderEventsService {
  constructor(
    private readonly events: OrderEventsRepository,
    private readonly operations: OperationsRepository,
  ) {}

  record(input: CreateOrderEventInput): Promise<OrderEventDto> {
    return this.events.withTransaction(async (tx) => {
      let event: OrderEvent;
      try {
        event = await this.events.createInTx(tx, input);
      } catch (error) {
        if (isForeignKeyError(error)) {
          throw new ApiError('resource_not_found', `Payment order ${input.orderId} was not found.`, 404, {
            order_id: input.orderId,
          });
        }
        throw error;
      }
      // Maintenance hook: keep the projection's recency fresh, same transaction.
      await this.operations.touchLastEvent(tx, input.orderId, event.occurredAt);
      return {
        id: event.id,
        order_id: event.orderId,
        type: event.type,
        occurred_at: event.occurredAt.toISOString(),
      };
    });
  }
}
```

### src/order-events/order-events.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { OrderEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateOrderEventInput {
  orderId: string;
  type: string;
  occurredAt: Date;
}

@Injectable()
export class OrderEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
  }

  async createInTx(tx: Prisma.TransactionClient, input: CreateOrderEventInput): Promise<OrderEvent> {
    return tx.orderEvent.create({
      data: { orderId: input.orderId, type: input.type, occurredAt: input.occurredAt },
    });
  }
}
```

### src/payment-orders/payment-orders.module.ts
```ts
import { Module } from '@nestjs/common';
import { FinancialTotalsModule } from '../financial-totals/financial-totals.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { OrderEventsModule } from '../order-events/order-events.module.js';
import { PaymentOrdersController } from './payment-orders.controller.js';
import { PaymentOrdersRepository } from './payment-orders.repository.js';
import { PaymentOrdersService } from './payment-orders.service.js';

@Module({
  imports: [PrismaModule, OrderEventsModule, OperationsModule, FinancialTotalsModule],
  controllers: [PaymentOrdersController],
  providers: [PaymentOrdersService, PaymentOrdersRepository],
  exports: [PaymentOrdersRepository],
})
export class PaymentOrdersModule {}
```

### src/payment-orders/payment-orders.controller.ts
```ts
import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { asObject, isUuid, parseAmount } from '../common/validation.js';
import { PaymentOrdersService } from './payment-orders.service.js';

const ORDER_STATUSES: string[] = Object.values(OrderStatus);
const CURRENCY_RE = /^[A-Za-z]{3}$/;

@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly service: PaymentOrdersService) {}

  @Post()
  create(@Body() rawBody: unknown) {
    const body = asObject(rawBody);
    const errors: Record<string, string> = {};
    if (!isUuid(body.company_id)) errors.company_id = 'must be a UUID';
    if (!isUuid(body.worker_id)) errors.worker_id = 'must be a UUID';
    const amount = parseAmount(body.amount);
    if (amount === null) errors.amount = 'must be a positive number';
    if (typeof body.currency !== 'string' || !CURRENCY_RE.test(body.currency)) {
      errors.currency = 'must be a 3-letter ISO code';
    }
    if (Object.keys(errors).length > 0) {
      throw new ApiError('validation_failed', 'Request body failed validation.', 400, { fields: errors });
    }
    return this.service.create({
      companyId: body.company_id as string,
      workerId: body.worker_id as string,
      amount: amount as Prisma.Decimal,
      currency: (body.currency as string).toUpperCase(),
    });
  }

  @Patch(':id')
  changeStatus(@Param('id') id: string, @Body() rawBody: unknown) {
    const body = asObject(rawBody);
    const errors: Record<string, string> = {};
    if (!isUuid(id)) errors.id = 'must be a UUID';
    if (typeof body.status !== 'string' || !ORDER_STATUSES.includes(body.status)) {
      errors.status = `must be one of: ${ORDER_STATUSES.join(', ')}`;
    }
    if (Object.keys(errors).length > 0) {
      throw new ApiError('validation_failed', 'Request failed validation.', 400, { fields: errors });
    }
    return this.service.changeStatus(id, body.status as OrderStatus);
  }
}
```

### src/payment-orders/payment-orders.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { isForeignKeyError } from '../common/prisma-errors.js';
import { FinancialTotalsRepository } from '../financial-totals/financial-totals.repository.js';
import { OperationsRepository } from '../operations/operations.repository.js';
import { OrderEventsRepository } from '../order-events/order-events.repository.js';
import {
  CreatePaymentOrderInput,
  PaymentOrderWithWorker,
  PaymentOrdersRepository,
} from './payment-orders.repository.js';

export interface PaymentOrderDto {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

/**
 * Simulated write path for payment orders. The order write and the read-model
 * maintenance hooks commit in ONE transaction, so operators see their own
 * writes on the very next request.
 */
@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly orders: PaymentOrdersRepository,
    private readonly events: OrderEventsRepository,
    private readonly operations: OperationsRepository,
    private readonly totals: FinancialTotalsRepository,
  ) {}

  create(input: CreatePaymentOrderInput): Promise<PaymentOrderDto> {
    return this.orders.withTransaction(async (tx) => {
      let order: PaymentOrderWithWorker;
      try {
        order = await this.orders.createInTx(tx, input);
      } catch (error) {
        if (isForeignKeyError(error)) {
          throw new ApiError('resource_not_found', `Worker ${input.workerId} was not found.`, 404, {
            worker_id: input.workerId,
          });
        }
        throw error;
      }
      if (order.workerCompanyId !== input.companyId) {
        throw new ApiError('validation_failed', 'Worker belongs to a different company than the order.', 400, {
          company_id: input.companyId,
          worker_id: input.workerId,
        });
      }
      // Maintenance hooks: projection row + exact totals, same transaction as the write.
      await this.operations.upsertOperation(tx, {
        id: order.id,
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: order.workerName,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        lastEventAt: order.createdAt,
      });
      await this.totals.applyStatusTransition(tx, {
        companyId: order.companyId,
        fromStatus: null,
        toStatus: order.status,
        amount: order.amount,
      });
      return toDto(order);
    });
  }

  changeStatus(id: string, toStatus: OrderStatus): Promise<PaymentOrderDto> {
    return this.orders.withTransaction(async (tx) => {
      const { order, previousStatus } = await this.orders.changeStatusInTx(tx, id, toStatus);
      if (previousStatus === null) return toDto(order); // idempotent no-op, hooks skipped
      const now = new Date();
      // Record the transition as an event: it is the order's new activity and
      // makes the re-derivation window able to reach this order later.
      await this.events.createInTx(tx, { orderId: id, type: `status:${toStatus}`, occurredAt: now });
      // Maintenance hooks: projection row + exact totals, same transaction as the write.
      await this.operations.upsertOperation(tx, {
        id: order.id,
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: order.workerName,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        lastEventAt: now,
      });
      await this.totals.applyStatusTransition(tx, {
        companyId: order.companyId,
        fromStatus: previousStatus,
        toStatus,
        amount: order.amount,
      });
      return toDto(order);
    });
  }
}

function toDto(order: PaymentOrderWithWorker): PaymentOrderDto {
  return {
    id: order.id,
    company_id: order.companyId,
    worker_id: order.workerId,
    worker_name: order.workerName,
    status: order.status,
    amount: order.amount.toFixed(4),
    currency: order.currency,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
  };
}
```

### src/payment-orders/payment-orders.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreatePaymentOrderInput {
  companyId: string;
  workerId: string;
  amount: Prisma.Decimal;
  currency: string;
}

export interface PaymentOrderWithWorker {
  id: string;
  companyId: string;
  workerId: string;
  amount: Prisma.Decimal;
  currency: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  workerName: string;
  workerCompanyId: string;
}

export interface StatusChangeResult {
  order: PaymentOrderWithWorker;
  /** null when the order was already in the requested status (no-op). */
  previousStatus: OrderStatus | null;
}

const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([OrderStatus.VOID, OrderStatus.REFUNDED]);

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
  }

  async createInTx(tx: Prisma.TransactionClient, input: CreatePaymentOrderInput): Promise<PaymentOrderWithWorker> {
    const order = await tx.paymentOrder.create({
      data: {
        companyId: input.companyId,
        workerId: input.workerId,
        amount: input.amount,
        currency: input.currency,
      },
      include: { worker: { select: { name: true, companyId: true } } },
    });
    return toRow(order);
  }

  async changeStatusInTx(tx: Prisma.TransactionClient, id: string, toStatus: OrderStatus): Promise<StatusChangeResult> {
    const current = await tx.paymentOrder.findUnique({
      where: { id },
      include: { worker: { select: { name: true, companyId: true } } },
    });
    if (!current) {
      throw new ApiError('resource_not_found', `Payment order ${id} was not found.`, 404, { id });
    }
    if (current.status === toStatus) {
      return { order: toRow(current), previousStatus: null };
    }
    if (TERMINAL_STATUSES.has(current.status)) {
      throw new ApiError(
        'invalid_status_transition',
        `Payment order ${id} is ${current.status}; it cannot move to ${toStatus}.`,
        409,
        { id, from: current.status, to: toStatus },
      );
    }
    const updated = await tx.paymentOrder.update({ where: { id }, data: { status: toStatus } });
    return { order: toRow({ ...updated, worker: current.worker }), previousStatus: current.status };
  }
}

function toRow(order: {
  id: string;
  companyId: string;
  workerId: string;
  amount: Prisma.Decimal;
  currency: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  worker: { name: string; companyId: string };
}): PaymentOrderWithWorker {
  return {
    id: order.id,
    companyId: order.companyId,
    workerId: order.workerId,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    workerName: order.worker.name,
    workerCompanyId: order.worker.companyId,
  };
}
```

### src/financial-totals/financial-totals.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FinancialTotalsController } from './financial-totals.controller.js';
import { FinancialTotalsRepository } from './financial-totals.repository.js';
import { FinancialTotalsService } from './financial-totals.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [FinancialTotalsController],
  providers: [FinancialTotalsService, FinancialTotalsRepository],
  exports: [FinancialTotalsRepository, FinancialTotalsService],
})
export class FinancialTotalsModule {}
```

### src/financial-totals/financial-totals.controller.ts
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { isUuid } from '../common/validation.js';
import { FinancialTotalsService } from './financial-totals.service.js';

@Controller('financial-totals')
export class FinancialTotalsController {
  constructor(private readonly service: FinancialTotalsService) {}

  @Get()
  forCompany(@Query('company_id') companyId: string | undefined) {
    if (!isUuid(companyId)) {
      throw new ApiError('validation_failed', 'Query parameters failed validation.', 400, {
        fields: { company_id: 'must be a UUID' },
      });
    }
    return this.service.forCompany(companyId);
  }
}
```

### src/financial-totals/financial-totals.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { FinancialTotalsRepository } from './financial-totals.repository.js';

export interface FinancialStatusTotalDto {
  status: OrderStatus;
  order_count: number;
  total_amount: string;
}

export interface FinancialTotalsDto {
  company_id: string;
  by_status: FinancialStatusTotalDto[];
  total: { order_count: number; total_amount: string };
}

@Injectable()
export class FinancialTotalsService {
  constructor(private readonly totals: FinancialTotalsRepository) {}

  /**
   * Financial totals for one company. The per-status rows are exact aggregates
   * maintained transactionally by the write hooks; the grand total below is an
   * exact decimal sum — never an approximation.
   */
  async forCompany(companyId: string): Promise<FinancialTotalsDto> {
    const rows = await this.totals.findByCompany(companyId);
    const totalAmount = rows.reduce((acc, row) => acc.plus(row.totalAmount), new Prisma.Decimal(0));
    const orderCount = rows.reduce((acc, row) => acc + row.orderCount, 0);
    return {
      company_id: companyId,
      by_status: rows.map(row => ({
        status: row.status,
        order_count: row.orderCount,
        total_amount: row.totalAmount.toFixed(4),
      })),
      total: {
        order_count: orderCount,
        total_amount: totalAmount.toFixed(4),
      },
    };
  }
}
```

### src/financial-totals/financial-totals.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { CompanyFinancialTotal, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface StatusTransition {
  companyId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  amount: Prisma.Decimal;
}

export interface TotalRowInput {
  companyId: string;
  status: OrderStatus;
  orderCount: number;
  totalAmount: Prisma.Decimal;
}

@Injectable()
export class FinancialTotalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Maintenance hook: apply the exact deltas of a status transition.
   * Each delta is a single INSERT ... ON CONFLICT DO UPDATE with an `increment`,
   * so concurrent writers serialize on the (company_id, status) row and the
   * aggregate stays exact under any interleaving.
   */
  async applyStatusTransition(tx: Prisma.TransactionClient, transition: StatusTransition): Promise<void> {
    if (transition.fromStatus !== null && transition.fromStatus !== transition.toStatus) {
      await this.applyDelta(tx, transition.companyId, transition.fromStatus, -1, transition.amount.neg());
    }
    await this.applyDelta(tx, transition.companyId, transition.toStatus, 1, transition.amount);
  }

  findByCompany(companyId: string): Promise<CompanyFinancialTotal[]> {
    return this.prisma.companyFinancialTotal.findMany({
      where: { companyId },
      orderBy: { status: 'asc' },
    });
  }

  /** Re-derivation: replace the rows of the given companies with exact source-derived values. */
  async replaceForCompanies(tx: Prisma.TransactionClient, companyIds: string[], rows: TotalRowInput[]): Promise<void> {
    if (companyIds.length === 0) return;
    await tx.companyFinancialTotal.deleteMany({ where: { companyId: { in: companyIds } } });
    if (rows.length > 0) {
      await tx.companyFinancialTotal.createMany({ data: rows });
    }
  }

  private async applyDelta(
    tx: Prisma.TransactionClient,
    companyId: string,
    status: OrderStatus,
    countDelta: number,
    amountDelta: Prisma.Decimal,
  ): Promise<void> {
    await tx.companyFinancialTotal.upsert({
      where: { companyId_status: { companyId, status } },
      create: { companyId, status, orderCount: countDelta, totalAmount: amountDelta },
      update: {
        orderCount: { increment: countDelta },
        totalAmount: { increment: amountDelta },
      },
    });
  }
}
```

### src/drift-repair/drift-repair.module.ts
```ts
import { Module } from '@nestjs/common';
import { FinancialTotalsModule } from '../financial-totals/financial-totals.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DriftRepairProcessor } from './drift-repair.processor.js';
import { DriftRepairRepository } from './drift-repair.repository.js';
import { DriftRepairService } from './drift-repair.service.js';

@Module({
  imports: [PrismaModule, OperationsModule, FinancialTotalsModule],
  providers: [DriftRepairRepository, DriftRepairService, DriftRepairProcessor],
  exports: [DriftRepairService],
})
export class DriftRepairModule {}
```

### src/drift-repair/drift-repair.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { Operation, OrderStatus, Prisma } from '@prisma/client';
import { FinancialTotalsRepository } from '../financial-totals/financial-totals.repository.js';
import { OperationRow, OperationsRepository } from '../operations/operations.repository.js';
import { DriftRepairRepository } from './drift-repair.repository.js';

export interface DriftRepairReport {
  from: string;
  to: string;
  ordersInWindow: number;
  companiesRebuilt: number;
  operationsCorrected: number;
  totalsCorrected: number;
  driftDetected: boolean;
}

@Injectable()
export class DriftRepairService {
  constructor(
    private readonly repository: DriftRepairRepository,
    private readonly operations: OperationsRepository,
    private readonly totals: FinancialTotalsRepository,
  ) {}

  /**
   * Re-derives the projection for an arbitrary window [from, to): every order
   * created in the window, or with an event occurring in the window, gets its
   * row rebuilt from the source of truth, and the financial totals of the
   * affected companies are recomputed in full. Idempotent — safe to overlap
   * and to run twice; reports what was actually corrected.
   */
  rederive(from: Date, to: Date): Promise<DriftRepairReport> {
    return this.repository.withTransaction(async (tx) => {
      const orders = await this.repository.sourceOrdersInWindow(tx, from, to);
      const orderIds = orders.map(order => order.id);
      const companyIds = [...new Set(orders.map(order => order.companyId))];

      const currentOperations = await this.repository.projectionOperations(tx, orderIds);
      const currentTotals = await this.repository.projectionTotals(tx, companyIds);
      const currentOperationById = new Map(currentOperations.map(row => [row.id, row]));
      const currentTotalByKey = new Map(currentTotals.map(row => [totalKey(row.companyId, row.status), row]));

      let operationsCorrected = 0;
      for (const order of orders) {
        const row: OperationRow = {
          id: order.id,
          companyId: order.companyId,
          workerId: order.workerId,
          workerName: order.worker.name,
          status: order.status,
          amount: order.amount,
          currency: order.currency,
          lastEventAt: lastActivityAt(order.createdAt, order.events.map(event => event.occurredAt)),
        };
        const before = currentOperationById.get(order.id);
        if (!before || !operationRowMatches(before, row)) {
          operationsCorrected += 1;
        }
        await this.operations.upsertOperation(tx, row);
      }

      const expectedTotals = await this.repository.sourceTotalsByCompany(tx, companyIds);
      const expectedTotalByKey = new Map(expectedTotals.map(row => [totalKey(row.companyId, row.status), row]));
      let totalsCorrected = 0;
      const allKeys = new Set([...currentTotalByKey.keys(), ...expectedTotalByKey.keys()]);
      for (const key of allKeys) {
        const current = currentTotalByKey.get(key);
        const expected = expectedTotalByKey.get(key);
        const currentCount = current?.orderCount ?? 0;
        const expectedCount = expected?.orderCount ?? 0;
        const currentAmount = current?.totalAmount ?? new Prisma.Decimal(0);
        const expectedAmount = expected?.totalAmount ?? new Prisma.Decimal(0);
        if (currentCount !== expectedCount || !currentAmount.equals(expectedAmount)) {
          totalsCorrected += 1;
        }
      }
      await this.totals.replaceForCompanies(tx, companyIds, expectedTotals);

      return {
        from: from.toISOString(),
        to: to.toISOString(),
        ordersInWindow: orders.length,
        companiesRebuilt: companyIds.length,
        operationsCorrected,
        totalsCorrected,
        driftDetected: operationsCorrected > 0 || totalsCorrected > 0,
      };
    });
  }
}

function totalKey(companyId: string, status: OrderStatus): string {
  return `${companyId}|${status}`;
}

/** Recency key = creation time or the latest event, whichever is later. */
function lastActivityAt(createdAt: Date, eventTimes: Date[]): Date {
  return eventTimes.reduce((latest, time) => (time > latest ? time : latest), createdAt);
}

function operationRowMatches(row: Operation, expected: OperationRow): boolean {
  return (
    row.companyId === expected.companyId &&
    row.workerId === expected.workerId &&
    row.workerName === expected.workerName &&
    row.status === expected.status &&
    row.amount.equals(expected.amount) &&
    row.currency === expected.currency &&
    row.lastEventAt.getTime() === expected.lastEventAt.getTime()
  );
}
```

### src/drift-repair/drift-repair.processor.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DriftRepairService } from './drift-repair.service.js';

/**
 * Scheduled drift repair. Re-derives the most recent window on a fixed
 * interval; windows overlap on purpose because the re-derivation is idempotent.
 */
@Injectable()
export class DriftRepairProcessor {
  private readonly logger = new Logger(DriftRepairProcessor.name);
  private running = false;

  constructor(private readonly repair: DriftRepairService) {}

  @Interval(() => {
    const configured = Number(process.env.DRIFT_REPAIR_INTERVAL_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : 900_000; // default 15 min
  })
  async runScheduledRepair(): Promise<void> {
    if (this.running) return; // never overlap with itself
    this.running = true;
    try {
      const configuredWindow = Number(process.env.DRIFT_REPAIR_WINDOW_MINUTES);
      const windowMinutes = Number.isFinite(configuredWindow) && configuredWindow > 0 ? configuredWindow : 30;
      const to = new Date();
      const from = new Date(to.getTime() - windowMinutes * 60_000);
      const report = await this.repair.rederive(from, to);
      this.logger.log(
        `drift repair [${report.from}, ${report.to}): orders=${report.ordersInWindow} ` +
          `operations_corrected=${report.operationsCorrected} totals_corrected=${report.totalsCorrected}`,
      );
    } catch (error) {
      this.logger.error(`drift repair failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
```

### src/drift-repair/drift-repair.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SourceTotalRow {
  companyId: string;
  status: OrderStatus;
  orderCount: number;
  totalAmount: Prisma.Decimal;
}

@Injectable()
export class DriftRepairRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 120_000, maxWait: 10_000 });
  }

  /**
   * Source of truth for a window: every order created in [from, to), or with an
   * event occurring in [from, to), with its worker name and all event times.
   */
  async sourceOrdersInWindow(tx: Prisma.TransactionClient, from: Date, to: Date) {
    return tx.paymentOrder.findMany({
      where: {
        OR: [
          { createdAt: { gte: from, lt: to } },
          { events: { some: { occurredAt: { gte: from, lt: to } } } },
        ],
      },
      include: {
        worker: { select: { name: true } },
        events: { select: { occurredAt: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Exact per (company, status) aggregates straight from the source orders. */
  async sourceTotalsByCompany(tx: Prisma.TransactionClient, companyIds: string[]): Promise<SourceTotalRow[]> {
    if (companyIds.length === 0) return [];
    const groups = await tx.paymentOrder.groupBy({
      by: ['companyId', 'status'],
      where: { companyId: { in: companyIds } },
      _count: { _all: true },
      _sum: { amount: true },
    });
    return groups.map(group => ({
      companyId: group.companyId,
      status: group.status,
      orderCount: group._count._all,
      totalAmount: group._sum.amount ?? new Prisma.Decimal(0),
    }));
  }

  async projectionOperations(tx: Prisma.TransactionClient, orderIds: string[]) {
    if (orderIds.length === 0) return [];
    return tx.operation.findMany({ where: { id: { in: orderIds } } });
  }

  async projectionTotals(tx: Prisma.TransactionClient, companyIds: string[]) {
    if (companyIds.length === 0) return [];
    return tx.companyFinancialTotal.findMany({ where: { companyId: { in: companyIds } } });
  }
}
```

### test/helpers.ts
```ts
// ASSUMPTION: DATABASE_URL points to a dedicated Postgres test database
// (the only environment configuration the tests rely on).
import { DriftRepairRepository } from '../src/drift-repair/drift-repair.repository.js';
import { DriftRepairService } from '../src/drift-repair/drift-repair.service.js';
import { FinancialTotalsRepository } from '../src/financial-totals/financial-totals.repository.js';
import { FinancialTotalsService } from '../src/financial-totals/financial-totals.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { OrderEventsRepository } from '../src/order-events/order-events.repository.js';
import { OrderEventsService } from '../src/order-events/order-events.service.js';
import { PaymentOrdersRepository } from '../src/payment-orders/payment-orders.repository.js';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export interface Services {
  prisma: PrismaService;
  paymentOrdersService: PaymentOrdersService;
  orderEventsService: OrderEventsService;
  operationsService: OperationsService;
  financialTotalsService: FinancialTotalsService;
  driftRepairService: DriftRepairService;
}

export function createPrisma(): PrismaService {
  return new PrismaService();
}

export function buildServices(prisma: PrismaService): Services {
  const operationsRepository = new OperationsRepository(prisma);
  const totalsRepository = new FinancialTotalsRepository(prisma);
  const eventsRepository = new OrderEventsRepository(prisma);
  const ordersRepository = new PaymentOrdersRepository(prisma);
  const driftRepairRepository = new DriftRepairRepository(prisma);
  return {
    prisma,
    paymentOrdersService: new PaymentOrdersService(
      ordersRepository,
      eventsRepository,
      operationsRepository,
      totalsRepository,
    ),
    orderEventsService: new OrderEventsService(eventsRepository, operationsRepository),
    operationsService: new OperationsService(operationsRepository),
    financialTotalsService: new FinancialTotalsService(totalsRepository),
    driftRepairService: new DriftRepairService(driftRepairRepository, operationsRepository, totalsRepository),
  };
}

/** Delete in FK-safe order so each test starts from an empty database. */
export async function cleanAllTables(prisma: PrismaService): Promise<void> {
  await prisma.orderEvent.deleteMany({});
  await prisma.operation.deleteMany({});
  await prisma.companyFinancialTotal.deleteMany({});
  await prisma.paymentOrder.deleteMany({});
  await prisma.worker.deleteMany({});
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### test/operations.spec.ts
```ts
import { OrderStatus, Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServices, cleanAllTables, createPrisma, Services } from './helpers.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';

describe('operations dashboard — read-your-own-writes', () => {
  const services: Services = buildServices(createPrisma());

  beforeAll(async () => {
    await services.prisma.$connect();
  });
  afterEach(async () => {
    await cleanAllTables(services.prisma);
  });
  afterAll(async () => {
    await services.prisma.$disconnect();
  });

  async function seedWorker(name: string) {
    return services.prisma.worker.create({ data: { companyId: COMPANY, name } });
  }

  it('shows a new order on the very next dashboard request', async () => {
    const worker = await seedWorker('Ada Lovelace');
    const created = await services.paymentOrdersService.create({
      companyId: COMPANY,
      workerId: worker.id,
      amount: new Prisma.Decimal('42.50'),
      currency: 'USD',
    });

    const page = await services.operationsService.list({ companyId: COMPANY, page: 1, pageSize: 50 });

    expect(page.total_count).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: created.id,
      company_id: COMPANY,
      worker_id: worker.id,
      worker_name: 'Ada Lovelace',
      status: OrderStatus.PENDING,
      amount: '42.5000',
      currency: 'USD',
    });

    // The exact per-company total reflects the write immediately as well.
    const totals = await services.financialTotalsService.forCompany(COMPANY);
    expect(totals.total).toEqual({ order_count: 1, total_amount: '42.5000' });
    expect(totals.by_status).toContainEqual({ status: OrderStatus.PENDING, order_count: 1, total_amount: '42.5000' });
  }, 60_000);

  it('reflects an approval immediately in the list and in the exact company totals', async () => {
    const worker = await seedWorker('Grace Hopper');
    const first = await services.paymentOrdersService.create({
      companyId: COMPANY,
      workerId: worker.id,
      amount: new Prisma.Decimal('10.00'),
      currency: 'USD',
    });
    const second = await services.paymentOrdersService.create({
      companyId: COMPANY,
      workerId: worker.id,
      amount: new Prisma.Decimal('20.00'),
      currency: 'USD',
    });
    await sleep(5);

    await services.paymentOrdersService.changeStatus(first.id, OrderStatus.CAPTURED);

    const page = await services.operationsService.list({ companyId: COMPANY, page: 1, pageSize: 50 });
    // The approved order is the most recent activity and sorts first.
    expect(page.items.map(item => item.id)).toEqual([first.id, second.id]);
    expect(page.items[0].status).toBe(OrderStatus.CAPTURED);
    expect(page.items[1].status).toBe(OrderStatus.PENDING);

    const totals = await services.financialTotalsService.forCompany(COMPANY);
    expect(totals.total).toEqual({ order_count: 2, total_amount: '30.0000' });
    expect(totals.by_status).toContainEqual({ status: OrderStatus.CAPTURED, order_count: 1, total_amount: '10.0000' });
    expect(totals.by_status).toContainEqual({ status: OrderStatus.PENDING, order_count: 1, total_amount: '20.0000' });
  }, 60_000);

  it('reorders the list by event recency as soon as an event is recorded', async () => {
    const worker = await seedWorker('Alan Turing');
    const first = await services.paymentOrdersService.create({
      companyId: COMPANY,
      workerId: worker.id,
      amount: new Prisma.Decimal('5.00'),
      currency: 'USD',
    });
    await sleep(20);
    const second = await services.paymentOrdersService.create({
      companyId: COMPANY,
      workerId: worker.id,
      amount: new Prisma.Decimal('6.00'),
      currency: 'USD',
    });
    await sleep(5);

    // A late event on the older order moves it to the front on the next request.
    await services.orderEventsService.record({
      orderId: first.id,
      type: 'callback:success',
      occurredAt: new Date(),
    });

    const page = await services.operationsService.list({ companyId: COMPANY, page: 1, pageSize: 50 });
    expect(page.items.map(item => item.id)).toEqual([first.id, second.id]);
  }, 60_000);

  it('reports unknown orders with the resource_not_found error contract', async () => {
    const missing = '99999999-9999-4999-8999-999999999999';
    await expect(services.paymentOrdersService.changeStatus(missing, OrderStatus.CAPTURED)).rejects.toMatchObject({
      code: 'resource_not_found',
      httpStatus: 404,
    });
  }, 60_000);
});
```

### test/concurrency.spec.ts
```ts
import { OrderStatus, Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServices, cleanAllTables, createPrisma, Services } from './helpers.js';

const COMPANY = '22222222-2222-4222-8222-222222222222';

describe('concurrent updates to one company totals', () => {
  const services: Services = buildServices(createPrisma());

  beforeAll(async () => {
    await services.prisma.$connect();
  });
  afterEach(async () => {
    await cleanAllTables(services.prisma);
  });
  afterAll(async () => {
    await services.prisma.$disconnect();
  });

  it('keeps company totals exact when many orders are approved in parallel', async () => {
    const worker = await services.prisma.worker.create({
      data: { companyId: COMPANY, name: 'Katherine Johnson' },
    });

    const orders = [];
    for (let i = 1; i <= 16; i++) {
      orders.push(
        await services.paymentOrdersService.create({
          companyId: COMPANY,
          workerId: worker.id,
          amount: new Prisma.Decimal(`${i * 7}.25`),
          currency: 'USD',
        }),
      );
    }
    const expectedTotal = orders.reduce(
      (sum, order) => sum.plus(new Prisma.Decimal(order.amount)),
      new Prisma.Decimal(0),
    );

    // 16 parallel transitions all hit the same two (company, status) total rows.
    await Promise.all(orders.map(order => services.paymentOrdersService.changeStatus(order.id, OrderStatus.CAPTURED)));

    const totals = await services.financialTotalsService.forCompany(COMPANY);
    expect(totals.total.order_count).toBe(16);
    expect(totals.total.total_amount).toBe(expectedTotal.toFixed(4));
    expect(totals.by_status).toContainEqual({
      status: OrderStatus.CAPTURED,
      order_count: 16,
      total_amount: expectedTotal.toFixed(4),
    });
    const pending = totals.by_status.find(row => row.status === OrderStatus.PENDING);
    expect(pending?.order_count ?? 0).toBe(0);
    expect(pending?.total_amount ?? '0.0000').toBe('0.0000');

    // The projection rows agree with the totals: every order is CAPTURED.
    const page = await services.operationsService.list({ companyId: COMPANY, page: 1, pageSize: 100 });
    expect(page.total_count).toBe(16);
    expect(page.items.every(item => item.status === OrderStatus.CAPTURED)).toBe(true);
  }, 120_000);
});
```

### test/drift-repair.spec.ts
```ts
import { OrderStatus, Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServices, cleanAllTables, createPrisma, Services } from './helpers.js';

const COMPANY_IN = '33333333-3333-4333-8333-333333333333';
const COMPANY_OUT = '44444444-4444-4444-8444-444444444444';

describe('drift repair and windowed re-derivation', () => {
  const services: Services = buildServices(createPrisma());

  beforeAll(async () => {
    await services.prisma.$connect();
  });
  afterEach(async () => {
    await cleanAllTables(services.prisma);
  });
  afterAll(async () => {
    await services.prisma.$disconnect();
  });

  it('repairs only the projection inside the window, exactly, and reports drift', async () => {
    const { prisma, paymentOrdersService, driftRepairService, financialTotalsService, operationsService } = services;

    const workerIn = await prisma.worker.create({ data: { companyId: COMPANY_IN, name: 'Mary Jackson' } });
    const workerOut = await prisma.worker.create({ data: { companyId: COMPANY_OUT, name: 'Chien-Shiung Wu' } });
    const oldCreated = new Date('2020-01-01T00:00:00.000Z');

    const first = await paymentOrdersService.create({
      companyId: COMPANY_IN,
      workerId: workerIn.id,
      amount: new Prisma.Decimal('100.00'),
      currency: 'USD',
    });
    const second = await paymentOrdersService.create({
      companyId: COMPANY_IN,
      workerId: workerIn.id,
      amount: new Prisma.Decimal('200.00'),
      currency: 'USD',
    });
    await paymentOrdersService.changeStatus(first.id, OrderStatus.CAPTURED);

    // A legacy order written before hooks existed: only in the source, no projection rows.
    const legacy = await prisma.paymentOrder.create({
      data: {
        companyId: COMPANY_OUT,
        workerId: workerOut.id,
        amount: new Prisma.Decimal('55.00'),
        currency: 'USD',
        status: OrderStatus.CAPTURED,
        createdAt: oldCreated,
      },
    });

    // Simulate drift: corrupt the projection rows the hooks wrote.
    await prisma.operation.update({
      where: { id: first.id },
      data: { status: OrderStatus.PENDING, amount: new Prisma.Decimal('1.00'), workerName: 'Corrupted' },
    });
    await prisma.companyFinancialTotal.update({
      where: { companyId_status: { companyId: COMPANY_IN, status: OrderStatus.CAPTURED } },
      data: { orderCount: 9, totalAmount: new Prisma.Decimal('1.23') },
    });

    const windowFrom = new Date(Date.now() - 60 * 60 * 1000);
    const windowTo = new Date(Date.now() + 60 * 60 * 1000);

    const report = await driftRepairService.rederive(windowFrom, windowTo);
    expect(report.ordersInWindow).toBe(2);
    expect(report.companiesRebuilt).toBe(1);
    expect(report.driftDetected).toBe(true);
    expect(report.operationsCorrected).toBe(1);
    expect(report.totalsCorrected).toBe(1);

    // The in-window projection is repaired exactly from the source of truth.
    const page = await operationsService.list({ companyId: COMPANY_IN, page: 1, pageSize: 50 });
    const firstRow = page.items.find(item => item.id === first.id);
    expect(firstRow).toMatchObject({
      status: OrderStatus.CAPTURED,
      amount: '100.0000',
      worker_name: 'Mary Jackson',
    });
    const totals = await financialTotalsService.forCompany(COMPANY_IN);
    expect(totals.total).toEqual({ order_count: 2, total_amount: '300.0000' });
    expect(totals.by_status).toContainEqual({ status: OrderStatus.CAPTURED, order_count: 1, total_amount: '100.0000' });
    expect(totals.by_status).toContainEqual({ status: OrderStatus.PENDING, order_count: 1, total_amount: '200.0000' });

    // Out of the window: the legacy order must not be touched by this run.
    expect(await prisma.operation.findUnique({ where: { id: legacy.id } })).toBeNull();
    expect(await prisma.companyFinancialTotal.count({ where: { companyId: COMPANY_OUT } })).toBe(0);

    // Idempotent: a second run over the same window finds no drift.
    const clean = await driftRepairService.rederive(windowFrom, windowTo);
    expect(clean.driftDetected).toBe(false);
    expect(clean.operationsCorrected).toBe(0);
    expect(clean.totalsCorrected).toBe(0);

    // A wider window pulls the legacy order into scope and repairs it from source.
    const wide = await driftRepairService.rederive(new Date('2019-01-01T00:00:00.000Z'), windowTo);
    expect(wide.driftDetected).toBe(true);
    expect(wide.ordersInWindow).toBe(3);
    expect(wide.companiesRebuilt).toBe(2);

    const legacyRow = await prisma.operation.findUnique({ where: { id: legacy.id } });
    expect(legacyRow).not.toBeNull();
    expect(legacyRow).toMatchObject({
      status: OrderStatus.CAPTURED,
      worker_name: 'Chien-Shiung Wu',
      worker_id: workerOut.id,
    });
    expect(legacyRow?.amount.toFixed(4)).toBe('55.0000');
    expect(legacyRow?.lastEventAt.toISOString()).toBe(oldCreated.toISOString());

    const legacyTotals = await financialTotalsService.forCompany(COMPANY_OUT);
    expect(legacyTotals.total).toEqual({ order_count: 1, total_amount: '55.0000' });
    expect(legacyTotals.by_status).toContainEqual({
      status: OrderStatus.CAPTURED,
      order_count: 1,
      total_amount: '55.0000',
    });
  }, 120_000);
});
```
