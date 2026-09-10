# repair1-set

## reasoning

```
Let me analyze the errors:

1. **`src/common/domain-exception.ts(8,14)`**: `DomainException` has a `status` property that conflicts with `HttpException`'s private `status`. The fix is to not declare `status` as a property on `DomainException` since `HttpException` already has it (as private). I should remove the `readonly status: number` declaration.

2. **`src/main.ts(2,10)`**: `Module '"@nestjs/common"' has no exported member 'NestFactory'`. The correct import is from `@nestjs/core`. So the import should be from `@nestjs/core`.

3. **`src/re-derivation/re-derivation.repository.ts(15,5)`** and **`(15,24)`**: Two issues:
   - The `$transaction` call with a function callback and `{ isolationLevel: 'serializable' }` — the isolation level should be `'Serializable'` (capital S) per Prisma's type.
   - The return type issue: when using the interactive transaction (function form), the callback receives a `Prisma.TransactionClient`, not `DbClient`. The error says `Type 'any[]' is not assignable to type 'Promise<T>'` — this suggests the overload resolution is picking the wrong overload (the array form) because the isolation level string is wrong.

   Actually, looking more carefully at the error:
   - Error at (15,5): `Type 'Promise<any[]>' is not assignable to type 'Promise<T>'` — this is the return type mismatch
   - Error at (15,24): `No overload matches this call` — this is the call itself

   The root cause is `'serializable'` should be `'Serializable'`. When the isolation level is wrong, TypeScript can't match the second overload (the function-based one) and falls through to the first overload (array-based), which expects an array, not a function.

   But wait, there's also the `DbClient` type being used as the parameter type. Let me look at what `DbClient` is. It's imported from `'../common/db-client.js'`. The Prisma transaction client type is `Prisma.TransactionClient`. If `DbClient` is defined as `Prisma.TransactionClient`, then it should be fine.

   Actually, looking at the error more carefully, the second overload says:
   ```
   '(fn: (prisma: Omit<PrismaClient<...>, "$on" | "$connect" | "$disconnect" | "$use" | "$transaction" | "$extends">) => Promise<...>, options?: { ...; } | undefined): Promise<...>'
   ```
   
   The parameter type is `Omit<PrismaClient<...>, ...>` which is what Prisma calls `TransactionClient`. If `DbClient` is typed as `Prisma.TransactionClient`, then the function `(tx: DbClient) => Promise<T>` should be assignable to `(prisma: Omit<...>) => Promise<...>`.

   So the fix is just changing `'serializable'` to `'Serializable'`. That should resolve both errors at line 15.

   Wait, but there might also be a type compatibility issue with `DbClient`. Let me think... The error message says "Type '(tx: TransactionClient) => Promise<T>' is not assignable to parameter of type 'PrismaPromise<any>[]'" for overload 1. For overload 2, it only complains about the isolation level. So if I fix the isolation level, overload 2 should match.

   But will the callback parameter type work? The callback is `(tx: DbClient) => Promise<T>`. The expected parameter is `Omit<PrismaClient<...>, ...>`. If `DbClient` is `Prisma.TransactionClient`, and `Prisma.TransactionClient` is defined as `Omit<PrismaClient<...>, ...>`, then it should work.

   So my fixes are:
   1. `src/common/domain-exception.ts`: Remove the `readonly status: number` property declaration (since `HttpException` already has it as private, we can't re-declare it as public).
   
   Actually wait — if I remove `status`, then `this.status = status` in the constructor will fail. Let me think about this differently.

   `HttpException` has a private `status` property. In TypeScript, you can't extend a class and expose a property with the same name if the base has it as private. The options are:
   - Remove the `status` property from `DomainException` and don't assign to `this.status` (it's already set by the base via the constructor argument)
   - Use a different property name

   Looking at `HttpException`'s constructor: `constructor(response: string | Record<string, any>, status: number)`. The `status` is stored privately in the base class.

   So in `DomainException`, I should remove `readonly status: number` and remove `this.status = status`. The base class already stores it. But then external code that accesses `exception.status` won't work... but that's the compiler error we need to fix.

   Actually, looking at `HttpException` more carefully in NestJS source — it has:
   ```
   private readonly status: number;
   ```
   
   And a getter:
   ```
   getStatus(): number { return this.status; }
   ```

   So the fix is to remove `readonly status: number` from `DomainException` and remove `this.status = status` from the constructor. The `status` is already available via `getStatus()`.

   But wait — is `status` used anywhere else in the codebase? The task says "Change exactly what the compiler requires." So I'll just remove the property declaration and the assignment.

   2. `src/main.ts`: Change import from `'@nestjs/common'` to `'@nestjs/core'` for `NestFactory`.

   3. `src/re-derivation/re-derivation.repository.ts`: Change `'serializable'` to `'Serializable'`.

Let me now write the complete files.

For `src/common/domain-exception.ts`:
```ts
import { HttpException } from '@nestjs/common';

export class DomainException extends HttpException {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.message = message;
    this.details = details;
  }
}
```

For `src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception-filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

For `src/re-derivation/re-derivation.repository.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '../common/db-client.js';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class ReDerivationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withSerializableTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: 'Serializable', timeout: 120_000 });
  }

  async deleteRowsInWindow(tx: DbClient, from: Date, to: Date): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "operation_read_model"
      WHERE "payment_order_id" IN (
        SELECT "id" FROM "payment_orders"
        WHERE "created_at" >= ${from} AND "created_at" <= ${to}
      )
    `;
  }

  async insertRowsFromSource(tx: DbClient, from: Date, to: Date): Promise<number> {
    const affected = await tx.$executeRaw`
      INSERT INTO "operation_read_model" (
        "payment_order_id", "company_id", "worker_id", "worker_name",
        "event_id", "event_name", "status", "amount_cents", "created_at", "updated_at"
      )
      SELECT o."id", o."company_id", o."worker_id", w."full_name",
             o."event_id", e."name", o."status", o."amount_cents", o."created_at", o."updated_at"
      FROM "payment_orders" o
      JOIN "workers" w ON w."id" = o."worker_id"
      JOIN "events" e ON e."id" = o."event_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
      ON CONFLICT ("payment_order_id") DO UPDATE SET
        "company_id" = EXCLUDED."company_id",
        "worker_id" = EXCLUDED."worker_id",
        "worker_name" = EXCLUDED."worker_name",
        "event_id" = EXCLUDED."event_id",
        "event_name" = EXCLUDED."event_name",
        "status" = EXCLUDED."status",
        "amount_cents" = EXCLUDED."amount_cents",
        "created_at" = EXCLUDED."created_at",
        "updated_at" = EXCLUDED."updated_at"
    `;
    return Number(affected);
  }

  async rebuildAllTotals(tx: DbClient): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "company_financial_totals"
    `;
    await tx.$executeRaw`
      INSERT INTO "company_financial_totals" (
        "company_id", "pending_amount_cents", "approved_amount_cents", "rejected_amount_cents", "orders_count"
      )
      SELECT "company_id",
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'pending'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'approved'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'rejected'), 0),
             COUNT(*)::int
      FROM "payment_orders"
      GROUP BY "company_id"
      ON CONFLICT ("company_id") DO UPDATE SET
        "pending_amount_cents" = EXCLUDED."pending_amount_cents",
        "approved_amount_cents" = EXCLUDED."approved_amount_cents",
        "rejected_amount_cents" = EXCLUDED."rejected_amount_cents",
        "orders_count" = EXCLUDED."orders_count"
    `;
  }
}
```

Wait, I need to double-check: does `HttpException` have a `status` getter? Let me recall NestJS source:

```ts
export class HttpException extends Error {
  private readonly response: string | Record<string, any>;
  private readonly status: number;
  private readonly options?: HttpExceptionOptions;
  private readonly description: string | undefined;

  constructor(private readonly response: string | Record<string, any>, status: number, description?: string) { ... }
  
  getResponse(): string | Record<string, any> { return this.response; }
  getStatus(): number { return this.status; }
  ...
}
```

Yes, `status` is private with a `getStatus()` method. So removing the `status` property from `DomainException` is correct. The base class already handles it.

Let me also check: does `HttpException`'s constructor accept `(response, status)`? Yes: `constructor(response: string | Record<string, any>, status: number, description?: string)`.

So my fix for `DomainException` is correct — just remove the `readonly status: number` line and `this.status = status;`.
```

## reply

### src/common/domain-exception.ts
```ts
import { HttpException } from '@nestjs/common';

/**
 * Domain errors carry the API-contract code (snake_case, stable). Known codes:
 * resource_not_found, validation_failed, invalid_state_transition, conflict,
 * internal_error.
 */
export class DomainException extends HttpException {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.message = message;
    this.details = details;
  }
}
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception-filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/re-derivation/re-derivation.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '../common/db-client.js';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class ReDerivationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * SERIALIZABLE so a concurrent writer cannot slip a commit between our
   * source read and our projection write without a detectable conflict; the
   * service retries on serialization failure.
   */
  withSerializableTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: 'Serializable', timeout: 120_000 });
  }

  async deleteRowsInWindow(tx: DbClient, from: Date, to: Date): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "operation_read_model"
      WHERE "payment_order_id" IN (
        SELECT "id" FROM "payment_orders"
        WHERE "created_at" >= ${from} AND "created_at" <= ${to}
      )
    `;
  }

  /** Re-creates the window's rows with the same joins the old dashboard query used. */
  async insertRowsFromSource(tx: DbClient, from: Date, to: Date): Promise<number> {
    const affected = await tx.$executeRaw`
      INSERT INTO "operation_read_model" (
        "payment_order_id", "company_id", "worker_id", "worker_name",
        "event_id", "event_name", "status", "amount_cents", "created_at", "updated_at"
      )
      SELECT o."id", o."company_id", o."worker_id", w."full_name",
             o."event_id", e."name", o."status", o."amount_cents", o."created_at", o."updated_at"
      FROM "payment_orders" o
      JOIN "workers" w ON w."id" = o."worker_id"
      JOIN "events" e ON e."id" = o."event_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
      ON CONFLICT ("payment_order_id") DO UPDATE SET
        "company_id" = EXCLUDED."company_id",
        "worker_id" = EXCLUDED."worker_id",
        "worker_name" = EXCLUDED."worker_name",
        "event_id" = EXCLUDED."event_id",
        "event_name" = EXCLUDED."event_name",
        "status" = EXCLUDED."status",
        "amount_cents" = EXCLUDED."amount_cents",
        "created_at" = EXCLUDED."created_at",
        "updated_at" = EXCLUDED."updated_at"
    `;
    return Number(affected);
  }

  /**
   * Whole-history rebuild of the per-company totals. The totals are global
   * aggregates, so only a full recompute (never a window delta) is
   * idempotent and exact.
   */
  async rebuildAllTotals(tx: DbClient): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "company_financial_totals"
    `;
    await tx.$executeRaw`
      INSERT INTO "company_financial_totals" (
        "company_id", "pending_amount_cents", "approved_amount_cents", "rejected_amount_cents", "orders_count"
      )
      SELECT "company_id",
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'pending'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'approved'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'rejected'), 0),
             COUNT(*)::int
      FROM "payment_orders"
      GROUP BY "company_id"
      ON CONFLICT ("company_id") DO UPDATE SET
        "pending_amount_cents" = EXCLUDED."pending_amount_cents",
        "approved_amount_cents" = EXCLUDED."approved_amount_cents",
        "rejected_amount_cents" = EXCLUDED."rejected_amount_cents",
        "orders_count" = EXCLUDED."orders_count"
    `;
  }
}
```
