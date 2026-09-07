# repair2-prisma.service.ts

## reasoning

```
Let me analyze the compiler errors to understand what's needed in `src/prisma/prisma.service.ts`:

1. `src/customer/customer.repository.ts` accesses `.client` on `PrismaService` — so `PrismaService` must expose a `client` property.
2. `src/tenant/
```

## reply

.ts` accesses `.raw` on `PrismaService` — so `PrismaService` must expose a `raw` property.
3. `test/customer.spec.ts` accesses `.raw` on `PrismaService` — same as above.
4. The type error on line 27 says the return type of `$extends()` is not assignable to `PrismaClient<PrismaClientOptions, never, DefaultArgs> | null`. The fix is to not type the field as `PrismaClient` but use the actual extended type.

So `PrismaService` needs:
- A `client` property (the tenant-scoped Prisma client with the extension applied)
- A `raw` property (likely the raw/underlying Prisma client for operations that need direct access, or a `$queryRaw`/`$executeRaw` proxy)

Looking at the error: `Property 'client' does not exist on type 'PrismaService'` and `Property 'raw' does not exist on type 'PrismaService'`.

The type error says the `$extends()` result can't be assigned to `PrismaClient<PrismaClientOptions, never, DefaultArgs> | null`. The fix is to use the proper type from `PrismaClient` with `$extends`.

Let me think about what the type should be. When you call `prisma.$extends()`, the return type is `DynamicClientExtensionThis<...>`. We should type the field as that, or simply use `ReturnType<typeof this.$extends>` or just let TypeScript infer it.

Actually, the simplest approach: type the property as the return type of `$extends`. We can use `PrismaClient` with the extension type, or we can use a type assertion, or we can use the `Prisma.TransactionClient` type... 

Actually the cleanest way is to not explicitly type the field and let it be inferred, or use the proper type. Let me think...

The issue is that `$extends()` returns a type that's not assignable to `PrismaClient<PrismaClientOptions, never, DefaultArgs>`. The fix is to either:
1. Not annotate the type (let it infer)
2. Use the correct type annotation

For a NestJS service with a private field, we can use `as any` or we can properly type it. The proper way is to use the return type.

Actually, the simplest fix that's type-safe: use `PrismaClient` as the base and then the extension result type. But the cleanest is to just not annotate the type explicitly, or use a type that matches.

Let me think about what `raw` should be. Looking at the tenant repository and test usage, `.raw` is likely the base `PrismaClient` (without the tenant extension) used for operations that need to bypass tenant scoping (like looking up a tenant by ID in the middleware, or running raw SQL in tests).

So the service should have:
- `private readonly raw: PrismaClient` — the base client (no extension)
- `client` — the extended client with tenant scoping

Wait, but `client` is accessed as a public property from repositories. Let me re-read the errors:

- `src/customer/customer.repository.ts(10,24): error TS2339: Property 'client' does not exist on type 'PrismaService'` — line 24 is column 24, which is likely `this.prisma.client` where `prisma` is the injected `PrismaService`.

- `src/tenant/tenant.repository.ts(9,24): error TS2339: Property 'raw' does not exist on type 'PrismaService'` — same pattern.

So `PrismaService` needs public `client` and `raw` properties.

For the type issue on line 27: the `$extends()` call returns a type that's not `PrismaClient`. The fix is to not type the field as `PrismaClient` but use the correct type.

The best approach: use `ReturnType` or just let TypeScript infer. But since it's a class field, we need to either:
1. Declare it without a type annotation (but then it won't be `readonly` in the same way)
2. Use a type that matches

Actually, the simplest and most correct approach:

```typescript
private readonly base: PrismaClient;
readonly client: ReturnType<typeof this.createExtendedClient>;
```

No, that's circular. Let me just do:

```typescript
readonly raw: PrismaClient;
readonly client: PrismaClient extends infer T ? T extends PrismaClient<PrismaClientOptions, any, any> ? T : never : never;
```

That's ugly. The cleanest is:

```typescript
readonly raw: PrismaClient;
readonly client: ReturnType<PrismaClient<PrismaClientOptions, never, DefaultArgs>['$extends']>;
```

Hmm, but `$extends` is overloaded. Let me think differently.

Actually, the simplest fix: just don't annotate the type of `client`, use a definite assignment or let it be inferred from the constructor.

```typescript
export class PrismaService extends PrismaClient {
  readonly client: ReturnType<typeof this.$extends>;
```

No, `typeof this.$extends` doesn't work in a type position.

The pragmatic solution: use a type alias or just cast.

Actually, looking at Prisma's types more carefully, `$extends` returns `this` in some overloads but actually returns a new type. The proper type is complex.

The simplest working solution: 

```typescript
readonly client: PrismaClient; // with a cast at assignment
```

But the error says the extended type IS NOT assignable to `PrismaClient`. So we can't just annotate it as `PrismaClient`.

Options:
1. Use `any` — bad practice but works
2. Use a more specific type
3. Don't annotate, use a getter or a field with inferred type

Actually, the best approach for a NestJS DI pattern:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly raw: PrismaClient;
  readonly client: ReturnType<PrismaClient['$extends']>;

  constructor() {
    this.raw = new PrismaClient();
    this.client = this.raw.$extends({
      // ...
    });
  }
  // ...
}
```

Wait, `ReturnType<PrismaClient['$extends']>` — does that work? `$extends` is a method on the instance, so `PrismaClient['$extends']` should give the method type, and `ReturnType<>` should give the return type. But it's overloaded...

Actually, let me think about this differently. The real issue is just the type annotation. The simplest fix that the compiler will accept:

```typescript
readonly client: ReturnType<PrismaClient<PrismaClientOptions, never, DefaultArgs>['$extends']>;
```

Hmm, but `$extends` might not be directly accessible as a property type like that.

You know what, the simplest and most pragmatic fix: just use the inferred type by not annotating, or use a workaround.

Actually, I just realized: if the class extends `PrismaClient`, then `this` IS a `PrismaClient`, and `$extends` returns a type that's structurally compatible but not nominally. The cleanest fix:

```typescript
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService {
  readonly raw: PrismaClient;
  // Use the type that $extends actually returns
  readonly client: ReturnType<PrismaClient['$extends']>;
```

Actually wait - I think the issue is simpler. Let me re-read the error:

```
src/prisma/prisma.service.ts(27,5): error TS2322: Type 'DynamicClientExtensionThis<...>' is not assignable to type 'PrismaClient<PrismaClientOptions, never, DefaultArgs> | null'.
```

So line 27 is where the field is being assigned. The field is currently typed as `PrismaClient<PrismaClientOptions, never, DefaultArgs> | null` (or similar). The fix is to change the type annotation to match what `$extends()` actually returns.

The simplest correct approach: don't explicitly type the field, let TypeScript infer it. In a class, you can do:

```typescript
readonly client!: ReturnType<...>; // still need a type
```

Or better, just remove the explicit type and let it be inferred from the constructor assignment:

Actually in TypeScript, class properties with `readonly` that are assigned in the constructor DO get their type inferred if you don't annotate them. Wait, no — if you declare `readonly client;` without a type, TypeScript will infer it from the assignment in the constructor.

Let me just go with:

```typescript
private _client: ReturnType<PrismaClient['$extends']>;

get client() {
  return this._client;
}
```

Hmm, that's overcomplicating it. Let me just do the simplest thing:

```typescript
readonly client: any;
```

No, that defeats the purpose.

OK let me think about what actually works. In Prisma, when you do `prisma.$extends(...)`, the return type is a specific type. The way to reference it is:

For Prisma 5+, you can do:
```typescript
type ExtendedClient = ReturnType<typeof prisma.$extends>;
```

But in a class context without an instance, you can't do that easily.

The practical solution that many people use:

```typescript
import { PrismaClient, Prisma } from '@prisma/client';

type ExtendedPrisma = ReturnType<PrismaClient['$extends']>;
```

Wait, `$extends` is overloaded with multiple signatures. `ReturnType` will pick the last overload. That might not be what we want.

Actually, you know what, let me just look at what the simplest fix is. The error is on line 27 where the assignment happens. The current code probably has:

```typescript
private client: PrismaClient | null = null;
```

or

```typescript
readonly client: PrismaClient<PrismaClientOptions, never, DefaultArgs> | null;
```

And the fix is to change the type to match what `$extends` returns. The most pragmatic and correct approach:

Since we can't easily name the exact return type of `$extends` in a generic way, and since the extension IS a valid Prisma client (just with extra type-level information), we can use a type assertion:

```typescript
this.client = this.raw.$extends({...}) as unknown as PrismaClient;
```

But that loses the type safety of the extension.

Alternatively, we can just not annotate the type:

```typescript
readonly client;
// in constructor:
this.client = this.raw.$extends({...});
```

TypeScript will infer the type from the constructor assignment. This is the cleanest solution!

Let me write the full file:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

const tenantStorage = new AsyncLocalStorage<string>();

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly raw: PrismaClient;
  readonly client;

  constructor() {
    this.raw = new PrismaClient();
    this.client = this.raw.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const tenantId = tenantStorage.getStore();
            if (!tenantId) {
              throw new Error('No tenant context');
            }
            // Scope reads
            if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(operation)) {
              const where = (args as any)?.where ?? {};
              (args as any).where = { ...where, tenantId };
            }
            // Stamp writes
            if (['create', 'createMany', 'update', 'updateMany', 'upsert'].includes(operation)) {
              const data = (args as any)?.data;
              if (data) {
                (args as any).data = { ...data, tenantId };
              }
            }
            return query(args);
          },
        },
      },
    });
  }

  get tenantContext() {
    return tenantStorage;
  }

  async onModuleInit() {
    await this.raw.$connect();
  }

  async onModuleDestroy() {
    await this.raw.$disconnect();
  }
}
```

Wait, but the error says `Property 'client' does not exist on type 'PrismaService'`. If I declare `readonly client;` without a type, it should exist. Let me verify: in TypeScript, `readonly client;` in a class body creates a property that gets its type from the constructor initialization. Yes, that should work.

But wait — will the repositories be able to use `client` with proper types? If the type is inferred from `$extends()`, it should have all the model methods with proper types.

Actually, I need to be careful. The `readonly client;` without a type annotation — TypeScript will infer it as the type of the right-hand side in the constructor. This should work.

Let me also check: the test file accesses `prisma.raw` — so `raw` needs to be a public property. And `prisma.client` from repositories.

Let me also think about whether `raw` should be the base `PrismaClient` or something else. Looking at the tenant repository usage — it probably uses `raw` to look up tenants without tenant scoping (since the tenant table itself defines the tenants). And in tests, `raw` is used for setup/teardown.

I think my solution is correct. Let me finalize it.

One more consideration: the `tenantStorage` (AsyncLocalStorage) needs to be accessible from the middleware to set the tenant. So it should be exported or accessible. Let me export it as a named export or make it a property of the service.

Actually, looking at the architecture: the middleware needs to set the tenant context, and the Prisma extension needs to read it. The AsyncLocalStorage should be shared. I'll export it from the prisma service module.

Let me write the final version:
</think>

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

export const tenantStorage = new AsyncLocalStorage<string>();

const READ_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly raw: PrismaClient;
  readonly client;

  constructor() {
    this.raw = new PrismaClient();
    this.client = this.raw.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const tenantId = tenantStorage.getStore();
            if (!tenantId) {
              throw new Error('Missing tenant context: no tenantId in AsyncLocalStorage');
            }

            if (READ_OPERATIONS.has(operation)) {
              const where = (args as Record<string, unknown>)?.where ?? {};
              (args as Record<string, unknown>).where = { ...where, tenantId };
            }

            if (WRITE_OPERATIONS.has(operation)) {
              const data = (args as Record<string, unknown>)?.data;
              if (data && typeof data === 'object') {
                (args as Record<string, unknown>).data = {
                  ...(data as Record<string, unknown>),
                  tenantId,
                };
              }
            }

            return query(args);
          },
        },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.raw.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.raw.$disconnect();
  }
}
```
