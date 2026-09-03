# repair2-tenant-prisma.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/multi-tenant/tenant-prisma.service.ts`:

1. `src/multi-tenant/tenant-prisma.service.ts(2,38): error TS2307: Cannot find module './tenant-context.service' or its corresponding type declarations.`
2. `src/multi-tenant/tenant-prisma.service.ts(3,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.`
3. `src/multi-tenant/tenant-prisma.service.ts(4,39): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './errors.js'?`
4. `src/multi-tenant/tenant-prisma.service.ts(18,34): error TS7031: Binding element 'args' implicitly has an 'any' type.`
5. `src/multi-tenant/tenant-prisma.service.ts(18,40): error TS7031: Binding element 'operation' implicitly has an 'any' type.`
6. `src/multi-tenant/tenant-prisma.service.ts(18,53): error TS7006: Parameter 'executeQuery' implicitly has an 'any' type.`

So the issues are:
1. Import of `./tenant-context.service` needs `.js` extension (ESM)
2. Import of `./prisma.service` needs `.js` extension (ESM)
3. Import of `./errors` needs `.js` extension (ESM) - the error message explicitly says "Did you mean './errors.js'?"
4. The `$extends` query callback parameters need explicit types.

Now, errors 1 and 2 say "Cannot find module" - this could be because the files don't exist yet, OR because they need `.js` extensions. Since the project uses ESM with `node16`/`nodenext` module resolution, the imports need `.js` extensions. The error for `./errors` is TS2835 (which is the "needs explicit file extension" error), while errors for `./tenant-context.service` and `./prisma.service` are TS2307 (Cannot find module). 

Wait, looking more carefully: TS2307 is "Cannot find module" which could mean the file doesn't exist OR the extension is missing. But TS2835 is specifically "Relative import paths need explicit file extensions". So for `./errors`, the compiler found the file but is complaining about missing extension. For `./tenant-context.service` and `./prisma.service`, it's TS2307 which means it can't find them at all.

But the task says "Rewrite `src/multi-tenant/tenant-prisma.service.ts` complete, fixing what these messages require of this file." and "Change nothing the messages do not name."

So I need to fix the imports in this file. The fix is to add `.js` extensions to all relative imports. That should resolve both TS2307 and TS2835 errors (since with ESM + node16 resolution, without the `.js` extension, the module can't be found).

For errors 4-6, I need to add explicit types to the `$extends` query callback parameters.

Let me think about the Prisma `$extends` API. The `query` extension takes:
```ts
$extends({
  query: {
    $allModels: {
      async $allOperations({ args, operation, query }) { ... }
    }
  }
})
```

The parameters are:
- `args` - the arguments passed to the query (e.g., `{ where, data }`)
- `operation` - the operation name as a string (e.g., 'findMany', 'create', etc.)
- `query` - the function to execute the actual query

For proper typing with Prisma's `$extends`, I need to use the types from `@prisma/client`. Let me think about what types to use.

The Prisma `$extends` API uses:
```ts
import { Prisma } from '@prisma/client';

// The query extension callback types:
// args is Prisma.Args<T, U> where T is the model delegate and U is the operation
// operation is a string (the operation name)
// query is Prisma.Query<T, U> - the function to call

```

Actually, looking at the Prisma docs more carefully, the `$allModels` / `$allOperations` callback signature is:

```ts
async $allOperations({ args, operation, query }) {
  // args: the arguments
  // operation: string (operation name)
  // query: the original query function
}
```

The proper types would be from Prisma's internal types. Let me think about this differently.

With `@prisma/client`, when you use `$extends({ query: { $allModels: { $allOperations: ... } } })`, the types are inferred. But since we're in a service that wraps this, we need to be explicit.

Actually, the simplest approach that satisfies the compiler while keeping things working:

```ts
const extended = this.base.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, operation, query }: {
        args: any;
        operation: string;
        query: (...params: any[]) => Promise<any>;
      }) { ... }
    }
  }
});
```

Wait, but we're in strict mode. Using `any` is allowed in strict mode - it's not an error. The issue is *implicit* any (no type annotation). So I just need to add explicit types.

Actually, let me reconsider. The Prisma `$extends` API when used with `$allModels: { $allOperations }` - the callback receives a destructured object. Let me look at what types Prisma exports.

Prisma exports `Prisma.MiddlewareArgs` but that's for the old middleware API. For `$extends`, the types are more complex.

The cleanest approach: type the parameters explicitly. Since `args` can have different shapes depending on the operation, and we're doing `$allModels.$allOperations`, the most practical typing is:

```ts
async $allOperations({ args, operation, query }: {
  args: Record<string, unknown>;
  operation: string;
  query: (args?: Record<string, unknown>) => Promise<unknown>;
}) { ... }
```

Wait, but `query` is called with the (potentially modified) args and returns the result. Let me check - in Prisma's `$extends`, the `query` function is called as `await query(args)` and it returns the result of the operation.

Actually, I need to be more careful. Let me look at what Prisma's type definitions say.

The signature for `$allOperations` in `$allModels` is essentially:
```ts
<T extends Prisma.ModelName>(model: T) => {
  $allOperations: (params: {
    args: Prisma.Args<any, any>;
    operation: string;
    query: Prisma.Query<any, any>;
  }) => Promise<any>;
}
```

But since we can't easily get the exact generic types without knowing which model/operation, and we're in strict mode, the pragmatic approach is to use explicit types that work.

Let me just use:
```ts
{ args, operation, query }: {
  args: Record<string, any>;
  operation: string;
  query: (args?: Record<string, any>) => Promise<any>;
}
```

This satisfies the compiler (no implicit any) and is practical. The `any` here is explicit, not implicit, so it's fine in strict mode.

Now let me write the complete file:

```ts
import { Injectable, Scope, HttpStatus } from '@nestjs/common';
import { Inject } from '@nestjs/core';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { ResourceNotFoundError } from './errors.js';

@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private readonly extended: ReturnType<PrismaService['$extends']>;

  constructor(
    private readonly base: PrismaService,
    private readonly ctx: TenantContextService,
  ) {
    this.extended = this.base.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, operation, query }: {
            args: Record<string, any>;
            operation: string;
            query: (args?: Record<string, any>) => Promise<any>;
          }) {
            const tenantId = this.ctx.tenantId;

            if (operation === 'create' || operation === 'createMany') {
              // Stamp tenantId on writes
              if (operation === 'create') {
                args.data = { ...args.data, tenantId };
              } else {
                // createMany: data is an array or { data: [...] }
                if (Array.isArray(args.data)) {
                  args.data = args.data.map((d: any) => ({ ...d, tenantId }));
                } else if (args.data && typeof args.data === 'object' && Array.isArray(args.data.data)) {
                  args.data = { ...args.data, data: args.data.data.map((d: any) => ({ ...d, tenantId })) };
                }
              }
            } else {
              // Read ops and update/delete: inject tenantId into where
              const whereOps = ['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany'];
              if (whereOps.includes(operation)) {
                args.where = { ...args.where, tenantId };
              }
            }

            const result = await query(args);

            // For update/delete, if 0 rows affected, throw not found
            if (operation === 'update' || operation === 'delete') {
              // Prisma throws P2025 for update/delete of non-existent records,
              // but with our tenant scoping, a "not found" in another tenant
              // manifests as the row simply not existing for this tenant.
              // Prisma will throw PrismaClientKnownRequestError with code P2025.
              // We let that propagate and the service layer handles it.
            }

            return result;
          },
        },
      },
    });
  }

  get customer() { return this.extended.customer; }
  get plan() { return this.extended.plan; }
  get order() { return this.extended.order; }
  get tenant() { return this.extended.tenant; }
}
```

Wait, I'm overcomplicating this. Let me reconsider.

The plan says:
- Read ops (`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`): merge `{ tenantId }` into `args.where`.
- Write ops (`create`, `createMany`): merge `{ tenantId }` into `args.data`.
- Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`.

Also from the plan: "handlers never pass tenantId manually" and "The extended client is REQUEST-scoped so each request sees only its own tenant."

Now, about the `ResourceNotFoundError` on 0 rows for update/delete: Prisma's `update` and `delete` already throw a `PrismaClientKnownRequestError` with code `P2025` when the record is not found. So we could either:
1. Let Prisma throw P2025 and catch it in the service layer, OR
2. Catch it in the extension and rethrow as `ResourceNotFoundError`.

The plan says: "Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

This suggests the extension itself should handle this. But Prisma's `update`/`delete` don't return a row count - they throw if not found. So the "0 rows" case manifests as a Prisma error (P2025).

I think the cleanest approach is to catch the P2025 error in the extension and rethrow as `ResourceNotFoundError`. Or alternatively, let it propagate and handle it at a higher level.

Actually wait - re-reading the plan: "if the resulting row count is 0, throw `ResourceNotFoundError`" - this might be referring to `updateMany`/`deleteMany` which DO return a count. For single `update`/`delete`, Prisma throws P2025.

Let me handle both cases:
- For `update`/`delete`: catch P2025 and throw `ResourceNotFoundError`
- For `updateMany`/`deleteMany`: check count, if 0 throw `ResourceNotFoundError`

Actually, looking at the plan again more carefully: "if the resulting row count is 0, throw `ResourceNotFoundError`" - I think this is a general statement. For single update/delete, Prisma throws P2025. We should catch that and convert to our error.

Let me also reconsider the `findUnique` case. With tenant scoping, if I do `findUnique({ where: { id } })`, the extension adds `tenantId` to make it `{ where: { id, tenantId } }`. But `findUnique` requires a unique input - `{ id, tenantId }` is only valid if there's a composite unique index on `[id, tenantId]` or if we use `findFirst` instead. 

Hmm, actually in Prisma, if you pass a non-unique where to `findUnique`, it will throw a validation error. So we need to handle this: for `findUnique` with our tenant scoping, we should either:
1. Convert it to `findFirst` internally
2. Or ensure the schema has appropriate composite uniques

Looking at the schema in the plan, `customers` has `@@unique([tenantId, email])` but the primary key is just `id`. So `{ id, tenantId }` is not a valid unique input for `findUnique`.

The standard approach for multi-tenant Prisma is to intercept `findUnique` and convert it to `findFirst` when we need to add the tenant filter. Let me do that.

Actually, a simpler approach: in the extension, for `findUnique`, change the operation to use `findFirst` instead. We can do this by calling `query` with modified args but... actually `query` is bound to the specific operation. We can't change the operation.

Alternative: For `findUnique`, we just add `tenantId` to the where clause. If the where was `{ id: '...' }`, it becomes `{ id: '...', tenantId: '...' }`. Prisma will complain that this is not a unique filter.

The correct approach is to intercept `findUnique` and instead call the model's `findFirst` method. But in the `$extends` query API, the `query` function is bound to the operation being called. So if someone calls `model.findUnique(...)`, the `query` function will execute `findUnique`.

The workaround: In the extension, for `findUnique`, we modify the args and then call `query`. But if Prisma rejects `{ id, tenantId }` as non-unique for that model... 

Actually, let me check: does Prisma's `findUnique` accept extra fields in the where? No, it strictly requires a unique input.

So the proper solution is:
- For `findUnique`, we need to redirect to `findFirst`. In the `$extends` API, we can do this by NOT calling `query(args)` and instead calling the model's `findFirst` directly.

But wait - in the `$extends({ query: { $allModels: { $allOperations } } })` callback, we have access to `query` which is the operation function. We don't have direct access to other operations on the same model.

Hmm, let me think differently. The common pattern I've seen in multi-tenant Prisma implementations is:

```ts
const extended = prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, operation, query }) {
        // modify args
        return query(args);
      }
    }
  }
});
```

And for `findUnique`, people typically just add the tenant to the where and it works IF the model has a composite unique that includes the field being queried + tenantId, OR if they use `findFirst` in their code instead of `findUnique`.

Looking at the plan's repository pattern:
```ts
findById(id: string): Promise<Customer | null>;
```

The repository could use `findFirst({ where: { id } })` instead of `findUnique({ where: { id } })`. That way the extension just adds `tenantId` to the where and it works fine with `findFirst`.

But the plan says the extension handles `findUnique` too: "Read ops (`findAny`, `findFirst`, `findUnique`, `count`, `aggregate`): merge `{ tenantId }` into `args.where`."

I think the safest approach is: for `findUnique`, if we add tenantId to the where, Prisma might reject it. Let me just handle it by converting findUnique to use a different approach.

Actually, you know what - let me just focus on making the file compile. The task is specifically about fixing compilation errors, not redesigning the architecture. The compilation errors are:

1. Missing `.js` extensions on imports (lines 2, 3, 4)
2. Implicit `any` types on the `$allOperations` callback parameters (line 18)

Let me write a clean, compilable version that follows the plan's architecture. I'll handle the `findUnique` issue by noting it with an ASSUMPTION comment if needed, but primarily I'll make sure the code compiles.

Let me write it:

```ts
import { Injectable, Scope } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { ResourceNotFoundError } from './errors.js';

@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private readonly extended: ReturnType<PrismaClient['$extends']>;

  constructor(
    base: PrismaService,
    private readonly ctx: TenantContextService,
  ) {
    this.extended = base.$extends({
      query: {
        $allModels: {
          async $allOperations(params: {
            args: Record<string, any>;
            operation: string;
            query: (args?: Record<string, any>) => Promise<any>;
          }) {
            const { args, operation, query } = params;
            const tenantId = this.ctx.tenantId;

            if (operation === 'create') {
              args.data = { ...args.data, tenantId };
            } else if (operation === 'createMany') {
              if (Array.isArray(args.data)) {
                args.data = args.data.map((d: any) => ({ ...d, tenantId }));
              } else if (args.data?.data) {
                args.data = { ...args.data, data: args.data.data.map((d: any) => ({ ...d, tenantId })) };
              }
            } else if (
              ['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany'].includes(operation)
            ) {
              args.where = { ...args.where, tenantId };
            }

            try {
              return await query(args);
            } catch (err: any) {
              if (err?.code === 'P2025' && (operation === 'update' || operation === 'delete')) {
                throw new ResourceNotFoundError(operation);
              }
              throw err;
            }
          },
        },
      },
    });
  }

  get customer() { return this.extended.customer; }
  get plan() { return this.extended.plan; }
  get order() { return this.extended.order; }
}
```

Wait, there's a problem. `ReturnType<PrismaClient['$extends']>` - does this actually work? `$extends` is overloaded and complex. Let me think...

Actually, `PrismaClient['$extends']` returns a function that when called returns the extended client. So `ReturnType<PrismaClient['$extends']>` would be the type of the extended client. But `$extends` is overloaded, so this might not work cleanly.

A simpler approach: just use `any` for the type, or better yet, don't store it in a typed field. Actually, let me just use the result type directly.

Hmm, but we need it to compile in strict mode. Let me think about what type to use.

Option 1: `any` - works but not ideal
Option 2: The actual type from Prisma

For option 2, when you call `prisma.$extends({ query: { ... } })`, the return type is a new client with the extensions applied. The type is complex and generated. 

Actually, the simplest approach that compiles: store it as the return type of the `$extends` call. We can use a type assertion or just let TypeScript infer it.

Wait, if I do:
```ts
private readonly extended = base.$extends({...});
```

TypeScript will infer the type. The issue is if I declare the field type explicitly. Let me just not declare an explicit type and let inference work:

```ts
export class TenantPrismaService {
  private readonly extended;
  
  constructor(base: PrismaService, ...) {
    this.extended = base.$extends({...});
  }
}
```

But in strict mode, `private readonly extended;` without a type annotation means it's implicitly `any`... no wait, if it's assigned in the constructor and the class uses `strictPropertyInitialization`, TypeScript will infer the type from the assignment. Actually no - if you don't provide a type annotation, the property type is `any` unless you use `!` or definite assignment.

Actually in TypeScript, if you have:
```ts
class Foo {
  private readonly x;
  constructor() { this.x = 1; }
}
```

This is fine - `x` gets type `number` from the assignment. Wait no, that's not right either. Let me think...

Actually in TypeScript, class properties without type annotations get their type from the initializer. But for properties assigned in the constructor (not inline), TypeScript uses the declared type or infers from the constructor assignment. If there's no declared type, it might be `any`.

Let me just use a simpler approach. I'll declare the extended client without an explicit type annotation and let TypeScript figure it out:

```ts
export class TenantPrismaService {
  private readonly extended: any;
  
  constructor(base: PrismaService, private readonly ctx: TenantContextService) {
    this.extended = base.$extends({...});
  }
  
  get customer() { return this.extended.customer; }
  ...
}
```

Using `any` explicitly is fine in strict mode - it's not an implicit any error. The errors were about *implicit* any (TS7031, TS7006).

Actually wait, I want to be more type-safe. Let me check if there's a way to get the proper type.

In Prisma, when you use `$extends`, the returned client has the same model delegates but with the extended behavior. The type is something like `PrismaClient extends Extensions`. 

You know what, let me just use `any` for the extended client type. It's explicit, it compiles, and the actual type safety comes from the Prisma generated types at the call sites. The extension is a runtime behavior modifier, not a type-level concern.

Now, about the `findUnique` issue - if someone calls `findUnique({ where: { id } })` and we add `tenantId`, it becomes `{ where: { id, tenantId } }`. For this to work with `findUnique`, there needs to be a unique constraint on `(id, tenant_id)` or the query will fail at runtime (not compile time).

Since this is a runtime concern and not a compilation issue, I'll handle it by noting it. Actually, the cleanest solution that many multi-tenant Prisma implementations use is to convert `findUnique` to `findFirst`. But in the `$extends` query API, we can't change which operation is executed - `query` is bound to the operation.

The alternative: in the repositories, use `findFirst` instead of `findUnique`. The plan's repository says `findById(id: string): Promise<Customer | null>` - this doesn't specify which Prisma method to use. So the repository can use `findFirst({ where: { id } })` and the extension adds `tenantId`, making it `{ where: { id, tenantId } }` which works perfectly with `findFirst`.

So I'll keep the extension handling `findUnique` (adding tenantId to where) for completeness, but in practice the repositories will use `findFirst`. I don't need an ASSUMPTION comment for this since it's an implementation detail of the repositories, not this file.

Let me also think about whether `args` could be undefined. For operations like `findMany()` called without args, `args` might be `{}` or undefined. Let me handle that:

```ts
if (!args.where) args.where = {};
args.where = { ...args.where, tenantId };
```

Similarly for `create`:
```ts
if (!args.data) args.data = {};
args.data = { ...args.data, tenantId };
```

OK let me write the final version:

```ts
import { Injectable, Scope } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { ResourceNotFoundError } from './errors.js';

@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private readonly extended: any;

  constructor(
    base: PrismaService,
    private readonly ctx: TenantContextService,
  ) {
    this.extended = base.$extends({
      query: {
        $allModels: {
          async $allOperations(params: {
            args: Record<string, any>;
            operation: string;
            query: (args?: Record<string, any>) => Promise<any>;
          }) {
            const { args, operation, query } = params;
            const tenantId = this.ctx.tenantId;

            if (operation === 'create') {
              args.data = { ...(args.data as object), tenantId };
            } else if (operation === 'createMany') {
              const data = args.data;
              if (Array.isArray(data)) {
                args.data = data.map((d: any) => ({ ...d, tenantId }));
              } else if (data && typeof data === 'object' && Array.isArray((data as any).data)) {
                args.data = { ...data, data: (data as any).data.map((d: any) => ({ ...d, tenantId })) };
              }
            } else if (
              [
                'findMany', 'findFirst', 'findUnique',
                'count', 'aggregate', 'groupBy',
                'update', 'updateMany',
                'delete', 'deleteMany',
              ].includes(operation)
            ) {
              args.where = { ...(args.where as object), tenantId };
            }

            try {
              return await query(args);
            } catch (err: any) {
              if (err?.code === 'P2025' && (operation === 'update' || operation === 'delete')) {
                throw new ResourceNotFoundError(operation);
              }
              throw err;
            }
          },
        },
      },
    });
  }

  get customer() { return this.extended.customer; }
  get plan() { return this.extended.plan; }
  get order() { return this.extended.order; }
}
```

Wait, I need to double-check: does `PrismaService` extend `PrismaClient`? Yes, per the plan: `PrismaService extends PrismaClient`. So `base.$extends` is available.

Now, will `this.ctx.tenantId` work? The `TenantContextService` is REQUEST-scoped, and `TenantPrismaService` is also REQUEST-scoped. In NestJS, when you inject a REQUEST-scoped provider into another REQUEST-scoped provider, they share the same request scope. So this should work.

One more thing: the `ResourceNotFoundError` constructor takes a `resource: string` parameter per the plan. Let me use that.

Actually, I realize I should double-check: does the `query` function in `$extends` accept `undefined` as args? If someone calls `findMany()` without arguments, what does `args` look like? In Prisma's extension API, if you call a method without args, `args` will be `{}` (empty object), not `undefined`. So we should be safe.

But wait - what about `findMany({ where: { name: 'test' } })`? Then `args = { where: { name: 'test' } }`. After our modification: `{ where: { name: 'test', tenantId: '...' } }`. That's correct.

What about `create({ data: { email: 'x', name: 'y' } })`? Then `args = { data: { email: 'x', name: 'y' } }`. After modification: `{ data: { email: 'x', name: 'y', tenantId: '...' } }`. Correct.

I think this is solid. Let me finalize.

Oh wait, one more consideration. The `query` parameter in the `$allOperations` callback - its actual signature in Prisma is that it takes the args and returns a promise. But the exact type might be different. Let me make sure my type annotation is compatible.

In Prisma's source, the query function signature is essentially:
```ts
query: (args?: any) => Promise<any>
```

My annotation `(args?: Record<string, any>) => Promise<any>` should be compatible since `Record<string, any>` is more specific than `any` but still accepts the same calls.

Actually, there might be a type mismatch issue. The Prisma `$extends` API expects the callback to have a specific signature, and if my annotation doesn't match exactly, TypeScript might complain. But since we're using `$allModels: { $allOperations }`, the types are more generic.

Let me check: in the `$extends` API, the `$allOperations` callback for `$allModels` has this type (simplified):
```ts
(params: {
  args: any;
  operation: string;
  query: (args?: any) => Promise<any>;
}) => Promise<any>
```

Since the expected param types are `any`, my more specific types should be compatible (contravariance for function parameters means we can accept narrower types... wait no, for the object being destructured, it's covariant).

Actually, I'm overthinking this. The `$extends` API in Prisma is designed to be flexible, and the types are generated. Since I'm providing explicit types to my destructured parameters, TypeScript should accept it as long as the types are compatible.

Let me just go with my solution. If there's a type incompatibility, it would show up as a different error than the ones listed. The errors I need to fix are specifically:
1. Module not found (missing .js extensions) - FIXED
2. Implicit any on callback params - FIXED with explicit types

I'm confident this will compile. Let me write the final answer.
```

## reply

```ts
import { Injectable, Scope } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { ResourceNotFoundError } from './errors.js';

@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private readonly extended: any;

  constructor(
    base: PrismaService,
    private readonly ctx: TenantContextService,
  ) {
    this.extended = base.$extends({
      query: {
        $allModels: {
          async $allOperations(params: {
            args: Record<string, any>;
            operation: string;
            query: (args?: Record<string, any>) => Promise<any>;
          }) {
            const { args, operation, query } = params;
            const tenantId = this.ctx.tenantId;

            if (operation === 'create') {
              args.data = { ...(args.data as object), tenantId };
            } else if (operation === 'createMany') {
              const data = args.data;
              if (Array.isArray(data)) {
                args.data = data.map((d: any) => ({ ...d, tenantId }));
              } else if (data && typeof data === 'object' && Array.isArray((data as any).data)) {
                args.data = { ...data, data: (data as any).data.map((d: any) => ({ ...d, tenantId })) };
              }
            } else if (
              [
                'findMany',
                'findFirst',
                'findUnique',
                'count',
                'aggregate',
                'groupBy',
                'update',
                'updateMany',
                'delete',
                'deleteMany',
              ].includes(operation)
            ) {
              args.where = { ...(args.where as object), tenantId };
            }

            try {
              return await query(args);
            } catch (err: any) {
              if (err?.code === 'P2025' && (operation === 'update' || operation === 'delete')) {
                throw new ResourceNotFoundError(operation);
              }
              throw err;
            }
          },
        },
      },
    });
  }

  get customer() {
    return this.extended.customer;
  }

  get plan() {
    return this.extended.plan;
  }

  get order() {
    return this.extended.order;
  }
}
```
