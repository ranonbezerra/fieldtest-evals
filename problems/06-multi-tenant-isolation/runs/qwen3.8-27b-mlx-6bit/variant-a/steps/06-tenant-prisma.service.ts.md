# 06-tenant-prisma.service.ts

## reasoning

```
Let me analyze what's needed for `src/multi-tenant/tenant-prisma.service.ts` based on the plan.

From the plan:
- `TenantPrismaService` is REQUEST-scoped (must not be singleton)
- It reads `TenantContextService` (also REQUEST) at call time, not construction time
- Internally wraps `base.$extends({ query: { $allModels: … } })`
- Read ops (`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`): merge `{ tenantId }` into `args.where`
- Write ops (`create`, `createMany`): merge `{ tenantId }` into `args.data`
- Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`
- Exposes the same model delegates as PrismaClient but every call is transparently scoped to ctx.tenantId
- The extended client is REQUEST-scoped so each request sees only its own tenant

Wait, let me re-read the plan more carefully:

```
export declare class TenantPrismaService {
  constructor(
    private readonly base: PrismaService,
    private readonly ctx: TenantContextService,
  );
  // Exposes the same model delegates as PrismaClient but every call
  // is transparently scoped to ctx.tenantId.
  get customer(): TenantScopedModel<PrismaClient['customer']>;
  get plan(): TenantScopedModel<PrismaClient['plan']>;
  get order(): TenantScopedModel<PrismaClient['order']>;
}
```

So it has getters for `customer`, `plan`, and `order`. Each returns a scoped model.

The internal strategy is `$extends` with query-level interceptor that:
- Read ops: merge `{ tenantId }` into `args.where`
- Write ops (`create`, `createMany`): merge `{ tenantId }` into `args.data`
- Update/delete: merge `{ tenantId }` into `args.where`; if row count is 0, throw `ResourceNotFoundError`

Wait, but the plan says "if the resulting row count is 0, throw ResourceNotFoundError" for update/delete. Let me think about how `$extends` works in Prisma.

With Prisma's `$extends`, you can use query interceptors like:

```ts
const extended = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // modify args before passing to query
        return query(args);
      }
    }
  }
});
```

Actually, looking at Prisma's extension API more carefully:

The `$extends` query interceptor has the signature:
```ts
query: {
  $allModels: {
    $allOperations({ model, operation, args, query }) { ... }
  }
}
```

Where `query` is the function to call with (potentially modified) args. The result of `query(args)` is what gets returned.

For the `ResourceNotFoundError` on update/delete, I need to check the result. But wait - Prisma's `update` and `delete` throw an error by default if the record is not found (P2025). So actually, if we scope the where with tenantId and the record doesn't belong to that tenant, Prisma will throw P2025 (record not found).

Hmm, but the plan says "if the resulting row count is 0, throw ResourceNotFoundError". Let me think about this differently.

Actually, looking at the plan again:
- Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`.

In Prisma, `update` and `delete` with a `where` that matches no record will throw `PrismaClientKnownRequestError` with code `P2025`. So I could either:
1. Catch P2025 and rethrow as ResourceNotFoundError
2. Use `updateMany`/`deleteMany` and check count

But the plan says to use `update` and `delete` (not `updateMany`/`deleteMany`), so option 1 makes more sense. Actually wait, let me re-read:

"Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

This suggests using updateMany/deleteMany and checking the count. But that contradicts the standard Prisma delegate surface which has `update` and `delete`.

Actually, I think the most defensible interpretation is:
- For `update` and `delete`: inject tenantId into where, and if Prisma throws P2025 (record not found), catch it and throw ResourceNotFoundError.
- For `updateMany` and `deleteMany`: inject tenantId into where, and the result will have `count: 0` if no rows matched - but we might not need to throw in that case since "many" operations naturally return 0.

Wait, let me re-read the TenantScopedModel interface:
```ts
export interface TenantScopedModel<T> {
  findMany(args?: Record<string, unknown>): Promise<unknown[]>;
  findUnique(args: Record<string, unknown>): Promise<unknown | null>;
  findFirst(args?: Record<string, unknown>): Promise<unknown | null>;
  count(args?: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<unknown>;
  update(args: Record<string, unknown>): Promise<unknown>;
  delete(args: Record<string, unknown>): Promise<unknown>;
}
```

It only lists `update` and `delete` (singular), not `updateMany`/`deleteMany`. So the "row count is 0" language might just be describing what happens conceptually - when no row matches the scoped where, the operation fails. In Prisma, `update`/`delete` with no matching row throws P2025.

I think the cleanest approach is:
1. Use `$extends` with a query interceptor
2. In the interceptor, for each operation type, inject tenantId appropriately
3. For `update` and `delete`, after calling the inner query, if it throws P2025, rethrow as ResourceNotFoundError

Actually wait - the `$extends` interceptor pattern in Prisma works like this:

```ts
const extended = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // modify args
        return query(modifiedArgs);
      }
    }
  }
});
```

The `query` function executes the actual query. If it throws (like P2025 for update/delete on non-existent record), that error propagates up.

So my approach:
1. In the `$allOperations` interceptor, modify `args` based on operation type
2. Call `query(modifiedArgs)` 
3. For `update` and `delete`, catch P2025 and throw ResourceNotFoundError

Let me also consider: the plan says the service should be REQUEST-scoped. But it uses `$extends` internally. The question is: do I create the extended client per-request, or share it?

The plan says: "Internally wraps `base.$extends({ query: { $allModels: … } })`" and "The extended client is REQUEST-scoped so each request sees only its own tenant."

So the extended client should be created per-request. Since `TenantContextService` is request-scoped and provides the tenantId at call time, I should create the extended client lazily or use a getter that reads the context.

Actually, re-reading: "reads `TenantContextService` (also REQUEST) at call time, not construction time."

This means the tenantId is read when a query is made, not when the service is constructed. So I can't bake the tenantId into the extension at construction time. Instead, the interceptor should read `this.ctx.tenantId` at the time the query is intercepted.

Since the service is REQUEST-scoped, each request gets its own instance. But even so, I should read the tenant at call time (when the interceptor fires), not at construction time.

Let me think about the implementation:

```ts
@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private extended: PrismaClient | null = null;

  constructor(
    private readonly base: PrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  private get client() {
    if (!this.extended) {
      this.extended = this.base.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, operation, args, query }) {
              const tenantId = this.ctx.tenantId;
              const modifiedArgs = this.injectTenantId(operation, args as any, tenantId);
              try {
                return await query(modifiedArgs);
              } catch (e) {
                if (isP2025(e) && (operation === 'update' || operation === 'delete')) {
                  throw new ResourceNotFoundError(model ?? 'resource');
                }
                throw e;
              }
            },
          },
        },
      });
    }
    return this.extended;
  }

  get customer() { return this.client.customer; }
  get plan() { return this.client.plan; }
  get order() { return this.client.order; }

  private injectTenantId(operation: string, args: any, tenantId: string): any {
    switch (operation) {
      case 'findMany':
      case 'findFirst':
      case 'findUnique':
      case 'count':
      case 'aggregate':
        args.where = { ...(args.where ?? {}), tenantId };
        break;
      case 'create':
        args.data = { ...(args.data ?? {}), tenantId };
        break;
      case 'createMany':
        // data could be array or single object
        if (Array.isArray(args.data)) {
          args.data = args.data.map(d => ({ ...d, tenantId }));
        } else {
          args.data = { ...args.data, tenantId };
        }
        break;
      case 'update':
      case 'delete':
      case 'updateMany':
      case 'deleteMany':
        args.where = { ...(args.where ?? {}), tenantId };
        break;
    }
    return args;
  }
}
```

Wait, but the plan says "if the resulting row count is 0, throw ResourceNotFoundError" for update/delete. In Prisma, `update` (singular) throws P2025 if no record matches. So catching P2025 is the right approach for singular update/delete.

For `updateMany`/`deleteMany`, they return `{ count: 0 }` without throwing. But the plan's TenantScopedModel interface only lists `update` and `delete`, not the Many variants. However, the plan also says "Every method present on the original delegate" in the comment. So I should handle all methods.

Let me look at what operations exist on a Prisma model delegate:
- `findMany`
- `findFirst`
- `findFirstOrThrow`
- `findUnique`
- `findUniqueOrThrow`
- `create`
- `createMany`
- `createManyAndReturn`
- `delete`
- `deleteMany`
- `update`
- `updateMany`
- `upsert`
- `count`
- `aggregate`
- `groupBy`

For the plan's purposes, I'll handle the main ones. Let me also consider `upsert` - it has both a `where` and `create`/`update` data. I should inject tenantId into both the where and the create data.

Actually, let me be more careful. The plan says:
- Read ops (`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`): merge `{ tenantId }` into `args.where`
- Write ops (`create`, `createMany`): merge `{ tenantId }` into `args.data`
- Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`

The plan doesn't explicitly mention `upsert`, `groupBy`, `findFirstOrThrow`, `findUniqueOrThrow`, `updateMany`, `deleteMany`, `createManyAndReturn`. I'll handle them reasonably:
- `findFirstOrThrow`, `findUniqueOrThrow`: treat like read ops (inject into where)
- `groupBy`: inject into where if present
- `upsert`: inject into where AND into create data
- `updateMany`, `deleteMany`: inject into where (no ResourceNotFoundError since many ops naturally return 0)
- `createManyAndReturn`: inject into data

Now, about the P2025 detection. I need to check if the error is a Prisma P2025 error. The error from Prisma is `PrismaClientKnownRequestError` with `.code === 'P2025'`. I can check for this.

Actually, let me reconsider. The plan says the service should expose `get customer()`, `get plan()`, `get order()`. But with `$extends`, the returned object has the same model delegates. So I can just return `this.client.customer` etc.

But wait - the type of `this.client` after `$extends` is complex. The plan defines a `TenantScopedModel<T>` interface, but I think for practical purposes, I can just return the extended model delegates directly. The TypeScript types will be inferred from the extension.

Let me also think about whether I need to handle `$transaction`. The plan mentions: "The extension makes this impossible by scoping every inner query." So `$transaction` should also be scoped. With `$extends`, the extension applies to all queries including those within transactions, so I don't need special handling.

But should I expose `$transaction`? The plan's TenantScopedModel interface doesn't show it, but the comment says "Every method present on the original delegate". I'll expose it if needed, but the plan's explicit getters are only `customer`, `plan`, `order`.

Let me also consider: should I handle the `tenant` model? The plan says the middleware uses the "base Prisma" (unscoped) to look up tenants. So `TenantPrismaService` should NOT expose a `tenant` model (or at least, the tenant lookup shouldn't go through it). The plan only lists `customer`, `plan`, `order` as exposed models.

Now let me also think about the `ResourceNotFoundError` for update/delete. The plan says:
"Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

In Prisma:
- `update({ where: {...} })` - throws P2025 if no record found
- `delete({ where: {...} })` - throws P2025 if no record found

So I'll catch P2025 for these operations and throw ResourceNotFoundError.

What about `findFirstOrThrow` and `findUniqueOrThrow`? They also throw P2025 if not found. But those are "expected" not-found cases that the caller might handle differently. Actually, the plan doesn't mention them specifically in the error handling section, so I'll let them throw their natural errors (which would be P2025 from Prisma). The service layer can catch those.

Actually wait - looking at the repository pattern in the plan:
```ts
findById(id: string): Promise<Customer | null>;
```
This returns null, not throws. So the repository would use `findUnique` or `findFirst` (which return null), not the OrThrow variants. Good.

And for update/delete in the repository:
```ts
update(id: string, input: UpdateCustomerInput): Promise<Customer>;
delete(id: string): Promise<void>;
```
These would use `update`/`delete` which throw P2025 → caught and converted to ResourceNotFoundError.

OK, I think I have a clear picture. Let me write the file.

One more consideration: the `// ASSUMPTION` comment. Do I need any? Let me check:
- `PrismaService` is shown in the references - it extends PrismaClient
- `TenantContextService` is shown - it has `tenantId` getter
- `ResourceNotFoundError` is shown in errors.ts
- The plan specifies everything clearly

I don't think I need any ASSUMPTION comments. Everything is clear from the plan and references.

Wait, one thing: the plan says `TenantPrismaService` is in `src/multi-tenant/tenant-prisma.service.ts`. The naming convention says "TS file: `kebab-case.role.ts`". So `tenant-prisma.service.ts` is correct.

Let me also check: the plan says the class should be `@Injectable({ scope: Scope.REQUEST })`. Yes, it's REQUEST-scoped.

For the import of Prisma types, I'll need to import from `@prisma/client`. The `PrismaClientKnownRequestError` is exported from there.

Let me finalize the implementation:

```ts
import { Injectable, Scope } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client';
import { PrismaService } from './prisma.service.js';
import { TenantContextService } from './tenant-context.service.js';
import { ResourceNotFoundError } from './errors.js';

@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private extended: ReturnType<PrismaService['$extends']> | null = null;

  constructor(
    private readonly base: PrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  get customer() {
    return this.getExtendedClient().customer;
  }

  get plan() {
    return this.getExtendedClient().plan;
  }

  get order() {
    return this.getExtendedClient().order;
  }

  private getExtendedClient() {
    if (!this.extended) {
      this.extended = this.base.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, operation, args, query }) {
              const tenantId = this.ctx.tenantId;
              const modifiedArgs = this.injectTenant(operation, args as Record<string, unknown>, tenantId);
              try {
                return await query(modifiedArgs as never);
              } catch (error) {
                if (
                  error instanceof PrismaClientKnownRequestError &&
                  error.code === 'P2025' &&
                  (operation === 'update' || operation === 'delete')
                ) {
                  throw new ResourceNotFoundError(model ?? 'resource');
                }
                throw error;
              }
            },
          },
        },
      });
    }
    return this.extended;
  }

  private injectTenant(
    operation: string,
    args: Record<string, unknown>,
    tenantId: string,
  ): Record<string, unknown> {
    switch (operation) {
      case 'findMany':
      case 'findFirst':
      case 'findFirstOrThrow':
      case 'findUnique':
      case 'findUniqueOrThrow':
      case 'count':
      case 'aggregate':
      case 'groupBy':
        args.where = { ...(args.where as object | undefined), tenantId };
        break;

      case 'create':
      case 'createManyAndReturn':
        args.data = { ...(args.data as object | undefined), tenantId };
        break;

      case 'createMany':
        if (Array.isArray(args.data)) {
          args.data = (args.data as object[]).map((d) => ({ ...d, tenantId }));
        } else {
          args.data = { ...(args.data as object | undefined), tenantId };
        }
        break;

      case 'update':
      case 'updateMany':
      case 'delete':
      case 'deleteMany':
        args.where = { ...(args.where as object | undefined), tenantId };
        break;

      case 'upsert':
        args.where = { ...(args.where as object | undefined), tenantId };
        args.create = { ...(args.create as object | undefined), tenantId };
        break;
    }
    return args;
  }
}
```

Hmm, wait. Let me reconsider the type of `extended`. The return type of `$extends` is complex in Prisma. Let me just use a type assertion or let TypeScript infer it.

Actually, looking at Prisma's types, `$extends` returns `PrismaClient<...>` with the extensions applied. The type is very complex. I'll just let TypeScript handle it and not annotate the field explicitly, or use a generic.

Let me simplify: I'll store it as `any` type or just let the getter return the model delegates without explicit typing. Actually, since the plan defines `TenantScopedModel<T>` but that's more of a conceptual interface, I'll just return the actual Prisma delegates from the extended client.

Let me also reconsider whether I should handle `groupBy` - it has a `by` field and optionally a `where`. If there's no `where`, should I add one? I think yes, for consistency.

Actually, for `groupBy`, the `where` is optional. If it's not present, I should still add `{ tenantId }`. My code handles this with the spread.

One more thing: the plan says "handlers never pass tenantId manually." This is enforced by the extension - even if someone passes tenantId, it would just be overwritten. Good.

Let me also think about whether the `query` function in the interceptor should receive the modified args or if I need to do something else. In Prisma's extension API:

```ts
query: {
  $allModels: {
    async $allOperations({ model, operation, args, query }) {
      // `args` is the original args
      // `query(args)` executes the query with the given args
      return query(modifiedArgs);
    }
  }
}
```

Yes, I pass the modified args to `query()`. That's correct.

I think my implementation is solid. Let me write the final version.
```

## reply

```ts
import { Injectable, Scope } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client';
import { PrismaService } from './prisma.service.js';
import { TenantContextService } from './tenant-context.service.js';
import { ResourceNotFoundError } from './errors.js';

@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private extended: ReturnType<PrismaService['$extends']> | null = null;

  constructor(
    private readonly base: PrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  get customer() {
    return this.getExtendedClient().customer;
  }

  get plan() {
    return this.getExtendedClient().plan;
  }

  get order() {
    return this.getExtendedClient().order;
  }

  private getExtendedClient() {
    if (!this.extended) {
      this.extended = this.base.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, operation, args, query }) {
              const tenantId = this.ctx.tenantId;
              const modifiedArgs = this.injectTenant(
                operation,
                args as Record<string, unknown>,
                tenantId,
              );
              try {
                return await query(modifiedArgs as never);
              } catch (error) {
                if (
                  error instanceof PrismaClientKnownRequestError &&
                  error.code === 'P2025' &&
                  (operation === 'update' || operation === 'delete')
                ) {
                  throw new ResourceNotFoundError(model ?? 'resource');
                }
                throw error;
              }
            },
          },
        },
      });
    }
    return this.extended;
  }

  private injectTenant(
    operation: string,
    args: Record<string, unknown>,
    tenantId: string,
  ): Record<string, unknown> {
    switch (operation) {
      case 'findMany':
      case 'findFirst':
      case 'findFirstOrThrow':
      case 'findUnique':
      case 'findUniqueOrThrow':
      case 'count':
      case 'aggregate':
      case 'groupBy':
        args.where = { ...(args.where as object | undefined), tenantId };
        break;

      case 'create':
      case 'createManyAndReturn':
        args.data = { ...(args.data as object | undefined), tenantId };
        break;

      case 'createMany':
        if (Array.isArray(args.data)) {
          args.data = (args.data as object[]).map((d) => ({ ...d, tenantId }));
        } else {
          args.data = { ...(args.data as object | undefined), tenantId };
        }
        break;

      case 'update':
      case 'updateMany':
      case 'delete':
      case 'deleteMany':
        args.where = { ...(args.where as object | undefined), tenantId };
        break;

      case 'upsert':
        args.where = { ...(args.where as object | undefined), tenantId };
        args.create = { ...(args.create as object | undefined), tenantId };
        break;
    }
    return args;
  }
}
```
