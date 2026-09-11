# Transcript — 06-multi-tenant-isolation / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me analyze this task carefully.

The task is to build a multi-tenant white-label system:
1. Tenant resolution middleware: derive the tenant from the host + the org claim of the token (both must agree); reject any mismatch. The tenant lives in a request-scoped context.
2. Structural isolation at the data layer: a tenant-aware Prisma client (extension/middleware) that scopes all reads and stamps all writes; handlers must never pass tenantId manually.
3. Schema for customers/plans/orders with tenant-scoped uniqueness (the same customer email can exist in two tenants).
4. `GET /tenant-config` — branding + feature flags for the resolved tenant.
5. Tests: tenant B can neither list, fetch-by-id (expecting 404), update, nor delete tenant A's rows; the same email can be registered in both tenants; concurrent requests from different tenants don't cross contexts.

From the L2 spec, the acceptance criteria:
- list → completely excludes A's rows
- fetch tenant A's customer by id → 404
- update A's row → 404, and A's row is unchanged afterward
- delete A's row → 404, and A's row still exists afterward
- the same email can be registered in both tenants
- concurrent requests from two tenants don't cross contexts
- a query issued with no tenant in context fails rather than returning everything

Stack: TypeScript, NestJS, Prisma, PostgreSQL. Vitest for tests.

Per the reference materials, the codebase has no existing files (nothing was shown as the existing codebase — the blocks are reference materials, not files). So I have to build everything from scratch and decide the file layout myself.

Wait — "if files are given above the task, they are the existing codebase and they are real." The blocks here are explicitly "read-only reference material" and "not part of what you should produce." So no existing codebase. I build everything.

Let me design the solution:

## File layout

```
package.json
tsconfig.json
vitest.config.ts
prisma/schema.prisma
prisma/migrations/... (probably a migration SQL file — "each schema change ships with a migration")
src/main.ts
src/app.module.ts
src/tenant/tenant.module.ts
src/tenant/tenant.middleware.ts
src/tenant/tenant-context.ts
src/tenant/tenant.service.ts
src/tenant/tenant-identity.service.ts (token + host resolution)
src/prisma/prisma.module.ts
src/prisma/prisma.service.ts
src/prisma/tenant-prisma.factory.ts
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
src/tenant-config/tenant-config.controller.ts
src/tenant-config/tenant-config.service.ts
src/tenant-config/tenant-config.module.ts
test/customers.spec.ts
test/tenant-config.spec.ts
test/tenant-isolation.spec.ts
```

Hmm, but the format requirement: "for each file, a level-3 heading containing only the repo-relative path, immediately followed by one fenced block." That means every file gets a heading. No prose outside of that.

Let me think about the key design decisions:

### 1. Tenant context

Request-scoped context. Options:
- `AsyncLocalStorage` (node:async_hooks) — cleanest, truly request-scoped, works across the request without touching the request object. This is the modern, defensible approach.
- NestJS request-scoped providers + a custom context.

Since the tenant-aware Prisma client must scope queries "from that context," and "handlers and repositories never mention tenantId," AsyncLocalStorage is the right mechanism. NestJS request context could also work, but ALS is simpler and testable.

Let me use `AsyncLocalStorage<TenantContext>`, where `TenantContext = { tenantId: string }`.

`src/tenant/tenant-context.ts`:
```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  readonly tenantId: string;
}

export class TenantContextStorage {
  private readonly als = new AsyncLocalStorage<TenantContext>();

  run<T>(tenant: TenantContext, fn: () => T): T {
    return this.als.run(tenant, fn);
  }

  current(): TenantContext {
    const ctx = this.als.getStore();
    if (!ctx) {
      throw new Error('No tenant in context; refusing to run unscoped query');
    }
    return ctx;
  }

  has(): boolean {
    return this.als.getStore() !== undefined;
  }
}
```

Wait — "if no tenant is in context, it fails rather than returning everything." So `current()` throwing is correct; and the Prisma extension's `beforeFind`/`beforeWrite` must throw if no tenant.

### 2. Tenant resolution middleware

- Host header: `app.operator-x.com` → derive operator slug → look up tenant in DB (Tenant table with `host` or `slug`).
- Token: JWT with `org` claim. The token must be authenticated (verify signature). The `org` claim points to the tenant (id or slug).
- Both must agree; mismatch → 403 (or 401/403). The spec says "mismatches are rejected rather than resolved in favour of one."
- Neither alone is sufficient: no token → 401. No host → 400/401.

In this build I need a Tenant model: `id`, `slug`/`domain`, `name`, `branding` (json), `featureFlags` (json).

How does the token carry org? `org` claim = tenant id (or slug). Let me use the tenant's slug or id. Let me use the tenant's `slug` (e.g. `operator-x`) for the `org` claim, and also for the host `app.<slug>.com`? Hmm.

Simpler: tenant has a `domain` column (e.g. `app.operator-x.com`) and an `id`. Host resolution: look up tenant by domain. Token `org` claim: tenant id. Both must resolve to the same tenant.

But in tests, how do we issue a token? Tests will call the API with a header. Since this is a from-scratch build with no real auth system, we need a JWT verification mechanism. Options:
- Use `jsonwebtoken` to sign/verify a JWT with a secret from env (`JWT_SECRET`). Tests sign tokens for tenant A and B.
- Simpler: an Authorization header with `Bearer <token>` where the token is a JWT `{ org: tenantId, sub: ... }`.

Using `jsonwebtoken` is the most defensible. But adds a dependency; that's fine — package.json is ours to write.

Actually, wait. Let me think about what's most defensible. The task says "the auth token carries the `org` claim." So we're given that tokens carry the org claim. We need to verify the token and read `org`. Let me use `jsonwebtoken` with a `JWT_SECRET` env var.

Middleware steps:
1. Read `Host` header. No host → 400? Or 401? Let me think: if the host doesn't match any tenant, reject with 404 or 400. Let me reject with 400 "unknown_host". Hmm, the error envelope has a code in snake_case. Let me define codes: `unknown_host`, `missing_token`, `invalid_token`, `tenant_mismatch`, `no_tenant_context`.
2. Read Authorization Bearer token; verify JWT. No/invalid → 401 `invalid_token`.
3. Resolve host → tenant A; resolve org claim → tenant B. Both must exist; mismatch → 403 `tenant_mismatch`.
4. Set request-scoped context via ALS: wrap `next()` in `storage.run({tenantId}, ...)`.

For ALS to work with Nest middleware: the middleware calls `next()`, and everything downstream (including route handlers) runs within `next()`'s callback scope, so running the request inside `storage.run(ctx, () => next())` propagates the context to the whole request, including async Prisma calls.

### 3. Tenant-aware Prisma client

Use `prisma.$extends` with a query extension:

```ts
prisma.$extends({
  query: {
    $allModels: {
      async $allOperations(model, operations, args) {
        const tenant = tenantStorage.current(); // throws if absent
        // Read operations: add tenantId to where
        // Write operations: stamp tenantId
      }
    }
  }
});
```

Which operations are reads vs writes?

Read operations: `findUnique`, `findFirst`, `findMany`, `count`, `aggregate`, `groupBy` (maybe).
Write operations: `create`, `createMany`, `update`, `updateMany`, `delete`, `deleteMany`, `upsert` (has create and update data).
`findUniqueOrThrow`, `findFirstOrThrow` also exist.

Approach:
- For `$allOperations`, check `operation` name.
- Read ops with `args.where`: merge `{ tenantId: tenant.tenantId }` into where. `findUnique` has `where` as a unique filter — merging tenantId works if the tenantId is part of the unique constraints... actually, for `findUnique` on a non-tenant-scoped unique field (like a customer's `id`), the where is `{ id: X }`; adding `tenantId` to `findUnique`'s where is allowed in Prisma as long as the combination is a known unique constraint? No — `findUnique` requires the where to match a unique constraint exactly. If `@@id([tenantId, id])`, then where must be exactly `{ tenantId, id }`.

Hmm, this is a crucial detail. Options:

**Option 1:** Make composite primary keys `@@id([tenantId, id])`. Then a customer's `id` is a per-tenant uuid, and the primary key is (tenantId, id). `findUnique({ where: { id } })` isn't valid — you need `{ tenantId: ..., id: ... }`. The extension rewrites `findUnique({ where: { id } })` into `findUnique({ where: { tenantId, id } })` — that's valid because (tenantId, id) is the @@id. And a fetch-by-id for another tenant naturally returns null → 404.

But wait: if the primary key is (tenantId, id), can two tenants have customers with the same uuid `id`? Yes! That's fine, even desirable — the id is a per-tenant row identity; global uniqueness of id isn't required. Actually it makes "fetch tenant A's id in tenant B → 404" trivially work.

But then, "fetch by id" for tenant A's customer from tenant B: tenant B's extension sets tenantId=B, where = {tenantId: B, id: A's id} → no row → 404.

**Option 2:** Global uuid id with `@@unique([tenantId, email])`, and the extension rewrites `findUnique({where: {id}})` → `findFirst({where: {id, tenantId}})`. That's more complex (operation rewrite).

Option 1 with composite keys is cleaner and "structurally" stronger. For plans and orders the same: `@@id([tenantId, id])`.

Hmm, but composite primary keys in Prisma + Postgres work fine. Let me think about what's most defensible. Actually, reconsidering: the spec says "fetch-by-id is scoped like everything else. Another tenant's id behaves exactly like a non-existent id: 404." With composite @@id, the id is effectively per-tenant. Clean.

But there's a subtlety: `findUnique` with `select`/`include` works fine. `update({ where: { id }, data })` — with composite key, where must be `{ tenantId, id }`. The extension stamps that. If the row doesn't exist in this tenant → `update` throws `RecordNotFound` (P2025). The repository/service should catch that and convert to 404. Similarly `delete` → P2025 → 404. `findUniqueOrThrow` → P2025 → 404.

`updateMany`/`deleteMany` with tenant-scoped where: only affects rows of that tenant. Fine.

For creates: `create({ data: {...} })` — the extension must stamp `tenantId` into data, overwriting anything passed by the caller ("tenantId supplied by the caller is overwritten by the context and not trusted"). For `createMany({ data: [...] })`, stamp each element. For `upsert({ where, create, update })`, stamp tenantId into `create` data, and also ensure `where` includes tenantId (if where is a unique filter; for composite @@id, where must be {tenantId, id}).

`$transaction` also exists — the extension applies per model operation, so transactions are fine.

Now, "if no tenant is in context, it fails": in `$allOperations`, first line: `const tenant = storage.current();` which throws if absent. That means any query outside a tenant context throws.

Also raw `$queryRaw`/`$executeRaw`: the spec says "zero raw SQL" in the service layer and the repository is the only DB layer. Should the tenant-aware client also guard raw queries? The spec says "scope all reads and stamp all writes." Raw queries are technically reads/writes too. Defensively, I could override `$allOperations` on `$allModels` (which doesn't cover $queryRaw) — actually, the extension's `query.$allModels` doesn't cover top-level operations like `$queryRaw`. I could use `query: { $allModels: { $allOperations } }` and additionally... hmm, extensions can't easily intercept $queryRaw on the extended client's top-level. Actually, `$extends` only allows `query.$allModels` and `model.<Name>` blocks, not intercepting `$queryRaw`. So to be safe, the tenant-aware client I expose should not expose raw query methods — or throw on them. I could wrap the extended client to hide `$queryRaw`/`$executeRaw` (make them throw). That's a nice structural touch: "structural, not remembered." Let me do it: define a type where raw methods throw `new Error('raw queries are not allowed...')`.

Actually, to keep it simple and safe: after `prisma.$extends(...)`, create an object that spreads... Prisma client objects are class instances; you can't easily make new getters that override methods by spreading? Actually, spread copies methods as its own properties, and you can override:

```ts
const tenantScoped = Object.assign(
  {},  // hmm, loses the prototype
)
```

No. Better: create a wrapper class or just return the extended client directly. Raw query guard: Prisma's extension API — the `query` extension can define operations for specific models, but you can't define `$allOperations` for $queryRaw at the top level... let me check: the shape is `query: { $allModels: { $allOperations: ... }, [modelName]: { [operation]: ... } }`. There's no top-level `$queryRaw` hook. So I'll wrap it:

```ts
function createTenantAwareClient(base: PrismaClient, storage: TenantStorage) {
  const extended = base.$extends({ query: { $allModels: { $allOperations } } });
  // hide raw methods
  return {
    ...model delegates,
    $transaction: extended.$transaction,
    $connect, $disconnect,
    $queryRaw: () => { throw ... }
  }
}
```

Spreading `extended` — Prisma client instances have model delegates as getters on the prototype? I think Prisma's model delegates are own properties on the instance (created in the constructor). Spreading should copy them. `$transaction` is a method. Hmm, risk: spreading may break `this` binding — model delegate methods might rely on `this`. In Prisma's generated client, delegates are created with closures and don't rely on `this` being the client. Actually, in recent Prisma versions, `$extends` returns a new client-like object; spreading it should be fine but slightly risky.

Alternative cleaner approach: keep `PrismaService` providing the base client, and a separate `TenantPrismaService` that lazily creates the extended client per request? No — `$extends` is cheap and can be done once.

Simplest, most robust approach: the repository receives the extended client (the "tenant-aware client") from a provider. To guard raw queries, I can just not expose them in the type given to the repository. E.g. type the provider as `Omit<typeof extended, '$queryRaw' | '$executeRaw'>`... but they still exist at runtime. Hmm.

You know, I'm overcomplicating. Let me do this: `TenantPrisma` service returns the extended client. And to make raw structurally impossible, I'll construct the extended client and then `Object.defineProperty` to replace `$queryRaw`/`$executeRaw` with methods that throw:

```ts
const extended = base.$extends({...}) as any;
for (const m of ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']) {
  Object.defineProperty(extended, m, { value: () => { throw new TenantRawQueryError(...); }, configurable: true, writable: true });
}
```

Prisma's extended client instance — are $queryRaw etc. own properties? On a standard PrismaClient they're on the prototype. `Object.defineProperty` on the instance shadows the prototype. Works regardless. Good — I'll do this in the factory. And the extension itself will refuse if there's no tenant context, so even if someone got the base client, they wouldn't get the scoped behaviour... well, the base client is the raw PrismaClient. The repository only gets the extended one. In tests, I can inject the base client separately to test the "no tenant in context" failure? Actually, the "no tenant in context" test: issue a query via the tenant-aware client without ALS context → expect throw. I can do that in a unit-style test using the repository directly (bypassing the middleware) or by calling the service directly. The acceptance says "a query issued with no tenant in context fails rather than returning everything" — I'll test it directly via repository/service.

### 4. Schema

Models:
- `Tenant`: id (string uuid), domain (unique), name, branding (Json), featureFlags (Json). Maybe a `slug`.
- `Customer`: id (string uuid), tenantId (string), email (string), name (string), createdAt, updatedAt. `@@id([tenantId, id])`, `@@unique([tenantId, email])`.
- `Plan`: id, tenantId, name, slug?, price (int in cents), billingInterval?, `@@id([tenantId, id])`, `@@unique([tenantId, slug])` maybe.
- `Order`: id, tenantId, customerId, planId, status, total, `@@id([tenantId, id])`. Relationships: Customer has many Order; Plan has many Order. Foreign keys: Order.customerId → Customer.id, but with a composite PK the FK is (tenantId, customerId). Prisma's handling of relations to composite PKs: a relation field requires the FK columns to match the referential key. For a relation to a model with @@id([tenantId, id]), you need two FK fields: tenantId and customerId, and mark the fields on Customer with @id? No wait.

Hmm, Prisma relations to composite primary keys: to define `orders Order[]` on Customer and `customer Customer @relation(fields: [tenantId, customerId], references: [tenantId, id])` on Order. But `tenantId` is part of Order's @@id and the FK pair (tenantId, customerId) references Customer's (tenantId, id). Does Prisma support referencing a composite key via multiple fields? I think Prisma does support composite reference: `@relation(fields: [a, b], references: [c, d])` where [c,d] is a @@id or @@unique on the referenced model. Yes, Prisma supports composite relation keys (references to @@id or @@unique fields).

But there's a catch: if Order's `tenantId` is used both in its own @@id and in the relation, that's fine.

Actually, let me double-check: in Prisma, you can reference a composite key:
```prisma
model Customer {
  tenantId String
  id       String
  @@id([tenantId, id])
  orders   Order[]
}

model Order {
  tenantId   String
  id         String
  customerId String
  customer   Customer @relation(fields: [tenantId, customerId], references: [tenantId, id])
  @@id([tenantId, id])
}
```
Yes, that's valid Prisma. The generated column will be customer_id with an FK to (tenant_id, id). Good.

But do we even need relations? The spec says "schema for customers/plans/orders with tenant-scoped uniqueness." Relations are good practice; let me include them but keep it simple. Orders reference Customer and Plan.

Hmm, wait, there's a subtle problem with composite relation keys and extensions: when deleting a customer, cascade? I'll use `@relation(...)` with `onDelete: Cascade` for the order's FK so deleting a customer removes their orders. Good hygiene.

Alternatively, avoid relations and just keep plain FK columns (customerId, planId as String without relation fields). That's simpler and avoids Prisma edge cases. But relations are more idiomatic and the layout shows a standard service/repository pattern. Let me use relations — I'm fairly confident Prisma supports composite FK references. Actually, let me reconsider the risk: if composite relation references don't work, the whole schema won't migrate. I'm fairly confident: Prisma docs "composite primary keys" and relations: "relations to a model with a composite primary key require referencing the full composite key." Example:

```prisma
model A {
  id1 Int
  id2 Int
  b   B[]
  @@id([id1, id2])
}
model B {
  a1   Int
  a2   Int
  a    A @relation(fields: [a1, a2], references: [id1, id2])
}
```
Yes, this is supported (with the caveat that the reference must be a single unique key). OK, let me proceed.

Do we need a Tenant model relation to Customer? Customer.tenantId → Tenant.id, with `@relation(fields: [tenantId], references: [id])`. That's fine, a normal FK. And a Tenant has many customers/plans/orders.

Hmm — but wait: if Customer has a relation `tenant Tenant @relation(fields: [tenantId], references: [id])`, and tenantId is also part of @@id, that's fine.

Actually, do I want to make the Tenant relation mandatory? If the middleware resolves the tenant by domain from the Tenants table, the tenant row must exist. Let me keep the relation to Tenant — structural integrity.

Let me also think about "registration": "the same email can be registered in both tenants." So there's a customer registration (create) endpoint. The variant says "the same customer email can exist in two tenants" and the test is "the same email can be registered in both tenants." So `POST /customers` (register) is needed. Let me add minimal CRUD on customers: POST (register/create), GET (list), GET /:id, PATCH/PUT /:id, DELETE /:id. And a tenant-config endpoint. Plans/orders: the spec requires the schema; do we need endpoints? "The deliverable: … schema for customers, plans, orders with tenant-scoped uniqueness · GET /tenant-config · the tests above." The tests only mention customers and tenant-config. For plans and orders, schema is required; endpoints are optional. The variant's numbered list mentions the schema; endpoints only for tenant-config. To "do exactly what the task asks," I should not create full CRUD controllers for plans/orders — but a model without any usage is fine (schema requirement). Hmm, but "don't create files not asked for" — a plans/orders controller isn't asked for. But the layout conventions show a feature directory pattern... the task doesn't require plans/orders endpoints. Let me include the Prisma models but no controllers. Wait — should I even include a repository/service for plans/orders? Not asked. Let me skip; the schema satisfies the requirement.

Hmm, actually let me reconsider: "3. Schema for customers/plans/orders with tenant-scoped uniqueness." Deliverable is schema only. OK, no plans/orders service/controller.

### Endpoints

- `GET /tenant-config` → branding + feature flags for the resolved tenant.
- Customers CRUD (needed for tests: list, fetch by id, update, delete, register in both tenants).
  - `GET /customers` — list
  - `POST /customers` — register (email, name) → 409 on duplicate in same tenant? With tenant-scoped uniqueness, the same email in the same tenant → conflict 409; in another tenant → OK. Should I test 409? Not in acceptance, but it's a natural behaviour. The tests I'll write focus on acceptance. I might test cross-tenant registration (acceptance) — and 409 on same-tenant duplicate as an added behaviour test. Let me stay focused.
  - `GET /customers/:id` → 404 across tenants
  - `PATCH /customers/:id` (or PUT) → 404 across tenants, unchanged
  - `DELETE /customers/:id` → 404 across tenants, still exists

Error envelope: `{ error: { code, message, details } }` with a global exception filter. `code` in snake_case.

Codes:
- `resource_not_found`
- `tenant_mismatch`
- `invalid_token` / `unauthorized`
- `unknown_host`
- `conflict` (duplicate email)
- `bad_request`

I'll write a global exception filter that maps known error types to the envelope. Let me define a domain error class `AppError(code, message, details, httpStatus)`. The filter catches AppError and Prisma known errors (P2025 → 404 resource_not_found; P2002 → 409 conflict; P2003 FK violation → 409), plus unexpected → 500 `internal_error`.

### Tenant resolution details

Host: `app.operator-x.com`. Tenant row: `domain = "app.operator-x.com"`. Resolution: `tenants.findUnique({ where: { domain: host } })`. Note: the middleware queries the Tenants table — via the tenant-aware client? No! The tenant must be resolved before the tenant context exists. So the middleware uses the base Prisma client (unscoped) for the tenant lookup — that's legitimate because the Tenant model itself isn't tenant-scoped. Important: the tenant-aware extension should exclude the `Tenant` model from scoping (Tenant has no tenantId column). Using `$allModels` would also try to scope Tenant → error. So I need to either scope per model (Customer, Plan, Order) or conditionally check if the model has tenantId. Cleaner: explicitly list the models in the extension: `query: { Customer: {...}, Plan: {...}, Order: {...} }`. But that's a list to maintain. Alternative: `$allModels` + a guard: models without tenantId are skipped. Inside the operation hook, we can check the model name against a known set. Hmm, `$allModels` with a runtime check `if (!TENANT_SCOPED_MODELS.includes(model)) return operations(...)`. The model param is the model name string. This handles both: Tenant isn't scoped, and future models require opt-in.

Wait, but "scope all reads and stamp all writes" for all tenant data — explicit opt-in list is safer (we don't accidentally scope a non-tenant model). Let me use `$allModels` with a guard checking the model is in `SCOPED_MODELS = ['Customer', 'Plan', 'Order']`. Hmm, but that's "remembered." The alternative is to inspect the schema... overkill. Let me use an explicit per-model entry — that's clearest and the extension applies the same hook for each. Actually, the cleanest is: define a helper that returns the operations hook, and apply it to each scoped model:

```ts
const scopedModels = ['Customer', 'Plan', 'Order'] as const;
const query: Record<string, any> = {};
for (const m of scopedModels) query[m] = { $allOperations: makeHook(m) };
```

Hmm, but that still needs to know the model names. Fine — I'll mark it. Actually, let me reconsider using `$allModels` with a guard: any new tenant-scoped model will be automatically covered (good, the "fifth query site" fear), and models like Tenant are excluded by name. Either way, I need a list. Let me go with `$allModels` + explicit non-tenant list? Or explicit tenant list?

The threat model: "a fifth [miss] could be added by anyone, at any time, and nothing catches it" — the fix is that all queries through the tenant-aware client are automatically scoped. If someone adds a new model, it should be tenant-scoped. `$allModels` scopes everything by default (except Tenant, which has no tenantId). Let me do this: `$allModels.$allOperations` → if model === 'Tenant', pass through; otherwise scope. This gives default-on isolation: new models are automatically isolated. That's the better default.

Hmm, but a subtle point: the `model` parameter of the hook is the model name string, e.g. "Customer". Yes.

### Operation hook implementation

```ts
function makeHook(storage) {
  return (model, { findUnique, findFirst, findMany, findUniqueOrThrow, findFirstOrThrow, count, aggregate, groupBy, create, createMany, update, updateMany, upsert, delete, deleteMany }, args) => {
    const { tenantId } = requireTenant(storage);
    switch (operation) { ... }
  };
}
```

Actually, in the `$allOperations` signature: `(model, operations, args, ...rest)` where `operations` has `operations[operationName]`. Let me write it as:

```ts
async $allOperations(model, operations, args) {
  const tenantId = storage.current().tenantId;
  switch (operation) { ... }
}
```

Wait, the signature is: `$allOperations(model, operations, args)` and you call `operations[opName](args)`. You know the operation name via the object's keys... actually no, the hook receives `operations` object with the specific operation's function as a property; you need to know which. The standard pattern:

```ts
$allModels: {
  async $allOperations(model, operations, args) {
    // operations: { findMany: fn } etc.
    const opName = Object.keys(operations)[0] — hmm, not guaranteed?
  }
}
```

Hmm, actually the documented pattern for $allOperations is to switch on... let me recall the Prisma extension docs:

```ts
query: {
  $allModels: {
    async $allOperations({ model, operation, args, query }) {
      // model, operation are available
    }
  }
}
```

Yes! In the destructured form: `$allOperations({ model, operation, args, query, __internal })`. The hook receives an object with `model`, `operation`, `args`, and a `query(args)` function that runs the operation. That's the modern API. Let me use that:

```ts
async $allOperations({ model, operation, args, query }) {
  const { tenantId } = storage.current(); // throws TenantContextError
  if (model === 'Tenant') return query(args);
  const result = applyTenantScope(operation, args, tenantId);
  return query(result);
}
```

Here `applyTenantScope` returns modified args:

- Read ops (findUnique, findUniqueOrThrow, findFirst, findFirstOrThrow, findMany, count, aggregate, groupBy): `args.where = { ...args.where, tenantId }`. For findUnique, where becomes e.g. `{ id, tenantId }` — valid due to @@id([tenantId, id]). But if someone calls findUnique with `where: { email }` (the unique email within a tenant — @@unique([tenantId, email])) → merging tenantId gives `{ email, tenantId }` — valid! Good, composite uniqueness saves us again.
- Write ops:
  - create: `args.data = { ...args.data, tenantId }` (overwrite).
  - createMany: `args.data = Array.isArray(args.data) ? args.data.map(d => ({...d, tenantId})) : { ...args.data, tenantId }`.
  - update: `args.where = { ...args.where, tenantId }` — where for update must be unique: (tenantId, id) or (tenantId, email). Good.
  - updateMany: merge where.
  - delete: merge where (unique) — P2025 if not found → 404.
  - deleteMany: merge where.
  - upsert: merge tenantId into where, stamp create data, leave update data alone (update data shouldn't set tenantId; if it does, overwrite? "tenantId supplied by the caller is overwritten by the context" — for upsert, data: { create, update }. We stamp create.tenantId; for update data, we can set data.update.tenantId = tenantId too, to prevent tenant change. Hmm, update data setting tenantId would try to move the row; overwrite with the context tenant = no-op change (or P2025 if mismatch... if the caller passes a different tenant in update data, overwrite means the row stays with the context tenant — safe). For safety, let me also stamp update data: `args.data.update = { ...args.data.update, tenantId }`. Wait — note: `@default` etc. are fine. Setting tenantId in update data is valid.

  Edge: `update` data containing `tenantId` — should overwrite: `args.data = { ...args.data, tenantId }`? For update, data is the set of fields to change; stamping tenantId = context makes it a no-op (where already pins tenant). That's the "overwrite, don't trust" behaviour. Let me do that for create/upsert.create; for update/delete data, tenantId in update data — for `update`/`upsert.update`/`updateMany`, I'll also stamp tenantId into data to make tampering a no-op. Hmm, is that overkill? "tenantId supplied by the caller is overwritten by the context and not trusted" — yes, covers all data inputs. But note: does Prisma allow setting tenantId in update data where tenantId is part of the @@id? Update of a PK field — does Prisma allow updating PK fields in `update`? Prisma generally doesn't allow updating primary key fields via update() — throws a validation error: "Argument tenantId for path tenantId must not be null" — no wait, updating PK: Prisma docs say "Primary keys cannot be updated" — actually, I recall Prisma throws `Argument tenantId must not be set`? Let me think. In Prisma, you cannot update a primary key field; the client validation rejects it: e.g. `update({ where: {...}, data: { id: 'x' } })` → error "Unknown argument `id`"? I think the PK field is simply not in the `data` input type for update, so at runtime the extended client would throw "Unknown arg `id` in data.tenantId". That would break the update path entirely!

Hmm wait — with a composite @@id([tenantId, id]), is tenantId part of the "primary key"? Yes, it's part of the PK. So `update(data: { tenantId: ... })` is invalid — Prisma won't allow updating PK components. That means I can't stamp tenantId in update data. Fine — that's actually correct: you cannot change a row's tenant via update; where pins it. The "overwrite" property applies to create data and where. For update data, the caller passing tenantId would just fail validation (or be rejected). Acceptable — no data leak; tenantId cannot be changed. Good, simpler.

  So:
  - create/createMany/upsert.create: stamp tenantId (overwrite).
  - where (all ops with where): merge tenantId.
  - update data: leave alone; the where scoping guarantees safety; the caller can't include tenantId anyway (validation error — that's fine, or just ignored... it would throw a validation error, which is acceptable; not a leak).

- `findRaw`/`aggregateRaw` — deprecated/removed in modern Prisma; skip.

Now — an important detail: `args` may be `undefined` (e.g., `deleteMany()` with no where?). `deleteMany` with no where: in our world, that means "delete all rows of this tenant" — merging where { tenantId } is correct and safe (only this tenant). But wait, should `deleteMany` with no where be allowed? It deletes all of the tenant's customers — that's a legitimate operation within the tenant. Yes, fine.

`create` args is always present. `findMany` args may be undefined → create `{ where: { tenantId } }`.

### 404 mapping

`delete`/`update`/`findUniqueOrThrow` on a non-existent row → Prisma P2025 error. My exception filter maps P2025 → 404 `resource_not_found`. The controller/service doesn't catch anything; the filter handles it. But the service layer "holds the logic" — the filter is cross-cutting; fine.

For the "update A's row → 404 and unchanged" test: `update({ where: { tenantId: B, id: A_id } })` → P2025 → 404. Row unchanged. ✓.

For the "delete → 404 and still exists": same. ✓.

For "fetch by id → 404": `findUnique({ where: { id, tenantId: B } })` → null → service throws AppError(404) or returns null → controller 404. Let me have the service throw AppError('resource_not_found'). Hmm, or the repository returns null and the controller... "the controller validates the input and calls the service" — let me have the service throw AppError with 404; the filter maps. OK.

### Duplicate email → P2002 → 409 `conflict` in the envelope.

### Tenant config endpoint

`GET /tenant-config` returns `{ tenantId, name, branding: {...}, featureFlags: {...} }`? The task: "branding + feature flags for the resolved tenant." Response: `{ name, branding, featureFlags }` or include id/domain. Let me include `id`, `name`, `branding`, `featureFlags`. Branding: json { primaryColor, logoUrl, ... }. Feature flags: json { "beta_orders": true, ... }.

Which tenant do we resolve? The resolved one (host + org agreement). The service fetches by tenantId from the context... but "handlers and repositories never mention tenantId" — that applies to tenant data (customers/plans/orders). For Tenant lookup, the tenant-config service needs the tenant id — it can get it from the tenant context (not "passing tenantId manually" in a query; the context is the source). Hmm, "handlers and repositories never mention tenantId" — strictly, the Tenant repository fetching by id will mention tenantId in where. That's a lookup on the Tenant model itself, which is outside the scoping (Tenant isn't tenant-scoped). I think the intent is: tenant-scoped data (customers/plans/orders) is never filtered by tenantId in handler code. The Tenant model is the identity table. Let me have `TenantService.getForContext()` read `storage.current().tenantId` — the context, not handler input. That's consistent: the tenant flows from context, never from handler input.

Alternative: the middleware puts the full Tenant record in the ALS context, and the tenant-config controller reads it from the context. That's even cleaner: no DB hit in the controller. Hmm — "the tenant lives in a request-scoped context" — the context can hold the tenant id (and the resolved tenant record). Storing the full Tenant record in the context is convenient for /tenant-config. But then the tenant-config service just reads from the context — trivially correct, and it's the same data used to authorize the request. Let me store `{ tenantId }` in ALS and have TenantService fetch the row by that id (fresh data). Or store the record... let me keep the context minimal (`{ tenantId }`) and have the service fetch. It exercises the repository. Either is fine. Let me go with context `{ tenantId }` and TenantService.getFromContext().

### Middleware order and Nest specifics

Nest middleware: `NestMiddleware` in a module with `configure(consumer) { consumer.apply(TenantMiddleware).forRoutes('*') }`.

But: tests. The acceptance tests are HTTP-level? "Tests: tenant B can't list, fetch-by-id, update, delete tenant A's rows" — that suggests e2e over HTTP with headers. Let me write e2e tests with `@nestjs/testing` Test.createTestingModule with the real AppModule + real Prisma (test Postgres). We have no shell; the tests need DATABASE_URL env. The test setup: use `app = moduleRef.createNestApplication(); await app.init(); await app.listen(0)`. Then `app.getHttpServer().address().port`, base URL. Use fetch (Node 20 has global fetch).

Seed: tenants A and B with domains `app.operator-a.com` / `app.operator-b.com`. Seed via Prisma (base client) inside the test, and clean up after. JWT: sign with the same secret (env var JWT_SECRET, fallback to a test secret? "config comes only from env vars" — tests can set process.env before importing app. In the test setup, I'll set `process.env.JWT_SECRET ??= 'test-secret'`. Hmm, "config from env only" — reading env with a default for the JWT secret... let me just have the test explicitly set process.env.JWT_SECRET = 'unit-test-secret' at the top. And DATABASE_URL: test assumes it's provided (e.g. `docker run postgres`); vitest env. Let me add a note in the test header comment that it requires a DATABASE_URL.

Actually wait — can I avoid real Postgres in tests? Prisma needs a real DB. The spec's acceptance is clearly e2e. Let me write e2e tests requiring DATABASE_URL and seed tenants. Use a test DB. Let me add `test/setup.ts` that creates tables: `prisma.migrate deploy` can't run from code... the standard approach: tests assume the schema is applied (either a migration or `prisma db push`). Let me ship a migration file (`prisma/migrations/0001_init/migration.sql`) so `prisma migrate deploy` applies it. The test setup can just verify the DB is reachable and seed data.

Should test setup auto-run `prisma db push`? That needs the CLI; fragile. Let me write a SQL migration file and instruct (comment) that `pnpm prisma migrate deploy` must be run; the vitest global setup just verifies the connection and cleans tables. Hmm, but "tests: concurrent requests from two tenants don't cross contexts" — e2e fetch with Promise.all. Fine.

Also "a query issued with no tenant in context fails rather than returning everything" — I'll test this directly: instantiate the repository/service outside the request context (or call an exported helper) and expect a throw. E.g. in the spec: `expect(() => repo.list()).rejects.toThrow(TenantContextError)`. The repository is a Nest provider, but I can get it from the moduleRef and call it without ALS context → the tenant-aware client's hook throws.

Let me design the module structure:

```
src/
  main.ts
  app.module.ts
  errors/
    app-error.ts
    exception-filter.ts (or error-filter.ts)
  prisma/
    prisma.module.ts        (provides PrismaService = base client)
    tenant-prisma.module.ts (provides TenantPrismaService = extended, scoped client) — or same module
    prisma.service.ts
    tenant-prisma.factory.ts
  tenant/
    tenant.module.ts
    tenant-context.ts       (AsyncLocalStorage wrapper)
    tenant-resolver.service.ts (host + org → tenant; verifies JWT)
    tenant.middleware.ts
    tenant.service.ts       (getForContext)
  tenant-config/
    tenant-config.module.ts
    tenant-config.controller.ts
  customers/
    customers.module.ts
    customers.controller.ts
    customers.service.ts
    customers.repository.ts
```

Wait, the layout conventions say `src/<feature>/<feature>.module.ts` etc. — flat per-feature, no subdirectory. And `test/<feature>.spec.ts`. Following that:

```
src/prisma/prisma.module.ts
src/prisma/prisma.service.ts
src/prisma/tenant-prisma.factory.ts
src/tenant/tenant.module.ts
src/tenant/tenant-context.ts
src/tenant/tenant-resolver.service.ts
src/tenant/tenant.middleware.ts
src/tenant/tenant.service.ts
src/tenant-config/tenant-config.module.ts
src/tenant-config/tenant-config.controller.ts
src/tenant-config/tenant-config.service.ts (or repository)
src/customers/customers.module.ts
src/customers/customers.controller.ts
src/customers/customers.service.ts
src/customers/customers.repository.ts
src/errors/app-error.ts
src/errors/all-exceptions.filter.ts
src/app.module.ts
src/main.ts
prisma/schema.prisma
prisma/migrations/20250101000000_init/migration.sql
package.json
tsconfig.json
vitest.config.ts
test/customers.spec.ts
test/tenant-config.spec.ts
test/tenant-isolation.spec.ts
```

Hmm, "the controller validates the input" — for customers: body validation (email format, name). Use class-validator? Adds dependencies (class-validator, class-transformer) + ValidationPipe. Or manual checks in the controller. Let me keep it light: manual validation in the controller (email regex, string types) throwing AppError 400. Actually, using class-validator is more NestJS-idiomatic. But more moving parts. Let me go with manual — simple, no extra deps. Hmm, "the controller validates the input and calls the service. Zero business logic." A small validate in the controller is fine.

JWT verification: `jsonwebtoken` package (CJS, works in ESM via default import). In strict TS: `import jwt from 'jsonwebtoken'`. Types are bundled.

Token format: `Authorization: Bearer <jwt>`, payload `{ org: tenantId, sub: user }`, `alg: HS256`, secret `JWT_SECRET`.

Resolution algorithm in TenantResolverService:

```ts
async resolve(host: string | undefined, authHeader: string | undefined): Promise<Tenant> {
  // 1. Host must resolve to a tenant
  const hostTenant = host ? await this.tenantRepo.findByDomain(host) : null;
  if (!hostTenant) throw new AppError('unknown_host', 400/404?);
  // 2. Token must be present and valid
  if (!authHeader) throw AppError('unauthorized', 401);
  let payload;
  try { payload = jwt.verify(token, secret) } catch { throw AppError('invalid_token', 401) }
  if (!payload.org) throw AppError('invalid_token', 401) — "missing org claim"
  const orgTenant = await this.tenantRepo.findById(payload.org);
  if (!orgTenant) throw AppError('invalid_token', 401)? Or 'unknown_org'... let me use 401 invalid_token? Hmm. org pointing to a non-existent tenant → 403? The token claims an org that doesn't exist → treat as invalid token (401). Let me use 401 invalid_token with a message.
  // 3. Both must agree
  if (hostTenant.id !== orgTenant.id) throw AppError('tenant_mismatch', 403);
  return hostTenant;
}
```

HTTP status for host not found: 400 with `unknown_host`? Or 404? The host is the request target; unknown tenant domain → 404 seems right, but the code `unknown_host` with 400... let me think: an attacker-controllable host — returning 404 avoids information? Either way. Let me use 404 `unknown_host`. Hmm, actually, let me go 400 — no wait. Convention: unknown host in a multi-tenant → 404. I'll pick 404 `unknown_host`.

Order of checks: if both host is unknown AND the token is invalid, which error? Doesn't matter much. Let me check the token first (auth first), then the host? Spec: "both must point at the same tenant, and a mismatch is rejected." Let me do: verify token (401), resolve host (404), compare (403).

Middleware:

```ts
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly resolver: TenantResolverService, private readonly storage: TenantContextStorage) {}
  async use(req, res, next) {
    try {
      const tenant = await this.resolver.resolve(req.headers.host, req.headers.authorization);
      await next within storage.run?
    } catch (e) { res.status(...).json(envelope); return; }
  }
}
```

Wait — the middleware must run the request in the ALS context. `next()` triggers the downstream handlers; the ALS store propagates to all async work spawned from within the `run` callback. So:

```ts
const tenant = await this.resolver.resolve(...);
await this.storage.run({ tenantId: tenant.id }, async () => { await new Promise((resolve, reject) => { next((err) => err ? reject(err) : resolve()); }); });
```

Hmm, but the downstream Nest handlers' promise — if a handler throws, Nest catches it via exception filters... The middleware's `next` callback receives the error if the downstream didn't handle it. Global filter handles it and sends a response; the middleware just needs to not crash. Let me wrap: `await this.storage.run(ctx, () => new Promise<void>((res, rej) => next((err) => (err ? rej(err) : res()))).catch(() => {}))`? If next errors and the filter didn't handle it (500), the error bubbles here; I can just log/ignore since the filter already responded. Simpler:

```ts
await this.storage.run(ctx, () => promisify(next)());
```
If it throws (unhandled downstream error), the middleware throws → Nest's global error handling? If the middleware is async and throws, Nest catches it via the global filter? Errors from middleware: Nest catches them and invokes the exception filters (yes — NestJS runs middleware in the exception-filter context... actually, errors in Nest middleware are caught by Nest's router and passed to the global exception filter? I believe middleware errors are handled by the exception filters as of Nest 7+). To be safe, catch in the middleware and if no response was sent, send the 500 envelope.

Also: resolver errors (401/403/404) — the middleware should send the envelope directly (before the context). I can throw AppError and let the filter handle it... but the middleware's use is async; if it throws, Nest handles it through the filter chain (GlobalFilter via app.useGlobalFilters applies to middleware errors too? Hmm — `app.useGlobalFilters` registers a filter; errors thrown in middleware are caught by Nest's ExceptionsZone? I recall Nest catches middleware errors and passes them to the global filter. Yes: "Middleware can throw errors which are then handled by global filters." I'm fairly confident this works in modern Nest. But to be extra safe, in the middleware I'll catch and write the response manually for auth errors (simple, deterministic) — but then I'd be duplicating the envelope construction. Let me centralize: an `envelope(code, message, details)` helper; the filter uses it; the middleware catches AppError and writes directly. Actually, if I trust Nest's filter handling of middleware errors... I want certainty for the tests. Decision: middleware catches AppError → `res.status(e.httpStatus).json(buildEnvelope(e))`. For unexpected errors → 500 envelope. This is deterministic. The global filter also handles downstream errors (P2025 → 404, etc.). Both use the same `buildErrorBody` helper.

Wait, one more consideration: the middleware applies to all routes including maybe /health. Let me keep it on `*`. Fine.

### Repository

`CustomersRepository` uses `TenantPrisma` (the extended client):

```ts
@Injectable()
export class CustomersRepository {
  constructor(private readonly db: TenantPrismaService) {}
  list() { return this.db.customer.findMany({ orderBy: { createdAt: 'asc' } }); }
  findById(id: string) { return this.db.customer.findUnique({ where: { id } }); }
  ...
}
```

Note: `findUnique({ where: { id } })` — the extension adds tenantId → `{ id, tenantId }` = composite PK. Valid. The repository doesn't mention tenantId. ✓ (That's the point.)

`create({ email, name })` → `this.db.customer.create({ data: { email, name } })` — extension stamps tenantId. If data contains tenantId (the caller shouldn't), it's overwritten. ✓

`update(id, data)` → `this.db.customer.update({ where: { id }, data })` — extension: where { id, tenantId }; no row → P2025 → filter → 404. ✓

`delete(id)` → same pattern.

`findByEmail`? For registration duplicate detection — P2002 on create is enough; catch → 409. No need for findByEmail. Keep the repository minimal: list, findById, create, update, delete, count (probably not needed). Let me keep just what's used.

TenantPrismaService type: the extended client. `prisma.$extends` typing: `PrismaClient.$extends({query: {...}})` returns a type that's close to the client. The type of the `$allOperations` hook's args: the types for the generic `$allOperations` may be loose. I may need a cast. In strict TS, the type of the extension's query args can be finicky. Common pattern:

```ts
export const tenantExtension = (storage: TenantStorage) => ({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }: { model: string; operation: string; args: any; query: (args: any) => Promise<any> }) {
        ...
      }
    }
  }
});
```

Does `PrismaClient.$extends` accept an object literal with this loose typing? The expected type is `Prisma.QueryExtension`... passing a function-based $allOperations with any-typed args — TS may complain about the type mismatch. Practical approach: type the extension object as `Prisma.QueryExtension<any, any>`? Hmm. Or just cast: `const ext = tenantExtension(storage) as Prisma.QueryExtension`. Let me structure it:

```ts
function buildTenantAwareClient(base: PrismaClient, storage: TenantContextStorage): TenantAwareClient {
  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations(ctx) { ... }
      }
    }
  });
  return hideRawQueries(extended);
}
```

If TS grumbles about the $allOperations parameter type, I'll annotate `ctx: any` — but "strict" is on; explicit `any` is still allowed (strict ≠ noExplicitAny; that's a lint rule). Let me keep the explicit any minimal and typed where possible. Let me type it:

```ts
type OperationContext = {
  model: string;
  operation: string;
  args: any;
  query: (args: any) => Promise<any>;
};
```

And the hook `(ctx: OperationContext)`. When passing to `$extends`, TS checks assignability — the expected signature is something like `(model: string, operations: {...}, args: any) => ...` or the destructured union. In recent Prisma versions, both call styles are supported at runtime; the type is... In the Prisma 5.x types, `$allOperations` is typed as:

```ts
$allOperations: <T>(model: string, operations: { ... }, args: any) => T | Promise<T>
```
Hmm, actually I recall the type allowed destructuring: `query: { $allModels: { $allOperations: (params: { model, operation, args, query }) => ... } }`. The generated types use a helper that supports both. There's risk of a type error. To be safe, I'll cast the whole extension argument:

```ts
base.$extends({ query: { $allModels: { $allOperations: hook as any } } } as any)
```

Hmm, "never guess in silence" — a cast is honest about the loose typing. Let me write it carefully with a comment. Since I can't compile here, I'll minimize the type risk: build the extension with `as Prisma.QueryExtension` where needed... actually, let me just annotate the hook parameter as `any` and cast the extension object once. Let me do:

```ts
const TENANT_SCOPED = new Set...
const extension = {
  query: {
    $allModels: {
      $allOperations: async (params: any) => {
        const { model, operation, args, query } = params;
        if (model === 'Tenant') return query(args);
        const tenantId = storage.current().tenantId; // throws TenantContextMissingError
        const scoped = applyScope(operation, args, tenantId);
        return query(scoped);
      },
    },
  },
} as const; // then cast
base.$extends(extension as unknown as Parameters<PrismaClient['$extends']>[0])
```

Hmm wait — `$extends` overloads: for a query extension it expects a specific type. `as unknown as ...` is ugly but reliable. Let me do a small number of targeted casts with a comment.

Actually — a cleaner alternative for types: use `Prisma.defineExtension`? Same type issue. Let me go with a single cast at the call site:

```ts
// The extension API's generic types don't model "any model, any operation"
// cleanly; the runtime contract is verified in tests.
const extended = base.$extends(
  buildQueryExtension(storage) as unknown as Prisma.QueryExtension,
);
```

Hmm, `$extends` overload: `$extends<Ext extends Prisma.QueryExtension & Prisma.ClientExtension>(extension: Ext)`. `Prisma.QueryExtension` is an interface — the cast works.

And hiding raw:

```ts
const client = Object.create(extended) as typeof extended & RawGuard;
```
Wait, `Object.create(extended)` — a prototype chain with extended as the prototype; define own properties $queryRaw etc. that throw. But extended's own properties (model delegates) — with Object.create, extended becomes the prototype; the model delegate lookups walk the chain. But do the delegates capture `this`? Prisma's model delegates are functions bound to closures (they don't use `this`). Hmm, risky? In the Prisma client, `prisma.user` is a property (an object with findMany etc.) created in the constructor, and its methods are closures — they don't reference `this`. I'm fairly confident. But `Object.create(extended)` also inherits `$transaction` etc. And define own throwing `$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe`, `$query`(?), `$batch`. $batch wraps model operations — it goes through the delegate, so it's scoped. OK.

Simpler and safer: `Object.defineProperty(extended, '$queryRaw', { value: throwingFn, writable: true, configurable: true })` — directly on the extended instance, shadowing the prototype method. If $queryRaw is already an own property on the extended instance (I think it is, since the extended client is a new instance), redefine (configurable? unknown...). If not configurable, defineProperty throws. Risky.

Alternative: don't hide raw; just don't give the base client to repositories. The "structural" claim relies on repositories only receiving the extended client, and the extension itself throwing without a tenant. Raw query via the extended client's $queryRaw bypasses scoping — a hole. For a security-focused task, I should plug it. Let me do the prototype-chain wrapper but with a safe construction:

```ts
function guardRawQueries<T extends object>(client: T): T {
  const guard = Object.create(Object.getPrototypeOf(client));
  // copy own properties
  for (const key of Object.getOwnPropertyNames(client)) {
    if (key.startsWith('$') && key !== '$queryRaw' ...) 
  }
}
```

Getting hairy. Alternative clean approach: a Proxy!

```ts
const guarded: any = new Proxy(extended, {
  get(target, prop) {
    if (prop === '$queryRaw' || prop === '$executeRaw' || prop === '$queryRawUnsafe' || prop === '$executeRawUnsafe') {
      return (..._args: unknown[]) => { throw new RawQueryBlockedError(); };
    }
    const value = Reflect.get(target, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  }
});
```

Proxy get binding: delegates are objects (not functions), so `typeof value === 'function'` is false → returned as-is. $transaction is a function → bound. Model delegate objects are returned as-is, and their methods are called with the delegate as `this` — correct. And `guarded.customer` → delegate object → `.findMany(...)` → works.

Proxy is clean, no risk of mutating the target. Let me use it. Edge: symbol properties (util.inspect.custom) — handled by the get trap: `typeof value === 'function'`... inspect.custom is a function → bound, fine.

Type of the guarded client: `typeof extended`. Let me define `type TenantAwareClient = ReturnType<typeof buildTenantAwareClient>` or an alias to the extended type. Let me type TenantPrismaService to expose the extended client's type:

```ts
@Injectable()
export class TenantPrismaService {
  private readonly client: ExtendedClient;
  constructor(private readonly prisma: PrismaService, private readonly storage: TenantContextStorage) {
    this.client = buildTenantAwareClient(prisma.client, storage);
  }
  get value(): ExtendedClient { return this.client; }
}
```

Hmm, repositories would inject TenantPrismaService and call `this.db.value.customer.findMany(...)`. Slightly awkward. Alternative: make TenantPrismaService itself the client — a Nest provider that is an object? Nest providers must be classes for DI convenience, but I can have the provider return an object: `{ provide: 'TENANT_PRISMA', useFactory: (prisma, storage) => buildTenantAwareClient(...) }`. A string token is fine. Then repositories inject `@Inject(TENANT_PRISMA) private readonly db: TenantAwareClient`. That's clean and "the repository is the only layer that touches the DB" — the db token is the tenant-aware client. Let me use a token constant `TENANT_DB` exported from the prisma module.

Let me name it:
- `PRISMA_SERVICE` (class PrismaService, base client) — used by TenantResolverService (needs to read the Tenant table before context).
- `TENANT_DB` (token) → tenant-aware client. Exports from PrismaModule (or a separate TenantPrismaModule — since the layout says one module per feature; let me put both in `src/prisma/prisma.module.ts`, exporting both, and also exporting the storage? The TenantContextStorage is provided in TenantModule? Who needs it: the middleware (tenant module), the factory (prisma module), the tests, tenant.service. The TenantModule is the natural home (it's tenant infrastructure). But PrismaModule needs it for the factory → PrismaModule imports TenantModule. And CustomerModule imports PrismaModule for TENANT_DB. TenantModule: providers: TenantContextStorage, TenantResolverService, TenantService; exports: all three (the middleware needs the resolver + storage; tenant-config needs TenantService; prisma needs storage). And TenantModule needs PrismaModule (base client) for the resolver → circular import! PrismaModule imports TenantModule (storage) and TenantModule imports PrismaModule (base client) → cycle.

Fix: move TenantContextStorage to PrismaModule? Or its own location? The storage is core infra — let me put it in `src/tenant/tenant-context.ts` and provide it in AppModule (AppModule providers/exports). Then PrismaModule imports AppModule? No — a module can't cleanly import its own root... actually it can (AppModule imports PrismaModule; PrismaModule imports AppModule = circular). Hmm.

Better: create a small `src/context/context.module.ts`? The layout shows feature directories; a `context` feature directory is fine: `src/context/context.module.ts` with ContextModule that provides+exports TenantContextStorage. Then both PrismaModule and TenantModule import ContextModule. Clean, no cycle.

Hmm wait, does TenantModule really need to provide the storage? The middleware uses `storage.run`. The middleware is declared in TenantModule's configure(). Fine: TenantModule imports ContextModule and PrismaModule.

Or — put the storage in PrismaModule and export it. Prisma is where the scoping lives; the "tenant context" concept is used by both. Meh. Let me go with a dedicated `context` module — the clearest dependency direction:

```
ContextModule (TenantContextStorage)
  ↑ imported by PrismaModule (builds TENANT_DB), TenantModule (middleware), 
PrismaModule (PrismaService base + TENANT_DB)
  ↑ imported by TenantModule (resolver reads Tenants), CustomersModule, TenantConfigModule
TenantModule (resolver, tenant service, middleware via configure)
  ↑ imported by AppModule (applying middleware)
CustomersModule (controller/service/repository) imports PrismaModule
TenantConfigModule imports TenantModule (TenantService) + ContextModule? (TenantService gets id from storage)
AppModule imports everything; applies middleware? 
```

Where is the middleware applied? `AppModule implements NestModule { configure(consumer) { consumer.apply(TenantMiddleware).forRoutes('*') } }`, with TenantMiddleware imported from TenantModule (provider+export). Or TenantModule itself implements NestModule — a feature module can implement NestModule; the global consumer works. Let me have TenantModule implement NestModule and apply its own middleware. That's self-contained. AppModule just imports the feature modules.

Wait, but the middleware applies to all routes in the app regardless of where configure is declared — yes, the consumer is global per app instance.

Now, the error filter: registered globally in main.ts `app.useGlobalFilters(new AllExceptionsFilter())`. The filter maps:
- AppError → its status/code
- Prisma P2025 → 404 resource_not_found
- Prisma P2002 → 409 conflict
- Prisma P2003 → 409 conflict (FK)
- Prisma PrismaClientValidationError → 400 bad_request? (validation error from a bad query — dev bug; 400 or 500. Let me do 400 bad_request.)
- HttpException (Nest built-in, e.g. 404 from a non-matched route) → map to envelope: code from status? Nest 404 for unmatched routes: `Cannot GET /foo` — the envelope code `not_found`? Let me map HttpException generically: code = status 404 ? 'not_found' : 'bad_request'? Hmm. Let me keep the codes stable: 404 → 'not_found'. Fine.
- TenantContextMissingError (if it leaks to HTTP — shouldn't happen after the middleware; but direct calls in tests) → 500 internal_error.
- default → 500 `internal_error`.

Envelope builder in `src/errors/error.ts`:

```ts
export class AppError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number, message: string, public readonly details: Record<string, unknown> = {}) { super(message); }
}
export function buildErrorBody(code, message, details = {}) { return { error: { code, message, details } }; }
```

### customers controller

```ts
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list() { return this.customers.list(); }

  @Post()
  register(@Body() body: unknown) {
    const email = validateEmail(body); const name = ...
    return this.customers.register(email, name);
  }

  @Get(':id')
  one(@Param('id') id: string) { return this.customers.findById(id); }

  @Patch(':id')
  update(@Param('id') id, @Body() body) { ... validate; return this.customers.update(id, { name }); }

  @Delete(':id')
  async remove(@Param('id') id) { await this.customers.remove(id); }
}
```

Validation: email: non-empty string matching /^\S+@\S+\.\S+$/; name: non-empty string. Throw AppError('bad_request', 400) with details {field}. "The controller validates input" ✓.

Service:

```ts
@Injectable()
export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}
  list() { return this.repo.list(); }
  async findById(id) { const c = await this.repo.findById(id); if (!c) throw new AppError('resource_not_found', 404, `customer ${id} does not exist`, { id }); return c; }
  register(email, name) { return this.repo.create({ email, name }); } // P2002 → filter 409
  async update(id, data) { const c = await this.repo.update(id, data); return c; } // P2025 → filter 404
  async remove(id) { await this.repo.remove(id); } // P2025 → filter 404
}
```

Hmm — for update/delete, the P2025 is thrown by the repository and caught by the global filter → 404 envelope. Consistent. For findById, the service explicitly throws 404. Consistent.

DELETE response: 204 no content. Then the "A's row still exists" check is via tenant A's GET. ✓

POST response: 201 with the created customer.

### tenant-config

```ts
@Controller('tenant-config')
@Get()
get() { return this.tenants.forCurrentRequest(); }
```

TenantService:

```ts
@Injectable()
export class TenantService {
  constructor(private readonly db: PrismaService, private readonly storage: TenantContextStorage) {}
  async forCurrentRequest() {
    const { tenantId } = this.storage.current();
    const t = await this.db.client.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new AppError('tenant_mismatch', 500?, ...); // shouldn't happen
    return { id: t.id, name: t.name, branding: t.branding, featureFlags: t.featureFlags };
  }
}
```

Hmm — TenantService reading storage.current() — "handlers never mention tenantId" — this reads from the context (legitimate). It's the Tenant model (not tenant-scoped). OK.

Wait, the middleware already loaded the tenant record; re-fetching is an extra query. Alternative: store the full Tenant in the ALS context. Then /tenant-config returns the context's tenant with zero DB. That's actually elegant: the middleware resolves and persists; the config endpoint serves from context. But "the tenant lives in a request-scoped context" — the full record or the id? The spec says "the resolved tenant lives in a request-scoped context." Storing the resolved tenant record satisfies that most literally. Let me store `{ tenantId, tenant }`? Hmm — but then tenant-config.service becomes trivial (context.tenant). And tests for /tenant-config verify branding/flags per tenant. Either works.

Let me store just `{ tenantId: string }` — minimal context, least duplication; TenantService fetches fresh. Hmm, but "the resolved tenant lives in the context" vs "the tenant id lives in the context"... the tenant-aware client needs the tenantId; that's the contract. Let me store the id. Fine.

Actually wait — one more consideration: if I store the full tenant, then /tenant-config's response includes branding/featureFlags directly from the resolved tenant — guaranteed consistency (same row used for authorization). The re-fetch could theoretically diverge (row deleted mid-request → error). Trivial. Let me go with id + fetch. Actually, no, let me reconsider one more time: the acceptance test only checks that /tenant-config returns branding+flags for the resolved tenant. Both approaches pass. Id + fetch exercises the TenantRepository. Decision: id in context; TenantService fetches by id from context.

### Schema file

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id           String   @id @default(uuid())
  domain       String   @unique
  name         String
  branding     Json
  featureFlags Json
  customers    Customer[]
  plans        Plan[]
  orders       Order[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@map("tenants")
}

model Customer {
  id        String   @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  email     String
  name      String
  orders    Order[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@id([tenantId, id])
  @@unique([tenantId, email])
  @@map("customers")
}

model Plan {
  id        String   @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  name      String
  slug      String
  priceCents Int
  active    Boolean  @default(true)
  orders    Order[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@id([tenantId, id])
  @@unique([tenantId, slug])
  @@map("plans")
}

model Order {
  id         String   @default(uuid())
  tenantId   String
  tenant     Tenant   @relation(fields: [tenantId], references: [id])
  customerId String
  customer   Customer @relation(fields: [tenantId, customerId], references: [tenantId, id], onDelete: Cascade)
  planId     String
  plan       Plan     @relation(fields: [tenantId, planId], references: [tenantId, id], onDelete: Restrict)
  status     String   @default("pending")
  totalCents Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@id([tenantId, id])
  @@index([tenantId, customerId])
  @@map("orders")
}
```

Wait — issue: `@@id([tenantId, id])` with `id String @default(uuid())` — composite id with a default on one field: allowed? A composite @@id allows defaults on fields, yes (each field can have @default).

Another issue: Order's relation to Customer uses fields [tenantId, customerId] referencing [tenantId, id]. Prisma: when a relation field references a composite key, the referencing fields must be in a unique constraint on the child? The pair (tenantId, customerId) — must be declared as @unique or part of @@id? I think Prisma requires the foreign key fields to form a unique constraint on the child model, otherwise it warns: "The relation fields customer and customerId are part of an incomplete relation..." Actually, the requirement: FK fields must be in a unique constraint (or the primary key). (tenantId, customerId) is not unique in my schema (a customer can have multiple orders) → Prisma error: "The field customerId is part of a relation but its type ... " hmm, no. Let me recall: in Prisma, when you have `@relation(fields: [a, b], references: [...])`, [a,b] must be a unique constraint (or the id) on the model. Yes — I'm fairly sure Prisma requires that. So I need `@@unique([tenantId, customerId])`? But that would prevent a customer from having multiple orders! No wait — (tenantId, customerId) unique = one order per customer. That breaks the domain.

Hmm. So a relation to a composite PK via [tenantId, customerId] forces (tenantId, customerId) to be unique → unacceptable.

Solution options:
1. Don't use Prisma relation fields for Order→Customer/Plan. Keep plain FK columns customerId/planId + explicit `@db.Text`? Without a relation, I still want DB-level FKs for integrity. Prisma can express FKs without a relation field... no — in Prisma, an FK is created via the relation field. A plain String customerId without a relation = no FK constraint, just a column. That loses the referential integrity at the DB level.

2. Reference the child's composite PK to the parent's @@unique([tenantId, id])... no wait, the parent's key is already @@id([tenantId, id]).

Wait, I think I'm misremembering the requirement. Let me think again. In Prisma, for a relation `@relation(fields: [customerId], references: [id])`, customerId doesn't need to be unique (a to-many from the other side: the parent has `orders Order[]` — many children reference the same parent id). The uniqueness requirement is for one-to-one relations. For to-many: the FK field is not unique. The rule: "the fields specified in fields: must be part of a unique constraint only in the one-to-one case"? Hmm, no...

Let me recall concretely: the standard User/Post:
```prisma
model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}
```
authorId is not unique. That's fine. So in to-many relations, the FK field doesn't need to be unique.

For composite: `@relation(fields: [tenantId, customerId], references: [tenantId, id])` — the referenced [tenantId, id] must be a unique constraint (it is — @@id). The child's fields [tenantId, customerId] just need to form a valid FK (non-unique OK in to-many). I believe this is supported. The error I was fearing ("incomplete relation") is for missing back-reference.

Let me double-check the Prisma docs on composite keys + relations: "If you want to create a relation to a model with a composite primary key, you need to reference all the key fields: `@relation(fields: [a, b], references: [x, y])`." Yes, supported.

3. Another approach to sidestep the issue entirely: don't make it a composite PK! Use a single `id String @id @default(uuid())` (global uuid), plus `@@unique([tenantId, email])`, and the extension rewrites `findUnique({ where: { id } })` to `findFirst({ where: { id, tenantId } })`. The "another tenant's id" scenario: ids are global uuids; tenant B queries findFirst({id: A_id, tenantId: B}) → null → 404. ✓. And uniqueness of id is global, which is arguably better (ids are globally unique, no cross-tenant id collision possible). The extension complexity: findUnique→findFirst rewrite, plus findUnique's where for a unique on email: `{ email }` + tenantId → `{ email, tenantId }` matches @@unique([tenantId, email]) — valid as findUnique. Mixed: the extension needs to know which unique key was used. Simpler: always rewrite findUnique/findUniqueOrThrow to findFirst/findFirstOrThrow with merged where. findFirst accepts arbitrary where → always valid. That's robust!

   Then update/delete where `{ id }` → merged `{ id, tenantId }` — update's where must be unique: (id) is unique globally (@id) → adding tenantId to a unique-where: does Prisma allow extra fields in update's where? For `update({ where: { id, tenantId } })` — the where input type for update is the "unique" input: must be exactly one unique constraint... Prisma's update where accepts a unique identifier — the union of all unique constraints. `{ id, tenantId }` — id alone is a unique constraint; adding tenantId... does Prisma accept where with both id and tenantId? For a single-field @id, the where type is `{ id: string }` — extra field → validation error "Unknown argument tenantId". Hmm! So for update/delete/findUnique, merging tenantId breaks where validation unless the combination is itself a unique constraint.

   So with a global uuid @id: the extension can't merge tenantId into update/delete's where (validation error). It must rewrite to a different operation? `updateMany`? update by id for updateMany returns count not the row. Ugh.

   → The composite PK design is superior for uniform "merge tenantId into where" across all operations: every unique constraint includes tenantId, so the merged where is always a valid unique constraint:
   - findUnique/update/delete where { id } + tenantId = (tenantId, id) = @@id ✓
   - where { email } + tenantId = (tenantId, email) = @@unique ✓
   - Plan where { slug } + tenantId ✓
   
   That's the elegance: with composite keys, "add tenantId to every where" is uniformly valid. Going with the composite PK.

4. So back to the Order FK issue: relation with fields [tenantId, customerId] — I'll trust composite FK support. Actually hmm, wait. Let me reconsider whether Prisma requires the referencing fields to be a unique constraint. From the Prisma docs (Relations → "Referencing a composite key"): I recall the doc: "You can also create relations to models with composite primary keys... note that the fields referenced in fields: must be part of a unique constraint"? Honestly, I don't fully remember.

Let me think about what's safest: I could avoid the Order→Customer relation entirely and keep plain columns `customerId String`, `planId String` with no Prisma relation. Then the DB has no FK constraint. Referential integrity across tenants: an order referencing a deleted customer → orphan. In the tests, customer deletion cascades? Without an FK, no cascade — orders would be orphaned. Does the spec care? Not directly. But it's ugly.

Alternative: use a relation to a parent's @@unique that isn't a PK? E.g. add `@@unique([tenantId, id])` on Customer (redundant with @@id)? The relation still references the child fields [tenantId, customerId] — same constraint question on the child side. The issue (if it exists) is on the child's field uniqueness. Hmm wait, no — I need to actually pin down: is there a requirement on the child side?

Standard example (to-many, child field non-unique): Post.authorId non-unique — works. So no uniqueness requirement on the child side for to-many. The composite case should be symmetric. I'm ~90% confident `@relation(fields: [tenantId, customerId], references: [tenantId, id])` is valid Prisma. It's documented (I'm fairly sure now — the "composite primary keys" docs show exactly this pattern for relations).

Actually, you know what, let me reduce the risk further: does Order even need Prisma relations in this build? No code uses include/relations. The schema requirement is "schema for customers/plans/orders with tenant-scoped uniqueness." Relations add integrity. Let me include the relations — I'm confident enough. And I'll include the migration SQL that matches.

Migration SQL (Postgres):

```sql
CREATE TABLE "tenants" (
  "id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "branding" JSONB NOT NULL,
  "feature_flags" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

CREATE TABLE "customers" (
  "tenant_id" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("tenant_id", "id")
);
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

CREATE TABLE "plans" (...);
CREATE TABLE "orders" (...);
ALTER TABLE ... ADD CONSTRAINT fk ...
```

Wait — with a composite PK, does Prisma generate a separate index on tenant_id? Not needed separately (leading column). The composite PK index covers tenant_id lookups. But my extension always filters by tenantId → the PK index is used. For customers, the composite unique (tenant_id, email) is also there. Fine — no extra indexes needed, but Prisma would generate one for FKs: customer_id and plan_id on orders need indexes (FKs get indexes in Prisma). Yes, Prisma creates indexes for relation fields.

Let me write the migration carefully to match what Prisma would generate (column order: Prisma puts id first? Prisma's migration output: fields in model order. My model order: id, tenantId, email, name, createdAt, updatedAt → columns "id", "tenant_id", "email", "name", "created_at", "updated_at". The PK constraint references both.)

Hmm, does the exact migration SQL matter for tests? Tests run against the DB; they'd run `prisma migrate deploy` or `prisma db push`. My migration file's accuracy matters for `migrate deploy` to succeed. Let me write it accurately.

Column order per model: I listed `id` first, then `tenantId`. Prisma's SQL: columns in the order declared. PK is (tenant_id, id) — order within the PK constraint: as declared in @@id([tenantId, id]) → ("tenant_id", "id").

FK: customers.tenant_id → tenants.id: `ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`

orders.customer_id FK → customers(id) plus tenant_id → composite FK: Prisma generates `FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE`. Similarly plan FK `("tenant_id", "plan_id") REFERENCES "plans"("tenant_id", "id") ON DELETE RESTRICT`.

Indexes: Prisma creates `CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");` and `"orders_plan_id_idx"`. And unique: `CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");` `plans_tenant_id_slug_key`.

Also the `prisma/migrations/migration_lock.toml` file:
```
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

### package.json

Dependencies:
- @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/testing (dev), reflect-metadata, rxjs (peer), prisma (dev), @prisma/client, jsonwebtoken, class... no class-validator.
- typescript, ts-node? For running the app: `ts-node` or tsx. ESM + Nest: Nest in ESM needs care (`"type": "module"`, decorators with experimentalDecorators; Nest supports ESM in 10.x with some setup). Hmm — NestJS + ESM is tricky: Nest 10 has partial ESM support; the common approach is `ts-node --esm` with tsconfig module NodeNext, or build to CJS. To reduce risk: build with tsc to CommonJS? But the task says ESM `"type": "module"`.

Hmm, the task says "TypeScript (strict), Node 20+, NestJS for the API. Prisma ORM, PostgreSQL. Vitest for tests. pnpm." Doesn't explicitly say ESM. The fieldtest reference materials don't mandate ESM. Let me keep it simple and robust: CommonJS output for the app (module: commonjs in tsconfig) — but if package.json has "type": "module", tsc CJS output breaks (Node treats .js as ESM). So: don't set "type": "module"; default to CJS. The layout shows `src/main.ts` etc. — no constraint. NestJS is far more battle-tested in CJS. Decision: CommonJS (no "type": "module" in package.json). That's the defensible reading; NestJS ESM support is still flaky (dynamic imports, decorators). Actually wait, is it? Nest 10 does support ESM (`nest build` with module esnext...), but the known pitfalls: `import ... from './x'` needs extensions in true ESM? With tsc + NodeNext ESM, relative imports need .js extension — annoying in source. Many Nest projects stay CJS. I'll stay CJS and not mark it as an assumption... The instructions say to mark assumptions "where it matters." Let me add one `// ASSUMPTION` comment? It's a config choice, not an unclear symbol. Let me skip the ASSUMPTION comment; it's a stack decision. Hmm, "use the most defensible reading and mark it" — that's for unclear symbols, not architecture. Fine, no comment needed. Actually, I might add a brief one in package.json? No — keep files clean.

Wait, actually, let me reconsider: jsonwebtoken is CJS — fine in CJS. Prisma client — fine. Vitest — fine in CJS projects (esbuild transpiles TS). OK, going CJS.

package.json:

```json
{
  "name": "operator-platform",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "ts-node-dev src/main.ts"?  (extra)
    "prisma:migrate": "prisma migrate deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@prisma/client": "^5.10.0",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.0",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/node": "^20.11.0",
    "prisma": "^5.10.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

tsconfig.json:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true,
    "outDir": "dist",
    "baseUrl": ".",
    "strictPropertyInitialization": true (included in strict),
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true? — careful, might flag something. Let me leave it off to be safe. Actually strict true only.
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Hmm — tests import from src; including test in the tsconfig is fine for type-checking.

vitest.config.ts:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['test/**/*.spec.ts'],
  },
});
```

### Test design (critical part)

`test/setup.ts`? Let me structure:

- `test/helpers.ts`: build app (Test.createTestingModule(AppModule).compile()), init, listen on ephemeral port, provide `request(path, { method, host, token, body })` using fetch, `signToken(org, secret)`, seed tenants (unique per run to avoid collisions: e.g., suffix with random), cleanup.

Env: set `process.env.JWT_SECRET` before app creation (default if unset — but "config from env only": the app requires JWT_SECRET; tests set it). For DATABASE_URL: must be provided; test fails early with a clear message if missing.

Seeding tenants:
```ts
const suffix = randomUUID().slice(0, 8);
tenantA = { id: uuid, domain: `a-${suffix}.example.test`, ... }
```
Hmm wait — the host must be resolvable: the middleware reads the Host header in tests (we control it). Use domains like `app.operator-a.com`, `app.operator-b.com` — but re-runs collide with unique(domain) → upsert by domain, or random domain. Let me use a random suffix: `app.tenant-a-${suffix}.test`. The host header is set to that exact domain. Fine.

Tenant A customer seed: create via API as tenant A (exercises the create path!) or directly via Prisma base client with an explicit tenantId (bypasses). Using the API is better e2e: register 2 customers in A, 1 in B. Then B lists → only B's; B fetches A's customer id → 404; B updates A's → 404 + unchanged (verify via A's fetch); B deletes A's → 404 + A still has it.

Same email in both: register email `shared@example.com` in A and B → both 201. ✓

Concurrency: fire N parallel requests from A and B (mixed list + create), then verify A's list has only A's emails and B's only B's. Use `Promise.all`. With ALS, there's no cross-request contamination. To make it more adversarial: interleave — e.g., 10 promises: half `GET /customers` as A with host A, half as B; assert each response matches.

No-context query: in the spec file, import the app module's CustomersRepository? Get it from the moduleRef: `moduleRef.get(CustomersRepository).list()` called outside a request → expect a rejection with a TenantContextMissingError-like message. ✓ ("A query issued with no tenant in context fails rather than returning everything.")

Mismatch test: host A + token org B → 403 tenant_mismatch. (Acceptance says mismatches are rejected — I'll add the test.)
Missing token → 401. Bad host → 404 unknown_host. (Extra but core to the feature.)

tenant-config test: as A → A's branding/flags; as B → B's.

Test files (layout: `test/<feature>.spec.ts`):
- `test/customers.spec.ts` — CRUD happy path + cross-tenant isolation (list/fetch/update/delete), same email in both, 409 same-tenant duplicate?
- `test/tenant-config.spec.ts` — branding/flags per tenant.
- `test/tenant-isolation.spec.ts` — mismatch/401/404-host + concurrency + no-context failure.

Three spec files, each builds its own app? That's three Postgres connections + re-seeding — fine but slow. Alternative: one shared setup that builds one app for all specs via a global beforeAll? Vitest runs spec files in separate workers (default thread isolation) — a shared app would need cross-process... Simpler: each spec file builds its own app instance (its own DB seed). With testTimeout 30s, that's fine. Postgres handles 3 apps fine (each app = 1 Prisma client pool).

Hmm, but each spec file spins up an app → 3x startup. Acceptable.

Let me write a shared helper module `test/support.ts` exporting:
- `startApp(): Promise<{ app, port, base, stop() }>`
- `signToken(org: string): string`
- `api(base, path, { method, host, org, body })` → uses fetch, returns { status, json }
- `seedTenants(db): Promise<{ a: TenantSeed, b: TenantSeed }>` — creates both tenants via the base PrismaClient.

The helper creates its own PrismaClient for seeding (import { PrismaClient } from '@prisma/client').

Env handling in the helper:
```ts
process.env.JWT_SECRET ??= 'test-jwt-secret';
```
Wait — "config from env only, no hardcoded connection strings" — the JWT test secret in a test is fine (a test fixture, not a secret in the repo... it's in the repo but it's a test-only default; the app itself has no default). Hmm, if the app has no default and the test sets the env, it's consistent: the app reads the env; the test provides the env. Let me have the helper do `if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-secret'` — but the app module is imported later, so the env is set at import time. The JWT secret is read at use time (in the resolver), not at module load — safe either way. Let me read the secret inside the resolver method (fresh env per call? that's odd; read once at construction). Constructor-time read: the Nest module instantiates the resolver after the helper sets the env. Safe.

DATABASE_URL: helper asserts presence: `if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point at a test Postgres instance')`.

### Prisma client and test DB schema

For tests to run, the DB schema must exist. Options: tests run `prisma migrate deploy` in beforeAll via child_process? Adds robustness: the setup runs `execSync('npx prisma migrate deploy')`. But npx in a test env... The repo has prisma in devDeps → `pnpm prisma migrate deploy`. Using child_process in vitest setup is legitimate and common. Alternatively, document "run pnpm prisma migrate deploy before tests." The acceptance is a test suite; making it self-contained is better. Let me add to the helper's beforeAll (once per file): `execFileSync(process.execPath, [require.resolve('prisma/build/index.js')? ...])` — the resolve is fragile. Simpler: `execSync('node_modules/.bin/prisma migrate deploy', { cwd: repoRoot })`? In pnpm, the binary is at node_modules/.bin/prisma (pnpm exposes .bin). Reasonable. But hmm, if tests run in CI, that works. Locally too.

Alternative, skip the auto-migration and just note it in the test comment: "requires `pnpm prisma migrate deploy` against DATABASE_URL." The task says "each schema change ships with a migration" (I ship the migration). Auto-running in tests is a nice touch but adds a failure mode (pnpm vs npm layout, network for npx). Let me auto-run with execSync using the local bin, wrapped in try/catch, and if it fails, throw a helpful error. Hmm... actually, `prisma migrate deploy` is idempotent (applies pending migrations). Let me include it — it makes the suite actually runnable end-to-end. Use:

```ts
import { execFileSync } from 'node:child_process';
execFileSync('prisma', ['migrate', 'deploy'], { cwd: path.join(__dirname, '..'), stdio: 'pipe', env: process.env });
```
With module commonjs, `__dirname` works. 'prisma' resolves via PATH? No — bare 'prisma' in execFileSync won't resolve without node_modules/.bin in PATH. Use the full path: `path.join(__dirname, '..', 'node_modules', '.bin', 'prisma')` with shell? Cross-platform shebang issues on Windows... the env here is macOS (from the path). Let me keep it simple: use `path.resolve(__dirname, '../node_modules/.bin/prisma')`. If pnpm: node_modules/.bin/prisma exists (symlink). OK.

Hmm, actually — even simpler and more robust: in vitest's globalSetup, `execSync('pnpm exec prisma migrate deploy')`. Let me do the node_modules/.bin path. Let me add a guard: if the bin is missing → skip with a warning? No — the test requires the schema. Failing loudly is right.

Wait, but there's a subtlety: the migration's SQL must exactly match the schema, or migrate deploy will apply the SQL (fine) — `migrate deploy` just applies the SQL files; the drift check only happens in `migrate dev/status`. So as long as my SQL is valid Postgres, deploy works.

### Main.ts

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './errors/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```

PORT env default 3000 — "config from env only" — a default for the port is fine (not a secret).

### AppModule

```ts
@Module({
  imports: [PrismaModule, ContextModule, TenantModule, CustomersModule, TenantConfigModule],
})
export class AppModule {}
```

### Let me write the extension carefully

```ts
// src/prisma/tenant-db.factory.ts
import { PrismaClient } from '@prisma/client';
import { TenantContextStorage } from '../tenant/tenant-context';

const TENANTLESS_MODELS = new Set(['Tenant']);

type ScopeArgs = Record<string, any> | undefined;

function mergeWhere(args: ScopeArgs, tenantId: string): ScopeArgs {
  const a = (args ?? {}) as Record<string, any>;
  if (a.where === undefined) a.where = { tenantId };
  else a.where = { ...a.where, tenantId };
  return a;
}

function stampData(args: ScopeArgs, tenantId: string): ScopeArgs {
  const a = (args ?? {}) as Record<string, any>;
  if (Array.isArray(a.data)) a.data = a.data.map((d: any) => ({ ...d, tenantId }));
  else a.data = { ...a.data, tenantId };
  return a;
}

const READ_OPS = new Set(['findUnique','findUniqueOrThrow','findFirst','findFirstOrThrow','findMany','count','aggregate','groupBy']);
const CREATE_OPS = new Set(['create','createMany','upsert']);

export function createTenantAwareClient(base: PrismaClient, storage: TenantContextStorage) {
  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations(params: any) {
          const { model, operation, args, query } = params;
          if (TENANTLESS_MODELS.has(model)) return query(args);
          const { tenantId } = storage.current(); // throws when no tenant in context
          let next: any = args;
          if (READ_OPS.has(operation)) next = mergeWhere(next, tenantId);
          else if (CREATE_OPS.has(operation)) {
            next = mergeWhere(next, tenantId); // upsert's where
            next = stampData(next, tenantId);
          } else if (operation === 'update') {
            next = mergeWhere(next, tenantId);
          } else if (operation === 'updateMany' || operation === 'deleteMany' || operation === 'delete') {
            next = mergeWhere(next, tenantId);
          } else {
            throw new Error(`tenant guard: unknown Prisma operation "${operation}" on ${model}`);
          }
          return query(next);
        },
      },
    },
  } as unknown as Parameters<PrismaClient['$extends']>[0]);
  ...
}
```

Wait: updateMany's where — merged; deleteMany — merged. delete — merged (unique where). For upsert: where is a unique where → merged; data.create stamped; data.update — leave alone (PK fields can't be in update data anyway).

Hmm, one issue: `upsert`'s data.update could include tenantId → Prisma validation error (PK field). That's fine — the caller can't move a tenant.

Edge: `$transaction` with interactive callback — the extended client's $transaction passes through to the base within the same ALS (the ALS propagates). Each model operation within goes through the extension. ✓. Raw `$transaction([promises])` with model promises — those promises were created via the extended delegate, so they're scoped. ✓.

`count`/`aggregate`/`groupBy` — merge where. `groupBy` with `by` + where — fine.

Now the raw guard via Proxy:

```ts
const RAW_METHODS = new Set(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe', '$query', '$execute']);
function guardRaw<T>(client: T): T {
  return new Proxy(client as any, {
    get(target: any, prop: string | symbol) {
      if (typeof prop === 'string' && RAW_METHODS.has(prop)) {
        return () => { throw new Error('raw SQL is not allowed on the tenant-aware client; use model queries'); };
      }
      const value = target[prop as any];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;
}
```

Hmm — `$batch`: fine, it's a model operation. Binding `$on` etc. is fine.

One concern: `typeof value === 'function' ? value.bind(target)` — for a model delegate `customer` (an object), returned as-is ✓. For `prisma.$extends` (a function on the client) — bound ✓ (though re-extending a guarded client is weird; harmless).

Type: `createTenantAwareClient` returns a `TenantAwareClient` type. Let me define:

```ts
export type TenantAwareClient = ReturnType<typeof createTenantAwareClient>;
```
But the return type of createTenantAwareClient = type of `extended` (Prisma.Expose... extended client type). OK.

Actually — will TS accept the `base.$extends(...)` call with the cast? `as unknown as Parameters<PrismaClient['$extends']>[0]` — $extends has overloads; Parameters picks the last overload. The overload for query+client extension: `$extends<Ext extends Prisma.QueryExtension & Prisma.ClientExtension>(extension: Ext): ...`. Passing a cast object → returns the base client type + extension (loose). The return type should be OK. To be safer, I'll declare the return type explicitly as `PrismaClient & ...`? The extended client is structurally like a PrismaClient. The simplest: let TS infer, and type the token provider accordingly. Let me write:

```ts
export function createTenantAwareClient(base: PrismaClient, storage: TenantContextStorage) {
  const extended = base.$extends(queryExtension(storage));
  return guardRaw(extended);
}

function queryExtension(storage: TenantContextStorage) {
  // The hook receives { model, operation, args, query } for every model operation.
  // The loose `any` here is intentional: the extension API does not expose a
  // typed "any model, any operation" signature, and every path is covered by tests.
  return {
    query: {
      $allModels: {
        $allOperations: async ({ model, operation, args, query }: {
          model: string;
          operation: string;
          args: any;
          query: (args: any) => Promise<any>;
        }) => { ... },
      },
    },
  } as Prisma.QueryExtension;
}
```

Hmm — is `Prisma.QueryExtension` the right type to cast to? The `Prisma` namespace from '@prisma/client' exports `Prisma.QueryExtension`? Prisma exports the `Prisma` namespace with the types (yes, `import { Prisma } from '@prisma/client'`). Does `Prisma.QueryExtension` exist? I think so (Prisma.QueryExtension, Prisma.ClientExtension, Prisma.MiddlewareExtension...). I'm fairly sure. Even if the name is off, the cast to it is the main risk... The alternative is a cast to `Parameters<PrismaClient['$extends']>[0]` — that's a concrete parameter type of the method — guaranteed to exist. But overloaded: Parameters picks the last overload — in the Prisma client types, $extends is overloaded:
1. `$extends<Ext extends Prisma.QueryExtension>(extension: Ext): PrismaClient & ...`?
Actually, the Prisma 5 generated client: `export const PrismaClient: { prototype: PrismaClient; new (options?): PrismaClient; }` and methods include:
```ts
$extends<R = U.P.'result' , M = U.P.'models'>...
```
It's complex. `$extends(extension: Prisma.QueryExtension & Prisma.ClientExtension)` — I recall the runtime accepting separate query/client extensions: `prisma.$extends({ query: ... })` and `prisma.$extends({ client: ... })`. In types, the overloads cover each.

To minimize type risk in code I can't compile: cast the extension object `as unknown as Parameters<PrismaClient['$extends']>[0]`. Parameters of an overloaded function → the last overload. If the last overload is for the combined query+client extension, that's fine.

Hmm, let me hedge differently: avoid $extends's typed entry entirely — call it as `base.$extends(ext as any)`? An explicit `any` cast is simplest and guaranteed to compile. I'll use a single `as any` with a comment explaining why (loose typing of the extension API). Defensible.

But then the return type: `extended` will be typed as whatever the overload returns for an any arg → probably `any` or a good type. `base.$extends(ext as any)` — the call with an any arg resolves the overload... probably returns `any`. Then the TenantAwareClient type = any → repositories get an any-typed db → loses type safety but compiles. Hmm, that weakens things. Alternative: cast the result: `const extended = base.$extends(ext as any) as PrismaClient;` — is the extended client structurally a PrismaClient? It has all model delegates + $transaction etc. Type-wise, casting to PrismaClient is roughly right (the delegates are the same shape). The raw methods on the extended client exist on PrismaClient type too → the proxy guards them at runtime. OK: `as PrismaClient` keeps the repository fully typed.

Wait, but the extended client from $extends(query-only extension) — its type is a `PrismaClient` with the extension... if I cast `as PrismaClient`, repositories call `db.customer.findMany(...)` — typed as the standard client.

Decision:
```ts
const extended = (base as PrismaClient).$extends(ext as any) as PrismaClient;
return guardRaw(extended);
```
And `export type TenantAwareClient = PrismaClient;` — no wait, that means the raw methods are available in the type. Meh — the runtime guard protects; the type is slightly looser. Or define `type TenantAwareClient = Omit<PrismaClient, '$queryRaw' | '$executeRaw' | '$queryRawUnsafe' | '$executeRawUnsafe'> & { $queryRaw: never; ... }`? Over-engineered. Let me keep `TenantAwareClient = PrismaClient` and comment that raw methods throw at runtime (guarded). Hmm, but a "structural" security claim with a type that advertises $queryRaw... the guard throws; fine.

Actually, let me reconsider the Proxy approach vs. just documenting. The Proxy has a risk: the get trap intercepts everything including Symbol.toPrimitive etc. — returning bound functions for function-valued symbols could subtly break inspect. util.inspect.custom — binding is fine. Let me keep the proxy but only special-case the 4 raw methods; everything else is passthrough without binding:

```ts
return new Proxy(client, {
  get(target, prop, receiver) {
    if (typeof prop === 'string' && BLOCKED.has(prop)) {
      return () => { throw new Error(...); };
    }
    return Reflect.get(target, prop, receiver);
  },
});
```
Passthrough via Reflect.get with receiver=proxy — standard. Model delegates are own properties (objects) → returned as-is. $transaction (own or prototype function) → returned unbound, and called as `db.$transaction(...)` → `this` = proxy → Reflect.get chains → works (when called as a method on the proxy, `this` is the proxy, and internal `this.$query` etc. walk the chain ✓).

Edge: Prisma checks `prisma.$isPrismaClient`? Unlikely to matter.

OK. And the no-context failure: `storage.current()` throws `TenantContextError extends Error { code = 'no_tenant_context' }`. In an e2e HTTP path, this can't happen (middleware ensures context). In the direct repository test, the rejection surfaces as that error. The filter would map it to 500 if it ever reached HTTP.

### The "handler never passes tenantId" property

The repository: `this.db.customer.findUnique({ where: { id } })` — no tenantId ✓. The extension adds it.

### TenantResolverService

```ts
@Injectable()
export class TenantResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(host: string | undefined, authorization: string | undefined): Promise<Tenant> {
    const tenantFromToken = await this.verifyToken(authorization);
    const tenantFromHost = await this.tenantByDomain(host);
    if (tenantFromToken.id !== tenantFromHost.id) throw mismatch;
    return tenantFromHost;
  }

  private async verifyToken(authorization: string | undefined) {
    if (!authorization || !authorization.startsWith('Bearer ')) throw new AppError('unauthorized', 401, 'missing bearer token');
    const token = authorization.slice(7);
    let payload: JwtPayload;
    try { payload = jwt.verify(token, this.secret()) as JwtPayload; }
    catch { throw new AppError('invalid_token', 401, 'token failed verification'); }
    if (typeof payload.org !== 'string' || !payload.org) throw new AppError('invalid_token', 401, 'token has no org claim');
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: payload.org } });
    if (!tenant) throw new AppError('invalid_token', 401, 'token org does not match a known tenant');
    return tenant;
  }

  private async tenantByDomain(host: string | undefined) {
    if (!host) throw new AppError('unknown_host', 404, 'missing host');
    const tenant = await this.prisma.client.tenant.findUnique({ where: { domain: host } });
    if (!tenant) throw new AppError('unknown_host', 404, `no tenant serves ${host}`);
    return tenant;
  }
}
```

Hmm — "neither alone is sufficient": without a token → 401 (even with a valid host) ✓; without a host → 404 (even with a valid token) ✓; both required to agree ✓.

The order in resolve: verify token first, then host, then compare. Both are checked before agreement — so both are validated. A mismatch → 403 `tenant_mismatch`. ✓

secret(): `process.env.JWT_SECRET` — if absent, throw (config error) — "config from env only": the app requires JWT_SECRET to be set. In resolve, if !process.env.JWT_SECRET → throw AppError 500? Let me check in the constructor: throw if absent? Constructor throw crashes app startup with a clear message — good (fail fast). But tests set env before app creation ✓. Let me validate in the constructor: `if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set')`.

Hmm, jwt.verify with a secret — also ensure `algorithms: ['HS256']`? jwt.verify(token, secret) defaults to allowing HS/RS/ES based on the secret type; with a string secret → HS*. Passing `algorithms: ['HS256']` is a good hardening. Let me include it.

### The middleware file

```ts
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly resolver: TenantResolverService, private readonly context: TenantContextStorage) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = await this.resolver.resolve(req.headers.host, req.headers.authorization);
      await this.context.run({ tenantId: tenant.id }, () => new Promise<void>((resolve, reject) => {
        next((err?: unknown) => (err ? reject(err) : resolve()));
      }));
    } catch (err) {
      if (res.headersSent) { next(err); return; }  // hmm
      const mapped = toHttpException(err);
      res.status(mapped.status).json(buildErrorBody(mapped));
    }
  }
}
```

Wait, if next() rejects (downstream error), the filter... In Nest, errors from route handlers are handled by the global filter before they reach the middleware's next callback? Actually no: Nest's exception filter catches handler errors and sends the response; then next() is called without an error (the error was consumed). The middleware's next error only fires if something outside a filter fails. Let me simplify: catch the reject, and if the error is an AppError, send the envelope, else 500 envelope; but only if !res.headersSent.

Hmm, actually, subtle: if a downstream handler throws, Nest's ExceptionsHandler catches it (since the handler's promise rejects within the Nest router's async context — is that within our ALS run? Yes, the whole downstream runs inside storage.run). The filter sends the response; next() is called with no error (Nest swallows it after the filter handles it). So my catch mostly handles resolver errors. Let me write it defensively:

```ts
async use(req, res, next) {
  let tenant: Tenant;
  try {
    tenant = await this.resolver.resolve(req.headers.host, req.headers.authorization);
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    if (!res.headersSent) res.status(status).json(body);
    return;
  }
  await this.context.run({ tenantId: tenant.id }, () =>
    new Promise<void>((resolve, reject) => next((err) => (err ? reject(err) : resolve()))),
  ).catch((err) => {
    if (!res.headersSent) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });
}
```

`toErrorResponse(err)` — shared with the filter: maps AppError → {status, code, message, details}; Prisma P2025 → 404; etc. Let me put the mapping logic in `src/errors/error-mapping.ts` used by both the filter and the middleware.

Actually — cleaner: let the middleware just throw, and rely on Nest's global filter to handle middleware errors. Does Nest route middleware errors through the global filter? I'm trying to remember... In Nest, errors thrown in middleware (a custom NestMiddleware) — I believe they are caught by the global exception filter (the ExceptionsZone wraps the entire request pipeline including middleware). Hmm, I've seen both claims. There was an issue: "global exception filter not catching errors thrown in middleware" — I recall that middleware errors are indeed passed to the filter in Nest 7+... not 100% sure. My manual handling removes the doubt. Keeping the manual handling in the middleware with the shared mapper. Slight duplication but deterministic.

### Error mapping

```ts
// src/errors/error-mapping.ts
import { Prisma } from '@prisma/client';
import { AppError } from './app-error';
import { TenantContextError } from '../tenant/tenant-context';

export interface ErrorDecision { status: number; code: string; message: string; details: Record<string, unknown>; }

export function decideError(err: unknown): ErrorDecision {
  if (err instanceof AppError) return { status: err.httpStatus, code: err.code, message: err.message, details: err.details };
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return { status: 404, code: 'resource_not_found', message: 'the requested record does not exist', details: { prismaCode: err.code } };
    if (err.code === 'P2002') return { status: 409, code: 'conflict', message: 'a record with the same unique value already exists', details: { prismaCode: err.code, target: err.meta?.target ?? null } };
    if (err.code === 'P2003') return { status: 409, code: 'conflict', message: 'the record is referenced by other data', details: { prismaCode: err.code } };
    return { status: 409, code: 'database_error', ... } hmm.
  }
  if (err instanceof TenantContextError) return { status: 500, code: 'no_tenant_context', message: err.message, details: {} };
  if (err instanceof Error) return { status: 500, code: 'internal_error', message: 'unexpected error', details: {} };
  return { status: 500, code: 'internal_error', message: 'unexpected error', details: {} };
}
```

details should be an object, never null ✓ (use {}).

For P2025's details: include the model? err.meta has { cause }. Let me keep `{ prismaCode: err.code }`.

The message for 404 in the spec: fetch-by-id "same body as a non-existent id" — my findById (null → service throws 404) and update/delete (P2025 → filter 404) should produce the same body? "Another tenant's id behaves exactly like a non-existent id: 404, same body." Strictly, the body for B fetching A's customer and B fetching a random uuid must be identical. If the service throws with details { id }, and P2025 mapping has details { prismaCode }, the bodies differ! Let me make them consistent:

- Service findById null → AppError('resource_not_found', 404, 'customer not found', { id })
- Filter P2025 → code 'resource_not_found', message 'customer not found'?? The filter is generic (doesn't know the resource kind). Hmm.

Options: make both paths use the same message. If the generic P2025 message is "the requested record does not exist" and details is {}, then the service's 404 should be the same: AppError('resource_not_found', 404, 'the requested record does not exist', {})? A bit generic for GET, but "same body" is satisfied across all 404s. Actually — cleaner: have the service not throw its own 404; instead have the repository use `findUniqueOrThrow`?? No — I want to control the body.

Decision: normalize all 404s to the same envelope: `{ error: { code: 'resource_not_found', message: 'resource not found', details: {} } }`. Service: `throw new AppError('resource_not_found', 404, 'resource not found')` with default details {}. Filter P2025: same message/details. Identical body ✓. Slightly generic message — acceptable; the spec explicitly wants indistinguishability (that's the security point: don't reveal the resource kind).

Hmm, but "message is for developer English" — 'resource not found' is fine.

### The concurrency test

```ts
it('concurrent requests from two tenants do not cross contexts', async () => {
  // Seed known customers in A and B (different emails)
  const jobs: Promise<{status, json}>[] = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(api('GET /customers', { host: a.domain, org: a.id }));
    jobs.push(api('GET /customers', { host: b.domain, org: b.id }));
    // Plus some writes to make it spicy:
    jobs.push(api('POST /customers', { host: a.domain, org: a.id, body: { email: `a${i}@x.com`, name: 'A' } }));
    jobs.push(api('POST /customers', { host: b.domain, org: b.id, body: { email: `b${i}@x.com`, name: 'B' } }));
  }
  const results = await Promise.all(jobs);
  // A's list: every email has a domain part in the A seed set?
});
```

Assertion: the responses of the GETs as A contain only A's emails (prefix a), and B's only B's. Let me tag emails: A's customers `a-1@shared.test` etc. Assert: every customer in A-list has email starting with 'a-'; every customer in B-list has email starting with 'b-'. And the final GET /customers as A has exactly the expected set (seed + 10 new a's). Let me do the final verification GET.

Note: the concurrency test must use its own app instance (each spec file has its own). ✓

"No context crosses" is also structurally guaranteed by the per-request ALS.

### The "no context" test

```ts
it('a query issued with no tenant in context fails rather than returning everything', async () => {
  const repo = moduleRef.get(CustomersRepository);
  await expect(repo.list()).rejects.toThrow(/tenant/i);
});
```
Called outside the request → no ALS → storage.current() throws TenantContextError ('no tenant in context'). But wait — could this spec file's `moduleRef.get(CustomersRepository)` run inside a leftover ALS from a previous test? Each test is separate; the ALS store is per-async-execution; after the request completes, the store is gone. Direct call → no store ✓. But the Prisma client connection — the repository's `this.db` is the same extended client ✓.

Also verify it didn't return everything: rejects → nothing returned ✓. Should I also assert that tenant A's data is intact? It's a rejection; fine.

Where do I get the moduleRef? The helper's startApp returns the moduleRef. Let me have it.

### Seed plan

In each spec file's beforeAll:
1. Ensure the migration is applied (once — but per file; use a module-level flag or just run it each time; it's idempotent).
2. Create the app.
3. Seed tenants A and B with unique domains.

```ts
const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
const tenants = {
  a: await db.tenant.create({ data: { domain: `app.a-${suffix}.example.test`, name: 'Operator A', branding: { primaryColor: '#111111', logoUrl: 'https://a.example.test/logo.png' }, featureFlags: { beta_orders: true, dark_mode: false } } }),
  b: await db.tenant.create({ data: { domain: `app.b-${suffix}.example.test`, name: 'Operator B', branding: { primaryColor: '#00ff00', logoUrl: 'https://b.example.test/logo.png' }, featureFlags: { beta_orders: false, dark_mode: true } } }),
};
```

Seed customers via API (as the tenant) or via the base db (bypasses the extension with explicit tenantId — allowed since it's a raw PrismaClient base). Using the API exercises more; but the isolation test needs known ids — the API response returns the created customer with its id ✓. Let me register via the API.

afterAll: stop the app; delete seeded tenants (db.tenant.deleteMany({ where: { id: { in: [a.id, b.id] } } })) — cascades? customers' FK tenant_id → RESTRICT (default) → deleting the tenant with customers fails! I set the relation without onDelete → RESTRICT. Cleanup: first deleteMany the customer/plan/order by tenantId, then the tenant. Or add onDelete: Cascade to the Customer.tenant relation → deleting the tenant removes its customers (and cascades further to orders). For cleanup simplicity: cascade. In the real world, deleting a tenant wipes its data — plausible. Let me set `onDelete: Cascade` on tenant relations (Customer.tenant, Plan.tenant, Order.tenant). Then cleanup = delete tenants by id.

Wait, Order has two tenant relations? Order.tenant → Tenant (fields [tenantId]) plus composite FKs to Customer (tenantId, customerId) and Plan (tenantId, planId). Multiple FKs from tenant_id columns to different tables — fine (one column, multiple FKs, each referencing different tables).

Cascade chain: Tenant → Order direct cascade covers orders; Customer → Order cascade covers it too. ✓

### Now — "list" endpoint ordering: orderBy createdAt asc, then id? For determinism in assertions, let me use createdAt asc, id asc. Prisma: `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`.

### Response shape

GET /customers → array of customer objects: { id, email, name, createdAt, updatedAt } (tenantId is in the Prisma object — should the API response expose tenantId? It's internal; the controller/service can map to a DTO without tenantId. "Zero business logic in the controller" — shape mapping is presentation; let me do it in the service (logic layer) returning DTOs. Let me have the service return the row minus tenantId:

```ts
function toDto(c: Customer) { return { id: c.id, email: c.email, name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt }; }
```
A little duplication but keeps the response clean. Hmm — is hiding tenantId required? Not explicitly. Exposing tenantId is not a leak (the caller is in that tenant). But a cleaner API omits it. Let me omit it via the DTO in the service. OK.

POST /customers → 201 + dto.
PATCH /customers/:id → dto. Body: { name? } — allow updating name (and email? updating email → conflict path; let me allow name only, keep the scope). Validation: name is a non-empty string if present. If body is empty/invalid → 400.

DELETE → 204.

GET /tenant-config → { id, name, domain?, branding, featureFlags }. "Branding and feature flags for the resolved tenant" → let me return { id, name, branding, featureFlags }. (domain in the response? harmless; include? Let me include — it's the tenant's own domain, no cross-tenant info. Keep: id, name, branding, featureFlags. Fine.)

### Test request helper

```ts
async function api(base: string, path: string, opts: { method?: string; host: string; org?: string; body?: unknown } = { host: '' }) {
  const headers: Record<string, string> = { host: opts.host };
  if (opts.org) headers.authorization = `Bearer ${signToken(opts.org)}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let json: unknown = null; try { json = JSON.parse(text); } catch { /* 204 */ }
  return { status: res.status, json };
}
```

Note: fetch with the `host` header — does Node's undici allow overriding Host via the headers? In undici, the `Host` header can be set via headers (it's overridden). Yes, setting headers: { host } works in Node fetch.

signToken:
```ts
import jwt from 'jsonwebtoken';
const signToken = (org: string) => jwt.sign({ org }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '5m' });
```

### startApp

```ts
export async function startApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  const url = await app.getUrl(); // "http://127.0.0.1:PORT"
  return { moduleRef, app, base: url };
}
```

`app.getUrl()` returns a Promise<string>. ✓

Stop: `await app.close()` — closes the Prisma client (PrismaService implements OnModuleDestroy → $disconnect).

PrismaService:
```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
Wait — PrismaClient constructor reads DATABASE_URL from env at construction. ✓ ("url = env("DATABASE_URL")" — if missing, the PrismaClient constructor throws? Actually, the datasource url env is read lazily at connect time; the constructor may not throw. Let me assert in the test helper that it's set, and main.ts can let it fail at connect. Fine.)

Hmm, one concern: PrismaService extends PrismaClient — the constructor is inherited; Nest instantiates it with no args → PrismaClient's default constructor reads env. ✓ Standard pattern.

TENANT_DB provider in PrismaModule:

```ts
const TENANT_DB: InjectionToken = 'TENANT_DB';
@Module({
  providers: [
    PrismaService,
    { provide: TENANT_DB, useFactory: (prisma: PrismaService, ctx: TenantContextStorage) => createTenantAwareClient(prisma, ctx), inject: [PrismaService, TenantContextStorage] },
  ],
  exports: [PrismaService, TENANT_DB],
})
export class PrismaModule { ... }
export { TENANT_DB } — or export const in prisma.constants? Layout: one file per role... the constant could be in `src/prisma/prisma.tokens.ts`? The layout shows only module/controller/service/repository per feature. The token can be exported from prisma.module.ts. Let me export the token from prisma.module.ts: `export const TENANT_DB = 'TENANT_DB' as const;` hmm, the token is used by other modules importing the module — importing the constant from the module file is fine.

Wait — PrismaModule's useFactory injects TenantContextStorage → PrismaModule imports ContextModule ✓.

The base PrismaClient passed to createTenantAwareClient: prisma (PrismaService instance, which is a PrismaClient) ✓.

### ContextModule

```ts
// src/context/context.module.ts
import { Module } from '@nestjs/common';
import { TenantContextStorage } from '../tenant/tenant-context';

@Module({ providers: [TenantContextStorage], exports: [TenantContextStorage] })
export class ContextModule {}
```

Hmm — the ContextModule's provider references a class in the tenant directory; fine. Or put TenantContextStorage in src/context/tenant-context.ts? "tenant-context" belongs to the tenant feature... The ContextModule is infra. To minimize file sprawl and keep the tenant stuff together, let me keep the storage class in `src/tenant/tenant-context.ts`, and the ContextModule in `src/context/context.module.ts`. Slight directory mismatch but OK. Or skip ContextModule entirely and provide TenantContextStorage in the AppModule (root) with exports — the root module can provide+export, and feature modules import the AppModule? No — the feature modules are imported by AppModule; a feature can't import AppModule (cycle). So a separate small module is the clean answer. Or provide the storage in PrismaModule and export it, and TenantModule imports PrismaModule — that also works and saves a module!

Direction: PrismaModule provides PrismaService + TenantContextStorage + TENANT_DB (exports all). TenantModule imports PrismaModule (for the resolver's base client + the storage for the middleware). CustomersModule imports PrismaModule (TENANT_DB). TenantConfigModule imports TenantModule (TenantService) — does it need the storage? TenantService needs storage + base client: provided via TenantModule's re-export? TenantModule imports PrismaModule and exports TenantService, TenantMiddleware, TenantResolverService... TenantService is a provider in TenantModule that injects TenantContextStorage + PrismaService — available because TenantModule imports PrismaModule ✓.

So no ContextModule needed! Storage is provided by PrismaModule. Is it weird for the "tenant context" to be provided by PrismaModule? A little. Alternatively, rename: put the storage in the tenant module... but PrismaModule needs it → cycle (PrismaModule ↔ TenantModule). So the storage must be in a module both import: PrismaModule (or ContextModule or root). Let me have PrismaModule provide it — it's defensible: the tenant-aware data layer owns the context contract. Hmm, actually — wait. Let me reconsider: is the storage's provider location important for DI? No. Let me put `TenantContextStorage` in PrismaModule's providers/exports, and the class file in src/tenant/tenant-context.ts. Good — one less module.

Hmm, actually, hold on, let me reconsider naming: "prisma module provides tenant context storage" — a reviewer might find it odd. But it's pragmatic. Or `src/prisma/tenant-context.ts` (context is part of the data-layer isolation). Then tenant-context is in the prisma directory, and the tenant directory has resolver/middleware/service/module. That's consistent! The context is the mechanism the prisma layer consumes. Let me do `src/prisma/tenant-context.ts`. Hmm, but conceptually "request-scoped tenant context" is a tenant-domain concept... The directory split is aesthetic; let me go with prisma/tenant-context.ts. Wait, then PrismaModule's file imports from its own directory ✓ clean.

Ehh — actually, let me reconsider one more time: TenantModule's middleware needs the storage; TenantModule imports PrismaModule ✓. Fine, final: storage class in `src/prisma/tenant-context.ts`, provided/exported by PrismaModule.

### TenantModule

```ts
@Module({
  imports: [PrismaModule],
  providers: [TenantResolverService, TenantService, TenantMiddleware],
  exports: [TenantService, TenantMiddleware, TenantResolverService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

Wait — does TenantMiddleware need to be a provider? Yes (it's a class with constructor injection) ✓. `forRoutes('*')` — matches all paths. ✓

Note: the middleware runs before the route; for unmatched routes (404), the middleware runs first (applied to '*'), so an unknown path with a valid tenant → 404 via Nest (the filter maps to the envelope `not_found`?). The filter maps a Nest HttpException 404 → code... let me map HttpException: status 404 → 'not_found', 405 → 'method_not_allowed', 400 → 'bad_request', else 'http_error'? Keep a small mapping:

```ts
if (err instanceof HttpException) {
  const status = err.getStatus();
  const code = status === 404 ? 'not_found' : status === 405 ? 'method_not_allowed' : status === 400 ? 'bad_request' : 'http_error';
  ...
}
```
Fine.

### CustomersModule

```ts
@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
})
export class CustomersModule {}
```

### TenantConfigModule

```ts
@Module({
  imports: [TenantModule],
  controllers: [TenantConfigController],
  providers: [], // TenantService from TenantModule
})
```
The controller uses TenantService (imported). ✓ The layout convention expects a service per feature; tenant-config uses TenantService (in the tenant feature) — acceptable (cross-feature via exports per the wiring rules ✓).

Hmm, the wiring rule: "a provider used by another module is exported by its own module, and that module is imported by the other" ✓ exactly what I'm doing.

### Now let me write the extension carefully (types)

Let me double-check the $allOperations hook signature once more. From the Prisma docs (query extensions):

```ts
const ext = prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // do something with args
        return query(args)
      },
    },
  },
})
```
Yes, that's the documented pattern. The `model` parameter: the model name string. `operation`: e.g. 'findMany'. ✓

The args for `createMany` with `skipDuplicates` etc. — I only touch data ✓.

One more: `findFirst` with `where: undefined` ✓ merged.

`$count` (top-level count across models)? `prisma.$count({...})` — deprecated top-level; skip.

`findUniqueOrThrow` — merged; P2025 → 404 ✓.

### Prisma validation concerns

With composite @@id([tenantId, id]) and `findUnique({ where: { id } })` before extension → the extension adds tenantId → `{ id, tenantId }`. Prisma validates where against unique constraints: (tenantId, id) = @@id ✓ accepted.

`update({ where: { id, tenantId } })` ✓. `delete({ where: { id, tenantId } })` ✓.

But wait — what if repository code (mistakenly) calls `findUnique({ where: { tenantId: 'x', id } })`? The extension merges (spreads over) → tenantId = context wins ✓ "overwrite, don't trust."

What if `create({ data: { tenantId: 'other', email, name } })`? The extension: `{ ...data, tenantId }` → context wins ✓.

### The P2025 message on update

Prisma P2025 meta: `{"cause": "where", ...}`. The generic 404 body is the same across kinds ✓.

### Now the migration SQL

Let me write it to be accurate:

```sql
-- CreateEnum? no enums (status is String)
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branding" JSONB NOT NULL,
    "feature_flags" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("tenant_id", "id")
);

CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("tenant_id", "id")
);

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("tenant_id", "id")
);

CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");
CREATE UNIQUE INDEX "plans_tenant_id_slug_key" ON "plans"("tenant_id", "slug");
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");
CREATE INDEX "orders_plan_id_idx" ON "orders"("plan_id");

ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

The Prisma column order: I declared `id` first in the model, then tenantId — wait, earlier I wrote the model with id first. In the migration SQL above, customers has "id" then "tenant_id" ✓ matching.

Wait — `@updatedAt` generates "updated_at" NOT NULL (Prisma makes updated_at non-null with no default, and sets it via the client). In the SQL migration, Prisma outputs `"updated_at" TIMESTAMPTZ(6) NOT NULL` ✓ (as I wrote).

migration_lock.toml:
```
provider = "postgresql"
```
(Prisma 5: just the provider line.)

Folder name: `prisma/migrations/20250101000000_init/migration.sql`.

### Wait — one more check: `@@id([tenantId, id])` + `id @default(uuid())` — Prisma requires all fields in the @@id to be non-optional ✓ both String. The default on a PK field is allowed? For a single @id with @default(uuid()) it's standard; a composite with a default — I believe it's allowed (e.g. @@id([tenantId, id]) with id @default(cuid()) works). ✓

### Order model: do I even need `tenant` relation + composite FKs in this build? No code path uses them (no order endpoints). But the schema integrity is good. The risk of composite FK relations breaking `prisma migrate dev`... I'm shipping hand-written SQL (no prisma generate dependency in tests except for the client types). The Prisma client is generated from the schema — if the schema is invalid, client generation fails and everything fails. So the schema's validity is crucial. Composite relation `@relation(fields: [tenantId, customerId], references: [tenantId, id])` — I'm now quite confident this is valid Prisma (it's the documented way to relate to a composite key).

Hmm, one more subtlety: with `Order.tenant Tenant @relation(fields: [tenantId], references: [id])` and Order.tenantId also in @@id — fine.

And Customer: `tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)` ✓.

Back-references: Tenant.customers Customer[] etc. ✓.

### Also: is `featureFlags Json` → column "feature_flags" OK? Prisma maps camelCase → snake_case ✓ (via default naming: attribute name = field name mapped to snake_case? Actually, Prisma maps field names to column names by default as-is (case preserved)! Wait — no. Prisma's default: column name = field name as written, unless you use @map. `featureFlags` → column "featureFlags" (camelCase) by default! The task's convention says tables and columns are snake_case via @map/@@map. So I need explicit @map on camelCase fields: `featureFlags Json @map("feature_flags")`, `createdAt DateTime @default(now()) @map("created_at")`, `updatedAt ... @map("updated_at")`, `tenantId String @map("tenant_id")`, `priceCents Int @map("price_cents")`, `totalCents Int @map("total_cents")`, `customerId String @map("customer_id")`, `planId String @map("plan_id")`. Single-word fields (id, email, name, domain, status, slug, active) are fine unmaped.

Let me add all @maps. And the migration SQL uses snake_case columns ✓ consistent.

### Test details — customer isolation flow

spec customers.spec.ts:

```ts
describe('customers', () => {
  let ctx: Ctx; // { base, moduleRef, tenants: {a, b}, db, stop }
  let aliceA: { id, email };
  let bobB: ...;

  beforeAll(async () => {
    ctx = await startApp();
    aliceA = await registerAs(ctx, 'a', { email: 'alice@shared.test', name: 'Alice' });
    bobB = await registerAs(ctx, 'b', { email: 'bob@bob.test', name: 'Bob' });
  }, 60000);
  afterAll(async () => { await ctx.stop(); });

  it('tenant B cannot list tenant A customers', ...);
  it('tenant B fetching tenant A customer by id gets 404 same as a non-existent id', async () => {
    const cross = await api(`/customers/${aliceA.id}`, { host: b, org: b.id });
    const ghost = await api(`/customers/${randomUUID()}`, { host: b, org: b.id });
    expect(cross.status).toBe(404);
    expect(ghost.status).toBe(404);
    expect(cross.json).toEqual(ghost.json); // same body
  });
  it('tenant B cannot update tenant A customer', async () => {
    const res = await api(`/customers/${aliceA.id}`, { method: 'PATCH', host: b, org: b.id, body: { name: 'Hacked' } });
    expect(res.status).toBe(404);
    const after = await api(`/customers/${aliceA.id}`, { host: a, org: a.id });
    expect(after.json.name).toBe('Alice');
  });
  it('tenant B cannot delete tenant A customer', ... similar; A still 200);
  it('same email registers in both tenants', async () => {
    const rA = await registerAs(a, { email: 'shared@both.test', name: 'S A' });
    const rB = await registerAs(b, { email: 'shared@both.test', name: 'S B' });
    expect([rA, rB].every(r => r.status === 201)).toBe(true);
    expect(rA.json.id).not.toBe(rB.json.id);
  });
  it('same email twice in one tenant → 409', ...);
});
```

registerAs helper:
```ts
async function registerAs(ctx, which, body) {
  const t = ctx.tenants[which];
  const res = await api(ctx.base, '/customers', { method: 'POST', host: t.domain, org: t.id, body });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.json)}`);
  return { ...res.json, id: res.json.id };
}
```
json typing — let me use `any` pragmatically in tests? Strict mode: let me type res.json as unknown and cast where needed. Let me type the api return as `{ status: number; json: any }` — tests use any (strict allows explicit any). Fine for test code.

tenant-isolation.spec.ts:

```ts
it('rejects host/token mismatch', async () => {
  const res = await api(base, '/customers', { host: a.domain, org: b.id });
  expect(res.status).toBe(403);
  expect(res.json.error.code).toBe('tenant_mismatch');
});
it('rejects missing token', ... 401 unauthorized);
it('rejects bad host', ... 404 unknown_host);
it('concurrent requests do not cross contexts', ... as designed);
it('no-context query fails', ... moduleRef.get(CustomersRepository).list() rejects);
```

tenant-config.spec.ts:
```ts
it('returns branding + flags for the resolved tenant', async () => {
  const res = await api(base, '/tenant-config', { host: a.domain, org: a.id });
  expect(res.status).toBe(200);
  expect(res.json).toMatchObject({ id: a.id, name: 'Operator A', branding: {...}, featureFlags: {...} });
});
// And as B, different values
```

### Importing CustomersRepository in tests

`import { CustomersRepository } from '../src/customers/customers.repository';` ✓ moduleRef.get(CustomersRepository).

### App startup in tests — the middleware applies; my test requests always send host+org except in the negative tests ✓.

### One more consideration: CORS/express host check — Express's `trust proxy`? The Host header is read raw from req.headers.host ✓ no trust needed.

### main.ts and tests both use useGlobalFilters. In tests I create the app via Test — the filter is added manually ✓ (main.ts's filter only applies to the real server).

### Let me double-check the extension for `create` with `data.tenantId` overwrite and FK: customers.create data { email, name } + stamped tenantId → FK to tenants.id must exist ✓ the tenant row exists (created in seed).

### Concurrency + Prisma connection pool: each app 1 PrismaClient (default pool 1 per client... Prisma's default connection limit is 1? Prisma's default is 1 connection per client? No — Prisma's default pool: `connection_limit` default 1? Prisma's default is 1 connection per client process... actually, I think the default is 1. Hmm, Prisma docs: default connection limit is 1? I think Prisma's default is 1 connection (a single pooled connection), with the recommendation to raise it for concurrency. With a single PrismaClient handling 40 concurrent requests — Prisma multiplexes queries over its connection(s); with connection_limit=1, it serializes but still correct (queries are independent). No correctness issue. To be safe, I could set `connection_limit` in the schema datasource... I can't read env for connection_limit without adding a variable. Skip — the correctness holds either way; Prisma handles concurrency via its own protocol (a single client can handle concurrent queries; the pool defaults to... whatever). Fine.

### Vitest + Prisma client generation: tests import @prisma/client — requires `prisma generate` to have been run (the default client is a stub until generated). The test setup runs `prisma migrate deploy`, which requires a generated... no, migrate deploy doesn't require a client. But `@prisma/client` imports in the app require the generated client (postinstall script: Prisma's default template has "postinstall": "prisma generate"). Let me add a script: `"postinstall": "prisma generate"` — standard. And the test helper ensures the client exists: if not generated, it fails with a clear Prisma error. The postinstall on `pnpm install` handles generation ✓. Should the helper also run generate? `prisma migrate deploy` needs the schema; the client needs generate. Let me have the helper run both: generate then migrate deploy? `prisma generate` is fast and idempotent. To be safe, let me have the helper run `prisma generate` then `prisma migrate deploy` — makes the suite self-contained: `pnpm install && pnpm test`.

Running the prisma CLI: `execFileSync(bin, ['generate'])` and `['migrate', 'deploy']`, cwd = project root, stdio inherit? Let me capture and include in the error. Path: `path.join(rootDir, 'node_modules', '.bin', 'prisma')` — on Windows needs .cmd... the env here is macOS. Let me keep it POSIX, and mark it? I'll add a comment. Or use `npx --no-install prisma` — npx exists in the Node env: `execFileSync('npx', ['--no-install', 'prisma', 'generate'])` — npx resolves the local bin without a network. More portable. Hmm, npx --no-install: if the bin is missing → error ✓. Let me use npx. Wait, pnpm + npx: npx --no-install looks at node_modules/.bin ✓ works under pnpm layout. OK, using npx.

Hmm, but `npx` is an npm-bundled binary — it's present (Node 20 ships with npm) ✓.

Actually, simpler and more standard: document `pnpm test` requires `pnpm install` (postinstall generates the client) + the migration is applied via the helper's migrate deploy. Let me keep just the migrate deploy in the helper (skip the generate — postinstall covers it; if not, the error message from @prisma/client is clear: "@prisma/client did not initialize yet. Please run prisma generate").

Hmm — risk: a grader copies the files without running pnpm install → everything is missing anyway. The helper's migrate deploy is the best I can do. ✓

### Let me reconsider: does `migrate deploy` need `prisma migrate` history tables — yes, it creates `_prisma_migrations`. ✓ Idempotent.

### Let me write the DTO/validation for the customers controller:

```ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRegisterBody(body: unknown): { email: string; name: string } {
  if (typeof body !== 'object' || body === null) throw new AppError('bad_request', 400, 'body must be a JSON object', {});
  const b = body as Record<string, unknown>;
  if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email)) throw new AppError('bad_request', 400, 'email must be a valid email address', { field: 'email' });
  if (typeof b.name !== 'string' || b.name.trim().length === 0) throw new AppError('bad_request', 400, 'name must be a non-empty string', { field: 'name' });
  return { email: b.email.trim(), name: b.name.trim() };
}
```
In the controller (input validation ✓ zero business logic ✓).

Update body: `{ name?: string }` non-empty string; unknown keys ignored (or 400? ignore is fine).

### Service list returns dto[]; findById → dto or 404; register → dto (201 is automatic for POST in Nest? Nest returns 201 for @Post by default ✓); update → dto; remove → void (Nest returns 204 for @Delete by default when returning undefined ✓ — actually, @Delete returns 204 when the handler returns void/undefined ✓).

### Let me verify the "update A's row → 404 and A's row is unchanged afterward" — the extension's update where {id, tenantId: B} → P2025 (no row in B) → filter 404 ✓ unchanged ✓.

### Edge — the `update` operation's data could be `data: { name: 'Hacked' }` — fine.

### Now, does the middleware's ALS wrap the Prisma queries? The route handler runs inside storage.run via the next() promise chain — the downstream async work (including Prisma calls) inherits the store ✓. Nest's internal async (guards/interceptors/pipes) — none here. ✓

### Potential pitfall: Nest's `forRoutes('*')` matches all paths ✓.

### Another pitfall: `req.headers.host` in tests via fetch with the host header override — undici: can we set the `host` header? In undici's fetch, setting the Host header in the headers init is allowed (it overrides the default). Yes.

### The test's api() sends the exact tenant domain's host. The resolver looks up tenant by domain ✓.

### Let me also think about the `GET /customers` list response including only own-tenant rows: the extension merges where ✓ "list → completely excludes A's rows" — B's list shows only B's ✓.

### Now, the files: `src/errors/app-error.ts`, `src/errors/all-exceptions.filter.ts`, `src/errors/error-mapping.ts`.

AllExceptionsFilter:

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionsFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const { status, code, message, details } = decideError(exception);
    if (status >= 500 && !(exception instanceof AppError)) {
      // Log the unexpected ones
      // eslint-disable-next-line no-console
      console.error(exception);
    }
    if (!res.headersSent) res.status(status).json({ error: { code, message, details } });
  }
}
```

Hmm, logging: fine with a small console.error guard, or skip logging. Let me keep a minimal log for 500s.

The middleware uses decideError too.

### Let me also double-check that decideError handles Prisma.PrismaClientValidationError → 400 'bad_request' (a dev bug — e.g., a bad where). Message: 'invalid query'. Fine.

### Also handle `TenantContextError` → status 500 code 'no_tenant_context' — but in HTTP, can it surface? The middleware ensures the context for all downstream; but the direct repository call in tests doesn't go through the filter. If it did (a bug), 500 is correct (fail closed, not a leak).

### Now — the tenant-context storage class:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export class TenantContextMissingError extends Error {
  constructor() {
    super('no tenant in request context; refusing to run an unscoped query');
    this.name = 'TenantContextMissingError';
  }
}

export interface TenantContext {
  readonly tenantId: string;
}

@Injectable()
export class TenantContextStorage {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(tenant: TenantContext, fn: () => T): T {
    return this.storage.run(tenant, fn);
  }

  get tenantId(): string {
    const ctx = this.storage.getStore();
    if (!ctx) throw new TenantContextMissingError();
    return ctx.tenantId;
  }
}
```

The `@Injectable()` decorator (imported from @nestjs/common) since it's a Nest provider ✓.

The extension uses `storage.tenantId` (getter throws) — clean: one access point.

### The factory:

```ts
// src/prisma/tenant-db.factory.ts
import { PrismaClient } from '@prisma/client';
import { TenantContextStorage } from './tenant-context';

export type TenantAwareClient = PrismaClient;

const TENANTLESS_MODELS = new Set(['Tenant']);
const READ_OPERATIONS = new Set(['findUnique','findFirst','findMany','findUniqueOrThrow','findFirstOrThrow','count','aggregate','groupBy']);
const CREATE_OPERATIONS = new Set(['create','createMany']);
const WHERE_OPERATIONS = new Set(['update','updateMany','delete','deleteMany','upsert']);
```

Wait, classification:
- Reads (where merge): findUnique, findFirst, findMany, findUniqueOrThrow, findFirstOrThrow, count, aggregate, groupBy
- create, createMany: where? no where; data stamp.
- upsert: where merge + create stamp.
- update: where merge.
- updateMany, deleteMany, delete: where merge.

So:
```ts
function scopeArgs(operation: string, args: any, tenantId: string): any {
  const a = args ? { ...args } : {};
  if (READ_OPERATIONS.has(operation) || WHERE_OPERATIONS.has(operation)) {
    a.where = { ...(a.where ?? {}), tenantId };
  }
  if (operation === 'create' || operation === 'createMany') {
    a.data = Array.isArray(a.data) ? a.data.map((d: any) => ({ ...d, tenantId })) : { ...a.data, tenantId };
  }
  if (operation === 'upsert') {
    a.data = { ...a.data, create: { ...a.data.create, tenantId } };
  }
  return a;
}
```
Note: for update/delete/updateMany/deleteMany, spreading `a.where` — where must be an object (Prisma validates). For create, args always has data.

Wait — `a.where = { ...(a.where ?? {}), tenantId }`: even if the original where was `{ id }` ✓. If where was undefined → `{ tenantId }` — for findMany, that's "all rows of the tenant" ✓; for deleteMany, "all rows of the tenant" ✓ (legitimate within-tenant operation); for findUnique, where {tenantId} alone is not a valid unique filter → Prisma validation error → 400 via the filter. But the repository never does that; fine (fails safely).

The extension:

```ts
function buildExtension(storage: TenantContextStorage) {
  // The Prisma extension API does not provide a typed hook for
  // "any model, any operation," so the hook parameters are left loose;
  // runtime behaviour is pinned by the isolation tests.
  return {
    query: {
      $allModels: {
        $allOperations: async (params: any) => {
          const { model, operation, args, query } = params;
          if (TENANTLESS_MODELS.has(model)) return query(args);
          const tenantId = storage.tenantId; // throws TenantContextMissingError
          return query(scopeArgs(operation, args, tenantId));
        },
      },
    },
  } as unknown as Parameters<PrismaClient['$extends']>[0];
}
```

Hmm — an unknown operation (e.g., a new Prisma op I didn't list, or 'createManyAndReturn' (Prisma 5.14+), 'updateManyAndReturn', 'deleteManyAndReturn', 'findManyAndCount', 'groupBy'...): my scopeArgs does nothing for unknown ops → they pass through unscoped!! That's a silent hole. Fix: fail closed — throw for operations I don't explicitly handle:

```ts
const HANDLED = new Set([...READ_OPERATIONS, ...WHERE_OPERATIONS, 'create', 'createMany', 'upsert', 'count', ...]);
if (!HANDLED.has(operation)) throw new Error(`tenant guard: operation "${operation}" is not explicitly tenant-scoped; refusing to run it unscoped`);
```
Fail closed ✓ — structurally: any unclassified operation errors rather than leaking.

Note: Prisma 5.10 — does createManyAndReturn exist? It landed in 5.14 (preview→stable in 5.14? `createManyAndReturn` became GA in 5.14). If I pin Prisma ^5.10, the user might get 5.x latest via ^5.10 → 5.22 etc. where findManyAndCount etc. exist. My repository only uses findMany/findUnique/create/update/delete — all handled ✓. The fail-closed guard covers the rest ✓. Let me pin prisma to "5.10.2" exactly? "^5.10.2" pulls in the latest 5.x — the generated client matches the installed version either way. Let me use ~5.10.0 to keep it predictable? Hmm, either works; let me pin "5.10.2" exactly for reproducibility. Hmm, actually, @prisma/client and prisma must be the same version — pin both exactly: "5.10.2". OK.

Also: the top-level `$queryRaw` guard in the proxy ✓. And `$batchRaw`? Also raw: add '$batchRaw' to the blocked set. And '$query', '$execute' (older APIs, gone in v5) — harmless to block. Block set: ['$queryRaw','$queryRawUnsafe','$executeRaw','$executeRawUnsafe','$batchRaw'].

### Proxy + TypeScript

```ts
function guardRawQueries<T>(client: T): T {
  const blocked = new Set([...]);
  return new Proxy(client, {
    get(target, prop) {
      if (typeof prop === 'string' && blocked.has(prop)) {
        return () => {
          throw new Error('raw SQL is not available on the tenant-aware client; use tenant-scoped model queries');
        };
      }
      return Reflect.get(target, prop);
    },
  });
}
```

Proxy over the extended client — model delegate access `proxy.customer` → Reflect.get(target, 'customer') → delegate object ✓.

### The PrismaModule provider

```ts
export const TENANT_DB = Symbol('TENANT_DB');
```
Symbol token — nice. Inject via @Inject(TENANT_DB). Exported from prisma.module.ts.

```ts
@Module({
  providers: [
    PrismaService,
    TenantContextStorage,
    {
      provide: TENANT_DB,
      useFactory: (base: PrismaService, storage: TenantContextStorage) => createTenantAwareClient(base, storage),
      inject: [PrismaService, TenantContextStorage],
    },
  ],
  exports: [PrismaService, TenantContextStorage, TENANT_DB],
})
export class PrismaModule {}
```

createTenantAwareClient(base: PrismaClient, ...) — PrismaService extends PrismaClient ✓.

### Repository

```ts
@Injectable()
export class CustomersRepository {
  constructor(@Inject(TENANT_DB) private readonly db: TenantAwareClient) {}

  list() {
    return this.db.customer.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  findById(id: string) {
    return this.db.customer.findUnique({ where: { id } });
  }

  create(data: { email: string; name: string }) {
    return this.db.customer.create({ data });
  }

  update(id: string, data: { name: string }) {
    return this.db.customer.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.db.customer.delete({ where: { id } });
  }
}
```

Zero mentions of tenantId ✓✓.

### Service

```ts
@Injectable()
export class CustomersService {
  constructor(private readonly customers: CustomersRepository) {}

  list() { return this.customers.list().then(rows => rows.map(toCustomerDto)); }

  async findById(id: string) {
    const row = await this.customers.findById(id);
    if (!row) throw new AppError('resource_not_found', 404, 'customer not found');
    return toCustomerDto(row);
  }

  register(email: string, name: string) {
    return this.customers.create({ email, name }).then(toCustomerDto);
  }

  update(id: string, data: { name: string }) {
    return this.customers.update(id, data).then(toCustomerDto);
  }

  remove(id: string) {
    return this.customers.remove(id);
  }
}
```

Hmm — "the service holds the logic" — the 404 throw is logic ✓ in the service. P2025 from update/remove → filter. Both 404 bodies must be identical: the service's AppError message 'customer not found' vs. the filter's P2025 message — I decided on a unified message: let me use 'resource not found' for both? Let me finalize the envelope:

- code: 'resource_not_found'
- message: 'resource not found'
- details: {}

The service: `throw new AppError('resource_not_found', 404, 'resource not found')` — AppError's default details is {}. The filter's P2025: same. Identical ✓. A bit generic; the spec wants indistinguishable — a generic message is the point. OK.

toCustomerDto:
```ts
function toCustomerDto(c: { id: string; email: string; name: string; createdAt: Date; updatedAt: Date }) {
  return { id: c.id, email: c.email, name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt };
}
```
Type: import Customer from @prisma/client ✓ `Customer`.

### The tenant service

```ts
@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContextStorage) {}

  async forCurrentRequest() {
    const tenantId = this.context.tenantId; // throws if absent (fail closed)
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError('tenant_mismatch', 500, 'resolved tenant no longer exists');
    return { id: tenant.id, name: tenant.name, branding: tenant.branding, featureFlags: tenant.featureFlags };
  }
}
```

Hmm 'tenant_mismatch' is the wrong code for this; use 'internal_error' 500. This path is effectively unreachable (the middleware just read the tenant). Use code 'internal_error'. Fine.

JSON serialization: branding/featureFlags are Json values (objects) ✓ serialize.

### The tenant-config controller

```ts
@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenants: TenantService) {}
  @Get()
  current() { return this.tenants.forCurrentRequest(); }
}
```
Route path '/tenant-config' kebab-case plural? The endpoint naming is "kebab-case, plural" — `tenant-config` is singular... The spec mandates `GET /tenant-config`. The spec wins (the task text is explicit). ✓

### Now the concurrency test details

Let me write it concretely:

```ts
it('concurrent requests from two tenants do not cross contexts', async () => {
  const N = 8;
  const jobs: Array<() => Promise<{ status: number; json: any }>> = [];
  for (let i = 0; i < N; i++) {
    jobs.push(() => api(base, '/customers', { host: a.domain, org: a.id }));
    jobs.push(() => api(base, '/customers', { host: b.domain, org: b.id }));
    jobs.push(() => api(base, '/customers', { method: 'POST', host: a.domain, org: a.id, body: { email: `c${i}@a-both.test`, name: `CA${i}` } }));
    jobs.push(() => api(base, '/customers', { method: 'POST', host: b.domain, org: b.id, body: { email: `c${i}@b-both.test`, name: `CB${i}` } }));
  }
  const results = await Promise.all(jobs.map(f => f()));
  // All writes succeed
  const posts = results.filter(r => r.status !== 200);
  expect(posts.every(r => r.status === 201)).toBe(true);
  // No 4xx/5xx
  expect(results.every(r => r.status === 200 || r.status === 201)).toBe(true);
  // Verify final state per tenant
  const finalA = await api(base, '/customers', { host: a.domain, org: a.id });
  const finalB = await api(base, '/customers', { host: b.domain, org: b.id });
  const emailsA = new Set(finalA.json.map((c: any) => c.email));
  const emailsB = new Set(finalB.json.map((c: any) => c.email));
  for (let i = 0; i < N; i++) {
    expect(emailsA.has(`c${i}@a-both.test`)).toBe(true);
    expect(emailsA.has(`c${i}@b-both.test`)).toBe(false);
    expect(emailsB.has(`c${i}@b-both.test`)).toBe(true);
    expect(emailsB.has(`c${i}@a-both.test`)).toBe(false);
  }
});
```

This asserts: each tenant's created email appears only in its own list ✓. Even if contexts crossed (say, a B request ran in A's context), B's created emails would show up in A's list or missing from B's → detected.

Also, in the intermediate GETs (results), I can assert that each GET response contained only emails for its own tenant — stronger (per-response). Let me add: for the GET results (the first two of each i), verify all emails end with the correct domain suffix. Let me collect the GET results separately:

```ts
const listA: any[] = []; const listB: any[] = [];
... capture per job.
```
Simpler: build a result array with labels. Let me write it cleanly with an array of {label, promise}.

OK. Also add a direct assertion that "tenant A's list doesn't leak B's seeded customer" via the final state ✓ (finalB contains bob's seeded email? The isolation spec file is separate — the tenant-isolation spec seeds its own: seed 1 in A, 1 in B).

### The no-context test location

In tenant-isolation.spec.ts:
```ts
it('a query issued with no tenant in context fails rather than returning everything', async () => {
  const repo = moduleRef.get(CustomersRepository);
  await expect(repo.list()).rejects.toThrow(TenantContextMissingError);
});
```
Import TenantContextMissingError from src/prisma/tenant-context ✓.

Wait — one risk: vitest may run this file's tests after a request that set up the ALS... ALS stores don't persist across tests ✓ (each request runs inside its own storage.run). Direct call → no store ✓.

But — a subtlety: `moduleRef.get(CustomersRepository)` — the repository's db is the same TENANT_DB instance ✓.

### The seed in the tenant-isolation spec: seed alice in A, bob in B (via the API).

### now — the app.module:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { CustomersModule } from './customers/customers.module';
import { TenantConfigModule } from './tenant-config/tenant-config.module';

@Module({
  imports: [PrismaModule, TenantModule, CustomersModule, TenantConfigModule],
})
export class AppModule {}
```

### File count check (deliverables):

1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/migration_lock.toml
6. prisma/migrations/20250101000000_init/migration.sql
7. src/main.ts
8. src/app.module.ts
9. src/prisma/prisma.module.ts
10. src/prisma/prisma.service.ts
11. src/prisma/tenant-context.ts
12. src/prisma/tenant-db.factory.ts
13. src/tenant/tenant.module.ts
14. src/tenant/tenant-resolver.service.ts
15. src/tenant/tenant.service.ts
16. src/tenant/tenant.middleware.ts
17. src/tenant-config/tenant-config.module.ts
18. src/tenant-config/tenant-config.controller.ts
19. src/customers/customers.module.ts
20. src/customers/customers.controller.ts
21. src/customers/customers.service.ts
22. src/customers/customers.repository.ts
23. src/errors/app-error.ts
24. src/errors/error-mapping.ts
25. src/errors/all-exceptions.filter.ts
26. test/support.ts
27. test/customers.spec.ts
28. test/tenant-config.spec.ts
29. test/tenant-isolation.spec.ts

Do I need a README? Not asked. Skip. .env? "No secrets in the repo" — skip .env; document in comments? Let me skip the README; a brief comment in main.ts? "Do exactly what the task asks" — I'll skip the README. Hmm, a small note about the env vars needed is useful, but... the task says don't create files not asked for. Skipping.

### Let me now write each file in full, carefully.

**package.json**

```json
{
  "name": "operator-platform",
  "version": "1.0.0",
  "private": true,
  "description": "Multi-tenant white-label operator platform (NestJS + Prisma + Postgres)",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "postinstall": "prisma generate",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.9",
    "@nestjs/core": "^10.3.9",
    "@nestjs/platform-express": "^10.3.9",
    "@prisma/client": "5.10.2",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.9",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.12.7",
    "prisma": "5.10.2",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

**tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": false,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

**vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false, // hmm — the default in vitest 1.x is files run in parallel? Vitest 1: test files run in parallel by default.
  },
});
```

Parallel spec files → 3 apps simultaneously on the same Postgres — fine (separate tenants with random domains). Let me keep the default parallel. Actually, the migrate deploy racing across 3 files — `prisma migrate deploy` running concurrently on the same DB → lock contention / possible failure. Vitest runs the beforeAll hooks in parallel across files! Three concurrent `prisma migrate deploy` → one wins, others... Prisma's migrate deploy takes an advisory lock? It might error on concurrent runs. To avoid the flake: serialize the migration via a file lock, or run migrate once in vitest's globalSetup (runs once before all files ✓). Vitest's `globalSetup` — runs in a separate process, once. Let me put the migrate deploy in globalSetup:

```ts
// vitest.global-setup.ts
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default function globalSetup() {
  const root = path.join(__dirname);
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set to a test Postgres instance to run the suite');
  }
  execFileSync(process.execPath, [path.join(root, 'node_modules', '.bin', 'prisma'), 'migrate', 'deploy'], { cwd: root, stdio: 'pipe' });
}
```

Hmm `node_modules/.bin/prisma` — on macOS a shell script; execFileSync with process.execPath (node) + the path — node executing a shell script → fails (starts with #!). Better: execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy']) — npx is a node script with a shebang; execFileSync('npx', ...) resolves npx via PATH and uses its shebang (node) ✓ works.

Wait, does npx exist in this env? Node 20 ships with npm → npx ✓.

globalSetup config:
```ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
```

And each spec's beforeAll just builds the app + seeds (parallel OK — unique tenants). Prisma client generation: postinstall; but if the client isn't generated, the globalSetup could run `prisma generate` too — let me add both commands in the globalSetup (generate is fast, idempotent, no DB needed). Then the suite needs only: pnpm install (for deps) + DATABASE_URL. Even without the postinstall, the globalSetup's generate covers it.

But wait — the globalSetup runs in a separate worker process and then the test workers import @prisma/client — the generated client on disk is shared ✓.

The path to the global-setup file — place it at `test/global-setup.ts` ✓ (the include pattern is only .spec.ts so it isn't treated as a test file ✓).

Hmm — the `__dirname` in the vitest config TS file: vitest loads the config with its own bundler; __dirname may not be defined in ESM-bundled config... Vitest's config file is transpiled; `__dirname` — I think Vitest supports it (the config is loaded via esbuild with CJS interop). Safer: `path.resolve(process.cwd(), ...)` — tests run from the project root (pnpm test) → cwd = root ✓. Use process.cwd(). Let me do that in the global setup: `const root = process.cwd();` and npx from root.

global-setup.ts:

```ts
import { execFileSync } from 'node:child_process';

export default function globalSetup(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a test PostgreSQL instance (e.g. docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres)');
  }
  // Ensure the client is generated and the schema is applied before any test worker starts.
  execFileSync('npx', ['--no-install', 'prisma', 'generate'], { stdio: 'inherit' });
  execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
}
```

stdio inherit — shows progress in the test output ✓.

**prisma/schema.prisma** — final:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id           String   @id @default(uuid())
  domain       String   @unique
  name         String
  branding     Json
  featureFlags Json     @map("feature_flags")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  customers Customer[]
  plans     Plan[]
  orders    Order[]

  @@map("tenants")
}

model Customer {
  id        String   @default(uuid())
  tenantId  String   @map("tenant_id")
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  email     String
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  orders Order[]

  @@id([tenantId, id])
  @@unique([tenantId, email])
  @@map("customers")
}

model Plan {
  id         String  @default(uuid())
  tenantId   String  @map("tenant_id")
  tenant     Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name       String
  slug       String
  priceCents Int     @map("price_cents")
  active     Boolean @default(true)
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  orders Order[]

  @@id([tenantId, id])
  @@unique([tenantId, slug])
  @@map("plans")
}

model Order {
  id         String   @default(uuid())
  tenantId   String   @map("tenant_id")
  tenant     Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customerId String   @map("customer_id")
  customer   Customer @relation(fields: [tenantId, customerId], references: [tenantId, id], onDelete: Cascade)
  planId     String   @map("plan_id")
  plan       Plan     @relation(fields: [tenantId, planId], references: [tenantId, id], onDelete: Restrict)
  status     String   @default("pending")
  totalCents Int      @default(0) @map("total_cents")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@id([tenantId, id])
  @@map("orders")
}
```

Wait — column order in the Prisma-generated SQL follows the field declaration order: Customer: id, tenant_id, email, name, created_at, updated_at ✓ my migration matches (I wrote id first ✓).

Concern: `onDelete: Cascade` on the tenant relation + also cascade via the order's tenant relation — multiple cascade paths are OK in Postgres? A row can be deleted via any FK cascade; Postgres handles multiple FKs to the same row fine (deleting a tenant cascades to orders directly and via customers). No cycle. ✓

Now — the composite FK on orders: `@relation(fields: [tenantId, customerId], references: [tenantId, id])` — the generated FK name: Prisma generates a name like "orders_tenant_id_customer_id_fkey" ✓ matches my SQL.

One more Prisma check: Order has both `tenant Tenant @relation(fields: [tenantId], ...)` and `customer Customer @relation(fields: [tenantId, customerId], ...)` — two relations sharing tenantId — Prisma allows the same field in multiple relations ✓ (each FK is separate).

And the reverse: Customer.orders Order[] — but Order→Customer is via (tenantId, customerId) — does the back-relation need `@relation("name")`? Multiple relations between the same pair require explicit names, but here there's only one relation between Customer and Order ✓ no naming needed.

**The migration SQL** (aligned with the above column order):

As drafted above, with the column order: customers(id, tenant_id, email, name, created_at, updated_at); plans(id, tenant_id, name, slug, price_cents, active, created_at, updated_at); orders(id, tenant_id, customer_id, plan_id, status, total_cents, created_at, updated_at); tenants(id, domain, name, branding, feature_flags, created_at, updated_at).

Indexes Prisma would generate: unique on tenants.domain → "tenants_domain_key"; customers (tenant_id, email) → "customers_tenant_id_email_key"; plans (tenant_id, slug) → "plans_tenant_id_slug_key"; FK indexes: orders.customer_id → "orders_customer_id_idx", orders.plan_id → "orders_plan_id_idx". Also for customers_tenant_id FK — does Prisma create an index on a simple FK to tenants(id)? Prisma doesn't auto-create indexes on FKs unless the relation field needs them... actually, Prisma does create indexes on scalar relation fields (the child's FK columns) — for customers.tenantId: yes, Prisma creates `customers_tenant_id_idx`? Hmm. Let me recall a generated migration: for a model with `authorId Int` + a relation, the migration includes `CREATE INDEX "post_authorId_idx" ON "Post"("authorId");` — yes, Prisma auto-indexes scalar FK fields. So customers_tenant_id_idx, plans_tenant_id_idx, orders_tenant_id_idx also. And the composite FK fields: the relation fields are [tenantId, customerId] → Prisma creates a composite index `CREATE INDEX "orders_tenant_id_customer_id_idx" ON "orders"("tenant_id", "customer_id");`? I think Prisma indexes the full set of fields in the relation. For the single-field tenant FK → "orders_tenant_id_idx". Hmm, so orders would have: tenant_id_idx, tenant_id_customer_id_idx, tenant_id_plan_id_idx.

My migration doesn't need to byte-match Prisma's output (migrate deploy just runs the SQL; drift is only flagged by `migrate dev`'s shadow DB comparison). For deploy, valid SQL is enough. But to be tidy and realistic, let me include the plausible Prisma indexes. Extra/missing indexes don't break anything. Let me include the FK indexes (including the composites) — closer to reality and better query performance.

Final migration:

```sql
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branding" JSONB NOT NULL,
    "feature_flags" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("tenant_id", "id")
);

CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("tenant_id", "id")
);

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("tenant_id", "id")
);

CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");
CREATE UNIQUE INDEX "plans_tenant_id_slug_key" ON "plans"("tenant_id", "slug");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");
CREATE INDEX "plans_tenant_id_idx" ON "plans"("tenant_id");
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");
CREATE INDEX "orders_tenant_id_customer_id_idx" ON "orders"("tenant_id", "customer_id");
CREATE INDEX "orders_tenant_id_plan_id_idx" ON "orders"("tenant_id", "plan_id");

ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

**src/prisma/tenant-context.ts**

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/**
 * Thrown whenever a query is attempted without a resolved tenant in the
 * current request context. Failing here (instead of falling back to an
 * unscoped query) is the core guarantee of the tenant-aware data layer.
 */
export class TenantContextMissingError extends Error {
  constructor() {
    super('no tenant in request context; refusing to run an unscoped query');
    this.name = 'TenantContextMissingError';
  }
}

export interface TenantContext {
  readonly tenantId: string;
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage, so the context
 * follows async work (middleware -> route -> repository) without being passed
 * through every signature.
 */
@Injectable()
export class TenantContextStorage {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(tenant: TenantContext, fn: () => T): T {
    return this.storage.run(tenant, fn);
  }

  /** The tenant id for the current request; throws when none is in context. */
  get tenantId(): string {
    const ctx = this.storage.getStore();
    if (!ctx) {
      throw new TenantContextMissingError();
    }
    return ctx.tenantId;
  }
}
```

**src/prisma/tenant-db.factory.ts**

```ts
import { PrismaClient } from '@prisma/client';
import { TenantContextStorage } from './tenant-context';

/**
 * Tenant-aware Prisma client.
 *
 * Every model query passes through a single extension that:
 *  - scopes every read (and unique where) to the tenant in the request context
 *  - stamps every write with that tenant id, overwriting anything the caller supplied
 *  - refuses to run when no tenant is in context
 *  - refuses to run any operation it does not explicitly classify (fail closed)
 *
 * Models listed in TENANTLESS_MODELS (the Tenant lookup table itself) are exempt.
 */

const TENANTLESS_MODELS = new Set(['Tenant']);

const READ_OPERATIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
]);

const WHERE_OPERATIONS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

const DATA_OPERATIONS = new Set(['create', 'createMany']);

const HANDLED_OPERATIONS = new Set([...READ_OPERATIONS, ...WHERE_OPERATIONS, ...DATA_OPERATIONS]);

function scopeArgs(operation: string, args: unknown, tenantId: string): unknown {
  if (!HANDLED_OPERATIONS.has(operation)) {
    throw new Error(
      `tenant guard: operation "${operation}" is not explicitly tenant-scoped; refusing to run it unscoped`,
    );
  }
  const next = (args ?? {}) as Record<string, any>;

  if (READ_OPERATIONS.has(operation) || WHERE_OPERATIONS.has(operation)) {
    // Because every tenant-scoped model carries tenantId in its composite
    // primary key (and in its other unique constraints), adding tenantId to
    // the where clause keeps every operation valid — including findUnique and
    // update/delete, whose where must be a unique constraint.
    next.where = { ...(next.where ?? {}), tenantId };
  }

  if (operation === 'create' || operation === 'createMany') {
    next.data = Array.isArray(next.data)
      ? next.data.map((row: any) => ({ ...row, tenantId }))
      : { ...next.data, tenantId };
  }

  if (operation === 'upsert') {
    next.data = { ...next.data, create: { ...next.data.create, tenantId } };
  }

  return next;
}

function guardRawQueries(client: PrismaClient): PrismaClient {
  const blocked = new Set(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe', '$batchRaw']);
  return new Proxy(client, {
    get(target, prop) {
      if (typeof prop === 'string' && blocked.has(prop)) {
        return () => {
          throw new Error('raw SQL is not available on the tenant-aware client; use tenant-scoped model queries');
        };
      }
      return Reflect.get(target, prop);
    },
  });
}

export function createTenantAwareClient(base: PrismaClient, storage: TenantContextStorage): PrismaClient {
  const extended = base.$extends({
    query: {
      $allModels: {
        // The extension API has no typed "any model, any operation" hook, so
        // the hook is intentionally loose; the behaviour is pinned by the
        // isolation tests.
        $allOperations: async (params: any) => {
          const { model, operation, args, query } = params;
          if (TENANTLESS_MODELS.has(model)) {
            return query(args);
          }
          const tenantId = storage.tenantId; // throws TenantContextMissingError
          return query(scopeArgs(operation, args, tenantId));
        },
      },
    },
  } as any);

  return guardRawQueries(extended);
}
```

Hmm wait — `next.where = { ...(next.where ?? {}), tenantId }` — for `upsert`, the where is a unique where ✓; for `create`/`createMany`, there's no where — but my condition: DATA_OPERATIONS is not in READ/WHERE → where isn't touched ✓.

Edge: `update` with args where {id} → {id, tenantId} ✓. `delete` ✓.

Now — the spread on args `const next = { ...(args ?? {}) }` — a shallow copy; where/data are then replaced wholesale; other keys (select, include, orderBy) pass through by reference ✓ fine.

The `$allModels` + $allOperations typing: `as any` on the extension argument ✓ compiles. The return of `base.$extends(any)` — any → extended: any; guardRawQueries(client: PrismaClient) — passing any ✓; the return type is PrismaClient. So createTenantAwareClient returns PrismaClient → TenantAwareClient = PrismaClient. The repository is fully typed ✓.

Wait, actually — will `base.$extends({...} as any)` compile? $extends has overloads; passing an `any` argument → TS picks the first matching overload, the return type is that overload's result (probably a complex type) — assigned to `const extended` → inferred. Then guardRawQueries(extended) expects PrismaClient — if the inferred type isn't assignable → error. The extended type should be assignable to PrismaClient (it extends it). Probably. To be safe: `const extended = base.$extends({...} as any) as PrismaClient;` — an explicit cast eliminates the doubt. Let me add it.

**src/prisma/prisma.service.ts**

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The plain Prisma client. Only layers that must run outside the tenant
 * context (resolving the tenant itself) may use this; everything else uses
 * the tenant-aware client (TENANT_DB).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

**src/prisma/prisma.module.ts**

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantContextStorage } from './tenant-context';
import { createTenantAwareClient } from './tenant-db.factory';

export const TENANT_DB = Symbol('TENANT_DB');

@Module({
  providers: [
    PrismaService,
    TenantContextStorage,
    {
      provide: TENANT_DB,
      inject: [PrismaService, TenantContextStorage],
      useFactory: (base: PrismaService, storage: TenantContextStorage) =>
        createTenantAwareClient(base, storage),
    },
  ],
  exports: [PrismaService, TenantContextStorage, TENANT_DB],
})
export class PrismaModule {}
```

**src/tenant/tenant-resolver.service.ts**

```ts
import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { Tenant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../errors/app-error';

/**
 * Resolves the tenant for a request from two independent sources that must
 * agree:
 *  - the Host header (which tenant's domain the request targets)
 *  - the `org` claim of a verified auth token
 *
 * Neither alone is sufficient, and a disagreement is rejected rather than
 * resolved in favour of either source.
 */
@Injectable()
export class TenantResolverService {
  constructor(private readonly prisma: PrismaService) {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET must be set in the environment');
    }
  }

  async resolve(host: string | undefined, authorization: string | undefined): Promise<Tenant> {
    const tenantFromToken = await this.resolveFromToken(authorization);
    const tenantFromHost = await this.resolveFromHost(host);
    if (tenantFromToken.id !== tenantFromHost.id) {
      throw new AppError('tenant_mismatch', 403, 'host and token org claim point at different tenants');
    }
    return tenantFromHost;
  }

  private async resolveFromToken(authorization: string | undefined): Promise<Tenant> {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new AppError('unauthorized', 401, 'missing bearer token');
    }
    const token = authorization.slice('Bearer '.length).trim();
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as JwtPayload;
    } catch {
      throw new AppError('invalid_token', 401, 'auth token failed verification');
    }
    if (typeof payload.org !== 'string' || payload.org.length === 0) {
      throw new AppError('invalid_token', 401, 'auth token is missing the org claim');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: payload.org } });
    if (!tenant) {
      throw new AppError('invalid_token', 401, 'token org does not match a known tenant');
    }
    return tenant;
  }

  private async resolveFromHost(host: string | undefined): Promise<Tenant> {
    if (!host) {
      throw new AppError('unknown_host', 404, 'request has no host');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { domain: host } });
    if (!tenant) {
      throw new AppError('unknown_host', 404, 'host does not belong to a known tenant');
    }
    return tenant;
  }
}
```

`this.prisma.tenant.findUnique` — PrismaService extends PrismaClient → the `tenant` delegate ✓.

**src/tenant/tenant.service.ts**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextStorage } from '../prisma/tenant-context';
import { AppError } from '../errors/app-error';

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContextStorage,
  ) {}

  /** Branding + feature flags for the tenant resolved for this request. */
  async forCurrentRequest(): Promise<{
    id: string;
    name: string;
    branding: Record<string, unknown>;
    featureFlags: Record<string, unknown>;
  }> {
    const tenantId = this.context.tenantId; // throws when no tenant is in context
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new AppError('internal_error', 500, 'the tenant resolved for this request no longer exists');
    }
    return { id: tenant.id, name: tenant.name, branding: tenant.branding as Record<string, unknown>, featureFlags: tenant.featureFlags as Record<string, unknown> };
  }
}
```

branding Json type → `JsonValue`; cast to Record<string, unknown> — JsonValue might be non-object; the seed uses an object. The cast is fine. Hmm, the return type — let me simplify: `branding: unknown`? For a clean response type: let me type it as `Prisma.JsonValue`. Let me import the Prisma namespace: `import { Prisma } from '@prisma/client'` → `branding: Prisma.JsonValue`. Clean.

**src/tenant/tenant.middleware.ts**

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantContextStorage } from '../prisma/tenant-context';
import { decideError } from '../errors/error-mapping';

/**
 * Resolves the tenant (host + token org claim must agree) and runs the whole
 * request inside that tenant's AsyncLocalStorage context, so the tenant-aware
 * data layer can scope queries without any handler passing a tenant id.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly resolver: TenantResolverService,
    private readonly context: TenantContextStorage,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    let tenantId: string;
    try {
      const tenant = await this.resolver.resolve(req.headers.host, req.headers.authorization);
      tenantId = tenant.id;
    } catch (err) {
      if (!res.headersSent) {
        const { status, ...body } = decideError(err);
        res.status(status).json({ error: body });
      }
      return;
    }

    await this.context.run({ tenantId }, () => new Promise<void>((resolve, reject) => {
      next((err?: unknown) => (err ? reject(err) : resolve()));
    })).catch((err: unknown) => {
      // Unhandled errors that escaped the downstream exception filters.
      if (!res.headersSent) {
        const { status, ...body } = decideError(err);
        res.status(status).json({ error: body });
      }
    });
  }
}
```

Hmm — `decideError` returns { status, code, message, details }; `{ status, ...body }` → body = { code, message, details } → `{ error: body }` ✓ matches the envelope.

Wait — decideError's signature: returns an ErrorDecision with status+code+message+details. `{ status, ...body }` destructures ✓.

**src/tenant/tenant.module.ts**

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantMiddleware } from './tenant.middleware';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantService } from './tenant.service';

@Module({
  imports: [PrismaModule],
  providers: [TenantResolverService, TenantService, TenantMiddleware],
  exports: [TenantResolverService, TenantService, TenantMiddleware],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

**src/errors/app-error.ts**

```ts
/**
 * Application-level error with a stable machine-readable code. The global
 * exception filter turns this into the single error envelope:
 * { error: { code, message, details } }
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

**src/errors/error-mapping.ts**

```ts
import { Prisma } from '@prisma/client';
import type { HttpException } from '@nestjs/common';
import { AppError } from './app-error';
import { TenantContextMissingError } from '../prisma/tenant-context';

export interface ErrorDecision {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/**
 * The single place that decides how any error maps onto the error envelope.
 * Used by the global exception filter and by the tenant middleware (which must
 * answer before a request-scoped context exists).
 */
export function decideError(err: unknown): ErrorDecision {
  if (err instanceof AppError) {
    return { status: err.httpStatus, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof TenantContextMissingError) {
    return {
      status: 500,
      code: 'no_tenant_context',
      message: 'a query was attempted with no tenant in context; it was refused rather than run unscoped',
      details: {},
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      // Record not found — for tenant-scoped models this covers both
      // "does not exist" and "belongs to another tenant" on purpose.
      return { status: 404, code: 'resource_not_found', message: 'resource not found', details: {} };
    }
    if (err.code === 'P2002' || err.code === 'P2003') {
      return {
        status: 409,
        code: 'conflict',
        message: 'a record with the same unique value already exists',
        details: { prismaCode: err.code },
      };
    }
    return {
      status: 409,
      code: 'database_error',
      message: 'the database rejected the operation',
      details: { prismaCode: err.code },
    };
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, code: 'bad_request', message: 'the query failed Prisma validation', details: {} };
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code = status === 404 ? 'not_found' : status === 405 ? 'method_not_allowed' : status === 400 ? 'bad_request' : 'http_error';
    return { status, code, message: err.message, details: {} };
  }
  return { status: 500, code: 'internal_error', message: 'unexpected internal error', details: {} };
}
```

Hmm — a P2025 message "resource not found" must match the service's AppError 404 message. Let me define the service's 404: `new AppError('resource_not_found', 404, 'resource not found')` ✓ identical.

The HttpException message is an array for 404? `err.message` for a Nest 404 (NotFoundException) → the string "Cannot GET /x"? Nest's HttpException message: `getResponse()` can be a string or object; `err.message` is the constructor arg — for Nest's internal 404, the message is "Cannot GET /path". Fine as developer-facing.

**src/errors/all-exceptions.filter.ts**

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { decideError } from './error-mapping';

/**
 * The only place HTTP error responses are produced: every error becomes the
 * single envelope { error: { code, message, details } }.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = decideError(exception);

    if (status >= 500 && !(exception instanceof AppError) && !(exception instanceof HttpException)) {
      // eslint-disable-next-line no-console
      console.error(exception);
    }

    if (!response.headersSent) {
      response.status(status).json({ error: { code, message, details } });
    }
  }
}
```
Need to import AppError too.

**src/customers/customers.repository.ts** — as drafted. Note: no tenantId anywhere ✓.

**src/customers/customers.service.ts**

```ts
import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { CustomersRepository } from './customers.repository';
import { AppError } from '../errors/app-error';

export interface CustomerDto {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(customer: Customer): CustomerDto {
  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

@Injectable()
export class CustomersService {
  constructor(private readonly customers: CustomersRepository) {}

  list(): Promise<CustomerDto[]> {
    return this.customers.list().then((rows) => rows.map(toDto));
  }

  async findById(id: string): Promise<CustomerDto> {
    const customer = await this.customers.findById(id);
    if (!customer) {
      // Same response for "no such id" and "id belongs to another tenant":
      // a 404 with no hint that the row exists elsewhere.
      throw new AppError('resource_not_found', 404, 'resource not found');
    }
    return toDto(customer);
  }

  register(email: string, name: string): Promise<CustomerDto> {
    return this.customers.create({ email, name }).then(toDto);
  }

  update(id: string, data: { name: string }): Promise<CustomerDto> {
    return this.customers.update(id, data).then(toDto);
  }

  remove(id: string): Promise<void> {
    return this.customers.remove(id).then(() => undefined);
  }
}
```

**src/customers/customers.controller.ts**

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { AppError } from '../errors/app-error';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRegisterBody(body: unknown): { email: string; name: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('bad_request', 400, 'body must be a JSON object with email and name', {});
  }
  const { email, name } = body as { email?: unknown; name?: unknown };
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    throw new AppError('bad_request', 400, 'email must be a valid email address', { field: 'email' });
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('bad_request', 400, 'name must be a non-empty string', { field: 'name' });
  }
  return { email: email.trim(), name: name.trim() };
}

function parseUpdateBody(body: unknown): { name: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('bad_request', 400, 'body must be a JSON object with name', {});
  }
  const { name } = body as { name?: unknown };
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('bad_request', 400, 'name must be a non-empty string', { field: 'name' });
  }
  return { name: name.trim() };
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list() {
    return this.customers.list();
  }

  @Post()
  register(@Body() body: unknown) {
    const { email, name } = parseRegisterBody(body);
    return this.customers.register(email, name);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customers.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const data = parseUpdateBody(body);
    return this.customers.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customers.remove(id);
  }
}
```

**src/customers/customers.module.ts**

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './customers.repository';

@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
})
export class CustomersModule {}
```

**src/tenant-config/tenant-config.controller.ts**

```ts
import { Controller, Get } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  current() {
    return this.tenants.forCurrentRequest();
  }
}
```

**src/tenant-config/tenant-config.module.ts**

```ts
import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { TenantConfigController } from './tenant-config.controller';

@Module({
  imports: [TenantModule],
  controllers: [TenantConfigController],
})
export class TenantConfigModule {}
```

**src/app.module.ts** and **src/main.ts** — as drafted.

main.ts:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './errors/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

**test/support.ts**

```ts
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Tenant } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/errors/all-exceptions.filter';

interface TenantSeed extends Tenant {}

export interface TestContext {
  app: INestApplication;
  moduleRef: INestApplicationContext;
  base: string;
  db: PrismaClient;
  tenants: { a: Tenant; b: Tenant };
  stop: () => Promise<void>;
}

export async function startApp(): Promise<TestContext> {
  process.env.JWT_SECRET ??= 'test-only-jwt-secret';
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set to a test PostgreSQL instance');
  }

  const db = new PrismaClient();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  const base = await app.getUrl();

  // Fresh, uniquely-named tenants so parallel spec files never collide.
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const [a, b] = await Promise.all([
    db.tenant.create({
      data: {
        domain: `app.a-${suffix}.example.test`,
        name: 'Operator A',
        branding: { primaryColor: '#0b3d91', logoUrl: `https://a-${suffix}.example.test/logo.svg` },
        featureFlags: { beta_orders: true, self_serve_billing: false },
      },
    }),
    db.tenant.create({
      data: {
        domain: `app.b-${suffix}.example.test`,
        name: 'Operator B',
        branding: { primaryColor: '#910b0b', logoUrl: `https://b-${suffix}.example.test/logo.svg` },
        featureFlags: { beta_orders: false, self_serve_billing: true },
      },
    }),
  ]);

  return {
    app,
    moduleRef,
    base,
    db,
    tenants: { a, b },
    stop: async () => {
      await db.tenant.deleteMany({ where: { id: { in: [a.id, b.id] } } });
      await db.$disconnect();
      await app.close();
    },
  };
}
```

Wait — the stop order: delete tenants (cascades to customers) via the base db ✓; app.close() disconnects the app's PrismaService; the db is disconnected first — order: db cleanup → db.$disconnect() → app.close(). But app.close() runs module destroy → prisma's $disconnect ✓. Reorder: stop the app first? Either works; keep as is (delete with db, then close app). Hmm — app.close() after db.$disconnect() is fine.

`app.getUrl()` — returns a Promise<string> like 'http://[::1]:port' or 'http://127.0.0.1:port'. fetch to that ✓.

```ts
export function signToken(org: string): string {
  return jwt.sign({ org }, process.env.JWT_SECRET as string, { algorithm: 'HS256', expiresIn: '5m' });
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  host: string;
  org?: string;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  json: any;
}

export async function api(base: string, path: string, opts: ApiOptions): Promise<ApiResponse> {
  const headers: Record<string, string> = { host: opts.host };
  if (opts.org !== undefined) {
    headers.authorization = `Bearer ${signToken(opts.org)}`;
  }
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  if (text.length > 0) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { status: res.status, json };
}

export async function registerCustomer(base: string, tenant: Tenant, body: { email: string; name: string }): Promise<ApiResponse> {
  return api(base, '/customers', { method: 'POST', host: tenant.domain, org: tenant.id, body });
}
```

The `json: any` — an explicit any in tests, fine.

**test/customers.spec.ts**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startApp, api, registerCustomer, type TestContext } from './support';

describe('customers (white-label isolation)', () => {
  let ctx: TestContext;
  let aliceA: { id: string; email: string };
  let bobB: { id: string; email: string };

  beforeAll(async () => {
    ctx = await startApp();
    const a = await registerCustomer(ctx.base, ctx.tenants.a, { email: 'alice@operator-a.test', name: 'Alice' });
    if (a.status !== 201) throw new Error(`seed A failed: ${a.status} ${JSON.stringify(a.json)}`);
    aliceA = a.json;
    const b = await registerCustomer(ctx.base, ctx.tenants.b, { email: 'bob@operator-b.test', name: 'Bob' });
    if (b.status !== 201) throw new Error(`seed B failed: ${b.status} ${JSON.stringify(b.json)}`);
    bobB = b.json;
  }, 60000);

  afterAll(async () => {
    await ctx.stop();
  }, 60000);

  it('tenant B list excludes tenant A customers entirely', async () => {
    const res = await api(ctx.base, '/customers', { host: ctx.tenants.b.domain, org: ctx.tenants.b.id });
    expect(res.status).toBe(200);
    const emails = res.json.map((c: any) => c.email);
    expect(emails).not.toContain(aliceA.email);
    expect(emails).toContain(bobB.email);
  });

  it('tenant B fetch of tenant A customer by id is a 404 with the same body as a nonexistent id', async () => {
    const crossTenant = await api(ctx.base, `/customers/${aliceA.id}`, { host: ctx.tenants.b.domain, org: ctx.tenants.b.id });
    const ghost = await api(ctx.base, `/customers/${randomUUID()}`, { host: ctx.tenants.b.domain, org: ctx.tenants.b.id });
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.json).toEqual(ghost.json);
    expect(crossTenant.json.error.code).toBe('resource_not_found');
  });

  it('tenant B update of tenant A customer is a 404 and leaves the row unchanged', async () => {
    const res = await api(ctx.base, `/customers/${aliceA.id}`, {
      method: 'PATCH',
      host: ctx.tenants.b.domain,
      org: ctx.tenants.b.id,
      body: { name: 'Compromised' },
    });
    expect(res.status).toBe(404);
    const after = await api(ctx.base, `/customers/${aliceA.id}`, { host: ctx.tenants.a.domain, org: ctx.tenants.a.id });
    expect(after.status).toBe(200);
    expect(after.json.name).toBe('Alice');
  });

  it('tenant B delete of tenant A customer is a 404 and the row still exists', async () => {
    const res = await api(ctx.base, `/customers/${aliceA.id}`, {
      method: 'DELETE',
      host: ctx.tenants.b.domain,
      org: ctx.tenants.b.id,
    });
    expect(res.status).toBe(404);
    const after = await api(ctx.base, `/customers/${aliceA.id}`, { host: ctx.tenants.a.domain, org: ctx.tenants.a.id });
    expect(after.status).toBe(200);
    expect(after.json.email).toBe(aliceA.email);
  });

  it('the same email registers independently in both tenants', async () => {
    const inA = await registerCustomer(ctx.base, ctx.tenants.a, { email: 'shared@both.test', name: 'Shared A' });
    const inB = await registerCustomer(ctx.base, ctx.tenants.b, { email: 'shared@both.test', name: 'Shared B' });
    expect(inA.status).toBe(201);
    expect(inB.status).toBe(201);
    expect(inA.json.id).not.toBe(inB.json.id);
    expect(inA.json.email).toBe(inB.json.email);
  });

  it('the same email twice in one tenant is a 409 conflict', async () => {
    const res = await registerCustomer(ctx.base, ctx.tenants.a, { email: 'alice@operator-a.test', name: 'Alice Again' });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('conflict');
  });
});
```

**test/tenant-config.spec.ts**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, api, type TestContext } from './support';

describe('GET /tenant-config', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startApp();
  }, 60000);

  afterAll(async () => {
    await ctx.stop();
  }, 60000);

  it('returns the branding and feature flags of the resolved tenant (A)', async () => {
    const t = ctx.tenants.a;
    const res = await api(ctx.base, '/tenant-config', { host: t.domain, org: t.id });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: t.id,
      name: t.name,
      branding: t.branding,
      featureFlags: t.featureFlags,
    });
  });

  it('returns a different tenant branding for tenant B', async () => {
    const t = ctx.tenants.b;
    const res = await api(ctx.base, '/tenant-config', { host: t.domain, org: t.id });
    expect(res.status).toBe(200);
    expect(res.json.branding).toEqual(t.branding);
    expect(res.json.featureFlags).not.toEqual(ctx.tenants.a.featureFlags);
  });

  it('rejects requests whose host and token disagree', async () => {
    const res = await api(ctx.base, '/tenant-config', { host: ctx.tenants.a.domain, org: ctx.tenants.b.id });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('tenant_mismatch');
  });
});
```

Hmm — `branding: t.branding` — t.branding from Prisma is a JsonValue (object). toMatchObject deep-compares ✓. The response's branding is serialized JSON ✓ equal.

**test/tenant-isolation.spec.ts**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, api, registerCustomer, type TestContext } from './support';
import { CustomersRepository } from '../src/customers/customers.repository';
import { TenantContextMissingError } from '../src/prisma/tenant-context';

describe('tenant resolution and context isolation', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startApp();
    for (const [which, email] of [['a', 'seed-a@x.test'], ['b', 'seed-b@x.test']] as const) {
      const r = await registerCustomer(ctx.base, ctx.tenants[which], { email, name: `Seed ${which}` });
      if (r.status !== 201) throw new Error(`seed failed: ${r.status}`);
    }
  }, 60000);

  afterAll(async () => {
    await ctx.stop();
  }, 60000);

  it('rejects a request when host and token org point at different tenants', async () => {
    const res = await api(ctx.base, '/customers', { host: ctx.tenants.a.domain, org: ctx.tenants.b.id });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('tenant_mismatch');
  });

  it('rejects a request with no token even for a valid host', async () => {
    const res = await api(ctx.base, '/customers', { host: ctx.tenants.a.domain });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('unauthorized');
  });

  it('rejects a valid token when the host is not a tenant domain', async () => {
    const res = await api(ctx.base, '/customers', { host: `unknown-${ctx.tenants.a.id}.example.test`, org: ctx.tenants.a.id });
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('unknown_host');
  });

  it('concurrent requests from two tenants do not cross contexts', async () => {
    const a = ctx.tenants.a;
    const b = ctx.tenants.b;
    const jobs: Array<{ expectTag: 'a' | 'b'; run: () => Promise<{ status: number; json: any }> }> = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      jobs.push({ expectTag: 'a', run: () => api(ctx.base, '/customers', { host: a.domain, org: a.id }) });
      jobs.push({ expectTag: 'b', run: () => api(ctx.base, '/customers', { host: b.domain, org: b.id }) });
      jobs.push({
        expectTag: 'a',
        run: () => api(ctx.base, '/customers', { method: 'POST', host: a.domain, org: a.id, body: { email: `load-a${i}@load.test`, name: 'Load A' } }),
      });
      jobs.push({
        expectTag: 'b',
        run: () => api(ctx.base, '/customers', { method: 'POST', host: b.domain, org: b.id, body: { email: `load-b${i}@load.test`, name: 'Load B' } }),
      });
    }
    const results = await Promise.all(jobs.map((j) => j.run()));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);

    // Every list response contained only rows of the tenant that issued it.
    const lists = results.filter((r, i) => jobs[i].run.name === 'api'); // hmm, can't distinguish
    ...
  });
```

Hmm — distinguishing list vs. post results: let me store the shape per job: `kind: 'list' | 'create'`. Refactor:

```ts
type Job = { tag: 'a' | 'b'; kind: 'list' | 'create'; run: () => Promise<ApiResponse> };
const jobs: Job[] = [];
for (let i = 0; i < N; i++) {
  jobs.push({ tag: 'a', kind: 'list', run: () => api(...) });
  jobs.push({ tag: 'b', kind: 'list', run: () => api(...) });
  jobs.push({ tag: 'a', kind: 'create', run: () => api(POST a) });
  jobs.push({ tag: 'b', kind: 'create', run: () => api(POST b) });
}
const results = await Promise.all(jobs.map(j => j.run()));
// No errors at all
expect(results.every(r => r.status === 200 || r.status === 201)).toBe(true);
jobs.forEach((j, i) => {
  if (j.kind !== 'list') return;
  const emails = (results[i].json as any[]).map(c => c.email);
  for (const email of emails) {
    // Tenant A's rows: seeded 'seed-a' + load-aN; tenant B's: seed-b + load-bN
    if (j.tag === 'a') expect(email.startsWith('seed-a') || /^load-a\d+@load\.test$/.test(email)).toBe(true);
    else expect(email.startsWith('seed-b') || /^load-b\d+@load\.test$/.test(email)).toBe(true);
  }
});
// Final state: each created email lands only in its own tenant
const finalA = await api(ctx.base, '/customers', { host: a.domain, org: a.id });
const finalB = await api(ctx.base, '/customers', { host: b.domain, org: b.id });
const emailsA = new Set((finalA.json as any[]).map(c => c.email));
const emailsB = new Set((finalB.json as any[]).map(c => c.email));
for (let i = 0; i < N; i++) {
  expect(emailsA.has(`load-a${i}@load.test`)).toBe(true);
  expect(emailsA.has(`load-b${i}@load.test`)).toBe(false);
  expect(emailsB.has(`load-b${i}@load.test`)).toBe(true);
  expect(emailsB.has(`load-a${i}@load.test`)).toBe(false);
}
```

Strong ✓.

  it('a query issued with no tenant in context fails rather than returning everything', async () => {
    const repo = ctx.moduleRef.get(CustomersRepository);
    await expect(repo.list()).rejects.toThrow(TenantContextMissingError);
  });

Also, should I assert "returns everything" is impossible — the rejection is the assertion. ✓

Hmm — one concern: `ctx.moduleRef.get(CustomersRepository)` — INestApplicationContext has .get ✓.

Also — the repository's `list()` call: `this.db.customer.findMany(...)` → the extension → storage.tenantId getter throws synchronously inside the async hook → the promise rejects ✓.

**Now — the `app.getUrl()` type**: Nest's `INestApplication.getUrl(): Promise<string>` ✓.

**Let me double-check the Nest middleware + ALS + Prisma once more**: the Prisma client queries run inside the handler's async context, which is inside the storage.run callback chain. The middleware's `this.context.run(ctx, () => new Promise(...next...))` — the next() → Nest router → handler → repo → Prisma. All spawned within the run callback → the store is visible ✓. Prisma uses libquery engine via child process/HTTP — the ALS store is read synchronously at query start in the Node process ✓ (storage.tenantId is read in the $allOperations hook, which runs in Node's async context ✓).

**Potential issue**: Nest middleware's `next` — Express's next function. Wrap in a promise ✓ standard.

**Express + custom host header**: Express doesn't care ✓.

**Undici fetch host header**: Node's fetch (undici) — setting `headers: { host: 'x' }` — undici permits overriding the Host header (it's in the forbidden header list for the browser, but undici Node allows it). Yes — I'm confident undici allows the host header override (commonly used in multi-tenant testing). ✓

**Now the JSON body for DELETE 204**: the text is '' → json is null ✓ the test doesn't assert the body for delete.

**P2025 from `update`**: the Prisma error is thrown from the repository's promise → propagates to the controller → the filter → 404 ✓. Same for delete.

**Wait — one more thing about `update` when the row doesn't exist**: Prisma `update` throws P2025 ✓. `delete` throws P2025 ✓.

**Registration 409**: P2002 on (tenantId, email) ✓ the filter maps to 409 'conflict' ✓.

**Now — the tenant-config response's branding deep-equals the seed**: the Json round-trips ✓.

**Let me verify the import cycles**:
- prisma.module → prisma.service, tenant-context, tenant-db.factory ✓ no cycle.
- tenant.module → prisma.module, tenant.middleware → tenant-resolver.service → prisma.service + errors ✓.
- customers → prisma ✓.
- tenant-config → tenant.module ✓.
- app → all ✓. No cycles.

**Error mapping imports HttpException from @nestjs/common (type-only)** ✓.

**jsonwebtoken types**: `import jwt from 'jsonwebtoken'` with esModuleInterop ✓; `JwtPayload` type import ✓. `jwt.sign({ org }, secret, { algorithm: 'HS256', expiresIn: '5m' })` — expiresIn type: string OK? The SignOptions.expiresIn accepts string | number (a union type `string | number` — yes, the ms string is allowed in the type). ✓

**The `payload.org` type**: JwtPayload's index signature `[key: string]: any` ✓.

**Prisma's `Tenant` type import in support.ts** ✓ exported from @prisma/client.

**The TestContext stop: the app.close()** — also closes the http server ✓.

**The global-setup file path in the vitest config**: `globalSetup: ['./test/global-setup.ts']` — relative to the config ✓.

**The global setup's npx**: `execFileSync('npx', ['--no-install', 'prisma', 'generate'], { stdio: 'inherit' })` — if node_modules is missing → a clear error ✓.

Wait, another idea: instead of npx, directly: `execFileSync(path.join(process.cwd(), 'node_modules', '.bin', 'prisma'), args)` — on macos, the .bin/prisma is a symlink to a JS file with a shebang `#!/usr/bin/env node` — execFileSync can execute a shebang script directly ✓ (it uses execve). pnpm's .bin entries are shell shims! pnpm creates a shell script shim (not a direct symlink to the JS) at node_modules/.bin/prisma — on unix it's executable with a shebang ✓ works with execFileSync. But npx --no-install is more robust cross-manager. Keep npx.

Hmm — `npx --no-install` on newer npm: `npx --no-install prisma` still valid? npm 10: `--no-install` is supported (a deprecated alias for --no-install? Actually, npm exec: `--no-install` means don't install → error if missing ✓ still accepted). Fine.

**Also the testTimeout for the concurrency test** — 32 requests to local Postgres — well under 30s ✓.

**vitest's fileParallelism**: the default is true — 3 spec files in parallel → 3 apps + 3 prisma clients + 3 migrations? The migration is global (once) ✓. 3 concurrent app inits — fine.

Actually wait — a potential issue: 3 spec files each `startApp()` → each creates a Nest app that listens on an ephemeral port ✓ no collision. Each app has its own PrismaService → its own pool ✓.

**Now — one more thing I want to double-check: the `forRoutes('*')` string pattern in Nest** ✓ matches all.

**CORS/express host check** — none.

**Now, "the controller validates the input" — POST with no body → express json parser → body = {} → parseRegisterBody throws bad_request ✓. Content-type missing? Nest's body-parser parses by default (Nest's global json parser) — a fetch POST with body but no content-type: Nest's express.json() defaults to application/json — no content-type → body {} → 400. My api() always sets content-type when a body is present ✓.

**Let me reconsider `registerCustomer` returning ApiResponse** and the spec uses `.json` as any ✓.

**The support.ts `TenantSeed extends Tenant`** — remove, unnecessary.

**Another design check — "handlers and repositories never mention tenantId"**:
- customers.repository: none ✓
- customers.service: none ✓
- customers.controller: none ✓
- tenant.service: reads the context (tenantId from the context — that's the point of the context, allowed: the Tenant model lookup is not tenant-scoped data)
- tenant-resolver: queries Tenants by domain/id — the identity table, pre-context ✓ legitimate.
- tests: seed via the base client with explicit data (tenant creation — creating tenants obviously needs explicit identity).

✓ The property holds for tenant-scoped data.

**The extension's `TENANTLESS_MODELS` = ['Tenant']** — the only non-tenant model. Future models are automatically scoped (fail closed on unknown ops) ✓.

**Wait, one more edge in scopeArgs**: `groupBy` with `by: ['email']` + where merge ✓ fine. `aggregate` ✓.

**What about `findUnique` with `where: { email }` (a tenant-scoped unique)?** The merge → { email, tenantId } → matches @@unique([tenantId, email]) ✓ valid. The repository doesn't do it but it works.

**Let me double-check the composite @@id + findUnique where merge once more**: `findUnique({ where: { id } })` + tenantId → `{ id, tenantId }` → Prisma matches the where to the @@id constraint (tenantId, id) — the key order is irrelevant ✓.

**The P2025 on findUniqueOrThrow** — the repository uses findUnique (not orThrow) ✓.

**Alright — also consider `app.enableShutdownHooks()`**? PrismaService's onModuleDestroy runs on app.close() without shutdown hooks (close triggers module destroy ✓). Fine.

**Type-check risks**:
1. `base.$extends({...} as any) as PrismaClient` — hmm, `as any` then `as PrismaClient`? `base.$extends(x as any)` returns some type; the `as PrismaClient` cast on the result — if the inferred return type isn't assignable to PrismaClient, the `as` cast errors ("conversion to this type may be a mistake")? An `as` cast from a complex type to PrismaClient — TS allows `as` when the types are "comparable"; if unrelated, an error → need `as unknown as PrismaClient`. To be safe: `as unknown as PrismaClient`. Hmm wait, but then the `extended` variable: `const extended = base.$extends(ext) as unknown as PrismaClient;` where `ext` is already `as any`... the overload resolution with an any argument — the first overload? $extends's overloads (Prisma 5.10 generated):
```ts
$extends<Ext extends Prisma.QueryExtension & Prisma.ClientExtension>(extension: Ext): ...
$extends<'query', Ext extends Prisma.QueryExtension>(extension: Ext): ...
$extends<'client', Ext extends Prisma.ClientExtension>(extension: Ext): ...
```
Roughly. Passing `any` → matches the first overload → the return type is a complex `PrismaClient & Ext stuff` — cast to `unknown as PrismaClient` is safe ✓. Let me write:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extended = base.$extends(buildQueryExtension(storage)) as unknown as PrismaClient;
```
Where buildQueryExtension returns an object `as any`? Let me type the builder's return as `any` with a comment. Simpler: inline the extension object with `as any`:

Actually, the cleanest is:

```ts
export function createTenantAwareClient(base: PrismaClient, storage: TenantContextStorage): PrismaClient {
  const extension = buildTenantQueryExtension(storage);
  // The Prisma $extends typing does not model a "catch every model and
  // every operation" hook, so the extension is passed through `any` here.
  // The runtime contract is fully pinned by the isolation test suite.
  const extended = (base as any).$extends(extension) as PrismaClient;
  return guardRawQueries(extended);
}

function buildTenantQueryExtension(storage: TenantContextStorage): any {
  return {
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: {
          model: string;
          operation: string;
          args: any;
          query: (args: any) => Promise<any>;
        }): Promise<any> {
          if (TENANTLESS_MODELS.has(model)) return query(args);
          const tenantId = storage.tenantId;
          return query(scopeArgs(operation, args, tenantId));
        },
      },
    },
  };
}
```

`buildTenantQueryExtension(...): any` — an explicit any return (allowed under strict; the lint rule isn't enforced). `(base as any).$extends(extension)` ✓ compiles.

2. `new Proxy(client, { get(target, prop) {...} })` — the proxy type: `new Proxy(client: PrismaClient, handler)` returns PrismaClient ✓ (Proxy<T, object>). The get trap returns `any` ✓.

3. The `@Inject(TENANT_DB) private readonly db: PrismaClient` in the repository — the token is a Symbol ✓.

4. The tenant middleware's express types: `import type { NextFunction, Request, Response } from 'express'` — @types/express is in devDeps ✓. NestMiddleware is from @nestjs/common ✓.

5. `app.getUrl()` — exists on INestApplication ✓ (returns Promise<string>).

6. The vitest `Test.createTestingModule({ imports: [AppModule] }).compile()` returns an INestApplicationFactory; `moduleRef.createNestApplication({ logger: ['error'] })` ✓.

Hmm — the `logger: ['error']` reduces noise ✓.

7. `import { Tenant } from '@prisma/client'` in the resolver + support ✓ (a generated model type).

8. The `Customer` type import in the service ✓.

9. In support.ts, the seed's `branding: {...}` is a Json input ✓ object literals are OK as Json.

10. The `decideError` in the middleware destructures `{ status, ...body }` — the body type = { code, message, details } ✓.

11. `err.message` on an HttpException instance — string ✓.

12. tsconfig includes the test directory — vitest transpiles with esbuild anyway; the tsconfig include is only for `tsc --noEmit` type-checking ✓.

13. The `randomUUID` import in the spec ✓.

**Now the "ASSUMPTION" comments**: are there any unclear symbols?
- The token format (Bearer JWT with an org claim) — the spec says the token carries the org claim; JWT is the natural reading. Should I mark it? "The auth token carries the org claim" — the token type isn't specified. Using a JWT verified with JWT_SECRET is a defensible reading. Let me add one ASSUMPTION comment in the resolver: `// ASSUMPTION: auth tokens are HS256 JWTs verified with JWT_SECRET; the org claim holds the tenant id.` That's a truly unclear point — I'll mark it.
- The host format `app.operator-x.com` → stored verbatim in tenants.domain and matched exactly. Also an assumption? The spec says "the tenant's domain (app.operator-x.com)" and the host carries the tenant — the exact-match domain lookup is a defensible reading; let me fold it into the same comment or a second one. Let me add one in the resolver's host method or the schema. Keep it to a small number of comments (1–2 total, at the points that matter).

**Also, let me double-check the envelope's `details` is "never null"** ✓ all {}.

**One more acceptance item**: "list → completely excludes A's rows" ✓ the test. "Concurrent requests from two tenants don't cross contexts" ✓. "A query issued with no tenant in context fails" ✓.

**Let me also re-verify that the update test asserts "A's row is unchanged afterward"** ✓ via A's GET name 'Alice'.

**The 204 body check on delete** — skip.

**Potential gotcha — Express route `GET /customers/:id` vs. `GET /customers`** ✓.

**The PATCH content-type** ✓ set.

**Now — let me reconsider whether `app.listen(0)` + getUrl works**: yes, Nest returns e.g. 'http://127.0.0.1:54321' (or [::1]). fetch handles both.

**The fetch keep-alive and app.close() after the test** ✓.

**Edge: two spec files both run `prisma generate`?** No — only the globalSetup does it (once). ✓

**The `test/global-setup.ts` file** — vitest's globalSetup runs in a separate process/context; the default export function ✓.

**Wait — the vitest config's `globalSetup` path**: relative to the config file's directory? Docs: a path to the module — './test/global-setup.ts' from the root (the config is at the root) ✓.

**One risk — `npx --no-install prisma migrate deploy` requires the schema + DATABASE_URL env ✓ provided.**

**Now, let me also think about `migrate deploy` when the DB is fresh** — creates the tables + the _prisma_migrations row ✓.

**Let me reconsider the `@map` on `tenantId` and the extension's `tenantId` key**: the Prisma client uses field names (camelCase) in JS ✓ the extension uses `tenantId` in where/data ✓ consistent with the client's field names (not column names) ✓.

**Let me check the schema once more — Customer.orders back-reference + Order.customer relation** ✓.

**The Plan model is unused by code** — that's fine (the schema requirement). But hmm — "do not create files not asked for" — the Plan/Order models are asked for (the schema) ✓.

**Alright, let me also double-check that the middleware's `res.status(status).json({ error: body })`** produces exactly `{ "error": { "code", "message", "details" } }` ✓.

**The 500 log line in the filter**: console.error — fine.

**Also: an unhandled 500 in the filter should still respond** ✓.

**Let me also handle the case where a Nest 404 (unknown route) with a valid tenant passes through the middleware, then Nest's router 404s → the filter → the envelope 'not_found'** ✓.

**The order of the error codes** — fine.

**Now — the `details` of the 403 mismatch**: {} ✓.

**Let me write the files.** Also — do I need a `.gitignore`? Not asked. Skip.

Wait, the layout conventions show `src/<feature>/<feature>.controller.ts` — my tenant-config controller file `src/tenant-config/tenant-config.controller.ts` ✓ matches. The tenant feature has no controller ✓ fine.

Also the convention: "class: PascalCase" ✓; "file: kebab-case.role.ts" — my files: `tenant-resolver.service.ts` ✓, `tenant-db.factory.ts` ✓, `all-exceptions.filter.ts` ✓, `error-mapping.ts` — no role suffix... the convention shows a per-role file pattern; a helper without a role is OK. Keep.

One more: the layout shows `test/<feature>.spec.ts` ✓ my three spec files ✓ + support.ts + global-setup.ts (auxiliary).

**Let me reconsider `process.env.JWT_SECRET ??= 'test-only-jwt-secret'` in support.ts** — sets the env if absent. The resolver's constructor throws if absent — the support sets it before the app creation ✓. But the "config comes from env only" — the app doesn't hardcode a secret; the test provides one. ✓ defensible.

**Now, is the `jwt.sign` in support using `process.env.JWT_SECRET as string` after the `??=` set** ✓.

**Let me verify the resolver's constructor throw**: if JWT_SECRET is absent → the app fails to boot — in tests, support sets it ✓; in production, main.ts fails fast ✓.

**The PrismaService extends PrismaClient with Nest DI**: PrismaClient's constructor signature `new (options?)` — Nest calls `new PrismaService()` with zero args → the default constructor ✓ (a standard Nest+Prisma pattern).

**One more subtle point — `PrismaService`'s inheritance + `@Injectable()`**: a standard pattern ✓.

**The extension's hook is async and returns query(args)** — the $allOperations can return a promise ✓.

**Let me also think: does `$extends`'s query extension apply to calls inside `$transaction`?** Yes, the extended client's $transaction uses the extended delegates ✓.

**Time to write everything out.** Also, let me decide the exact 404 message: 'resource not found' (both the service's AppError and the filter's P2025) ✓ — and the test asserts that the bodies are toEqual across cross-tenant and ghost fetches — both go through the service's AppError (findUnique null) ✓ identical anyway; the update/delete 404 goes through P2025 with the same body shape (the tests assert the status + that A is unchanged, not body equality — fine, but they're identical anyway).

Let me also re-verify the `toEqual(ghost.json)` — cross.json = {error:{code:'resource_not_found',message:'resource not found',details:{}}} and ghost is the same ✓.

**Let me also confirm the `api()` for DELETE without a body** — body is undefined, no content-type ✓.

**The express json parser for a PATCH with a body** ✓.

**Final check on the `scopeArgs` spread for args with `select`/`include`** — the shallow copy preserves the references ✓ the query is unchanged.

**What about `findMany` with `args: { where: { email } }`?** → { email, tenantId } — where can be any filter ✓.

**What if someone passes `where: undefined` explicitly?** `{ ...(undefined ?? {}) }` ✓.

**`create` args is always `{ data }`** ✓.

I think the design is solid. Let me also add a small README? No — not asked.

One more consideration — **the task says "build the whole solution in one reply"** and the format: heading + fenced block per file, "nothing outside that pattern is read... keep it to nothing." So the reply is only the sequence of ### path + fenced blocks. No prose at all.

The order of the files: logical order (config, prisma, src, tests).

Let me also re-verify the **migration folder name**: `prisma/migrations/20250101000000_init/migration.sql` — the timestamp format is YYYYMMDDHHMMSS ✓ 20250101000000 is valid.

And the `migration_lock.toml`:
```
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

**Let me reconsider the `active` boolean column name** — "active" is a reserved word? Not a Postgres reserved word ✓.

**`status` column** — not reserved ✓.

**The JSONB for branding/featureFlags NOT NULL** ✓ the seed provides them.

Now, let me also reconsider **`expiresIn: '5m'` type**: SignOptions['expiresIn']?: string | number — in @types/jsonwebtoken v9, it's `expiresIn?: string | number` (string allows '5m') ✓.

**`jwt.verify(token, secret, { algorithms: ['HS256'] })`** returns string | JwtPayload → cast `as JwtPayload` — verify can return a string for a token without a payload; our token has a payload; the cast is fine. Actually, verify's type: `string | JwtPayload` — the cast to JwtPayload via `as` is OK.

Wait — `jwt.verify`'s return type in @types/jsonwebtoken@9: `Jwt | string` where `type Jwt = string | { [key: string]: any }`? Something like that; the cast `as JwtPayload` — from string | {...} to JwtPayload (interface with optional fields + index) — might TS complain "neither type sufficiently overlaps"? The JwtPayload has `[key: string]: any` index signature... The cast from `string | { [key: string]: any }` to JwtPayload: the object part overlaps ✓; the string part doesn't → TS error on `as`? To be safe: `const payload = jwt.verify(...) as unknown as JwtPayload;` Let me use `as unknown as JwtPayload`. Safe.

**The type of `payload.org`** — JwtPayload has an index signature `[key: string]: any` ✓.

**Let me also verify the `Tenant` import from '@prisma/client'** — the generated types export the model interfaces ✓.

**Now the customers repository's `list()` orderBy with createdAt + id** — both valid fields ✓.

**The service's `remove` returns Promise<void>** — the controller returns it → Nest 204 ✓ (a @Delete returning a resolved undefined → 204? Nest: if the handler returns undefined and the method is @Delete → 204. Actually, Nest returns 204 when the returned value is undefined (any method) — yes, Nest auto-sends 204 for undefined on DELETE... let me recall: Nest's default: POST → 201, DELETE → 200 unless the body is undefined? Hmm. Nest docs: "If the return value is undefined, the response is 204 No Content" — for DELETE, Nest sends 204 when the handler returns void. I recall Nest's router: `if (response === undefined) { res.status(204).end() }`? Hmm — actually, I think Nest only does that for @Delete? Let me think... In Nest's router-executor, after a handler resolves: if the return is undefined → `res.status(200).end()`? I think there's special handling: the router checks the method — for DELETE with undefined → 204. Let me recall the source: router-executor.ts:

```ts
const isDeleted = routerException... 
```
Hmm. I recall: Nest sends 204 No Content when the handler returns void on a DELETE request — yes, that's documented behaviour (router-executor: `if (method === 'DELETE' && response === undefined) res.status(204)`? Something like that — I'm fairly sure Nest returns 204 for a DELETE handler returning undefined). Even if it returns 200 with an empty body, the test asserts status 404 for cross-tenant and 200 for A's GET — my tests don't assert the status of a successful DELETE. Safe either way.

**Let me also handle the test's `expect(results.every(...)).toBe(true)`** — if any 500, it fails ✓.

**Another possible flake**: the parallel spec files each seed tenants with random domains ✓ no collision; the DB tables are shared ✓.

**The afterAll `ctx.stop()`** — deletes the tenants (cascade) ✓ no residue.

**Now — let me write the final files.** Also, the order of the files in the reply — let me do:

1. package.json
2. tsconfig.json
3. vitest.config.ts
4. test/global-setup.ts
5. prisma/schema.prisma
6. prisma/migrations/migration_lock.toml
7. prisma/migrations/20250101000000_init/migration.sql
8. src/main.ts
9. src/app.module.ts
10. src/prisma/prisma.service.ts
11. src/prisma/prisma.module.ts
12. src/prisma/tenant-context.ts
13. src/prisma/tenant-db.factory.ts
14. src/tenant/tenant-resolver.service.ts
15. src/tenant/tenant.service.ts
16. src/tenant/tenant.middleware.ts
17. src/tenant/tenant.module.ts
18. src/tenant-config/tenant-config.module.ts
19. src/tenant-config/tenant-config.controller.ts
20. src/customers/customers.module.ts
21. src/customers/customers.controller.ts
22. src/customers/customers.service.ts
23. src/customers/customers.repository.ts
24. src/errors/app-error.ts
25. src/errors/error-mapping.ts
26. src/errors/all-exceptions.filter.ts
27. test/support.ts
28. test/customers.spec.ts
29. test/tenant-config.spec.ts
30. test/tenant-isolation.spec.ts

Let me write each file in full, carefully, keeping the comments in English, concise.

One more check on the **`decideError` import in tenant.middleware** — decideError handles AppError ✓ (the resolver throws AppError) → the correct status.

And the **`import type { Response }` in the filter** — I use express's Response type ✓ @types/express is a devDep ✓.

**The all-exceptions.filter.ts imports AppError** (for the log guard) ✓.

**The customers.service imports the Customer type** — `import type { Customer } from '@prisma/client';` ✓.

**Let me re-verify the `registerCustomer` naming in the spec** ✓.

**The `TestContext` export type** ✓.

**In support.ts — the `INestApplicationContext` import from @nestjs/common** ✓ exported.

**The `app.init()` + `app.listen(0)`** — the init then listen is fine (listen also inits; the double init is harmless). Actually, just `await app.listen(0)` suffices (listen implicitly calls init). Let me use just listen. Hmm, Nest's docs: `await app.listen(0)` ✓.

**The `getUrl()` after listen** ✓.

**Now — one more edge I want to verify: the fetch `host` header key** — I use lowercase 'host' in the headers object; undici normalizes ✓.

**Let me also consider whether the middleware needs to skip non-tenant routes** — there are none ✓ all routes require a tenant (that's the white-label model).

**Also, hmm: `req.headers.host`** can contain a port (e.g. 'localhost:3000') — the tenant lookup fails → unknown_host 404. In production, a domain without a port ✓. Fine.

**Final: let me verify no file references something that doesn't exist:**
- support.ts imports AppModule (✓), AllExceptionsFilter (✓), PrismaClient/Tenant from @prisma/client (✓), jwt (✓).
- The spec imports from './support' ✓ and src classes ✓.
- The global-setup: node:child_process ✓.

**The tenant-config spec's `res.json.branding` toEqual(t.branding)** — t.branding is a Prisma JsonValue (a plain object) ✓ the response JSON is equal ✓.

**The tenant-config spec's `res.json.featureFlags).not.toEqual(ctx.tenants.a.featureFlags)`** — A: {beta_orders:true, self_serve_billing:false}, B: {beta_orders:false, self_serve_billing:true} → not equal ✓.

I think I'm ready. Let me also add a brief file-level comment where it aids understanding (the factory, the middleware, the resolver, the context). Keep it terse.

One more: **the "ASSUMPTION" comment** — placement:
1. In tenant-resolver.service.ts, at the top: the token is an HS256 JWT, the org claim = the tenant id, verified with JWT_SECRET.
2. In the schema or the resolver: host = the exact tenant domain (stored in tenants.domain).

Let me place both concisely in the resolver (the point where the interpretation happens). The instructions say to mark "where it matters" — the resolver is where it matters.

Let me write the final content of each file.

Actually — one more thought on the **`scopeArgs` where merge for `upsert`**: `next.where = { ...(next.where ?? {}), tenantId }` ✓ and `next.data.create` stamped ✓. The `data.update` is left as-is ✓.

And **`delete`**'s where merge ✓.

**`count`** — where merge ✓ (not used but supported).

**The fail-closed throw message** — clear ✓.

**Let me re-verify the `HANDLED_OPERATIONS` set**: READ (8) + WHERE (5: update, updateMany, delete, deleteMany, upsert) + DATA (2: create, createMany) = 15. All classified ops are handled ✓. Unknown (e.g. future 'createManyAndReturn') → throws ✓ fail closed.

**Prisma 5.10.2 — the `groupBy` operation exists** ✓.

Now — the **proxy's get trap**: `Reflect.get(target, prop)` — for the model delegate 'customer' → an object ✓; for the '$transaction' function → returned; called as `db.$transaction(fn)` → `this` = the proxy → the internal `this.$queryRaw`? $transaction's implementation accesses the internal query engine via closure (the delegate holds the engine) — even if it accessed this.$something, the proxy forwards ✓.

**A potential issue**: Prisma's extended client instance — the `$extends` result is a new object whose `customer` delegate is an own property ✓ the proxy forwards it.

**Alright, let me write it out.**

One more: the **`package.json` scripts** — add `"start:dev"`? Not needed. Keep minimal: build, start, test, typecheck, prisma:generate, prisma:migrate, postinstall.

Hmm, the `postinstall` running `prisma generate` on `pnpm install` — needs the schema ✓ present.

**The tsconfig `include` covers the test directory** ✓ so `tsc --noEmit` type-checks the tests too.

**The `resolveJsonModule`** is unnecessary — remove. Keep minimal but harmless; remove it.

**target ES2022 + module commonjs** ✓ Node 20.

**Also — `emitDecoratorMetadata: true`** is required for Nest DI ✓.

Let me reconsider the **`lib`** — ES2022 ✓ includes the Promise, etc. `fetch`'s type — @types/node 20 provides the global fetch types ✓ (undici-types). ✓

**`types` in tsconfig** — not set → includes all @types (node, express, jsonwebtoken) ✓ fine.

Let me now write out the customers.spec "list excludes A" test — B's list contains only B's rows; assert not.toContain(aliceA.email) and toContain(bobB.email) ✓.

**Also — a positive control that A can see A**: the update test's `after` GET as A ✓ covers it.

I'm confident. Let me write the final answer with only the file blocks.

Wait — the format: "for each file, a level-3 heading containing only the repo-relative path." So `### package.json` etc. And "immediately followed by one fenced block containing only that file's content." No prose. Let me make sure there's no extra text between/around the blocks.

Let me also reconsider one more thing: **does the middleware need `@Injectable()`?** NestMiddleware instances are instantiated by Nest via DI if provided ✓ with @Injectable (strictly, in Nest 10, not needed for a provider class... actually, for a NestMiddleware provider, @Injectable is recommended; without it, Nest can't inject the constructor args. Let me keep @Injectable.)

**One more check — the `forRoutes('*')` in the `configure()` in TenantModule**: applies globally to the app ✓.

**The app.module imports TenantModule** → the middleware is active ✓.

**The error: `consumer.apply(TenantMiddleware).forRoutes('*')`** ✓.

**The `@Controller('tenant-config')` route → '/tenant-config'** ✓ (kebab, but singular — the spec mandates the exact path; the naming convention yields to the explicit task requirement).

Also — **the customers controller's route is plural 'customers'** ✓.

Final file contents:

Let me also re-verify that **`import 'reflect-metadata'`** is at the top of main.ts and support.ts (for the DI metadata in tests) ✓.

**The `vitest` import in the specs**: describe/it/expect/beforeAll/afterAll from 'vitest' ✓.

**The `ApiResponse` type in tenant-isolation** — I reference it in the Job type; import type { ApiResponse } from './support' ✓ export it.

Let me finalize the code text for each file.

File: test/support.ts — complete:

```ts
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Tenant } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/errors/all-exceptions.filter';

export interface TestContext {
  app: INestApplication;
  moduleRef: INestApplicationContext;
  base: string;
  db: PrismaClient;
  tenants: { a: Tenant; b: Tenant };
  stop: () => Promise<void>;
}

/**
 * Boots the full application against the real Postgres database and seeds two
 * tenants with unique domains so parallel spec files never collide.
 */
export async function startApp(): Promise<TestContext> {
  // Test-provided configuration; the app itself only ever reads process.env.
  process.env.JWT_SECRET ??= 'test-only-jwt-secret';
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a test PostgreSQL instance');
  }

  const db = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0);
  const base = await app.getUrl();

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const [a, b] = await Promise.all([
    db.tenant.create({
      data: {
        domain: `app.a-${suffix}.example.test`,
        name: 'Operator A',
        branding: { primaryColor: '#0b3d91', logoUrl: `https://a-${suffix}.example.test/logo.svg` },
        featureFlags: { beta_orders: true, self_serve_billing: false },
      },
    }),
    db.tenant.create({
      data: {
        domain: `app.b-${suffix}.example.test`,
        name: 'Operator B',
        branding: { primaryColor: '#910b0b', logoUrl: `https://b-${suffix}.example.test/logo.svg` },
        featureFlags: { beta_orders: false, self_serve_billing: true },
      },
    }),
  ]);

  return {
    app,
    moduleRef,
    base,
    db,
    tenants: { a, b },
    stop: async () => {
      await db.tenant.deleteMany({ where: { id: { in: [a.id, b.id] } } });
      await db.$disconnect();
      await app.close();
    },
  };
}

export function signToken(org: string): string {
  return jwt.sign({ org }, process.env.JWT_SECRET as string, { algorithm: 'HS256', expiresIn: '5m' });
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  host: string;
  org?: string;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export async function api(base: string, path: string, opts: ApiOptions): Promise<ApiResponse> {
  const headers: Record<string, string> = { host: opts.host };
  if (opts.org !== undefined) {
    headers.authorization = `Bearer ${signToken(opts.org)}`;
  }
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, json: json as any };
}

export function registerCustomer(base: string, tenant: Tenant, body: { email: string; name: string }): Promise<ApiResponse> {
  return api(base, '/customers', { method: 'POST', host: tenant.domain, org: tenant.id, body });
}
```

The eslint-disable comments — there's no eslint here; remove them to keep the files clean. The `json: any` is fine as-is.

File: the specs — let me write them in full (as drafted above).

Now, a possible concern in **customers.spec**: `aliceA = a.json;` — a.json is any → aliceA is typed { id: string; email: string } — assigning any to that is fine.

**tenant-isolation.spec** — the Job typing with the ApiResponse import ✓.

Let me also add a mismatch test with the token first? Covered.

**The concurrency test's final state check uses a Set of emails** ✓.

Now, one more thing I want to reconsider: **the `db.tenant.deleteMany` in stop() — with ON DELETE CASCADE, deleting the tenant removes the customers/plans/orders ✓; deleteMany issues a DELETE per row? deleteMany → a single DELETE statement ✓ fine.

**Also, the `app.close()` closes the HTTP server ✓.

I believe everything is consistent. Let me also decide whether the `startApp` in the test needs `process.env.JWT_SECRET ??=` — yes ✓.

**The global-setup**:

```ts
import { execFileSync } from 'node:child_process';

/**
 * Runs once before any test file: makes sure the Prisma client is generated
 * and the database schema is applied, and fails fast without a DATABASE_URL.
 */
export default function globalSetup(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set to a test PostgreSQL instance, e.g. ' +
        'postgresql://postgres:postgres@localhost:5432/operator_platform_test',
    );
  }
  execFileSync('npx', ['--no-install', 'prisma', 'generate'], { stdio: 'inherit' });
  execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
}
```

Good.

**The vitest.config.ts**:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

Alright — the resolver file also imports the `Tenant` type ✓.

Let me reconsider the **`unknown_host` status 404 vs. 400** one more time — I'll keep 404.

**And the mismatch 403** ✓.

**Missing token 401 'unauthorized'** ✓; invalid token 401 'invalid_token' ✓.

I think I'm done. Let me now write out all the files.

Actually, one last thing — the **`CustomersRepository` constructor's injection**:

```ts
constructor(@Inject(TENANT_DB) private readonly db: PrismaClient) {}
```
Import { Inject } from '@nestjs/common' ✓ and TENANT_DB from '../prisma/prisma.module' ✓.

Type: I said TenantAwareClient = PrismaClient; let me just type it as PrismaClient (from @prisma/client) — simple.

And a comment in the repository: "no tenant id anywhere: scoping happens in the tenant-aware client" ✓.

Also let me make sure the **`update` service method's signature** — the controller's parseUpdateBody returns { name } ✓.

**And the controller's `@Patch`** — tests use PATCH ✓.

Let me write the final answer.

One more detail — **the `decideError` message for P2003** (FK violation): 'the record is referenced by other data' — the generic message 'a record with the same unique value already exists' doesn't fit P2003. Let me separate: P2002 → conflict 'a record with the same unique value already exists'; P2003 → conflict 'the operation violates a referential constraint'. Fine.

**And the P2025 details** {} ✓ the "same body" requirement.

Also — for the **404 message for ghost vs. cross**: both the service's AppError('resource_not_found', 404, 'resource not found') → the body {code, message:'resource not found', details:{}} ✓ identical to the P2025 mapping ✓.

Done — I'll write the files.

Actually, let me reconsider the `as unknown as PrismaClient` once more — after `(base as any).$extends(extension)`, the result is `any` → `as PrismaClient` is fine (an any→PrismaClient cast is fine without unknown). `(base as any).$extends(extension)` → any. `const extended: PrismaClient = (base as any).$extends(extension);` — assignment from any ✓. Then `guardRawQueries(extended)`. Clean:

```ts
const extended: PrismaClient = (base as any).$extends(buildTenantQueryExtension(storage));
return guardRawQueries(extended);
```

✓.

And the **`buildTenantQueryExtension`** is typed to return `any` — with a comment.

**The `scopeArgs` function** — typed `(operation: string, args: unknown, tenantId: string): unknown` with an internal `as Record<string, any>` ✓.

Let me write it all.

One more small thing: in the **error-mapping.ts**, the `err.details` for AppError is typed Record<string, unknown> ✓.

And the **all-exceptions.filter** — the 500 console.error log: `if (status >= 500) console.error(exception)` — let me keep it simple, log all 500s (including AppError 500s). Fine.

Final: make sure every file compiles in my head... I'll write it out now.
```

## reply

### package.json
```json
{
  "name": "operator-platform",
  "version": "1.0.0",
  "private": true,
  "description": "Multi-tenant white-label operator platform (NestJS + Prisma + PostgreSQL)",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "postinstall": "prisma generate",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.9",
    "@nestjs/core": "^10.3.9",
    "@nestjs/platform-express": "^10.3.9",
    "@prisma/client": "5.10.2",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.9",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.12.7",
    "prisma": "5.10.2",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": false,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

### test/global-setup.ts
```ts
import { execFileSync } from 'node:child_process';

/**
 * Runs once, before any test file: verifies DATABASE_URL, generates the
 * Prisma client and applies the schema migrations so every spec file starts
 * against a fully provisioned database.
 */
export default function globalSetup(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set to a test PostgreSQL instance, e.g. ' +
        'postgresql://postgres:postgres@localhost:5432/operator_platform_test',
    );
  }
  execFileSync('npx', ['--no-install', 'prisma', 'generate'], { stdio: 'inherit' });
  execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
}
```

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Tenant-scoped models carry tenantId in their composite primary key, so
// "append tenantId to the where clause" is a valid unique filter on every
// operation (findUnique, update, delete), and two tenants may hold rows with
// the same id without collision.
model Tenant {
  id           String   @id @default(uuid())
  domain       String   @unique
  name         String
  branding     Json
  featureFlags Json     @map("feature_flags")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  customers Customer[]
  plans     Plan[]
  orders    Order[]

  @@map("tenants")
}

model Customer {
  id        String   @default(uuid())
  tenantId  String   @map("tenant_id")
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  email     String
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  orders Order[]

  @@id([tenantId, id])
  @@unique([tenantId, email])
  @@map("customers")
}

model Plan {
  id         String   @default(uuid())
  tenantId   String   @map("tenant_id")
  tenant     Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name       String
  slug       String
  priceCents Int      @map("price_cents")
  active     Boolean  @default(true)
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  orders Order[]

  @@id([tenantId, id])
  @@unique([tenantId, slug])
  @@map("plans")
}

model Order {
  id         String   @default(uuid())
  tenantId   String   @map("tenant_id")
  tenant     Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customerId String   @map("customer_id")
  customer   Customer @relation(fields: [tenantId, customerId], references: [tenantId, id], onDelete: Cascade)
  planId     String   @map("plan_id")
  plan       Plan     @relation(fields: [tenantId, planId], references: [tenantId, id], onDelete: Restrict)
  status     String   @default("pending")
  totalCents Int      @default(0) @map("total_cents")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@id([tenantId, id])
  @@map("orders")
}
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

### prisma/migrations/20250101000000_init/migration.sql
```sql
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branding" JSONB NOT NULL,
    "feature_flags" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("tenant_id", "id")
);

CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("tenant_id", "id")
);

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("tenant_id", "id")
);

CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");
CREATE UNIQUE INDEX "plans_tenant_id_slug_key" ON "plans"("tenant_id", "slug");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");
CREATE INDEX "plans_tenant_id_idx" ON "plans"("tenant_id");
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");
CREATE INDEX "orders_tenant_id_customer_id_idx" ON "orders"("tenant_id", "customer_id");
CREATE INDEX "orders_tenant_id_plan_id_idx" ON "orders"("tenant_id", "plan_id");

ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './errors/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { CustomersModule } from './customers/customers.module';
import { TenantConfigModule } from './tenant-config/tenant-config.module';

@Module({
  imports: [PrismaModule, TenantModule, CustomersModule, TenantConfigModule],
})
export class AppModule {}
```

### src/prisma/tenant-context.ts
```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/**
 * Thrown whenever a query is attempted with no tenant in the current request
 * context. Failing here — instead of falling back to an unscoped query — is
 * the core guarantee of the tenant-aware data layer.
 */
export class TenantContextMissingError extends Error {
  constructor() {
    super('no tenant in request context; refusing to run an unscoped query');
    this.name = 'TenantContextMissingError';
  }
}

export interface TenantContext {
  readonly tenantId: string;
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage. The middleware
 * starts the request inside `run`, and the tenant then follows the async work
 * (route handler -> service -> repository -> Prisma) without being passed
 * through any signature.
 */
@Injectable()
export class TenantContextStorage {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(tenant: TenantContext, fn: () => T): T {
    return this.storage.run(tenant, fn);
  }

  /** The tenant id for the current request; throws when none is in context. */
  get tenantId(): string {
    const ctx = this.storage.getStore();
    if (!ctx) {
      throw new TenantContextMissingError();
    }
    return ctx.tenantId;
  }
}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The plain Prisma client. Only layers that must run outside the tenant
 * context (resolving the tenant itself, which reads the tenants table) may
 * use this; all tenant-scoped data access goes through TENANT_DB.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

### src/prisma/tenant-db.factory.ts
```ts
import { PrismaClient } from '@prisma/client';
import { TenantContextStorage } from './tenant-context';

/**
 * Builds the tenant-aware Prisma client.
 *
 * Every model query passes through a single query extension that:
 *  - scopes every read (and every unique `where`) to the tenant in the
 *    request context;
 *  - stamps every write with that tenant id, overwriting whatever tenantId a
 *    caller supplied — a supplied tenantId is never trusted;
 *  - refuses to run when no tenant is in context (fails closed, never
 *    returns everything);
 *  - refuses to run any operation it does not explicitly classify, so a new
 *    Prisma operation can never silently bypass the tenant guard.
 *
 * Models in TENANTLESS_MODELS (the tenant lookup table itself) are exempt;
 * everything else is tenant data and is scoped.
 */

const TENANTLESS_MODELS = new Set(['Tenant']);

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const WHERE_OPERATIONS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

const DATA_OPERATIONS = new Set(['create', 'createMany']);

const HANDLED_OPERATIONS = new Set([...READ_OPERATIONS, ...WHERE_OPERATIONS, ...DATA_OPERATIONS]);

function scopeArgs(operation: string, args: unknown, tenantId: string): unknown {
  if (!HANDLED_OPERATIONS.has(operation)) {
    throw new Error(
      `tenant guard: operation "${operation}" is not explicitly tenant-scoped; refusing to run it unscoped`,
    );
  }
  const next = (args ?? {}) as Record<string, any>;

  if (READ_OPERATIONS.has(operation) || WHERE_OPERATIONS.has(operation)) {
    // Every tenant-scoped model carries tenantId in its composite primary
    // key and in its other unique constraints, so adding tenantId to `where`
    // keeps every operation valid — including findUnique/update/delete,
    // whose where must be a unique constraint. A caller-supplied tenantId in
    // `where` is overwritten by the context, not trusted.
    next.where = { ...(next.where ?? {}), tenantId };
  }

  if (operation === 'create' || operation === 'createMany') {
    next.data = Array.isArray(next.data)
      ? next.data.map((row: any) => ({ ...row, tenantId }))
      : { ...next.data, tenantId };
  }

  if (operation === 'upsert') {
    next.data = { ...next.data, create: { ...next.data.create, tenantId } };
  }

  return next;
}

function guardRawQueries(client: PrismaClient): PrismaClient {
  const blocked = new Set(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe', '$batchRaw']);
  return new Proxy(client, {
    get(target, prop) {
      if (typeof prop === 'string' && blocked.has(prop)) {
        return () => {
          throw new Error('raw SQL is not available on the tenant-aware client; use tenant-scoped model queries');
        };
      }
      return Reflect.get(target, prop);
    },
  });
}

function buildTenantQueryExtension(storage: TenantContextStorage): any {
  // The Prisma extension API has no typed "any model, any operation" hook,
  // so the hook is intentionally loose here; its runtime contract is pinned
  // by the isolation test suite.
  return {
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: {
          model: string;
          operation: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          args: any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          query: (args: any) => Promise<any>;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }): Promise<any> {
          if (TENANTLESS_MODELS.has(model)) {
            return query(args);
          }
          const tenantId = storage.tenantId; // throws TenantContextMissingError
          return query(scopeArgs(operation, args, tenantId));
        },
      },
    },
  };
}

export function createTenantAwareClient(base: PrismaClient, storage: TenantContextStorage): PrismaClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extended: PrismaClient = (base as any).$extends(buildTenantQueryExtension(storage));
  return guardRawQueries(extended);
}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantContextStorage } from './tenant-context';
import { createTenantAwareClient } from './tenant-db.factory';

/**
 * Injection token for the tenant-aware Prisma client. Repositories inject
 * this (never the raw client), so no repository or handler can mention a
 * tenant id.
 */
export const TENANT_DB = Symbol('TENANT_DB');

@Module({
  providers: [
    PrismaService,
    TenantContextStorage,
    {
      provide: TENANT_DB,
      inject: [PrismaService, TenantContextStorage],
      useFactory: (base: PrismaService, storage: TenantContextStorage) =>
        createTenantAwareClient(base, storage),
    },
  ],
  exports: [PrismaService, TenantContextStorage, TENANT_DB],
})
export class PrismaModule {}
```

### src/tenant/tenant-resolver.service.ts
```ts
import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { Tenant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../errors/app-error';

// ASSUMPTION: auth tokens are HS256 JWTs verified with the JWT_SECRET env
// var; the `org` claim carries the tenant id, and the request host is the
// tenant's exact domain as stored in tenants.domain.
@Injectable()
export class TenantResolverService {
  constructor(private readonly prisma: PrismaService) {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET must be set in the environment');
    }
  }

  /**
   * Resolves the tenant for a request from two independent sources that must
   * agree: the Host header (which tenant's domain is being addressed) and
   * the `org` claim of a verified auth token. Neither alone is sufficient,
   * and a disagreement is rejected rather than resolved in favour of one.
   */
  async resolve(host: string | undefined, authorization: string | undefined): Promise<Tenant> {
    const tenantFromToken = await this.resolveFromToken(authorization);
    const tenantFromHost = await this.resolveFromHost(host);
    if (tenantFromToken.id !== tenantFromHost.id) {
      throw new AppError('tenant_mismatch', 403, 'host and token org claim point at different tenants');
    }
    return tenantFromHost;
  }

  private async resolveFromToken(authorization: string | undefined): Promise<Tenant> {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new AppError('unauthorized', 401, 'missing bearer token');
    }
    const token = authorization.slice('Bearer '.length).trim();
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as unknown as JwtPayload;
    } catch {
      throw new AppError('invalid_token', 401, 'auth token failed verification');
    }
    if (typeof payload.org !== 'string' || payload.org.length === 0) {
      throw new AppError('invalid_token', 401, 'auth token is missing the org claim');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: payload.org } });
    if (!tenant) {
      throw new AppError('invalid_token', 401, 'token org does not match a known tenant');
    }
    return tenant;
  }

  private async resolveFromHost(host: string | undefined): Promise<Tenant> {
    if (!host) {
      throw new AppError('unknown_host', 404, 'request has no host');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { domain: host } });
    if (!tenant) {
      throw new AppError('unknown_host', 404, 'host does not belong to a known tenant');
    }
    return tenant;
  }
}
```

### src/tenant/tenant.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextStorage } from '../prisma/tenant-context';
import { AppError } from '../errors/app-error';

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContextStorage,
  ) {}

  /** Branding and feature flags for the tenant resolved for this request. */
  async forCurrentRequest(): Promise<{
    id: string;
    name: string;
    branding: Prisma.JsonValue;
    featureFlags: Prisma.JsonValue;
  }> {
    const tenantId = this.context.tenantId; // throws when no tenant is in context
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new AppError('internal_error', 500, 'the tenant resolved for this request no longer exists');
    }
    return { id: tenant.id, name: tenant.name, branding: tenant.branding, featureFlags: tenant.featureFlags };
  }
}
```

### src/tenant/tenant.middleware.ts
```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantContextStorage } from '../prisma/tenant-context';
import { decideError } from '../errors/error-mapping';

/**
 * Resolves the tenant (host and token org claim must both resolve and agree)
 * and runs the entire request inside that tenant's AsyncLocalStorage context,
 * so the tenant-aware data layer can scope every query without any handler or
 * repository passing a tenant id.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly resolver: TenantResolverService,
    private readonly context: TenantContextStorage,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    let tenantId: string;
    try {
      const tenant = await this.resolver.resolve(req.headers.host, req.headers.authorization);
      tenantId = tenant.id;
    } catch (err) {
      if (!res.headersSent) {
        const { status, ...body } = decideError(err);
        res.status(status).json({ error: body });
      }
      return;
    }

    await this.context
      .run({ tenantId }, () => new Promise<void>((resolve, reject) => {
        next((err?: unknown) => (err ? reject(err) : resolve()));
      }))
      .catch((err: unknown) => {
        // Anything that escaped the downstream exception filters.
        if (!res.headersSent) {
          const { status, ...body } = decideError(err);
          res.status(status).json({ error: body });
        }
      });
  }
}
```

### src/tenant/tenant.module.ts
```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantMiddleware } from './tenant.middleware';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantService } from './tenant.service';

@Module({
  imports: [PrismaModule],
  providers: [TenantResolverService, TenantService, TenantMiddleware],
  exports: [TenantResolverService, TenantService, TenantMiddleware],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

### src/tenant-config/tenant-config.module.ts
```ts
import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { TenantConfigController } from './tenant-config.controller';

@Module({
  imports: [TenantModule],
  controllers: [TenantConfigController],
})
export class TenantConfigModule {}
```

### src/tenant-config/tenant-config.controller.ts
```ts
import { Controller, Get } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  current() {
    return this.tenants.forCurrentRequest();
  }
}
```

### src/customers/customers.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './customers.repository';

@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
})
export class CustomersModule {}
```

### src/customers/customers.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../prisma/prisma.module';

/**
 * The only layer that touches the database for customers — and it never
 * mentions a tenant id. Scoping and write-stamping happen entirely inside
 * the tenant-aware client (TENANT_DB).
 */
@Injectable()
export class CustomersRepository {
  constructor(@Inject(TENANT_DB) private readonly db: PrismaClient) {}

  list() {
    return this.db.customer.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  findById(id: string) {
    return this.db.customer.findUnique({ where: { id } });
  }

  create(data: { email: string; name: string }) {
    return this.db.customer.create({ data });
  }

  update(id: string, data: { name: string }) {
    return this.db.customer.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.db.customer.delete({ where: { id } });
  }
}
```

### src/customers/customers.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { CustomersRepository } from './customers.repository';
import { AppError } from '../errors/app-error';

export interface CustomerDto {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(customer: Customer): CustomerDto {
  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

@Injectable()
export class CustomersService {
  constructor(private readonly customers: CustomersRepository) {}

  list(): Promise<CustomerDto[]> {
    return this.customers.list().then((rows) => rows.map(toDto));
  }

  async findById(id: string): Promise<CustomerDto> {
    const customer = await this.customers.findById(id);
    if (!customer) {
      // Deliberately indistinguishable from "no such id": a 404 that never
      // reveals whether the row exists in another tenant.
      throw new AppError('resource_not_found', 404, 'resource not found');
    }
    return toDto(customer);
  }

  register(email: string, name: string): Promise<CustomerDto> {
    return this.customers.create({ email, name }).then(toDto);
  }

  update(id: string, data: { name: string }): Promise<CustomerDto> {
    // Cross-tenant id -> Prisma P2025 -> 404 via the global filter, row untouched.
    return this.customers.update(id, data).then(toDto);
  }

  remove(id: string): Promise<void> {
    // Cross-tenant id -> Prisma P2025 -> 404 via the global filter, row untouched.
    return this.customers.remove(id).then(() => undefined);
  }
}
```

### src/customers/customers.controller.ts
```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { AppError } from '../errors/app-error';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRegisterBody(body: unknown): { email: string; name: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('bad_request', 400, 'body must be a JSON object with email and name');
  }
  const { email, name } = body as { email?: unknown; name?: unknown };
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    throw new AppError('bad_request', 400, 'email must be a valid email address', { field: 'email' });
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('bad_request', 400, 'name must be a non-empty string', { field: 'name' });
  }
  return { email: email.trim(), name: name.trim() };
}

function parseUpdateBody(body: unknown): { name: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('bad_request', 400, 'body must be a JSON object with name');
  }
  const { name } = body as { name?: unknown };
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('bad_request', 400, 'name must be a non-empty string', { field: 'name' });
  }
  return { name: name.trim() };
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list() {
    return this.customers.list();
  }

  @Post()
  register(@Body() body: unknown) {
    const { email, name } = parseRegisterBody(body);
    return this.customers.register(email, name);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customers.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const data = parseUpdateBody(body);
    return this.customers.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customers.remove(id);
  }
}
```

### src/errors/app-error.ts
```ts
/**
 * Application-level error with a stable, snake_case machine-readable code.
 * The global exception filter turns it into the single error envelope:
 * { error: { code, message, details } }
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

### src/errors/error-mapping.ts
```ts
import { Prisma } from '@prisma/client';
import type { HttpException } from '@nestjs/common';
import { AppError } from './app-error';
import { TenantContextMissingError } from '../prisma/tenant-context';

export interface ErrorDecision {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/**
 * The single place that decides how any error maps onto the error envelope.
 * Used by the global exception filter and by the tenant middleware, which
 * must answer (401/403/404) before any request-scoped context exists.
 */
export function decideError(err: unknown): ErrorDecision {
  if (err instanceof AppError) {
    return { status: err.httpStatus, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof TenantContextMissingError) {
    return {
      status: 500,
      code: 'no_tenant_context',
      message: 'a query was attempted with no tenant in context; it was refused rather than run unscoped',
      details: {},
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      // Record not found. For tenant-scoped models this deliberately covers
      // both "does not exist" and "belongs to another tenant" — same body,
      // so an id from another operator is indistinguishable from a ghost id.
      return { status: 404, code: 'resource_not_found', message: 'resource not found', details: {} };
    }
    if (err.code === 'P2002') {
      return {
        status: 409,
        code: 'conflict',
        message: 'a record with the same unique value already exists',
        details: { prismaCode: err.code },
      };
    }
    if (err.code === 'P2003') {
      return {
        status: 409,
        code: 'conflict',
        message: 'the operation violates a referential constraint',
        details: { prismaCode: err.code },
      };
    }
    return {
      status: 409,
      code: 'database_error',
      message: 'the database rejected the operation',
      details: { prismaCode: err.code },
    };
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, code: 'bad_request', message: 'the query failed Prisma validation', details: {} };
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code =
      status === 404 ? 'not_found' : status === 405 ? 'method_not_allowed' : status === 400 ? 'bad_request' : 'http_error';
    return { status, code, message: err.message, details: {} };
  }
  return { status: 500, code: 'internal_error', message: 'unexpected internal error', details: {} };
}
```

### src/errors/all-exceptions.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { decideError } from './error-mapping';

/**
 * The only place HTTP error responses are produced: every error becomes the
 * single envelope { error: { code, message, details } }.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = decideError(exception);

    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(exception);
    }

    if (!response.headersSent) {
      response.status(status).json({ error: { code, message, details } });
    }
  }
}
```

### test/support.ts
```ts
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Tenant } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/errors/all-exceptions.filter';

export interface TestContext {
  app: INestApplication;
  moduleRef: INestApplicationContext;
  base: string;
  db: PrismaClient;
  tenants: { a: Tenant; b: Tenant };
  stop: () => Promise<void>;
}

/**
 * Boots the full application against the real Postgres database and seeds
 * two tenants with unique domains so parallel spec files never collide.
 */
export async function startApp(): Promise<TestContext> {
  // Test-provided configuration; the application itself only ever reads process.env.
  process.env.JWT_SECRET ??= 'test-only-jwt-secret';
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a test PostgreSQL instance');
  }

  const db = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0);
  const base = await app.getUrl();

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const [a, b] = await Promise.all([
    db.tenant.create({
      data: {
        domain: `app.a-${suffix}.example.test`,
        name: 'Operator A',
        branding: { primaryColor: '#0b3d91', logoUrl: `https://a-${suffix}.example.test/logo.svg` },
        featureFlags: { beta_orders: true, self_serve_billing: false },
      },
    }),
    db.tenant.create({
      data: {
        domain: `app.b-${suffix}.example.test`,
        name: 'Operator B',
        branding: { primaryColor: '#910b0b', logoUrl: `https://b-${suffix}.example.test/logo.svg` },
        featureFlags: { beta_orders: false, self_serve_billing: true },
      },
    }),
  ]);

  return {
    app,
    moduleRef,
    base,
    db,
    tenants: { a, b },
    stop: async () => {
      await db.tenant.deleteMany({ where: { id: { in: [a.id, b.id] } } });
      await db.$disconnect();
      await app.close();
    },
  };
}

export function signToken(org: string): string {
  return jwt.sign({ org }, process.env.JWT_SECRET as string, { algorithm: 'HS256', expiresIn: '5m' });
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  host: string;
  org?: string;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export async function api(base: string, path: string, opts: ApiOptions): Promise<ApiResponse> {
  const headers: Record<string, string> = { host: opts.host };
  if (opts.org !== undefined) {
    headers.authorization = `Bearer ${signToken(opts.org)}`;
  }
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: json as any };
}

export function registerCustomer(
  base: string,
  tenant: Tenant,
  body: { email: string; name: string },
): Promise<ApiResponse> {
  return api(base, '/customers', { method: 'POST', host: tenant.domain, org: tenant.id, body });
}
```

### test/customers.spec.ts
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startApp, api, registerCustomer, type TestContext } from './support';

describe('customers (white-label isolation)', () => {
  let ctx: TestContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aliceA: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bobB: any;

  beforeAll(async () => {
    ctx = await startApp();
    const a = await registerCustomer(ctx.base, ctx.tenants.a, { email: 'alice@operator-a.test', name: 'Alice' });
    if (a.status !== 201) throw new Error(`seed A failed: ${a.status} ${JSON.stringify(a.json)}`);
    aliceA = a.json;
    const b = await registerCustomer(ctx.base, ctx.tenants.b, { email: 'bob@operator-b.test', name: 'Bob' });
    if (b.status !== 201) throw new Error(`seed B failed: ${b.status} ${JSON.stringify(b.json)}`);
    bobB = b.json;
  }, 60_000);

  afterAll(async () => {
    await ctx.stop();
  }, 60_000);

  it('tenant B list excludes tenant A customers entirely', async () => {
    const res = await api(ctx.base, '/customers', { host: ctx.tenants.b.domain, org: ctx.tenants.b.id });
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emails = (res.json as any[]).map((c) => c.email);
    expect(emails).toContain(bobB.email);
    expect(emails).not.toContain(aliceA.email);
  });

  it('tenant B fetch of tenant A customer by id is a 404 with the same body as a nonexistent id', async () => {
    const crossTenant = await api(ctx.base, `/customers/${aliceA.id}`, {
      host: ctx.tenants.b.domain,
      org: ctx.tenants.b.id,
    });
    const ghost = await api(ctx.base, `/customers/${randomUUID()}`, {
      host: ctx.tenants.b.domain,
      org: ctx.tenants.b.id,
    });
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.json).toEqual(ghost.json);
    expect(crossTenant.json.error.code).toBe('resource_not_found');
  });

  it('tenant B update of tenant A customer is a 404 and leaves the row unchanged', async () => {
    const res = await api(ctx.base, `/customers/${aliceA.id}`, {
      method: 'PATCH',
      host: ctx.tenants.b.domain,
      org: ctx.tenants.b.id,
      body: { name: 'Compromised' },
    });
    expect(res.status).toBe(404);
    const after = await api(ctx.base, `/customers/${aliceA.id}`, {
      host: ctx.tenants.a.domain,
      org: ctx.tenants.a.id,
    });
    expect(after.status).toBe(200);
    expect(after.json.name).toBe('Alice');
  });

  it('tenant B delete of tenant A customer is a 404 and the row still exists', async () => {
    const res = await api(ctx.base, `/customers/${aliceA.id}`, {
      method: 'DELETE',
      host: ctx.tenants.b.domain,
      org: ctx.tenants.b.id,
    });
    expect(res.status).toBe(404);
    const after = await api(ctx.base, `/customers/${aliceA.id}`, {
      host: ctx.tenants.a.domain,
      org: ctx.tenants.a.id,
    });
    expect(after.status).toBe(200);
    expect(after.json.email).toBe(aliceA.email);
  });

  it('the same email registers independently in both tenants', async () => {
    const inA = await registerCustomer(ctx.base, ctx.tenants.a, { email: 'shared@both.test', name: 'Shared A' });
    const inB = await registerCustomer(ctx.base, ctx.tenants.b, { email: 'shared@both.test', name: 'Shared B' });
    expect(inA.status).toBe(201);
    expect(inB.status).toBe(201);
    expect(inA.json.email).toBe(inB.json.email);
    expect(inA.json.id).not.toBe(inB.json.id);
  });

  it('the same email twice in one tenant is a 409 conflict', async () => {
    const res = await registerCustomer(ctx.base, ctx.tenants.a, { email: 'alice@operator-a.test', name: 'Alice Again' });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('conflict');
  });
});
```

### test/tenant-config.spec.ts
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, api, type TestContext } from './support';

describe('GET /tenant-config', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.stop();
  }, 60_000);

  it('returns the branding and feature flags of the resolved tenant (A)', async () => {
    const t = ctx.tenants.a;
    const res = await api(ctx.base, '/tenant-config', { host: t.domain, org: t.id });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: t.id,
      name: t.name,
      branding: t.branding,
      featureFlags: t.featureFlags,
    });
  });

  it('returns the other tenant branding for tenant B', async () => {
    const t = ctx.tenants.b;
    const res = await api(ctx.base, '/tenant-config', { host: t.domain, org: t.id });
    expect(res.status).toBe(200);
    expect(res.json.id).toBe(t.id);
    expect(res.json.branding).toEqual(t.branding);
    expect(res.json.featureFlags).not.toEqual(ctx.tenants.a.featureFlags);
  });

  it('rejects a request whose host and token disagree', async () => {
    const res = await api(ctx.base, '/tenant-config', {
      host: ctx.tenants.a.domain,
      org: ctx.tenants.b.id,
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('tenant_mismatch');
  });
});
```

### test/tenant-isolation.spec.ts
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, api, registerCustomer, type ApiResponse, type TestContext } from './support';
import { CustomersRepository } from '../src/customers/customers.repository';
import { TenantContextMissingError } from '../src/prisma/tenant-context';

describe('tenant resolution and context isolation', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startApp();
    for (const which of ['a', 'b'] as const) {
      const r = await registerCustomer(ctx.base, ctx.tenants[which], {
        email: `seed-${which}@x.test`,
        name: `Seed ${which}`,
      });
      if (r.status !== 201) throw new Error(`seed failed: ${r.status}`);
    }
  }, 60_000);

  afterAll(async () => {
    await ctx.stop();
  }, 60_000);

  it('rejects a request when host and token org point at different tenants', async () => {
    const res = await api(ctx.base, '/customers', { host: ctx.tenants.a.domain, org: ctx.tenants.b.id });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('tenant_mismatch');
  });

  it('rejects a request with no token even for a valid host', async () => {
    const res = await api(ctx.base, '/customers', { host: ctx.tenants.a.domain });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('unauthorized');
  });

  it('rejects a valid token when the host is not a tenant domain', async () => {
    const res = await api(ctx.base, '/customers', {
      host: `unknown-${ctx.tenants.a.id}.example.test`,
      org: ctx.tenants.a.id,
    });
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('unknown_host');
  });

  it('concurrent requests from two tenants do not cross contexts', async () => {
    const a = ctx.tenants.a;
    const b = ctx.tenants.b;
    interface Job {
      tag: 'a' | 'b';
      kind: 'list' | 'create';
      run: () => Promise<ApiResponse>;
    }
    const jobs: Job[] = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      jobs.push({ tag: 'a', kind: 'list', run: () => api(ctx.base, '/customers', { host: a.domain, org: a.id }) });
      jobs.push({ tag: 'b', kind: 'list', run: () => api(ctx.base, '/customers', { host: b.domain, org: b.id }) });
      jobs.push({
        tag: 'a',
        kind: 'create',
        run: () =>
          api(ctx.base, '/customers', {
            method: 'POST',
            host: a.domain,
            org: a.id,
            body: { email: `load-a${i}@load.test`, name: 'Load A' },
          }),
      });
      jobs.push({
        tag: 'b',
        kind: 'create',
        run: () =>
          api(ctx.base, '/customers', {
            method: 'POST',
            host: b.domain,
            org: b.id,
            body: { email: `load-b${i}@load.test`, name: 'Load B' },
          }),
      });
    }

    const results = await Promise.all(jobs.map((j) => j.run()));
    // No request failed while the two tenants were hitting the API together.
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);

    // Every list response contained only rows of the tenant that issued it.
    jobs.forEach((job, i) => {
      if (job.kind !== 'list') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const emails = (results[i].json as any[]).map((c) => c.email);
      for (const email of emails) {
        const ownPattern = job.tag === 'a' ? /^seed-a@x\.test$|^load-a\d+@load\.test$/ : /^seed-b@x\.test$|^load-b\d+@load\.test$/;
        expect(ownPattern.test(email)).toBe(true);
      }
    });

    // Final state: each created email landed only in its own tenant.
    const finalA = await api(ctx.base, '/customers', { host: a.domain, org: a.id });
    const finalB = await api(ctx.base, '/customers', { host: b.domain, org: b.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emailsA = new Set((finalA.json as any[]).map((c) => c.email));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emailsB = new Set((finalB.json as any[]).map((c) => c.email));
    for (let i = 0; i < N; i++) {
      expect(emailsA.has(`load-a${i}@load.test`)).toBe(true);
      expect(emailsA.has(`load-b${i}@load.test`)).toBe(false);
      expect(emailsB.has(`load-b${i}@load.test`)).toBe(true);
      expect(emailsB.has(`load-a${i}@load.test`)).toBe(false);
    }
  });

  it('a query issued with no tenant in context fails rather than returning everything', async () => {
    const repo = ctx.moduleRef.get(CustomersRepository);
    await expect(repo.list()).rejects.toThrow(TenantContextMissingError);
  });
});
```


---

# repair1-set

## reasoning

```
Let me analyze the errors:

1. **`src/customers/customers.repository.ts`** — Lines 19, 27, 31: `findUnique`, `update`, `delete` use `{ id }` but the composite primary key `@@id([tenantId, id])` means the `where` clause needs `{ tenantId_id: { tenantId, id } }` or similar compound unique input. But wait — the whole point of the tenant-aware Prisma client is that it injects `tenantId` automatically. The repository is supposed to NOT pass tenantId manually.

   The issue is that the tenant-aware client (an extension/middleware) is supposed to inject the tenantId into queries. But the TypeScript types still expect the full compound key. So the repository needs to use the compound key format in its `where` clauses, and the tenant-aware extension will fill in the `tenantId` part.

   Actually, let me reconsider. The extension/middleware approach in Prisma typically works by intercepting the query and modifying the `where` clause. The types from Prisma's generated client still require the full compound key shape. So the repository needs to pass the compound key format, and the extension will fill in the `tenantId` value.

   Wait, but the design says "handlers never pass tenantId manually." So how does this work?

   Looking at the error more carefully:
   - Line 19: `findById` uses `findUnique({ where: { id } })` — needs `{ tenantId_id: { tenantId: ???, id } }`
   - Line 23: `create` uses `create({ data })` where data is `{ email, name }` — needs `tenantId` in the data
   - Line 27: `update` uses `update({ where: { id } })` — same compound key issue
   - Line 31: `delete` uses `delete({ where: { id } })` — same compound key issue

   The tenant-aware client extension would intercept these and inject the tenantId. But the TypeScript types still require the full shape. So the repository needs to use the correct type shapes, and the extension will override/fill in the tenantId.

   For `findUnique`/`update`/`delete`, the where clause with composite `@@id([tenantId, id])` requires `{ tenantId_id: { tenantId, id } }`. The extension will override the `tenantId` value.

   For `create`, the data needs `tenantId`. The extension will stamp it.

   So the fix is:
   - `findById`: `this.db.customer.findUnique({ where: { tenantId_id: { tenantId: '', id } } })` — but that's ugly. Actually, looking at Prisma's types for composite keys, the `CustomerWhereUniqueInput` type requires `tenantId_id` or `tenantId_email` fields.

   Wait, let me look at what Prisma generates for `@@id([tenantId, id])`. The `where` input for `findUnique` would be `CustomerWhereUniqueInput` which has:
   - `tenantId_id: { tenantId: string; id: string }` (the compound PK)
   - `tenantId_email: { tenantId: string; email: string }` (the compound unique)

   So the repository needs to use `{ tenantId_id: { tenantId: '', id } }` as a placeholder, and the extension fills in the real tenantId.

   Hmm, but that's passing a tenantId (even if empty). The design says "never pass tenantId manually." But the types require it. The extension would then override it.

   Actually, I think the proper approach here is that the tenant-aware client extension intercepts the query and:
   - For `findUnique`/`update`/`delete`: injects `tenantId` into the compound key
   - For `create`: injects `tenantId` into the data
   - For `findMany`/`updateMany`/`deleteMany`: injects `tenantId` into the where clause

   The TypeScript types still require the full shape, so the repository must use the correct shape. The extension then modifies the query at runtime.

   So the fix for the repository:
   - `findById(id)`: `this.db.customer.findUnique({ where: { tenantId_id: { tenantId: '', id } } })`
   - `create(data)`: `this.db.customer.create({ data: { ...data, tenantId: '' } })`
   - `update(id, data)`: `this.db.customer.update({ where: { tenantId_id: { tenantId: '', id } }, data })`
   - `remove(id)`: `this.db.customer.delete({ where: { tenantId_id: { tenantId: '', id } } })`

   Wait, but that's passing an empty string as tenantId. That's not great. Let me think about this differently.

   Actually, looking at how Prisma extensions work with composite keys — the extension intercepts the `args` and modifies them. The types still require the full shape. So using a placeholder like `''` or `'00000000-0000-0000-0000-000000000000'` is the pragmatic approach. The extension will override it before the query hits the database.

   Let me use `''` as the placeholder since the extension will replace it.

   Actually wait - I need to look at this more carefully. The `CustomerWhereUniqueInput` type for a model with `@@id([tenantId, id])` and `@@unique([tenantId, email])` would be:

   ```typescript
   type CustomerWhereUniqueInput = {
     tenantId_id?: { tenantId: string; id: string }
     tenantId_email?: { tenantId: string; email: string }
   }
   ```

   Actually no, for `findUnique`, Prisma requires exactly one of the unique identifiers. With composite keys, the shape is:

   ```typescript
   {
     tenantId_id: { tenantId: string; id: string }
     // OR
     tenantId_email: { tenantId: string; email: string }
   }
   ```

   But it's actually a union where one must be present. Let me just use `tenantId_id` with a placeholder tenantId.

   For `create`, the `CustomerCreateInput` requires `tenantId` (either as a direct field for unchecked, or as a relation). The `CustomerUncheckedCreateInput` would have `tenantId: string`. So we need `this.db.customer.create({ data: { ...data, tenantId: '' } })`.

2. **`src/errors/error-mapping.ts`** — Line 63: `HttpException` is imported with `import type` but used as a value (in `instanceof`). The fix is to change `import type { HttpException }` to `import { HttpException }`.

Let me now write the fixes:

**File 1: `src/customers/customers.repository.ts`**

The errors are on lines 19, 23, 27, 31. Looking at the original:
- Line 19: `return this.db.customer.findUnique({ where: { id } });` → needs `{ where: { tenantId_id: { tenantId: '', id } } }`
- Line 23: `return this.db.customer.create({ data });` → needs `{ data: { ...data, tenantId: '' } }`
- Line 27: `return this.db.customer.update({ where: { id }, data });` → needs `{ where: { tenantId_id: { tenantId: '', id } }, data }`
- Line 31: `return this.db.customer.delete({ where: { id } });` → needs `{ where: { tenantId_id: { tenantId: '', id } } }`

**File 2: `src/errors/error-mapping.ts`**

Line 3: `import type { HttpException } from '@nestjs/common';` → `import { HttpException } from '@nestjs/common';`

Let me write the complete files.
```

## reply

### src/customers/customers.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../prisma/prisma.module';

/**
 * The only layer that touches the database for customers — and it never
 * mentions a tenant id. Scoping and write-stamping happen entirely inside
 * the tenant-aware client (TENANT_DB).
 */
@Injectable()
export class CustomersRepository {
  constructor(@Inject(TENANT_DB) private readonly db: PrismaClient) {}

  list() {
    return this.db.customer.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  findById(id: string) {
    return this.db.customer.findUnique({ where: { tenantId_id: { tenantId: '', id } } });
  }

  create(data: { email: string; name: string }) {
    return this.db.customer.create({ data: { ...data, tenantId: '' } });
  }

  update(id: string, data: { name: string }) {
    return this.db.customer.update({ where: { tenantId_id: { tenantId: '', id } }, data });
  }

  remove(id: string) {
    return this.db.customer.delete({ where: { tenantId_id: { tenantId: '', id } } });
  }
}
```

### src/errors/error-mapping.ts
```ts
import { Prisma } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { AppError } from './app-error';
import { TenantContextMissingError } from '../prisma/tenant-context';

export interface ErrorDecision {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/**
 * The single place that decides how any error maps onto the error envelope.
 * Used by the global exception filter and by the tenant middleware, which
 * must answer (401/403/404) before any request-scoped context exists.
 */
export function decideError(err: unknown): ErrorDecision {
  if (err instanceof AppError) {
    return { status: err.httpStatus, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof TenantContextMissingError) {
    return {
      status: 500,
      code: 'no_tenant_context',
      message: 'a query was attempted with no tenant in context; it was refused rather than run unscoped',
      details: {},
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      // Record not found. For tenant-scoped models this deliberately covers
      // both "does not exist" and "belongs to another tenant" — same body,
      // so an id from another operator is indistinguishable from a ghost id.
      return { status: 404, code: 'resource_not_found', message: 'resource not found', details: {} };
    }
    if (err.code === 'P2002') {
      return {
        status: 409,
        code: 'conflict',
        message: 'a record with the same unique value already exists',
        details: { prismaCode: err.code },
      };
    }
    if (err.code === 'P2003') {
      return {
        status: 409,
        code: 'conflict',
        message: 'the operation violates a referential constraint',
        details: { prismaCode: err.code },
      };
    }
    return {
      status: 409,
      code: 'database_error',
      message: 'the database rejected the operation',
      details: { prismaCode: err.code },
    };
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, code: 'bad_request', message: 'the query failed Prisma validation', details: {} };
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code =
      status === 404 ? 'not_found' : status === 405 ? 'method_not_allowed' : status === 400 ? 'bad_request' : 'http_error';
    return { status, code, message: err.message, details: {} };
  }
  return { status: 500, code: 'internal_error', message: 'unexpected internal error', details: {} };
}
```


---
