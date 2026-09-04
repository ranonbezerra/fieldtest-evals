# 06-tenant-aware-prisma.ts

## reasoning

```
Let me analyze the plan carefully to understand what `src/db/tenant-aware-prisma.ts` needs to contain.

From the plan:

```ts
import type { PrismaClient } from '@prisma/client';

export const TENANT_SCOPED_MODELS: ReadonlySet<string>; // {'Customer','Plan','Order'}

export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}

export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T>;

export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma;
export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```

Guard behavior:
- Non-scoped models (`Tenant`): pass through unchanged.
- No tenant in ALS: throw `AppException.tenantContextMissing()`.

Guard mutations per action group:
- Reads (`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `groupBy`): `args.where = { ...args.where, tenantId: ctx.tenantId }`
- Scope-by-id writes (`update`, `updateMany`, `upsert`, `delete`, `deleteMany`): `args.where = { ...args.where, tenantId: ctx.tenantId }`; for `upsert` also stamp `create.tenantId`
- Create writes (`create`, `createMany`): stamp `data.tenantId = ctx.tenantId` (each item for `createMany`)

Stamping overwrites any client-supplied `tenantId`.

The tenant context comes from `src/tenant/tenant-context.ts`:
```ts
export const tenantStorage: AsyncLocalStorage<TenantContext>;
export function currentTenant(): TenantContext | undefined;
export function requireTenant(): TenantContext;   // throws AppException.tenantContextMissing() if absent
```

So I need to use `requireTenant()` or `currentTenant()` from `../tenant/tenant-context`.

Let me think about the implementation:

1. `TENANT_SCOPED_MODELS` - a ReadonlySet with 'Customer', 'Plan', 'Order'
2. `TenantGuardArgs` - interface with optional where and data
3. `tenantQueryGuard<T>` - the guard function that:
   - Checks if model is scoped; if not, calls query(args) unchanged
   - Gets tenant context (throw if missing)
   - Mutates args based on action group
   - Calls query with mutated args
4. `createTenantAwareClient` - creates a Prisma client extension that wraps all model operations with the guard
5. `TenantAwarePrisma` - type alias

Now, how to implement `createTenantAwareClient`? In Prisma, you use `$extends` to create an extended client. The extension uses `client.$extends({ ... })` with model query callbacks.

Looking at Prisma extensions API:
```ts
const extended = base.$extends({
  model: {
    Customer: {
      async $allOperations({ args, query }) {
        // guard logic
      }
    },
    Plan: { ... },
    Order: { ... }
  }
})
```

But wait - the plan says the guard should be a single function `tenantQueryGuard` that takes action, args, query, and model. And `createTenantAwareClient` uses it.

Let me think about how to wire this together. The Prisma `$extends` API with `model.$allOperations` gives us `{ args, query, model }` where `model` has a `modelName` property.

Actually, looking at the Prisma extension API more carefully:
- `model.$allOperations({ args, query, model })` - the `model` parameter has `modelName`
- Each operation callback gets `{ args, query }` and you can access the model name from the context

Let me structure `createTenantAwareClient`:

```ts
export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma {
  return base.$extends({
    model: {
      Customer: {
        async $allOperations({ args, query, model }) {
          return tenantQueryGuard(args, /* action? */, query, model);
        }
      },
      // ... same for Plan, Order
    }
  });
}
```

Wait, but `$allOperations` doesn't give us the specific action name. Let me reconsider.

Actually, looking at the Prisma extensions docs more carefully:
- `$allOperations` - intercepts all operations
- But we don't get the action name in `$allOperations`

Hmm, but the plan defines `tenantQueryGuard` to take an `action: string` parameter. So maybe I need to use individual operation callbacks instead of `$allOperations`, or there's another way.

Wait, let me re-read the Prisma extensions API. In `$extends({ model: { Model: { ... } } })`:
- You can specify individual operations: `findMany`, `findFirst`, `findUnique`, `create`, `update`, etc.
- Or `$allOperations` which catches everything

With individual operations, we know the action name. But that's a lot of callbacks to define for each model.

Alternatively, I could use `$allOperations` and determine the action from... hmm, but `$allOperations` doesn't provide the action name directly.

Wait, let me look at this differently. The plan says:

```ts
export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T>;
```

This is a standalone function that takes the action. The `createTenantAwareClient` would use it internally.

For the Prisma extension, I think the cleanest approach is to use `$allOperations` but we need to figure out the action. Actually, looking at the Prisma source and docs again...

In `$allOperations({ args, query, model })`:
- `model` has `modelName: string`
- But there's no `action` property

So maybe I need to define each operation explicitly. Let me think...

Actually, a common pattern is:

```ts
const operations = ['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'] as const;

const modelConfig = {};
for (const op of operations) {
  modelConfig[op] = async ({ args, query, model }) => {
    return tenantQueryGuard(op, args, query, model);
  };
}
```

But wait, Prisma's `$extends` expects a specific object shape. You can't easily do dynamic property assignment on the model config.

Let me think of another approach. Since we only have 3 scoped models (Customer, Plan, Order), and the plan says non-scoped models pass through, I could:

1. Define the guard for all three models explicitly
2. For each model, define `$allOperations` and determine the action from... 

Hmm, actually I recall that in some versions of Prisma, `$allOperations` does NOT give you the action name. Let me reconsider.

Actually, I just realized - I can use a different approach. I'll define each operation explicitly for each scoped model. It's verbose but correct.

Or better yet, I can create a helper that builds the model config:

```ts
function scopedModelConfig() {
  const config = {} as Record<string, (opts: any) => Promise<any>>;
  for (const action of ['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
    config[action] = async ({ args, query, model }: any) => {
      return tenantQueryGuard(action, args, query as any, model);
    };
  }
  return config;
}
```

Then:
```ts
export function createTenantAwareClient(base: PrismaClient) {
  return base.$extends({
    model: {
      Customer: scopedModelConfig(),
      Plan: scopedModelConfig(),
      Order: scopedModelConfig(),
    }
  });
}
```

This is clean and DRY. The `tenantQueryGuard` receives the correct action name.

Now for the guard itself:

```ts
export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T> {
  if (!TENANT_SCOPED_MODELS.has(model.modelName)) {
    return query(args);
  }

  const ctx = requireTenant(); // throws tenantContextMissing if absent

  const READ_ACTIONS = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy']);
  const WRITE_BY_ID_ACTIONS = new Set(['update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
  const CREATE_ACTIONS = new Set(['create', 'createMany']);

  if (READ_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId: ctx.tenantId };
  } else if (WRITE_BY_ID_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId: ctx.tenantId };
    if (action === 'upsert') {
      // stamp create.tenantId
      const anyArgs = args as any;
      if (anyArgs.create) {
        anyArgs.create.tenantId = ctx.tenantId;
      }
    }
  } else if (CREATE_ACTIONS.has(action)) {
    if (action === 'create') {
      args.data = { ...(args.data as Record<string, unknown>), tenantId: ctx.tenantId };
    } else {
      // createMany - data is an array
      const data = args.data as ReadonlyArray<Record<string, unknown>>;
      args.data = data.map(item => ({ ...item, tenantId: ctx.tenantId })) as any;
    }
  }

  return query(args);
}
```

Wait, but the `TenantGuardArgs` interface only has `where` and `data`. For `upsert`, there's a `create` field. Let me check the plan again...

The plan says: "for `upsert` also stamp `create.tenantId`"

So I need to handle the `create` field in args for upsert. The `TenantGuardArgs` interface as defined in the plan only has `where` and `data`. But in practice, Prisma's upsert args have `{ where, create, update }`. 

I think I need to either:
1. Extend the interface to include `create` (but the plan defines it without)
2. Cast to a wider type internally

Since the plan explicitly defines `TenantGuardArgs` as:
```ts
export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}
```

And the guard needs to access `create` for upsert, I'll need to cast internally. This is a minor implementation detail that doesn't change the public interface.

Actually, let me reconsider. The `args` passed in from Prisma will have whatever shape Prisma gives it. The `TenantGuardArgs` is just the type we use for the guard's parameter. Internally, I can cast to access additional fields like `create`.

Let me also think about the `requireTenant()` import. From the plan:
```ts
// src/tenant/tenant-context.ts
export const tenantStorage: AsyncLocalStorage<TenantContext>;
export function currentTenant(): TenantContext | undefined;
export function requireTenant(): TenantContext;
```

So I'll import `requireTenant` from `'../tenant/tenant-context'`.

Now let me also think about the `createTenantAwareClient` return type. The plan says:
```ts
export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma;
export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```

This is a circular reference in the plan's pseudocode, but in practice, `ReturnType<typeof createTenantAwareClient>` will resolve to whatever Prisma's `$extends` returns. I'll just write the function and let TypeScript infer the return type, or use `ReturnType` as shown.

Actually, looking more carefully, in TypeScript you can't have a type alias that references itself through `ReturnType`. The plan is showing the *concept*. In practice:

```ts
export function createTenantAwareClient(base: PrismaClient) {
  return base.$extends({ ... });
}
export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```

This works fine because `createTenantAwareClient` is defined before the type alias, and TypeScript resolves it.

Let me now write the complete file:

```ts
import type { PrismaClient } from '@prisma/client';
import { requireTenant } from '../tenant/tenant-context';

export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(['Customer', 'Plan', 'Order']);

export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}

const READ_ACTIONS: ReadonlySet<string> = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy']);
const WRITE_BY_ID_ACTIONS: ReadonlySet<string> = new Set(['update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
const CREATE_ACTIONS: ReadonlySet<string> = new Set(['create', 'createMany']);

export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T> {
  if (!TENANT_SCOPED_MODELS.has(model.modelName)) {
    return query(args);
  }

  const ctx = requireTenant();

  if (READ_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId: ctx.tenantId };
  } else if (WRITE_BY_ID_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId: ctx.tenantId };
    if (action === 'upsert') {
      const upsertArgs = args as TenantGuardArgs & { create?: Record<string, unknown> };
      if (upsertArgs.create) {
        upsertArgs.create = { ...upsertArgs.create, tenantId: ctx.tenantId };
      }
    }
  } else if (CREATE_ACTIONS.has(action)) {
    if (action === 'create') {
      const data = (args.data ?? {}) as Record<string, unknown>;
      args.data = { ...data, tenantId: ctx.tenantId };
    } else {
      // createMany: data is an array
      const items = (args.data ?? []) as ReadonlyArray<Record<string, unknown>>;
      args.data = items.map((item) => ({ ...item, tenantId: ctx.tenantId })) as unknown as TenantGuardArgs['data'];
    }
  }

  return query(args);
}

export function createTenantAwareClient(base: PrismaClient) {
  const scopedModelConfig = {
    $allOperations: async ({ args, query, model }: any) => {
      // Problem: $allOperations doesn't give us the action name
    },
  };
  // ...
}
```

Wait, I'm stuck on the action name issue with `$allOperations`. Let me think about this differently.

Looking at the Prisma docs for `$extends`:
- You can define specific operations: `findMany`, `findFirst`, etc.
- Or `$allOperations`

With specific operations, each callback knows which operation it is because it's defined under that key.

So the cleanest approach for `createTenantAwareClient` is to explicitly list all operations:

```ts
export function createTenantAwareClient(base: PrismaClient) {
  const actions = [
    'findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy',
    'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
  ] as const;

  function buildModelConfig() {
    const config: Record<string, (opts: { args: any; query: Function; model: { modelName: string } }) => Promise<any>> = {};
    for (const action of actions) {
      config[action] = async ({ args, query, model }) => {
        return tenantQueryGuard(action, args as TenantGuardArgs, query as (a: TenantGuardArgs) => Promise<never>, model);
      };
    }
    return config;
  }

  return base.$extends({
    model: {
      Customer: buildModelConfig(),
      Plan: buildModelConfig(),
      Order: buildModelConfig(),
    },
  });
}
```

Hmm, but this has type issues. Let me think about how Prisma's `$extends` typing works.

Actually, in practice with Prisma extensions, the callbacks receive:
```ts
{
  args: any; // the operation arguments
  query: (args: any) => Promise<any>; // call this to execute the actual query
  model: { modelName: string }; // the model being queried
}
```

The types are complex due to Prisma's generics. In practice, most people just use `any` for the args and query in extension callbacks because the typing is extremely complex.

Let me write it pragmatically:

```ts
export function createTenantAwareClient(base: PrismaClient) {
  const operations = [
    'findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy',
    'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
  ] as const;

  const modelConfig = Object.fromEntries(
    operations.map((action) => [
      action,
      async ({ args, query, model }: { args: any; query: Function; model: { modelName: string } }) =>
        tenantQueryGuard(
          action,
          args as TenantGuardArgs,
          query as (a: TenantGuardArgs) => Promise<unknown>,
          model,
        ),
    ]),
  );

  return base.$extends({
    model: {
      Customer: modelConfig,
      Plan: modelConfig,
      Order: modelConfig,
    },
  });
}
```

Wait, but `modelConfig` is shared across all three models. That's fine because the guard checks `model.modelName` which will be correct per-model at runtime.

Actually, I realize there might be an issue with sharing the same object reference. Let me create separate configs or just inline them. Actually it should be fine since the callbacks are stateless and the `model` parameter provides the correct model name at call time.

Let me also reconsider: do I need to worry about the `$allOperations` not being defined? No - if I only define specific operations, those are the only ones intercepted. Any other operation (like `$transaction` on a model, or `findRaw`) would pass through unguarded. But the plan only lists those 13 operations, so we're good.

Actually wait - what about `findUniqueOrThrow`? The plan doesn't mention it. And the plan says repositories use `findFirst` for lookups. So we don't need to worry about it.

Let me also double-check: the plan says "Non-scoped models (Tenant): pass through unchanged." Since I'm only defining extensions for Customer, Plan, and Order, the Tenant model won't be extended at all - it naturally passes through. The `TENANT_SCOPED_MODELS` check in `tenantQueryGuard` is an additional safety net (belt and suspenders), but since we only attach the extension to scoped models, it will always be true. Still, I'll keep the check as specified in the plan.

Now let me finalize the file. One more consideration: the `// ASSUMPTION` comment. Is there anything genuinely unresolved?

Looking at the plan's signature for `tenantQueryGuard`:
```ts
export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T>;
```

This is clear. The `createTenantAwareClient` needs to call this. The only "assumption" I might need is around how Prisma's extension callback types work - but that's just implementation detail, not a spec gap.

Actually, I realize I should double-check: does the plan say to import `requireTenant` or `currentTenant`? 

The plan says:
- "Scoped model with no tenant in ALS: throws `AppException.tenantContextMissing()`."
- From tenant-context.ts: `requireTenant(): TenantContext; // throws AppException.tenantContextMissing() if absent`

So I should use `requireTenant()` which already throws. That matches the "fail-closed" requirement.

Let me write the final version now.
```

## reply

```typescript
import type { PrismaClient } from '@prisma/client';
import { requireTenant } from '../tenant/tenant-context';

export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'Customer',
  'Plan',
  'Order',
]);

export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}

const READ_ACTIONS: ReadonlySet<string> = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_BY_ID_ACTIONS: ReadonlySet<string> = new Set([
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

const CREATE_ACTIONS: ReadonlySet<string> = new Set(['create', 'createMany']);

export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T> {
  if (!TENANT_SCOPED_MODELS.has(model.modelName)) {
    return query(args);
  }

  const ctx = requireTenant();

  if (READ_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId: ctx.tenantId };
  } else if (WRITE_BY_ID_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId: ctx.tenantId };
    if (action === 'upsert') {
      const upsertArgs = args as TenantGuardArgs & {
        create?: Record<string, unknown>;
      };
      if (upsertArgs.create) {
        upsertArgs.create = { ...upsertArgs.create, tenantId: ctx.tenantId };
      }
    }
  } else if (CREATE_ACTIONS.has(action)) {
    if (action === 'create') {
      const data = (args.data ?? {}) as Record<string, unknown>;
      args.data = { ...data, tenantId: ctx.tenantId };
    } else {
      const items = (args.data ?? []) as ReadonlyArray<Record<string, unknown>>;
      args.data = items.map((item) => ({
        ...item,
        tenantId: ctx.tenantId,
      })) as unknown as TenantGuardArgs['data'];
    }
  }

  return query(args);
}

export function createTenantAwareClient(base: PrismaClient) {
  const operations = [
    'findMany',
    'findFirst',
    'findUnique',
    'count',
    'aggregate',
    'groupBy',
    'create',
    'createMany',
    'update',
    'updateMany',
    'upsert',
    'delete',
    'deleteMany',
  ] as const;

  // ASSUMPTION: Prisma extension callbacks are typed loosely at the model level;
  // the concrete arg/query generics vary per operation, so we accept a wide shape
  // and narrow via the TenantGuardArgs contract in tenantQueryGuard.
  function buildModelConfig(): Record<
    string,
    (opts: {
      args: unknown;
      query: (a: TenantGuardArgs) => Promise<unknown>;
      model: { modelName: string };
    }) => Promise<unknown>
  > {
    const config = {} as ReturnType<typeof buildModelConfig>;
    for (const action of operations) {
      config[action] = async ({ args, query, model }) =>
        tenantQueryGuard(
          action,
          args as TenantGuardArgs,
          query as (a: TenantGuardArgs) => Promise<unknown>,
          model,
        );
    }
    return config;
  }

  return base.$extends({
    model: {
      Customer: buildModelConfig(),
      Plan: buildModelConfig(),
      Order: buildModelConfig(),
    },
  });
}

export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```
