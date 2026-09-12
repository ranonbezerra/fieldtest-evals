# Transcript — 06-multi-tenant-isolation / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me carefully think through this task.

The task is variant A of a multi-tenant isolation evaluation:
1. Tenant resolution middleware: derive tenant from host + token's org claim (both must match), reject mismatches. Tenant is stored in a request-scoped context.
2. Structural isolation at the data layer: a tenant-aware Prisma client (extension/middleware) that scopes all reads and stamps all writes, and handlers never pass tenantId manually.
3. Schema for customers/plans/orders and tenant-scoped uniqueness (the same customer email can exist under two tenants).
4. `GET /tenant-config` — resolved tenant branding + feature flags.
5. Tests: tenant B can't list, fetch by ID (expect 404), update, or delete tenant A's row. Same email can be registered under both tenants. Concurrent requests from different tenants don't mix contexts.

Stack: TypeScript strict, Node 20+, NestJS, Prisma, Postgres, Vitest, pnpm, ESM `"type": "module"`.

Layout conventions:
```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
test/<feature>.spec.ts
```

Layers: controller validates input and calls the service. Zero business logic. Service holds the logic. Zero raw SQL, zero Prisma client calls. Repository is the only layer that touches the DB.

Naming: tables/columns in snake_case via @map/@@map. Endpoints kebab-case, plural. TS files kebab-case.role.ts. Classes PascalCase.

Error envelope: `{ "error": { "code", "message", "details" } }`, code is snake_case, details is an object, never null.

Wiring: providers in the module's providers. Providers used across modules are exported and imported. Controllers are declared in a module.

Migrations: every schema change ships with a migration. So a migration SQL file is needed — `prisma/migrations/<timestamp>_init/migration.sql`.

Configuration only from env vars. DATABASE_URL for Postgres.

Tests: Vitest. Test behaviour. Never assert only that a call happened.

Now, the tricky part: "tenant-aware Prisma client (extension/middleware) that scopes all reads and stamps all writes; handlers never pass tenantId manually". And "tenant is stored in a request-scoped context".

Key design challenge: how does the repository know the current tenant? Options:
- AsyncLocalStorage (ALS) — request-scoped context. NestJS's Request scope can also be used, but "request-scoped context" + concurrency safety suggests AsyncLocalStorage-based context. Actually, Nest's request-scoped DI works too, but the Prisma client itself isn't request-scoped… common patterns: a per-request Prisma client created inside a middleware with the extension bound to the tenantId, or an ALS-based tenant store read by the extension.

Let me think about what's cleanest and most testable:

Design 1: ALS-based context. A `TenantContext` class that wraps AsyncLocalStorage. A middleware (Nest middleware or plain express middleware) resolves tenant from host + JWT claim, sets up the ALS context, and then the Prisma extension (via `$extends`) reads the current tenant from the ALS. Reads get `where: { tenantId }` injected, writes get `tenantId` stamped.

But wait — the repository layer is "the only layer that touches the database" — the repository uses the Prisma client. If the extension is applied to the base client, we can create one tenant-aware client factory. In tests, we'll probably need to mock or use a real DB. We can't use a real DB in tests (no environment), so the tests probably use a mocked Prisma client, or… hmm.

Actually, how do tests work here? "Tenant B can't list, fetch by ID (expect 404), update, or delete tenant A's row" — this sounds like integration tests against a real DB (e2e with Postgres). But the test environment may not have Postgres… the task says to test behavior. For a fieldtest evaluation, the tests probably run against a real Postgres via DATABASE_URL. Hmm, but we can't assume. Let's think about what's most defensible.

Conventions say "config is only from env vars. DATABASE_URL for Postgres." So tests can create a PrismaClient using DATABASE_URL. Typical pattern for an evaluation like this: a test helper spins up an e2e app (NestFactory.create) with the real Prisma service pointing at a test database, creates test tenants, and hits endpoints via supertest, or calls services directly.

Given the constraints ("no tools, no shell, no file system"), I have to write the solution in one shot. I'll write tests as integration tests against a real Postgres (using `@nestjs/testing` + supertest, or direct service calls with an injected tenant context). But to be robust: the tests can use the app's actual PrismaClient. The evaluation harness likely provides DATABASE_URL. Or the tests can be unit tests that mock the repository.

Hmm. But "a test that only asserts a call happened is worse than no test" — so we need actual behaviour assertions. For behaviour like "tenant B can't fetch tenant A's row (404)", mocking the repository would make the test verify that the repository was called with the correct tenant… that's the implementation, not the behaviour. The behaviour is about the data-layer scoping. A real behaviour test needs a real (or simulated) DB with the scoping extension applied.

Alternative: I could write the Prisma extension as a pure function applied to a client, and in tests, I could… still need a DB.

Actually, a practical approach used in many evaluations: an in-memory fake that implements the scoping semantics? No — that tests the fake, not the extension.

Better: use a real Postgres in the integration tests via `PrismaClient`, with per-test tenant data setup and teardown. The test file is `test/multi-tenant.spec.ts` or `test/tenant-isolation.spec.ts`. Use supertest for HTTP-level tests (tenant-config, mismatch 401/403), and service-level tests for CRUD isolation.

Since there are no DB tools here, the tests will fail without a DB, but the evaluation likely provides one (the task explicitly mentions Postgres and DATABASE_URL). I'll structure it so the tests:
- Skip? No — "a test with no assertions is… worse than no test". Skipped tests are bad.
- Just require DATABASE_URL and create the schema via `prisma db push`? Can't run CLI from tests. Hmm.

Alternative: I can write the integration tests with the Nest app, and seed the DB directly with… raw SQL? "Zero raw SQL" applies to the service layer, and test files can do setup. But without a migration runner, tests need the schema. Options: tests assume the DB has been migrated (the evaluation harness runs `prisma migrate deploy` / `db push` before running tests — reasonable since the task says "every schema change ships with a migration").

Let me do this: `test/multi-tenant.spec.ts` uses `@nestjs/testing` to build the app with the real Prisma service (from the module), uses supertest against the HTTP surface for tenant resolution + tenant-config, and uses a tenant context runner + services for CRUD isolation tests. In `beforeAll`, clean the tables (delete all rows) using the repository or Prisma directly (in tests we can touch Prisma directly, that's test setup, not the app layer). Actually, to keep it clean, tests can use `prisma.$executeRaw`? Hmm, "the repository is the only layer that touches the database" — that's the app. In test setup, direct Prisma calls for fixture setup are common and acceptable. But to be safe, I could expose cleanup via the repository (e.g. a `deleteAll()` method? That's ugly). I think direct Prisma usage in test setup is fine, and I'll note it. Actually, I'll use the tenant-aware client to create seed data per tenant (which also tests stamping), and use the raw client for the cleanup.

Wait — but subtle: the seed data created via the tenant-aware client will have tenantId stamped. Good. For "same email can be registered under both tenants" — create a customer with email `shared@example.com` under tenant A and B; the tenant-scoped unique constraint must allow it (unique on [tenantId, email]).

Then the tests:
1. Tenant resolution: request with mismatched host/org claim → 401/403 with an error envelope code like `tenant_mismatch`. Missing org claim → 401 `unauthorized`. Unknown host → 404 `tenant_not_found`? Or 401? Let me define:
   - No/invalid token → 401 `unauthorized`.
   - Host doesn't resolve to a tenant → 404 `tenant_not_found`? Hmm, or 400 `unknown_tenant`. Let me pick `tenant_not_found` 404. Actually, the host→tenant mapping is… where do tenants live? Tenants need a table: `Tenant` with domain, name, branding (JSON), feature flags (JSON), and maybe a JWT `org` id or slug. The token's org claim must match the tenant. So the tenant table has an `id` (or slug) used in the `org` claim, plus `domain`.

   Resolution: take host → find tenant by domain (lowercased, trimmed, maybe strip port? keep it simple: exact match on normalized domain). Take token's org claim → must equal tenant.id (or slug). Both must match → 403 `tenant_mismatch`.

   Order: validate token first (401), then resolve host (404 tenant_not_found), then compare (403 tenant_mismatch).

2. Tenant config: `GET /tenant-config` returns branding + feature flags for the resolved tenant. Per the endpoint naming, "endpoints: kebab-case, plural" — but the task explicitly says `GET /tenant-config`, so we keep that (the task is explicit; the convention is overridden by the explicit instruction).

3. CRUD isolation: resources are customers, plans, orders. Do we need endpoints for those too? The task lists the schema for customers/plans/orders, and the tests require list/fetch/update/delete isolation. That implies we need HTTP endpoints, or at least service methods. The task only explicitly requires the `/tenant-config` endpoint. For the isolation tests, we can test at the service level (service holds the logic; tests can inject services and run under a tenant context). That's behaviour: "tenant B can't list tenant A's row" — the behaviour is in the data layer + service. Testing via services with an ALS context is a legitimate behaviour test against a real DB.

   But should I add REST endpoints for customers etc? The discipline says "do exactly what the task asks. Don't create files it doesn't ask for". Adding full CRUD controllers for 3 resources means more files. The tests can be service-level. Hmm, but "list, fetch by ID, update, delete" — service methods: `list`, `getById`, `update`, `remove` for at least customers. To show the isolation, I'll do customers fully (list/get/update/delete), and plans/orders via the same repository pattern. The tests focus on customers; maybe also a fetch-by-id for plans. Let me narrow: implement customer endpoints (since they're concrete resources), and plans and orders in schema + repository + service (no controllers? that's weird but fine — the resources exist in the schema; the service/repository layers exist; tests verify isolation).

   Hmm, wait, discipline: "don't create files it doesn't ask for". The task asks for schema of customers/plans/orders (so the schema is needed), structural isolation for all reads/writes (so repositories for all three), and the tests require list/fetch/update/delete — at minimum for one resource. To be safe and minimal-yet-complete, I'll implement:
   - Customers: controller (REST plural `customers`), service, repository.
   - Plans: service + repository (used in tests to create a plan; isolation test via service).
   - Orders: service + repository (schema + basic repo; tests create an order, maybe isolation check via service).

   Actually, is it OK to have services without controllers? Yes. The module provides them.

   Alternatively, make all three full CRUD controllers. More surface area but more "real". Given "build the whole solution", I think customers with full REST + plans/orders at service level is a defensible middle ground. Hmm, but actually let me reconsider: the tests only need one resource for the isolation matrix, plus the tenant-config endpoint. Let me do:
   - `customers` resource: controller + service + repository + module.
   - `plans`: service + repository (created for orders to reference).
   - `orders`: service + repository (references plan, customer).

   Actually, do orders need to reference plans? "Customers, plans, orders" — a natural schema: Order references Customer and Plan. Keep FKs within the tenant? Cross-tenant FKs are possible if both are in the same tenant, but to be safe, since everything is stamped with tenantId, FKs are fine. But tenant-scoped unique constraint… FKs are normal. To keep it simpler and avoid FK complexity (cascades, etc.), I could also make planId/customerId plain string columns without DB-level FKs, with tenant-scoped lookup in the service. Hmm. For an isolation-focused evaluation, plain columns reduce failure modes (e.g. FK cascade across tenant… no, the rows are tenant-scoped so the FKs stay in-tenant). I'll include real FKs to customer and plan for orders — wait, but if tenant B creates an order referencing tenant A's plan ID, the FK would succeed (row exists) and we'd create a cross-tenant reference. The service should validate that the referenced plan is within the tenant (the repository's tenant-scoped get returns undefined → service throws not_found). OK.

   Simpler: make it plain string IDs with no FK constraints, service validates. Hmm, but real FKs are more "correct". Let me weigh test complexity: with FKs, deleting a customer with orders cascades or fails. In the "delete tenant A's row" test from tenant B — tenant B's delete is scoped to tenant B, finds nothing → 404. Fine either way.

   I'll go with plain string id columns (no Prisma relation) for order.planId and order.customerId? Actually, in Prisma, relations are just extra convenience. I'll use plain `planId String @map("plan_id")` fields. Service validates tenant-scoped existence before creating an order. This keeps the data layer purely tenant-scoped without FK surprises. Defensible for an isolation evaluation. I'll note it? Maybe an ASSUMPTION comment: orders reference plans/customers via id fields without DB-level foreign keys, enforced in the service. That's a design choice, not an unresolved symbol. The ASSUMPTION marker is for "truly missing symbols" — this isn't that. I'll just implement it.

   Hmm, actually, reconsidering — should we use Prisma relations? Relations + tenant extension: an extension query interceptor also affects findMany on relations. Plain fields are simpler and less risky. Decision: plain fields.

4. Data-layer scoping: Prisma `$extends` with query interceptors.

Let me design the extension:

```ts
import { PrismaClient } from '@prisma/client';

export function withTenantIsolation<T extends PrismaClient>(base: T, getContext: () => TenantId) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // inject tenant into where
        }
      }
    }
  });
}
```

Details per operation:
- Reads (findMany, findUnique, findFirst, count, aggregate, groupBy?, update, updateMany, delete, deleteMany, upsert?): the task says "scope all reads and stamp all writes".
- Writes: create → args.data.tenantId = tenant. createMany → data is array or single → stamp each. upsert → create.data + update.where.

Implementation approach (widely used):

```ts
const tenantId = getCurrentTenant();
if (!tenantId) throw new Error('No tenant context');

switch (operation) {
  case 'findUnique':
  case 'findFirst':
  case 'update':
  case 'upsert': // handle where
    args = { ...args, where: { ...args.where, tenantId } };
    break;
  case 'findMany':
  case 'updateMany':
  case 'deleteMany':
  case 'count':
  case 'aggregate':
  case 'groupBy':
    args = { ...args, where: { ...args.where, tenantId } };
    break;
  case 'create':
    args = { ...args, data: { ...args.data, tenantId } };
    break;
  case 'createMany':
    args = { ...args, data: Array.isArray(args.data) ? args.data.map(d => ({...d, tenantId})) : { ...args.data, tenantId } };
    break;
  case 'delete':
    args = { ...args, where: { ...args.where, tenantId } };
    break;
}
```

But the Tenant model itself: should the extension scope the Tenant model? The tenant resolution middleware needs to find the tenant by domain before the context is set. So the Tenant model must be excluded from the scoping (it IS the tenant). Also, we'll need to look up a tenant by the org claim during mismatch checking — before the ALS is set. So the base client (without extension) is used in middleware/service for tenant lookup, and the scoped client is used in repositories for business data.

Cleaner: extension only applies to `Customer`, `Plan`, `Order` models, via `$allModels` with a model check, or by using per-model keys. `$extends` supports per-model: `query: { Customer: { ... }, Plan: { ... }, Order: { ... } }`. Using a `$allModels` with a guard `if (model === 'Tenant') return query(args)` is also fine. I'll use per-model configuration with a shared helper to avoid scoping Tenant. Or `$allModels` with early return. Let me do:

```ts
query: {
  $allModels: {
    async $allOperations({ model, operation, args, query }) {
      if (UNSCOPED_MODELS.has(model)) return query(args);
      ...
    }
  }
}
```

Hmm, `$allOperations` inside `$allModels` is valid.

Another important: `findUnique` with `where: { id }` + injected `tenantId` — that's not a unique where, and will Prisma error with "at least one argument required" in strict mode? No — `{ id, tenantId }` is fine (two fields in where). But `findUnique` with non-unique combinations: Prisma allows it (treated as AND of equals). Yes, that works.

But there's a gotcha: `findUniqueOrThrow` throws Prisma's P2025. I'll use `findFirst` instead to get undefined. Actually for fetch by ID expecting 404, the repository does `findFirst({ where: { id } })` → extension injects tenantId → returns null if other tenant → service maps to `resource_not_found`.

Another gotcha: the `count` operation's args have `where?`. Fine.

Also `updateMany`/`deleteMany`'s where. Fine.

And `upsert`: args have `where`, `create`, `update`. Inject tenantId into `where` and `create`. (The `update` data doesn't need tenantId since where already scopes it… wait, upsert's `update` applies to the row matched by where, so scoping where is enough.)

Now, where does the extension get the tenantId? From the ALS context:

```ts
const storage = new AsyncLocalStorage<Store>();
const tenantContext = {
  run(tenantId, fn) { return storage.run({ tenantId }, fn); },
  get() { return storage.getStore()?.tenantId; },
};
```

Middleware (Nest Middleware or plain Express): for each request, authenticate, resolve tenant, then `await tenantContext.run(tenantId, next)`. Nest middleware can return a promise; Nest supports async middleware via `await next()`. Yes, Nest supports `async use() { ... await next(); }`.

But the important part: NestJS's request-scoped providers vs ALS. The task says "tenant is stored in a request-scoped context". ALS is the most robust (also works for concurrency with overlapping async work). I'll implement `src/common/tenant-context.ts` (or `src/tenant/tenant-context.ts`). Hmm, layout: `src/<feature>/...`. Features here: `tenant` (middleware + tenant service + tenant-config controller), `customer`, `plan`, `order`, plus a `prisma` module for the client. Layout convention shows feature folders. Common infra: `src/common/` isn't in the layout but I can decide: "decide the file layout yourself". I'll keep feature-style:

- `src/prisma/prisma.module.ts` — Global? If it's a @Global() module that exports PrismaService, the feature modules don't need to import. The wiring convention says "providers used across modules are exported from their own module and imported by the other". A @Global() module is a NestJS mechanism; or each feature module imports PrismaModule. To follow the convention, I'll make PrismaModule non-global and have each feature module import it. Fine.

Let me define the components:

**prisma/schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id           String   @id @default(uuid()) @map("id")
  slug         String   @unique @map("slug")
  domain       String   @unique @map("domain")
  name         String   @map("name")
  branding     Json     @default("{}") @map("branding")
  featureFlags Json     @default("{}") @map("feature_flags")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("tenants")
}
```

Hmm, do I need both id and slug? The token's `org` claim — I'll use the tenant's `slug` as the org value (stable, human-readable). So the org claim = slug. Domain maps host→tenant. Slug is the org identifier. Good, one identity field is enough; id could just be the slug? Let me keep `id` as a cuid/uuid for FK-ish uses, and `slug` as the org claim. Simpler: make slug the id? Let me keep both; it's fine.

Wait, do tenants need to exist in the DB, or be env/config? For the test "tenant B can't…" and tenant-config returning branding, DB-backed tenants are natural. The tests need a tenant seed. The test setup will create tenants via the base Prisma client (or a tenant service `seed`? I'll add a small internal service method or just do it in the test setup with the base client — test setup code can use Prisma directly).

**Customer / Plan / Order models:**

```prisma
model Customer {
  id        String   @id @default(uuid()) @map("id")
  tenantId  String   @map("tenant_id")
  email     String   @map("email")
  name      String   @map("name")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("customers")
}
```

Same for Plan (name, price?), Order (customerId, planId, amount, status, total?).

**Tenant-scoped uniqueness**: `@@unique([tenantId, email])` — satisfies "the same customer email can exist under two tenants". Duplicate email in the same tenant → P2002 → service maps to `conflict` error code (e.g. `already_exists`). Good to handle for the "same email registered under both tenants" test — and also a negative: same tenant same email → conflict.

**Prisma service:**

`src/prisma/prisma.service.ts`:

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() { super({ datasourceUrl? }) }
}
```

Wait — the repository should get the tenant-aware client. Two clients or one? Options:

A) PrismaService extends base PrismaClient; repositories inject PrismaService and use `this.prisma.$extends(...)` — the extension is applied in the repository layer? No — the extension is the data-layer mechanism; better centralize.

B) `PrismaService` exposes:
   - `readonly base: PrismaClient` (for tenant lookup in middleware)
   - A way to get a tenant-scoped client. Since the extension reads the ALS at query time, we can apply the extension once at construction: `this.$extends`? Note: `PrismaClient.$extends` returns a new client. So:

```ts
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;
  private scoped: TenantScopedClient;
  async onModuleInit() { await this.client.$connect(); }
  onModuleDestroy() { return this.client.$disconnect(); }
}
```

But repositories shouldn't call PrismaClient directly — they call the repository, and the repository uses the PrismaService, and PrismaService is a wrapper. The layer rule is "service: zero Prisma client calls; repository: the only layer that touches the database". The PrismaService is the DB access infrastructure that lives in the prisma module — the repository uses it. That's the standard pattern that satisfies the layering.

Now, how do repositories use the scoped client without passing tenantId manually? The extension reads the ALS. So the repository just calls `this.prisma.scoped.customer.findMany({ where })`, and the tenant is injected from ALS.

But there's a subtlety: `$extends` creates a new client instance each time it's called; the connected instance is shared (the underlying $connect). Calling `$extends` once at module init is fine.

But in tests, when we `NestFactory.create(AppModule)`, the PrismaService will connect to the DB. The test environment needs DATABASE_URL. OK.

Alternatively, make the scoping part of a single client via `$use` middleware (deprecated-ish but works): `prisma.$use({ Query: async (params, next) => { inject tenant; return next(params); } })`. `$use` is deprecated in Prisma 5? I think `$use` still exists but is soft-deprecated in favor of extensions. Extension is the modern way. I'll use extension.

Now, the concurrency test: "concurrent requests from different tenants don't mix contexts". With ALS, each request runs in its own `storage.run(tenant, ...)` context, so even if interleaved, the correct tenant is used. Test: fire N concurrent customer lists/creates from tenants A and B (via HTTP or service-level `Promise.all` with `tenantContext.run`), and assert each response only contains its own tenant's rows.

At HTTP level: middleware wraps each request in ALS.run — express handles concurrent requests fine with ALS. So the concurrent HTTP test: create distinct customers in each tenant, then fire concurrent `GET /customers` + `POST /customers` for both tenants, and assert no cross-contamination.

Hmm wait, does ALS propagate through NestJS middleware → guard → interceptor → controller → service? AsyncLocalStorage.run propagates to all async operations that happen within that context, as long as there's no manual context loss (Nest uses standard promises — fine).

One caveat: Prisma client with extension — the query interceptor runs within the async call stack (Promise chain) of the request handler, so `storage.getStore()` inside the interceptor sees the tenant. Yes, this is a known working pattern.

**Middleware for tenant resolution:**

`src/tenant/tenant-resolution.middleware.ts`:

```ts
@ Injectable? no, Middleware.
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantService, private readonly auth: AuthService?) {}
  async use(req, res, next) {
    try {
      const tenantId = await this.resolve(req);
      tenantContext.run(tenantId, () => next());
      // wait: next() is the rest of the pipeline; must be called inside run so the whole request is within the context
    } catch (e) {
      map to error envelope and res.status(...).json(...)
    }
  }
}
```

Auth: JWT in the Authorization header. "The auth token carries the `org` claim". Verify JWT? We need a secret — env var `JWT_SECRET`. Parse and verify with `jsonwebtoken`. Then the org claim. If missing/invalid → 401 `unauthorized`.

Should we have a full AuthModule? The task only says the token carries an org claim; the minimum: a token verification utility inside the tenant feature (or `src/common/auth`). Let me create `src/tenant/auth.guard.ts`? No — middleware approach per the task: "tenant resolution middleware: derive the tenant from the host + the token's org claim (both must match); reject mismatches".

I'll implement:
- `src/tenant/jwt.util.ts`? Or use a small helper inside `src/tenant/`. To minimize files, put JWT verification in the middleware? The middleware is the appropriate place. But the controller "validates input"… auth is cross-cutting; middleware is explicitly requested. I'll put the token parsing in a small function within the middleware file, or in a `token.util.ts` within the tenant feature. Keep it in one middleware file with a private method. Hmm, the test needs to create tokens — the test will import `jsonwebtoken` directly (tests can). JWT_SECRET env — the test will set `process.env.JWT_SECRET = 'test-secret'` before app creation. Configuration from env vars only: the middleware reads `process.env.JWT_SECRET`. I could also use NestJS ConfigModule… not mentioned in the conventions; the env-var reading is fine. Actually, config via a provider that reads env at construction makes tests easier (override via token). But direct `process.env` in the service reads at construction time… let me just read process.env in the constructor of the relevant service (TokenService / middleware) — but reading in the constructor caches it; for tests that set env before creation, that's fine. Simpler: read in the method (always fresh) — for tests, set env in beforeAll. I'll read lazily via getter.

Tenant resolution logic (service: `TenantService`):
- `findByDomain(domain)` — base client (unscoped).
- `findBySlug(slug)`.
- `findById(id)`.
- `forTenantConfig(id)` → { id, slug, name, branding, featureFlags }.

Middleware flow:
1. Extract Bearer token → parse/verify JWT (HS256, secret from env). On failure → 401 `{ code: 'unauthorized' }`.
2. Read the `org` claim → if missing → 401 `unauthorized` (or `missing_org_claim`? keep the code simple: `unauthorized` with details).
3. Host: `req.headers.host` → strip port (e.g. `app.operator-x.com:3000` → `app.operator-x.com`). Normalize to lowercase.
4. `tenantByDomain = tenants.findByDomain(host)`; if none → 404 `tenant_not_found`.
5. `tenantByOrg = tenants.findBySlug(org)`; if none → 403 `tenant_mismatch` (the org claim doesn't match any tenant — treat as mismatch → 403; or 401? The token is valid but claims a non-existent org — I'll say 403 `tenant_mismatch` with details).
6. `tenantByDomain.id !== tenantByOrg.id` → 403 `tenant_mismatch`.
7. `tenantContext.run(tenant.id, () => next())`.

Error envelope for middleware errors: I'll create a helper `sendError(res, status, code, message, details)` in `src/common/errors.ts`? The error envelope is a global convention; I'll create a global exception filter that converts thrown `AppException` to the envelope. Middleware-level rejections (before the guard/handler) can also throw to the filter — if I throw inside middleware's use() (synchronous part), Nest's exception filter catches it? The exception filter catches exceptions from the middleware pipeline? In NestJS, a global exception filter catches exceptions thrown by any middleware in the app… actually, the exception filter is part of the Router-Explorer pipeline; exceptions from a middleware before route matching: the ExceptionsHandler (global filter) is wired in the MiddlewareModule — does an exception in middleware propagate to the global filter? Let me recall: NestJS global exception filters apply to exceptions thrown in guards, interceptors, pipes, and controllers, and also middleware? Docs: "The exception filter is applied to… global exception filter catches exceptions thrown by any middleware, guard, interceptor, pipe, or handler." I believe an exception filter catches middleware exceptions when the middleware is bound via APP_FILTER (which is wired at the MiddlewareConsumer level?). Hmm. The actual behaviour: exceptions in `use()` of a middleware that runs before routing — I recall they are caught by the global exception filter. Because MiddlewareModule wraps… not 100% sure. Safer: in middleware catch errors and write the response directly (with the envelope), calling next() only on success. I'll do that — explicit and deterministic.

Also, errors from controllers/services: a global exception filter `src/common/exception-filter.ts` catches `AppError` (custom Error with code/status/details) and unknowns → 500 `internal_error`. Registered with `APP_FILTER`.

Where to place common files: the layout is `src/<feature>/...`. Common infra: `src/common/`. The layout block is a convention sketch, not exhaustive; "decide the file layout yourself". I'll use `src/common/` for error-filter + context + prisma module? Prisma module: `src/prisma/prisma.module.ts` + `prisma.service.ts` + `tenant-scope.ts` (extension). OK.

**Request-scoped context:** "tenant is stored in a request-scoped context" — I'll implement ALS-based `TenantContextService`? If we make it an @Injectable that holds the ALS instance, DI works, and repositories… no wait, repositories don't need the context service — the extension (applied to the prisma client) reads the ALS directly. The extension is a module-level function that references the same ALS. To share one ALS between the middleware (runs) and the extension (reads), I'll create a singleton ALS in a module file `src/common/tenant-context.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

export const tenantContext = {
  run<T>(tenantId: string, fn: () => T): T { return storage.run(tenantId, fn); },
  current(): string | undefined { return storage.getStore(); },
  require(): string { const t = storage.getStore(); if (!t) throw new TenantContextMissingError(); return t; }
};
```

Middleware does `tenantContext.run(id, () => next())` — wait, `next` must be called; `tenantContext.run(id, () => next())` returns the promise from next? Middleware: `use(req,res,next)` can return a Promise; Nest awaits it? For an async middleware, Nest awaits its promise. `async use(...) { ... await tenantContext.run(id, () => next()); }`.

Hmm, but subtle: does ALS context propagate into the continuation of `next()`? Yes — everything inside the run callback, including the downstream pipeline, runs within that context.

But important: the Prisma extension reads `tenantContext.current()` when the query interceptor runs. The interceptor runs within the repository call, which runs within the controller, which is inside `run()`. ✔.

For service-level tests (without HTTP), tests call `tenantContext.run(tenantId, () => service.list())`. ✔.

Now, does the extension throw or pass through when there's no context? If a repository is used without a tenant context (say, a tenant service using the base client — fine, the base client has no extension). If someone misuses the scoped client without a context: throw a clear error ("no tenant context") → filter maps to 500 or a specific code. I'll throw a `TenantContextMissingError` (a class of AppError with code `tenant_context_missing`, 500). Good defensive behaviour.

**Repositories:**

`src/customer/customer.repository.ts`:

```ts
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}
  list() { return this.prisma.tenant.customer.findMany({ orderBy: { createdAt: 'asc' } }); }
  findById(id) { return this.prisma.tenant.customer.findFirst({ where: { id } }); }
  findByEmail(email) { return this.prisma.tenant.customer.findFirst({ where: { email } }); }
  create(data: { email; name }) { return this.prisma.tenant.customer.create({ data }); }
  update(id, data) { return this.prisma.tenant.customer.update({ where: { id }, data }); }
  remove(id) { return this.prisma.tenant.customer.delete({ where: { id } }); }
}
```

Wait — `update` with a tenantId injected via extension: extension injects `where: {...where, tenantId}` — for the `update` operation, `where` is a unique where (id) — adding tenantId makes it a compound where; the Prisma `update` accepts a unique where — does `{ id, tenantId }` qualify as unique? `{id}` alone is unique (id is @id), so adding an extra equals field is fine — Prisma allows non-unique fields alongside? Prisma requires the where of update to be a unique input — actually, Prisma's `update` takes a `WhereUniqueInput`. `{ id: string, tenantId: string }` — is this assignable to WhereUniqueInput? Does WhereUniqueInput include all scalar fields in addition to the unique fields? Hmm, no. Let me think.

In Prisma, `CustomerWhereUniqueInput` is defined as a union: `{ id: string } | { tenantId_email: TenantIdEmail } | AND combinations...`. If we pass `{ id, tenantId }` — is that accepted? I recall Prisma accepting extra fields in unique where? In recent Prisma versions, `WhereUniqueInput` includes all fields in addition to the unique criteria (it's an intersection with "at least one unique field required" validation at the engine level). Hmm, actually, I remember that passing `{ id: 'x', tenantId: 'y' }` to `update` works — the generated `WhereUniqueInput` type includes all scalar fields (since Prisma 3.x, "compound where unique inputs" also allow extra fields; the type is the intersection `CustomerWhereInput & CustomerWhereUniqueInput`? Let me recall the generated types:

```ts
export type CustomerWhereUniqueInput = Prisma.AtLeast<{
  id?: string
  tenantId?: string
  tenantId_email?: CustomerTenantIdEmailCompoundUniqueInput
  AND?: ...
  OR?: ...
  NOT?: ...
}, "id" | "tenantId" | "tenantId_email" | ...>
```

Yes! Recent Prisma generates `WhereUniqueInput` with all scalar fields optional, `Prisma.AtLeast<..., unique fields>`. So `{ id, tenantId }` type-checks and works (WHERE id = ? AND tenant_id = ?).

So the injection pattern works for findUnique/update/delete (which take unique where).

For `findUniqueOrThrow` etc., same.

The widely-used generic approach is exactly this.

Now, a critical Prisma extension detail: the `query` function receives `args` and must call `query(args)`. Mutations: we must return the transformed args to `query`, and also handle that `args.data` can be a function? For `create`, data is an object or a PrismaPromise? (rare). I'll keep it to an object.

Also, the extension must handle `transaction` client — repository could use `$transaction`? I'll keep the repository to simple single operations; no $transaction needed.

**Tenant-scoped client in PrismaService:**

```ts
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly base = new PrismaClient();
  readonly tenant: ReturnType<...extends...>;
  constructor() {
    this.tenant = createTenantScopedClient(this.base);
  }
  get client() { return this.base; } // unscoped, for tenant lookups / seeding
  async onModuleInit() { await this.base.$connect(); }
  async onModuleDestroy() { await this.base.$disconnect(); }
}
```

Hmm wait, creating `new PrismaClient()` in the constructor — env for DATABASE_URL is needed at instantiation. In tests, env is set before the app is created. ✔. But `new PrismaClient()` in the constructor of a DI provider: fine.

Actually, cleaner: `class PrismaService extends PrismaClient` and `this.tenant = this.$extends(...)`. Extending keeps `$connect` on the base. Let me do:

```ts
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly tenant: TenantScopedClient;
  constructor() {
    super();
    this.tenant = this.$extends(tenantIsolationExtension);
  }
  ...
}
```

`$extends` on an instance returns a new client instance wrapping the same delegate. `this.tenant.customer.findMany()` works. ✔.

But typing: `this.$extends(...)` returns a typed extended client. Export the type: `type TenantScopedClient = ReturnType<typeof createTenantScoped>` — define in `src/prisma/tenant-scope.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

export function applyTenantScope<T extends PrismaClient>(client: T) {
  return client.$extends({ query: { $allModels: { $allOperations: async (ctx) => {...} } } });
}
export type TenantScopedClient = ReturnType<typeof applyTenantScope<PrismaClient>>;
```

Hmm, `typeof applyTenantScope<PrismaClient>` — generic instantiation on typeof requires TS 4.7+ (`typeof f<T>`). TS strict, Node 20 — TS version is likely ≥5. OK, but simpler: define a return type via explicit annotation or just use the inferred type in PrismaService (the type of the property is inferred). The repository uses the `prisma.tenant.customer` property — inference flows. Fine, no explicit type export needed.

Extension code with per-operation handling:

```ts
const READ_OPERATIONS = new Set(['findMany','findFirst','findUnique','count','aggregate','groupBy']);
const WHERE_OPERATIONS = new Set(['update','updateMany','delete','deleteMany','findMany','findFirst','findUnique','count','aggregate']);

function scopedArgs(model, operation, args, tenantId) {
  const a = { ...args };
  if (READ_WITH_WHERE.has(operation)) a.where = { ...args.where, tenantId };
  ...
}
```

Let me write it explicitly:

```ts
export const tenantScope = {
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }: any) {
        if (model === 'Tenant') return query(args);
        const tenantId = tenantContext.require();
        const a = { ...args } as Record<string, any>;
        switch (operation) {
          case 'findMany':
          case 'findFirst':
          case 'findUnique':
          case 'count':
          case 'aggregate':
          case 'groupBy':
          case 'updateMany':
          case 'deleteMany':
            a.where = { ...(a.where ?? {}), tenantId };
            break;
          case 'update':
          case 'delete':
            a.where = { ...(a.where ?? {}), tenantId };
            break;
          case 'create':
            a.data = { ...a.data, tenantId };
            break;
          case 'createMany':
            a.data = Array.isArray(a.data) ? a.data.map(d => ({ ...d, tenantId })) : { ...a.data, tenantId };
            break;
          case 'upsert':
            a.where = { ...(a.where ?? {}), tenantId };
            a.create = { ...a.create, tenantId };
            break;
          default:
            // unknown operation: fail closed
            throw new Error(`tenant-scope: unsupported Prisma operation "${operation}" on ${model}`);
        }
        return query(a);
      },
    },
  },
};
```

Fail-closed on unknown operations = important for isolation (new operations don't silently bypass the scope).

TypeScript strict: the type of the interceptor's `args` is a specific type; using `any` pragmatically. Fine with a comment. Or use a typed context. The extension type is complex; I'll use a minimal structural type for the context parameter:

```ts
type QueryContext = {
  model: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};
```

And cast internally. OK.

**Tenant feature:**

`src/tenant/tenant.module.ts`:
- Providers: TenantService, TenantRepository, TenantResolutionMiddleware (as a provider),
- Controllers: TenantConfigController
- Imports: PrismaModule
- Exports: TenantService (so tests can seed? Tests could also use the PrismaModule client directly, but exporting TenantService is harmless. Export it anyway.)
- The module also has a `configure(consumer)`: `consumer.apply(TenantResolutionMiddleware).forRoutes('*')`.

Wait — should the middleware apply to all routes? All routes need a tenant (tenant-config too). Yes, `forRoutes('*')`.

`src/tenant/tenant.repository.ts`:

```ts
@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}
  findByDomain(domain: string) { return this.prisma.client.tenant.findUnique({ where: { domain } }); }
  findBySlug(slug: string) { return this.prisma.client.tenant.findUnique({ where: { slug } }); }
  findById(id: string) { return this.prisma.client.tenant.findFirst({ where: { id } }); }
  create(data) { return this.prisma.client.tenant.create({ data }); }
}
```

Uses the unscoped client (this is the tenant registry itself). Note: "repository is the only layer that touches the database" — ✔.

`src/tenant/tenant.service.ts`:
- `resolve(req-ish inputs)`: takes { domain, orgClaim } and returns the tenant id or throws AppError:
  - domain tenant lookup → if none → AppError 404 `tenant_not_found`.
  - org lookup → if none → AppError 403 `tenant_mismatch`.
  - compare → if different → 403 `tenant_mismatch`.
  - return tenant.
- `configFor(tenantId)` → fetch by id → if none, 404 `resource_not_found` (shouldn't happen after middleware) → return { branding, featureFlags, name?, slug? }.

`src/tenant/tenant-config.controller.ts`:

```ts
@Controller('tenant-config')
export class TenantConfigController {
  @Get()
  config() { ... }
}
```

The controller needs the current tenant id — from where? Request-scoped context: `tenantContext.current()`. Controllers may read the context (that's context, not business logic). Or the service takes a tenantId param and the controller gets it from the context. The task says "handlers never pass tenantId manually" (about the data layer). But cleaner: the service method `configForCurrentTenant()`? Then the service depends on the context. Hmm — "tenant is stored in a request-scoped context" suggests reading the context in the controller/service is OK. But the layering: controller calls the service; the service reads the ALS? The service holds the logic; reading the ambient context is fine. But testability: service-level tests will run inside `tenantContext.run(...)` anyway.

Decision: the service methods don't take tenantId and use the scoped client + ambient context. `TenantService.configForCurrentTenant()`. Hmm, but `resolve` is called from the middleware before the context is set (with an explicit domain/org input) — that's a separate method with explicit parameters (no ambient). That's fine: resolution is inherently pre-context.

Actually wait — for other resources, should the service read the ambient context, or receive a tenantId from the controller? "Handlers never pass tenantId manually" — so the service/repository must not receive tenantId. The ambient context is the answer. ✔.

**Customer feature:**

Controller:

```ts
@Controller('customers')
export class CustomerController {
  @Get() list()
  @Get(':id') get(@Param('id'))
  @Post() create(@Body() dto: CreateCustomerDto)
  @Patch(':id') update(@Param('id'), @Body())
  @Delete(':id') remove(@Param('id'))
}
```

DTO validation: use class-validator + ValidationPipe? Adding a dependency… The controller "validates input". Minimal validation: manual check on the dto in the controller (email string non-empty, name string non-empty) → 400 `validation_failed`. Without adding the class-validator dependency, I can do light manual validation in the controller. Hmm, but typical Nest uses DTOs with pipes. The conventions don't mention class-validator. Manual validation in the controller keeps dependencies light (jsonwebtoken + nest + prisma + supertest for tests). I'll do manual validation with a small helper.

Actually, let me include class-validator + class-transformer + global ValidationPipe — that's standard NestJS and "controller validates input" fits perfectly. But it increases package.json deps. The task doesn't give package.json; we need to deliver "all files the solution requires" — does that include package.json? The layout doesn't list package.json but "everything you need for the solution" — the evaluation probably has a base project with a package.json. Hmm. "If files are given above the task, they are the existing codebase" — no files are given (the variant doc is reference only). So I'm building from scratch. Should I include package.json? The format says deliver all files the solution needs, complete. A NestJS+Prisma+Vitest solution needs a package.json, tsconfig.json, and probably a vitest config. I think I should include them: `package.json`, `tsconfig.json`, `tsconfig.build.json`? Keep minimal: package.json, tsconfig.json, vitest.config.ts (or config in package.json), .env? No secrets in the repo; no .env (the task says config from env; the evaluation provides DATABASE_URL; I can document a required env vars list in the file? No, no prose outside the pattern. A `.env.example`? "Don't create files it doesn't ask for"… but without package.json nothing runs. The instruction "deliver all files the solution needs" vs. "don't create files it doesn't ask for" — the solution needs package.json to exist. I'll include package.json, tsconfig.json, vitest.config.ts. Keep them tight.

package.json (ESM, Node 20+, pnpm):

```json
{
  "name": "white-label-tenant-app",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "migrate": "prisma migrate deploy",
    "migrate:dev": "prisma migrate dev"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@prisma/client": "^5.14.0",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.0",
    "@types/express": "^4.17.21",
    "@types/jest"? no — vitest,
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.12.0",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.14.0",
    "supertest": "^7.0.0",
    "ts-node"? not needed with vitest,
    "tsx"? vitest handles TS via esbuild,
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

ESM + NestJS: NestJS 10 works with ESM if you use `tsconfig` with `"module": "NodeNext"` and use import statements; there are known quirks (decorators, `emitDecoratorMetadata`). With Vitest, tests run via esbuild — decorators work? Vitest supports decorators? esbuild supports experimental decorators with the right setting… Hmm, Vitest (esbuild) supports TS experimental decorators? esbuild supports TS experimental decorators (they pass through to emit as… actually, esbuild has supported TS experimental decorators since v0.21? Let me think. esbuild supports `experimentalDecorators` from tsconfig? Historically, esbuild did not support TS experimental decorators; it added support in v0.21.0 (Dec 2023) — "Support for experimental TypeScript decorators" — yes, esbuild 0.21 supports experimentalDecorators. Vitest 1.x uses esbuild 0.19/0.20? Vitest 1.0 bundles esbuild 0.19… Vitest 1.6 bundles esbuild ~0.20.0? Hmm. esbuild 0.21.0 release notes: "Support for experimental TypeScript decorators". Vitest 2.x (Feb 2024) upgrades to esbuild 0.20/0.21. Vitest 2.1 uses esbuild 0.21? I think Vitest 2 uses esbuild ^0.21. So decorators should work.

But NestJS DI with ESM + metadata: NestJS with ESM needs `reflect-metadata` and `emitDecoratorMetadata` for constructor DI parameter types. esbuild does NOT support `emitDecoratorMetadata` (even with decorator support, esbuild does not emit metadata — actually, does esbuild 0.21+ also support emitDecoratorMetadata? No — esbuild added experimental decorator support but does not support emitDecoratorMetadata; it would require `useDefineForClassFields`… hmm).

Wait, this is getting risky. Let me recall the specifics:
- NestJS + ESM: documented approach uses `module: NodeNext`, `emitDecoratorMetadata: true`, TypeScript compiler; at runtime with the compiled JS it works.
- Vitest uses esbuild for TS transformation (no type-checking, no full tsc). esbuild does not support `emitDecoratorMetadata` — meaning constructor DI with implicit types breaks under Vitest? But wait — many people run NestJS tests with Jest+ts-jest (which supports metadata). With Vitest, there's a known problem: `emitDecoratorMetadata` isn't supported by esbuild, so NestJS DI fails to resolve parameters without explicit `@Inject()`.

Hmm, but actually esbuild 0.21 release notes: "esbuild now supports emitting decorator metadata"? Let me think hard. esbuild 0.21.0 (Dec 2023): "TypeScript experimental decorators" supported. I recall esbuild intentionally does not support emitDecoratorMetadata, and there's an open issue (#1535) about it. As of esbuild 0.23, still not supported. So under Vitest/esbuild, Nest constructor DI without @Inject will fail.

Mitigations:
1. Use `@Inject()` tokens with string tokens everywhere (ugly).
2. Use `tsconfig-paths`? Irrelevant.
3. Configure Vitest with `@swc/core` (via `vite-plugin`? Vitest supports `@vitest/plugin-swc`? There's `unplugin-swc` / `@vitejs/plugin-swc`, which does support emitDecoratorMetadata? SWC supports decorator metadata with `decoratorMetadata: true`). That adds complexity.
4. Test with Nest app but bypass DI metadata: in tests, `Test.createTestingModule({ imports: [AppModule] })` — the DI resolution is Nest's own, which relies on `design:paramtypes` metadata emitted at compile time. If metadata is missing, Nest throws "cannot resolve dependencies of X". So it breaks.
5. Alternative: don't rely on parameter type DI: always use explicit `@Inject('TOKEN')`? That deviates from normal Nest conventions.
6. Alternative: compile tests via tsc first, then run vitest on dist? Heavy.
7. Alternative: write the tests to instantiate services directly (manual wiring) and use the Nest app only via supertest for HTTP? The HTTP app still needs DI to work… Nest's app creation also needs metadata.

Hmm wait, actually — let me double-check: does esbuild now support emitDecoratorMetadata? Searching memory: esbuild issue #2705? PR "add support for emitDecoratorMetadata" — I genuinely believe as of 2024-2025, esbuild doesn't support it, and the recommended path for Nest+Vitest is either swc or ts-jest, or `@swc/core` via `vitest` config's `esbuild: { ... }`? Vitest's `esbuild` option just passes to esbuild's transform; no metadata support.

Hmm, but there's another wrinkle: `@prisma/client` types, etc. Not an issue.

Alternative approach to the test problem: use `@nestjs/testing` in tests? The DI metadata issue remains regardless of the testing module.

OK, another thought: maybe I'm wrong about Vitest+esbuild+NestJS — lots of projects run NestJS e2e tests on Vitest. How? They use `vitest.config.ts` with the `swc` plugin, or use `vite-tsconfig-paths`… The common working setup is: `@vitejs/plugin-swc` with `{ jsc: { transform: { decoratorMetadata: true }, parser: { syntax: 'typescript', tsx: false, decorators: true } } }`. Yes, that's the known recipe.

Alternatively, use ts-jest? The task mandates Vitest.

Decision: use `@vitejs/plugin-swc` in the vitest config with decoratorMetadata. Add dep `@vitejs/plugin-swc` and `@swc/core` (the plugin depends on it automatically, but list it to be safe? pnpm's strictness: the plugin declares its dependency on @swc/core, so no need to list).

vitest.config.ts:

```ts
import { defineConfig } from 'vitest/config';
import swc from '@vitejs/plugin-swc';

export default defineConfig({
  plugins: [swc({
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { decoratorMetadata: true, useDefineForClassFields: false },
      target: 'es2022',
    },
  })],
  test: { environment: 'node', include: ['test/**/*.spec.ts'] },
});
```

That's a defensible and working recipe for NestJS+Vitest+ESM.

Hmm, but wait: does SWC's `decoratorMetadata` emit `design:paramtypes`? Yes, with `decoratorMetadata: true`, SWC emits decorator metadata like tsc. And Nest's DI works.

Another ESM concern: `import 'reflect-metadata'` in main.ts (and test bootstrap) — required for decorator metadata. ✔.

ESM + relative imports: in `"type": "module"` with NodeNext, TS requires `.js` extension on relative imports in compiled output. This is a pain: `import { PrismaService } from '../prisma/prisma.service.js'`. Under tsc NodeNext, we need to write `.js` extensions in source. Under Vitest/SWC (vite resolver), the `.js` extensions resolve to `.ts` files — vite handles that (vite resolves `./foo.js` → `./foo.ts`? Vite has supported this for TS projects since ~3.x? Yes, vite natively resolves `.js` → `.ts` in import specifiers). So writing `.js` extensions on relative imports works for both tsc (NodeNext) and Vite.

Alternatively, use `"module": "ESNext"` + `"moduleResolution": "Bundler"` and no extensions, and run the app with `node dist`? The compiled ESM needs extensions at runtime… `node dist/main.js` with extensionless imports will fail at runtime. So for an ESM Node runtime, we need `.js` extensions on relative imports. Decision: use `.js` extensions on all relative imports, tsconfig `module: NodeNext, moduleResolution: NodeNext`.

Wait, but the convention says "ESM, `"type": "module"`" — so yes, NodeNext with extensions is the correct setup.

Also `verbatimModuleSyntax`? I'll skip. Keep tsconfig:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "useDefineForClassFields": false
  },
  "include": ["src"]
}
```

`useDefineForClassFields: false` is important for NestJS (class fields + decorator metadata; Nest docs recommend false? Actually, NestJS's default tsconfig uses `useDefineForClassFields: false`? Nest's default has `"useDefineForClassFields": false`? The default nest tsconfig doesn't include it… for a target ES2022, `useDefineForClassFields` defaults to true when target >= ES2022, which breaks DI (fields with undefined initializers). Hmm: NestJS + ES2022 + class fields: `private readonly prisma: PrismaService` (no initializer) — with useDefineForClassFields true, the class defines the field as undefined, overriding… no wait, the problem is: with `define` semantics, declared fields without initializers are set to undefined after the constructor super, but DI assigns via `Reflect.defineMetadata`? Nest instantiates with `new` and assigns properties after construction? Nest's DI: it calls `new Ctor(...deps)` — constructor parameter assignment happens inside the constructor (the class field `this.prisma = prisma` is a constructor parameter property). Parameter properties (`constructor(private readonly x: X)`) are assigned in the constructor body — before or after field definitions? With define semantics, field definitions (initializers) run before the constructor body. The field declaration without initializer under `declare`? In TS, `constructor(private readonly x)` is a parameter property — the assignment happens in the constructor body, and that runs after field initializers, so the assignment overrides. Parameter properties are fine either way. The issue is with fields declared with `declare` or with initializers. To be safe, I'll set `useDefineForClassFields: false`. And I'll avoid non-parameter-property class fields where possible.

For SWC: `transform.useDefineForClassFields: false` in the vitest config — matches.

**Prisma client + ESM:** Prisma 5 generated client works with ESM.

**Now, migrations:** "Every schema change ships with a migration". I need to include `prisma/migrations/20240101000000_init/migration.sql`. Let me write SQL that matches the schema:

```sql
-- CreateEnum? none.
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branding" JSONB NOT NULL DEFAULT '{}',
    "feature_flags" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" ...,
    "updated_at" ...,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_tenant_id_name_key" ON "plans"("tenant_id", "name");
CREATE INDEX "plans_tenant_id_idx" ON "plans"("tenant_id");

CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "created_at" ...,
    "updated_at" ...,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");
```

Prisma uuid() with provider postgres → `@default(uuid())` generates a TEXT column with a default… actually, Prisma's `uuid()` default in the migration SQL: Prisma uses `gen_random_uuid()` for `@default(uuid())`? In a migration, Prisma emits `DEFAULT gen_random_uuid()`? Hmm, Prisma uses `gen_random_uuid()` (pgcrypto? built-in in PG13+). Migration: `id TEXT NOT NULL DEFAULT gen_random_uuid()`. I'll write that.

Also a `_prisma_migrations` table — Prisma manages it; I don't hand-write it in migration.sql. `prisma migrate deploy` will track it. Fine.

Do I need `@prisma/migrations`? No.

Hmm, one question: should I ship a migration at all without being able to run prisma? The convention says yes. I'll hand-write `prisma/migrations/20240601000000_init/migration.sql` matching the schema. Risk: drift between the schema and the hand-written SQL. I'll be careful to keep them in sync. The evaluation probably runs `prisma migrate deploy` or `db push` before tests. Or maybe tests use `prisma db push`. I'll make the migration SQL consistent with the schema.

**main.ts:**

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix? no.
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

PORT from env — fine (config from env).

**app.module.ts:**

```ts
@Module({
  imports: [PrismaModule, TenantModule, CustomerModule, PlanModule, OrderModule],
})
export class AppModule {}
```

**Exception filter + AppError:**

`src/common/app-error.ts`:

```ts
export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
```

Filter:

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (exception instanceof AppError) {
      res.status(exception.status).json({ error: { code: exception.code, message: exception.message, details: exception.details } });
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      map P2002 → 409 conflict 'already_exists', P2025 → 404 'resource_not_found', else 500
    } else {
      500 'internal_error'
    }
  }
}
```

Register the filter via an APP_FILTER provider in AppModule so it's also present in test app creation: in `app.module.ts`: `providers: [{ provide: APP_FILTER, useValue: new AllExceptionsFilter() }]`. Then no `useGlobalFilters` needed in main.ts (but it's harmless to keep only the APP_FILTER). I'll use APP_FILTER in the module. ✔ (tests get it automatically).

But middleware errors: the middleware writes directly (before route guards) — the filter may not catch middleware exceptions (as mentioned). The middleware catches its own AppErrors and writes the envelope via a shared helper `writeError(res, err)`. Actually, cleaner: the middleware tries `await tenantContext.run(id, () => next())`, and on catch calls the same envelope writer. Let me make a helper in `src/common/errors.ts`:

```ts
export function writeJsonError(res: Response, status, code, message, details = {}) {
  if (!res.headersSent) res.status(status).json({ error: { code, message, details } });
}
```

And the filter uses the same. The envelope shape is consistent: `details` is always an object (default {}).

**Now, the JWT part:** The token carries `org`. Verify with `jsonwebtoken.verify(token, secret, { algorithms: ['HS256'] })`. Secret from `process.env.JWT_SECRET`. If no secret configured → treat auth as 500? For robustness: if no JWT_SECRET → 500 `internal_error` with message "JWT_SECRET is not configured". Tests will set it.

Token payload: `{ org: 'operator-a', ... }`. `org` claim = tenant slug.

Where to place token parsing: middleware. But the test also needs to issue tokens: use jsonwebtoken directly in the test. ✔.

Hmm — should the middleware be a Nest middleware class or an express middleware via `app.use()`? Nest middleware is idiomatic and wires into the module. I'll implement it as a NestMiddleware, registered via a Module configure().

Wait, one gotcha: with `tenantContext.run(id, () => next())` — `next()` returns void; Nest's pipeline continues internally; the ALS context is set during the downstream execution because it's all within the same synchronous/async continuation of the run callback. The downstream handler is invoked synchronously by next() (the express router synchronously invokes the matched handler in the same tick, and the async continuations inherit the context). ✔.

But: Nest's middleware runs in the MiddlewareModule context — the ALS run there propagates to the router context. ✔ (async_hooks propagate across promise boundaries within the context).

One more: Nest may wrap the middleware with its own interceptor pipeline that uses `Promise.resolve` — all fine with ALS.

**Concurrency test details:** Fire concurrent requests: `Promise.all([supertest(agent).get('/customers').set('Host','app.operator-a.com').set('Authorization', tokenA), ...B..., and a POST create for each])`. Then assert list responses only contain that tenant's rows. With real DB + ALS, this verifies context isolation. Also, an interleaved service-level test using `Promise.all` with `tenantContext.run` and `setImmediate` interleaving? HTTP-level is stronger and simpler.

Also a direct "context leak" test: sequentially run a tenant A request, then a B request, and confirm no residual. The concurrent one covers it.

**Test file layout:** `test/tenant-isolation.spec.ts`? The convention: `test/<feature>.spec.ts`. I could split:
- `test/tenant-resolution.spec.ts` (auth failures, mismatch, unknown host, tenant-config contents, config per tenant)
- `test/customer-isolation.spec.ts` (CRUD isolation matrix, same email across tenants, concurrency)

Two test files, each building its own app? Building the Nest app twice is fine but slow; or one file with describes. For tidiness, two files with a shared helper `test/helpers.ts`:

`test/helpers.ts`:
- `createTestApp()`: set env (JWT_SECRET, DATABASE_URL assumed), `Test.createTestingModule({ imports: [AppModule] }).compile()`, `app.init()`, `app.getHttpServer()`.
- `issueToken(org)`.
- `seedTenants()`: create tenants via raw PrismaClient in the helper (test infra can use Prisma directly — it's a test fixture, and note the convention applies to the app layers).

Wait — but the PrismaService inside the app also creates a client. The helper uses its own `new PrismaClient()` for seeding/cleanup. Two connections — fine.

Hmm, but the app's PrismaService connects on `app.init()` (onModuleInit). If no DATABASE_URL in the test environment, it fails. The evaluation should provide it. I'll add a comment in the test file: requires a DATABASE_URL pointing at a test database (e.g. `prisma migrate deploy` applied). Maybe I should add `test.skipIf(!process.env.DATABASE_URL)`? "A test with no assertions is worse than no test" — a skip isn't an assertion, but it's an environment guard, defensible. Hmm, but the evaluation likely has a DB and expects tests to run. If it doesn't, a hard failure is bad. I'll use a clear failure message on connect? Simpler: if no DATABASE_URL, `describe.runIf`? I'll just proceed — the harness surely has a DB (the task mandates Postgres). Actually, I'll keep it simple: no skip logic; tests need the env.

Cleanup between tests: in beforeAll, delete all rows (orders, customers, plans, tenants) with a raw client; in afterAll, disconnect the app and raw client.

**Now, "concurrent requests from different tenants don't mix contexts" test:**

```ts
it('keeps concurrent requests from different tenants isolated', async () => {
  // seed: tenant A has customer 'a-only', tenant B has 'b-only'
  // fire concurrent GET /customers for A and B, plus concurrent POST /customers from both
  const [listA, listB, createdA, createdB] = await Promise.all([
    req.get('/customers').set(hostA).set(authA),
    req.get('/customers').set(hostB).set(authB),
    req.post('/customers').send({ email, name }).set(hostA).set(authA),
    req.post('/customers').send({...}).set(hostB).set(authB),
  ]);
  expect(listA.status).toBe(200);
  // all rows in listA have tenant A's customers only, etc.
});
```

Assertions: listA emails ⊆ tenant A's seeded + createdA; none equal tenant B's. And createdA.email in listB is absent.

Note: supertest against the http server: `request(app.getHttpServer())`.

**Service-level isolation test (tenant B fetches tenant A's row by id → 404):** via HTTP `GET /customers/:id` with B's credentials using A's customer id → 404 with envelope `resource_not_found`. ✔ HTTP-level covers list/fetch/update/delete:
- List: `GET /customers` as B → doesn't contain A's rows.
- Fetch: as B, `GET /customers/{aId}` → 404.
- Update: as B, `PATCH /customers/{aId}` → 404.
- Delete: as B, `DELETE /customers/{aId}` → 404.
- And B can operate on its own rows (positive): create/fetch/update/delete own rows → 201/200/200/200 (deletes return 200 with deleted? I'll make delete return `{ id }`? or 204? Simpler: 200 `{ "id": ... }`? Convention: endpoints plural kebab; response shape is free. I'll do: POST → 201 with the created object; GET list → 200 array; GET one → 200 object; PATCH → 200 object; DELETE → 204? 204 has no body; the error envelope doesn't apply. 204 is fine. Hmm, but asserting "deleted" — the subsequent GET 404. I'll use 204.

Update semantics: PATCH with `{ name?, email? }` — if email is provided and it exists in the tenant → 409 conflict. If row not found → 404. The update repository uses extension-scoped `update` (where id+tenant). If no rows → Prisma P2025 → the filter maps P2025 to 404 resource_not_found.

Hmm wait — mapping P2025 in the filter globally: P2025 from any model = row not found = `resource_not_found` 404. Reasonable as a global mapping. And P2002 → 409 `conflict` / `already_exists`. I'll map P2002 → 409 code `unique_constraint_violated`? The task's error example code: `resource_not_found`. I'll use `already_exists` for P2002. Good.

But note: services should throw AppError for domain-level not found (repository returns null → service throws AppError 404). For `update`/`delete`, the repository could call `update` directly and let P2025 bubble to the filter. That's fine — the filter handles it. Or the repository checks `findFirst` first (extra query). I'll rely on the filter mapping for update/delete (single query, atomic). Actually, a subtlety: `delete` returns the deleted row or throws P2025 — filter maps. OK.

For `create`: P2002 (duplicate email in the same tenant) → filter maps to 409 `already_exists`. Test: same email in the same tenant → 409; same email across tenants → 201. ✔ "same email registered under both tenants".

**Plans and Orders:** To keep the file count sane while making all three resources structurally isolated (the task says "fully isolated data (customers, plans, orders)"), I'll implement full services + repositories for all three, plus controllers for customers only? Hmm — "don't create files it doesn't ask for". The task: "schema for customers/plans/orders and tenant-scoped uniqueness" — plans/orders only need the schema + (implicitly) the data-layer scoping. The tests don't mention plans/orders. But "fully isolated data (customers, plans, orders)" suggests they exist as data. I'll add repository + service for plan and order (thin: create + list + findById). No controllers for plans/orders (the task doesn't ask for those endpoints; the only explicit endpoint is tenant-config). The isolation tests will also use plan/order at the service level? I'll keep the tests on customers + maybe one plan list isolation check via the service. Include a small service-level test that lists plans from B and confirms A's plans are absent (via the service + tenantContext.run). That's behaviour. OK.

Wait — should I even include Plan/Order controllers? The discipline says do exactly what's asked. The tests only require CRUD isolation (resource unspecified — I'll do it on customers). I'll do:

- `src/customer/customer.{module,controller,service,repository}.ts`
- `src/plan/plan.{module,service,repository}.ts`
- `src/order/order.{module,service,repository}.ts`
- `src/tenant/tenant.{module,service,repository}.ts`, `src/tenant/tenant-resolution.middleware.ts`, `src/tenant/tenant-config.controller.ts`
- `src/prisma/prisma.{module,service}.ts`, `src/prisma/tenant-scope.ts`
- `src/common/app-error.ts`, `src/common/all-exceptions.filter.ts`, `src/common/tenant-context.ts`, `src/common/errors.ts`? (writeJsonError helper) — the filter can import AppError directly; the middleware writes the response itself; a shared `toEnvelope(err)` helper in `src/common/error-envelope.ts`? Let me consolidate: `src/common/app-error.ts` (AppError + `errorEnvelope(err)` function that returns `{error:{code,message,details}}` + `statusFor(err)`). Filter and middleware both use it. Two files.

File list:

Root:
- package.json
- tsconfig.json
- vitest.config.ts
- (tsconfig for tests? vitest doesn't need tsc. The build tsconfig includes only src — tests aren't built. Fine.)

prisma:
- prisma/schema.prisma
- prisma/migrations/20240601000000_init/migration.sql

src:
- src/main.ts
- src/app.module.ts
- src/common/app-error.ts
- src/common/tenant-context.ts
- src/common/all-exceptions.filter.ts
- src/prisma/prisma.module.ts
- src/prisma/prisma.service.ts
- src/prisma/tenant-scope.ts
- src/tenant/tenant.module.ts
- src/tenant/tenant.repository.ts
- src/tenant/tenant.service.ts
- src/tenant/tenant-resolution.middleware.ts
- src/tenant/tenant-config.controller.ts
- src/customer/customer.module.ts
- src/customer/customer.controller.ts
- src/customer/customer.service.ts
- src/customer/customer.repository.ts
- src/plan/plan.module.ts
- src/plan/plan.service.ts
- src/plan/plan.repository.ts
- src/order/order.module.ts
- src/order/order.service.ts
- src/order/order.repository.ts

test:
- test/helpers.ts (test app bootstrap + seeding + tokens)
- test/tenant-resolution.spec.ts
- test/customer-isolation.spec.ts

Hmm, "test/<feature>.spec.ts" — OK, I'll use tenant-isolation.spec.ts and tenant-resolution.spec.ts? Naming: `test/tenant.spec.ts` (resolution + config + concurrency) and `test/customer.spec.ts` (isolation matrix + same email). Good, matches `<feature>.spec.ts`.

Now let me write the actual code carefully.

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
  id           String   @id @default(uuid())
  slug         String   @unique
  domain       String   @unique
  name         String
  branding     Json     @default("{}") @map("branding")
  featureFlags Json     @default("{}") @map("feature_flags")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("tenants")
}

model Customer {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  email     String
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("customers")
}

model Plan {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  name       String
  priceCents Int      @default(0) @map("price_cents")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("plans")
}

model Order {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  customerId String   @map("customer_id")
  planId     String   @map("plan_id")
  totalCents Int      @default(0) @map("total_cents")
  status     String   @default("created")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@index([tenantId])
  @@map("orders")
}
```

`@default("{}")` on Json — allowed in Prisma 5? `Json @default("{}")` — yes, Prisma supports a JSON default via raw: `@default("{}")` works for Json fields (it's a valid JSON literal). Yes.

### tenant-scope.ts

```ts
import type { PrismaClient } from '@prisma/client';
import { tenantContext } from '../common/tenant-context.js';
import { AppError } from '../common/app-error.js';

/**
 * Applies structural tenant isolation to a Prisma client...
 */
const UNSCOPED_MODELS: ReadonlySet<string> = new Set(['Tenant']);

const WHERE_OPERATIONS = new Set([
  'findMany','findFirst','findUnique','count','aggregate','groupBy','update','delete','updateMany','deleteMany'
]);

export function applyTenantScope<T extends PrismaClient>(client: T) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        // eslint-disable... no
        async $allOperations(ctx: {
          model: string;
          operation: string;
          args: any;
          query: (args: any) => Promise<any>;
        }) {
          if (UNSCOPED_MODELS.has(ctx.model)) return ctx.query(ctx.args);
          const tenantId = tenantContext.require();
          const args = { ...ctx.args };
          switch (ctx.operation) {
            case 'create':
              args.data = { ...args.data, tenantId };
              break;
            case 'createMany':
              args.data = Array.isArray(args.data)
                ? args.data.map((d: any) => ({ ...d, tenantId }))
                : { ...args.data, tenantId };
              break;
            case 'upsert':
              args.where = { ...args.where, tenantId };
              args.create = { ...args.create, tenantId };
              break;
            default:
              if (!WHERE_OPERATIONS.has(ctx.operation)) {
                throw new AppError(500, 'tenant_scope_unsupported_operation', `Refusing to run unscored...`);
              }
              args.where = { ...args.where, tenantId };
          }
          return ctx.query(args);
        },
      },
    },
  });
}
```

Wait: the `$allModels` key with `$allOperations` — is the type OK? `$extends({ query: { $allModels: { $allOperations: fn } } })` — valid.

Note: the extension's `name` option — supported in Prisma 5 (`{ name, query }`). Yes, since 4.7 or so. I'll keep it; it's harmless. Actually, for safety with the type across versions, the `name` in the extension options is supported in @prisma/client 5.x. I'll keep it.

The type of `ctx`: the actual type is complex; I'll use a local minimal structural type, and the function signature for `$allOperations` expects a specific type — passing a function with fewer/structural parameters: TS checks assignability of the callback — the parameter type must be a supertype? Method parameter bivariance (strictFunctionTypes only affects function-typed properties, not methods — `$allOperations` is defined as a method-like property in the types, so `strictFunctionTypes` might complain). To be safe, I'll type the parameter as `any`… but strict mode allows explicit `any` (noImplicitAny only forbids implicit). I'll do:

```ts
async $allOperations(ctx: any) { ... }
```

With a comment. Practical, avoids type friction.

Also important: `args` could be undefined? For findMany with no where, args = {} or { skip, take }. `{...ctx.args}` handles undefined? If ctx.args is undefined, `{...undefined}` = {} — but then query({}) is fine. Actually, Prisma always passes an object. OK.

Edge: `findUnique` args.where must exist — yes.

Edge: `aggregate`/`groupBy` — where is optional; injection is fine.

Now, one important correctness check: for `update` (single), where is `CustomerWhereUniqueInput`; injecting `tenantId` → `{ id, tenantId }` is assignable (Prisma 5 generated WhereUniqueInput = Prisma.AtLeast<all fields optional>). ✔. But the extension passes runtime args to the engine — the engine receives where {id, tenantId} for an update — the engine validates "where must be unique" — `{ id, tenantId }` includes id (unique) → OK.

For `delete`: same.

`findFirst`/`findMany` — where is any filter. ✔.

Another subtlety: the extension applies to the `prisma.$extends` client — but `prisma.tenant.$transaction`? I don't use it. Skip.

### tenant-context.ts

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from './app-error.js';

const storage = new AsyncLocalStorage<string>();

/**
 * Request-scoped tenant context backed by AsyncLocalStorage...
 */
export const tenantContext = {
  run<R>(tenantId: string, fn: () => R): R {
    return storage.run(tenantId, fn);
  },
  current(): string | undefined {
    return storage.getStore();
  },
  require(): string {
    const tenantId = storage.getStore();
    if (!tenantId) {
      throw new AppError(500, 'tenant_context_missing', 'No tenant context is active for this operation.');
    }
    return tenantId;
  },
};
```

### app-error.ts

```ts
export interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function toErrorEnvelope(err: AppError | { status: number; code: string; message: string; details?: Record<string, unknown> }): ErrorEnvelope {
  ...
}
```

Simpler: a function `envelope(status, code, message, details): ErrorEnvelope`. Filter and middleware use it. I'll do:

```ts
export function errorEnvelope(status: number, code: string, message: string, details: Record<string, unknown> = {}): ErrorEnvelope
```

Hmm, but the filter needs to decide status/code from arbitrary errors. I'll write the filter logic inline with AppError + Prisma error mapping, and produce the envelope via the helper. Fine.

### all-exceptions.filter.ts

```ts
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { errorEnvelope } from './app-error.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      return this.send(res, exception.status, exception.code, exception.message, exception.details);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return this.send(res, 409, 'already_exists', 'A record with the same unique value already exists.', { target: exception.meta?.target ?? [] });
      }
      if (exception.code === 'P2025') {
        return this.send(res, 404, 'resource_not_found', 'The requested record does not exist for this tenant.');
      }
      return this.send(res, 500, 'database_error', 'A known database error occurred.', { prismaCode: exception.code });
    }
    console.error('Unhandled exception', exception);
    this.send(res, 500, 'internal_error', 'An unexpected error occurred.');
  }
  private send(res, status, code, message, details = {}) { if (!res.headersSent) res.status(status).json(errorEnvelope(status, code, message, details)); }
}
```

`exception.meta?.target` — meta's type is `any`. OK.

### prisma.service.ts

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyTenantScope } from './tenant-scope.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * Tenant-scoped client. Every read is filtered by the ambient tenant and
   * every write is stamped with it...
   */
  readonly tenant = applyTenantScope(this);

  /** Unscoped client, used only for the tenant registry itself. */
  get base(): PrismaClient { return this; }

  async onModuleInit(): Promise<void> { await this.$connect(); }
  onModuleDestroy(): Promise<void> { return this.$disconnect(); }
}
```

Wait: `readonly tenant = applyTenantScope(this)` — a class field initialized in the constructor after super. `applyTenantScope(this)` — `this.$extends` on the instance. The class field with an initializer: under `useDefineForClassFields: false`, it's assigned in the constructor — fine. But note: the parameter property DI + this field — fine.

Hmm, one issue: `extends PrismaClient` — PrismaClient's constructor signature accepts an options object; the default `super()` is fine.

But wait, `$extends` on `this` before `$connect` — fine, extends doesn't need a connection.

Type of `tenant`: inferred as the extended client type. Repositories: `this.prisma.tenant.customer.findMany(...)`.

TS gotcha: extending PrismaClient with strict + `this` type… `applyTenantScope<T extends PrismaClient>(client: T)` called with `this` (PrismaService) → T = PrismaService. `client.$extends` — $extends is a method on the PrismaClient type; with T = PrismaService, the typing of `$extends` is preserved. Return type: the extended client with a model. Should be OK.

Actually, known TS quirks with `$extends` + subclass: the type of `client.$extends(...)` when T extends PrismaClient — the overloads are defined on the PrismaClient interface… PrismaClient class has `$extends` with a complex generic. It should infer. If there's friction, alternative: hold the base client separately:

```ts
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new PrismaClient();
  readonly tenant = applyTenantScope(this.client);
  get base() { return this.client; }
  async onModuleInit() { await this.client.$connect(); }
  onModuleDestroy() { return this.client.$disconnect(); }
}
```

This avoids subclass typing entirely and is cleaner. `new PrismaClient()` — needs DATABASE_URL at instantiation time; the env must be set before the DI graph is constructed (which is true at runtime; the process env in tests is set before createTestingModule? PrismaClient reads env at construction (to resolve datasource url) — if missing, it throws at construction. I'll set process.env.DATABASE_URL in the test's beforeAll (with a guard: if undefined, use a default test URL? "no hardcoded connection strings" — the convention says no hardcoded connection strings. So tests rely on the env DATABASE_URL. But if the harness doesn't provide it, the tests fail — the harness must provide it; I'll assert with a clear message:

```ts
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set to run the test suite (point it at the migrated test database).');
```

at the top of the helper. Defensible.

I'll go with the non-extending version (plain wrapper) — safer TS-wise.

But hmm: two instances of PrismaClient in the app (the service's client) + the test helper's own instance for seeding — fine.

### prisma.module.ts

```ts
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

### tenant.repository.ts

```ts
@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByDomain(domain: string) { return this.prisma.base.tenant.findUnique({ where: { domain } }); }
  findBySlug(slug: string) { return this.prisma.base.tenant.findUnique({ where: { slug } }); }
  findById(id: string) { return this.prisma.base.tenant.findFirst({ where: { id } }); }
  create(data: { slug; domain; name; branding?; featureFlags? }) { return this.prisma.base.tenant.create({ data }); }
}
```

The branding/featureFlags as `InputJsonValue` type — I'll accept `Prisma.InputJsonValue`. Import `Prisma` from '@prisma/client'.

### tenant.service.ts

```ts
export interface ResolvedTenant { id: string; slug: string; domain: string; }

@Injectable()
export class TenantService {
  constructor(private readonly tenants: TenantRepository) {}

  /**
   * Resolves the tenant for a request: the host and the token's `org` claim
   * must both point at the same tenant.
   */
  async resolveFromRequest(domain: string, orgClaim: string): Promise<string> {
    const byDomain = await this.tenants.findByDomain(domain);
    if (!byDomain) throw new AppError(404, 'tenant_not_found', `No tenant is served on host "${domain}".`, { host: domain });
    if (!orgClaim) throw new AppError(401, 'unauthorized', 'The token is missing the "org" claim.');
    const byOrg = await this.tenants.findBySlug(orgClaim);
    if (!byOrg || byOrg.id !== byDomain.id) {
      throw new AppError(403, 'tenant_mismatch', 'The token "org" claim does not match the request host.', { host: domain, org: orgClaim ?? null });
    }
    return byDomain.id;
  }

  async configForCurrentTenant() {
    const tenantId = tenantContext.require();
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new AppError(404, 'resource_not_found', ...);
    return {
      tenant: { id, slug, name, domain },
      branding: (tenant.branding as object) ?? {},
      featureFlags: (tenant.featureFlags as object) ?? {},
    };
  }
}
```

The shape of tenant-config response: `{ tenant: {...}, branding: {...}, featureFlags: {...} }`. Fine.

### tenant-resolution.middleware.ts

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { TenantService } from './tenant.service.js';
import { tenantContext } from '../common/tenant-context.js';
import { AppError, errorEnvelope } from '../common/app-error.js';

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgClaim = this.readOrgClaim(req);
      const host = normalizeHost(req.headers.host);
      const tenantId = await this.tenants.resolveFromRequest(host, orgClaim);
      await tenantContext.run(tenantId, () => next());
    } catch (err) {
      this.reject(req, res, err);
    }
  }

  private readOrgClaim(req: Request): string {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new AppError(401, 'unauthorized', 'Missing Bearer token.');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new AppError(500, 'internal_error', 'JWT_SECRET is not configured.');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    } catch {
      throw new AppError(401, 'unauthorized', 'The access token is invalid or expired.');
    }
    const org = payload.org;
    if (typeof org !== 'string' || org.length === 0) {
      throw new AppError(401, 'unauthorized', 'The access token is missing the "org" claim.');
    }
    return org;
  }

  private reject(req: Request, res: Response, err: unknown): void {
    if (err instanceof AppError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 500;
      res.status(status).json(errorEnvelope(status, err.code, err.message, err.details));
      return;
    }
    console.error('Tenant resolution failed:', err);
    res.status(500).json(errorEnvelope(500, 'internal_error', 'An unexpected error occurred.'));
  }
}

function normalizeHost(raw: string | undefined): string {
  const host = (raw ?? '').toLowerCase().split(':')[0]!;  // strip port
  return host;
}
```

Hmm — `tenantContext.run(tenantId, () => next())`: next() returns void; `run` returns void; awaited fine.

One concern: the downstream Nest pipeline invoked through `next()` — exceptions thrown there are caught by the global filter (they're inside the pipeline, not the middleware's try). But wait — does the exception bubble back to my middleware's try/catch? If the controller throws, Nest's exceptions handler handles it and ends the response; the `next()` promise resolves (doesn't reject). So my catch only handles resolution failures. ✔. But if the global filter isn't registered (in some context), the middleware's catch would handle it — the filter is registered via APP_FILTER in AppModule, always present. OK.

But actually, subtle: does the APP_FILTER global filter catch exceptions from the controller? Yes.

Also: `await tenantContext.run(...)` — if `next()` internally triggers an exception in a guard, Nest handles it. Fine.

### tenant-config.controller.ts

```ts
@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  getConfig() { return this.tenants.configForCurrentTenant(); }
}
```

Controller returns the service's promise → Nest awaits. ✔.

### tenant.module.ts

```ts
@Module({
  imports: [PrismaModule],
  controllers: [TenantConfigController],
  providers: [TenantService, TenantRepository, TenantResolutionMiddleware],
  exports: [TenantService],
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  },
})
export class TenantModule {}
```

Note: the middleware is instantiated per module instance; it runs before the router. ✔.

### customer.controller.ts

```ts
@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  list() { return this.customers.list(); }

  @Get(':id')
  get(@Param('id') id: string) { return this.customers.get(id); }

  @Post()
  create(@Body() body: unknown) {
    const dto = validateCreateCustomer(body);
    return this.customers.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const dto = validateUpdateCustomer(body);
    return this.customers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) { return this.customers.remove(id); }
}
```

Validation helpers (controller-level, no logic):

```ts
function validateCreateCustomer(body: any): CreateCustomerDto {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') errors.push('body must be a JSON object');
  ...
  if (errors.length) throw new AppError(400, 'validation_failed', 'Request body failed validation.', { errors });
  return { email, name };
}
```

Email format check: a simple regex or a non-empty string. I'll require a non-empty string containing '@'? Light: non-empty string. A minimal regex is enough. Keep it simple: non-empty string, trim.

DELETE with 204: `@HttpCode(204)` and the service returns void. With 204, Nest sends no body. ✔.

Wait — PATCH vs PUT: I'll use PATCH (partial update) — fine.

### customer.service.ts

```ts
export interface CreateCustomerInput { email: string; name: string; }
export interface UpdateCustomerInput { email?: string; name?: string; }

@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  async list() { return this.customers.list(); }

  async get(id: string) {
    const customer = await this.customers.findById(id);
    if (!customer) throw new AppError(404, 'resource_not_found', `Customer ${id} was not found for this tenant.`, { id });
    return customer;
  }

  async create(input: CreateCustomerInput) {
    return this.customers.create(input); // P2002 → 409 via the filter
  }

  async update(id: string, input: UpdateCustomerInput) {
    if (!input.email && !input.name) throw new AppError(400, 'validation_failed', 'Provide at least one field to update.', {});
    return this.customers.update(id, input); // P2025 → 404, P2002 → 409 via the filter
  }

  async remove(id: string) {
    await this.customers.remove(id); // P2025 → 404 via the filter
  }
}
```

Hmm wait: the service's `update` — I check "at least one field" — that's borderline business logic but input validation; the controller already validates non-empty? The controller ensures the dto has ≥1 field. I'll put that check only in the controller (input validation). Service: pure orchestration. OK: the controller validates; the service calls the repository.

The service's create: could I pre-check for email existence? No — rely on the DB constraint + filter mapping (atomic, race-safe). Good design.

### customer.repository.ts

```ts
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() { return this.prisma.tenant.customer.findMany({ orderBy: { createdAt: 'asc' } }); }
  findById(id: string) { return this.prisma.tenant.customer.findFirst({ where: { id } }); }
  create(data: { email: string; name: string }) { return this.prisma.tenant.customer.create({ data }); }
  update(id: string, data: { email?: string; name?: string }) { return this.prisma.tenant.customer.update({ where: { id }, data }); }
  remove(id: string) { return this.prisma.tenant.customer.delete({ where: { id } }); }
}
```

The tenantId is never passed — the extension injects it. ✔ "handlers never pass tenantId manually".

### plan/order services+repos: thin mirrors.

PlanService: list, get, create({name, priceCents}).
OrderService: list, get, create({customerId, planId, totalCents}) — validates the existence of the customer and plan within the tenant (service logic):

```ts
async create(input) {
  const [customer, plan] = await Promise.all([this.orders.repository... hmm
```

OrderRepository: `list()`, `findById()`, `create(data)`; plus the service uses CustomerRepository? No — the order module shouldn't import the customer module's repository; it could use its own repository with a find for customer validation… cross-feature. Options: OrderService imports CustomerService/PlanService from their modules (module exports). Wiring: OrderModule imports CustomerModule, PlanModule; their services must be exported. That's proper Nest wiring. The service logic: "an order can only reference a customer and plan within the same tenant" → check `customerService.get(input.customerId)` (404 if cross-tenant), `planService.get(input.planId)`. Then create the order (stamped). totalCents default from plan? Keep the input totalCents optional → default to plan.priceCents. Small logic, OK.

Hmm, is this over-engineered? The task mentions orders as isolated data; a create with cross-reference validation demonstrates the isolation. I'll keep it but simple.

Alternatively, drop the order service logic to a minimum: create with the given customerId/planId/totalCents, no existence check. But then cross-tenant references are silently stored (bad isolation story). I'll keep the check — that's "service holds the logic". OK.

Now, let me think about file count and whether the plan/order modules are needed — yes, to provide the services.

**Now, tests.**

`test/helpers.ts`:

```ts
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module.js';

export const TENANT_A = { slug: 'operator-a', domain: 'app.operator-a.com', name: 'Operator A' };
export const TENANT_B = { slug: 'operator-b', domain: 'app.operator-b.com', name: 'Operator B' };

export let app: INestApplication;  // hmm, better to return from createApp
export let http: httpServer

export async function createTestApp() {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-only-secret';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const application = moduleRef.createNestApplication();
  await application.init();
  return application;
}

export function issueToken(org: string, secret = process.env.JWT_SECRET!) {
  return jwt.sign({ org }, secret, { algorithm: 'HS256', expiresIn: '1h' });
}
```

Wait — the middleware reads `process.env.JWT_SECRET` per request (in readOrgClaim, at call time) ✔.

Seeding: the helper creates a dedicated `PrismaClient`:

```ts
const seedClient = new PrismaClient();
export async function seedTenants() {
  await seedClient.tenant.create({ data: { ...TENANT_A, branding: {...}, featureFlags: {...} } });
  ...
}
```

But if I run the suite twice (tenants exist) → the unique constraint. In beforeAll, first delete existing rows:

```ts
export async function resetDatabase() {
  await seedClient.order.deleteMany();
  await seedClient.customer.deleteMany();
  await seedClient.plan.deleteMany();
  await seedClient.tenant.deleteMany();
}
```

Note: `order` — `prisma.order` is a valid model property name (`order` isn't reserved in JS). ✔.

Cleanup after the suite: `application.close()`, `seedClient.$disconnect()`.

The helper exports a small `api(app, org, domain)` that returns a configured supertest? I'll keep the tests explicit.

`test/tenant.spec.ts`:

```ts
describe('tenant resolution', () => {
  beforeAll: reset, seed tenants (with branding/flags), create the app
  afterAll: close app, disconnect seedClient

  it('rejects a request without a bearer token with 401 and the error envelope', ...)
  it('rejects a malformed/invalid token with 401', ...)
  it('rejects a token without the org claim with 401', ...)
  it('rejects an unknown host with 404 tenant_not_found', ...)
  it('rejects a token whose org claim points at a different tenant with 403 tenant_mismatch', ...)
  it('serves the resolved tenant branding and feature flags at /tenant-config', ...)
  it('serves different configs per tenant', ...)
});
```

Envelope assertions: `body.error.code === 'unauthorized'`, `typeof body.error.details === 'object'`, details not null.

`test/customer.spec.ts`:

```ts
describe('customer data isolation', () => {
  beforeAll: reset; seed tenants; create the app; seed one customer each in A and B (using the tenant-scoped path via HTTP POST, to also verify stamping).
  
  it('lists only the calling tenant rows', ...)
  it('returns 404 for another tenant customer id', ...)
  it('cannot update another tenant customer', ...)
  it('cannot delete another tenant customer', ...)
  it('registers the same email in both tenants', ...)
  it('rejects a duplicate email within the same tenant with 409', ...)
  it('keeps concurrent cross-tenant requests isolated', ...)
});
```

Seeding via HTTP POST as each tenant — good (end-to-end: the stamp comes from the context).

Concurrency test details:
- Seed: A: alice@, B: bob@.
- Concurrent: GET list A, GET list B, POST A (carol@), POST B (dave@).
- Assert: listA contains alice and carol but not bob/dave; listB contains bob and dave but not alice/carol; both POSTs 201 with distinct ids; then a final GET for each tenant: only its own 2 rows.

Hmm — the lists may race with the creates (the list might or might not include carol). To make it deterministic: two phases. Phase 1: concurrent create+create+list+list — but the assertion "no cross-contamination" is deterministic: listA must not contain bob/dave, and listB must not contain alice/carol. That's a deterministic assertion regardless of interleaving. Then phase 2: sequential GET for both: A has exactly {alice, carol}, B has {bob, dave}.

Also add a service-level concurrency test? The HTTP-level is sufficient.

Also "tenant B cannot list tenant A's row" — covered by the list test.

Now — one more consideration: the `Host` header with supertest: `.set('Host', 'app.operator-a.com')`. Express respects the Host header. ✔.

**Edge: express `trust proxy`/host header** — the Host header is present by default. ✔.

**Now, package.json versions.** Let me pin to reasonable ranges:

- @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/testing: ^10.3.0 (Nest 10, stable on Node 20)
- @prisma/client, prisma: ^5.14.0
- jsonwebtoken ^9.0.2, @types/jsonwebtoken ^9.0.6
- reflect-metadata ^0.2.2
- rxjs ^7.8.1
- express: platform-express brings express 4; @types/express ^4.17.21 (for the type import of Response in the filter/middleware)
- supertest ^7.0.0, @types/supertest ^6.0.2
- typescript ^5.4.5
- vitest ^2.0.0 (esbuild-independent since we use the swc plugin anyway)
- @vitejs/plugin-swc ^3.2.0 (peer: vite ^5; vitest 2 uses vite 5 ✔). @swc/core is auto-dep of the plugin.
- @types/node ^20.12.0

Vitest 2 + plugin-swc 3: compatible (plugin-swc 3.x supports vite 5/6? 3.2+ supports vite 5. vitest 2.0 uses vite 5. ✔).

Actually, let me double-check the SWC transform config keys for @vitejs/plugin-swc:

```ts
swc({
  jsc: {
    parser: { syntax: 'typescript', decorators: true },
    transform: {
      decoratorMetadata: true,
      useDefineForClassFields: false,
    },
    target: 'es2022',
  },
})
```

Yes, that's the documented shape (SwcOptions.jsc). `decoratorMetadata: true` requires `decorators: true`? The transform option `decoratorMetadata` emits `design:type`/`design:paramtypes`/`design:returntype` metadata when decorators are enabled. ✔.

Do we also need `module` config? Vite handles the transformation to ESM.

One more NestJS+ESM runtime issue: `@nestjs/platform-express` in ESM — does Nest 10 support ESM? NestJS officially supports ESM since 9 (experimental) / 10 (supported). With `"type": "module"` and NodeNext imports with `.js` extensions, it works. ✔ (Known: NestJS's ESM support is fine on 10.x for standard apps.)

Prisma client in ESM: works.

jsonwebtoken (CJS) imported from ESM: `import jwt from 'jsonwebtoken'` — CJS default interop ✔.

AsyncLocalStorage from `node:async_hooks` ✔.

**Now, the migration SQL.** Prisma 5 migration format:

```sql
-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branding" JSONB NOT NULL DEFAULT '{}',
    "feature_flags" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (...);
-- CreateTable
CREATE TABLE "customers" (...);
-- CreateTable
CREATE TABLE "orders" (...);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");
CREATE UNIQUE INDEX "plans_tenant_id_name_key" ON "plans"("tenant_id", "name");
CREATE INDEX "plans_tenant_id_idx" ON "plans"("tenant_id");
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");
```

Note: `DEFAULT gen_random_uuid()` — Prisma's `@default(uuid())` migration uses `gen_random_uuid()` (built into PG 13+; pg13+ is a safe bet in 2024+). ✔.

JSONB default `'{}'` — Prisma emits `DEFAULT '{}'` ✔.

`updated_at` is `@updatedAt` — no default in the SQL (Prisma manages it client-side) ✔ — matches the Prisma migration output (no default for @updatedAt).

**tsconfig details:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": false,
    "incremental": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`"types": ["node"]` — limit to node types (tests aren't compiled here anyway).

**vitest.config.ts:**

```ts
import { defineConfig } from 'vitest/config';
import swc from '@vitejs/plugin-swc';

export default defineConfig({
  plugins: [
    swc({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, useDefineForClassFields: false },
        target: 'es2022',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```

**main.ts:**

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // no console.log? maybe a log. I'll keep it minimal: console.log(`listening on ${port}`)? Fine, English.
}

void bootstrap();
```

**app.module.ts:**

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { PlanModule } from './plan/plan.module.js';
import { OrderModule } from './order/order.module.js';

@Module({
  imports: [PrismaModule, TenantModule, CustomerModule, PlanModule, OrderModule],
  providers: [{ provide: APP_FILTER, useValue: new AllExceptionsFilter() }],
})
export class AppModule {}
```

**customer.module.ts:**

```ts
@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerRepository],
  exports: [CustomerService],
})
export class CustomerModule {}
```

**plan/order modules** similar; OrderModule imports PlanModule + CustomerModule.

Wait — PlanModule/CustomerModule export services for OrderModule. ✔ per wiring convention.

**Order service:**

```ts
@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly customers: CustomerService,
    private readonly plans: PlanService,
  ) {}

  list() { return this.orders.list(); }

  async get(id: string) {
    const order = await this.orders.findById(id);
    if (!order) throw new AppError(404, 'resource_not_found', `Order ${id} was not found for this tenant.`, { id });
    return order;
  }

  async create(input: { customerId: string; planId: string; totalCents?: number }) {
    const [customer, plan] = await Promise.all([
      this.customers.get(input.customerId),
      this.plans.get(input.planId),
    ]);
    return this.orders.create({
      customerId: customer.id,
      planId: plan.id,
      totalCents: input.totalCents ?? plan.priceCents,
    });
  }
}
```

This cross-validates tenant-scoped existence → cross-tenant reference → 404.

Should I add an order isolation test at the service level? The task's test list doesn't require it. I'll skip the order test; the code exists for the schema's completeness. Hmm — "test behaviour… a test that only exercises the happy path is worse than no test". My customer tests include negative paths. Fine.

Actually wait — should I even include Order/Plan controllers? No, I decided service+repo only. But then OrderService.create is only reachable via DI — fine (the task doesn't require endpoints). But hmm, "do exactly what the task asks. Don't create files it doesn't ask for" — one could argue plan/order services/repos aren't asked for either. But "fully isolated data (customers, plans, orders)" + "scope all reads and stamp all writes" implies all three data types go through the scoped layer. Schema + repository/service for all three is the faithful reading. I'll keep it.

**Customer DTO types:** I'll define in the controller file (local types): `interface CreateCustomerDto { email: string; name: string }`.

Let me write the validation functions:

```ts
function requireNonEmptyString(value: unknown, field: string, errors: string[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`"${field}" must be a non-empty string`);
    return undefined;
  }
  return value.trim();
}

function validateCreateCustomer(body: unknown): CreateCustomerDto {
  const errors: string[] = [];
  if (typeof body !== 'object' || body === null) errors.push('request body must be a JSON object');
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const email = requireNonEmptyString(record.email, 'email', errors);
  const name = requireNonEmptyString(record.name, 'name', errors);
  if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.push('"email" must be a valid email address');
  if (errors.length > 0) throw new AppError(400, 'validation_failed', 'The request body is invalid.', { errors });
  return { email: email!, name: name! };
}

function validateUpdateCustomer(body: unknown): UpdateCustomerDto {
  const errors: string[] = [];
  if (typeof body !== 'object' || body === null) errors.push('request body must be a JSON object');
  const record = ... as Record<string, unknown>;
  const dto: UpdateCustomerDto = {};
  if ('email' in record) { const email = requireNonEmptyString(record.email, 'email', errors); if (email) { if (!regex) errors.push(...); dto.email = email; } }
  if ('name' in record) { const name = requireNonEmptyString(record.name, 'name', errors); if (name) dto.name = name; }
  if (Object.keys(dto).length === 0) errors.push('provide at least one of "email" or "name"');
  if (errors.length) throw new AppError(400, 'validation_failed', 'The request body is invalid.', { errors });
  return dto;
}
```

Fine.

**Envelope details "never null"**: always an object (default {}). In P2002 mapping, details: `{ fields: exception.meta?.target ?? [] }` — an array (object-ish, not null) ✔.

**Now, let me double-check the middleware's error path with the envelope for a 404 unknown host:** status 404 code `tenant_not_found`. Is 404 the right status for an unknown host? The app isn't served on that host — a 404 is reasonable. Some would argue 400. I'll stick with 404.

**Testing the mismatch case:** token org=operator-b, host app.operator-a.com → 403 `tenant_mismatch`. Also, org claim pointing at a non-existent slug → 403 `tenant_mismatch` (my resolveFromRequest: byOrg undefined → mismatch). Message: "org claim does not match the request host". Fine.

**Now, a potential pitfall — Nest middleware + `forRoutes('*')` with global prefix off: it matches all routes. ✔.**

**Potential pitfall — two PrismaClient instances (app + seed) and the same DB: fine.**

**Potential pitfall — `app.init()` triggers `onModuleInit` → `$connect()` — needs the DATABASE_URL env set before createTestingModule. The helper sets JWT_SECRET; DATABASE_URL must be provided by the env (assert with a friendly error).**

**Potential pitfall — Prisma generated client not built (prisma generate not run).** The evaluation harness will run pnpm install + prisma generate (postinstall). I'll add a `"postinstall": "prisma generate"` script in package.json — a common practice, ensures the client exists. Good idea.

Scripts:

```json
"scripts": {
  "postinstall": "prisma generate",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/main.js",
  "start:dev": "ts-node? no. skip",
  "migrate": "prisma migrate deploy",
  "test": "vitest run"
}
```

**One more design question: should the TenantRepository use `prisma.base`?** The `base` getter returns `this.client` (the plain PrismaClient). The property name in the service: `readonly tenant` (scoped) and `readonly base`. Hmm, "base" — should I call it `unscoped`? `raw`? I'll use `base` with a doc comment. Actually, maybe clearer: `registry` — for the tenant registry. Hmm. I'll do:

```ts
/** Unscoped client. Only the tenant registry (the Tenant model) may use it. */
readonly unscoped = this.client;
```

Hmm wait, I decided the PrismaService holds `private readonly client = new PrismaClient()`. Then:

```ts
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new PrismaClient();
  /** Tenant-scoped client ... */
  readonly tenant = applyTenantScope(this.client);
  /** Unscoped client ... */
  readonly unscoped = this.client;
  ...
}
```

Class field ordering: `client` is defined first, then `tenant`/`unscoped` reference it — with `useDefineForClassFields: false`, the assignments run in the constructor in declaration order — `client` is assigned before `tenant`. ✔.

But wait — strict + `this.client` in a field initializer before its declaration? `client` is declared first, then `tenant = applyTenantScope(this.client)` — fine.

**The extension function parameter typing:**

```ts
export function applyTenantScope<T extends PrismaClient>(client: T) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations(ctx: any): Promise<any> {
          ...
        },
      },
    },
  });
}
```

The `name` option: type `Prisma.MiddlewareExtension`… the `$extends` overload accepts `{ name?: string; query?: ... }`? I think the extension options include `name`. In Prisma 5: `$extends({ name, query, result, model })` — yes, `name` is supported.

Hmm, actually, let me double check the exact API: `prisma.$extends({ query: { $allModels: { $allOperations: async ({ model, operation, args, query }) => query(args) } } })`. Yes, that's the documented generic middleware.

**Another subtlety — `count` with no args:** `count()` → args is `undefined`? The extension receives `args` = {} (or undefined). `{...undefined}` = {} → a.where = { tenantId } → query({ where: { tenantId } }) — count with where ✔.

**`findFirst` where { id } + injected tenantId — engine: WHERE id=? AND tenant_id=? ✔.**

**Test: "fetch by ID (expect 404)"** — HTTP GET /customers/{aId} as B → service's findById → findFirst scoped → null → 404 envelope ✔.

**Now, "concurrent requests from different tenants don't mix contexts" — a stronger version:** interleave with a synchronous delay inside? Can't inject a delay into the app. The HTTP concurrency test is the practical demonstration. I could also add a service-level test with manual interleaving:

```ts
await Promise.all([
  tenantContext.run(tenantAId, async () => { await sleep(5); return customerService.list(); }),
  tenantContext.run(tenantBId, async () => { await sleep(1); return customerService.list(); }),
]);
```

The interleaved sleeps force context switching mid-flight; each result must be only its own tenant. This directly demonstrates ALS isolation. I'll add it to customer.spec.ts via service injection (from the app's injector: `app.get(CustomerService)`). Good — also demonstrates the service-layer behaviour without HTTP. I'll include it; cheap and strong.

**Now, let me assemble the tenant seeds with branding/feature flags:**

```ts
const TENANT_A = {
  slug: 'operator-a',
  domain: 'app.operator-a.com',
  name: 'Operator A',
  branding: { primaryColor: '#1a73e8', logoUrl: 'https://cdn.operator-a.com/logo.svg' },
  featureFlags: { betaCheckout: true, supportInbox: false },
};
const TENANT_B = {
  slug: 'operator-b',
  domain: 'app.operator-b.com',
  name: 'Operator B',
  branding: { primaryColor: '#e91e63', logoUrl: 'https://cdn.operator-b.com/logo.png' },
  featureFlags: { betaCheckout: false, supportInbox: true },
};
```

tenant-config response: `{ tenant: {id, slug, name, domain}, branding, featureFlags }`.

Test asserts `body.featureFlags.betaCheckout === true` for A, `false` for B; branding differs.

**Let me confirm the `errorEnvelope` helper name and shape:**

```ts
export function errorEnvelope(status: number, code: string, message: string, details: Record<string, unknown> = {}): { error: { code: string; message: string; details: Record<string, unknown> } } {
  return { error: { code, message, details } };
}
```

(status isn't in the body but a parameter? I don't use status — drop it.) I'll keep the signature `(code, message, details?)`.

Wait, `AppError.details` is typed `Record<string, unknown>` — in the filter: `exception.details`. ✔.

**Middleware + filter duplication of envelope writes — both import errorEnvelope. ✔.**

**Now, `console.error` in the filter for unknown errors — fine.**

**Type of `req.headers.host` — `string | undefined`. normalizeHost handles undefined → '' → findByDomain('') → null → 404. ✔.**

**JWT: `jwt.verify` with an expired token → throws → 401 ✔. Wrong signature → 401 ✔.**

**Now — an important Nest detail: the middleware is declared in TenantModule's providers, and its constructor injects TenantService — the module's own provider ✔.**

**`configure(consumer)` with `forRoutes('*')` — applies to all paths ✔.**

**Does the middleware run for 404 (no route) too? Yes, middleware runs before routing — unknown paths get a 404 from Nest after the middleware; the response is Nest's default, not the envelope. That's fine (out of scope).**

**Potential problem: Nest's global prefix? None.**

**CORS? Not required.**

Now, **a subtle ALS + supertest issue**: supertest makes real HTTP requests to the listening server — each request is a new async context; the middleware sets up ALS per request ✔. In a concurrency test, requests overlap in the server process — ALS isolates ✔.

**And a subtle issue: `tenantContext.run(tenantId, () => next())` — next() must be called; if resolution throws before run, the response is already sent by reject() — and `next()` is never called ✔ (the request ends).**

But note: in `use`, if `readOrgClaim` throws (401), reject writes the response. ✔. If `resolveFromRequest` throws (404/403), reject. ✔.

**Now, let me also think: `app.init()` in tests — the PrismaService onModuleInit $connect: needs a valid DATABASE_URL with a migrated schema. I'll note in the test file header comment: "requires a migrated database (prisma migrate deploy) reachable via DATABASE_URL".**

**Now, let me reconsider the "tenant-scoped uniqueness" requirement:** "the same customer email can exist under two tenants" — `@@unique([tenantId, email])` ✔. A test verifies registration of the same email in both tenants (201, 201) and that the lists stay separate.

**"Handlers never pass tenantId manually"** — verify that no repository/service/controller passes tenantId. CustomerRepository: no tenantId anywhere ✔. TenantRepository does pass ids, but that's the registry (tenant's own id, not scoping). ✔.

**Now, let me re-verify `PrismaService` and DI metadata under SWC:** constructor-less classes — fine.

**One more: `import { Prisma } from '@prisma/client'` in the filter for `Prisma.PrismaClientKnownRequestError` ✔.**

**Edge: `exception.meta` type `any | undefined` — use `exception.meta && exception.meta.target`… Prisma's type: `meta: any`? In @prisma/client types, `meta?: any`. I'll do: `const target = (exception.meta as { target?: unknown } | undefined)?.target ?? [];` hmm meta for P2002 is `{ target: string[] }` or a string. I'll just pass `details: { target: exception.meta?.target ?? [] }` with a cast. Simpler: `details: {}`? The P2002 details with target are helpful. Let me do:

```ts
const meta = (exception.meta ?? {}) as { target?: string | string[] };
details: { target: meta.target ?? [] }
```

Hmm wait, `exception.meta` — the class property type is `any`. Direct use is OK: `exception.meta?.target ?? []` — under strict, is `any` allowed with optional chaining? `exception.meta` is `any`, so `?.` is fine. But the type of `exception.meta` in @prisma/client: `meta: any`. OK, I'll write `(exception.meta as Record<string, unknown> | null | undefined)?.target ?? []`. Hmm `any` → skip the cast, fine. Actually strict mode doesn't complain about any usage. I'll keep it simple.

**Let me also add a `details` object with `host`/`org` in `resolveFromRequest` — but the mismatch details leak the other tenant's id? I only include host + org claim. ✔ safe.**

**Now, let me think about whether the middleware should also protect routes before the tenant registry is queried… it's fine.**

**Let me draft each file fully.**

Also — **`.env` handling**: no .env file (no secrets in the repo). DATABASE_URL is provided by the env. ✔.

**README?** The task says nothing outside the pattern is read; a README isn't requested. Skip (discipline).

**Now, let me write the tenant-scope with proper handling of `args` for operations that take a `where`:** `findUnique`/`update`/`delete` — `args.where` is required (never undefined at runtime). `count`/`aggregate`/`groupBy`/`findMany`/`findFirst`/`updateMany`/`deleteMany` — where is optional. `{...args.where, tenantId}` handles undefined ✔.

**`upsert`**: where + create + update. Inject into where + create. But also — what if the upsert's `create` includes a nested connect? No, no relations. ✔.

**What about `upsert`'s `update`?** — doesn't need a stamp (the row is matched by the scoped where). ✔.

**Now, let me consider adding `skip`/`take` — untouched by the spread ✔.**

**groupBy's `by` — untouched ✔.**

Let me also re-verify the type of the `$allOperations` context: the documented signature:

```ts
query: {
  $allModels: {
    $allOperations: async ({ model, operation, args, query }) => {
      // args and query are typed
      return query(args);
    }
  }
}
```

Using `ctx: any` for the parameter — the assignability: the expected callback type takes a specific context object; providing a parameter of type `any` is OK (bivariance/any). ✔.

**Now, the full code for the test helpers:**

```ts
import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import type { http } from 'node:http';
import { AppModule } from '../src/app.module.js';

export const TENANT_A = {...};
export const TENANT_B = {...};

const seed = new PrismaClient();

export async function resetDatabase(): Promise<void> {
  await seed.order.deleteMany();
  await seed.customer.deleteMany();
  await seed.plan.deleteMany();
  await seed.tenant.deleteMany();
}

export async function seedTenants(): Promise<{ a: string; b: string }> {
  const a = await seed.tenant.create({ data: { ...TENANT_A } });
  const b = await seed.tenant.create({ data: { ...TENANT_B } });
  return { a: a.id, b: b.id };
}
```

Wait, the TENANT_A object includes branding/featureFlags — Prisma's create data: branding: InputJsonValue — a plain object is OK.

But the `slug` etc. — spread includes all ✔.

`process.env.DATABASE_URL` guard:

```ts
export function requireDatabase(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a migrated Postgres database to run this suite.');
  }
}
```

Call it in each spec's beforeAll (or the module top-level of the helper? Top-level throw would fail at import time — I'll call it explicitly in the spec's beforeAll, or in createTestApp). I'll call it in createTestApp and also in the seed operations (PrismaClient constructor without DATABASE_URL will throw "error: Environment variable not found: DATABASE_URL" at construction — which happens at helper module import (top-level `new PrismaClient()`). To give a friendlier error, lazy-create the seed client:

```ts
let seed: PrismaClient | undefined;
function seedClient(): PrismaClient {
  if (!process.env.DATABASE_URL) throw new Error('...');
  if (!seed) seed = new PrismaClient();
  return seed;
}
```

And `export async function closeSeedClient()` for afterAll. Good.

`createTestApp`:

```ts
export async function createTestApp(): Promise<INestApplication> {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-secret-not-for-production';
  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

export function issueToken(org: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ org }, secret, { algorithm: 'HS256', expiresIn: '5m' });
}
```

"no secrets in the repo" — a test-only placeholder for the token verification key in tests is acceptable (tests need a known key to issue tokens); it's not a real secret. I'll mark it as test-only.

Hmm — but "config is only from env vars" — in production, the middleware reads the env; tests set the env. ✔.

**Now, spec 1: test/tenant.spec.ts**

```ts
import 'reflect-metadata';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, it, describe, expect } from 'vitest';
import { createTestApp, issueToken, resetDatabase, seedTenants, TENANT_A, TENANT_B, closeSeedClient } from './helpers.js';

describe('tenant resolution (variant A: white label)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    await seedTenants();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeSeedClient();
  });

  const as = (org: string, host: string) =>
    request(app.getHttpServer()).set('Host', host).set('Authorization', `Bearer ${issueToken(org)}`);

  it('rejects a request without a bearer token (401, envelope)', async () => {
    const res = await request(app.getHttpServer()).get('/tenant-config').set('Host', TENANT_A.domain);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.details).toBeTypeOf('object');
    expect(res.body.error.details).not.toBeNull();
  });

  it('rejects a signature-invalid token (401)', async () => {
    const forged = jwt.sign({ org: TENANT_A.slug }, 'wrong-secret', { algorithm: 'HS256' });
    const res = await request(app.getHttpServer()).get('/tenant-config').set('Host', TENANT_A.domain).set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a token without the org claim (401)', async () => {
    const token = jwt.sign({ sub: 'anonymous' }, process.env.JWT_SECRET!, { algorithm: 'HS256' });
    ...
  });

  it('rejects a host no tenant is served on (404 tenant_not_found)', async () => {
    const res = await as(TENANT_A.slug, 'app.unknown-operator.com');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('tenant_not_found');
    expect(res.body.error.details.host).toBe('app.unknown-operator.com');
  });

  it('rejects an org claim that does not match the host (403 tenant_mismatch)', async () => {
    const res = await as(TENANT_B.slug, TENANT_A.domain);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('rejects an org claim of a tenant that does not exist (403)', async () => {
    const res = await as('ghost-operator', TENANT_A.domain);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('ignores the port on the Host header', async () => {
    const res = await request(app.getHttpServer()).get('/tenant-config').set('Host', `${TENANT_A.domain}:8443`).set('Authorization', `Bearer ${issueToken(TENANT_A.slug)}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant.slug).toBe(TENANT_A.slug);
  });

  it('returns branding and feature flags for the resolved tenant only', async () => {
    const res = await as(TENANT_A.slug, TENANT_A.domain);
    expect(res.status).toBe(200);
    expect(res.body.tenant).toMatchObject({ slug: TENANT_A.slug, name: TENANT_A.name, domain: TENANT_A.domain });
    expect(res.body.branding).toEqual(TENANT_A.branding);
    expect(res.body.featureFlags).toEqual(TENANT_A.featureFlags);
  });

  it('serves a different config to tenant B on its own host', async () => {
    const res = await as(TENANT_B.slug, TENANT_B.domain);
    expect(res.status).toBe(200);
    expect(res.body.tenant.slug).toBe(TENANT_B.slug);
    expect(res.body.branding).toEqual(TENANT_B.branding);
    expect(res.body.featureFlags).toEqual(TENANT_B.featureFlags);
    expect(res.body.featureFlags).not.toEqual(TENANT_A.featureFlags);
  });
});
```

Need to import jwt in the tenant spec for the forged/claim-less tokens. ✔.

**Spec 2: test/customer.spec.ts**

```ts
import 'reflect-metadata';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, it, describe, expect } from 'vitest';
import { CustomerService } from '../src/customer/customer.service.js';
import { tenantContext } from '../src/common/tenant-context.js';
import { createTestApp, issueToken, resetDatabase, seedTenants, TENANT_A, TENANT_B, closeSeedClient } from './helpers.js';

describe('customer isolation across tenants', () => {
  let app: INestApplication;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    await resetDatabase();
    const ids = await seedTenants();
    tenantA = ids.a; tenantB = ids.b;
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeSeedClient();
  });

  const asA = (method, path, body?) => request(app.getHttpServer())[method](path).set('Host', TENANT_A.domain).set('Authorization', `Bearer ${issueToken(TENANT_A.slug)}`)(body? ...)
```

Hmm, supertest chaining with an optional body — simpler: build the agent and use explicit sends in the tests.

Let me write it concretely:

```ts
function httpAs(slug: string, domain: string) {
  return request(app.getHttpServer()).set('Host', domain).set('Authorization', `Bearer ${issueToken(slug)}`);
}
```

Then: `await httpAs('operator-a', 'app.operator-a.com').get('/customers')`.

The beforeAll seeding creates customers via HTTP:

```ts
let aliceId: string; let bobId: string;
beforeAll(async () => {
  ...
  const a = await httpAs(TENANT_A.slug, TENANT_A.domain).post('/customers').send({ email: 'alice@example.com', name: 'Alice' });
  expect(a.status).toBe(201); aliceId = a.body.id;
  const b = await httpAs(TENANT_B.slug, TENANT_B.domain).post('/customers').send({ email: 'bob@example.com', name: 'Bob' });
  expect(b.status).toBe(201); bobId = b.body.id;
});
```

Wait — two beforeAll hooks in the same describe: vitest runs them in order ✔. But if the first beforeAll fails, the second is skipped? Fine.

Hmm, one risk: `httpAs` uses `app` — defined in the first beforeAll before the second uses it ✔ (declaration order).

Tests:

```ts
it('tenant B cannot list tenant A customers', async () => {
  const res = await httpAs(TENANT_B.slug, TENANT_B.domain).get('/customers');
  expect(res.status).toBe(200);
  const emails = res.body.map((c: any) => c.email);
  expect(emails).not.toContain('alice@example.com');
  expect(emails).toContain('bob@example.com');
});

it('tenant B cannot fetch tenant A customer by id (404)', async () => {
  const res = await httpAs(TENANT_B.slug, TENANT_B.domain).get(`/customers/${aliceId}`);
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('resource_not_found');
});

it('tenant B cannot update tenant A customer (404)', async () => {
  const res = await httpAs(TENANT_B.slug, TENANT_B.domain).patch(`/customers/${aliceId}`).send({ name: 'Hijacked' });
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('resource_not_found');
});

it('tenant B cannot delete tenant A customer (404)', async () => {
  const res = await httpAs(TENANT_B.slug, TENANT_B.domain).delete(`/customers/${aliceId}`);
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('resource_not_found');
  // and tenant A can still fetch it
  const still = await httpAs(TENANT_A.slug, TENANT_A.domain).get(`/customers/${aliceId}`);
  expect(still.status).toBe(200);
  expect(still.body.name).toBe('Alice');
});

it('allows the same email to register in both tenants', async () => {
  const a = await httpAs(TENANT_A.slug, TENANT_A.domain).post('/customers').send({ email: 'shared@example.com', name: 'Shared A' });
  const b = await httpAs(TENANT_B.slug, TENANT_B.domain).post('/customers').send({ email: 'shared@example.com', name: 'Shared B' });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(a.body.id).not.toBe(b.body.id);
  expect(a.body.email).toBe('shared@example.com');
});

it('rejects the same email twice in one tenant (409)', async () => {
  const res = await httpAs(TENANT_A.slug, TENANT_A.domain).post('/customers').send({ email: 'alice@example.com', name: 'Alice Again' });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('already_exists');
});

it('a tenant can update and delete its own rows', async () => {
  const created = await httpAs(TENANT_B.slug, TENANT_B.domain).post('/customers').send({ email: 'carol@example.com', name: 'Carol' });
  expect(created.status).toBe(201);
  const id = created.body.id;
  const updated = await httpAs(TENANT_B.slug, TENANT_B.domain).patch(`/customers/${id}`).send({ name: 'Carol Updated' });
  expect(updated.status).toBe(200);
  expect(updated.body.name).toBe('Carol Updated');
  const deleted = await httpAs(TENANT_B.slug, TENANT_B.domain).delete(`/customers/${id}`);
  expect(deleted.status).toBe(204);
  const gone = await httpAs(TENANT_B.slug, TENANT_B.domain).get(`/customers/${id}`);
  expect(gone.status).toBe(404);
});

it('keeps concurrent requests from different tenants in separate contexts', async () => {
  const results = await Promise.all([
    httpAs(TENANT_A.slug, TENANT_A.domain).get('/customers'),
    httpAs(TENANT_B.slug, TENANT_B.domain).get('/customers'),
    httpAs(TENANT_A.slug, TENANT_A.domain).post('/customers').send({ email: 'dave-a@example.com', name: 'Dave A' }),
    httpAs(TENANT_B.slug, TENANT_B.domain).post('/customers').send({ email: 'dave-b@example.com', name: 'Dave B' }),
  ]);
  const [listA, listB, createA, createB] = results;
  expect(createA.status).toBe(201);
  expect(createB.status).toBe(201);
  const emailsA = listA.body.map((c: any) => c.email);
  const emailsB = listB.body.map((c: any) => c.email);
  // no cross-contamination in either list, whatever the interleaving
  expect(emailsA).not.toContain('bob@example.com');
  expect(emailsA).not.toContain('dave-b@example.com');
  expect(emailsB).not.toContain('alice@example.com');
  expect(emailsB).not.toContain('dave-a@example.com');

  // afterwards, each tenant sees exactly its own rows
  const afterA = await httpAs(TENANT_A.slug, TENANT_A.domain).get('/customers');
  const afterB = await httpAs(TENANT_B.slug, TENANT_B.domain).get('/customers');
  expect(afterA.body.map((c: any) => c.email).sort()).toEqual(['alice@example.com','dave-a@example.com','shared@example.com'].sort());
  expect(afterB.body.map((c: any) => c.email).sort()).toEqual(['bob@example.com','carol@example.com'... wait, carol was deleted.
```

Careful with the state: before the concurrency test, the state of tenant A: alice, shared (A); tenant B: bob, shared (B), carol was created then deleted (in the "own rows" test). Order of tests: the "own rows" test runs before the concurrency test → carol is deleted. So afterB emails: bob, shared(B), dave-b. And afterA: alice, shared(A), dave-a. ✔ deterministic.

But test order dependency — vitest runs `it` blocks in order by default ✔ (not concurrent within a file).

Also add a service-level interleaving test:

```ts
it('keeps interleaved in-process tenant contexts separate', async () => {
  const service = app.get(CustomerService);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const [rowsA, rowsB] = await Promise.all([
    tenantContext.run(tenantA, async () => { await sleep(20); return service.list(); }),
    tenantContext.run(tenantB, async () => { await sleep(5); return service.list(); }),
  ]);
  const emailsA = rowsA.map((c) => c.email);
  const emailsB = rowsB.map((c) => c.email);
  expect(emailsA).not.toContain('bob@example.com');
  expect(emailsB).not.toContain('alice@example.com');
});
```

✔.

Now — one more important check: **`app.get(CustomerService)`** — the CustomerService is provided in the root AppModule's graph (CustomerModule) — resolvable via the app injector ✔ (modules in the root graph).

**Prisma service's onModuleDestroy — app.close() disconnects ✔.**

**Potential flakiness: none major.**

**Now, let me re-verify the "404 on unknown host" test: the Host `app.unknown-operator.com` — findByDomain returns null → 404 ✔.**

**Now, the order of checks in `resolveFromRequest`:** domain first (404), then org (403). If both are unknown → 404 (domain checked first) — acceptable; the mismatch test uses a valid domain + wrong org → 403 ✔.

**One more consideration — the `GET /tenant-config` path is singular — the convention says endpoints are plural, but the task explicitly specifies `GET /tenant-config`. The task wins. I'll add a short comment? No, keep the code clean; a brief comment is OK: `// Task-specified path (singular, not plural).`? I'll add a one-line comment for clarity. Fine.**

**Now, package.json — final:**

```json
{
  "name": "white-label-tenant-isolation",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "postinstall": "prisma generate",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "migrate": "prisma migrate deploy",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.8",
    "@nestjs/core": "^10.3.8",
    "@nestjs/platform-express": "^10.3.8",
    "@prisma/client": "^5.14.0",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.8",
    "@types/express": "^4.17.21",
    "@types/jest": ... no
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.2",
    "@types/supertest": "^6.0.2",
    "@vitejs/plugin-swc": "^3.7.0",
    "prisma": "^5.14.0",
    "supertest": "^7.0.0",
    "typescript": "^5.4.5",
    "vitest": "^2.0.0"
  }
}
```

`@vitejs/plugin-swc` ^3.7.0 — does it exist? plugin-swc versions: 3.2.0 (Mar 2024) … 3.7.0 (Nov 2024). Yes, 3.7 exists. OK.

vitest ^2.0.0 — pulls in vite ^5. plugin-swc 3.7's peer is vite ^5 || ^6? plugin-swc 3.7 supports vite 5/6? Its peerDependencies: `vite: ">=5.0.0"` I think? Let me just use `^3.6.0` to be safe? I'll write `"@vitejs/plugin-swc": "^3.6.0"` — the range allows 3.7. OK.

Also, does the swc plugin need `@swc/core` listed? The plugin has a dependency on `@swc/core` (not just peer) — plugin-swc lists `@swc/core` as a regular dependency? Hmm, I think `@vitejs/plugin-swc` depends on `@swc/core` directly. Yes (it imports it). pnpm will handle it.

**tsconfig — one more: `"moduleDetection": "force"`? Not needed. Keep it minimal.**

**Now, a potential issue: `import { Test } from '@nestjs/testing'` under ESM — @nestjs/testing is CJS; the default interop is OK. Named import from CJS: `import { Test } from '@nestjs/testing'` — Node ESM named-import-from-CJS detection via cjs-module-lexer — does Nest's CJS bundle export `Test`? @nestjs/testing's index.js is compiled TS CJS with `exports.Test = ...`? Nest 10 is… NestJS packages ship as CJS (10.x; ESM support via "exports" with an esm build? Nest 10 still ships CJS-only, I think; ESM consumption works via Node's CJS interop). Named import from CJS works when the lexer can detect `exports.Test = ...`. Nest compiles with tsc → `exports.Test = void 0; ... exports.Test = Test;`? The typical tsc CJS output: `Object.defineProperty(exports, "__esModule", { value: true }); exports.Test = void 0; ... exports.Test = Test_1.Test;` — the lexer handles `exports.X = ` assignments ✔. This is a well-trodden path (lots of people use Nest with ESM node). ✔.

**`import request from 'supertest'` — supertest is CJS; the default import gets module.exports ✔ (esModuleInterop).**

**Vitest + SWC: test files are also transformed by the swc plugin (all TS) ✔ — so decorators in the src files that the tests import also get metadata ✔.**

**One risk: `emitDecoratorMetadata` via SWC and `design:paramtypes` for classes imported from other modules (cross-module DI) — metadata references the class value; SWC emits `typeof` references — works under ESM ✔.**

**Circular imports?** tenant-scope imports tenant-context (common) — no cycle. The prisma service imports tenant-scope. Modules: OrderModule imports CustomerModule/PlanModule; no cycle. ✔.

**Now, `tenant-context.ts` imports AppError from app-error.js — and app-error imports nothing. ✔.**

**The filter imports Prisma from '@prisma/client' — a heavy import but fine.**

**Now, let me also re-verify `@HttpCode(204)` + returning void: with 204, Nest suppresses the body ✔. The service's remove returns `Promise<void>`? `this.customers.remove(id)` returns a Prisma delete promise (returns the deleted row) — the service's `remove` returns `void` after await:

```ts
async remove(id: string): Promise<void> { await this.customers.remove(id); }
```

✔.

**Controller's `@Delete(':id') @HttpCode(204) remove(...)` returns a Promise<void> ✔.**

**Now, the `Order` naming in the Prisma client: `prisma.order` — the model name `Order` → property `order` ✔.**

**Order create in the extension: `args.data` stamped ✔.**

**Let me also confirm the plan's repository/service:**

PlanService.get throws 404 like customers. create: `this.plans.create({ name, priceCents })` — P2002 on (tenantId,name) → 409.

**Do I need a list for PlanService? Keep list + get + create.**

**OrderRepository.list/getById/create.**

Now, **the middleware file naming convention**: `kebab-case.role.ts` → `tenant-resolution.middleware.ts` ✔.

**The filter name**: `all-exceptions.filter.ts` ✔ (role suffix). tenant-context is a "common" role: `tenant-context.ts` — the convention `kebab-case.role.ts` suggests a role suffix… `tenant-context.context.ts`? Ugly. The convention is a guideline for feature roles; a plain `tenant-context.ts` is fine. Similarly `app-error.ts`, `error-envelope`? I'll keep `app-error.ts` (containing AppError + errorEnvelope). Hmm, maybe split the envelope into the filter? The middleware also needs the envelope. Keep both in `app-error.ts`: the class + a helper `errorEnvelope(code, message, details)`. OK.

**Let me write the exact error messages (developer-facing English).**

Now — **a critical correctness check on `jwt.sign` in the helper with `process.env.JWT_SECRET!`**: in the tenant spec, we sign a token with 'wrong-secret' for the forgery — `process.env.JWT_SECRET` is set in createTestApp (called in beforeAll before the tests) ✔.

Order of beforeAll in tenant.spec: reset → seedTenants → createTestApp (sets JWT_SECRET). The test uses issueToken ✔.

**Edge: `resetDatabase` before `createTestApp` — the seed client is created on demand with the DATABASE_URL guard ✔.**

**Now — a potential problem: the app's PrismaService's `onModuleInit` `$connect()` happens in `app.init()` — after seeding, fine.**

**afterAll: `app.close()` triggers `onModuleDestroy` → `$disconnect` ✔; then `closeSeedClient()` ✔.**

**Now, the exact extension code — let me handle one more operation: `findUniqueOrThrow`? The repository uses findFirst — I'll avoid findUniqueOrThrow. But fail-closed: if someone calls findUniqueOrThrow, the default branch throws AppError — good (the filter catches → 500 internal_error). Hmm, should I add findUniqueOrThrow to the where set? For completeness, I could add it to WHERE_OPERATIONS:

'findUniqueOrThrow' — yes, add (same where injection). And 'updateMany','deleteMany' are already there. What about `$queryRaw`/`$executeRaw`? The raw queries bypass the model-level interceptor — the raw queries don't go through $allModels! "Zero raw SQL" in the service — and the repository doesn't use raw ✔. But a defense-in-depth note: the scoped client's raw methods still exist. I could override them… extensions don't intercept raw queries. To be strict, the repositories only use model delegates; acceptable. I won't add raw (would need a custom method override — `client.$extends({ model: {...} })` can't wrap `$queryRaw`). Actually, can you override $queryRaw via the extension's `client` option? There's no documented way; I'll skip. The repository won't use it. Fine.

**Let me also handle `createMany`'s `skipDuplicates` — irrelevant.**

**Now, the typing of `PrismaService.tenant` — repositories call `this.prisma.tenant.customer.findMany({ orderBy: { createdAt: 'asc' } })` ✔ typed.**

**`findFirst({ where: { id } })` returns `Customer | null` ✔.**

**Now, the controller returns the service's promise — the response is auto-serialized: the Prisma objects include Date → JSON serializes to ISO strings ✔.**

**The envelope: `details` object — in the 400 validation: `{ errors: string[] }` — an array inside an object — fine ("details is an object" — an object containing an array; details itself is an object ✔).**

**Let me finalize the file contents. Also confirm all relative imports use the `.js` extension (NodeNext).** Test files also import from `../src/...js` and `./helpers.js` — Vite resolves `.js`→`.ts` ✔. Hmm — does Vite do that for TS? Yes: Vite's resolver tries the actual file, then the TS substitution (esbuild/vite handles `.js` → `.ts` in a TS project — this is standard in monorepos with bundler resolution; vite natively supports "TypeScript files importing .js paths" since Vite 4?). Let me re-verify: Vite's docs "TypeScript" — when you import `./foo.js`, if the file is `foo.ts`, does Vite resolve it? I believe so — Vite's resolver has logic for TS projects where `.js` imports resolve to `.ts` sources (added long ago for TS Node16 resolution support). Yes, Vite supports it (it's in the esbuild/vite docs: "Vite resolves `.js` to `.ts`"). I'm fairly confident (it's common in Vitest projects with NodeNext). ✔.

Alternatively, I could avoid the issue: use a tsconfig with `"moduleResolution": "bundler"` and no extensions — but then the compiled ESM output breaks at Node runtime (extensionless). Since the `start` script runs `node dist/main.js`, the NodeNext+extensions is correct. I'll stick with `.js` extensions everywhere.

**`import 'reflect-metadata'` in main.ts and the test helper ✔ (once is enough, but harmless).**

**Also — `src/main.ts` is included in tsconfig (rootDir src) ✔. Test files excluded from the build ✔ (include: ["src"]).**

**One more: `vitest` needs `@types/node` for node: imports in tests — devDep ✔.**

**Now, let me re-examine a potential subtle bug: the `tenantContext.run(tenantId, () => next())` inside the middleware — Nest may invoke the middleware via its own wrapper, and `next` is express's next. Calling `next()` inside the run callback — the ALS context is active during the downstream ✔. But: Nest wraps the middleware pipeline; the `use` function is awaited; my `use` is async — Nest awaits the returned promise ✔ (Nest supports async middleware).**

**But a real subtle issue**: does Nest's middleware runner catch rejections? If my use() throws unexpectedly (I catch everything) — fine.

**Another subtle point — `forRoutes('*')` applies to all routes including health? We don't have a health route. ✔.**

**Now, the `AppError` import in tenant-context: AppError(500, 'tenant_context_missing', ...) — thrown inside the extension, which runs inside the repository call inside the request → caught by the global filter → 500 envelope ✔.**

**Let me draft the order module's imports:**

```ts
@Module({
  imports: [PrismaModule, CustomerModule, PlanModule],
  providers: [OrderService, OrderRepository],
  exports: [OrderService],
})
export class OrderModule {}
```

CustomerModule exports CustomerService ✔; PlanModule exports PlanService ✔.

**Plan module:**

```ts
@Module({
  imports: [PrismaModule],
  providers: [PlanService, PlanRepository],
  exports: [PlanService],
})
export class PlanModule {}
```

**Now, the tenant module also exports TenantService (harmless; the tests don't need it but it's fine). Keep the exports minimal: nothing external needs TenantService. But exporting it is harmless; the wiring rule says "providers used across modules are exported" — if not used, no need to export. I'll skip the export (cleaner discipline). Hmm — but the middleware injects TenantService internally ✔.**

Actually wait — the tests don't need TenantService. Skip the export.

**Customer module: CustomerService exported (used by OrderModule) ✔.**

**Now, let me also consider: should the PrismaModule be @Global to avoid importing it everywhere? The convention explicitly describes the import/export wiring — I'll follow it (non-global, explicit imports).**

**Alright, let me write everything out.**

Let me also double-check the `jsonwebtoken` verify options: `{ algorithms: ['HS256'] }` ✔. `jwt.verify` returns a string (if the payload isn't an object) or a JwtPayload. If the token is signed with a string payload (e.g. `jwt.sign('x', secret)`) → payload is a string → `payload.org` is undefined → 401 missing claim. My code: `const org = typeof payload === 'object' ? (payload as Record<string, unknown>).org : undefined`. Let me write it:

```ts
const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
const org = typeof payload === 'object' && payload !== null ? (payload as { org?: unknown }).org : undefined;
if (typeof org !== 'string' || org.trim().length === 0) throw new AppError(401, 'unauthorized', 'The access token is missing the "org" claim.');
```

✔.

**The Host normalization:** lowercase + strip the port:

```ts
function normalizeHost(raw: string | undefined): string {
  const host = (raw ?? '').trim().toLowerCase();
  const portIndex = host.lastIndexOf(':');
  return portIndex === -1 ? host : host.slice(0, portIndex);
}
```

Using lastIndexOf to avoid breaking IPv6? `[::1]:3000` → lastIndexOf ':' gives the port ✔. Fine.

**Test "ignores the port": Host `app.operator-a.com:8443` → normalized ✔.**

**Also, `resolveFromRequest` — pass the normalized host as a parameter from the middleware ✔; the unknown-host test's details.host = normalized (no port) ✔.**

**Now, the tenant-config controller returns `configForCurrentTenant()` — which includes `tenant: {id, slug, name, domain}`.**

**The tenant service's `configForCurrentTenant` uses `tenantContext.require()` — the middleware sets it ✔. If the route is somehow hit without the context (impossible) → 500 tenant_context_missing.**

Hmm — alternatively, the controller could pass `tenantContext.current()`… no, the service reading the ambient context is consistent with the "request-scoped context" design.

**Let me re-verify the P2025 mapping for `update` in the filter — message: 'The requested record does not exist for this tenant.' code resource_not_found 404 ✔. Test expects `resource_not_found` on cross-tenant update ✔.**

**P2002 → 409 already_exists — test expects that on duplicate email ✔.**

**Now, let me write the exact migration SQL to match Prisma 5's output style.** I'll include the comments like Prisma does (`-- CreateTable`).

Also, **do I need a `prisma/migrations/migration_lock.toml`?** `prisma migrate dev` creates `migration_lock.toml` with `provider = "postgresql"`. `migrate deploy` doesn't strictly need it (dev does). Including it is more complete:

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

I'll include it — makes the migrations folder complete for `migrate deploy`. Yes.

**Now, `package.json` "postinstall": "prisma generate" — prisma CLI reads the schema; the datasource's env("DATABASE_URL") — generate works without DATABASE_URL set ✔ (env isn't needed for generate).**

**Alright, potential TS strict issues to preempt:**

1. `PrismaService`: `private readonly client = new PrismaClient();` — PrismaClient's constructor: `new PrismaClient()` ✔.
2. `readonly tenant = applyTenantScope(this.client);` — the inferred type is complex ✔.
3. The filter: `host.switchToHttp().getResponse<Response>()` — needs `import type { Response } from 'express';` ✔.
4. The middleware: `import type { NextFunction, Request, Response } from 'express';` ✔.
5. `res.status(...).json(...)` returns a Response ✔ (ignore the return value).
6. The controller: `@Param('id') id: string` ✔.
7. `AppError`'s readonly properties via the constructor parameter — with `useDefineForClassFields:false` fine.

**The helper's `httpAs` returns a SuperTest agent with headers set — but each `request(app.getHttpServer())` creates a new agent; setting headers then calling `.get()` ✔.**

**In the concurrency test, `listA.body.map((c: any) => c.email)` — the body type is any ✔.**

**Vitest globals? I'll import explicitly from 'vitest' ✔ (no globals config needed).**

**testTimeout 30s for DB ops ✔.**

**Now — let me reconsider whether to use `beforeAll` for the customer seeding that expects 201: if the DB is empty per test file (the reset in each spec's beforeAll), the state is deterministic ✔.**

**One more: the two spec files each do resetDatabase in beforeAll — if vitest runs them in parallel (default: files run in parallel across workers), they share the same DB and would race each other! Vitest's default `pool: 'threads'` runs test files in parallel. Two files resetting the shared DB concurrently → flaky cross-contamination.

Fix: set `test: { fileParallelism: false }` or `poolOptions.threads.singleThread`? Vitest 2: `fileParallelism: false` (replaces `threads: false`? In vitest 1: `threads: false`; in vitest 2: `fileParallelism: false`). To be safe, I'll set both? The vitest 2 config key `fileParallelism` exists; `threads` (top-level) was removed? To be safe, I'll set `fileParallelism: false` — vitest ^2 supports it. Or `sequence: { concurrent: false }` is the default anyway; the file-level parallelism is the issue.

Alternatively, give each spec its own tenants (unique slugs/domains) and only delete their own rows — avoiding the global reset. That's more robust to parallelism! But the "list contains exactly these emails" assertions require knowing all rows for the tenant — if the tenant is unique per file and I only seed mine, that's fine: reset only the rows of my own tenant? But leftover rows from a previous run of the same file (same slugs) — reset by tenant slug: delete customers where tenantId in (my tenants)… via seed client: `seed.customer.deleteMany({ where: { tenantId: { in: [aId, bId] } } })` — but tenant IDs change between runs (uuid). Delete tenants by slug: first find by slug, delete their customers/plans/orders, then delete the tenants.

Simplest and most robust: make the tenant slugs unique per spec file (tenant.spec uses `operator-a/b`; customer.spec uses `customer-a/b`… hmm, but then the domain differs). And each spec resets only its own tenants' data. Then parallelism is safe. But is it worth it? The harness probably runs `vitest run` — parallel by default. Two files resetting the whole DB in parallel = flaky. I'll do both: per-file unique tenant slugs + scoped reset of only those tenants, AND set `fileParallelism: false` in vitest config for extra determinism. The belt-and-suspenders approach is defensible.

Hmm, but per-file unique slugs make the helpers more complex: parameterize seedTenants with a prefix:

```ts
export function tenantDefs(prefix: string) {
  return [
    { slug: `${prefix}-a`, domain: `app.${prefix}-a.com`, name: `${prefix} A`, branding: {...}, featureFlags: {...} },
    { slug: `${prefix}-b`, domain: `app.${prefix}-b.com`, name: `${prefix} B`, branding: {...}, featureFlags: {...} },
  ];
}
```

And `seedTenants(defs)` returns the ids. Reset: for each slug, find the tenant; delete customers/plans/orders by tenantId; delete the tenant.

Let me design the helpers:

```ts
export interface TenantSeed { slug: string; domain: string; name: string; branding: Record<string, unknown>; featureFlags: Record<string, unknown>; }

export function makeTenantSeeds(prefix: string): [TenantSeed, TenantSeed] {
  return [
    { slug: `${prefix}-a`, domain: `app.${prefix}-a.com`, name: `${prefix} A`, branding: { primaryColor: '#1a73e8', logoUrl: `https://cdn.${prefix}-a.com/logo.svg` }, featureFlags: { betaCheckout: true, supportInbox: false } },
    { slug: `${prefix}-b`, domain: `app.${prefix}-b.com`, name: `${prefix} B`, branding: { primaryColor: '#e91e63', logoUrl: `https://cdn.${prefix}-b.com/logo.png` }, featureFlags: { betaCheckout: false, supportInbox: true } },
  ];
}

export async function seedTenants(seeds: TenantSeed[]): Promise<string[]> {
  const ids: string[] = [];
  for (const seed of seeds) {
    const t = await c.tenant.upsert({ where: { slug: seed.slug }, update: {}, create: seed });
    ids.push(t.id);
  }
  return ids;
}
```

Hmm upsert vs create: after reset (which deletes), create is fine. I'll use create after ensuring deletion:

```ts
export async function resetTenants(seeds: TenantSeed[]): Promise<void> {
  for (const seed of seeds) {
    const existing = await c.tenant.findUnique({ where: { slug: seed.slug } });
    if (!existing) continue;
    await c.order.deleteMany({ where: { tenantId: existing.id } });
    await c.customer.deleteMany({ where: { tenantId: existing.id } });
    await c.plan.deleteMany({ where: { tenantId: existing.id } });
    await c.tenant.delete({ where: { id: existing.id } });
  }
}
```

✔ Scoped reset. And `fileParallelism: false` anyway.

Spec 1 prefix 'tenant', spec 2 prefix 'customer'. The domains like `app.tenant-a.com` are fine.

Branding/flags constants per spec: I'll just use the values returned from makeTenantSeeds in assertions (referencing the local `const [seedA, seedB] = makeTenantSeeds('tenant')`). ✔.

**Also — the app is created per spec file; two apps (one per file) each with their own PrismaClient — in serial execution, the first app is closed before the second? Vitest runs files in separate workers; with fileParallelism false, sequentially ✔. Even in parallel, separate connections — fine. But the shared DB with unique slugs per file avoids data races ✔.**

**OK — one more thought on `createTestApp` and the middleware reading `process.env.JWT_SECRET`: set in createTestApp ✔.**

**Now, a potential vitest+swc+`import 'reflect-metadata'` issue: reflect-metadata is CJS; imported as a side effect ✔.**

**Nest + ESM + `emitDecoratorMetadata` via SWC: does Nest need `Reflect.defineMetadata` to be patched for `design:paramtypes` — reflect-metadata provides it ✔.**

**Alright, let me re-verify one more time the Prisma extension for `update` when the row doesn't exist → P2025 → the filter 404 ✔; when the row is in another tenant → the scoped where excludes it → P2025 → 404 ✔ (same path as not found — correct: 404, not 403, per the task "fetch by ID (expect 404)").**

**Task: "tenant B cannot list, fetch by ID (expect 404), update, or delete tenant A's row" ✔ covered.**

**Also the task: "tenant resolution middleware: derive the tenant from host + the token's org claim (both must match); reject mismatches. Tenant is stored in a request-scoped context." ✔.**

**"structural isolation… the handler never passes tenantId manually" ✔.**

**Let me now write the files.**

Also — **a `.env` handling**: no .env file (no secrets in the repo). DATABASE_URL is provided by the env. ✔.

**README?** The task says nothing outside the pattern is read; a README isn't requested. Skip (discipline).

Also re-verify the **`Test.createTestingModule({ imports: [AppModule] })` + `createNestApplication()` + `init()`** — the standard e2e recipe ✔.

**One more consideration — `app.getHttpServer()` returns the http.Server ✔; supertest accepts it ✔.**

**In tenant.spec, the "token without the org claim" — sign `{ sub: 'x' }` → payload object without org → 401 ✔. Also test an `org: 123` non-string? Skip, one is enough. Actually, let me also assert that the 401 response has the envelope shape (error.message is a string, details is an object) — I'll assert the envelope on the first test, and the code on the others.**

**Now, let me also decide the `GET /tenant-config` response — include `tenant.id`? Yes: id, slug, name, domain. The tests match slug/name/domain.**

**Time to write the final files, in order:**

1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/migration_lock.toml
6. prisma/migrations/20240601000000_init/migration.sql
7. src/main.ts
8. src/app.module.ts
9. src/common/app-error.ts
10. src/common/tenant-context.ts
11. src/common/all-exceptions.filter.ts
12. src/prisma/prisma.module.ts
13. src/prisma/prisma.service.ts
14. src/prisma/tenant-scope.ts
15. src/tenant/tenant.module.ts
16. src/tenant/tenant.repository.ts
17. src/tenant/tenant.service.ts
18. src/tenant/tenant-resolution.middleware.ts
19. src/tenant/tenant-config.controller.ts
20. src/customer/customer.module.ts
21. src/customer/customer.repository.ts
22. src/customer/customer.service.ts
23. src/customer/customer.controller.ts
24. src/plan/plan.module.ts
25. src/plan/plan.repository.ts
26. src/plan/plan.service.ts
27. src/order/order.module.ts
28. src/order/order.repository.ts
29. src/order/order.service.ts
30. test/helpers.ts
31. test/tenant.spec.ts
32. test/customer.spec.ts

Now let me write each file carefully.

**package.json** — as above.

**tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "skipLibCheck": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

**vitest.config.ts:**

```ts
import { defineConfig } from 'vitest/config';
import swc from '@vitejs/plugin-swc';

export default defineConfig({
  plugins: [
    // NestJS relies on constructor-injection metadata (design:paramtypes),
    // which esbuild (Vite's default TS transform) cannot emit.
    swc({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, useDefineForClassFields: false },
        target: 'es2022',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

**schema.prisma** — as drafted. Add `updatedAt DateTime @updatedAt @map("updated_at")` to all.

**migration_lock.toml:**

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

**migration.sql** — write it in Prisma style:

```sql
-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branding" JSONB NOT NULL DEFAULT '{}',
    "feature_flags" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'created',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

-- CreateIndex
CREATE INDEX "plans_tenant_id_idx" ON "plans"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_tenant_id_name_key" ON "plans"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");
```

**src/main.ts:**

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

**src/app.module.ts:**

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { PlanModule } from './plan/plan.module.js';
import { OrderModule } from './order/order.module.js';

@Module({
  imports: [PrismaModule, TenantModule, CustomerModule, PlanModule, OrderModule],
  providers: [
    // Single error envelope for the whole API, including the test app.
    { provide: APP_FILTER, useValue: new AllExceptionsFilter() },
  ],
})
export class AppModule {}
```

**src/common/app-error.ts:**

```ts
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/**
 * Application error carrying its HTTP status, stable snake_case code and
 * structured details. The global filter (and the tenant middleware) render
 * these into the single error envelope.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorEnvelope(code: string, message: string, details: Record<string, unknown> = {}): ErrorEnvelope {
  return { error: { code, message, details } };
}
```

**src/common/tenant-context.ts:**

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from './app-error.js';

const storage = new AsyncLocalStorage<string>();

/**
 * Request-scoped tenant context, backed by AsyncLocalStorage so that
 * concurrent requests (and interleaved in-process work) never share a
 * tenant. Set once by the tenant-resolution middleware, read by the
 * tenant-scoped Prisma client.
 */
export const tenantContext = {
  run<R>(tenantId: string, fn: () => R): R {
    return storage.run(tenantId, fn);
  },

  current(): string | undefined {
    return storage.getStore();
  },

  require(): string {
    const tenantId = storage.getStore();
    if (!tenantId) {
      throw new AppError(500, 'tenant_context_missing', 'This operation requires an active tenant context.');
    }
    return tenantId;
  },
};
```

**src/common/all-exceptions.filter.ts:**

```ts
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { AppError, errorEnvelope } from './app-error.js';

/**
 * Renders every unhandled exception as the single error envelope:
 * { "error": { "code", "message", "details" } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      this.send(res, exception.status, exception.code, exception.message, exception.details);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const target = (exception.meta as { target?: unknown } | null)?.target;
        this.send(res, 409, 'already_exists', 'A record with the same unique value already exists in this tenant.', { target: target ?? [] });
        return;
      }
      if (exception.code === 'P2025') {
        this.send(res, 404, 'resource_not_found', 'The requested record does not exist in this tenant.');
        return;
      }
      this.send(res, 500, 'database_error', 'A known database error occurred.', { prismaCode: exception.code });
      return;
    }

    console.error('Unhandled exception:', exception);
    this.send(res, 500, 'internal_error', 'An unexpected error occurred.');
  }

  private send(res: Response, status: number, code: string, message: string, details: Record<string, unknown> = {}): void {
    if (res.headersSent) return;
    res.status(status).json(errorEnvelope(code, message, details));
  }
}
```

**src/prisma/prisma.module.ts:**

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

**src/prisma/prisma.service.ts:**

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyTenantScope } from './tenant-scope.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new PrismaClient();

  /**
   * Tenant-scoped client used by every repository: reads are automatically
   * filtered to the ambient tenant, writes are stamped with it. No caller
   * ever passes tenantId explicitly.
   */
  readonly tenant = applyTenantScope(this.client);

  /**
   * Unscoped client. Only the tenant registry itself (the Tenant model)
   * may use it, because tenant resolution happens before a context exists.
   */
  readonly unscoped = this.client;

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
```

**src/prisma/tenant-scope.ts:**

```ts
import type { PrismaClient } from '@prisma/client';
import { tenantContext } from '../common/tenant-context.js';
import { AppError } from '../common/app-error.js';

/**
 * Structural isolation for the data layer.
 *
 * Applied to the Prisma client used by all repositories. For every model
 * except the tenant registry itself, this extension:
 *   - adds `tenantId` to the `where` clause of every read and every
 *     row-addressing write, so a query can never see or touch another
 *     tenant's rows;
 *   - stamps `tenantId` onto every created row, so writes can never miss
 *     a tenant;
 *   - fails closed on any operation it does not explicitly understand.
 *
 * The tenant is read from the request-scoped context (AsyncLocalStorage),
 * never from caller-supplied arguments.
 */
const UNSCOPED_MODELS: ReadonlySet<string> = new Set(['Tenant']);

const WHERE_OPERATIONS: ReadonlySet<string> = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'delete',
  'updateMany',
  'deleteMany',
]);

type OperationContext = {
  model: string;
  operation: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (args: any) => Promise<any>;
};

export function applyTenantScope<T extends PrismaClient>(client: T) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations(ctx: OperationContext) {
          if (UNSCOPED_MODELS.has(ctx.model)) {
            return ctx.query(ctx.args);
          }

          const tenantId = tenantContext.require();
          const args = { ...ctx.args };

          switch (ctx.operation) {
            case 'create':
              args.data = { ...args.data, tenantId };
              break;
            case 'createMany':
              args.data = Array.isArray(args.data)
                ? args.data.map((row: Record<string, unknown>) => ({ ...row, tenantId }))
                : { ...args.data, tenantId };
              break;
            case 'upsert':
              args.where = { ...args.where, tenantId };
              args.create = { ...args.create, tenantId };
              break;
            default:
              if (!WHERE_OPERATIONS.has(ctx.operation)) {
                throw new AppError(500, 'tenant_scope_unsupported_operation', `Refusing to run Prisma operation "${ctx.operation}" without tenant isolation.`, { model: ctx.model, operation: ctx.operation });
              }
              args.where = { ...args.where, tenantId };
          }

          return ctx.query(args);
        },
      },
    },
  });
}
```

Hmm, wait — `$extends` with `name` + `query`: the type — the overload with a name? `client.$extends({ name, query })` — yes, supported: "You can give your extension a name" — `$extends({ name: 'tenant-scope', query: {...} })`. ✔ Prisma 5.

The typing of `args` as any — under strict, an explicit any is OK.

Wait, one issue: `args` for `count` — `args.where` might be undefined → `{...undefined, tenantId}` = `{tenantId}` ✔.

`groupBy`: has `where?` ✔.

**src/tenant/tenant.repository.ts:**

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Access to the tenant registry. This is the only repository that talks to
 * the unscoped Prisma client, because tenant resolution runs before any
 * request-scoped tenant context exists.
 */
@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByDomain(domain: string) {
    return this.prisma.unscoped.tenant.findUnique({ where: { domain } });
  }

  findBySlug(slug: string) {
    return this.prisma.unscoped.tenant.findUnique({ where: { slug } });
  }

  findById(id: string) {
    return this.prisma.unscoped.tenant.findFirst({ where: { id } });
  }
}
```

No `create` needed here (the tests seed via the raw client). OK.

**src/tenant/tenant.service.ts:**

```ts
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { tenantContext } from '../common/tenant-context.js';
import { TenantRepository } from './tenant.repository.js';

export interface TenantConfig {
  tenant: { id: string; slug: string; name: string; domain: string };
  branding: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
}

@Injectable()
export class TenantService {
  constructor(private readonly tenants: TenantRepository) {}

  /**
   * Resolves the tenant for a request. The request host and the `org` claim
   * of the token must both resolve to the same tenant; anything else is a
   * rejection, never a guess.
   */
  async resolveFromRequest(domain: string, orgClaim: string): Promise<string> {
    const byDomain = await this.tenants.findByDomain(domain);
    if (!byDomain) {
      throw new AppError(404, 'tenant_not_found', `No tenant is served on host "${domain}".`, { host: domain });
    }

    const byOrg = await this.tenants.findBySlug(orgClaim);
    if (!byOrg || byOrg.id !== byDomain.id) {
      throw new AppError(403, 'tenant_mismatch', 'The token "org" claim does not match the tenant served on this host.', { host: domain, org: orgClaim });
    }

    return byDomain.id;
  }

  /** Branding and feature flags for the tenant of the current request. */
  async configForCurrentTenant(): Promise<TenantConfig> {
    const tenantId = tenantContext.require();
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw new AppError(404, 'resource_not_found', 'The resolved tenant no longer exists.', { id: tenantId });
    }
    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, domain: tenant.domain },
      branding: (tenant.branding as Record<string, unknown>) ?? {},
      featureFlags: (tenant.featureFlags as Record<string, unknown>) ?? {},
    };
  }
}
```

`tenant.branding` is `Prisma.JsonValue` — cast to Record<string, unknown>. If branding were stored as a string, the cast is a lie, but the seed always stores an object; fine.

**src/tenant/tenant-resolution.middleware.ts:**

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { AppError, errorEnvelope } from '../common/app-error.js';
import { tenantContext } from '../common/tenant-context.js';
import { TenantService } from './tenant.service.js';

/**
 * Resolves the tenant for every request: the Bearer token must be valid,
 * carry an `org` claim, and both the `org` claim and the request host must
 * point at the same tenant. On success the tenant id is installed in the
 * request-scoped context for the remainder of the request.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgClaim = this.readOrgClaim(req);
      const domain = normalizeHost(req.headers.host);
      const tenantId = await this.tenants.resolveFromRequest(domain, orgClaim);
      await tenantContext.run(tenantId, () => next());
    } catch (err) {
      this.reject(res, err);
    }
  }

  /** Verifies the Bearer token and returns its `org` claim. */
  private readOrgClaim(req: Request): string {
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
    if (!token) {
      throw new AppError(401, 'unauthorized', 'A Bearer token in the Authorization header is required.');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new AppError(500, 'internal_error', 'JWT_SECRET is not configured.');
    }

    let payload: jwt.JwtPayload | string;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch {
      throw new AppError(401, 'unauthorized', 'The access token is invalid or expired.');
    }

    const org = typeof payload === 'object' && payload !== null ? (payload as { org?: unknown }).org : undefined;
    if (typeof org !== 'string' || org.trim().length === 0) {
      throw new AppError(401, 'unauthorized', 'The access token is missing a usable "org" claim.');
    }
    return org;
  }

  private reject(res: Response, err: unknown): void {
    if (res.headersSent) return;
    if (err instanceof AppError) {
      res.status(err.status).json(errorEnvelope(err.code, err.message, err.details));
      return;
    }
    console.error('Tenant resolution failed:', err);
    res.status(500).json(errorEnvelope('internal_error', 'An unexpected error occurred.'));
  }
}

/** Lowercases the Host header and strips the port, if present. */
function normalizeHost(raw: string | string[] | undefined): string {
  const host = Array.isArray(raw) ? raw[0] : raw;
  const normalized = (host ?? '').trim().toLowerCase();
  const portIndex = normalized.lastIndexOf(':');
  return portIndex === -1 ? normalized : normalized.slice(0, portIndex);
}
```

Wait, `jwt.verify` returns `string | JwtPayload` (v9 types: `verify` returns `string | object`? The type: `Jwt | string` with `Jwt = object`). My annotation `jwt.JwtPayload | string` — the actual return type of verify is `string | object`? In @types/jsonwebtoken v9: `verify(token, key, options): string | object;`? There's an overload: with `{ complete: true }` → JwtPayload & {header, signature}; without, the default overload returns `string | JwtPayload`? Hmm: `export function verify(token: string, secretOrPublicKey: Secret, options?: VerifyOptions): string;` and `... VerifyOptions & { complete: false }?: ... : string | JwtPayload`? I recall the type: `verify(...): string | object`. To avoid a type mismatch, I'll do:

```ts
const payload: unknown = jwt.verify(token, secret, { algorithms: ['HS256'] });
const org = typeof payload === 'object' && payload !== null ? (payload as { org?: unknown }).org : undefined;
```

✔ safe.

**src/tenant/tenant-config.controller.ts:**

```ts
import { Controller, Get } from '@nestjs/common';
import { TenantService, TenantConfig } from './tenant.service.js';

// Path fixed by the task (singular on purpose).
@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  getConfig(): Promise<TenantConfig> {
    return this.tenants.configForCurrentTenant();
  }
}
```

**src/tenant/tenant.module.ts:**

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantRepository } from './tenant.repository.js';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';
import { TenantService } from './tenant.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantConfigController],
  providers: [TenantService, TenantRepository, TenantResolutionMiddleware],
  configure(consumer: MiddlewareConsumer) {
    // Every route is tenant-gated.
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  },
})
export class TenantModule implements NestModule {}
```

**src/customer/customer.repository.ts:**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * All calls go through the tenant-scoped Prisma client: the ambient tenant
 * is injected into every where clause and stamped onto every write. This
 * repository (and every caller) never mentions tenantId.
 */
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.customer.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.tenant.customer.findFirst({ where: { id } });
  }

  create(data: { email: string; name: string }) {
    return this.prisma.tenant.customer.create({ data });
  }

  update(id: string, data: { email?: string; name?: string }) {
    return this.prisma.tenant.customer.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.tenant.customer.delete({ where: { id } });
  }
}
```

**src/customer/customer.service.ts:**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
...
```

No — I'll use AppError for consistency.

```ts
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { CustomerRepository } from './customer.repository.js';

export interface CreateCustomerInput {
  email: string;
  name: string;
}

export interface UpdateCustomerInput {
  email?: string;
  name?: string;
}

@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  list() {
    return this.customers.list();
  }

  async get(id: string) {
    const customer = await this.customers.findById(id);
    if (!customer) {
      throw new AppError(404, 'resource_not_found', `Customer ${id} was not found for this tenant.`, { id });
    }
    return customer;
  }

  async create(input: CreateCustomerInput) {
    // Duplicate email within the tenant surfaces as Prisma P2002 -> 409.
    return this.customers.create(input);
  }

  async update(id: string, input: UpdateCustomerInput) {
    // Row missing in this tenant: Prisma P2025 -> 404 via the global filter.
    return this.customers.update(id, input);
  }

  async remove(id: string): Promise<void> {
    await this.customers.remove(id);
  }
}
```

**src/customer/customer.controller.ts:**

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { CustomerService } from './customer.service.js';

interface CreateCustomerDto {
  email: string;
  name: string;
}

interface UpdateCustomerDto {
  email?: string;
  name?: string;
}

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  list() {
    return this.customers.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.customers.create(validateCreateCustomer(body));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.customers.update(id, validateUpdateCustomer(body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.customers.remove(id);
  }
}

function validateCreateCustomer(body: unknown): CreateCustomerDto {
  const errors: string[] = [];
  const record = asRecord(body, errors);
  const email = nonEmptyString(record?.email, 'email', errors);
  const name = nonEmptyString(record?.name, 'name', errors);
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.push('"email" must be a valid email address');
  }
  if (errors.length > 0) {
    throw new AppError(400, 'validation_failed', 'The request body is invalid.', { errors });
  }
  return { email: email!, name: name! };
}

function validateUpdateCustomer(body: unknown): UpdateCustomerDto {
  const errors: string[] = [];
  const record = asRecord(body, errors);
  const dto: UpdateCustomerDto = {};
  if (record) {
    if ('email' in record) {
      const email = nonEmptyString(record.email, 'email', errors);
      if (email) {
        if (!EMAIL_PATTERN.test(email)) errors.push('"email" must be a valid email address');
        dto.email = email;
      }
    }
    if ('name' in record) {
      const name = nonEmptyString(record.name, 'name', errors);
      if (name) dto.name = name;
    }
  }
  if (Object.keys(dto).length === 0) {
    errors.push('provide at least one of "email" or "name"');
  }
  if (errors.length > 0) {
    throw new AppError(400, 'validation_failed', 'The request body is invalid.', { errors });
  }
  return dto;
}

function asRecord(body: unknown, errors: string[]): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    errors.push('the request body must be a JSON object');
    return undefined;
  }
  return body as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string, errors: string[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`"${field}" must be a non-empty string`);
    return undefined;
  }
  return value.trim();
}
```

Note: `email!` — if errors is empty, email is defined ✔ (strict: email could be undefined → `!` is OK).

**customer.module.ts:**

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CustomerController } from './customer.controller.js';
import { CustomerRepository } from './customer.repository.js';
import { CustomerService } from './customer.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerRepository],
  exports: [CustomerService],
})
export class CustomerModule {}
```

**plan.repository.ts:**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.plan.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.tenant.plan.findFirst({ where: { id } });
  }

  create(data: { name: string; priceCents: number }) {
    return this.prisma.tenant.plan.create({ data });
  }
}
```

**plan.service.ts:**

```ts
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { PlanRepository } from './plan.repository.js';

@Injectable()
export class PlanService {
  constructor(private readonly plans: PlanRepository) {}

  list() {
    return this.plans.list();
  }

  async get(id: string) {
    const plan = await this.plans.findById(id);
    if (!plan) {
      throw new AppError(404, 'resource_not_found', `Plan ${id} was not found for this tenant.`, { id });
    }
    return plan;
  }

  async create(input: { name: string; priceCents?: number }) {
    return this.plans.create({ name: input.name, priceCents: input.priceCents ?? 0 });
  }
}
```

**plan.module.ts** similarly.

**order.repository.ts:**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.order.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.tenant.order.findFirst({ where: { id } });
  }

  create(data: { customerId: string; planId: string; totalCents: number }) {
    return this.prisma.tenant.order.create({ data });
  }
}
```

**order.service.ts:**

```ts
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { CustomerService } from '../customer/customer.service.js';
import { PlanService } from '../plan/plan.service.js';
import { OrderRepository } from './order.repository.js';

export interface CreateOrderInput {
  customerId: string;
  planId: string;
  totalCents?: number;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly customers: CustomerService,
    private readonly plans: PlanService,
  ) {}

  list() {
    return this.orders.list();
  }

  async get(id: string) {
    const order = await this.orders.findById(id);
    if (!order) {
      throw new AppError(404, 'resource_not_found', `Order ${id} was not found for this tenant.`, { id });
    }
    return order;
  }

  async create(input: CreateOrderInput) {
    // The lookups are tenant-scoped, so a cross-tenant reference fails with
    // 404 here instead of becoming a cross-tenant order.
    const [customer, plan] = await Promise.all([
      this.customers.get(input.customerId),
      this.plans.get(input.planId),
    ]);
    return this.orders.create({
      customerId: customer.id,
      planId: plan.id,
      totalCents: input.totalCents ?? plan.priceCents,
    });
  }
}
```

**order.module.ts:**

```ts
import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PlanModule } from '../plan/plan.module.js';
import { OrderRepository } from './order.repository.js';
import { OrderService } from './order.service.js';

@Module({
  imports: [PrismaModule, CustomerModule, PlanModule],
  providers: [OrderService, OrderRepository],
  exports: [OrderService],
})
export class OrderModule {}
```

**test/helpers.ts:**

```ts
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module.js';

export interface TenantSeed {
  slug: string;
  domain: string;
  name: string;
  branding: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
}

/**
 * The suite runs against a real Postgres reachable via DATABASE_URL
 * (apply the migrations first, e.g. `pnpm migrate`). Each spec file uses
 * its own tenant slugs so files can never cross-contaminate each other.
 */
export function makeTenantSeeds(prefix: string): [TenantSeed, TenantSeed] {
  return [
    {
      slug: `${prefix}-a`,
      domain: `app.${prefix}-a.com`,
      name: `${prefix} A`,
      branding: { primaryColor: '#1a73e8', logoUrl: `https://cdn.${prefix}-a.example.com/logo.svg` },
      featureFlags: { betaCheckout: true, supportInbox: false },
    },
    {
      slug: `${prefix}-b`,
      domain: `app.${prefix}-b.com`,
      name: `${prefix} B`,
      branding: { primaryColor: '#e91e63', logoUrl: `https://cdn.${prefix}-b.example.com/logo.png` },
      featureFlags: { betaCheckout: false, supportInbox: true },
    },
  ];
}

let seed: PrismaClient | undefined;

function seedClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a migrated Postgres database to run this suite.');
  }
  if (!seed) seed = new PrismaClient();
  return seed;
}

/** Deletes only the rows of the given tenants (keeps other specs' data intact). */
export async function resetTenants(seeds: TenantSeed[]): Promise<void> {
  const db = seedClient();
  for (const tenantSeed of seeds) {
    const existing = await db.tenant.findUnique({ where: { slug: tenantSeed.slug } });
    if (!existing) continue;
    await db.order.deleteMany({ where: { tenantId: existing.id } });
    await db.customer.deleteMany({ where: { tenantId: existing.id } });
    await db.plan.deleteMany({ where: { tenantId: existing.id } });
    await db.tenant.delete({ where: { id: existing.id } });
  }
}

export async function seedTenants(seeds: TenantSeed[]): Promise<string[]> {
  const db = seedClient();
  const ids: string[] = [];
  for (const tenantSeed of seeds) {
    const tenant = await db.tenant.create({ data: tenantSeed });
    ids.push(tenant.id);
  }
  return ids;
}

export async function closeSeedClient(): Promise<void> {
  if (seed) await seed.$disconnect();
  seed = undefined;
}

export async function createTestApp(): Promise<INestApplication> {
  if (!process.env.JWT_SECRET) {
    // Test-only key so the suite can mint tokens; production reads it from the environment.
    process.env.JWT_SECRET = 'unit-test-only-secret';
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

export function issueToken(org: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ org }, secret, { algorithm: 'HS256', expiresIn: '5m' });
}
```

`db.tenant.create({ data: tenantSeed })` — tenantSeed has branding/featureFlags Record<string,unknown> — assignable to InputJsonValue? `Record<string, unknown>` vs InputJsonValue — the unknown value type isn't directly assignable to InputJsonValue (the union includes unknown? no). Possible TS error in the test — but the tests aren't type-checked (vitest doesn't type-check). For tidiness, I'll type TenantSeed's branding as `Prisma.InputJsonValue`:

```ts
import type { Prisma } from '@prisma/client';
branding: Prisma.InputJsonValue;
```

And makeTenantSeeds returns that type — the object literals are assignable ✔. Then `db.tenant.create({ data: { ...tenantSeed } })` — the data type expects branding InputJsonValue ✔.

**test/tenant.spec.ts:**

```ts
import 'reflect-metadata';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, issueToken, makeTenantSeeds, resetTenants, seedTenants, closeSeedClient } from './helpers.js';

const [seedA, seedB] = makeTenantSeeds('tenant');

describe('tenant resolution', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetTenants([seedA, seedB]);
    await seedTenants([seedA, seedB]);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeSeedClient();
  });

  const asTenant = (slug: string, domain: string) =>
    request(app.getHttpServer()).set('Host', domain).set('Authorization', `Bearer ${issueToken(slug)}`);

  it('rejects a request without a bearer token with 401 and the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/tenant-config').set('Host', seedA.domain);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.details).not.toBeNull();
    expect(res.body.error.details).toBeTypeOf('object');
  });

  it('rejects a token signed with the wrong key with 401', async () => {
    const forged = jwt.sign({ org: seedA.slug }, 'not-the-configured-secret', { algorithm: 'HS256' });
    const res = await request(app.getHttpServer()).get('/tenant-config').set('Host', seedA.domain).set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a token without an org claim with 401', async () => {
    const token = jwt.sign({ sub: 'anonymous' }, process.env.JWT_SECRET as string, { algorithm: 'HS256' });
    const res = await request(app.getHttpServer()).get('/tenant-config').set('Host', seedA.domain).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a host that no tenant is served on with 404', async () => {
    const res = await asTenant(seedA.slug, 'app.unknown-operator.com');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('tenant_not_found');
    expect(res.body.error.details.host).toBe('app.unknown-operator.com');
  });

  it('rejects a token whose org claim points at a different tenant with 403', async () => {
    const res = await asTenant(seedB.slug, seedA.domain);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
    expect(res.body.error.details).toMatchObject({ host: seedA.domain, org: seedB.slug });
  });

  it('rejects an org claim of a tenant that does not exist with 403', async () => {
    const res = await asTenant('ghost-operator', seedA.domain);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('resolves the tenant from the host even when a port is present', async () => {
    const res = await request(app.getHttpServer()).get('/tenant-config').set('Host', `${seedA.domain}:8443`).set('Authorization', `Bearer ${issueToken(seedA.slug)}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant.slug).toBe(seedA.slug);
  });

  it('returns the branding and feature flags of the resolved tenant', async () => {
    const res = await asTenant(seedA.slug, seedA.domain);
    expect(res.status).toBe(200);
    expect(res.body.tenant).toMatchObject({ slug: seedA.slug, name: seedA.name, domain: seedA.domain });
    expect(res.body.branding).toEqual(seedA.branding);
    expect(res.body.featureFlags).toEqual(seedA.featureFlags);
  });

  it('serves tenant B a different config on its own host', async () => {
    const res = await asTenant(seedB.slug, seedB.domain);
    expect(res.status).toBe(200);
    expect(res.body.tenant.slug).toBe(seedB.slug);
    expect(res.body.branding).toEqual(seedB.branding);
    expect(res.body.featureFlags).toEqual(seedB.featureFlags);
    expect(res.body.featureFlags).not.toEqual(seedA.featureFlags);
  });
});
```

**test/customer.spec.ts:**

```ts
import 'reflect-metadata';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantContext } from '../src/common/tenant-context.js';
import { CustomerService } from '../src/customer/customer.service.js';
import { closeSeedClient, createTestApp, issueToken, makeTenantSeeds, resetTenants, seedTenants } from './helpers.js';

const [seedA, seedB] = makeTenantSeeds('customer');

describe('customer isolation across tenants', () => {
  let app: INestApplication;
  let tenantAId: string;
  let tenantBId: string;
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    await resetTenants([seedA, seedB]);
    [tenantAId, tenantBId] = await seedTenants([seedA, seedB]);
    app = await createTestApp();
  });

  beforeAll(async () => {
    const a = await asTenant(seedA.slug, seedA.domain).post('/customers').send({ email: 'alice@example.com', name: 'Alice' });
    expect(a.status).toBe(201);
    aliceId = a.body.id as string;
    const b = await asTenant(seedB.slug, seedB.domain).post('/customers').send({ email: 'bob@example.com', name: 'Bob' });
    expect(b.status).toBe(201);
    bobId = b.body.id as string;
  });

  afterAll(async () => {
    await app.close();
    await closeSeedClient();
  });

  const asTenant = (slug: string, domain: string) =>
    request(app.getHttpServer()).set('Host', domain).set('Authorization', `Bearer ${issueToken(slug)}`);

  it('a tenant only lists its own customers', async () => {
    const res = await asTenant(seedA.slug, seedA.domain).get('/customers');
    expect(res.status).toBe(200);
    const emails = res.body.map((c: { email: string }) => c.email);
    expect(emails).toContain('alice@example.com');
    expect(emails).not.toContain('bob@example.com');
  });

  it('tenant B cannot fetch tenant A customer by id (404)', async () => {
    const res = await asTenant(seedB.slug, seedB.domain).get(`/customers/${aliceId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('tenant B cannot update tenant A customer (404, row unchanged)', async () => {
    const res = await asTenant(seedB.slug, seedB.domain).patch(`/customers/${aliceId}`).send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');
    const still = await asTenant(seedA.slug, seedA.domain).get(`/customers/${aliceId}`);
    expect(still.status).toBe(200);
    expect(still.body.name).toBe('Alice');
  });

  it('tenant B cannot delete tenant A customer (404, row survives)', async () => {
    const res = await asTenant(seedB.slug, seedB.domain).delete(`/customers/${aliceId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');
    const still = await asTenant(seedA.slug, seedA.domain).get(`/customers/${aliceId}`);
    expect(still.status).toBe(200);
  });

  it('the same email can register in both tenants', async () => {
    const a = await asTenant(seedA.slug, seedA.domain).post('/customers').send({ email: 'shared@example.com', name: 'Shared (A)' });
    const b = await asTenant(seedB.slug, seedB.domain).post('/customers').send({ email: 'shared@example.com', name: 'Shared (B)' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.email).toBe('shared@example.com');
    expect(b.body.email).toBe('shared@example.com');
  });

  it('the same email cannot register twice in one tenant (409)', async () => {
    const res = await asTenant(seedA.slug, seedA.domain).post('/customers').send({ email: 'alice@example.com', name: 'Alice Twice' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_exists');
  });

  it('a tenant can create, update and delete its own rows', async () => {
    const created = await asTenant(seedB.slug, seedB.domain).post('/customers').send({ email: 'carol@example.com', name: 'Carol' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const updated = await asTenant(seedB.slug, seedB.domain).patch(`/customers/${id}`).send({ name: 'Carol Updated' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Carol Updated');

    const deleted = await asTenant(seedB.slug, seedB.domain).delete(`/customers/${id}`);
    expect(deleted.status).toBe(204);

    const gone = await asTenant(seedB.slug, seedB.domain).get(`/customers/${id}`);
    expect(gone.status).toBe(404);
  });

  it('rejects an invalid create body with 400 and the envelope', async () => {
    const res = await asTenant(seedA.slug, seedA.domain).post('/customers').send({ name: 'No Email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Array.isArray(res.body.error.details.errors)).toBe(true);
  });

  it('keeps concurrent requests from different tenants in separate contexts', async () => {
    const [listA, listB, createA, createB] = await Promise.all([
      asTenant(seedA.slug, seedA.domain).get('/customers'),
      asTenant(seedB.slug, seedB.domain).get('/customers'),
      asTenant(seedA.slug, seedA.domain).post('/customers').send({ email: 'dave-a@example.com', name: 'Dave A' }),
      asTenant(seedB.slug, seedB.domain).post('/customers').send({ email: 'dave-b@example.com', name: 'Dave B' }),
    ]);

    expect(createA.status).toBe(201);
    expect(createB.status).toBe(201);

    const emailsA = listA.body.map((c: { email: string }) => c.email);
    const emailsB = listB.body.map((c: { email: string }) => c.email);
    // No matter how the requests interleave, each list must never show the
    // other tenant's rows.
    expect(emailsA).not.toContain('bob@example.com');
    expect(emailsA).not.toContain('dave-b@example.com');
    expect(emailsB).not.toContain('alice@example.com');
    expect(emailsB).not.toContain('dave-a@example.com');

    const afterA = await asTenant(seedA.slug, seedA.domain).get('/customers');
    const afterB = await asTenant(seedB.slug, seedB.domain).get('/customers');
    expect(afterA.body.map((c: { email: string }) => c.email).sort()).toEqual(['alice@example.com', 'dave-a@example.com', 'shared@example.com']);
    expect(afterB.body.map((c: { email: string }) => c.email).sort()).toEqual(['bob@example.com', 'dave-b@example.com', 'shared@example.com']);
  });

  it('keeps interleaved in-process tenant contexts separate', async () => {
    const service = app.get(CustomerService);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const [rowsA, rowsB] = await Promise.all([
      tenantContext.run(tenantAId, async () => {
        await sleep(20);
        return service.list();
      }),
      tenantContext.run(tenantBId, async () => {
        await sleep(5);
        return service.list();
      }),
    ]);

    const emailsA = rowsA.map((c) => c.email);
    const emailsB = rowsB.map((c) => c.email);
    expect(emailsA).toContain('alice@example.com');
    expect(emailsA).not.toContain('bob@example.com');
    expect(emailsB).toContain('bob@example.com');
    expect(emailsB).not.toContain('alice@example.com');
  });
});
```

Wait — the sorted arrays: `['alice@example.com', 'dave-a@example.com', 'shared@example.com']` — alphabetical: alice < dave-a < shared ✔. B: bob < dave-b < shared ✔.

Note: the "keeps concurrent" test assumes the prior state: A: alice, shared; B: bob, shared (carol deleted) ✔ deterministic given the test order.

One concern: `res.body.map` — if the response isn't an array (an error), `.map` would crash and the test would error with a confusing message. Acceptable; the status assertion precedes. Actually, I don't assert listA.status 200 in the concurrency test — add `expect(listA.status).toBe(200)` etc. before mapping. ✔ let me add.

**Two `beforeAll` hooks in the same describe — vitest allows multiple; they run in order ✔. But the second uses `asTenant` (declared as a const inside describe — hoisted? `const asTenant` is declared after the beforeAll hooks in source order but used at runtime (after describe body evaluation completes) — the hook bodies run later, and the closure references the binding which is initialized by then ✔. But `const aliceId` is assigned in the second beforeAll — declared `let` at the top ✔.

Hmm — `asTenant` is used in the second `beforeAll` but declared as a const below it — no TDZ issue at runtime (the hook runs after the entire describe callback has executed) ✔.

**`app` is used in `asTenant` — set in the first beforeAll ✔.**

**Now, one potential runtime issue: `Test.createTestingModule({ imports: [AppModule] })` — AppModule includes TenantModule whose configure() applies the middleware — in the test app, the middleware is registered ✔ (createNestApplication + init wire the middleware). ✔.**

**Another potential issue — express's default `query parser` is irrelevant.**

**The `@HttpCode(204)` delete: supertest gets 204 with empty body ✔.**

**Now — let me reconsider the `PrismaService`'s `readonly tenant = applyTenantScope(this.client)` — the property initializer referencing `this.client` (a class field declared above). Under `useDefineForClassFields: false`, the initializers run in the constructor in order ✔. But SWC with `useDefineForClassFields: false` matches ✔.

**`new PrismaClient()` in a field initializer — runs at DI instantiation time; the DATABASE_URL must exist. In tests, the env is provided ✔. In `node dist/main.js` at runtime — the env ✔.**

**Hmm — one more: PrismaClient's constructor with no args under ESM — fine.**

**Now, does `applyTenantScope`'s return type flow to `this.prisma.tenant.customer`? `applyTenantScope<T>(client: T)` returns `client.$extends(...)` — T = PrismaClient → the return type is the extended client. The property type is inferred ✔. Repositories: `this.prisma.tenant.customer.findMany` — the extended client has model delegates ✔.**

**Potential TS friction: `client.$extends` with the extension object `{ name, query: { $allModels: { $allOperations } } }` — the type of the `query` field: `$allModels` maps to an object that can have `$allOperations` or specific operations. Our callback's type: the expected parameter is a large context; we declare `OperationContext` (structural, any-ish). The assignability of our function to the expected: parameter `OperationContext` vs. the expected context type — the expected context has properties model/operation/args/query with specific types; our OperationContext has model: string, operation: string, args: any, query: (args:any)=>Promise<any>. For the function to be assignable, its parameter must be a supertype of the actual (contravariance) — under strictFunctionTypes, for a function-typed property… the expected signature: `(ctx: ContextType) => Promise<Result>`. Our function `(ctx: OperationContext) => ...` is assignable if ContextType is assignable to OperationContext (contravariant parameter: the actual argument ContextType must be assignable to our declared parameter OperationContext). ContextType has model: string? The actual model is a specific string-literal union (e.g. 'Customer' | 'Plan' | ...)? In the `$allModels` context, model: string (a union of model names) → assignable to string ✔. operation: string ✔. args: a specific type → assignable to any ✔. query: (args: SpecificArgs) => Promise<SpecificResult> → assignable to (args: any) => Promise<any>? A function parameter any ← SpecificArgs ✔ contravariant OK; return Promise<SpecificResult> → Promise<any> ✔. So ContextType is assignable to OperationContext ✔.

**The return of `$allOperations` must match the expected Promise<result> — we return `ctx.query(ctx.args)` — typed as Promise<any> ✔ (any is assignable).**

OK.

**Now — the `name` in the extension options: `$extends({ name: 'tenant-scope', query: {...} })` — the type: `Prisma.QueryExtension`… the overloads: `$extends<Ext extends UserArg...>`: options `{ query?: Query; result?: Result; model?: Model; name?: string }`? I'm fairly confident `name` is accepted (docs: "you can also name your extension"). Yes — Prisma docs show `$extends({ name: 'my-ext', query: {...} })`. ✔.

**Edge: the extension applies to the `unscoped` client too? No — the extension is only applied to `tenant` (the extended client). `unscoped` = the raw client, no scoping. The TenantRepository uses unscoped for the Tenant model anyway; and the extension would skip the Tenant model anyway (double safety).**

**Now, one more important thing to verify — the `findUnique` on the scoped client for the customer repository? I use findFirst for findById (where { id }) — the extension injects the tenantId → where { id, tenantId } ✔.**

**The `update` where `{ id }` + injected tenantId → the engine's WHERE id=? AND tenant_id=?; if the row exists in another tenant → no rows → P2025 ✔.**

**Now, let me consider a subtle point in Prisma 5: for `update`/`delete` with a where `{ id, tenantId }` — does the client-side validation reject a non-unique where? Prisma client runtime validation: for `update`, the where must satisfy a unique criterion. `{ id, tenantId }` includes the PK `id` → passes. I'm confident (this is the standard multi-tenant extension pattern).**

**`findFirst({ where: { id } })` + tenantId — no unique requirement ✔.**

**Alright — I think the design is solid. Let me also re-verify the convention: "endpoints kebab-case, plural" — `customers` ✔; `tenant-config` is singular per the explicit task ✔ (with a comment).**

**"TS files: kebab-case.role.ts" — customer.controller.ts ✔, all-exceptions.filter.ts ✔, tenant-resolution.middleware.ts ✔, tenant-context.ts (no .role — acceptable), app-error.ts (acceptable), tenant-scope.ts (acceptable).**

**Now, a potential problem — `import jwt from 'jsonwebtoken'` under SWC/ESM: CJS default import interop via Vite ✔; under compiled Node ESM (build), `import jwt from 'jsonwebtoken'` — Node's CJS-ESM interop gives module.exports as default ✔.**

**`import request from 'supertest'` — CJS default ✔ (tests only, via Vite).**

**One more: `@types/supertest` for typing — I use it without explicit types; fine.**

**Vitest + `fileParallelism: false` — the key exists in vitest 2 ✔ (introduced in 2.0 as a replacement for `threads: false`? Actually `fileParallelism` was added in Vitest 2.0? Let me recall: Vitest 2.0 changelog: "fileParallelism" — hmm, I believe `fileParallelism` landed in Vitest 2.0 (breaking change to rename `threads`→...). To be safe, I'll also set `pool: 'forks'`? Not needed. If `fileParallelism` is unknown in some 2.x version… it's in 2.0+. I'll keep `^2.0.0` and `fileParallelism: false`. The per-file unique slugs make parallelism safe anyway.**

**Also, two apps binding? `createNestApplication()` without a port — no listen; supertest uses the ephemeral server via getHttpServer ✔ no port conflict.**

**`app.close()` closes the http server and runs onModuleDestroy ✔.**

**Now, one more thought: should I add a `GET /plans`/`GET /orders` endpoint? No — the task doesn't ask. Service only. ✔.**

**Wait — but "don't create files it doesn't ask for" — plan/order modules: the data model is asked for (customers, plans, orders); the structural isolation applies to "every read" — meaning any read that exists must be scoped. Having plan/order repositories demonstrates that. I think it's within the spirit of the ask. I'll keep it.**

**Also, re-verify the "details" of the 403 mismatch: `{ host, org }` — the test asserts matchObject ✔.**

**Envelope `details` "never null" — all our details are objects/arrays ✔.**

**Another possible gotcha: Nest's `@Body()` with `Content-Type: application/json` from supertest's `.send(obj)` ✔.**

**DELETE 204 — Nest sends no body; supertest's res.body = {} ✔ (we don't assert body).**

**Alright, let me also reconsider: the middleware's `use` — if `next()` throws synchronously (it won't; Nest wraps it), the try/catch would handle it. ✔.**

**And `await tenantContext.run(tenantId, () => next())` — `next()` returns `void`; run returns void; `await void` is OK.**

Hmm — actually, subtle: `tenantContext.run(tenantId, () => next())` — the callback returns `next()`'s return (void). The downstream middleware/route handlers run inside `next()` — express calls the downstream synchronously within the `next()` invocation (synchronous dispatch), and their async continuations inherit the ALS context ✔. This is the key mechanism — correct.

**Let me also verify: does Nest call the middleware's `next` synchronously? In the Nest middleware pipeline, `next()` advances to the next middleware/route — express's layer handler is invoked synchronously (with Promise handling for async). ✔ standard.**

**I think I'm ready to write the final output. Also — do I need a `nest-cli.json`? Not needed (tsc build + node).**

**Also — `pnpm` — no lockfile (I can't generate one). Fine.**

**Another file consideration — `vitest.config.ts` imports `@vitejs/plugin-swc` — the default export `swc` ✔.**

**And `tsconfig.json` — should I include `test` for the editor? The convention build is src only; vitest doesn't use the tsconfig for transformation (SWC reads it partially). I'll keep include ["src"]. Hmm — SWC plugin's config comes from our vitest config, not the tsconfig. The editor will show the test file types using the nearest tsconfig (include is src-only → the test files are outside the program → the editor might not have full types, but it still works via the implicit default). Fine.**

Actually, one thing — `vitest` needs `@types/node` for node: imports in tests — devDep ✔.

**`prisma generate` postinstall — if prisma CLI's version mismatches the client's version — I'll pin both to ^5.14.0 ✔.**

**Let me also re-verify the `Prisma` import in the filter: `import { Prisma } from '@prisma/client';` — `Prisma.PrismaClientKnownRequestError` is a class on the Prisma namespace ✔.**

**And in helpers: `import type { Prisma } from '@prisma/client';` for InputJsonValue ✔.**

**Final check on the middleware status mapping: AppError's status is passed through (401/403/404/500) ✔.**

**The "missing Bearer" test: `request(...).get('/tenant-config').set('Host', seedA.domain)` — no Authorization header → 401 ✔.**

**Alright, let me write everything out. Order: package.json, tsconfig, vitest config, prisma files, then src, then tests.**

One more consideration about `test/helpers.ts` — `createTestApp` sets `process.env.JWT_SECRET` if absent. The middleware reads it at request time ✔.

And the forged token test: 'not-the-configured-secret' — verify throws (signature mismatch) → 401 ✔. But wait — if `process.env.JWT_SECRET` were actually 'not-the-configured-secret'? No, it's set to 'unit-test-only-secret'. ✔.

Also — the token without an org claim: `jwt.sign({ sub: 'anonymous' }, secret)` ✔.

**Let me also consider — `res.body.error.details.host` for the unknown-host test: my AppError details `{ host: domain }` ✔.**

**The 404 details for `tenant_not_found`: `{ host: domain }` — the normalized domain ✔ the test uses 'app.unknown-operator.com' (no port) → normalized the same ✔.**

**Let me write the final files now.**

Actually — one more important detail: **the `Tenant` model in the extension's UNSCOPED list — but what if someone uses the scoped client's `tenant` delegate? It passes through unscoped (by design, documented). Fine.**

**And the `tenant-scope` file imports AppError — thrown inside the interceptor → propagates as a rejection from the prisma call → caught by the global filter → 500 `tenant_scope_unsupported_operation`? Wait — the filter catches AppError → uses its status 500, code tenant_scope_unsupported_operation. Hmm — the filter's AppError branch uses exception.status — 500 ✔ envelope ✔.**

**But note: an AppError thrown inside a middleware (tenant resolution) — I don't want it to go through the filter; I handle it in the middleware ✔. And the tenant_context_missing AppError thrown in the extension during a request → the filter renders it as 500 `tenant_context_missing` ✔ good.**

**Now, also, the discipline note: "code and comments in English" ✔.**

**Let me also double-check `Order`'s status default 'created' in the schema + migration ✔ consistent.**

**Final file: prisma/migrations/20240601000000_init/migration.sql — I'll pick the timestamp name `20240601000000_init`.**

I think I'm ready. Let me write the response with just the headings + fenced blocks, no prose.

Wait, one more thing about the `package.json` `"type": "module"` + NestJS 10 + Node 20 — NestJS's ESM support: does Nest 10 officially support ESM? There's a known requirement: with ESM, `NestFactory.create` works; the imports need `.js` extensions; and `@nestjs/platform-express` works. Known issue: Nest's ESM requires `experimental-ssr`? No, that's for SSR. The main documented caveats for NestJS + ESM (NodeNext): it works in recent versions. I'll trust it.

Also **`reflect-metadata` import must be first in main.ts ✔; in test helpers ✔ (the spec files also import it — harmless).**

**One more: `emitDecoratorMetadata: true` in tsconfig for the tsc build ✔; SWC's `decoratorMetadata: true` for vitest ✔.**

**Also, does the controller need `@Injectable()`? No, the controller doesn't need @Injectable (Nest instantiates it); the module's declaration is enough. ✔ standard.**

**Middleware class: I marked it @Injectable — Nest's middleware registered via the consumer needs to be resolvable as a provider; I list it in providers ✔ (the @Injectable decorator isn't strictly required but is conventional; I'll keep it).**

Also, let me double-check the `tenant.module.ts` exports — I removed the TenantService export. The middleware is an internal provider ✔.

**The final structure for the answer — 32 files. Let me generate it.**

Actually, let me reconsider the number of test files: the convention `test/<feature>.spec.ts` — my `test/tenant.spec.ts` + `test/customer.spec.ts` + `test/helpers.ts` ✔.

Let me also reconsider whether to include `plans`/`orders` in `resetTenants` — yes, I included them ✔.

**The customer spec's beforeAll seed uses `asTenant` before `app` exists? No — app is created in the first beforeAll; the second beforeAll runs after ✔.**

**Potential issue — vitest runs multiple `beforeAll` in the order defined ✔.**

**Also, `let aliceId` is used in a later test — assigned in beforeAll ✔.**

OK, and one more subtlety: **the second beforeAll in customer.spec uses `expect` — importing from vitest ✔.**

Also, in `customer.spec.ts`, I should make sure that the "concurrent" test's `expect(listA.status).toBe(200)` is present. Let me include the status assertions.

Also — **the 204 delete response — supertest's `deleted.status` 204 ✔; `deleted.body` is {} (I don't assert).**

Also re-verify **`@HttpCode(204)`** import from @nestjs/common ✔.

**The `asTenant` helper returns a supertest Request with two headers pre-set; then `.get(path)` / `.post(path).send(...)` ✔.**

**Final: `main.ts` logs? I'll skip logging (or a single console.log — I'll add `console.log(`listening on ${port}`)`? Harmless; I'll keep it minimal — I'll include one log line, useful for operations, English. Fine.)**

Let me now write out the final answer. I'll ensure each file is complete, first to last line.

One more sweep for TS strictness in tricky spots:

1. `customer.controller.ts` — `record?.email` — record's type is `Record<string, unknown> | undefined`; `nonEmptyString(record?.email, ...)` ✔. `email!` after the errors check — strict: `email` is `string | undefined`; `!` OK.

2. `validateUpdateCustomer` — `if (record)` then `'email' in record` ✔.

3. helpers: `[tenantAId, tenantBId] = await seedTenants(...)` — destructuring into lets ✔. `seedTenants` returns string[] ✔.

4. helpers' `seed` variable reassignment ✔.

5. `createTestApp` — `moduleRef.createNestApplication()` — `TestingModule` has the method via `NestApplicationCreator`? `moduleRef.createNestApplication()` — yes, TestingModule (inherits from NestApplicationContext? it's a `NestApplicationContext`-like; in @nestjs/testing, `TestModule` provides `createNestApplication` ✔ standard e2e recipe).

6. tenant spec: `process.env.JWT_SECRET as string` ✔.

7. `issueToken` — jwt.sign with expiresIn string ✔.

8. In the filter: `exception.meta` — type `any` → `const target = (exception.meta as { target?: unknown } | null | undefined)?.target;` — `meta` type: in the PrismaClientKnownRequestError class, `meta: any`. The cast is OK. Then `details: { target: target ?? [] }` ✔.

9. `applyTenantScope` — `args.data.map((row: Record<string, unknown>) => ...)` — args is any so fine.

10. `normalizeHost` — `req.headers.host` type `string | string[] | undefined`? Express's type: `host?: string`… actually IncomingHttpHeaders: host?: string. But I typed the parameter as `string | string[] | undefined` — passing a `string | undefined` is fine.

11. Middleware: `const org = typeof payload === 'object' && payload !== null ? (payload as { org?: unknown }).org : undefined;` — payload: unknown ✔.

12. `TenantService.configForCurrentTenant` — `tenant.branding as Record<string, unknown>` — JsonValue → cast OK? JsonValue includes string/number/boolean/null/arrays/objects — the cast to Record<string,unknown> is a narrowing cast — allowed via `as`? Casting JsonValue to Record — TS allows `as` when the types are "comparable" — JsonValue includes `{ [key: string]: JsonValue }` which is comparable to Record<string, unknown>? Probably yes. If not, I'd need `as unknown as`. To be safe: `(tenant.branding as Prisma.JsonValue) as Record<string, unknown>` — or just `as unknown as Record<string, unknown>`. I'll use `as unknown as Record<string, unknown>`? Hmm, it looks clunky. Let me do:

```ts
const branding = (tenant.branding ?? {}) as Record<string, unknown>;
```

If TS complains about direct comparability… JsonValue = string | number | boolean | JsonObject | JsonArray | null. JsonObject = {readonly [key: string]: JsonValue}. Is `JsonValue as Record<string, unknown>` allowed? Casting a union to a member-ish type — JsonObject is a member; Record<string,unknown> vs JsonObject: is JsonObject assignable to Record<string, unknown>? JsonValue isn't `unknown`… is JsonObject assignable to Record<string, unknown>? `{[k:string]: JsonValue}` → `{[k:string]: unknown}` — yes, assignable (JsonValue is assignable to unknown). For `as`, if either is assignable to the other it's allowed — JsonObject is assignable to Record<string,unknown> ✔ so the cast from the union is fine (the union contains a member assignable to the target… actually, the rule: a cast is allowed if S is assignable to T or T is assignable to S. Is the union JsonValue assignable to Record<string,unknown>? No (string isn't). Is Record<string,unknown> assignable to JsonValue? No. Hmm — then a direct `as` might error "Conversion of type ... may be a mistake".

To be safe: `tenant.branding as unknown as Record<string, unknown>`? Ugly but safe. Alternatively, type TenantConfig's branding as `Prisma.JsonValue` and return it as-is:

```ts
branding: tenant.branding,  // JsonValue
```

But then the controller returns a JsonValue — the JSON serialization is fine. The test's `toEqual(seedA.branding)` ✔. Let me type TenantConfig.branding: `Prisma.JsonValue` and featureFlags: `Prisma.JsonValue` — avoids the cast entirely:

```ts
export interface TenantConfig {
  tenant: { id: string; slug: string; name: string; domain: string };
  branding: Prisma.JsonValue;
  featureFlags: Prisma.JsonValue;
}
...
branding: tenant.branding ?? {},
featureFlags: tenant.featureFlags ?? {},
```

`tenant.branding` is `JsonValue` (non-null since the schema is NOT NULL) ✔. Test's `toEqual(seedA.branding)` — JSON round trip: the object is preserved ✔.

But wait — the DB round trip: Prisma returns the JsonValue from Postgres JSONB ✔ (an object stays an object).

And the seed's `branding: Prisma.InputJsonValue` ✔ create data ✔.

13. `Plan`'s priceCents Int non-null with a default — create data omits it? The plan.service's create always passes a number ✔.

14. `OrderRepository.create(data: { customerId; planId; totalCents })` — matches the model (status default) ✔.

15. tenant.repository's `findUnique({ where: { domain } })` — domain is unique ✔ typed.

16. `seedTenants` — `db.tenant.create({ data: tenantSeed })` — tenantSeed: TenantSeed { slug, domain, name, branding: InputJsonValue, featureFlags: InputJsonValue } — matches TenantCreateInput (id/createdAt/updatedAt optional) ✔.

17. `resetTenants`' deleteMany where tenantId ✔.

18. In the customer spec — `rowsA.map((c) => c.email)` — rowsA is typed as Customer[] ✔ (the service's list returns a Prisma model array) ✔.

19. `tenantContext.run(tenantAId, async () => { await sleep(20); return service.list(); })` — returns Promise<Customer[]> ✔.

20. vitest config — `test: { fileParallelism: false }` — hmm, in vitest 2 the key is `fileParallelism` (boolean) ✔. If the installed vitest 2.0 — yes, introduced in 2.0. ✔.

21. `supertest` typing: `request(app.getHttpServer())` — getHttpServer returns `http.Server` ✔ supertest accepts.

22. `import request from 'supertest'` — default import; @types/supertest declares `export = supertest` — with esModuleInterop, the default import works ✔. Under Vite ESM, interop ✔.

23. tsconfig `"types": ["node"]` — limits global types; vitest imports are explicit ✔.

24. `main.ts` — `Number(process.env.PORT ?? 3000)` ✔.

Alright — and **`app.module.ts`'s APP_FILTER useValue instance — the filter has no DI dependencies ✔.**

**Now, one more thing to reconsider: the convention says "controllers are declared in a module" ✔ both controllers are declared.**

**"A service, repository, or processor is listed in its module's providers" ✔.**

Let me also verify **there's no raw SQL anywhere in src** ✔ (only in the test seed via Prisma — which is ORM, not raw SQL; "zero raw SQL" is satisfied even for tests — we don't use $executeRaw ✔).

**"The service has zero Prisma client calls" — TenantService uses the repository ✔; CustomerService ✔; the middleware uses TenantService (not the client) ✔.**

**The controller has zero business logic — validation only ✔.**

I'm confident. Let me write the final response now — starting from the first heading, with nothing outside the pattern.

File order (logical):
1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/migration_lock.toml
6. prisma/migrations/20240601000000_init/migration.sql
7. src/main.ts
8. src/app.module.ts
9. src/common/app-error.ts
10. src/common/tenant-context.ts
11. src/common/all-exceptions.filter.ts
12. src/prisma/prisma.module.ts
13. src/prisma/prisma.service.ts
14. src/prisma/tenant-scope.ts
15. src/tenant/tenant.module.ts
16. src/tenant/tenant.repository.ts
17. src/tenant/tenant.service.ts
18. src/tenant/tenant-resolution.middleware.ts
19. src/tenant/tenant-config.controller.ts
20. src/customer/customer.module.ts
21. src/customer/customer.repository.ts
22. src/customer/customer.service.ts
23. src/customer/customer.controller.ts
24. src/plan/plan.module.ts
25. src/plan/plan.repository.ts
26. src/plan/plan.service.ts
27. src/order/order.module.ts
28. src/order/order.repository.ts
29. src/order/order.service.ts
30. test/helpers.ts
31. test/tenant.spec.ts
32. test/customer.spec.ts

Also, do I need an ASSUMPTION marker anywhere? "If a symbol you need is genuinely missing from the task… mark it with a single ASSUMPTION comment." Symbols: the JWT secret name — I picked `JWT_SECRET`; that's an assumption about the env var name, defensible; should I mark it? The task says tokens carry an org claim; a verification key is needed; the env-var naming is my choice. I'll add one ASSUMPTION comment at the JWT_SECRET usage site in the middleware: `// ASSUMPTION: tokens are verified with the shared secret in JWT_SECRET (HS256).` That's the one unresolved point. Good — I'll mark it once, at the middleware.

Everything else is determined by the task.

Let me now write it all out, carefully, complete.
```

## reply

### package.json
```json
{
  "name": "white-label-tenant-isolation",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "postinstall": "prisma generate",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "migrate": "prisma migrate deploy",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.8",
    "@nestjs/core": "^10.3.8",
    "@nestjs/platform-express": "^10.3.8",
    "@prisma/client": "^5.14.0",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.8",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.2",
    "@types/supertest": "^6.0.2",
    "@vitejs/plugin-swc": "^3.6.0",
    "prisma": "^5.14.0",
    "supertest": "^7.0.0",
    "typescript": "^5.4.5",
    "vitest": "^2.0.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "skipLibCheck": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';
import swc from '@vitejs/plugin-swc';

export default defineConfig({
  plugins: [
    // NestJS constructor injection relies on `design:paramtypes` metadata,
    // which esbuild (Vite's default TS transform) cannot emit.
    swc({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, useDefineForClassFields: false },
        target: 'es2022',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Specs share one Postgres database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
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

model Tenant {
  id           String   @id @default(uuid())
  slug         String   @unique
  domain       String   @unique
  name         String
  branding     Json     @default("{}") @map("branding")
  featureFlags Json     @default("{}") @map("feature_flags")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("tenants")
}

model Customer {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  email     String
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Same email is allowed in two tenants, never twice in one tenant.
  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("customers")
}

model Plan {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  name       String
  priceCents Int      @default(0) @map("price_cents")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("plans")
}

model Order {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  customerId String   @map("customer_id")
  planId     String   @map("plan_id")
  totalCents Int      @default(0) @map("total_cents")
  status     String   @default("created")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@index([tenantId])
  @@map("orders")
}
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

### prisma/migrations/20240601000000_init/migration.sql
```sql
-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branding" JSONB NOT NULL DEFAULT '{}',
    "feature_flags" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'created',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

-- CreateIndex
CREATE INDEX "plans_tenant_id_idx" ON "plans"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_tenant_id_name_key" ON "plans"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`listening on ${port}`);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { CustomerModule } from './customer/customer.module.js';
import { OrderModule } from './order/order.module.js';
import { PlanModule } from './plan/plan.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';

@Module({
  imports: [PrismaModule, TenantModule, CustomerModule, PlanModule, OrderModule],
  providers: [
    // Single error envelope for the whole API, including the test app.
    { provide: APP_FILTER, useValue: new AllExceptionsFilter() },
  ],
})
export class AppModule {}
```

### src/common/app-error.ts
```ts
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/**
 * Application error carrying its HTTP status, a stable snake_case code and
 * structured details. The global filter (and the tenant-resolution
 * middleware) render these into the single error envelope.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { error: { code, message, details } };
}
```

### src/common/tenant-context.ts
```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from './app-error.js';

const storage = new AsyncLocalStorage<string>();

/**
 * Request-scoped tenant context, backed by AsyncLocalStorage so that
 * concurrent requests (and interleaved in-process work) never share a
 * tenant. Installed once by the tenant-resolution middleware; read by the
 * tenant-scoped Prisma client.
 */
export const tenantContext = {
  run<R>(tenantId: string, fn: () => R): R {
    return storage.run(tenantId, fn);
  },

  current(): string | undefined {
    return storage.getStore();
  },

  require(): string {
    const tenantId = storage.getStore();
    if (!tenantId) {
      throw new AppError(
        500,
        'tenant_context_missing',
        'This operation requires an active tenant context.',
      );
    }
    return tenantId;
  },
};
```

### src/common/all-exceptions.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { AppError, errorEnvelope } from './app-error.js';

/**
 * Renders every unhandled exception as the single error envelope:
 * { "error": { "code", "message", "details" } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      this.send(res, exception.status, exception.code, exception.message, exception.details);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const target = (exception.meta as { target?: unknown } | null | undefined)?.target;
        this.send(res, 409, 'already_exists', 'A record with the same unique value already exists in this tenant.', {
          target: target ?? [],
        });
        return;
      }
      if (exception.code === 'P2025') {
        this.send(res, 404, 'resource_not_found', 'The requested record does not exist in this tenant.');
        return;
      }
      this.send(res, 500, 'database_error', 'A known database error occurred.', {
        prismaCode: exception.code,
      });
      return;
    }

    console.error('Unhandled exception:', exception);
    this.send(res, 500, 'internal_error', 'An unexpected error occurred.');
  }

  private send(
    res: Response,
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ): void {
    if (res.headersSent) return;
    res.status(status).json(errorEnvelope(code, message, details));
  }
}
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

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyTenantScope } from './tenant-scope.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new PrismaClient();

  /**
   * Tenant-scoped client used by every repository: reads are automatically
   * filtered to the ambient tenant, writes are stamped with it. No caller
   * ever passes tenantId explicitly.
   */
  readonly tenant = applyTenantScope(this.client);

  /**
   * Unscoped client. Only the tenant registry itself (the Tenant model)
   * may use it, because tenant resolution runs before any request-scoped
   * tenant context exists.
   */
  readonly unscoped = this.client;

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
```

### src/prisma/tenant-scope.ts
```ts
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { tenantContext } from '../common/tenant-context.js';

/**
 * Structural isolation at the data layer.
 *
 * Applied to the Prisma client used by all repositories. For every model
 * except the tenant registry itself, this extension:
 *   - adds `tenantId` to the `where` clause of every read and every
 *     row-addressing write, so a query can never see or touch another
 *     tenant's rows;
 *   - stamps `tenantId` onto every created row, so writes can never miss
 *     a tenant;
 *   - fails closed on any operation it does not explicitly understand.
 *
 * The tenant is read from the request-scoped context (AsyncLocalStorage),
 * never from caller-supplied arguments.
 */
const UNSCOPED_MODELS: ReadonlySet<string> = new Set(['Tenant']);

const WHERE_OPERATIONS: ReadonlySet<string> = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'delete',
  'updateMany',
  'deleteMany',
]);

type OperationContext = {
  model: string;
  operation: string;
  // Prisma's per-operation args types vary widely; the interception is
  // deliberately structural here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (args: any) => Promise<any>;
};

export function applyTenantScope<T extends PrismaClient>(client: T) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations(ctx: OperationContext) {
          if (UNSCOPED_MODELS.has(ctx.model)) {
            return ctx.query(ctx.args);
          }

          const tenantId = tenantContext.require();
          const args = { ...ctx.args };

          switch (ctx.operation) {
            case 'create':
              args.data = { ...args.data, tenantId };
              break;
            case 'createMany':
              args.data = Array.isArray(args.data)
                ? args.data.map((row: Record<string, unknown>) => ({ ...row, tenantId }))
                : { ...args.data, tenantId };
              break;
            case 'upsert':
              args.where = { ...args.where, tenantId };
              args.create = { ...args.create, tenantId };
              break;
            default:
              if (!WHERE_OPERATIONS.has(ctx.operation)) {
                throw new AppError(
                  500,
                  'tenant_scope_unsupported_operation',
                  `Refusing to run Prisma operation "${ctx.operation}" without tenant isolation.`,
                  { model: ctx.model, operation: ctx.operation },
                );
              }
              args.where = { ...args.where, tenantId };
          }

          return ctx.query(args);
        },
      },
    },
  });
}
```

### src/tenant/tenant.module.ts
```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantRepository } from './tenant.repository.js';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';
import { TenantService } from './tenant.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantConfigController],
  providers: [TenantService, TenantRepository, TenantResolutionMiddleware],
  configure(consumer: MiddlewareConsumer) {
    // Every route is tenant-gated.
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  },
})
export class TenantModule implements NestModule {}
```

### src/tenant/tenant.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Access to the tenant registry. The only repository that talks to the
 * unscoped Prisma client, because tenant resolution runs before any
 * request-scoped tenant context exists.
 */
@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByDomain(domain: string) {
    return this.prisma.unscoped.tenant.findUnique({ where: { domain } });
  }

  findBySlug(slug: string) {
    return this.prisma.unscoped.tenant.findUnique({ where: { slug } });
  }

  findById(id: string) {
    return this.prisma.unscoped.tenant.findFirst({ where: { id } });
  }
}
```

### src/tenant/tenant.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { tenantContext } from '../common/tenant-context.js';
import { TenantRepository } from './tenant.repository.js';

export interface TenantConfig {
  tenant: { id: string; slug: string; name: string; domain: string };
  branding: Prisma.JsonValue;
  featureFlags: Prisma.JsonValue;
}

@Injectable()
export class TenantService {
  constructor(private readonly tenants: TenantRepository) {}

  /**
   * Resolves the tenant for a request. The request host and the `org`
   * claim of the token must both resolve to the same tenant; anything
   * else is a rejection, never a guess.
   */
  async resolveFromRequest(domain: string, orgClaim: string): Promise<string> {
    const byDomain = await this.tenants.findByDomain(domain);
    if (!byDomain) {
      throw new AppError(404, 'tenant_not_found', `No tenant is served on host "${domain}".`, {
        host: domain,
      });
    }

    const byOrg = await this.tenants.findBySlug(orgClaim);
    if (!byOrg || byOrg.id !== byDomain.id) {
      throw new AppError(
        403,
        'tenant_mismatch',
        'The token "org" claim does not match the tenant served on this host.',
        { host: domain, org: orgClaim },
      );
    }

    return byDomain.id;
  }

  /** Branding and feature flags for the tenant of the current request. */
  async configForCurrentTenant(): Promise<TenantConfig> {
    const tenantId = tenantContext.require();
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw new AppError(404, 'resource_not_found', 'The resolved tenant no longer exists.', {
        id: tenantId,
      });
    }
    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, domain: tenant.domain },
      branding: tenant.branding ?? {},
      featureFlags: tenant.featureFlags ?? {},
    };
  }
}
```

### src/tenant/tenant-resolution.middleware.ts
```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { AppError, errorEnvelope } from '../common/app-error.js';
import { tenantContext } from '../common/tenant-context.js';
import { TenantService } from './tenant.service.js';

/**
 * Resolves the tenant for every request: the Bearer token must be valid,
 * carry an `org` claim, and both the `org` claim and the request host must
 * point at the same tenant. On success the tenant id is installed in the
 * request-scoped context for the remainder of the request.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgClaim = this.readOrgClaim(req);
      const domain = normalizeHost(req.headers.host);
      const tenantId = await this.tenants.resolveFromRequest(domain, orgClaim);
      await tenantContext.run(tenantId, () => next());
    } catch (err) {
      this.reject(res, err);
    }
  }

  /** Verifies the Bearer token and returns its `org` claim. */
  private readOrgClaim(req: Request): string {
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : undefined;
    if (!token) {
      throw new AppError(401, 'unauthorized', 'A Bearer token in the Authorization header is required.');
    }

    // ASSUMPTION: tokens are verified as HS256 with the shared secret in JWT_SECRET.
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new AppError(500, 'internal_error', 'JWT_SECRET is not configured.');
    }

    let payload: unknown;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch {
      throw new AppError(401, 'unauthorized', 'The access token is invalid or expired.');
    }

    const org =
      typeof payload === 'object' && payload !== null ? (payload as { org?: unknown }).org : undefined;
    if (typeof org !== 'string' || org.trim().length === 0) {
      throw new AppError(401, 'unauthorized', 'The access token is missing a usable "org" claim.');
    }
    return org;
  }

  private reject(res: Response, err: unknown): void {
    if (res.headersSent) return;
    if (err instanceof AppError) {
      res.status(err.status).json(errorEnvelope(err.code, err.message, err.details));
      return;
    }
    console.error('Tenant resolution failed:', err);
    res.status(500).json(errorEnvelope('internal_error', 'An unexpected error occurred.'));
  }
}

/** Lowercases the Host header and strips the port, if present. */
function normalizeHost(raw: string | string[] | undefined): string {
  const host = Array.isArray(raw) ? raw[0] : raw;
  const normalized = (host ?? '').trim().toLowerCase();
  const portIndex = normalized.lastIndexOf(':');
  return portIndex === -1 ? normalized : normalized.slice(0, portIndex);
}
```

### src/tenant/tenant-config.controller.ts
```ts
import { Controller, Get } from '@nestjs/common';
import { TenantConfig, TenantService } from './tenant.service.js';

// Path fixed by the task (singular on purpose, despite the plural convention).
@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  getConfig(): Promise<TenantConfig> {
    return this.tenants.configForCurrentTenant();
  }
}
```

### src/customer/customer.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CustomerController } from './customer.controller.js';
import { CustomerRepository } from './customer.repository.js';
import { CustomerService } from './customer.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerRepository],
  exports: [CustomerService],
})
export class CustomerModule {}
```

### src/customer/customer.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * All calls go through the tenant-scoped Prisma client: the ambient tenant
 * is injected into every where clause and stamped onto every write. This
 * repository (and every caller) never mentions tenantId.
 */
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.customer.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.tenant.customer.findFirst({ where: { id } });
  }

  create(data: { email: string; name: string }) {
    return this.prisma.tenant.customer.create({ data });
  }

  update(id: string, data: { email?: string; name?: string }) {
    return this.prisma.tenant.customer.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.tenant.customer.delete({ where: { id } });
  }
}
```

### src/customer/customer.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { CustomerRepository } from './customer.repository.js';

export interface CreateCustomerInput {
  email: string;
  name: string;
}

export interface UpdateCustomerInput {
  email?: string;
  name?: string;
}

@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  list() {
    return this.customers.list();
  }

  async get(id: string) {
    const customer = await this.customers.findById(id);
    if (!customer) {
      throw new AppError(404, 'resource_not_found', `Customer ${id} was not found for this tenant.`, {
        id,
      });
    }
    return customer;
  }

  async create(input: CreateCustomerInput) {
    // A duplicate email inside the tenant surfaces as Prisma P2002 -> 409
    // via the global filter (atomic, race-safe).
    return this.customers.create(input);
  }

  async update(id: string, input: UpdateCustomerInput) {
    // A row missing in this tenant (including rows owned by other tenants)
    // surfaces as Prisma P2025 -> 404 via the global filter.
    return this.customers.update(id, input);
  }

  async remove(id: string): Promise<void> {
    await this.customers.remove(id);
  }
}
```

### src/customer/customer.controller.ts
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { CustomerService } from './customer.service.js';

interface CreateCustomerDto {
  email: string;
  name: string;
}

interface UpdateCustomerDto {
  email?: string;
  name?: string;
}

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  list() {
    return this.customers.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.customers.create(validateCreateCustomer(body));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.customers.update(id, validateUpdateCustomer(body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.customers.remove(id);
  }
}

function validateCreateCustomer(body: unknown): CreateCustomerDto {
  const errors: string[] = [];
  const record = asRecord(body, errors);
  const email = nonEmptyString(record?.email, 'email', errors);
  const name = nonEmptyString(record?.name, 'name', errors);
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.push('"email" must be a valid email address');
  }
  if (errors.length > 0) {
    throw new AppError(400, 'validation_failed', 'The request body is invalid.', { errors });
  }
  return { email: email!, name: name! };
}

function validateUpdateCustomer(body: unknown): UpdateCustomerDto {
  const errors: string[] = [];
  const record = asRecord(body, errors);
  const dto: UpdateCustomerDto = {};
  if (record) {
    if ('email' in record) {
      const email = nonEmptyString(record.email, 'email', errors);
      if (email) {
        if (!EMAIL_PATTERN.test(email)) {
          errors.push('"email" must be a valid email address');
        }
        dto.email = email;
      }
    }
    if ('name' in record) {
      const name = nonEmptyString(record.name, 'name', errors);
      if (name) {
        dto.name = name;
      }
    }
  }
  if (Object.keys(dto).length === 0) {
    errors.push('provide at least one of "email" or "name"');
  }
  if (errors.length > 0) {
    throw new AppError(400, 'validation_failed', 'The request body is invalid.', { errors });
  }
  return dto;
}

function asRecord(body: unknown, errors: string[]): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    errors.push('the request body must be a JSON object');
    return undefined;
  }
  return body as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string, errors: string[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`"${field}" must be a non-empty string`);
    return undefined;
  }
  return value.trim();
}
```

### src/plan/plan.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PlanRepository } from './plan.repository.js';
import { PlanService } from './plan.service.js';

@Module({
  imports: [PrismaModule],
  providers: [PlanService, PlanRepository],
  exports: [PlanService],
})
export class PlanModule {}
```

### src/plan/plan.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.plan.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.tenant.plan.findFirst({ where: { id } });
  }

  create(data: { name: string; priceCents: number }) {
    return this.prisma.tenant.plan.create({ data });
  }
}
```

### src/plan/plan.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { PlanRepository } from './plan.repository.js';

@Injectable()
export class PlanService {
  constructor(private readonly plans: PlanRepository) {}

  list() {
    return this.plans.list();
  }

  async get(id: string) {
    const plan = await this.plans.findById(id);
    if (!plan) {
      throw new AppError(404, 'resource_not_found', `Plan ${id} was not found for this tenant.`, {
        id,
      });
    }
    return plan;
  }

  async create(input: { name: string; priceCents?: number }) {
    // A duplicate plan name inside the tenant surfaces as Prisma P2002 ->
    // 409 via the global filter.
    return this.plans.create({ name: input.name, priceCents: input.priceCents ?? 0 });
  }
}
```

### src/order/order.module.ts
```ts
import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PlanModule } from '../plan/plan.module.js';
import { OrderRepository } from './order.repository.js';
import { OrderService } from './order.service.js';

@Module({
  imports: [PrismaModule, CustomerModule, PlanModule],
  providers: [OrderService, OrderRepository],
  exports: [OrderService],
})
export class OrderModule {}
```

### src/order/order.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.order.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.tenant.order.findFirst({ where: { id } });
  }

  create(data: { customerId: string; planId: string; totalCents: number }) {
    return this.prisma.tenant.order.create({ data });
  }
}
```

### src/order/order.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { CustomerService } from '../customer/customer.service.js';
import { PlanService } from '../plan/plan.service.js';
import { OrderRepository } from './order.repository.js';

export interface CreateOrderInput {
  customerId: string;
  planId: string;
  totalCents?: number;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly customers: CustomerService,
    private readonly plans: PlanService,
  ) {}

  list() {
    return this.orders.list();
  }

  async get(id: string) {
    const order = await this.orders.findById(id);
    if (!order) {
      throw new AppError(404, 'resource_not_found', `Order ${id} was not found for this tenant.`, {
        id,
      });
    }
    return order;
  }

  async create(input: CreateOrderInput) {
    // Both lookups are tenant-scoped, so a cross-tenant reference fails
    // with 404 here instead of becoming a cross-tenant order.
    const [customer, plan] = await Promise.all([
      this.customers.get(input.customerId),
      this.plans.get(input.planId),
    ]);
    return this.orders.create({
      customerId: customer.id,
      planId: plan.id,
      totalCents: input.totalCents ?? plan.priceCents,
    });
  }
}
```

### test/helpers.ts
```ts
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module.js';

export interface TenantSeed {
  slug: string;
  domain: string;
  name: string;
  branding: Prisma.InputJsonValue;
  featureFlags: Prisma.InputJsonValue;
}

/**
 * The suite runs against a real Postgres reachable via DATABASE_URL
 * (apply the migrations first, e.g. `pnpm migrate`). Each spec file uses
 * its own tenant slugs so files can never cross-contaminate each other.
 */
export function makeTenantSeeds(prefix: string): [TenantSeed, TenantSeed] {
  return [
    {
      slug: `${prefix}-a`,
      domain: `app.${prefix}-a.com`,
      name: `${prefix} A`,
      branding: { primaryColor: '#1a73e8', logoUrl: `https://cdn.${prefix}-a.example.com/logo.svg` },
      featureFlags: { betaCheckout: true, supportInbox: false },
    },
    {
      slug: `${prefix}-b`,
      domain: `app.${prefix}-b.com`,
      name: `${prefix} B`,
      branding: { primaryColor: '#e91e63', logoUrl: `https://cdn.${prefix}-b.example.com/logo.png` },
      featureFlags: { betaCheckout: false, supportInbox: true },
    },
  ];
}

let seed: PrismaClient | undefined;

function seedClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a migrated Postgres database to run this suite.');
  }
  if (!seed) {
    seed = new PrismaClient();
  }
  return seed;
}

/** Deletes only the rows of the given tenants (keeps other specs' data intact). */
export async function resetTenants(seeds: TenantSeed[]): Promise<void> {
  const db = seedClient();
  for (const tenantSeed of seeds) {
    const existing = await db.tenant.findUnique({ where: { slug: tenantSeed.slug } });
    if (!existing) continue;
    await db.order.deleteMany({ where: { tenantId: existing.id } });
    await db.customer.deleteMany({ where: { tenantId: existing.id } });
    await db.plan.deleteMany({ where: { tenantId: existing.id } });
    await db.tenant.delete({ where: { id: existing.id } });
  }
}

export async function seedTenants(seeds: TenantSeed[]): Promise<string[]> {
  const db = seedClient();
  const ids: string[] = [];
  for (const tenantSeed of seeds) {
    const tenant = await db.tenant.create({ data: tenantSeed });
    ids.push(tenant.id);
  }
  return ids;
}

export async function closeSeedClient(): Promise<void> {
  if (seed) {
    await seed.$disconnect();
  }
  seed = undefined;
}

export async function createTestApp(): Promise<INestApplication> {
  if (!process.env.JWT_SECRET) {
    // Test-only key so the suite can mint tokens; the app reads it from the environment.
    process.env.JWT_SECRET = 'unit-test-only-secret';
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

export function issueToken(org: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ org }, secret, { algorithm: 'HS256', expiresIn: '5m' });
}
```

### test/tenant.spec.ts
```ts
import 'reflect-metadata';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeSeedClient,
  createTestApp,
  issueToken,
  makeTenantSeeds,
  resetTenants,
  seedTenants,
} from './helpers.js';

const [seedA, seedB] = makeTenantSeeds('tenant');

describe('tenant resolution', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetTenants([seedA, seedB]);
    await seedTenants([seedA, seedB]);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeSeedClient();
  });

  const asTenant = (slug: string, domain: string) =>
    request(app.getHttpServer())
      .set('Host', domain)
      .set('Authorization', `Bearer ${issueToken(slug)}`);

  it('rejects a request without a bearer token with 401 and the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/tenant-config').set('Host', seedA.domain);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.details).not.toBeNull();
    expect(res.body.error.details).toBeTypeOf('object');
  });

  it('rejects a token signed with the wrong key with 401', async () => {
    const forged = jwt.sign({ org: seedA.slug }, 'not-the-configured-secret', { algorithm: 'HS256' });
    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', seedA.domain)
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a token without an org claim with 401', async () => {
    const token = jwt.sign({ sub: 'anonymous' }, process.env.JWT_SECRET as string, { algorithm: 'HS256' });
    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', seedA.domain)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a host that no tenant is served on with 404', async () => {
    const res = await asTenant(seedA.slug, 'app.unknown-operator.com');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('tenant_not_found');
    expect(res.body.error.details.host).toBe('app.unknown-operator.com');
  });

  it('rejects a token whose org claim points at a different tenant with 403', async () => {
    const res = await asTenant(seedB.slug, seedA.domain);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
    expect(res.body.error.details).toMatchObject({ host: seedA.domain, org: seedB.slug });
  });

  it('rejects an org claim of a tenant that does not exist with 403', async () => {
    const res = await asTenant('ghost-operator', seedA.domain);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('resolves the tenant from the host even when a port is present', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', `${seedA.domain}:8443`)
      .set('Authorization', `Bearer ${issueToken(seedA.slug)}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant.slug).toBe(seedA.slug);
  });

  it('returns the branding and feature flags of the resolved tenant', async () => {
    const res = await asTenant(seedA.slug, seedA.domain);
    expect(res.status).toBe(200);
    expect(res.body.tenant).toMatchObject({ slug: seedA.slug, name: seedA.name, domain: seedA.domain });
    expect(res.body.branding).toEqual(seedA.branding);
    expect(res.body.featureFlags).toEqual(seedA.featureFlags);
  });

  it('serves tenant B a different config on its own host', async () => {
    const res = await asTenant(seedB.slug, seedB.domain);
    expect(res.status).toBe(200);
    expect(res.body.tenant.slug).toBe(seedB.slug);
    expect(res.body.branding).toEqual(seedB.branding);
    expect(res.body.featureFlags).toEqual(seedB.featureFlags);
    expect(res.body.featureFlags).not.toEqual(seedA.featureFlags);
  });
});
```

### test/customer.spec.ts
```ts
import 'reflect-metadata';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantContext } from '../src/common/tenant-context.js';
import { CustomerService } from '../src/customer/customer.service.js';
import {
  closeSeedClient,
  createTestApp,
  issueToken,
  makeTenantSeeds,
  resetTenants,
  seedTenants,
} from './helpers.js';

const [seedA, seedB] = makeTenantSeeds('customer');

describe('customer isolation across tenants', () => {
  let app: INestApplication;
  let tenantAId: string;
  let tenantBId: string;
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    await resetTenants([seedA, seedB]);
    [tenantAId, tenantBId] = await seedTenants([seedA, seedB]);
    app = await createTestApp();
  });

  beforeAll(async () => {
    const a = await asTenant(seedA.slug, seedA.domain)
      .post('/customers')
      .send({ email: 'alice@example.com', name: 'Alice' });
    expect(a.status).toBe(201);
    aliceId = a.body.id as string;

    const b = await asTenant(seedB.slug, seedB.domain)
      .post('/customers')
      .send({ email: 'bob@example.com', name: 'Bob' });
    expect(b.status).toBe(201);
    bobId = b.body.id as string;
  });

  afterAll(async () => {
    await app.close();
    await closeSeedClient();
  });

  const asTenant = (slug: string, domain: string) =>
    request(app.getHttpServer())
      .set('Host', domain)
      .set('Authorization', `Bearer ${issueToken(slug)}`);

  it('a tenant only lists its own customers', async () => {
    const res = await asTenant(seedA.slug, seedA.domain).get('/customers');
    expect(res.status).toBe(200);
    const emails = res.body.map((c: { email: string }) => c.email);
    expect(emails).toContain('alice@example.com');
    expect(emails).not.toContain('bob@example.com');
  });

  it('tenant B cannot fetch tenant A customer by id (404)', async () => {
    const res = await asTenant(seedB.slug, seedB.domain).get(`/customers/${aliceId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('tenant B cannot update tenant A customer (404, row unchanged)', async () => {
    const res = await asTenant(seedB.slug, seedB.domain)
      .patch(`/customers/${aliceId}`)
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');

    const still = await asTenant(seedA.slug, seedA.domain).get(`/customers/${aliceId}`);
    expect(still.status).toBe(200);
    expect(still.body.name).toBe('Alice');
  });

  it('tenant B cannot delete tenant A customer (404, row survives)', async () => {
    const res = await asTenant(seedB.slug, seedB.domain).delete(`/customers/${aliceId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');

    const still = await asTenant(seedA.slug, seedA.domain).get(`/customers/${aliceId}`);
    expect(still.status).toBe(200);
  });

  it('the same email can register in both tenants', async () => {
    const a = await asTenant(seedA.slug, seedA.domain)
      .post('/customers')
      .send({ email: 'shared@example.com', name: 'Shared (A)' });
    const b = await asTenant(seedB.slug, seedB.domain)
      .post('/customers')
      .send({ email: 'shared@example.com', name: 'Shared (B)' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.email).toBe('shared@example.com');
    expect(b.body.email).toBe('shared@example.com');
  });

  it('the same email cannot register twice in one tenant (409)', async () => {
    const res = await asTenant(seedA.slug, seedA.domain)
      .post('/customers')
      .send({ email: 'alice@example.com', name: 'Alice Twice' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_exists');
  });

  it('a tenant can create, update and delete its own rows', async () => {
    const created = await asTenant(seedB.slug, seedB.domain)
      .post('/customers')
      .send({ email: 'carol@example.com', name: 'Carol' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const updated = await asTenant(seedB.slug, seedB.domain)
      .patch(`/customers/${id}`)
      .send({ name: 'Carol Updated' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Carol Updated');

    const deleted = await asTenant(seedB.slug, seedB.domain).delete(`/customers/${id}`);
    expect(deleted.status).toBe(204);

    const gone = await asTenant(seedB.slug, seedB.domain).get(`/customers/${id}`);
    expect(gone.status).toBe(404);
  });

  it('rejects an invalid create body with 400 and the envelope', async () => {
    const res = await asTenant(seedA.slug, seedA.domain)
      .post('/customers')
      .send({ name: 'No Email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Array.isArray(res.body.error.details.errors)).toBe(true);
  });

  it('keeps concurrent requests from different tenants in separate contexts', async () => {
    const [listA, listB, createA, createB] = await Promise.all([
      asTenant(seedA.slug, seedA.domain).get('/customers'),
      asTenant(seedB.slug, seedB.domain).get('/customers'),
      asTenant(seedA.slug, seedA.domain).post('/customers').send({ email: 'dave-a@example.com', name: 'Dave A' }),
      asTenant(seedB.slug, seedB.domain).post('/customers').send({ email: 'dave-b@example.com', name: 'Dave B' }),
    ]);

    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);
    expect(createA.status).toBe(201);
    expect(createB.status).toBe(201);

    const emailsA = listA.body.map((c: { email: string }) => c.email);
    const emailsB = listB.body.map((c: { email: string }) => c.email);
    // No matter how the requests interleave, each list must never show the
    // other tenant's rows.
    expect(emailsA).not.toContain('bob@example.com');
    expect(emailsA).not.toContain('dave-b@example.com');
    expect(emailsB).not.toContain('alice@example.com');
    expect(emailsB).not.toContain('dave-a@example.com');

    const afterA = await asTenant(seedA.slug, seedA.domain).get('/customers');
    const afterB = await asTenant(seedB.slug, seedB.domain).get('/customers');
    expect(afterA.body.map((c: { email: string }) => c.email).sort()).toEqual([
      'alice@example.com',
      'dave-a@example.com',
      'shared@example.com',
    ]);
    expect(afterB.body.map((c: { email: string }) => c.email).sort()).toEqual([
      'bob@example.com',
      'dave-b@example.com',
      'shared@example.com',
    ]);
  });

  it('keeps interleaved in-process tenant contexts separate', async () => {
    const service = app.get(CustomerService);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const [rowsA, rowsB] = await Promise.all([
      tenantContext.run(tenantAId, async () => {
        await sleep(20);
        return service.list();
      }),
      tenantContext.run(tenantBId, async () => {
        await sleep(5);
        return service.list();
      }),
    ]);

    const emailsA = rowsA.map((c) => c.email);
    const emailsB = rowsB.map((c) => c.email);
    expect(emailsA).toContain('alice@example.com');
    expect(emailsA).not.toContain('bob@example.com');
    expect(emailsB).toContain('bob@example.com');
    expect(emailsB).not.toContain('alice@example.com');
  });
});
```


---
