# repair1-tenant-aware-prisma.ts

## reasoning

```
The user is asking me to fix `src/db/tenant-aware-prisma.ts` based on the compiler errors shown.

Let me look at the compiler errors that relate to this file specifically:

```
src/db/tenant-aware-prisma.ts — I don't see a direct error for this file in the list.
```

Wait, let me re-read the errors. The first line is cut off:
```
tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?
```

This is clearly the tail end of an error message for `src/db/tenant-aware-prisma.ts` — it's saying that a relative import path needs an explicit `.js` extension. The import is of `../errors/app-exception` and it should be `../errors/app-exception.js`.

So the file `src/db/tenant-aware-prisma.ts` has an import like:
```ts
import { AppException } from '../errors/app-exception';
```

And it needs to be:
```ts
import { AppException } from '../errors/app-exception.js';
```

That's the only error that pertains to this file. The rest are in other files (which I'm told not to change — "Change nothing the messages do not name").

Now let me reconstruct the full file based on the PLAN.md specification:

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
- Non-scoped models: returns `query(args)` unchanged.
- Scoped model with no tenant in ALS: throws `AppException.tenantContextMissing()`.
- Reads (`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `groupBy`): `args.where = { ...args.where, tenantId: ctx.tenantId }`
- Scope-by-id writes (`update`, `updateMany`, `upsert`, `delete`, `deleteMany`): `args.where = { ...args.where, tenantId: ctx.tenantId }`; for `upsert` also stamp `create.tenantId`
- Create writes (`create`, `createMany`): stamp `data.tenantId = ctx.tenantId` (each item for `createMany`)

Now, the import from `@prisma/client` — is that also a problem? Looking at the errors, I don't see an error about `@prisma/client` being missing. The "Cannot find module" errors are for `express`, `@nestjs/jwt`, `supertest`, `@nestjs/testing`, `jsonwebtoken` — these are missing dependencies, not import path issues. The `@prisma/client` is presumably installed (or at least its types are available since Prisma is part of the stack).

Wait, actually looking more carefully — the errors for `express`, `@nestjs/jwt`, `supertest`, `@nestjs/testing`, `jsonwebtoken` are "Cannot find module" which means those packages aren't installed. But the task says to only fix what the messages require of THIS file. The only message for this file is the missing `.js` extension on the relative import.

Let me also think about whether `@prisma/client` would have a similar issue. In the plan, it's imported as `import type { PrismaClient } from '@prisma/client'` — this is a bare module specifier, not a relative path, so the `.js` extension rule doesn't apply. And there's no compiler error about it, so it's fine.

Now let me write the complete file:

```ts
import type { PrismaClient, Prisma } from '@prisma/client';
import { AppException } from '../errors/app-exception.js';
import { currentTenant } from '../tenant/tenant-context.js';
```

Wait — the plan says the file reads `src/errors/app-exception.ts`. Let me check if it also reads from `tenant-context`. Looking at the manifest:

```
src/db/tenant-aware-prisma.ts | reads: src/errors/app-exception.ts | tenant guard + extended client factory
```

It only lists `src/errors/app-exception.ts` as a read. But the guard needs to get the current tenant from ALS... Let me re-read the plan more carefully.

The plan says:
> `src/tenant/tenant-context.ts`
> ```ts
> export const tenantStorage: AsyncLocalStorage<TenantContext>;
> export function currentTenant(): TenantContext | undefined;
> export function requireTenant(): TenantContext;   // throws AppException.tenantContextMissing() if absent
> ```

And the guard behavior says: "Scoped model with no tenant in ALS: throws `AppException.tenantContextMissing()`"

So the guard needs to call `currentTenant()` from `tenant-context`. But the manifest only lists `src/errors/app-exception.ts` as a dependency. 

Hmm, but the compiler errors don't mention any import from `tenant-context` in this file. Let me think about this differently — maybe the guard uses `tenantStorage` directly (imported from `tenant-context`) or uses `currentTenant()`. Either way, it would need to import from `../tenant/tenant-context.js`.

But wait — the manifest says "reads: src/errors/app-exception.ts" only. Maybe the plan intends for the tenant context to be passed differently? Let me re-read...

Actually, looking at the plan again:
> "The guard evaluates per-query and is fail-closed: no tenant in ALS ⇒ throw, never run an unscoped query."

So the guard must read from ALS. The only way to do that is to import from `tenant-context`. The manifest might be incomplete or simplified. Since the compiler errors don't flag any import from `tenant-context` in this file (only the `app-exception` one), perhaps the current file already has the correct import for `tenant-context` (with the `.js` extension) and only the `app-exception` import is missing it.

Actually wait — let me re-read the error messages more carefully. The first line is:
```
tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?
```

This is the tail of a message. The full message would be something like:
```
src/db/tenant-aware-prisma.ts(X,Y): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?
```

So there's exactly one error in this file: the import of `../errors/app-exception` needs to be `../errors/app-exception.js`.

Now, does this file also import from `tenant-context`? If it did and the import was wrong, we'd see another error. Since we don't, either:
1. It doesn't import from `tenant-context` (maybe it imports `tenantStorage` from somewhere else, or the ALS is passed in some other way)
2. It does import from `tenant-context` but with the correct `.js` extension already

Given the plan's architecture, the guard needs access to ALS. The most natural import would be `import { currentTenant } from '../tenant/tenant-context.js'`. If the file already had this with the `.js` extension, it wouldn't show up in errors. If it didn't have the `.js` extension, it would show up as another TS2835 error.

Since only one TS2835 error is shown for this file (the `app-exception` one), I'll assume the `tenant-context` import is either already correct or that the file uses a different mechanism.

Actually, let me reconsider. Maybe the file doesn't import from `tenant-context` at all. Perhaps it imports `AsyncLocalStorage` and the storage instance is passed in, or perhaps the function signature includes the tenant context somehow.

Looking at the plan's signature:
```ts
export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T>;
```

There's no tenant parameter. So it must read from ALS internally. The most natural way is to import `currentTenant` or `tenantStorage` from `../tenant/tenant-context.js`.

I'll include the import with `.js` extension. If it was already correct in the file, adding it explicitly doesn't hurt. The only error I need to fix is the `app-exception` one, but since I'm rewriting the whole file, I'll make sure all relative imports have `.js` extensions.

Let me also think about what `Prisma` import might be needed. For the `$extends` method, I need to use Prisma's extension API. Let me think about how `createTenantAwareClient` would work.

In Prisma, you can extend a client using `$extends`:
```ts
const extended = prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // guard logic here
      }
    }
  }
})
```

Or more specifically, we can use the model-level extension. Let me think about the right approach.

Actually, looking at Prisma's `$extends` API more carefully:

```ts
const extendedPrisma = prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // model is the model name as string
        // operation is like 'findMany', 'create', etc.
        // args is the arguments object
        // query is the function to execute the query
        return query(args)
      }
    }
  }
})
```

This matches the plan's `tenantQueryGuard` signature closely. The `model` parameter in the callback would be `{ modelName: string }` or just a string depending on the Prisma version.

Actually in newer Prisma versions, the callback receives:
```ts
{ model, operation, args, query }
```
where `model` is a string (the model name).

But the plan specifies `model: { modelName: string }`. Let me look at this more carefully...

In Prisma's `$extends` API, the `query` callback parameters are:
- For `$allModels`: `{ model, operation, args, query }` where `model` is a string
- For specific models: `{ operation, args, query }`

Hmm, but the plan says `model: { modelName: string }`. This might be a different version of the API or the plan might be slightly off. Since I need to make it compile and the plan governs, let me use what makes sense for the Prisma extension API.

Actually, let me look at this from a different angle. The plan defines:
```ts
export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T>;
```

This is a standalone function. Then `createTenantAwareClient` would use it inside the `$extends` callback. The `model` parameter shape `{ modelName: string }` might just be how the plan chose to type it — perhaps wrapping the string in an object for future extensibility.

For the actual Prisma `$extends` call, I'll adapt:

```ts
export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return tenantQueryGuard(
            operation,
            args as TenantGuardArgs,
            (a) => query(a as any),
            { modelName: model },
          );
        },
      },
    },
  });
}
```

Wait, but `query` in the Prisma extension callback has a specific type. Let me think about typing this properly.

Actually, in Prisma's `$extends` with `$allModels.$allOperations`, the types are:
- `model`: string
- `operation`: string  
- `args`: the args for that operation (typed per-operation in specific model extensions, but with `$allModels` it's more generic)
- `query`: `(args: any) => Promise<any>`

Since we're using `$allModels`, the types will be somewhat loose. I'll need to cast appropriately.

Let me also consider: does `PrismaClient` have `$extends`? Yes, in Prisma 4.7+.

Let me write the file:

```ts
import type { PrismaClient } from '@prisma/client';
import { AppException } from '../errors/app-exception.js';
import { currentTenant } from '../tenant/tenant-context.js';

export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(['Customer', 'Plan', 'Order']);

export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}

const READ_ACTIONS = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy']);
const SCOPE_BY_ID_ACTIONS = new Set(['update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
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

  const mutated: TenantGuardArgs = { ...args };

  if (READ_ACTIONS.has(action)) {
    mutated.where = { ...mutated.where, tenantId: ctx.tenantId };
  } else if (SCOPE_BY_ID_ACTIONS.has(action)) {
    mutated.where = { ...mutated.where, tenantId: ctx.tenantId };
    if (action === 'upsert') {
      const a = args as Record<string, unknown>;
      if (a.create) {
        mutated.data = { ...(a.create as Record<string, unknown>), tenantId: ctx.tenantId };
      }
    }
  } else if (CREATE_ACTIONS.has(action)) {
    if (Array.isArray(mutated.data)) {
      mutated.data = mutated.data.map((item) => ({ ...item, tenantId: ctx.tenantId }));
    } else {
      mutated.data = { ...mutated.data, tenantId: ctx.tenantId };
    }
  }

  return query(mutated);
}
```

Hmm wait, for `upsert`, the args structure is:
```ts
{
  where: { ... },
  create: { ... },
  update: { ... }
}
```

So `args.create` is the create data, not `args.data`. The plan says "for `upsert` also stamp `create.tenantId`". So I need to handle the `create` field of the upsert args.

But my `TenantGuardArgs` interface only has `where` and `data`. For upsert, the relevant fields are `where`, `create`, and `update`. I need to extend the interface or handle it differently.

Let me reconsider the `TenantGuardArgs` interface. The plan says:
```ts
export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}
```

This is what the plan specifies. For `upsert`, the `create` field isn't in this interface. I have a few options:
1. Extend the interface to include `create`
2. Cast to a wider type when handling upsert

Since the plan explicitly defines the interface, I'll keep it as specified and handle the `upsert` case by casting the args to access `create`.

Actually, let me re-think. The plan says the interface is:
```ts
export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}
```

For `create` actions, `data` holds the new record. For `upsert`, Prisma uses `create` and `update` fields, not `data`. So the interface as specified doesn't cover upsert's `create` field.

I think the cleanest approach that stays faithful to the plan is to keep the interface as-is and use a type assertion when dealing with upsert. The plan's guard behavior says "for `upsert` also stamp `create.tenantId`" — this implies accessing a field beyond what the interface declares.

Let me use an index signature or just cast:

```ts
if (action === 'upsert') {
  const upsertArgs = args as Record<string, unknown>;
  if (upsertArgs.create && typeof upsertArgs.create === 'object') {
    mutated = { ...mutated, create: { ...(upsertArgs.create as Record<string, unknown>), tenantId: ctx.tenantId } };
  }
}
```

But `mutated` is typed as `TenantGuardArgs` which doesn't have a `create` field. I'll need to either widen the type or use a different approach.

Actually, I think the simplest approach is to just work with the args as `Record<string, unknown>` internally for the mutation, and type the public interface as the plan specifies. The function signature uses `TenantGuardArgs` but internally we can treat it more broadly.

Let me restructure:

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

  const ctx = currentTenant();
  if (!ctx) {
    throw AppException.tenantContextMissing();
  }

  const a = args as Record<string, unknown>;

  if (READ_ACTIONS.has(action)) {
    a.where = { ...(a.where as Record<string, unknown> | undefined), tenantId: ctx.tenantId };
  } else if (SCOPE_BY_ID_ACTIONS.has(action)) {
    a.where = { ...(a.where as Record<string, unknown> | undefined), tenantId: ctx.tenantId };
    if (action === 'upsert' && a.create && typeof a.create === 'object') {
      a.create = { ...(a.create as Record<string, unknown>), tenantId: ctx.tenantId };
    }
  } else if (CREATE_ACTIONS.has(action)) {
    if (Array.isArray(a.data)) {
      a.data = (a.data as Record<string, unknown>[]).map((item) => ({ ...item, tenantId: ctx.tenantId }));
    } else if (a.data && typeof a.data === 'object') {
      a.data = { ...(a.data as Record<string, unknown>), tenantId: ctx.tenantId };
    }
  }

  return query(a as TenantGuardArgs);
}
```

This mutates the args object in-place (or creates new objects for the fields we change). This should work.

Now for `createTenantAwareClient`:

```ts
export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return tenantQueryGuard(
            operation,
            args as TenantGuardArgs,
            (a) => query(a),
            { modelName: model },
          );
        },
      },
    },
  });
}
export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```

Wait, there's a typing issue. The `query` callback in Prisma's `$extends` has a specific signature that may not match `(args: TenantGuardArgs) => Promise<T>`. Let me think about this...

In Prisma's `$extends` API with `$allModels.$allOperations`, the types are generic and the `query` function is typed as `(args: any) => Promise<any>` in the `$allModels` case (since we don't know which model/operation it is).

Actually, looking at Prisma's types more carefully, in the `$allModels` case:
- `model` is a string
- `operation` is a string  
- `args` is typed as `any` (or a union of all possible args)
- `query` is `(args: any) => Promise<any>`

So the cast `args as TenantGuardArgs` should work, and `(a) => query(a)` should work since `query` accepts `any`.

Let me also make sure about the `$extends` return type. `PrismaClient.$extends()` returns a new client with the same model properties but with the extensions applied. The type should be compatible.

Actually, I realize there might be a typing issue with `base.$extends`. In Prisma, `$extends` is available on the client and returns a `PrismaClient`-like type. The exact return type depends on the Prisma version.

Let me just write it and see if it compiles logically. The key thing is that the only compiler error for this file was the missing `.js` extension on the `app-exception` import.

Let me also double-check: does this file need to import from `@prisma/client`? Yes, for the `PrismaClient` type. That's a bare module import, not relative, so no `.js` extension needed.

Final file:

```ts
import type { PrismaClient } from '@prisma/client';
import { AppException } from '../errors/app-exception.js';
import { currentTenant } from '../tenant/tenant-context.js';

export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(['Customer', 'Plan', 'Order']);

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

const SCOPE_BY_ID_ACTIONS: ReadonlySet<string> = new Set([
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

  const ctx = currentTenant();
  if (!ctx) {
    throw AppException.tenantContextMissing();
  }

  const a = args as Record<string, unknown>;

  if (READ_ACTIONS.has(action)) {
    a.where = { ...(a.where as Record<string, unknown> | undefined), tenantId: ctx.tenantId };
  } else if (SCOPE_BY_ID_ACTIONS.has(action)) {
    a.where = { ...(a.where as Record<string, unknown> | undefined), tenantId: ctx.tenantId };
    if (action === 'upsert' && a.create != null && typeof a.create === 'object') {
      a.create = { ...(a.create as Record<string, unknown>), tenantId: ctx.tenantId };
    }
  } else if (CREATE_ACTIONS.has(action)) {
    if (Array.isArray(a.data)) {
      a.data = (a.data as Record<string, unknown>[]).map((item) => ({
        ...item,
        tenantId: ctx.tenantId,
      }));
    } else if (a.data != null && typeof a.data === 'object') {
      a.data = { ...(a.data as Record<string, unknown>), tenantId: ctx.tenantId };
    }
  }

  return query(a as TenantGuardArgs);
}

export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return tenantQueryGuard(
            operation,
            args as TenantGuardArgs,
            (a) => query(a),
            { modelName: model },
          );
        },
      },
    },
  });
}

export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```

Wait, I need to double-check: is `currentTenant` the right import? The plan says:
```ts
export function currentTenant(): TenantContext | undefined;
```

Yes, `currentTenant()` returns the context or undefined. That's what I'm using.

One more thought: the plan says the file's reads are only `src/errors/app-exception.ts`. But I'm also importing from `../tenant/tenant-context.js`. This is a slight deviation from the manifest, but it's architecturally necessary — the guard must read from ALS to know which tenant is active. The manifest might have been simplified. Since the compiler errors don't flag this import (meaning it's either already present with correct extension, or I'm adding it correctly), I'll keep it.

Actually wait — if the compiler errors don't flag an import from `tenant-context` in this file, it could mean:
1. The import doesn't exist in the current file (and the guard works differently)
2. The import exists with the correct `.js` extension

If option 1, then how does the current file access ALS? Maybe through a parameter passed to `createTenantAwareClient`? But the plan's signature is:
```ts
export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma;
```

No ALS parameter. So it must import from `tenant-context`. I'll include the import.

I'm confident in this solution. The only fix required by the compiler is adding `.js` to the `app-exception` import, and I'm doing that while writing out the complete file.
```

## reply

```ts
import type { PrismaClient } from '@prisma/client';
import { AppException } from '../errors/app-exception.js';
import { currentTenant } from '../tenant/tenant-context.js';

export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(['Customer', 'Plan', 'Order']);

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

const SCOPE_BY_ID_ACTIONS: ReadonlySet<string> = new Set([
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

  const ctx = currentTenant();
  if (!ctx) {
    throw AppException.tenantContextMissing();
  }

  const a = args as Record<string, unknown>;

  if (READ_ACTIONS.has(action)) {
    a.where = { ...(a.where as Record<string, unknown> | undefined), tenantId: ctx.tenantId };
  } else if (SCOPE_BY_ID_ACTIONS.has(action)) {
    a.where = { ...(a.where as Record<string, unknown> | undefined), tenantId: ctx.tenantId };
    if (action === 'upsert' && a.create != null && typeof a.create === 'object') {
      a.create = { ...(a.create as Record<string, unknown>), tenantId: ctx.tenantId };
    }
  } else if (CREATE_ACTIONS.has(action)) {
    if (Array.isArray(a.data)) {
      a.data = (a.data as Record<string, unknown>[]).map((item) => ({
        ...item,
        tenantId: ctx.tenantId,
      }));
    } else if (a.data != null && typeof a.data === 'object') {
      a.data = { ...(a.data as Record<string, unknown>), tenantId: ctx.tenantId };
    }
  }

  return query(a as TenantGuardArgs);
}

export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return tenantQueryGuard(
            operation,
            args as TenantGuardArgs,
            (a) => query(a),
            { modelName: model },
          );
        },
      },
    },
  });
}

export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```
