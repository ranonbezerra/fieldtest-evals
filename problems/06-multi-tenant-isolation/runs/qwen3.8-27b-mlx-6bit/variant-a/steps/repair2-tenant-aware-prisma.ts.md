# repair2-tenant-aware-prisma.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/db/tenant-aware-prisma.ts`:

1. `src/db/tenant-aware-prisma.ts(69,62): error TS2577: Return type annotation circularly references itself.`
2. `src/db/tenant-aware-prisma.ts(86,13): error TS2456: Type alias 'TenantAwarePrisma' circularly references itself.`

These are the only errors in this file. The issue is with the type alias:

```ts
export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```

This is circular because `createTenantAwareClient` returns `TenantAwarePrisma` (or references it in its signature), which references `ReturnType<typeof createTenantAwareClient>`, creating a cycle.

Looking at the plan:
```ts
export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma;
export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```

The plan defines `createTenantAwareClient` to return `TenantAwarePrisma`, and then `TenantAwarePrisma` as `ReturnType<typeof createTenantAwareClient>`. That's a circular reference.

The fix: I need to break the cycle. The simplest approach is to define `TenantAwarePrisma` as an interface that extends `PrismaClient` (or is structurally compatible with it), and then have `createTenantAwareClient` return that type.

Actually, looking more carefully at how Prisma extensions work: `prisma.$extends()` returns a new client type. The extension-based approach in Prisma uses `$extends` which returns a new typed client. But the plan says "extension/middleware" and shows `createTenantAwareClient(base: PrismaClient): TenantAwarePrisma`.

The cleanest fix is to define `TenantAwarePrisma` as an interface that extends `PrismaClient` (since the extension just wraps the client with a guard, the public API surface is the same). Or we could use `PrismaClient` directly as the return type and drop the alias, but the plan specifies the alias.

Wait, let me reconsider. The plan says:
```ts
export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma;
export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```

The circular reference is because `createTenantAwareClient`'s return type is `TenantAwarePrisma`, and `TenantAwarePrisma` is defined as `ReturnType<typeof createTenantAwareClient>`.

The fix: Define `TenantAwarePrisma` independently. Since the extension just adds a guard (it doesn't change the public API), `TenantAwarePrisma` can simply be `PrismaClient` or an interface extending it.

Actually, looking at how Prisma `$extends` works - when you call `prisma.$extends()`, it returns a new instance with the same model properties. The type is typically `PrismaClient` or a more specific type.

The simplest fix that preserves the plan's intent:

```ts
export interface TenantAwarePrisma extends PrismaClient {}
```

Then `createTenantAwareClient(base: PrismaClient): TenantAwarePrisma` works, and `TenantAwarePrisma` is no longer circular.

But wait - does the plan's `prisma.service.ts` do `this.scoped = createTenantAwareClient(this)` and then access `prisma.scoped.customer`? If `TenantAwarePrisma extends PrismaClient`, then it has all the model properties, so that works.

Let me write the complete file now. I need to look at what the file should contain based on the plan:

- `TENANT_SCOPED_MODELS` - a ReadonlySet of model names
- `TenantGuardArgs` interface
- `tenantQueryGuard` function
- `createTenantAwareClient` function
- `TenantAwarePrisma` type

The guard behavior from the plan:
- Non-scoped models: pass through unchanged
- Scoped model with no tenant in ALS: throw `AppException.tenantContextMissing()`
- Reads (findMany, findFirst, findUnique, count, aggregate, groupBy): inject `tenantId` into `args.where`
- Scope-by-id writes (update, updateMany, upsert, delete, deleteMany): inject `tenantId` into `args.where`; for upsert also stamp `create.tenantId`
- Create writes (create, createMany): stamp `data.tenantId`

Let me write the complete file:

```ts
import type { PrismaClient, Prisma } from '@prisma/client';
import { AppException } from '../errors/app-exception';
import { currentTenant } from '../tenant/tenant-context';

export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(['Customer', 'Plan', 'Order']);

export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}

const READ_ACTIONS = new Set([
  'findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy',
]);
const SCOPE_BY_ID_ACTIONS = new Set([
  'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
]);
const CREATE_ACTIONS = new Set([
  'create', 'createMany',
]);

export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T> {
  if (!TENANT_SCOPED_MODELS.has(model.modelName)) {
    return query(args);
  }

  const ctx = currentTenant();
  if (!ctx) {
    throw AppException.tenantContextMissing();
  }

  const tenantId = ctx.tenantId;

  if (READ_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId };
  } else if (SCOPE_BY_ID_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId };
    if (action === 'upsert') {
      const upsertArgs = args as unknown as { create: Record<string, unknown> };
      upsertArgs.create = { ...upsertArgs.create, tenantId };
    }
  } else if (CREATE_ACTIONS.has(action)) {
    if (action === 'createMany') {
      const data = args.data as ReadonlyArray<Record<string, unknown>>;
      args.data = data.map((item) => ({ ...item, tenantId }));
    } else {
      const data = args.data as Record<string, unknown>;
      args.data = { ...data, tenantId };
    }
  }

  return query(args);
}

export interface TenantAwarePrisma extends PrismaClient {}

export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ action, args, query, model }) {
          return tenantQueryGuard(
            action,
            args as TenantGuardArgs,
            (a) => query(a as TenantGuardArgs),
            model,
          );
        },
      },
    },
  }) as unknown as TenantAwarePrisma;
}
```

Wait, I need to think about the `$extends` API more carefully. In Prisma, when you use `$extends`, the `model` parameter in the query extension has a `modelName` property. The `query` callback receives `{ action, args, query, model }` where `model` has `modelName`.

Actually, let me check the Prisma extension API. The `$allModels` extension gives you:
```
{ action, args, query, model }
```
where `model` is `{ modelName: string }`.

And the `query` function you call to proceed takes the (possibly modified) args.

This looks correct. Let me also make sure the `TenantAwarePrisma extends PrismaClient` approach works. Since `PrismaClient` is a class, extending it as an interface should give us all the model properties. The `as unknown as TenantAwarePrisma` cast handles the fact that `$extends` returns a slightly different type.

Actually, I realize there might be an issue. `PrismaClient` is a class, and `interface TenantAwarePrisma extends PrismaClient {}` should work in TypeScript - you can extend a class type with an interface. This gives us all the properties/methods of `PrismaClient`.

Let me verify this won't cause issues with the `prisma.service.ts` which does:
```ts
this.scoped = createTenantAwareClient(this);
```

And then repositories do:
```ts
this.prisma.scoped.customer.findMany()
```

Since `TenantAwarePrisma extends PrismaClient`, it has `.customer` and all other model delegates. Good.

Now let me also double-check: the plan says the guard should handle `findUnique` in reads. But wait - the plan also says "Lookups use findFirst, not findUnique, by scalar id" in the assumptions. However, the guard should still handle `findUnique` for completeness (the plan lists it in the reads table). The guard should work regardless of which method the repository uses.

I think my solution is correct. Let me finalize it.
```

## reply

```ts
import type { PrismaClient } from '@prisma/client';
import { AppException } from '../errors/app-exception';
import { currentTenant } from '../tenant/tenant-context';

export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(['Customer', 'Plan', 'Order']);

export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}

const READ_ACTIONS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'aggregate',
  'groupBy',
]);

const SCOPE_BY_ID_ACTIONS = new Set([
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

const CREATE_ACTIONS = new Set(['create', 'createMany']);

export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T> {
  if (!TENANT_SCOPED_MODELS.has(model.modelName)) {
    return query(args);
  }

  const ctx = currentTenant();
  if (!ctx) {
    throw AppException.tenantContextMissing();
  }

  const tenantId = ctx.tenantId;

  if (READ_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId };
  } else if (SCOPE_BY_ID_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId };
    if (action === 'upsert') {
      const upsertArgs = args as unknown as { create: Record<string, unknown> };
      upsertArgs.create = { ...upsertArgs.create, tenantId };
    }
  } else if (CREATE_ACTIONS.has(action)) {
    if (action === 'createMany') {
      const data = args.data as ReadonlyArray<Record<string, unknown>>;
      args.data = data.map((item) => ({ ...item, tenantId }));
    } else {
      const data = args.data as Record<string, unknown>;
      args.data = { ...data, tenantId };
    }
  }

  return query(args);
}

export interface TenantAwarePrisma extends PrismaClient {}

export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ action, args, query, model }) {
          return tenantQueryGuard(
            action,
            args as TenantGuardArgs,
            (a) => query(a as TenantGuardArgs),
            model,
          );
        },
      },
    },
  }) as unknown as TenantAwarePrisma;
}
```
