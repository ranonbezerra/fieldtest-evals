# solution

## reasoning

```
Let me analyze the task carefully. I need to build a multi-tenant isolation system with:

1. Tenant resolution middleware (host + token org claim must agree)
2. Tenant-aware Prisma client (extension/middleware) that scopes reads and stamps writes
3. Schema with customers/plans/orders with tenant-scoped uniqueness
4. GET /tenant-config endpoint
5. Tests for isolation

Let me plan the file structure:

- `prisma/schema.prisma` - schema with tenant-scoped uniqueness
- `prisma/migrations/...` - migration (I'll include it but it's secondary)
- `src/main.ts` - entry point
- `src/app.module.ts` - root module
- `src/tenant/tenant.module.ts` - tenant module
- `src/tenant/tenant.middleware.ts` - resolution middleware
- `src/tenant/tenant.service.ts` - tenant resolution
- `src/tenant/tenant-context.ts` - request-scoped context holder
- `src/tenant/tenant-prisma.extension.ts` - tenant-aware Prisma extension
- `src/tenant-config/tenant-config.controller.ts` - GET /tenant-config
- `src/tenant-config/tenant-config.service.ts` - config service
- `src/customers/customers.controller.ts` - CRUD for customers
- `src/customers/customers.service.ts`
- `src/customers/customers.repository.ts`
- `src/customers/customers.module.ts`
- `src/plans/plans.controller.ts`
- `src/plans/plans.service.ts`
- `src/plans/plans.repository.ts`
- `src/plans/plans.module.ts`
- `src/orders/orders.controller.ts`
- `src/orders/orders.service.ts`
- `src/orders/orders.repository.ts`
- `src/orders/orders.module.ts`
- `test/tenant-isolation.spec.ts` - tests
- `test/customers.spec.ts` - maybe

Let me think about the architecture more carefully.

**Tenant Resolution Middleware:**
- Extract host from request
- Extract `org` claim from auth token (JWT)
- Both must resolve to the same tenant
- Store tenant in request-scoped context

**Tenant Context (Request-scoped):**
- Use NestJS request scope or a AsyncLocalStorage-like mechanism
- I'll use a simple provider with `@Request()` or `REQUEST` token

**Tenant-aware Prisma Extension:**
- Use Prisma's `$extends` or `$use` middleware
- For reads: inject `WHERE { tenantId: ... }`
- For writes: inject `data: { tenantId: ... }`
- If no tenant in context, fail
- Override any caller-supplied tenantId

**Schema:**
- `Tenant` model
- `Customer` model with `@@unique([tenantId, email])`
- `Plan` model with `tenantId`
- `Order` model with `tenantId`

Let me think about how the Prisma extension works in NestJS. Prisma has `$extends` on the PrismaClient constructor. I can create a function that returns an extended PrismaClient.

The tricky part is making the tenant context available to the Prisma client. Since Prisma client is typically a singleton, I need to use something like `AsyncLocalStorage` to make it request-scoped.

Let me design this:

```typescript
// tenant-context.ts
import { AsyncLocalStorage } from 'async_hooks';

export const tenantContext = new AsyncLocalStorage<Map<string, any>>();

export function getTenantId(): string | undefined {
  const store = tenantContext.getStore();
  return store?.get('tenantId');
}

export function setTenantId(tenantId: string): void {
  const store = tenantContext.getStore();
  if (store) {
    store.set('tenantId', tenantId);
  }
}
```

Then the middleware sets the tenantId in the AsyncLocalStorage, the Prisma extension reads from it.

Actually, let me think about this more carefully with NestJS patterns. NestJS has a `REQUEST` provider that's request-scoped. I can use that.

But Prisma is typically instantiated at module level (singleton). The extension needs to access request-scoped data. The cleanest way is AsyncLocalStorage.

Let me design the full solution:

**Schema:**
```prisma
model Tenant {
  id        String   @id @default(cuid())
  name      String
  domain    String   @unique
  branding  Json?
  flags     Json?
  customers Customer[]
  plans     Plan[]
  orders    Order[]
}

model Customer {
  id        String   @id @default(cuid())
  email     String
  name      String?
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([tenantId, email])
}

model Plan {
  id        String   @id @default(cuid())
  name      String
  price     Float
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now())
}

model Order {
  id        String   @id @default(cuid())
  amount    Float
  status    String
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now())
}
```

Now let me think about the Prisma extension. In Prisma, you can use `$extends` to customize behavior. But the more common pattern for middleware is `$use` on the Prisma client.

Actually, the best approach is to use Prisma's `$extends.api` or `\$use` middleware pattern:

```typescript
function tenantPrismaExtension(contextProvider: () => string | undefined) {
  return Prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantId = contextProvider();
          if (!tenantId) {
            throw new Error('No tenant in context');
          }
          
          // For reads, scope by tenantId
          if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(operation)) {
            const existingWhere = args.where || {};
            // Handle where being a function (for some operations)
            if (typeof existingWhere === 'function') {
              return query({ where: { AND: [{ tenantId }, existingWhere({})] } });
            }
            return query({ where: { ...existingWhere, tenantId } });
          }
          
          // For writes, stamp tenantId
          if (['create', 'createMany', 'update', 'updateMany', 'upsert'].includes(operation)) {
            if (operation === 'create') {
              return query({ ...args, data: { ...args.data, tenantId } });
            } else if (operation === 'createMany') {
              return query({
                ...args,
                data: { ...args.data, tenantId: { set: tenantId } },
              });
            } else if (operation === 'update') {
              return query({
                ...args,
                data: { ...args.data, tenantId: { set: tenantId } },
              });
            } else if (operation === 'updateMany') {
              return query({
                ...args,
                data: { ...args.data, tenantId: { set: tenantId } },
              });
            } else if (operation === 'upsert') {
              return query({
                ...args,
                create: { ...args.create, tenantId },
                update: { ...args.update, tenantId: { set: tenantId } },
              });
            }
          }
          
          return query(args);
        },
      },
    },
  });
}
```

Wait, I need to handle the case where `args.where` has `id` for findUnique/findOne - in that case the tenant scoping should combine with it. And for delete operations, tenantId should also be included in the where clause.

Also for `delete` and `deleteMany` and `update` and `updateMany`, the `where` clause needs to include tenantId.

Let me reconsider:

Operations that read:
- findMany, findFirst, findUnique, findFirstOrThrow, count, aggregate, groupBy
- Need to add tenantId to where

Operations that write:
- create, createMany - stamp tenantId in data
- update, updateMany - stamp tenantId in data AND add to where (so you can only update your own)
- delete, deleteMany - add tenantId to where
- upsert - stamp in create/update, add to where

This is important for the "fetch-by-id" requirement - DELETE and UPDATE by id need to be scoped.

Actually wait - for the test "update A's row → 404, and A's row is unchanged afterwards" - this means when tenant B tries to update tenant A's row, the query should affect 0 rows (because the where clause includes tenantId that doesn't match), and the service should return 404.

And "delete A's row → 404, and A's row still exists" - same, delete affects 0 rows.

Let me think about how the controller handles these. The service checks if the record was found/affected and returns appropriate errors.

Now let me think about the test structure. The tests need to:
1. Authenticate as tenant B against tenant A's data
2. Test various isolation scenarios

For JWT auth, I'll create a simple JWT strategy. The `org` claim in the token maps to a tenant.

Let me structure the code now. I'll try to be comprehensive but focused.

Actually, let me reconsider the middleware. The middleware needs to:
1. Read the Host header
2. Read the Authorization header (Bearer token)
3. Decode the JWT to get the `org` claim
4. Look up tenant by domain from host
5. Look up tenant by org from token
6. Both must agree (same tenant)
7. Store tenant in context

For the JWT, I'll create a simple utility that decodes without verification for this scope (or use a simple JWT service). Actually, let me use passport-jwt for proper auth.

Hmm, let me keep it simpler. I'll create an auth module that validates JWTs and extracts the org claim.

Let me now write all the files.

I'll structure this as:

1. `prisma/schema.prisma`
2. `src/main.ts`
3. `src/app.module.ts`
4. `src/common/tenant-context.ts` - AsyncLocalStorage-based context
5. `src/tenant/tenant.module.ts`
6. `src/tenant/tenant.service.ts` - resolves tenant from host + org
7. `src/tenant/tenant.middleware.ts` - NestJS middleware
8. `src/tenant/tenant-prisma.extension.ts` - Prisma extension factory
9. `src/auth/auth.module.ts`
10. `src/auth/auth.service.ts` - JWT validation
11. `src/auth/auth.guard.ts` - JWT auth guard
12. `src/tenant-config/tenant-config.module.ts`
13. `src/tenant-config/tenant-config.controller.ts`
14. `src/tenant-config/tenant-config.service.ts`
15. `src/customers/customers.module.ts`
16. `src/customers/customers.controller.ts`
17. `src/customers/customers.service.ts`
18. `src/customers/customers.repository.ts`
19. `src/plans/plans.module.ts`
20. `src/plans/plans.controller.ts`
21. `src/plans/plans.service.ts`
22. `src/plans/plans.repository.ts`
23. `src/orders/orders.module.ts`
24. `src/orders/orders.controller.ts`
25. `src/orders/orders.service.ts`
26. `src/orders/orders.repository.ts`
27. `test/tenant-isolation.spec.ts`

Wait, I need to be more careful. Let me think about what's actually needed vs what I'm inventing.

The task says:
- Tenant resolution middleware ✓
- Tenant-aware Prisma client ✓
- Schema for customers/plans/orders ✓
- GET /tenant-config ✓
- Tests ✓

I need CRUD endpoints for customers (at minimum) to test the isolation. For plans and orders, I need them in the schema but may not need full CRUD. But having them makes the system more complete.

Let me simplify - I'll have full CRUD for customers and minimal endpoints for plans/orders. Actually, let me have full CRUD for all three to be thorough.

Now, about the middleware approach. In NestJS, middleware is applied globally or per-module. I'll apply it globally.

But wait - for the Prisma extension to work, the tenant context needs to be set BEFORE any Prisma calls. The middleware runs before the controller, so that works.

Here's my approach for the Prisma extension:

I'll create a factory function that takes a context provider function and returns an extended PrismaClient. The context provider reads from AsyncLocalStorage.

The Prisma client will be provided at the root level (singleton), but the extension reads tenant context dynamically per-request via AsyncLocalStorage.

Let me code this up now.

For the error envelope format:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

I need an exception filter or consistent error handling. I'll create a custom exception class.

Let me also think about how `getTenantConfig` works - it needs the resolved tenant from the middleware.

Here's my refined plan for the context flow:

1. Request comes in
2. Middleware runs: resolves tenant from host + JWT org claim
3. Sets tenant in AsyncLocalStorage
4. Request-scoped Prisma client (or singleton with extension that reads from context)
5. Controller → Service → Repository (all using the scoped Prisma client)
6. The Prisma extension automatically scopes queries

Actually, in NestJS, making Prisma request-scoped would be expensive. Better to use a singleton with the AsyncLocalStorage pattern.

Let me finalize and write all the code.

For JWT handling, I'll use a simple approach - decode the token to get the org claim. In a real system this would verify the signature, but for this task I'll assume a shared secret or just decode for demo purposes. Actually, let me use passport-jwt for proper auth.

Hmm, let me keep it simpler. I'll create a custom guard that extracts the org claim from the token and a service that resolves the tenant.

Let me write the code now:

For the middleware, I need to handle it like this:

```typescript
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantService: TenantService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const host = req.headers.host || '';
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    
    const hostTenant = await this.tenantService.resolveByDomain(host);
    const tokenTenant = await this.tenantService.resolveByOrg(token);
    
    if (!hostTenant || !tokenTenant || hostTenant.id !== tokenTenant.id) {
      throw new BadRequestException('Tenant resolution failed');
    }
    
    // Set in context
    setTenantContext(hostTenant.id);
    req.tenant = hostTenant;
    
    next();
  }
}
```

But wait - the middleware uses `async/await` and `next()`. The AsyncLocalStorage needs to be set in the same async context as the Prisma calls. In Node.js, AsyncLocalStorage propagates through the async chain, so as long as the middleware sets it before calling `next()`, and the Prisma calls happen in the same async chain, it should work.

Actually, there's a subtlety. NestJS middleware with async/await and NextFunction - the async context should propagate. Let me verify my understanding: AsyncLocalStorage tracks the async resource, so if I do `await next()` instead of `next()`, it should maintain the context. But NestJS middleware calls `next()` without await. Let me handle this carefully.

Actually, in NestJS, if the middleware is `async` and calls `next()`, the async context should propagate to the rest of the request handling because Node.js maintains the async resource across the callback chain.

Wait, I think there might be issues. Let me use a different approach - I'll use NestJS's `REQUEST` provider pattern or explicitly wrap the handler.

Actually, the cleanest approach for NestJS is:

```typescript
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const host = req.headers.host || '';
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    const hostTenant = await this.tenantService.resolveByDomain(host);
    const tokenTenant = await this.tenantService.resolveByOrg(token);

    if (!hostTenant || !tokenTenant || hostTenant.id !== tokenTenant.id) {
      throw new BadRequestException('Tenant mismatch');
    }

    setTenantInContext(hostTenant.id);
    req.tenant = hostTenant;
    next();
  }
}
```

In NestJS, when an async middleware calls `next()`, the async context (including AsyncLocalStorage) should propagate to the route handlers because NestJS uses the same async resource. This is a well-known pattern.

However, I've seen some issues with this. Let me be extra safe and make the Prisma client request-scoped. Actually, that would be too expensive.

Alternative: Use NestJS's `REQUEST` token which is request-scoped, and inject it where needed.

But the key requirement is that handlers NEVER pass tenantId manually. So the Prisma extension approach is correct - it should automatically scope queries.

Let me go with AsyncLocalStorage. It's the standard approach for this pattern in Node.js/NestJS.

Now, let me think about how to create the Prisma extension. Prisma $extends is applied when creating the PrismaClient instance:

```typescript
const prisma = new PrismaClient().$extends(tenantExtension(getTenantId));
```

But if we're creating the PrismaClient as a singleton, the extension is applied once. The extension function receives a context provider, which in this case reads from AsyncLocalStorage at query time (not at creation time). That's exactly what we want.

Let me also handle the error formatting. I'll create an exception filter that converts errors to the standard envelope format.

OK, let me just write the code now. I'll be comprehensive.

One more thing - for the `findUnique` operations, I need to handle the case where someone does `prisma.customer.findUnique({ where: { id } })`. The extension needs to add `tenantId` to the where clause. If the id doesn't belong to the tenant, it returns null, which the service converts to 404.

For `findFirst`, same thing - add tenantId to where.

For `findMany`, add tenantId to where.

For `count`, add tenantId to where.

For `delete`/`deleteMany`, add tenantId to where.

For `update`/`updateMany`, add tenantId to data AND where.

For `create`/`createMany`, add tenantId to data.

For `upsert`, add tenantId to create and update, and to where.

Let me be precise about Prisma's query API:

For `where` clause in Prisma:
- Simple object: `{ tenantId, ...otherConditions }`
- For `AND`: `{ AND: [{ tenantId }, ...otherConditions] }`
- For complex where that might be a function (not in standard Prisma), handle accordingly

Actually, let me look at Prisma's types more carefully. In Prisma, `where` is typically a plain object for most operations. There are some cases with `skip`/`take`/`cursor` but those are separate args.

Let me now write the actual code. I'll be thorough.

Here's the structure I'll follow:

For the Prisma extension, I need to handle all operations properly:

```typescript
function createTenantExtension(getTenantId: () => string | undefined) {
  return Prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantId = getTenantId();
          
          // Fail if no tenant in context
          if (!tenantId) {
            throw new Error('No tenant context available');
          }
          
          // Read operations - scope by tenantId
          const readOperations = ['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy', 'findFirstOrThrow'];
          const writeDataOperations = ['create', 'createMany', 'update', 'updateMany', 'upsert'];
          const writeWhereOperations = ['delete', 'deleteMany', 'update', 'updateMany'];
          
          if (readOperations.includes(operation)) {
            const where = args.where || {};
            // Where can be a plain object or undefined
            if (where && typeof where === 'object' && !Array.isArray(where)) {
              // Check if tenantId is already in where
              const newWhere = { ...where, tenantId };
              return query({ ...args, where: newWhere });
            }
            return query({ ...args, where: { tenantId } });
          }
          
          if (operation === 'create') {
            const data = args.data || {};
            return query({
              ...args,
              data: typeof data === 'object' && !Array.isArray(data)
                ? { ...data, tenantId }
                : data,
            });
          }
          
          if (operation === 'createMany') {
            const data = args.data || [];
            return query({
              ...args,
              data: Array.isArray(data)
                ? data.map(d => ({ ...d, tenantId }))
                : data,
            });
          }
          
          if (operation === 'upsert') {
            return query({
              ...args,
              where: { ...args.where, tenantId },
              create: { ...args.create, tenantId },
              update: { ...args.update, tenantId },
            });
          }
          
          if (['update', 'updateMany'].includes(operation)) {
            const data = args.data || {};
            const where = args.where || {};
            return query({
              ...args,
              data: typeof data === 'object' && !Array.isArray(data)
                ? { ...data, tenantId: { set: tenantId } }
                : data,
              where: typeof where === 'object' && !Array.isArray(where)
                ? { ...where, tenantId }
                : { tenantId },
            });
          }
          
          if (['delete', 'deleteMany'].includes(operation)) {
            const where = args.where || {};
            return query({
              ...args,
              where: typeof where === 'object' && !Array.isArray(where)
                ? { ...where, tenantId }
                : { tenantId },
            });
          }
          
          return query(args);
        },
      },
    },
  });
}
```

Wait, there's an issue with `findUnique` - the where clause needs to include tenantId, but if someone queries by `id` alone, it becomes `{ id: someId, tenantId }` which correctly scopes it.

But there's a subtlety: for `findUnique`, the `where` must contain a unique identifier. Adding `tenantId` to it is fine as long as `tenantId` is part of a unique constraint or just acts as a filter. In Prisma, `findUnique` requires exactly the fields of an identity (unique index). Adding extra fields to `where` in `findUnique` is actually fine in Prisma - it just filters by those fields. But wait - Prisma's `findUnique` requires exactly one unique criterion. Adding extra fields should work since Prisma treats it as a filter.

Actually, I need to be careful. In newer versions of Prisma, `findUnique` requires that the `where` contains a valid unique criterion. Adding extra fields to `where` is fine - Prisma will use them as additional filters.

Hmm, let me double-check. In Prisma, `findUnique` has this behavior:
- `where: { id: 'abc' }` - works (uses id as unique key)
- `where: { id: 'abc', tenantId: 'xyz' }` - this might cause an issue because it has two fields but neither is a unique composite key

Wait, actually in Prisma, when you pass multiple fields to `findUnique`, it tries to find a matching unique index. Since we have `@@unique([tenantId, email])`, but `tenantId` + `id` is NOT a unique index. So `findUnique({ where: { id: 'abc', tenantId: 'xyz' } })` might fail.

This is a problem. Let me handle it differently.

For `findUnique`, instead of adding tenantId to where, I should use a different approach. Let me check what Prisma allows:

- `findUnique` requires exactly one unique filter
- Adding extra fields is allowed in Prisma (they become AND filters) - but only in some versions

Actually, in recent Prisma versions, `findUnique` with extra fields is treated as: find a record matching ALL of these conditions, where at least one forms a unique criterion. This is called "unique filtration". Let me check.

In Prisma 4.x+, `findUnique` actually requires exactly one unique criterion in the where. If you add more, it might throw a runtime error. Let me handle this by NOT modifying `findUnique`'s where, but instead filtering the result.

Hmm, but that defeats the purpose of structural isolation. The whole point is that the query itself is scoped.

Alternative: I can use `findFirst` instead of `findUnique` in the repository layer, which allows complex where clauses including AND.

Actually, let me think about this differently. The repository layer should never use `findUnique` for tenant-scoped queries. Instead, use `findFirst` with `{ where: { id, tenantId } }`.

But the extension shouldn't need to know about the repository layer's choices. Let me think...

Actually, in the Prisma extension, for `findUnique`, I can wrap it differently:

```typescript
if (operation === 'findUnique') {
  const where = args.where || {};
  // Use findFirst logic: add tenantId as AND condition
  // But we can't change operation from findUnique to findFirst in the extension
  // Instead, we can check if where already has tenantId and if not, we can use a different approach
}
```

Hmm. Actually, let me check: in Prisma, can you do:

```typescript
prisma.customer.findUnique({
  where: {
    AND: [
      { id: 'some-id' },
      { tenantId: 'some-tenant' }
    ]
  }
})
```

No, that's not valid for `findUnique`. `findUnique` where must contain exactly one unique criterion.

But you CAN do:

```typescript
prisma.customer.findFirst({
  where: {
    AND: [
      { id: 'some-id' },
      { tenantId: 'some-tenant' }
    ]
  }
})
```

So my repository should use `findFirstOrThrow` or `findFirst` instead of `findUnique` for scoped lookups. The extension can still add tenantId to findUnique's where and it'll work in practice (Prisma silently ignores extra fields in findUnique in many versions), but to be safe, let me use `findFirst` in the repository.

Actually, I just realized: in many Prisma versions, `findUnique({ where: { id: 'x', tenantId: 'y' } })` does work - it finds the record with id 'x' AND tenantId 'y', even though there's no composite unique index for those two fields. The extra fields just act as filters. Let me verify this understanding...

In Prisma documentation: "When using `findUnique`, you can also pass additional filters to narrow down the result." This was added in Prisma 4.x. So `findUnique({ where: { id: 'x', tenantId: 'y' } })` should work fine.

OK great, so my extension approach works for `findUnique` too.

But wait, there's another consideration. If someone calls `prisma.customer.findUnique({ where: { email: 'test@test.com' } })`, the extension adds tenantId, making it `{ email: '...', tenantId: '...' }`. Since `@@unique([tenantId, email])` exists, this is valid.

And `prisma.customer.findUnique({ where: { id: 'abc' } })` becomes `{ id: 'abc', tenantId: '...' }`. The `id` field alone should be unique across all tenants (or at least, adding tenantId as a filter is fine).

OK let me proceed with this approach.

Now let me think about what the repository methods look like. Since the extension handles tenant scoping automatically, the repository is simple:

```typescript
async findAll(): Promise<Customer[]> {
  return this.prisma.customer.findMany();
}

async findById(id: string): Promise<Customer | null> {
  return this.prisma.customer.findUnique({ where: { id } });
}

async create(data: CreateCustomerDto): Promise<Customer> {
  return this.prisma.customer.create({ data });
}

async update(id: string, data: UpdateCustomerDto): Promise<Customer | null> {
  return this.prisma.customer.update({
    where: { id },
    data,
  });
}

async delete(id: string): Promise<Customer | null> {
  return this.prisma.customer.delete({ where: { id } });
}
```

Notice: no tenantId anywhere! The extension handles it all.

Now, for the update/delete cases in tests:
- Tenant B tries to update tenant A's customer by id
- Extension adds `{ tenantId: tenantB_id }` to the where clause
- Where becomes `{ id: 'A's customer id', tenantId: 'B's id' }`
- No matching record found (because the customer belongs to A, not B)
- Prisma throws `record_not_found` error
- Service catches this and returns 404

For the findAll test:
- Tenant B lists customers
- Extension adds `tenantId: tenantB_id` to where
- Only B's customers are returned

This all works correctly.

Now let me handle the test. The test file needs to:
1. Set up two tenants with data
2. Authenticate as tenant B
3. Test isolation scenarios

Let me think about the test setup. I'll use NestJS Testing module.

Actually, let me create a comprehensive test that covers all the acceptance criteria from the spec.

For the tests, I need to:
- Create two tenants (A and B)
- Create users/customers for both tenants
- Make authenticated requests as tenant B
- Verify tenant A's data is isolated

Let me think about how the JWT works. I'll have a simple JWT that contains an `org` claim. The middleware extracts this claim.

Actually, let me simplify. Instead of full JWT, I'll have an auth service that validates tokens and extracts org claims. Or I can use passport-jwt.

Let me use a simpler approach - a custom guard that extracts the org from a Bearer token, and an auth service that validates it.

Let me now write all the code. I'll be thorough but focused.

For the migration, the spec says "Every schema change ships with a migration." I should include a migration file. Let me include a basic one.

Let me start coding:

Actually, let me reconsider the file layout. The task says to decide the layout myself. Let me organize:

```
prisma/schema.prisma
prisma/migrations/migration_A.sql (or similar)
src/main.ts
src/app.module.ts
src/common/constants.ts
src/common/errors.ts (or exception filter)
src/common/tenant-context.ts (AsyncLocalStorage)
src/tenant/tenant.module.ts
src/tenant/tenant.service.ts
src/tenant/tenant.middleware.ts
src/tenant/tenant-prisma-extension.ts
src/auth/auth.module.ts
src/auth/auth.service.ts
src/auth/auth.guard.ts
src/tenant-config/tenant-config.module.ts
src/tenant-config/tenant-config.controller.ts
src/tenant-config/tenant-config.service.ts
src/customers/customers.module.ts
src/customers/customers.controller.ts
src/customers/customers.service.ts
src/customers/customers.repository.ts
src/plans/plans.module.ts
src/plans/plans.controller.ts
src/plans/plans.service.ts
src/plans/plans.repository.ts
src/orders/orders.module.ts
src/orders/orders.controller.ts
src/orders/orders.service.ts
src/orders/orders.repository.ts
test/tenant-isolation.spec.ts
test/tenant-config.spec.ts
```

This is a lot of files. Let me make sure I'm complete.

Wait, do I need auth module separately? The tenant resolution middleware needs to validate the JWT and extract the org claim. Let me merge auth into the tenant module for simplicity, or keep them separate.

I think separate makes more sense - auth is about validating tokens, tenant resolution is about correlating host + token to a tenant.

But to keep things manageable, let me merge them.

Actually, let me keep the structure clean. Auth handles token validation. Tenant module handles resolution and context.

Let me now think about what the `@Injectable()` classes need. I'll have a `PrismaService` that provides the tenant-aware Prisma client.

Here's the full flow:

1. `PrismaService` - singleton, creates PrismaClient with tenant extension
2. Tenant middleware resolves tenant and sets context
3. All modules inject `PrismaService` (or their repository injects it)
4. Repositories use PrismaService directly (extension auto-scopes)

Let me code the PrismaService:

```typescript
@Injectable()
export class PrismaService {
  public readonly prisma: PrismaClient;
  
  constructor() {
    this.prisma = new PrismaClient().$extends(
      createTenantExtension(() => getTenantIdFromContext())
    );
  }
  
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
```

OK, let me finalize and write everything. I'll be comprehensive.

One thing about the migration - I'll create a proper SQL migration. Actually, since this is a new project and I don't know the state, let me create both the schema and a migration that matches it.

Wait - the spec says "If files are given above the task, they are the existing codebase". The blocks above are reference material, not the existing codebase. So I'm building from scratch.

Let me include a migration file and the schema. The migration can be derived from the schema.

Now let me write all files. I'll aim for completeness.

Let me start writing the actual code files:

For the exception handling, I need a consistent error format. Let me create an exception filter.

Actually, let me use NestJS built-in exceptions and map them. Or create a simple exception filter.

Let me think about what's truly needed vs extra:

Required:
- Tenant resolution middleware ✓
- Tenant-aware Prisma client ✓
- Schema (customers, plans, orders) ✓
- GET /tenant-config ✓
- Tests ✓

For the REST API, I need at least customer CRUD (for the tests to work). Let me include plans and orders CRUD too.

Let me also think about what `GET /tenant-config` returns - branding and feature flags for the resolved tenant. The tenant model has `branding` and `flags` as JSON fields.

Now I'm going to write the code. Let me be efficient about it.

I'll create a single comprehensive PrismaService that provides the extended PrismaClient.

Let me also handle the AsyncLocalStorage carefully. In NestJS, middleware runs in a different async context than the request handlers if using certain patterns. The safest approach is to use `AsyncLocalStorage` and ensure the context propagates through the request lifecycle.

The key insight: AsyncLocalStorage in Node.js propagates through the event loop. When the middleware does `next()`, the async resource is preserved, so any async operations (including Prisma calls) in the route handlers will see the same context.

But there's a caveat: if NestJS uses a different async resource (e.g., it spawns a new one), the context might not propagate. Let me verify this assumption.

In practice, NestJS uses the standard Node.js HTTP server, which preserves the async resource across the request lifecycle. The `next()` call in middleware doesn't create a new async resource. So AsyncLocalStorage should work correctly.

If I want to be extra safe, I could make the Prisma client request-scoped and inject the REQUEST token, but that would create a new PrismaClient per request which is expensive and against the singleton pattern.

Let me go with AsyncLocalStorage. It's the standard approach and works correctly in NestJS.

Now let me think about test setup. The tests need to:
1. Bootstrap a NestJS application
2. Create tenants in the database
3. Create JWT tokens for each tenant
4. Make requests with different tokens/hosts and verify isolation

I'll use `Test.createApplicationContext` or `Test.createNestApplication` for integration testing.

Let me also consider that the tests need a real database. I'll use the `DATABASE_URL` environment variable.

OK, let me write all the code now. I'll be thorough.

Let me reconsider the auth guard. For the tests, I need a way to authenticate. I'll use a simple JWT approach where the token contains an `org` claim that maps to a tenant ID.

Actually, let me simplify the auth. Instead of using passport-jwt, I'll have a simple mechanism:
- The middleware extracts the token from the Authorization header
- Decodes it (no verification needed for tests, or use a simple HMAC check)
- Extracts the `org` claim
- Passes it to the tenant resolution service

For the test, I'll generate tokens with the right `org` claim.

Let me code this up properly. I'll write all files now.

One important detail: the tenant resolution middleware needs to handle both host and token resolution, and they must agree. The middleware should:
1. Parse host to get domain
2. Decode JWT to get org claim
3. Look up tenant by domain
4. Look up tenant by org
5. Verify they're the same
6. Set context

For the org claim in the token: I'll assume the token is a JWT with an `org` field that contains the tenant ID directly. OR it could contain a tenant reference that needs lookup. Let me go with: the `org` claim contains the tenant ID directly. And the host maps to the tenant's domain.

Wait, let me re-read the spec: "Auth tokens carry an `org` claim; requests also arrive with the tenant's host." and "derive the tenant from host + token org claim (both must agree)".

So the token has an `org` claim (which is a tenant identifier), and the host is `app.operator-x.com` which maps to a tenant. Both must point to the same tenant.

The org claim could be the tenant's ID, name, or domain. Let me assume it's the tenant's ID for simplicity.

Now let me write everything. I'll aim for production-quality code.

Let me think about the PrismaService and how it interacts with the tenant context. The PrismaService creates a PrismaClient with the extension. The extension receives a function that reads from AsyncLocalStorage. When a query is executed, the extension calls this function to get the current tenant ID.

```typescript
// tenant-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantContext {
  tenantId: string;
}

export const tenantAsyncLocalStorage = new AsyncLocalStorage<TenantContext>();

export function setTenantContext(tenantId: string): void {
  tenantAsyncLocalStorage.enterWith({ tenantId });
}

export function getTenantContext(): TenantContext | undefined {
  return tenantAsyncLocalStorage.getStore();
}

export function getTenantId(): string | undefined {
  return getTenantContext()?.tenantId;
}
```

Wait, `enterWith` replaces the current context. I want to set the context and have it propagate. Let me use `run()` instead for setting it, or `enterWith` in the middleware.

Actually, in the middleware I should use `enterWith` because it's called at the start of the request:

```typescript
async use(req: Request, _res: Response, next: NextFunction) {
  // ... resolve tenant ...
  tenantAsyncLocalStorage.enterWith({ tenantId: resolvedTenant.id });
  next();
}
```

This sets the context for the current async resource and all children, which is exactly what we need.

Now let me write all the files. This is going to be long but I'll be thorough.

Let me also add an exception filter to ensure all errors are in the standard format:
```json
{ "error": { "code": "...", "message": "...", "details": {} } }
```

Let me now finalize all the code. I'll write it out in order.

I realize I should think about the test more carefully. The test needs to:
1. Boot the NestJS app
2. Use Prisma to set up test data (two tenants, each with customers)
3. Make authenticated requests (using different hosts and JWT tokens)
4. Verify isolation

For the tests, I'll need:
- A way to create JWT tokens for testing
- A test database (use DATABASE_URL)
- Setup and teardown

Let me write a test that covers all acceptance criteria:
- Tenant B cannot list tenant A's customers
- Tenant B fetching tenant A's customer by id → 404
- Tenant B updating tenant A's customer → 404, A's row unchanged
- Tenant B deleting tenant A's customer → 404, A's row still exists
- Same email registers in both tenants
- Concurrent requests from different tenants don't cross contexts
- Query with no tenant context fails

For the concurrent test, I'll fire requests with tenant A's token and tenant B's token simultaneously and verify they don't cross.

For the "no tenant context" test, I'll make a request without the middleware (or with a token that doesn't resolve to a tenant).

Now, about the test - should it use the full HTTP server or just the application context? Full HTTP is better for testing middleware.

Let me use `Test.createNestApplication` and `app.listen()` or `app.getHttpServer()`.

Actually, NestJS Testing has `Test.createNestApplication()` which creates a full application that can be started. I'll use that.

For making HTTP requests in tests, I can use `supertest` or the NestJS `FetchAPI`/`axios`.

Let me use `supertest`.

OK let me now write all the code. I'll structure it as multiple files.

Actually, one more thing to consider. The test needs to work with the same database or a test database. I'll assume `DATABASE_URL` points to a test database or the same database.

Also, I need to ensure the Prisma client is connected before tests run.

Let me now write the code:

Here's my final file plan:

1. `prisma/schema.prisma` - data model
2. `prisma/migrations/20240101000000_init/migration.sql` - migration
3. `src/main.ts` - bootstrap
4. `src/app.module.ts` - root module
5. `src/common/tenant-context.ts` - AsyncLocalStorage
6. `src/common/exception.filter.ts` - error envelope filter
7. `src/tenant/tenant.module.ts`
8. `src/tenant/tenant.service.ts`
9. `src/tenant/tenant.middleware.ts`
10. `src/tenant/tenant-prisma.extension.ts`
11. `src/auth/auth.module.ts`
12. `src/auth/auth.service.ts`
13. `src/auth/auth.guard.ts`
14. `src/tenant-config/tenant-config.module.ts`
15. `src/tenant-config/tenant-config.controller.ts`
16. `src/tenant-config/tenant-config.service.ts`
17. `src/customers/customers.module.ts`
18. `src/customers/customers.controller.ts`
19. `src/customers/customers.service.ts`
20. `src/customers/customers.repository.ts`
21. `src/plans/plans.module.ts`
22. `src/plans/plans.controller.ts`
23. `src/plans/plans.service.ts`
24. `src/plans/plans.repository.ts`
25. `src/orders/orders.module.ts`
26. `src/orders/orders.controller.ts`
27. `src/orders/orders.service.ts`
28. `src/orders/orders.repository.ts`
29. `test/tenant-isolation.spec.ts`

Wait, I should also have a PrismaService. Let me put it in a `src/prisma/prisma.service.ts` and import it everywhere.

30. `src/prisma/prisma.service.ts`

And each module that needs the database imports PrismaService.

Let me organize this better. The PrismaService should be in its own module, or provided by a shared module.

Let me put it in a `src/database/database.module.ts` that exports `PrismaService`.

30. `src/database/database.module.ts`
31. `src/database/prisma.service.ts`

OK, let me start writing. I'll try to be concise but complete.

Actually, let me think about the module wiring:

```
AppModule
  imports: 
    - TenantModule (middleware applied here)
    - AuthModule
    - DatabaseModule (exports PrismaService)
    - TenantConfigModule
    - CustomersModule
    - PlansModule
    - OrdersModule
```

```
DatabaseModule (exports PrismaService)
  providers: [PrismaService]
  exports: [PrismaService]
```

```
TenantModule
  imports: [DatabaseModule, AuthModule]
  providers: [TenantService, TenantMiddleware]
  exports: [TenantService]
  middleware: TenantMiddleware (applied to all routes)
```

```
CustomersModule
  imports: [DatabaseModule, TenantModule]
  providers: [CustomersService, CustomersRepository]
  controllers: [CustomersController]
```

Wait, the middleware should be applied globally, not from a specific module. In NestJS, I can apply it in `app.module.ts` using `app.use()` or via a module that's imported at the root.

Let me apply the middleware in `main.ts` or in `AppModule` using `app.use()`.

Actually, NestJS middleware is typically applied via module configuration:

```typescript
// In a module
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

This module needs to be imported by AppModule.

OK let me now write the code. I'll structure it carefully.

Let me think about one more thing: the tenant-prisma.extension.ts file. I need to make sure it properly references the context function. Let me design it as a factory:

```typescript
export function createTenantExtension(
  getTenantId: () => string | undefined,
) {
  return Prisma.$extends({...});
}
```

And in PrismaService:
```typescript
this.prisma = new PrismaClient().$extends(
  createTenantExtension(() => getTenantId())
);
```

OK now I'm ready to write the full solution. Let me be thorough but efficient.

I'll also need a JWT decode utility. Let me create a simple one.

For auth, I'll use a simple approach:
- JWT tokens are decoded to extract the `org` claim
- The guard ensures the token is present and valid (basic check)
- The tenant service uses the org claim

Actually, let me simplify the auth. Instead of a full JWT strategy with passport, I'll have:
- A guard that checks for Bearer token
- A service that decodes the token and validates the org claim

The `AuthService` decodes JWTs and validates them. The `TenantService` resolves tenants by domain and by org.

Let me finalize:

Auth flow:
1. Request comes in with `Authorization: Bearer <token>` and `Host: app.operator-x.com`
2. TenantMiddleware:
   a. Decode token → get `org` claim (tenant ID)
   b. Look up tenant by host domain → hostTenant
   c. Look up tenant by org → tokenTenant
   d. If they agree → set context, proceed
   e. If they disagree → reject (401/403)
3. TenantConfigController: GET /tenant-config → returns branding + flags
4. Other controllers: CRUD operations with auto-scoped Prisma

For the JWT, I'll need a way to verify it. In a test environment, I can skip verification or use a known secret. Let me use a simple HMAC-based verification for demo purposes, or just decode without verification (for testing).

Actually, let me just decode the JWT payload (base64 decode the second part). For production, you'd verify the signature, but for this task, decoding is sufficient to demonstrate the concept.

OK, let me write the code now. I'll be comprehensive.

Let me also handle the `@map` and `@@map` Prisma directives for snake_case naming.

Let me define the schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id        String   @id @default(cuid())
  name      String
  domain    String   @unique @map("domain")
  org       String   @unique @map("org")
  branding  Json?    @map("branding")
  flags     Json?    @map("flags")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  customers Customer[]
  plans     Plan[]
  orders    Order[]

  @@map("tenants")
}

model Customer {
  id        String   @id @default(cuid())
  email     String   @map("email")
  name      String?  @map("name")
  tenantId  String   @map("tenant_id")
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, email])
  @@map("customers")
}

model Plan {
  id        String   @id @default(cuid())
  name      String   @map("name")
  price     Float    @map("price")
  tenantId  String   @map("tenant_id")
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now()) @map("created_at")

  @@map("plans")
}

model Order {
  id        String   @id @default(cuid())
  amount    Float    @map("amount")
  status    String   @map("status")
  tenantId  String   @map("tenant_id")
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now()) @map("created_at")

  @@map("orders")
}
```

Now let me write all the code files. I'll aim for quality and completeness.

For the migration, I'll create a SQL file:

```sql
-- prisma/migrations/20240101000000_init/migration.sql
CREATE TABLE IF NOT EXISTS "tenants" (
  "id" VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" VARCHAR(255) NOT NULL,
  "domain" VARCHAR(255) NOT NULL UNIQUE,
  "org" VARCHAR(255) NOT NULL UNIQUE,
  "branding" JSONB,
  "flags" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "customers" (
  "id" VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email" VARCHAR(255) NOT NULL,
  "name" VARCHAR(255),
  "tenant_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "customers_tenant_id_email_unique" UNIQUE ("tenant_id", "email")
);

CREATE TABLE IF NOT EXISTS "plans" (
  "id" VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" VARCHAR(255) NOT NULL,
  "price" FLOAT NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "orders" (
  "id" VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "amount" FLOAT NOT NULL,
  "status" VARCHAR(255) NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
```

Wait, Prisma uses `cuid()` by default, not UUID. Let me use the default `cuid()` in the schema and adjust the migration accordingly. Actually, for the migration I should match the Prisma schema. Let me use `cuid()` which generates a specific format.

Actually, let me just use `@id @default(cuid())` in Prisma and for the migration, I'll use `VARCHAR(255)` with a default function. Or better, let me use `uuid` with a default gen_random_uuid() since that's more standard for PostgreSQL.

Hmm, but the Prisma schema says `cuid()`. Let me stick with that and make the migration match. Prisma's `cuid()` generates a base-36 string of length 255, so `VARCHAR(255)` is fine. The migration would need a function or just leave it as a regular insert.

Actually, for the migration, Prisma manages the actual SQL through `prisma migrate`. Let me just provide a reasonable migration file.

Let me now write everything. I'll be focused.

Let me think about what DTOs I need:
- CreateCustomerDto
- UpdateCustomerDto
- Same for plans and orders
- And a GetTenantConfig response type

Let me write the complete code now. I'll include all files.

For the middleware, since it needs database access (to look up tenants), it needs to be injectable. In NestJS, middleware registered via `MiddlewareConsumer` can have injectable dependencies.

Let me now write all the code:

Actually, let me also handle the case where the JWT token is decoded. I'll create a simple JWT decoder utility:

```typescript
function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
```

This is simple and sufficient for the task.

Now let me also handle the error responses. I'll create a global exception filter:

```typescript
@Catch(Exception)
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: Exception, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message = exception instanceof HttpException ? exception.message : 'Internal server error';

    response.status(status).json({
      error: {
        code: this.getErrorCode(exception),
        message,
        details: {},
      },
    });
  }

  private getCode(exception: Exception): string {
    if (exception instanceof NotFoundException) return 'resource_not_found';
    if (exception instanceof BadRequestException) return 'bad_request';
    if (exception instanceof UnauthorizedException) return 'unauthorized';
    return 'internal_error';
  }
}
```

Now let me write all the files. I'll be thorough.

Let me start:

One more consideration: for the `findUnique` case with tenantId, I need to verify that Prisma handles it correctly. In the Prisma 5.x version, `findUnique` with extra fields beyond a unique identifier might throw an error. Let me handle this in the extension.

Actually, I just checked: in Prisma 5.x, `findUnique` with multiple fields where none forms a valid unique key (or a composite unique key) will throw an error at runtime. So I need to be careful.

My approach: for `findUnique`, I'll detect if the where has an `id` field (which is a unique field by itself), and I'll add tenantId as a secondary filter using the `findFirst` approach.

Wait, I can't change the operation from `findUnique` to `findFirst` in the extension. Let me think...

Alternative: The repository should use `findFirst` instead of `findUnique` when the query needs to be scoped. But the spec says handlers/repositories never mention tenantId. The extension should handle it.

Let me check if Prisma actually allows extra fields in `findUnique`:

In Prisma 5.x, `findUnique({ where: { id: 'x', tenantId: 'y' } })` actually DOES work - it finds the record where both conditions match. The documentation says: "If you pass in a non-unique argument, Prisma will throw a unique constraint violated error if multiple results are found."

Wait, that's for the result, not for the query itself. Let me check more carefully.

Actually, looking at the Prisma source code and documentation, `findUnique` in Prisma 5.x accepts extra filters alongside the unique criterion. The query is: find a unique record matching all given criteria. If the unique criterion finds exactly one result, and extra filters further narrow it, the result is still unique.

So `findUnique({ where: { id: 'x', tenantId: 'y' } })` is valid because:
1. `{ id: 'x' }` is a valid unique criterion (finds exactly one record)
2. `{ tenantId: 'y' }` is an additional filter
3. The combined result is still unique (at most one record)

So this works fine.

But wait - there's a catch. What if someone does `findUnique({ where: { email: 'test@test.com' } })`? Without tenantId, this would find a customer by email globally (if email is not globally unique). With my extension, it becomes `findUnique({ where: { email: 'test@test.com', tenantId: 'y' } })`. Since `{ email: 'test@test.com' }` might not be unique (multiple customers across tenants could have the same email), Prisma would throw an error.

But in my schema, `@@unique([tenantId, email])` is the unique constraint. `email` alone is not unique. So `findUnique({ where: { email: 'test@test.com' } })` without tenantId should already fail in my schema.

And in my extension, it adds tenantId, so it becomes `{ email: 'test@test.com', tenantId: 'y' }`, which IS a valid unique criterion (matches our composite unique index). So this is fine.

Great, the approach works.

Now, there's another edge case: what if someone explicitly passes `tenantId` in the query args? The spec says "a `tenantId` supplied by a caller is overwritten by the context, not trusted". So I need to handle this:

For reads: if tenantId is in where, replace it with the context tenantId.
For writes: if tenantId is in data, replace it with the context tenantId.
For delete/update where clause: if tenantId is there, replace it.

Let me update the extension to handle this:

```typescript
// For reads
async $allOperations({ operation, args, query }) {
  const tenantId = getTenantId();
  if (!tenantId) throw new Error('No tenant context');
  
  if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(operation)) {
    const where = sanitizeWhere(args.where); // strip any tenantId and add context tenantId
    return query({ ...args, where });
  }
  // ...
}

function sanitizeWhere(where: any, tenantId: string): any {
  if (!where || typeof where !== 'object') return { tenantId };
  const { tenantId: _, ...rest } = where; // strip tenantId
  return { ...rest, tenantId };
}
```

This ensures any caller-supplied tenantId is overwritten.

OK, let me now write everything. Here goes.

One more thing - I need to handle `createMany` properly. The data for `createMany` is an array, and each item needs tenantId added:

```typescript
if (operation === 'createMany') {
  const data = Array.isArray(args.data) ? args.data : [];
  return query({
    ...args,
    data: data.map(d => ({
      ...d,
      ...(typeof d === 'object' ? { tenantId } : {}),
    })),
  });
}
```

Wait, `createMany` in Prisma also has `skipDuplicates` option. Let me not worry about that for now.

Also for the `skip`/`take`/`cursor` parameters, they should be passed through unchanged.

And for `orderBy`, if someone orders by tenantId, I should probably keep it. But no need to modify it.

Let me also handle `select` and `include` - these shouldn't be modified (they determine what fields are returned, not filtered).

OK, now I'm really going to write the code. Let me be efficient.

Let me think about the structure one more time:

1. Schema + Migration
2. Main + AppModule
3. PrismaService (creates extended PrismaClient)
4. TenantContext (AsyncLocalStorage)
5. TenantService (resolves tenant)
6. TenantMiddleware
7. AuthService + AuthGuard (JWT handling)
8. TenantConfig (controller + service)
9. Customer CRUD
10. Plan CRUD
11. Order CRUD
12. Exception filter (error envelope)
13. Tests

Let me start writing now. I'll use a moderate amount of code - not too verbose, but complete.

For the test, I'll need to:
- Boot the app
- Seed the database with two tenants
- Generate JWT tokens
- Test isolation scenarios

Let me create a test helper that generates tokens and a comprehensive test spec.

For generating tokens: I'll encode a JWT with `org` claim.

```typescript
function generateToken(org: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ org, sub: 'test', iat: Date.now() })).toString('base64url');
  const signature = Buffer.from('signature').toString('base64url'); // dummy
  return `${header}.${payload}.${signature}`;
}
```

OK let me write all the code now.

Let me be pragmatic about the number of files. I'll combine where it makes sense but keep the architecture clean.

Here's my final plan:

Files to write:

1. `prisma/schema.prisma`
2. `prisma/migrations/20240101000000_init/migration.sql`
3. `src/main.ts`
4. `src/app.module.ts`
5. `src/common/tenant-context.ts`
6. `src/common/exceptions.filter.ts`
7. `src/common/dto.ts` (shared DTOs if needed)
8. `src/database/database.module.ts`
9. `src/database/prisma.service.ts`
10. `src/tenant/tenant.module.ts`
11. `src/tenant/tenant.service.ts`
12. `src/tenant/tenant.middleware.ts`
13. `src/tenant/tenant-prisma.extension.ts`
14. `src/auth/auth.module.ts`
15. `src/auth/auth.service.ts`
16. `src/auth/auth.guard.ts`
17. `src/tenant-config/tenant-config.module.ts`
18. `src/tenant-config/tenant-config.controller.ts`
19. `src/tenant-config/tenant-config.service.ts`
20. `src/customers/customers.module.ts`
21. `src/customers/customers.controller.ts`
22. `src/customers/customers.service.ts`
23. `src/customers/customers.repository.ts`
24. `src/plans/plans.module.ts`
25. `src/plans/plans.controller.ts`
26. `src/plans/plans.service.ts`
27. `src/plans/plans.repository.ts`
28. `src/orders/orders.module.ts`
29. `src/orders/orders.controller.ts`
30. `src/orders/orders.service.ts`
31. `src/orders/orders.repository.ts`
32. `test/tenant-isolation.spec.ts`

That's a lot but each file has a clear purpose.

Actually, let me consolidate some files. I can put auth inside the tenant module, or combine small modules.

Let me combine:
- Auth service and guard into the tenant module (they're tightly coupled)
- Or keep them separate but smaller

I think for clarity, let me keep them separate but minimal.

Let me now write the actual code. I'll be thorough.

Hmm, one thing: the `AuthGuard` needs to validate the JWT. But the tenant resolution is in the middleware, which runs BEFORE guards. So the middleware needs to decode the JWT without using the guard. The guard can do proper validation for the route handlers.

Actually, looking at NestJS lifecycle: Global middlewares run BEFORE Guards. So the tenant resolution middleware runs first. The auth guard runs after. But my middleware needs to decode the JWT to get the org claim. So the middleware needs JWT decoding capability.

Let me have the middleware handle JWT decoding directly (simple decode), and have the auth guard do proper validation for the controller methods.

Wait, but then the middleware and guard are both doing JWT stuff. Let me simplify: the middleware does tenant resolution (including JWT decoding), and the auth guard is just a marker that the route requires authentication (which the middleware already handles).

Or, even simpler: I'll skip the formal auth guard and just have the middleware handle everything. The tests will use Bearer tokens, and the middleware will decode them.

Let me drop the auth module/guard and put JWT handling directly in the tenant service/middleware. This simplifies the architecture.

Revised plan:
1. TenantService: resolves tenant by domain and by org claim
2. TenantMiddleware: extracts host and token, calls TenantService, sets context
3. No separate auth module

The tenant service has a method `decodeToken(token: string): string` that extracts the org claim, and methods `resolveByDomain(domain: string)` and `resolveByOrg(org: string)`.

OK let me write the code now. I've been overthinking this.

Let me start writing the actual code for each file:

For the Prisma extension, let me use a cleaner approach. I'll use Prisma's `$extends` with a query middleware that handles all operations:

```typescript
export function createTenantExtension(getTenantId: () => string | undefined) {
  return Prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantId = getTenantId();
          
          if (!tenantId) {
            throw new Error('No tenant in context');
          }
          
          // Define operations by category
          const readOps = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy', 'findFirstOrThrow']);
          const createOps = new Set(['create', 'createMany']);
          const upsertOp = 'upsert';
          const updateWhereOps = new Set(['update', 'updateMany', 'delete', 'deleteMany']);
          
          // Read: scope by tenantId
          if (readOps.has(operation)) {
            return query({
              ...args,
              where: injectTenantWhere(args.where, tenantId),
            });
          }
          
          // Create: stamp tenantId
          if (createOps.has(operation)) {
            return query({
              ...args,
              data: injectTenantData(args.data, tenantId),
            });
          }
          
          // Upsert
          if (operation === upsertOp) {
            return query({
              ...args,
              where: injectTenantWhere(args.where, tenantId),
              create: injectTenantData(args.create, tenantId),
              update: injectTenantData(args.update, tenantId),
            });
          }
          
          // Update/Delete: scope where + stamp data
          if (updateWhereOps.has(operation)) {
            return query({
              ...args,
              where: injectTenantWhere(args.where, tenantId),
              ...(operation !== 'delete' && operation !== 'deleteMany' ? {
                data: injectTenantData(args.data, tenantId),
              } : {}),
            });
          }
          
          return query(args);
        },
      },
    },
  });
}

function injectTenantWhere(where: any, tenantId: string): any {
  if (!where || typeof where !== 'object') return { tenantId };
  // Strip any existing tenantId and add context tenantId
  const { tenantId: _, ...rest } = where;
  return { ...rest, tenantId };
}

function injectTenantData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object') return { tenantId };
  if (Array.isArray(data)) return data.map(d => injectTenantData(d, tenantId));
  const { tenantId: _, ...rest } = data;
  // For scalar fields, set directly. For Prisma relative fields (e.g., { set: ... }), keep them.
  if (typeof rest.tenantId === 'undefined') {
    return { ...rest, tenantId };
  }
  return { ...rest, tenantId };
}
```

Wait, I need to be more careful with `injectTenantData`. In Prisma, when updating, a field can have `{ set: value }` syntax or be a scalar. For `create`, it's always a scalar. Let me handle both:

```typescript
function injectTenantData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object') return { tenantId };
  if (Array.isArray(data)) return data.map(d => injectTenantData(d, tenantId));
  
  const { tenantId: _, ...rest } = data;
  // For create: tenantId is a scalar, set it
  // For update: tenantId might be { set: tenantId }
  // For this implementation, let's just set it as a scalar for both
  // Actually for update, Prisma expects { set: value } for optional fields
  // But tenantId is required (not optional), so for update, it should be { set: tenantId }
  // Hmm, actually it depends on whether the field is required in the schema. It IS required.
  // In update operations, required fields need { set: value }
  
  // Let me just use { set: tenantId } for update operations and plain value for create
  // But I don't know the operation type here...
  
  // Simple approach: always use { set: tenantId } for update data, plain value for create
  // I'll differentiate in the caller
}
```

Hmm, this is getting complicated. Let me simplify:

For `create`: `data: { ...data, tenantId }`
For `update`/`updateMany`: `data: { ...data, tenantId: { set: tenantId } }`
For `upsert` create: `tenantId`, upsert update: `tenantId: { set: tenantId }`

I'll handle this in the main extension function, not in a generic helper:

```typescript
async $allOperations({ operation, args, query }) {
  const tenantId = getTenantId();
  if (!tenantId) throw new Error('No tenant in context');
  
  // ... operation dispatch
  
  if (operation === 'create') {
    const data = args.data || {};
    const { tenantId: _, ...rest } = data;
    return query({ ...args, data: { ...rest, tenantId } });
  }
  
  if (operation === 'createMany') {
    const data = args.data || [];
    const cleanedData = data.map(d => {
      const { tenantId: _, ...rest } = d;
      return { ...rest, tenantId };
    });
    return query({ ...args, data: cleanedData });
  }
  
  if (operation === 'update') {
    const data = args.data || {};
    const { tenantId: _, ...rest } = data;
    return query({
      ...args,
      where: injectTenantWhere(args.where, tenantId),
      data: { ...rest, tenantId: { set: tenantId } },
    });
  }
  
  if (operation === 'updateMany') {
    const data = args.data || {};
    const { tenantId: _, ...rest } = data;
    return query({
      ...args,
      where: injectTenantWhere(args.where, tenantId),
      data: { ...rest, tenantId: { set: tenantId } },
    });
  }
  
  if (operation === 'delete' || operation === 'deleteMany') {
    return query({
      ...args,
      where: injectTenantWhere(args.where, tenantId),
    });
  }
  
  if (operation === 'upsert') {
    return query({
      ...args,
      where: injectTenantWhere(args.where, tenantId),
      create: injectCreateData(args.create, tenantId),
      update: injectUpdateData(args.update, tenantId),
    });
  }
  
  // Read operations
  if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy', 'findFirstOrThrow'].includes(operation)) {
    return query({
      ...args,
      where: injectTenantWhere(args.where, tenantId),
    });
  }
  
  return query(args);
}
```

This is cleaner. Let me also make sure `injectTenantWhere` properly strips any existing tenantId:

```typescript
function injectTenantWhere(where: any, tenantId: string): any {
  if (!where || typeof where !== 'object') return { tenantId };
  if (Array.isArray(where)) return where; // shouldn't happen for where
  const { tenantId: _, ...rest } = where;
  return { ...rest, tenantId };
}

function injectCreateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object') return { tenantId };
  const { tenantId: _, ...rest } = data;
  return { ...rest, tenantId };
}

function injectUpdateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object') return { tenantId: { set: tenantId } };
  const { tenantId: _, ...rest } = data;
  return { ...rest, tenantId: { set: tenantId } };
}
```

OK this looks good. Let me now write all the files.

Let me also think about the tenant config controller. It returns branding and feature flags for the resolved tenant. Since the tenant is in the request context, the controller just reads it:

```typescript
@Controller('tenant-config')
export class TenantConfigController {
  constructor(
    private readonly tenantConfigService: TenantConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getConfig() {
    const tenantId = getTenantId();
    // tenantId is guaranteed to be set by middleware
    return this.tenantConfigService.getConfig(tenantId!);
  }
}
```

And the service:
```typescript
@Injectable()
export class TenantConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return {
      branding: tenant.branding,
      flags: tenant.flags,
      name: tenant.name,
      domain: tenant.domain,
    };
  }
}
```

But wait, with the tenant extension, `findUnique({ where: { id: tenantId } })` would become `{ id: tenantId, tenantId: tenantId }` which works since tenantId is the same as id in the context. Actually, the findUnique where has `{ id: someId }` and the extension adds `{ tenantId: contextTenantId }`. If `someId === contextTenantId`, great. If not, it would still find the record (since id is unique globally), but the filter would exclude it (because tenantId doesn't match). Let me think...

`findUnique({ where: { id: 'tenant-A-id', tenantId: 'tenant-B-id' } })` - Prisma looks for a record matching both conditions. Since tenant A's customer has tenantId='A' and we're filtering with tenantId='B', no match → null. Good, isolation works.

But there's a subtlety: findUnique requires exactly one result or zero. If there were multiple matches (impossible since id is unique), it would throw. So this is fine.

OK, I need to make sure the PrismaService uses a single extended PrismaClient. Let me also think about the singleton pattern.

The PrismaService should be a singleton (provided in root module). The PrismaClient with extension is created once. AsyncLocalStorage ensures per-request tenant isolation.

Let me write the final code now. I'll organize it by file.

One thing I want to handle correctly: the `findFirst` operation. In Prisma, `findFirstOrThrow` is a variant. And `findUnique` returns exactly one or throws with findUniqueOrThrow. Let me include those variants too.

Actually, Prisma's operation names are:
- `findMany`
- `findFirst`
- `findUnique`
- `findFirstOrThrow`
- `findUniqueOrThrow`
- `count`
- `aggregate`
- `groupBy`
- `create`
- `createMany`
- `readMany` (deprecated)
- `update`
- `updateMany`
- `upsert`
- `delete`
- `deleteMany`

Let me handle all of these.

For `findUniqueOrThrow`: if the scoped query returns null, Prisma throws a different error (not a standard HTTP error). I should handle this in the service layer.

OK, I think I've planned enough. Let me write the code now. I'll write it in a logical order.

Final consideration about the test file:

The test should be a single comprehensive spec file that covers:
1. Tenant B listing → excludes A's rows
2. Tenant B fetch A's customer by id → 404
3. Tenant B update A's row → 404, A unchanged
4. Tenant B delete A's row → 404, A still exists
5. Same email in both tenants
6. Concurrent requests isolation
7. No tenant context → fails

I'll use supertest for HTTP testing and the NestJS testing utilities.

Let me now write everything.

For the database setup in tests, I'll use a separate database or clean the database between tests. Let me use a fresh database for tests.

OK, starting to write the actual code output now.

Wait, one more thing about the middleware. In NestJS, for the middleware to inject dependencies (like TenantService), it needs to be provided in a module's `providers`. And the module needs to import the module that provides TenantService.

Let me structure it as:

```typescript
@Module({
  providers: [
    TenantMiddleware,
    TenantService,
    // ... other providers
  ],
  exports: [TenantService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

The TenantMiddleware is injectable and gets TenantService injected. This works because NestJS resolves middleware dependencies when setting up the module.

OK, let me now write the code. I'm going to be very focused and write it all at once.

Let me think about the test for "query with no tenant context fails". To test this, I need to make a request that bypasses the middleware (or where the middleware can't resolve a tenant). I could:
- Make a request without a valid host + token combination (which would fail in the middleware with 401)
- But the acceptance says: "a query issued with no tenant in context fails rather than returning everything"

This means: if somehow the context doesn't have a tenant (but the middleware passed), the Prisma query should fail. This is a lower-level test that tests the Prisma extension directly, not the HTTP layer.

I can test this by calling the PrismaService directly without setting a tenant context. But the PrismaService is internal... Let me test it through the repository layer.

Actually, the simplest way: create a direct query to Prisma (bypassing the normal controller/service path) without setting the context. I can do this in the test by directly using the Prisma client and NOT setting the AsyncLocalStorage context.

But that's testing an implementation detail. Let me think about how to test this at a more behavioral level.

I think the best approach is to directly test the Prisma extension by calling it without context. In the test:

```typescript
// Get the underlying PrismaClient
const prisma = app.get(PrismaService).prisma;
// Don't set tenant context
await expect(prisma.customer.findMany()).rejects.toThrow('No tenant context');
```

This tests the behavioral requirement directly.

OK now let me write the code. Final final time.

Let me write the Prisma extension carefully. For `findUnique`, I need to be careful about the Prisma runtime behavior. Let me test my understanding:

In Prisma:
- `prisma.customer.findUnique({ where: { id: 'abc', tenantId: 'xyz' } })` - This works if id is a unique field. Prisma uses id as the unique identifier and tenantId as a filter.

Actually, I just realized there might be an issue. In Prisma, `findUnique` generates a query that looks for an exact match on a unique key. Adding extra fields changes the query semantics. Let me check...

In Prisma's query engine, `findUnique` with extra fields works as follows:
1. Identify the unique key from the where clause (ignoring non-unique fields)
2. Find the record using that unique key
3. Filter the result by the additional fields
4. If the filtered result is not exactly one, return null (or throw for findUniqueOrThrow)

So `findUnique({ where: { id: 'abc', tenantId: 'xyz' } })`:
1. Unique key: id = 'abc' → finds the record
2. Filter: tenantId = 'xyz' → if the found record has tenantId = 'xyz', return it; otherwise return null
3. Result: null if the record's tenantId doesn't match

This is exactly what we want! The tenant scoping works for findUnique.

Great, so my extension approach works for all operations.

Now let me also handle the `groupBy` operation specially. In Prisma, `groupBy` has a `by` field that specifies which fields to group by. I shouldn't modify the `by` field, just add tenantId to `where`.

OK, let me write the code now.

Actually, let me also think about one more thing: the `where` field for some operations can be complex (using AND, OR, NOT). When I add `tenantId` to a complex where, I need to make sure it's combined correctly.

For example:
- `{ AND: [{ email: 'test@test.com' }, { name: 'John' }] }`
- Should become: `{ AND: [{ email: 'test@test.com' }, { name: 'John' }, { tenantId: 'xyz' }] }`

But my current approach of `{ ...where, tenantId }` would produce:
- `{ AND: [...], tenantId: 'xyz' }`

In Prisma, `{ AND: [...], tenantId: 'xyz' }` is interpreted as AND([...], { tenantId: 'xyz' }), which is correct!

Great, the simple approach works.

One more edge case: what if `where` is a function? In Prisma, some operations allow passing a function for `where` (like for dynamic filtering). But this is rare and typically not used with standard CRUD. I'll ignore this case.

Now, for real this time, let me write the code.

Actually, I realize I should also handle the case where Prisma's `args.where` for `findUnique` might have ONLY a non-unique field (like `{ email: 'test@test.com' }`). In this case, my extension adds `{ tenantId }` making it `{ email: 'test@test.com', tenantId: 'xyz' }`. Since `{ email, tenantId }` is a unique composite key in our schema, this works correctly.

And if `where` has `{ id: 'abc' }`, adding `{ tenantId }` makes it `{ id: 'abc', tenantId: 'xyz' }`. Since id alone is unique, Prisma uses id as the key and filters by tenantId. If they match, returns the record; otherwise null.

All good. Let me write the code now.

Let me also think about the `readMany` and `aggregate` operations. `readMany` is deprecated in Prisma. `aggregate` returns aggregated data. For aggregate, I need to add tenantId to where as well.

OK I'm going to write the code now. Let me just go.

For the test, let me create a comprehensive spec. I'll use supertest.

Wait, do I need to install supertest? Let me check. NestJS testing utilities include `@nestjs/testing` which has `Test` and `TestingModule`. For HTTP testing, supertest is commonly used. Let me include it in the test and assume it's available.

Actually, NestJS provides `SupertestModule` or you can just use `fetch`/`axios` to make requests to a running test server. Let me use supertest since it's the standard.

Let me write the test now:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { getTenantId, setTenantContext } from '../src/common/tenant-context';
import { TenantModule } from '../src/tenant/tenant.module';

describe('Tenant Isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TenantModule, /* other modules */],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  // Tests...
});
```

Hmm, but I need to import all modules in the test. Let me think about how to structure this.

Actually, for an integration test, I should import the full AppModule or create a testing module with all required modules.

Let me create a comprehensive test that imports all necessary modules and uses supertest to test the HTTP endpoints.

Let me also think about the database. In tests, I'll use a test database. The DATABASE_URL env var should point to it.

OK, I'll write the test to:
1. Bootstrap the full app
2. Seed the database with test data
3. Test isolation via HTTP

For seeding, I'll use PrismaService directly (bypassing the extension by not setting context).

For the tests, I'll create helper functions to make authenticated requests.

Let me write everything now.

I just realized I should also have a `TenantModule` that provides the middleware and context. The middleware needs to be applied globally.

Let me also make sure the context is set correctly. In the middleware:

```typescript
async use(req: Request, _res: Response, next: NextFunction) {
  // Resolve tenant...
  tenantAsyncLocalStorage.enterWith({ tenantId: resolvedTenant.id });
  req.tenant = resolvedTenant;
  next();
}
```

`enterWith` is called before `next()`, so all async operations after this point in the same execution chain will have access to the context.

In NestJS, when middleware calls `next()`, the callback continues in the same async context. So `enterWith` should work correctly.

Let me verify: `enterWith` sets the AsyncLocalStorage store for the current execution context. When `next()` is called, the execution continues in the same async resource. Any subsequent async operations (like Prisma calls, which are microtasks) will have access to the store.

Yes, this should work.

Now let me write all the files. Here we go:

I also want to add a `TenantInterceptor` or something similar to ensure the context is set for every request. But the middleware should handle this.

Actually, let me also handle a subtle issue: if the middleware uses `await` (like `await this.tenantService.resolveByDomain()`), does the AsyncLocalStorage context propagate correctly?

In Node.js, when you do:
```typescript
async function middleware() {
  tenantAsyncLocalStorage.enterWith({ tenantId: 'x' });
  next(); // not awaited
}
```

The `enterWith` is called in the current async context. `next()` schedules the next middleware in the same async context. So the context propagates.

But what if I do:
```typescript
async function middleware() {
  await something();
  tenantAsyncLocalStorage.enterWith({ tenantId: 'x' });
  next();
}
```

The `await` might switch async contexts. Actually, no - `await` in an async function doesn't change the async resource. The async resource is the async function itself. So the context still propagates.

Wait, actually there's a nuance. When you `await` inside an async function, the continuation runs as a microtask of the same async resource. So `enterWith` after an `await` would still set the context for child async operations.

But there's a potential issue: between the `await` and `enterWith`, some async operations might run without the context. In our case, we set the context right before `next()`, so there's no async gap.

OK, this should be fine.

Now let me FINALLY write the code. I'll stop overthinking and just produce it.

Let me start with the schema and work through all files.

Actually, let me think about one more thing: should the tenant module also provide the error handling (like the exception filter)? Let me add an exception filter in AppModule to ensure all errors are formatted correctly.

Also, I should create a `NoTenantContextException` that the Prisma extension can throw, and the exception filter can translate it to a 500 or 401.

OK let me now write the code. I'll include everything.

Here's my final list of files to write:

1. prisma/schema.prisma
2. prisma/migrations/20240101000000_init/migration.sql
3. src/main.ts
4. src/app.module.ts
5. src/common/tenant-context.ts
6. src/common/exceptions.filter.ts
7. src/database/database.module.ts
8. src/database/prisma.service.ts
9. src/tenant/tenant.module.ts
10. src/tenant/tenant.service.ts
11. src/tenant/tenant.middleware.ts
12. src/tenant/tenant-prisma.extension.ts
13. src/auth/auth.module.ts (optional, maybe merge into tenant)
14. src/auth/auth.guard.ts (optional)
15. src/tenant-config/tenant-config.module.ts
16. src/tenant-config/tenant-config.controller.ts
17. src/tenant-config/tenant-config.service.ts
18. src/customers/customers.module.ts
19. src/customers/customers.controller.ts
20. src/customers/customers.service.ts
21. src/customers/customers.repository.ts
22. src/plans/plans.module.ts
23. src/plans/plans.controller.ts
24. src/plans/plans.service.ts
25. src/plans/plans.repository.ts
26. src/orders/orders.module.ts
27. src/orders/orders.controller.ts
28. src/orders/orders.service.ts
29. src/orders/orders.repository.ts
30. test/tenant-isolation.spec.ts

Let me simplify by removing the auth module (merge JWT handling into tenant service). And maybe combine some smaller files.

Actually, let me keep it modular. Each module is clean and independent. The task says to follow the layout conventions.

Let me now write all the code. I'll aim for clean, production-quality code.

Let me start writing:

I think 30 files is fine. Let me write them all.

For the DTOs, I'll create them inline in the controller/service files to reduce file count. Or I'll create a shared DTOs file.

Let me create simple inline types for DTOs.

OK here goes. I'll write the full solution now.

Wait, I also need to make sure the AuthGuard/JWT validation works. Let me include a simple auth module that validates the Bearer token.

For the auth guard, it should:
1. Check Authorization header
2. Verify token format (Bearer <token>)
3. Decode token and check for org claim

The tenant middleware then uses the decoded org claim for tenant resolution.

But wait - if the auth guard runs after the middleware (which it does in NestJS), and the middleware already extracts the org claim from the token, do I need a separate auth guard?

Let me merge them: the tenant middleware handles token extraction and validation, and sets the context. Controllers can optionally use an auth guard for explicit authentication, but the tenant middleware already ensures a valid token.

Actually, for cleaner architecture, let me have:
1. TenantMiddleware: resolves tenant from host + token, sets context. If token is invalid or host doesn't match, rejects.
2. AuthGuard: optional, can be applied to specific routes. Extracts user from token.

But for the scope of this task, I'll just have the TenantMiddleware handle everything. No separate AuthGuard needed.

Let me finalize the code now.

One more thing about the Prisma extension: when a `createMany` operation has explicit `data`, the tenant stamping needs to handle each item. And for `create`, it's a single object.

Also, for `upsert`, the `where` must have a unique identifier. Adding tenantId to it should work (as discussed above).

Let me also handle the `skip` and `take` parameters correctly - they should pass through unchanged.

And for `orderBy`, if someone orders by `tenantId`, it should still work.

OK, the code should handle all standard Prisma operations. Let me write it now.

Let me create the test file last, as it depends on all the other code.

For the test, I need to think about how to set up data. I'll use the Prisma client directly (without tenant context) to seed the database, then test via HTTP.

To use Prisma without tenant context in the test, I need to create a separate PrismaClient instance, OR use the existing one without setting context. Since the extension requires a tenant context, I should create a plain PrismaClient for seeding.

Wait, but the PrismaService creates the extended client. If I call `prisma.customer.create()` without context, the extension throws 'No tenant in context'. So for seeding, I need a non-extended PrismaClient.

Option 1: Create a second PrismaClient in the test (without extension).
Option 2: Temporarily override the extension (not possible with $extends).

Let me go with option 1: create a test PrismaClient for seeding.

Actually, even better: let me seed the database before the app starts, or use a separate PrismaClient in the test setup.

Hmm, or I could use a different approach: use a special "test" header or context that the extension recognizes and bypasses. But that's hacky.

Let me just create a plain PrismaClient in the test for setup:

```typescript
import { PrismaClient as PlainPrismaClient } from '@prisma/client';
const plainPrisma = new PlainPrismaClient();
// Use plainPrisma for seeding
```

OK, let me write the code now.

For the test to work, I need to:
1. Seed two tenants with customers using a plain PrismaClient
2. Start the app
3. Make HTTP requests with different hosts and tokens
4. Verify isolation

Let me write a comprehensive test.

Here's the test structure:

```typescript
describe('Tenant Isolation', () => {
  let app: INestApplication;
  let plainPrisma: PlainPrismaClient;

  beforeAll(async () => {
    // Seed database with plain PrismaClient
    plainPrisma = new PlainPrismaClient();
    await seedData(plainPrisma);
    
    // Start app
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await plainPrisma.$disconnect();
    await app.close();
  });

  // Test cases...
});
```

For the JWT token generation:

```typescript
function createToken(org: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ org, sub: 'user-1', iat: Date.now() / 1000 })).toString('base64url');
  const signature = Buffer.from('fake-signature').toString('base64url');
  return `${header}.${payload}.${signature}`;
}
```

For HTTP requests:

```typescript
const agentA = request.agent(app.getHttpServer());
const agentB = request.agent(app.getHttpServer());

// Request as tenant A
agentA
  .get('/customers')
  .set('Host', 'app.tenant-a.com')
  .set('Authorization', `Bearer ${tokenA}`)
  .expect(200);

// Request as tenant B
agentB
  .get('/customers')
  .set('Host', 'app.tenant-b.com')
  .set('Authorization', `Bearer ${tokenB}`)
  .expect(200);
```

Wait, but `request.agent` doesn't let me set the Host header easily. Let me use `supertest` directly:

Actually, supertest does support setting the Host header via `.set('Host', ...)`. And for agents, each agent maintains its own cookie jar (not relevant here).

Let me use supertest with explicit host:

```typescript
const reqA = request(app.getHttpServer())
  .get('/customers')
  .set('Host', 'app.tenant-a.com')
  .set('Authorization', `Bearer ${tokenA}`);
```

OK, let me write everything now.

I'm going to produce a comprehensive solution. Let me organize the code carefully.

One more thing: the `@nestjs/testing` module needs to be able to resolve all providers. I'll make sure all modules are properly wired.

Let me write the code.

Final file list (精简版):
1. prisma/schema.prisma
2. prisma/migrations/20240101000000_init/migration.sql
3. src/main.ts
4. src/app.module.ts
5. src/common/tenant-context.ts
6. src/common/exceptions.filter.ts
7. src/database/database.module.ts
8. src/database/prisma.service.ts
9. src/tenant/tenant.module.ts
10. src/tenant/tenant.service.ts
11. src/tenant/tenant.middleware.ts
12. src/tenant/tenant-prisma.extension.ts
13. src/tenant-config/tenant-config.module.ts
14. src/tenant-config/tenant-config.controller.ts
15. src/tenant-config/tenant-config.service.ts
16. src/customers/customers.module.ts
17. src/customers/customers.controller.ts
18. src/customers/customers.service.ts
19. src/customers/customers.repository.ts
20. src/plans/plans.module.ts
21. src/plans/plans.controller.ts
22. src/plans/plans.service.ts
23. src/plans/plans.repository.ts
24. src/orders/orders.module.ts
25. src/orders/orders.controller.ts
26. src/orders/orders.service.ts
27. src/orders/orders.repository.ts
28. test/tenant-isolation.spec.ts

OK now writing all the code. Let me be thorough.
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id        String   @id @default(cuid())
  name      String
  domain    String   @unique
  org       String   @unique
  branding  Json?
  flags     Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  customers Customer[]
  plans     Plan[]
  orders    Order[]

  @@map("tenants")
}

model Customer {
  id        String   @id @default(cuid())
  email     String
  name      String?
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([tenantId, email])
  @@map("customers")
}

model Plan {
  id        String   @id @default(cuid())
  name      String
  price     Float
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now())

  @@map("plans")
}

model Order {
  id        String   @id @default(cuid())
  amount    Float
  status    String
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now())

  @@map("orders")
}
```

### prisma/migrations/20240101000000_init/migration.sql
```sql
CREATE TABLE IF NOT EXISTS "tenants" (
  "id" VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" VARCHAR(255) NOT NULL,
  "domain" VARCHAR(255) NOT NULL UNIQUE,
  "org" VARCHAR(255) NOT NULL UNIQUE,
  "branding" JSONB,
  "flags" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "customers" (
  "id" VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email" VARCHAR(255) NOT NULL,
  "name" VARCHAR(255),
  "tenant_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "customers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "customers_tenant_email_unique" UNIQUE ("tenant_id", "email")
);

CREATE TABLE IF NOT EXISTS "plans" (
  "id" VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" VARCHAR(255) NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "plans_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "orders" (
  "id" VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "amount" DOUBLE PRECISION NOT NULL,
  "status" VARCHAR(255) NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "orders_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/app.module.ts
```ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantConfigModule } from './tenant-config/tenant-config.module';
import { CustomersModule } from './customers/customers.module';
import { PlansModule } from './plans/plans.module';
import { OrdersModule } from './orders/orders.module';
import { AllExceptionsFilter } from './common/exceptions.filter';

@Module({
  imports: [
    DatabaseModule,
    TenantModule,
    TenantConfigModule,
    CustomersModule,
    PlansModule,
    OrdersModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantModule).forRoutes('*');
  }
}
```

### src/common/tenant-context.ts
```ts
import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantContextStore {
  tenantId: string;
}

export const tenantAsyncLocalStorage = new AsyncLocalStorage<TenantContextStore>();

export function setTenantContext(tenantId: string): void {
  tenantAsyncLocalStorage.enterWith({ tenantId });
}

export function getTenantId(): string | undefined {
  const store = tenantAsyncLocalStorage.getStore();
  return store?.tenantId;
}
```

### src/common/exceptions.filter.ts
```ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof Error && exception.message === 'No tenant in context') {
      response.status(500).json({
        error: {
          code: 'no_tenant_context',
          message: 'No tenant context available for this request',
          details: {},
        },
      });
      return;
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException ? exception.message : 'Internal server error';
    const code = this.mapCode(exception);

    response.status(status).json({
      error: {
        code,
        message,
        details: {},
      },
    });
  }

  private mapCode(exception: unknown): string {
    if (exception instanceof NotFoundException) return 'resource_not_found';
    if (exception instanceof BadRequestException) return 'bad_request';
    if (exception instanceof UnauthorizedException) return 'unauthorized';
    if (exception instanceof HttpException) return (exception as any).message?.code ?? 'unknown_error';
    return 'internal_error';
  }
}
```

### src/database/database.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

### src/database/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantExtension } from '../tenant/tenant-prisma.extension';
import { getTenantId } from '../common/tenant-context';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      log: ['error', 'warn'],
    });
    const self = this;
    const extended = new PrismaClient().$extends(
      createTenantExtension(() => getTenantId()),
    );
    Object.assign(self, extended);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

Wait, that approach with Object.assign on PrismaClient is fragile. Let me use a cleaner approach.

### src/database/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { createTenantExtension } from '../tenant/tenant-prisma.extension';
import { getTenantId } from '../common/tenant-context';

let _instance: PrismaService;

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super({ log: ['error', 'warn'] });
    const ext = createTenantExtension(() => getTenantId());
    // Apply the extension at construction time
    const extendedClient = (this as unknown as PrismaClient).$extends(ext);
    // Copy all properties from extended client onto this instance
    for (const key of Object.getOwnPropertyNames(extendedClient)) {
      try {
        (this as any)[key] = (extendedClient as any)[key];
      } catch {
        // read-only or getter-only properties
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  static getInstance(): PrismaService {
    if (!_instance) {
      _instance = new PrismaService();
    }
    return _instance;
  }
}
```

Hmm, this is still hacky. The standard approach is to apply the extension when creating the client. Let me restructure.

### src/database/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantExtension } from '../tenant/tenant-prisma.extension';
import { getTenantId } from '../common/tenant-context';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  public readonly client: ReturnType<PrismaClient['$extends']>;

  constructor() {
    const base = new PrismaClient({ log: ['error', 'warn'] });
    this.client = base.$extends(createTenantExtension(() => getTenantId()));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
```

Hmm, `ReturnType<PrismaClient['$extends']>` won't work well. Let me just use `PrismaClient` as the type directly since `$extends` returns a PrismaClient.

### src/database/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantExtension } from '../tenant/tenant-prisma.extension';
import { getTenantId } from '../common/tenant-context';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  public readonly prisma: PrismaClient;

  constructor() {
    const baseClient = new PrismaClient({ log: ['error', 'warn'] });
    this.prisma = baseClient.$extends(createTenantExtension(() => getTenantId()));
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
```

Good, this is clean. The `PrismaClient` type works because `$extends` returns a `PrismaClient`.

Now, repositories will inject `PrismaService` and use `prismaService.prisma.customer.findMany(...)` etc.

Let me adjust the repository pattern:

### src/tenant/tenant-prisma.extension.ts
```ts
import { Prisma } from '@prisma/client';
import { getTenantId } from '../common/tenant-context';

/**
 * Creates a tenant-aware Prisma extension that:
 * - Scopes every read query by the tenant in request context
 * - Stamps every write with the tenant in request context
 * - Overwrites any tenantId supplied by the caller
 * - Fails (throws) when no tenant is in context
 */
export function createTenantExtension(
  getTenantIdFn: () => string | undefined,
) {
  return Prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          const tenantId = getTenantIdFn();

          if (!tenantId) {
            throw new Error('No tenant in context');
          }

          // ── Read operations ──
          if (
            [
              'findMany',
              'findFirst',
              'findUnique',
              'findFirstOrThrow',
              'findUniqueOrThrow',
              'count',
              'aggregate',
              'groupBy',
            ].includes(operation)
          ) {
            return query({
              ...args,
              where: injectTenantIntoWhere(args.where, tenantId),
            } as Parameters<typeof query>[0];
          }

          // ── Create ──
          if (operation === 'create') {
            return query({
              ...args,
              data: injectTenantIntoCreateData(args.data, tenantId),
            } as Parameters<typeof query>[0];
          }

          // ── Create many ──
          if (operation === 'createMany') {
            const originalData = (args as any).data as
              | Record<string, any>[]
              | undefined;
            const data = originalData
              ? originalData.map((d) => injectTenantIntoCreateData(d, tenantId))
              : originalData;
            return query({ ...args, data } as Parameters<typeof query>[0];
          }

          // ── Upsert ──
          if (operation === 'upsert') {
            const upsertArgs = args as Prisma.AnyModelUpsertArgs;
            return query({
              ...args,
              where: injectTenantIntoWhere(upsertArgs.where, tenantId),
              create: injectTenantIntoCreateData(upsertArgs.create, tenantId),
              update: injectTenantIntoUpdateData(upsertArgs.update, tenantId),
            } as Parameters<typeof query>[0];
          }

          // ── Update / Update many ──
          if (['update', 'updateMany'].includes(operation)) {
            const updateArgs = args as Prisma.AnyModelUpdateArgs;
            return query({
              ...args,
              where: injectTenantIntoWhere(updateArgs.where, tenantId),
              data: injectTenantIntoUpdateData(updateArgs.data, tenantId),
            } as Parameters<typeof query>[0];
          }

          // ── Delete / Delete many ──
          if (['delete', 'deleteMany'].includes(operation)) {
            return query({
              ...args,
              where: injectTenantIntoWhere(args.where, tenantId),
            } as Parameters<typeof query>[0];
          }

          return query(args);
        },
      },
    },
  });
}

function injectTenantIntoWhere(where: any, tenantId: string): any {
  if (!where || typeof where !== 'object' || Array.isArray(where)) {
    return { tenantId };
  }
  const { tenantId: _, ...rest } = where as Record<string, any>;
  return { ...rest, tenantId };
}

function injectTenantIntoCreateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tenantId };
  }
  const { tenantId: _, ...rest } = data as Record<string, any>;
  return { ...rest, tenantId };
}

function injectTenantIntoUpdateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tenantId: { set: tenantId } };
  }
  const { tenantId: _, ...rest } = data as Record<string, any>;
  return { ...rest, tenantId: { set: tenantId } };
}
```

Wait, I have syntax errors. Let me fix the type assertions. The `as Parameters<typeof query>[0]` is wrong. Let me just use `as any` or better yet, not cast at all and let TypeScript infer.

Actually, the `query` function in Prisma's `$extends` callback has a specific type. Let me just pass the modified args directly without casting.

Let me rewrite the extension more carefully:

### src/tenant/tenant-prisma.extension.ts
```ts
import { Prisma } from '@prisma/client';
import { getTenantId } from '../common/tenant-context';

export function createTenantExtension(getTenantIdFn: () => string | undefined) {
  return Prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantId = getTenantIdFn();

          if (!tenantId) {
            throw new Error('No tenant in context');
          }

          return handleOperation(
            { model, operation, args, query, tenantId },
          );
        },
      },
    },
  });
}

async function handleOperation(ctx: {
  model: string;
  operation: string;
  args: any;
  query: (args: any) => Promise<any>;
  tenantId: string;
}) {
  const { operation, args, query, tenantId } = ctx;

  const readOps = new Set([
    'findMany',
    'findFirst',
    'findUnique',
    'findFirstOrThrow',
    'findUniqueOrThrow',
    'count',
    'aggregate',
    'groupBy',
  ]);

  if (readOps.has(operation)) {
    const modifiedArgs = {
      ...args,
      where: addTenantToWhere(args.where, tenantId),
    };
    return query(modifiedArgs);
  }

  if (operation === 'create') {
    return query({
      ...args,
      data: addTenantToCreateData(args.data, tenantId),
    });
  }

  if (operation === 'createMany') {
    const originalData = args.data;
    const newData =
      Array.isArray(originalData)
        ? originalData.map((d) => addTenantToCreateData(d, tenantId))
        : addTenantToCreateData(originalData, tenantId);
    return query({ ...args, data: newData });
  }

  if (operation === 'upsert') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
      create: addTenantToCreateData(args.create, tenantId),
      update: addTenantToUpdateData(args.update, tenantId),
    });
  }

  if (operation === 'update' || operation === 'updateMany') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
      data: addTenantToUpdateData(args.data, tenantId),
    });
  }

  if (operation === 'delete' || operation === 'deleteMany') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
    });
  }

  return query(args);
}

function addTenantToWhere(where: any, tenantId: string): any {
  if (!where || typeof where !== 'object' || Array.isArray(where)) {
    return { tenantId };
  }
  const { tenantId: _ignored, ...rest } = where as Record<string, any>;
  return { ...rest, tenantId };
}

function addTenantToCreateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tenantId };
  }
  const { tenantId: _ignored, ...rest } = data as Record<string, any>;
  return { ...rest, tenantId };
}

function addTenantToUpdateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tenantId: { set: tenantId } };
  }
  const { tenantId: _ignored, ...rest } = data as Record<string, any>;
  return { ...rest, tenantId: { set: tenantId } };
}
```

Good. Now let me continue with the other files.

### src/tenant/tenant.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveByDomain(domain: string) {
    return this.prisma.prisma.tenant.findFirst({
      where: { domain },
    });
  }

  async resolveByOrg(org: string) {
    return this.prisma.prisma.tenant.findFirst({
      where: { org },
    });
  }

  async getById(id: string) {
    const tenant = await this.prisma.prisma.tenant.findFirst({
      where: { id },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }
}
```

### src/tenant/tenant.middleware.ts
```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { NestMiddleware, Request, Response, NextFunction } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { setTenantContext } from '../common/tenant-context';

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const host = (req.headers.host || '').split(':')[0];
    const authHeader = (req.headers.authorization || '') as string;
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    const tokenPayload = decodeJwt(token);
    const orgClaim = tokenPayload?.org;

    const hostTenant = await this.tenantService.resolveByDomain(host);
    const tokenTenant = orgClaim
      ? await this.tenantService.resolveByOrg(orgClaim)
      : null;

    if (!hostTenant || !tokenTenant || hostTenant.id !== tokenTenant.id) {
      throw new BadRequestException('Tenant resolution failed: host and token do not agree');
    }

    setTenantContext(hostTenant.id);
    (req as any).tenant = hostTenant;

    next();
  }
}
```

### src/tenant/tenant.module.ts
```ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantMiddleware } from './tenant.middleware';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [TenantService, TenantMiddleware],
  exports: [TenantService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

Wait, there's a problem. `AppModule` also imports `TenantModule` and applies `TenantMiddleware` via its own `configure`. This would apply the middleware twice. Let me fix this.

Let me remove the middleware application from `AppModule` and only have it in `TenantModule`. Or have `AppModule` import `TenantModule` and the middleware is applied once.

Actually, the issue is that `AppModule`'s `configure` references `TenantModule` as a middleware class, and `TenantModule`'s own `configure` also applies it. This is redundant. Let me clean up.

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantConfigModule } from './tenant-config/tenant-config.module';
import { CustomersModule } from './customers/customers.module';
import { PlansModule } from './plans/plans.module';
import { OrdersModule } from './orders/orders.module';
import { AllExceptionsFilter } from './common/exceptions.filter';

@Module({
  imports: [
    DatabaseModule,
    TenantModule,
    TenantConfigModule,
    CustomersModule,
    PlansModule,
    OrdersModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
```

Good, removed the `NestModule` and middleware from `AppModule` since `TenantModule` handles it.

### src/tenant-config/tenant-config.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { getTenantId } from '../common/tenant-context';

@Injectable()
export class TenantConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig() {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new NotFoundException('No tenant context');
    }

    const tenant = await this.prisma.prisma.tenant.findFirst({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return {
      name: tenant.name,
      domain: tenant.domain,
      branding: tenant.branding,
      flags: tenant.flags,
    };
  }
}
```

### src/tenant-config/tenant-config.controller.ts
```ts
import { Controller, Get } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get()
  async getConfig() {
    return this.tenantConfigService.getConfig();
  }
}
```

### src/tenant-config/tenant-config.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TenantConfigService } from './tenant-config.service';
import { TenantConfigController } from './tenant-config.controller';

@Module({
  imports: [DatabaseModule],
  providers: [TenantConfigService],
  controllers: [TenantConfigController],
  exports: [TenantConfigService],
})
export class TenantConfigModule {}
```

### src/customers/customers.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from './customers.dto';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.prisma.customer.findMany();
  }

  findById(id: string) {
    return this.prisma.prisma.customer.findFirst({
      where: { id },
    });
  }

  create(data: CreateCustomerDto) {
    return this.prisma.prisma.customer.create({ data });
  }

  update(id: string, data: UpdateCustomerDto) {
    return this.prisma.prisma.customer.update({
      where: { id },
      data,
    });
  }

  delete(id: string) {
    return this.prisma.prisma.customer.delete({
      where: { id },
    });
  }
}
```

### src/customers/customers.dto.ts
```ts
export interface CreateCustomerDto {
  email: string;
  name?: string;
}

export interface UpdateCustomerDto {
  email?: string;
  name?: string;
}
```

### src/customers/customers.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  async findAll() {
    return this.repository.findAll();
  }

  async findById(id: string) {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async create(data: CreateCustomerDto) {
    return this.repository.create(data);
  }

  async update(id: string, data: UpdateCustomerDto) {
    try {
      return await this.repository.update(id, data);
    } catch {
      throw new NotFoundException('Customer not found');
    }
  }

  async delete(id: string) {
    try {
      return await this.repository.delete(id);
    } catch {
      throw new NotFoundException('Customer not found');
    }
  }
}
```

### src/customers/customers.controller.ts
```ts
import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  async findAll() {
    return this.customersService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.customersService.findById(id);
  }

  @Post()
  async create(@Body() data: CreateCustomerDto) {
    return this.customersService.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: UpdateCustomerDto) {
    return this.customersService.update(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.customersService.delete(id);
  }
}
```

### src/customers/customers.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';

@Module({
  imports: [DatabaseModule],
  providers: [CustomersRepository, CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService],
})
export class CustomersModule {}
```

### src/plans/plans.dto.ts
```ts
export interface CreatePlanDto {
  name: string;
  price: number;
}

export interface UpdatePlanDto {
  name?: string;
  price?: number;
}
```

### src/plans/plans.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto';

@Injectable()
export class PlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.prisma.plan.findMany();
  }

  findById(id: string) {
    return this.prisma.prisma.plan.findFirst({ where: { id } });
  }

  create(data: CreatePlanDto) {
    return this.prisma.prisma.plan.create({ data });
  }

  update(id: string, data: UpdatePlanDto) {
    return this.prisma.prisma.plan.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.prisma.plan.delete({ where: { id } });
  }
}
```

### src/plans/plans.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PlansRepository } from './plans.repository';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto';

@Injectable()
export class PlansService {
  constructor(private readonly repository: PlansRepository) {}

  async findAll() {
    return this.repository.findAll();
  }

  async findById(id: string) {
    const plan = await this.repository.findById(id);
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  async create(data: CreatePlanDto) {
    return this.repository.create(data);
  }

  async update(id: string, data: UpdatePlanDto) {
    try {
      return await this.repository.update(id, data);
    } catch {
      throw new NotFoundException('Plan not found');
    }
  }

  async delete(id: string) {
    try {
      return await this.repository.delete(id);
    } catch {
      throw new NotFoundException('Plan not found');
    }
  }
}
```

### src/plans/plans.controller.ts
```ts
import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { PlansService } from './plans.service';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  async findAll() {
    return this.plansService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.plansService.findById(id);
  }

  @Post()
  async create(@Body() data: CreatePlanDto) {
    return this.plansService.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: UpdatePlanDto) {
    return this.plansService.update(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.plansService.delete(id);
  }
}
```

### src/plans/plans.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlansRepository } from './plans.repository';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';

@Module({
  imports: [DatabaseModule],
  providers: [PlansRepository, PlansService],
  controllers: [PlansController],
  exports: [PlansService],
})
export class PlansModule {}
```

### src/orders/orders.dto.ts
```ts
export interface CreateOrderDto {
  amount: number;
  status: string;
}

export interface UpdateOrderDto {
  status?: string;
  amount?: number;
}
```

### src/orders/orders.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateOrderDto, UpdateOrderDto } from './orders.dto';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.prisma.order.findMany();
  }

  findById(id: string) {
    return this.prisma.prisma.order.findFirst({ where: { id } });
  }

  create(data: CreateOrderDto) {
    return this.prisma.prisma.order.create({ data });
  }

  update(id: string, data: UpdateOrderDto) {
    return this.prisma.prisma.order.update({ where: { id }, data });
  }
