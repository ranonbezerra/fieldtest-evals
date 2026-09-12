# Transcript — 06-multi-tenant-isolation / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
We need answer user's task: produce complete solution files in format only ### path and code blocks. Need analyze thoroughly. We need build multi-tenant NestJS Prisma Postgres in one reply. Need no tools. Need satisfy conventions. Need likely include package.json? Task says build whole solution; file layout ourselves. But conventions: stack, layout, naming, errors, wiring, migrations, tests. Need deliver every file solution needs. Must be mechanical: each file heading only path, fenced block only content. Need no prose. We need include complete code.

We need design solution for Variant A:
- Tenant resolution middleware: derive tenant from host + token org claim (both agree); reject mismatches. Tenant in request-scoped context.
- Structural isolation at data layer: tenant-aware Prisma client (extension/middleware) scopes every read and stamps every write; handlers never pass tenantId manually.
- Schema customers/plans/orders with tenant-scoped uniqueness.
- GET /tenant-config — branding + feature flags for resolved tenant.
- Tests: tenant B cannot list, fetch-by-id (404), update, delete tenant A's rows; same email registers in both tenants; concurrent requests from different tenants don't cross contexts.

Need decide layout. Conventions:
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
Naming table/column snake_case via @map/@@map. Endpoint kebab-case plural. TS file kebab-case.role.ts. Class PascalCase. Code/comments English.

Errors envelope:
{ error: { code, message, details: {} } }
code snake_case contract. details object never null.

Wiring: provider listed in module providers; cross-module exports/imports; controller declared by module.

Migrations: Every schema change ships with a migration.

Tests: Vitest. Test behaviour. Need likely unit tests for services/repositories using mocked prisma? Could be integration tests? We have no test DB? Need produce tests that can run with Vitest. Since no tools, likely unit tests with mocked repository or prisma client. But task expects tests for isolation: tenant B cannot list etc. We can test service behaviors with mocked repositories and tenant context. But need "concurrent requests from different tenants don't cross contexts" — can test AsyncLocalStorage context manager with Promise.all. Need maybe use a request context provider with AsyncLocalStorage. NestJS middleware can set context before request handlers.

Need implement tenant-aware Prisma client. Options:
- Use @prisma/client extension $allModels: { findFirst..., create... } to auto add where tenantId and create data tenantId based on AsyncLocalStorage current tenant.
- Or custom middleware wrapping. Since Prisma version? We can use PrismaClient extensions (new PrismaClient().$extends). Need ensure reads scoped and writes stamped. Could also intercept all model operations and inject tenantId. Need not pass tenantId manually.

However structural isolation: if tenantId is optional in schema? For reads, need automatically include tenantId = current tenant. For writes, need add tenantId. For deletes/updates by id, need include tenantId in where; for createMany, etc. Need also ensure tenant-scoped uniqueness. In Postgres, unique index on tenant_id + field. Prisma model has composite @@unique([tenantId, email]) etc. But tenantId not manually passed; extension stamps. Need maybe schema model has tenantId String @map("tenant_id"), and @@unique([tenantId, email]), etc. For customers email unique per tenant.

Need tenant configuration: probably a tenants table? GET /tenant-config for resolved tenant. Need tenant entity with host, branding, feature flags. Since tenant resolution from host + token org claim. Tenant record maybe slug/org id. Need map host -> tenant. Need token org claim. We can use an AuthGuard that verifies JWT? But no auth library specified. We can assume JWT in Authorization header with org claim. Need parse token? "Auth tokens carry an org claim; requests also arrive with the tenant's host." Need derive tenant from host + token org claim both agree. Could use tenant repository to find by host and by org? Maybe token org claim is tenant id. Need reject mismatches. We can have header `Authorization: Bearer <jwt>` and Host header. For tests, easier: token contains payload base64 or raw JSON? We need not use external secrets? We can implement a lightweight token verification using environment variable? But no secrets? Could use shared secret? Maybe use JWT with HS256 from jsonwebtoken? Adding dependency? Stack says NestJS, Prisma, Postgres, Vitest. Could include jsonwebtoken? It's a package. But no package.json? We can include. Need decide if use real JWT or simpler token. "Auth tokens carry an org claim" likely JWT. We can implement with `jsonwebtoken` or `jose`. But if no dependencies? We can assume standard NestJS. We can write package.json including @nestjs/common, @nestjs/core, @nestjs/platform-express, @prisma/client, jsonwebtoken, @nestjs/testing, vitest. But tests may not need actual JWT if we mock? But tenant middleware needs parse. To test behavior without secret, can support test tokens? Hmm.

Maybe implement token guard that expects JWT with HS256 signed using `AUTH_TOKEN_SECRET` env var. But tests can sign tokens with same secret. Environment variables only config. In tests set `AUTH_TOKEN_SECRET`. Use `jsonwebtoken` to verify. Need include `dotenv`? Config from env only; main can use process.env, no need dotenv. For tests set process.env.

But adding JWT adds complexity. Alternative: token is a base64 JSON payload with org claim (no signing). But "auth tokens" implies signed. Could use `jsonwebtoken`. Need ensure offline tests no network. OK.

Tenant resolution: Host e.g. app.operator-x.com. Could strip prefix? Need tenant by host. Have `tenants` table with `host` unique, `org` maybe? Token org claim is maybe tenant id/slug. We need both agree: if token org claim equals tenant.id or tenant.slug, and host maps to same tenant. Better: token org claim = tenant slug/id. Tenant table has `slug` unique and `host` unique. Middleware: parse host from request.headers.host. Lookup tenant by host. If not found -> 401? code invalid_host? Then verify JWT. Get org claim. If tenant.slug !== org claim -> 403? Mismatch. If token invalid -> 401. If host not known -> 400/403? Need error code. Could choose:
- unknown_host: 400? resource_not_found? Maybe invalid_tenant_host. Since code snake_case. Use invalid_tenant_host (400) or tenant_not_found (404). But multi-tenant, don't reveal? Use invalid_tenant (401?) Hmm.
- invalid_token: 401
- tenant_mismatch: 403
Need consistent.

Need request-scoped context. Use AsyncLocalStorage from node:async_hooks. In middleware, after tenant resolved, create ALS run with tenant object. NestJS request handlers run in same async context? Middleware runs before controllers. If we use asyncLocalStorage.run(promise), yes. But NestJS may use async; ALS propagates. We need a provider TenantContextService with getTenant() and runTenant. Middleware can be global and use service.

Tenant-aware Prisma: use ALS current tenant. Need ensure no cross-context with concurrent requests. We can test AsyncLocalStorage context isolation.

Potential problem: Prisma client extension created once uses ALS. It can get current tenant in extension. Need repository gets tenant-aware client. For tests, maybe we use real Prisma? But no DB. Could implement repository using tenant-aware client. In tests mock client? But need test isolation behavior: if tenant-aware client scopes every read, with mocked base client we can assert where includes tenant_id. But the rule says never assert only call happened. Need assert results. We can use fake in-memory data store? Could test service with repository using in-memory tenant-aware store? Hmm.

Given no shell, tests need be plausible. We can write unit/integration tests using a mock Prisma-like client that implements tenant-aware extension? Or test the tenant-aware client wrapper with a fake underlying client. We need tests for tenant B cannot list etc. Could create a test double for database with tenant-scoped behavior, and test service + repository using it. But repository is the only layer that touches DB. In unit test, repository with fake client should enforce isolation. We can test service by injecting repository. But if repository is mocked, it's not testing data-layer isolation. Better: implement repository as class that takes `TenantPrismaService` (tenant-aware client). In tests, instantiate repository with a fake tenant-aware client? Hmm.

Alternative: Use PrismaClient extension and in tests instantiate a fake PrismaClient object with methods; but extension is Prisma-specific. We can design `TenantPrismaService` returning a tenant-scoped proxy. For tests, we can use a `createInMemoryTenantDatabase`? But then not Prisma. Need test behavior not implementation; can use repository with in-memory repository? But layering says repository touches DB. In tests we can replace repository with test double? But then tests only service? Need test tenant B cannot fetch by id 404: service can handle repository returns undefined -> NotFoundException. This tests service mapping, not data layer. But requirement likely wants integration tests using DB? In absence of DB, unit tests with fake data store acceptable.

Could write tests using Vitest with a `FakeTenantDatabase` implementing tenant-scoped operations and a `repository` that uses it? But then repository no longer Prisma. However tests can test the `TenantAwarePrismaClient` wrapper using fake underlying client? Need maybe simpler: implement `tenant-prisma.service.ts` with `$extends`. In tests, use `new PrismaClient({ datasources: { db: { url: 'postgres://...' } })`? No DB. Not good.

Maybe use Prisma's mock: `Prisma.defineExtension` can be tested with a Prisma client instance from `@prisma/client` using `$extends` without connecting? Some operations may require DB. But can test that extension adds tenant to where by spying? Hmm.

Could use `@prisma/client` generated from schema? Not available. In repo, `@prisma/client` will generate. Tests can import PrismaClient. But running without DB fails. Could mock PrismaClient? Use vi.mock('@prisma/client') with a fake. But then extension? We can implement tenant isolation not via Prisma extension but via repository manually? Requirement says handlers never pass tenantId manually; data layer structural. Could be repository methods accept no tenantId and use current tenant to build where. That is tenant-aware repository, not Prisma middleware. But "tenant-aware Prisma client (extension/middleware)" specifically. Need implement extension.

Could write `tenant-prisma.service.ts`:
```
@Injectable() export class TenantPrismaService extends PrismaClient {}
```
But to apply extension, need `new PrismaClient().$extends(...)` returns client type. Could store as private. In constructor, maybe use `super()` then `this.client = super.$extends(...)`? But class extends PrismaClient and also holds extended. However PrismaClient extension returns a new client; cannot easily subclass. Use provider that returns extended client:
```
@Injectable()
export class TenantPrismaService {
  readonly client: PrismaClient;
  constructor() {
    const base = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    this.client = base.$extends(this.tenantExtension());
  }
}
```
But TypeScript types for extended client? We can type as `PrismaClient`? Extensions preserve types, but if we type as any maybe. Need strict? We can use `ReturnType<typeof this.createExtendedClient>`? But can't call before this? Could define function.

Prisma extension: Use `$allModels`:
```
export const tenantIsolationExtension = Prisma.defineExtension((prisma) => {
  return {
    $allModels: {
      async $allOperations? 
    }
  }
})
```
Prisma extension API: There are query hooks: `$allModels: { async $allOperations({ args, operation, model, query }) { ... return query(args) } }` or individual operations: findMany, findFirst, findUnique, create, update, delete, etc. Need cover read and write. Need also `createMany`, `upsert`, `updateMany`, `deleteMany`, `count`, `aggregate`, etc? Requirement: reads and writes. Could cover common operations: findUnique, findFirst, findMany, create, createMany, update, updateMany, delete, deleteMany, upsert, count, aggregate, groupBy. Need inject tenantId where.

Need know Prisma model names: Customer, Plan, Order, Tenant? We may not want to scope Tenant table. Tenant config table used by middleware. Tenant table must not be tenant-scoped (global). Need extension only applies to tenant-owned models: Customer, Plan, Order. If we use `$allModels`, it would scope Tenant too; not desired. Could use `$allModels` and exclude model 'Tenant', but then tenant table not stamped. Could also create `Tenant` as global and not scoped; extension can skip. Or use `$models` for Customer, Plan, Order. Better: `Prisma.defineExtension((prisma) => ({ $allModels: { ... }, $models: { Customer: {...}, Plan: {...}, Order: {...} } }))`? Simpler use `$allModels` but in hook if model === 'Tenant' return query(args). But still for tenant create, we don't stamp. OK.

Need implement hooks:
For read operations (`findUnique`, `findFirst`, `findMany`, `count`, `aggregate`, `groupBy`, `findUniqueOrThrow`, `findFirstOrThrow`): add tenant to where. But some operations args shape: `findUnique` args.where is unique key, may not include tenantId. We can set `args = { ...args, where: { ...args.where, tenantId } }`. For `count` args where may be object. For `aggregate`/`groupBy` where object. Need if args.where undefined, set {}. But findUnique where is required? Prisma findUnique args.where required. For safety.
For write operations:
- `create`: add tenantId to data. If data is nested? Top-level only. But if nested create? Could ignore? Need every write stamped. But if create nested, not covered. Could implement deep stamp? For create args.data can be object with nested `plans: { create: [...] }`. But handlers likely only create top-level. To be robust, can recursively stamp data for create/update/upsert? But Prisma nested writes include many fields. Hard.
- `createMany`: data array each add tenantId.
- `update`: args.where add tenantId; args.data add tenantId? Updating tenantId should not be allowed? Stamping write maybe ensure tenantId remains. Could add tenantId to data to prevent cross-tenant? But if data includes tenantId from user? We should override to current tenant. Add `tenantId` to data for single update. For updateMany: where add tenantId; data add tenantId.
- `delete`: where add tenantId.
- `deleteMany`: where add tenantId.
- `upsert`: where add tenantId; create data add tenantId; update data add tenantId.
Need also `findUniqueOrThrow` etc.

Need ensure current tenant from ALS. If no tenant, throw error. In extension, if no tenant, maybe throw TenantContextError. But if operation on Tenant table, no current tenant? Tenant lookup in middleware occurs before context set; repository for tenants should use a global client, not tenant-aware. Important: Tenant table queries must not require tenant. So `TenantRepository` should use a raw PrismaClient (global) not tenant-aware. Or extension skips Tenant but still no context needed? If no context and model Tenant, skip. For tenant-owned models, require context.

Need schema:
```
model Tenant {
  id String @id @default(uuid())
  slug String @unique
  host String @unique
  name String
  primaryColor String
  logoUrl String?
  featureFlags Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("tenants")
}

model Customer {
  id String @id @default(uuid())
  tenantId String @map("tenant_id")
  email String
  name String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([tenantId, email])
  @@map("customers")
}

model Plan {
  id String @id @default(uuid())
  tenantId String @map("tenant_id")
  name String
  priceCents Int @map("price_cents")
  isDefault Boolean @default(false) @map("is_default")
  createdAt...
  @@unique([tenantId, name])? Requirement tenant-scoped uniqueness maybe same plan name in two tenants. Yes.
  @@map("plans")
}

model Order {
  id String @id @default(uuid())
  tenantId String @map("tenant_id")
  customerId String @map("customer_id")
  planId String @map("plan_id")
  status String
  totalCents Int @map("total_cents")
  createdAt...
  @@unique([tenantId, customerId, planId])? Maybe not necessary. Tenant-scoped uniqueness for orders? Could have external reference? Not required. But could unique order number per tenant. Maybe add `orderNumber`? Simpler: @@unique([tenantId, id]) not needed. For tenant-scoped uniqueness, customers email, plans name, maybe orders orderNumber. But id is global unique anyway. Need same customer email may exist in two tenants. Use composite unique.

Maybe include relationships? Could add `tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)` etc. But then extension stamping? OK. But if repository uses Prisma relations, tenantId still needed. Not necessary. Could keep simple no relations to avoid complexity. But schema maybe needs FK to tenant for structural isolation. Add tenant relation? If tenant relation, need back-relations in Tenant. Fine. But tenant-aware extension doesn't care. For integrity, add foreign keys. But if handlers never pass tenantId, extension stamps. Need ensure when creating customer with tenantId omitted, extension adds. If FK to tenant, tenantId must exist. OK.

Need tenant config endpoint: `GET /tenant-config` returns branding + feature flags for resolved tenant. Could be under feature `tenant-config`. Maybe also need CRUD for customers/plans/orders? Tests require tenant B cannot list, fetch-by-id, update, delete tenant A's rows; same email registers in both tenants; concurrent requests. That implies endpoints for customers? Or plans? Need build APIs for customers, plans, orders? Task says schema for customers/plans/orders, tests: tenant B cannot list, fetch-by-id, update, delete tenant A's rows; same email registers in both tenants. It doesn't explicitly require endpoints for all resources, but likely need controllers for customers at least. Maybe to test list/fetch/update/delete. Could implement `customers` feature with endpoints:
- `GET /customers` list
- `POST /customers` create (same email registers in both tenants)
- `GET /customers/:id`
- `PATCH /customers/:id` (update)
- `DELETE /customers/:id`
Need maybe plans/orders? Could implement minimal endpoints for plans/orders too? The task only requires GET /tenant-config and tests rows. But "schema for customers/plans/orders" and "fully isolated data (customers, plans, orders)". To be safe, implement generic resources? Need not overdo? Discipline: Do exactly task asks. It asks schema for customers/plans/orders, tenant-config endpoint, tests. It doesn't ask endpoints for plans/orders, but tests need rows. Could test customers endpoints. But if only schema and no endpoints for plans/orders, OK? Maybe tests need plans/orders? It says tenant B cannot list, fetch-by-id, update, delete tenant A's rows (could be customers). Same email registers in both tenants => customer endpoints. Concurrent requests from different tenants don't cross contexts => can use customers. So implement customer CRUD plus tenant-config. But schema includes plans/orders; no endpoints? Maybe acceptable. However "fully isolated data (customers, plans, orders)" suggests need isolation for all three. Could implement repositories/services/controllers for all three? That's a lot but manageable. But task only endpoint /tenant-config. If we implement all, more files. The layout expects feature per resource. Could create `customer`, `plan`, `order`, `tenant-config` features. But "Do not create a file it does not call for" might argue not implement plan/order controllers. But structural isolation data layer must scope every read/write, and schema includes all. Tests can target customers only. Maybe no plan/order endpoints needed. But if no endpoints, code for plans/orders only schema; OK. But requirement "fully isolated data" maybe tested via customer rows enough? Could be insufficient. Maybe implement minimal plan/order repositories? Hmm.

Need decide file layout. The conventions require `src/<feature>/<feature>.module.ts`, controller, service, repository. For tenant resolution, maybe feature `tenant` or `auth`? Need module for common? We can create:
- `src/main.ts`
- `src/app.module.ts`
- `src/common/tenant-context.service.ts`? But layout only features. Could use `src/tenant/tenant.module.ts`, `tenant.service.ts`, `tenant.repository.ts`, `tenant-context.middleware.ts`? Naming convention file `kebab-case.role.ts`, so `tenant-context.middleware.ts` okay? Role maybe middleware not listed but can. `tenant-context.service.ts`.
- `src/tenant-config/tenant-config.module.ts`, controller, service, repository? Could use tenant repository.
- `src/customer/customer.module.ts`, controller, service, repository.
- `src/plan/...`, `src/order/...` maybe optional.
- `src/db/prisma.service.ts`? Need tenant-aware prisma service. Could put in `src/tenant/tenant-prisma.service.ts`? Or `src/database/database.module.ts`? Conventions not specify. Need provider cross-module. A service/repository/processor listed in module providers. Cross-module exports. Need `TenantContextService`, `TenantPrismaService`, `GlobalPrismaService` perhaps in `app.module` or `common`.

Could make `TenantModule` global (`@Global()`) exporting `TenantContextService`, `TenantPrismaService`, `GlobalPrismaService`, `TenantService`, `TenantRepository`. Then other modules import `TenantModule`. Or `AppModule` providers and imports? Since controllers in feature modules need tenant context. We can make `TenantModule` @Global to avoid import everywhere. But wiring convention says cross-module provider exports and module imports. @Global maybe allowed? Could be simpler. But strict? They said a provider used by another module is exportsed by its own module and that module is importsed by the other. @Global technically not importsed? Might violate. Better explicit: each feature module imports `TenantModule`. Need `TenantModule` exports context, tenant prisma, global prisma, tenant service maybe.

Need `TenantConfigModule` imports `TenantModule`, declares controller, service, repository? It can use `TenantService` from tenant module. Or repository for tenants in tenant module. `TenantService` can get tenant config by id.

Need `CustomerModule` imports `TenantModule`, declares controller/service/repository. Repository uses `TenantPrismaService`.

Potential circular? No.

Need error handling: global exception filter to produce envelope. Could create `src/common/exception.filter.ts`? Layout? Could be `src/app/app.controller?` Hmm. Need all errors use one envelope. NestJS default errors not. Implement `AllExceptionsFilter` and register in main. Need feature? Could put `src/common/all-exceptions.filter.ts` and use in `main.ts`. Or `src/app/app.module.ts`? Since no common folder in layout? Layout shows only examples, not exhaustive. Can use `src/common/...`. Or make `src/app/app.exception.filter.ts`? Feature `app`. But app module exists. Maybe `src/app/all-exceptions.filter.ts`. However layout `src/<feature>/<feature>.module.ts` etc. Not strict. We can create `src/common/error-exception.filter.ts`? Need naming: `kebab-case.role.ts`. Could be `src/app/error-exception.filter.ts`.

Need validation input: controller validates input. Use class-validator? Adds dependency. Or manual in controller. To avoid dependencies, manual validate body. But NestJS has validation pipe with class-validator. Could include. But no need. Controllers can check required fields and throw BadRequestException with custom error. Need error code. Use custom exceptions. Could create helper `http-error.ts` in common: `class ApiError extends HttpException { code; details }` and filter maps. But NestJS HttpException message string; can use Response to include code? Better custom.

Need one envelope: error code, message, details object. For validation: code `validation_error`, details field errors. For not found: `resource_not_found`, details maybe { id }. For tenant errors: `invalid_tenant_host`, `invalid_token`, `tenant_mismatch`, `unauthorized`, `tenant_not_found`. Need choose.

Middleware can throw ApiError? Middleware not inside Nest DI? Can use Nest Middleware with @Injectable and @Inject. It can throw HttpException. Need filter catch.

Token verification: Need parse JWT. Use `jsonwebtoken`. But if we include package.json with dependencies. Need maybe type definitions. Use `@types/jsonwebtoken`? In package.json dev? Since ESM, `import jwt from 'jsonwebtoken'`. Node 20. Need `@nestjs/platform-express`. Need `@prisma/client`. Need `@nestjs/testing`. Need `vitest`, `@vitest/coverage?` no.

But if using jsonwebtoken in tests, need sign tokens. In test, set `AUTH_TOKEN_SECRET` and use `jwt.sign`. Need also Host header. In Nest testing, `supertest`? Not listed. Could use `@nestjs/testing` + `supertest`. Need include `supertest` and `@types/supertest`. But to test concurrent requests, can use supertest. But DB? Need real DB? Could use mocks.

Maybe better to write tests that test at service/context level without HTTP, to avoid supertest and DB. But requirement "tenant B cannot ... expect 404" suggests HTTP-level. Could use supertest and mock repositories? But then 404 mapping. Need data layer isolation? Could use in-memory fake database.

Let's consider writing an integration-style test using an in-memory Prisma-like client that implements tenant isolation via the same extension? Could be too complex.

Maybe implement a `DatabaseModule` with a `TenantPrismaService` that wraps a `PrismaClient`. In tests, use `vi.mock('@prisma/client')` to provide an in-memory client that supports the models and uses the extension? But if we mock PrismaClient, our `TenantPrismaService` extension might not apply? We can mock the extended client directly? Hmm.

Alternative: Do not use actual Prisma client extension in tests; test a `TenantAwareDatabase` interface implemented by an in-memory fake. But requirement specifically tenant-aware Prisma client. We can still implement that in production; tests can use a fake repository that simulates behavior. But "test behaviour, not implementation" and "never assert only call happened". We can test controller/service with repository fake that enforces tenant isolation? If fake repository is not enforcing, then service not tested. Need fake data store with tenant isolation. Could make repository in tests use a `FakeTenantStore` that implements repository interface. But that tests controller/service not Prisma extension.

Could use Prisma's `mock`? There is no built-in DB. Maybe use `@prisma/client` with `pg-mem`? Not standard. Could include `@prisma/client` and use Prisma's query engine? No.

Given constraints, likely expected to produce code and tests using unit mocks. We can write tests that assert tenant-aware client extension adds tenant to where and stamps data. Need no DB by creating a fake Prisma client that records args and returns data. But "never assert only that a call happened" means we must assert returned behavior. We can design fake query functions that return based on args. For isolation: fake database contains tenant A and B rows; query functions filter by where.tenantId; create respects data.tenantId. Then if repository uses tenant-aware extension, we can test through repository: when current tenant B, list returns only B; fetch A id returns undefined -> service 404; update/delete no effect. This tests data-layer behavior via fake Prisma client. Good.

Need implement tenant-aware client extension that can be applied to fake base client? Prisma's `$extends` requires a real Prisma client? It can accept object? `Prisma.defineExtension` returns an extension. `new PrismaClient().$extends(extension)`. In test, can't use real without DB? But we can mock `PrismaClient` to have `$extends` method that applies extension to a fake base. Could be complicated.

Simpler: Implement tenant isolation not via official `$extends` but by a custom `TenantPrismaClient` proxy that intercepts model operations and uses ALS. This can be tested with fake model delegates. But requirement says extension/middleware; custom proxy maybe middleware. We can call it middleware. Need structural isolation. We can create a `TenantPrismaService` that exposes a `client` which is a Proxy over a base Prisma-like object. For production, base is `PrismaClient`; for tests, base fake. Proxy intercepts property access for model names and returns proxied model with methods. It injects tenantId. This is easier to test without Prisma extension. But does it satisfy "Prisma client (extension/middleware)"? It's a middleware around Prisma client. Good. Need ensure handlers never pass tenantId manually. Repository calls `this.prisma.customer.findMany()`; proxy adds tenant.

But proxy over PrismaClient is tricky but feasible. Need know model property names lowercase: `customer`, `plan`, `order`, `tenant`. For tenant global, no scoping. For tenant-owned models, scope. Need operations. We can define a list of models to scope: `customer`, `plan`, `order`. For each operation method, wrap. Need preserve `findUnique` etc. For read: modify args.where. For create: modify args.data. For createMany: modify data array. For update: modify where/data. For delete: where. For upsert: where/create/update. For count/aggregate/groupBy: where.

Need implement in TypeScript strict. Proxy typing. Could return any for simplicity. But strict mode no implicit any; can type as `any` for client. It's OK maybe. But code quality? Need strict. Use `unknown` and casts.

Alternative: use Prisma's `$extends` in production and a fake `PrismaClient` in tests that implements `$extends` to apply same extension? If extension is a function `(prisma) => ({ $allModels: {...} })`, a fake base can call it and combine. But official `$extends` API complex. Custom proxy easier and testable.

Need ensure concurrent requests don't cross contexts. With ALS, if we use proxy that reads `TenantContextService.getCurrentTenant()` at operation time, concurrent promises maintain context. We can test with AsyncLocalStorage.

Let's design core classes:

`TenantContextService`:
```
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ResolvedTenant { id: string; slug: string; host: string; name: string; primaryColor: string; logoUrl?: string | null; featureFlags: Record<string, boolean>; }

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<ResolvedTenant>();
  run<T>(tenant: ResolvedTenant, fn: () => T | Promise<T>): T | Promise<T> { return this.storage.run(tenant, fn); }
  getTenant(): ResolvedTenant { const tenant = this.storage.getStore(); if (!tenant) throw new Error('Tenant context missing'); return tenant; }
  getTenantId(): string { return this.getTenant().id; }
}
```

Need custom error for missing context? Could throw `ApiError`? In data layer, if missing, should fail. Could throw `TenantContextMissingError` extends Error. Filter can map to 500? But better `ApiError` 500 `internal_error`. But if no tenant for tenant-owned ops, bug. Use `ApiError`? But data layer importing common error okay.

`ApiError` class:
```
export class ApiError extends HttpException {
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } });
    this.status = status; this.code = code; ...
  }
}
```
But HttpException.getResponse can be object. We can create filter that catches HttpException and uses response if object with error? Or simpler custom extends Error with status. Nest exception filter can handle. But HttpException integrates. If we extend HttpException with response envelope, Nest's default? But we have custom filter. Need ensure thrown in middleware and services. Could do:
```
export class ApiError extends HttpException {
  readonly code: string;
  constructor(public readonly status: number, code: string, message: string, public readonly details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.code = code;
  }
  getResponse(): { error: { code, message, details } } { return super.getResponse(); }
}
```
HttpException constructor accepts object response and status. Good.
Filter:
```
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp(); const res = ctx.getResponse(); const req = ctx.getRequest();
    if (exception instanceof ApiError) status = exception.getStatus(); body = exception.getResponse();
    else if (exception instanceof HttpException) { status = exception.getStatus(); body = { error: { code: 'http_error', message: exception.message, details: {} } }; }
    else status=500; body = { error: { code: 'internal_error', message: 'Internal server error', details: {} } };
    res.status(status).json(body);
  }
}
```
Need not leak internal. For Prisma known errors? Could map P2002 unique constraint to conflict? Maybe not required. But same email registers in both tenants not conflict. If duplicate within tenant maybe should 409 `duplicate_resource`. Could add filter mapping Prisma.PrismaClientKnownRequestError P2002 to `duplicate_resource`. Need import Prisma from @prisma/client? In filter can check error.code. Good.

Need token verification. `TenantResolutionMiddleware`:
- Use `@Injectable()` middleware.
- `use(req, res, next)`:
  - const host = (req.headers.host ?? '').replace(/:$/, '') maybe lowercase. If empty -> next(ApiError 400 invalid_host?).
  - token from Authorization header. Must be Bearer.
  - Verify JWT with secret from env. Need use `jwt.verify(token, secret)` with options? Could allow `issuer`? Not.
  - payload org claim: `payload.org`. Need string.
  - Use `TenantService.findTenantByHost(host)`. If not found -> 401? Maybe `unknown_host` 400.
  - If tenant.slug !== orgClaim or tenant.id !== orgClaim? Need choose. Token org claim likely tenant slug? It says org claim, maybe organization id. Tenant has `slug` as org identifier. We can accept `org` equals `tenant.slug` OR `tenant.id`? To be strict, one. Use `tenant.slug`. Maybe org claim is organization slug. Document? Could mark assumption.
  - If mismatch -> 403 `tenant_mismatch`.
  - Then run context and next. But middleware's next returns Promise? In Nest, `use(req, res, next)` can be async and call next(). To use ALS, need wrap `next` in `storage.run(tenant, () => Promise.resolve(next()))`. But `next` might not return Promise? We can do `return this.tenantContext.run(tenant, () => Promise.resolve(next()))`. However if next throws? OK.
- If token invalid -> 401 `invalid_token`. If host unknown -> maybe 400 `unknown_host` before token? But if token invalid and host unknown, order? Could check host first to avoid timing? Not security. Need both agree. If host unknown, reject.
- Need tenant table global repository uses `GlobalPrismaService`.

Need `TenantService` and `TenantRepository`:
```
@Injectable() export class TenantRepository {
  constructor(private readonly prisma: GlobalPrismaService) {}
  findByHost(host: string) { return this.prisma.tenant.findUnique({ where: { host } }); }
  findBySlug(slug: string) ...
  findById(id) ...
}
```
But `GlobalPrismaService` extends PrismaClient? We can create:
```
@Injectable() export class GlobalPrismaService extends PrismaClient { constructor() { super({ datasources: { db: { url: process.env.DATABASE_URL } } }); } }
```
But in tests, maybe mock. However if both `GlobalPrismaService` and `TenantPrismaService` extend/instantiate PrismaClient, two clients. OK.

`TenantPrismaService` maybe:
```
@Injectable() export class TenantPrismaService {
  readonly client: TenantAwareClient;
  constructor(private readonly context: TenantContextService, prisma?: PrismaClient) {
    const base = prisma ?? new PrismaClient({ datasources... });
    this.client = createTenantAwareClient(base, context);
  }
}
```
Need allow injection of base for tests? We can define provider with factory:
```
{
 provide: TENANT_PRISMA,
 inject: [TenantContextService],
 useFactory: (context) => createTenantAwareClient(new PrismaClient(), context)
}
```
But service/repository expect `TenantPrismaService` class? Could use token. Simpler class with optional parameter? DI can't easily pass optional. Could use `@Inject(TENANT_PRISMA_BASE)`. Hmm.

Maybe make `TenantPrismaService` extend Proxy? Not. Use provider token `TENANT_PRISMA_CLIENT` that is an object with model delegates. Repositories inject `@Inject(TENANT_PRISMA_CLIENT) prisma: TenantAwarePrismaClient`. In tests, override with fake. But conventions say service/repository/processor listed in module providers. Tokens ok.

But class-based easier for module providers. Could implement `TenantPrismaService` as class with `get client() { return this.client; }`. To test, override provider `TenantPrismaService` with a fake instance. Fine.

Define `TENANT_MODELS = ['customer','plan','order']`. `createTenantAwareClient(base: PrismaClient, context: TenantContextService): any`.

Need type for `TenantAwarePrismaClient`:
```
export interface TenantAwarePrismaClient {
  customer: any;
  plan: any;
  order: any;
  tenant?: any; // maybe not expose? Could expose global? Better not expose tenant to tenant-scoped client to avoid accidental global. Only scoped models.
}
```
But repository for customers injects and uses `prisma.customer`. OK. For plans/orders if no controllers, no matter.

Need wrap model methods. Implementation:
```
function cloneWhere(where: unknown): Record<string, unknown> { return where && typeof where === 'object' ? { ...where as object } as Record<string, unknown> : {}; }
function stampData(data: unknown): unknown { if (Array.isArray(data)) return data.map(stampData); if (data && typeof data === 'object') { const obj = { ...data as object } as Record<string, unknown>; obj.tenantId = currentTenantId; // deep? maybe for nested create? We can recursively stamp arrays and objects that look like create? Hard.
 }
}
```
Need deep stamp for nested writes? Could recursively stamp all object properties that are objects/arrays? But that would stamp filter objects (where, data) and also nested DTOs. For `data`, we can recursively stamp any nested object that may be create/update? But in Prisma create, nested fields like `plans: { create: [ ... ] }`. If we recursively stamp all nested objects, we'd add tenantId to `plans` object itself (bad) and to `create` array items (good). We need know only arrays/objects under specific fields? Too complex. For top-level enough? Requirement "stamps every write" maybe top-level. But if nested, not. Could avoid nested writes in handlers. Since we control API, no nested creates. OK.

Need ensure user-supplied `tenantId` cannot override. We override with current tenant. Good.

Read hook: For `findUnique`, args.where may be `{ id }`; we add `tenantId`. But if unique filter is not composite? Model has `id` global unique; adding tenantId to where with `id` is allowed (field filter). For `findFirst`, where may be undefined. OK.

Need handle args with `select`/`include`? Not needed.

Need operations list:
Read ops: ['findUnique', 'findFirst', 'findMany', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']
Single write: ['create', 'update', 'delete', 'upsert']
Many write: ['createMany', 'updateMany', 'deleteMany']

Wrapper for model property:
```
const model = base[modelName] as any;
return new Proxy(model, {
  get(target, prop) {
    const fn = target[prop];
    if (typeof fn !== 'function') return fn;
    const op = String(prop);
    if (isReadOp(op)) return async (...args) => {
       const [queryArgs] = args;
       const tenantId = context.getTenantId();
       const newArgs = { ...queryArgs, where: { ...getWhere(queryArgs), tenantId } };
       return target[prop](newArgs);
    };
    if (op === 'create') return async (args) => { const tenantId = context.getTenantId(); return target[op]({ ...args, data: withTenant(args.data, tenantId) }); };
    if (op === 'createMany') return async (args) => { ... data: (args.data ?? []).map(d => withTenant(d, tenantId)) };
    if (op === 'update') return async (args) => { return target[op]({ ...args, where: withTenantWhere(args.where, tenantId), data: withTenant(args.data, tenantId) }); }
    if (op === 'updateMany') return async (args) => { return target[op]({ ...args, where: withTenantWhere(args.where, tenantId), data: withTenant(args.data, tenantId) }); }
    if (op === 'delete') return async (args) => { return target[op]({ ...args, where: withTenantWhere(args.where, tenantId) }); }
    if (op === 'deleteMany') return async (args) => { return target[op]({ ...args, where: withTenantWhere(args.where, tenantId) }); };
    if (op === 'upsert') return async (args) => { return target[op]({ ...args, where: withTenantWhere(args.where, tenantId), create: withTenant(args.create, tenantId), update: withTenant(args.update, tenantId) }); }
    return fn.apply(target, args);
  }
});
```
Need `withTenantWhere` should not add tenantId to where if where is string? Prisma where for delete can be object. Could be `{ id }`. If where is null? add.
`withTenantData` should add tenantId to top-level object or each array item. If data is undefined? For update, data required. For updateMany, data required. For create, data required. If data has `tenantId`, override.

Potential issue: For `create`, if data contains nested `plans` objects, `withTenant` adds tenantId only top-level. Fine.

Need context.getTenantId may throw if no tenant. For tenant-owned models only. For base tenant? We don't proxy tenant.

Need base PrismaClient in production. In `TenantPrismaService` constructor:
```
constructor(context: TenantContextService) {
  const base = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  this.client = createTenantAwareClient(base, context);
}
```
But strict: `createTenantAwareClient` returns `TenantAwarePrismaClient`. Good.

Need `GlobalPrismaService`:
```
@Injectable() export class GlobalPrismaService extends PrismaClient {
  constructor() { super({ datasources: { db: { url: process.env.DATABASE_URL } } }); }
}
```
Need onModuleInit/onModuleDestroy? PrismaClient has $connect, $disconnect. In Nest, can implement:
```
async onModuleInit() { await this.$connect(); }
async onModuleDestroy() { await this.$disconnect(); }
```
For TenantPrismaService, base client not exposed; can hold base and implement. But if tests create service without env? It will instantiate PrismaClient and maybe not connect. OK but might require generated client? In repo, Prisma client generated after `prisma generate`. In tests, if `@prisma/client` not generated, import fails. But in solution, we assume `prisma generate` run. However unit tests should not need DB. PrismaClient constructor doesn't connect. OK.

Need migrations. Need create `prisma/migrations/.../migration.sql`. Need include initial schema. Since no tools, write SQL manually. Need match schema.
Migration timestamp: `20260101000000_init` maybe. Contents:
```
CREATE TABLE "tenants" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "primary_color" TEXT NOT NULL,
  "logo_url" TEXT,
  "feature_flags" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE UNIQUE INDEX "tenants_host_key" ON "tenants"("host");

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
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
Need Prisma `@updatedAt` in DB is just timestamp not default? Prisma uses app update. SQL no default for updated_at. OK. But in Prisma, `@updatedAt` field has no default. In migration, no default. Good.

Plans:
```
CREATE TABLE "plans" (
 "id" TEXT NOT NULL,
 "tenant_id" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "price_cents" INTEGER NOT NULL,
 "is_default" BOOLEAN NOT NULL DEFAULT false,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY
);
CREATE UNIQUE INDEX "plans_tenant_id_name_key" ON "plans"("tenant_id", "name");
```
Orders:
```
CREATE TABLE "orders" (
 "id" TEXT NOT NULL,
 "tenant_id" TEXT NOT NULL,
 "customer_id" TEXT NOT NULL,
 "plan_id" TEXT NOT NULL,
 "status" TEXT NOT NULL,
 "total_cents" INTEGER NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY
);
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");
CREATE INDEX "orders_plan_id_idx" ON "orders"("plan_id");
FKs to tenants, customers, plans. Maybe cascade.
```
Need maybe order number unique per tenant? Not necessary.

Need schema.prisma:
```
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
model Tenant { ... }
model Customer { ... }
...
```
Need `featureFlags Json` maps to `feature_flags` JSONB. In Prisma Json type. In TS, `Record<string, boolean>` cast.

Need feature modules:
`TenantModule` @Injectable, global? Let's make not global, explicit imports.
```
@Global()? Hmm. If not global, every feature module imports TenantModule. OK.
@Module({
 providers: [TenantContextService, GlobalPrismaService, TenantPrismaService, TenantRepository, TenantService],
 exports: [TenantContextService, GlobalPrismaService, TenantPrismaService, TenantService],
})
export class TenantModule {}
```
Need `TenantService` methods:
- `findActiveTenantByHost(host: string)` maybe returns ResolvedTenant or null.
- `getConfig(tenantId: string)` returns branding + flags.
- Maybe `assertTenantMatchesToken(tenant, orgClaim)`.

But middleware needs `TenantRepository` or `TenantService`. Use `TenantService.findHost(host)` and `tenantContext.run`.
`TenantService` can map Prisma Tenant to `ResolvedTenant` and `TenantConfigDto`.

`TenantRepository` uses `GlobalPrismaService`.
```
async findByHost(host: string) { return this.prisma.tenant.findUnique({ where: { host } }); }
async findById(id: string) { return this.prisma.tenant.findUnique({ where: { id } }); }
```
Need `host` lower. In middleware normalize.

`TenantConfigModule`:
- imports TenantModule.
- providers: TenantConfigService (maybe uses TenantService)
- controllers: TenantConfigController
Could avoid repository. Controller `@Get('tenant-config')` route? Endpoints kebab-case plural. The task says `GET /tenant-config` singular. Convention says endpoint kebab-case, plural. Contradiction. Task explicitly says `GET /tenant-config`. Should follow task. Could route `/tenant-config`. It's not plural. But conventions say plural. Maybe use `/tenant-config` because explicit. Could also alias `/tenant-configs`? Not needed. Use `@Get('tenant-config')`.

Controller zero logic: get tenant from context, call service. But context service can throw if missing; middleware ensures. Service:
```
@Injectable() export class TenantConfigService {
 constructor(private readonly tenantService: TenantService) {}
 async getConfig(tenantId: string) { return this.tenantService.getConfig(tenantId); }
}
```
Maybe controller:
```
@Get('tenant-config')
async getConfig(@Req() req: Request) { const tenant = this.tenantContext.getTenant(); return this.service.getConfig(tenant.id); }
```
Is calling context in controller business logic? Zero business logic; retrieving tenant id is fine? Maybe better inject tenant id via guard/param. We can create `TenantId` decorator that reads from context. Or controller can call `this.tenantContext.getTenantId()`. That's not business logic. OK.

Need `CustomerModule`:
- imports TenantModule
- providers CustomerService, CustomerRepository
- controllers CustomerController

CustomerController endpoints:
```
@UseGuards? Middleware global handles tenant and auth. No guard.
@Get('customers')
list() { return this.service.list(); }

@Post('customers')
create(@Body() body: CreateCustomerDto) { validate email/name; return this.service.create({ email, name }); }

@Get('customers/:id')
get(@Param('id') id) { return this.service.getById(id); }

@Patch('customers/:id')
update(@Param('id') id, @Body() body) { validate; return this.service.update(id, { name }); }

@Delete('customers/:id')
delete(@Param('id') id) { return this.service.remove(id); }
```
Need input validation: email regex? name string. Use `validateCreateCustomer(body)` returns clean or throw ApiError 400. Could put in controller? Controller validates input, zero business logic. Validation is input validation, okay. Could create pure function in `customer.validation.ts`? More files. Could implement helper in controller file? OK.

Need DTO classes? Could just types. But controller validates manually.

CustomerService:
```
@Injectable() export class CustomerService {
 constructor(private readonly repository: CustomerRepository) {}
 async list() { return this.repository.findMany(); }
 async create(input: { email: string; name: string }) { return this.repository.create(input); }
 async getById(id: string) { const found = await this.repository.findById(id); if (!found) throw new ApiError(404, 'resource_not_found', 'Customer not found', { id }); return found; }
 async update(id, input) { const updated = await this.repository.update(id, input); if (!updated) throw new ApiError(404,...); return updated; }
 async remove(id) { const deleted = await this.repository.delete(id); if (!deleted) throw new ApiError(404,...); return { deleted: true }; }
}
```
Need if duplicate email in same tenant: repository create may throw Prisma P2002. Filter maps to 409 `duplicate_resource`. Or service catch? Filter enough.

CustomerRepository:
```
@Injectable() export class CustomerRepository {
 constructor(@Inject(TENANT_PRISMA?) private readonly prisma: TenantPrismaService) {}
 findMany() { return this.prisma.client.customer.findMany({ orderBy: { createdAt: 'desc' } }); }
 findById(id) { return this.prisma.client.customer.findFirst({ where: { id } }); } // Using findFirst so tenant scoped. Could use findUnique but proxy adds tenant. findUnique with id and tenant where? If proxy adds tenant to where, fine. But `findUnique` requires where unique; adding tenant field is okay? In Prisma, findUnique where can include non-unique fields? Actually findUnique requires where unique criteria; you can pass only unique fields? I think Prisma allows additional fields? Not sure. `findUnique` where type only allows unique fields? For composite unique maybe not. Adding tenantId to findUnique where with id may be invalid because id is unique but tenantId not part of unique? Prisma's findUnique where allows any fields? I think `findUnique` accepts where with unique fields only? Let's check memory: Prisma findUnique where can include non-unique fields? It requires at least one unique field, but can include other fields? I think it allows only unique fields in where? Example `findUnique({ where: { email } })`. Adding `tenantId` might be allowed as AND? Not sure. Safer use `findFirst({ where: { id, tenantId } })` for tenant-scoped fetch by id. But proxy for findFirst adds tenantId. Repository can call `findFirst({ where: { id } })`. Proxy adds tenant. For update/delete, where id. Proxy adds tenant. Use `update` where id; proxy adds tenant. For create, data. Good.

`update`: `return this.prisma.client.customer.update({ where: { id }, data });` Proxy adds tenantId to where and data. If not found, Prisma throws P2025. Service could catch? Our repository could instead `findFirst` then update? But to return 404 for not found, easier repository `updateMany`? Hmm.
Prisma `update` throws `P2025` record not found. Filter can map to resource_not_found. Or service can catch. Better repository can do `const current = await this.findById(id); if (!current) return null; return this.prisma.client.customer.update({ where: { id }, data });` This avoids P2025 and ensures tenant. But two queries. OK.
`delete`: similarly find then delete? Or `deleteMany` and check count. `delete` throws P2025. Use `deleteMany({ where: { id } })` returns count; if 0 null. Proxy adds tenant. But deleteMany may delete multiple? id unique. OK. Or find then delete. Use deleteMany for simplicity:
```
async delete(id) { const res = await this.prisma.client.customer.deleteMany({ where: { id } }); return res.count > 0 ? { id } : null; }
```
But requirement delete row; if not found 404. Good.
`update`: use `updateMany({ where: { id }, data })` and if count 0 null; else fetch? Need return updated row. Could do `const result = await this.prisma.client.customer.update({ where: { id }, data });` and catch P2025? Could implement repository to check exists then update.
```
async update(id, data) { const existing = await this.findById(id); if (!existing) return null; return this.prisma.client.customer.update({ where: { id }, data }); }
```
Good.
```
async create(input) { return this.prisma.client.customer.create({ data: input }); }
```
```
async findMany() { return this.prisma.client.customer.findMany(); }
```
Need not pass tenantId.
```
async count()? maybe not.
```

But proxy `update` where: repository passes `{ id }`, proxy adds `tenantId`. If existing found, update should succeed. Data may include tenantId override. Good.

Need `PlanRepository` and `OrderRepository`? If no controllers, maybe not. But schema only. But structural isolation extension scopes them. Could still provide repositories? Not called for. Avoid extra files.

Need maybe seed tenants for tests? Tests can insert tenants via repository or fake DB. If using supertest with real DB, need seed. But we won't.

Now tests. Need produce `test/<feature>.spec.ts`? Could be `test/customer.spec.ts`, `test/tenant-config.spec.ts`, `test/tenant-isolation.spec.ts`. Need Vitest. Need test behaviour.

Given no DB, we can build an in-memory fake base Prisma client and instantiate real `TenantPrismaService`/`CustomerRepository`/`CustomerService` maybe. But `TenantPrismaService` constructor creates real PrismaClient if not injected. We need make it testable. Let's design `TenantPrismaService` to accept optional base client via token or parameter. With Nest DI, constructor parameter optional is not easy but can use `@Injectable() { useFactory: () => new TenantPrismaService(context, createBaseClient()) }`. In tests, we can instantiate class directly with fake base. But repository expects `TenantPrismaService` instance. We can create fake base in test and `new TenantPrismaService(context, fakeBase)`. Then `new CustomerRepository(tenantPrisma)`. That tests proxy and repository/service.

Define:
```
@Injectable()
export class TenantPrismaService {
  readonly client: TenantAwarePrismaClient;
  private readonly base: PrismaClient;
  constructor(context: TenantContextService, base?: PrismaClient) {
    this.base = base ?? new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    this.client = createTenantAwareClient(this.base, context);
  }
  async onModuleInit() { await this.base.$connect(); }
  async onModuleDestroy() { await this.base.$disconnect(); }
}
```
But in module provider, Nest will call constructor with context only, base undefined. In tests, direct new with fake. However if constructor has optional second param, Nest DI won't inject it; if not decorated, Nest may try to resolve type? With Nest, if a constructor parameter has no decorator, it uses type metadata. Optional parameter may still be attempted? In `@Injectable()`, Nest uses Reflect metadata for all parameters. If second param type is `PrismaClient`, it may try to resolve `PrismaClient` provider unless optional? It may fail if no provider. We can avoid by not making class with base param. Instead use factory:
```
export const TENANT_PRISMA = 'TENANT_PRISMA';
@Injectable()
export class TenantPrismaService { readonly client; constructor(@Inject(TENANT_PRISMA_CLIENT) private readonly client: TenantAwarePrismaClient) {} }
```
Hmm.

Better: Use provider token for client:
```
export const TENANT_PRISMA_CLIENT = Symbol('TENANT_PRISMA_CLIENT');
@Injectable()
export class TenantPrismaService {
  readonly client: TenantAwarePrismaClient;
  constructor(@Inject(TENANT_PRISMA_CLIENT) client: TenantAwarePrismaClient) { this.client = client; }
}
```
Module provides:
```
{
 provide: TENANT_PRISMA_CLIENT,
 inject: [TenantContextService],
 useFactory: (context: TenantContextService) => createTenantAwareClient(new PrismaClient({...}), context),
}
{
 provide: TenantPrismaService,
 useFactory: (client: TenantAwarePrismaClient) => new TenantPrismaService(client),
 inject: [TENANT_PRISMA_CLIENT],
}
```
But then lifecycle not. Could skip. Or simpler provider class and in tests override `TenantPrismaService` entirely with fake object. That may be easiest.

Define `TenantPrismaService` class with constructor `(context: TenantContextService)` only, creates real base. In tests, we don't instantiate; we override provider with a fake `TenantPrismaService` object? But repository injects `TenantPrismaService` and uses `.client`. We can create a test double with `client` property built from `createTenantAwareClient(fakeBase, context)`. But if we want test proxy, we can call `createTenantAwareClient` directly and assign to fake service:
```
const context = new TenantContextService();
const tenantPrisma = { client: createTenantAwareClient(fakeBase, context) } as unknown as TenantPrismaService;
const repo = new CustomerRepository(tenantPrisma);
const service = new CustomerService(repo);
```
This tests proxy and repository/service. In module, real service is provided. Good. No need optional base.

Need `createTenantAwareClient` exported for tests. It takes `base: PrismaClient`? We can type as `BasePrismaClient` minimal to allow fake. Define:
```
export type ModelDelegate = Record<string, unknown>;
export type BasePrismaClient = Record<string, ModelDelegate>;
export function createTenantAwareClient(base: BasePrismaClient, context: TenantContextService): TenantAwarePrismaClient { ... }
```
In production, pass `new PrismaClient()`. Type structural. Good. Then `TenantPrismaService` constructor creates `new PrismaClient()` and calls function. In tests, fake base.

Need fake base in tests implement model delegates with methods that behave like DB. Need support methods:
- customer: findMany, findFirst, create, update, updateMany, deleteMany, maybe count.
- plan/order maybe not.
Need data store per tenant. But fake base should not itself enforce tenant? To test tenant-aware proxy, fake base can simply operate on global rows using where.tenantId if present. It should not add tenant automatically. That simulates raw DB where queries are filtered by where. If proxy fails to add tenant, fake base might return all rows (if no tenant in where), causing cross-tenant. Good.

Fake base implementation:
```
type Row = Record<string, any>;
function createFakeBase(rows: Row[]) {
  const db: Row[] = [...rows];
  const filterRows = (where = {}) => db.filter(row => Object.entries(where).every(([k,v]) => {
     if (v && typeof v === 'object' && !(v instanceof Date)) {
        return Object.entries(v).every(([kk, vv]) => row[kk] === vv);
     }
     return row[k] === v;
  }));
  return {
    customer: {
      findMany: async (args = {}) => filterRows(args.where).map(row => ({...row})),
      findFirst: async (args = {}) => filterRows(args.where)[0] ? { ...filterRows(args.where)[0] } : null,
      create: async (args = { data: {} }) => { const row = { id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...args.data }; if (!row.tenantId) throw new Error('Missing tenant'); db.push(row); return {...row}; },
      update: async (args = { where: {}, data: {} }) => { const matches = filterRows(args.where); if (matches.length === 0) throw new FakePrismaError('P2025'); const row = matches[0]; Object.assign(row, args.data, { updatedAt: new Date() }); return {...row}; },
      updateMany: async (args = { where: {}, data: {} }) => { const matches = filterRows(args.where); matches.forEach(row => Object.assign(row, args.data, { updatedAt: new Date() })); return { count: matches.length }; },
      deleteMany: async (args = { where: {} }) => { const matches = filterRows(args.where); const remaining = db.filter(row => !matches.includes(row)); db.length = 0; db.push(...remaining); return { count: matches.length }; },
    }
  };
}
```
But need unique constraint? For same email in both tenants, no global unique. For duplicate within tenant, fake create could enforce to test conflict? Not necessary. But filter P2002? We can implement:
```
if (row.tenantId && row.email && db.some(r => r.tenantId === row.tenantId && r.email === row.email)) throw new FakePrismaError('P2002');
```
Good.

Need `FakePrismaError` with code. Filter can map. But in unit tests service may not catch. For duplicate, maybe not test.

Need test `customer.service.spec.ts` or `customer.spec.ts`:
- Set up fake DB with tenant A/B. Use context.run for tenant A or B.
- For each test, create new fake base and service.
- Test list: tenant B cannot list tenant A rows: run B, list returns B only.
- Fetch by id: tenant B fetch A id -> service throws ApiError 404 resource_not_found. Use `assert.rejects`.
- Update: tenant B update A id -> 404.
- Delete: tenant B delete A id -> 404.
- Same email registers in both tenants: run A create email, run B create same email, both succeed; maybe fetch by email? Not endpoint. Could verify repository? Service create returns rows with different tenantId. Need ensure unique per tenant. Use `service.create` in both contexts.
- Concurrent requests from different tenants don't cross contexts: Use `Promise.all([context.run(tenantA, async () => { await service.create(...); const list = await service.list(); expect list only A; }), context.run(tenantB, ...)])`. Need maybe interleave with async. Since ALS ensures each promise has context. Could simulate delay. Use `await Promise.all([...])`.

Need also test tenant resolution middleware? Could test host + token agreement. Need maybe `test/tenant-resolution.spec.ts`. Use fake tenant repository? Middleware uses TenantService/Repository. We can instantiate middleware directly with stubs. Need test:
- Host and token org mismatch -> rejects with ApiError 403 tenant_mismatch.
- Invalid token -> 401 invalid_token.
- Unknown host -> 400? 
- Success: next called and context contains tenant. Need verify by running a callback inside next? Middleware wraps next in context. We can call middleware with a req, res, next that captures `tenantContext.getTenantId()`.

Need token verification. If middleware uses `jwt.verify` with secret, tests need sign. We can set `process.env.AUTH_TOKEN_SECRET = 'test-secret'`. Use `jsonwebtoken` sign `{ org: 'tenant-a' }`. Need tenant slug. Good.

But if we include jsonwebtoken dependency, OK. Need perhaps `@types/jsonwebtoken`. In package.json.

Need host header in req: `{ host: 'app.operator-a.com' }`. `Authorization: 'Bearer token'`.

Need `TenantService` in middleware. Could be stub:
```
const tenantService = { findTenantByHost: async (host) => host === 'app.operator-a.com' ? tenantA : null };
const middleware = new TenantResolutionMiddleware(tenantContext, tenantService as any);
```
But actual constructor? Need design. `TenantResolutionMiddleware` injects `TenantContextService`, `TenantService`. `TenantService.findTenantByHost` returns `ResolvedTenant | null`.

Need `TenantService` implementation:
```
@Injectable() export class TenantService {
 constructor(private readonly repository: TenantRepository) {}
 async findTenantByHost(host: string): Promise<ResolvedTenant | null> { const tenant = await this.repository.findByHost(host.toLowerCase()); return tenant ? this.toResolved(tenant) : null; }
 async getConfig(tenantId: string): Promise<TenantConfigDto> { const tenant = await this.repository.findById(tenantId); if (!tenant) throw new ApiError(404, 'resource_not_found', 'Tenant not found', { tenantId }); return { id: tenant.id, name: tenant.name, primaryColor: tenant.primaryColor, logoUrl: tenant.logoUrl, featureFlags: tenant.featureFlags as Record<string, boolean> }; }
}
```
Need `toResolved` maps `featureFlags` maybe JSON. If featureFlags null? Schema NOT NULL. Good.

But `TenantRepository` uses `GlobalPrismaService` which in tests can be stubbed? For middleware test, use `TenantService` stub not repository. OK.

Need `TenantResolutionMiddleware` details:
```
export interface TenantRequest extends Request { tenant?: ResolvedTenant }
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly context: TenantContextService, private readonly tenantService: TenantService) {}
  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const host = normalizeHost(req.headers.host);
      if (!host) throw new ApiError(400, 'invalid_host', 'Host header is required.', {});
      const token = extractBearerToken(req.headers.authorization);
      if (!token) throw new ApiError(401, 'invalid_token', 'Authorization bearer token is required.', {});
      const payload = verifyOrgToken(token);
      const tenant = await this.tenantService.findTenantByHost(host);
      if (!tenant) throw new ApiError(400, 'unknown_host', 'Host does not map to a known tenant.', { host });
      if (payload.org !== tenant.slug) throw new ApiError(403, 'tenant_mismatch', 'Token org claim does not match the tenant host.', { org: payload.org, tenant: tenant.slug });
      req.tenant = tenant;
      await this.context.run(tenant, () => next());
    } catch (err) { next(err); }
  }
}
```
Need `next()` may return void; `context.run` returns same. If `next` throws sync, catch? We use async and call next inside run. If next returns Promise, await. If error, catch and next(err) again? Need avoid double. Could:
```
try { ... await this.context.run(tenant, async () => { await next(); }); } catch (err) { next(err); }
```
If next(err) called inside? OK.

But if `next` is Nest's next, calling with error. Good.

Token verify helper:
```
function verifyOrgToken(token: string): { org: string } {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret) throw new ApiError(500, 'internal_error', 'AUTH_TOKEN_SECRET is not configured.', {});
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !decoded.org || typeof decoded.org !== 'string') throw new Error('missing org');
    return decoded as { org: string };
  } catch (err) {
    throw new ApiError(401, 'invalid_token', 'Bearer token is invalid.', {});
  }
}
```
Need type jwt payload. Use `jwt.verify` returns `string | JwtPayload`. Need import type.

Need normalizeHost:
```
function normalizeHost(value: string | string[] | undefined) {
  if (!value) return '';
  const first = Array.isArray(value) ? value[0] : value;
  const lower = first.trim().toLowerCase();
  const colonIndex = lower.indexOf(':');
  return colonIndex === -1 ? lower : lower.slice(0, colonIndex);
}
```

Need application module. Need register middleware globally:
`AppModule`:
```
@Module({ imports: [TenantModule, TenantConfigModule, CustomerModule] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(TenantResolutionMiddleware).forRoutes('*'); }
}
```
Need import `MiddlewareConsumer`, `NestModule`. Need `forRoutes('*')` in Express? Use `() => true`? In Nest, `forRoutes('*')` works? It applies to all routes. Could use `.forRoutes('*')`. Or `.forRoutes({ path: '*', method: RequestMethod.ALL })`. Simpler: `consumer.apply(TenantResolutionMiddleware).forRoutes('*');`.

Need `main.ts`:
```
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './app/api-exception.filter';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}
bootstrap();
```
Need config from env only. No CORS maybe. Could add? Not needed.

Need package.json. Should include dependencies. But if format requires only solution files, package.json needed. Also `tsconfig.json`? Maybe. `vitest.config.ts`? Need tests run. Need `prisma/schema.prisma`, migration. Need maybe `.env.example`? Not secrets. But config from env only; can include `.env.example` with placeholders. Is that file called for? Maybe not. Could include `package.json`, `tsconfig.json`, `vitest.config.ts`, `prisma/migrations/.../migration.sql`. Need complete.

Need ensure ESM `"type": "module"`. NestJS with ESM? NestJS supports ESM? There are issues. But conventions say ESM, type module. Need tsconfig `module: NodeNext`, `target: ES2022`, `moduleResolution: NodeNext`. But NestJS decorators and DI? Works? Maybe. Need `experimentalDecorators`, `emitDecoratorMetadata`? NestJS needs emitDecoratorMetadata for DI. With ESM NodeNext, emitDecoratorMetadata? Yes. But Node ESM does not support TypeScript decorator metadata? It does via emitted JS. OK.

Need file imports with `.js` extension if ESM NodeNext? TypeScript with `moduleResolution: NodeNext` requires relative imports include `.js` for ESM. NestJS code often uses no extension, but with `"type": "module"`, Node ESM requires extensions. However many projects use ts-node or Nest webpack? Conventions say ESM, type module. For Node 20 ESM, imports need file extensions. In generated code? If we output imports without `.js`, Node ESM may fail. But maybe they use tsx/vitest which supports extensionless? Vitest uses Vite, supports TS extensionless. But Node runtime with Nest? Hard. Need decide. The convention likely expects standard NestJS TS with no extensions? But says ESM, type module. To be safe for Node ESM, use `.js` extensions in relative imports. But NestJS? If using `ts-node esm` maybe. Vitest handles `.js` extensions mapping to TS? Yes, Vite can resolve `.js` to `.ts` if configured? It may. TypeScript NodeNext expects `.js`. Let's use `.js` extensions in relative imports. But many examples? Need ensure tests import spec? Vitest doesn't need.

However `prisma/schema.prisma` and package scripts. Use `tsx`? Could include dev dependency `tsx` to run main? But package.json scripts maybe `node dist/main.js`. Need build script `tsc`. But ESM with Nest maybe. Not critical.

Need Vitest config. Since tests may use `process.env`. Use `vitest.config.ts`:
```
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.spec.ts'] } });
```

Need package.json:
```
{
  "name": "multi-tenant-white-label",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/main.js"? If outDir dist. Hmm.
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@prisma/client": "^5.0.0",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.0.0",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/node": "^20.11.0",
    "prisma": "^5.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3",
    "vitest": "^1.1.0"
  }
}
```
Need `prisma` as devDependency, `@prisma/client` dependency. Need `@nestjs/testing` for tests? If we don't use TestingModule, maybe not. But include.

Need tsconfig:
```
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```
But `rootDir` includes test, output dist/test. OK. `main.ts` at src/main.ts, out dist/src/main.js. Start script `node dist/src/main.js`. Good.

Need maybe `prisma` schema generator. OK.

Need use `.js` extensions in imports. Example `import { Injectable } from '@nestjs/common';` no extension for packages. Relative: `import { AppModule } from './app.module.js';` Good.

Need classes and exports.

Let's design each file in detail.

### src/common/types? Maybe `src/tenant/tenant.types.ts` for interfaces. Need feature? Could be `src/tenant/tenant.types.ts`. Naming OK.
```
export interface ResolvedTenant {
  id: string;
  slug: string;
  host: string;
  name: string;
  primaryColor: string;
  logoUrl: string | null;
  featureFlags: Record<string, boolean>;
}
export interface TenantConfigDto { id: string; name: string; primaryColor: string; logoUrl: string | null; featureFlags: Record<string, boolean>; }
```

### src/common/api-error.ts? Could be `src/common/api-error.ts`. But layout? OK. Need maybe `src/app/api-error.ts`. Let's choose `src/common/api-error.ts`.
```
import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiError extends HttpException {
  constructor(
    private readonly statusCode: number,
    public readonly code: string,
    public readonly message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, statusCode);
  }
  getResponse(): { error: { code: string; message: string; details: Record<string, unknown> } } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
  getStatus(): number { return this.statusCode; }
}
```
But HttpException already has getStatus. We can not override? Need super sets? In HttpException, `getStatus()` returns status if number. OK. But constructor parameter `statusCode` private? If private, no need. Let's:
```
export class ApiError extends HttpException {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.details = details;
  }
  getResponse() { return { error: { code: this.code, message: (this as any).message? }} }
```
HttpException's message property? It may set message? Not sure. We can store `this.message = message`? Error message. But `getResponse` can use stored.
```
private readonly errorMessage: string;
constructor(status, code, message, details = {}) { super({ error: { code, message, details } }, status); this.code = code; this.errorMessage = message; this.details = details; }
getResponse() { return { error: { code: this.code, message: this.errorMessage, details: this.details } }; }
```
Good.

### src/app/api-exception.filter.ts (or common)
Need import ApiError, HttpException, ExceptionFilter, ArgumentsHost, Catch. Use `@Catch()`.
```
import { CallHandler, ExecutionContext, HttpException, ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Response, Request } from 'express';
import { ApiError } from '../common/api-error.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json(exception.getResponse()); return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (body && typeof body === 'object' && 'error' in body) { response.status(status).json(body); return; }
      response.status(status).json({ error: { code: statusToCode(status), message: exception.message, details: {} } });
      return;
    }
    // Prisma known errors
    const err = exception as any;
    if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' && err.code.startsWith('P2')) {
       if (err.code === 'P2002') { response.status(409).json({ error: { code: 'duplicate_resource', message: 'A resource with these unique values already exists.', details: { target: err.meta?.target ?? {} } }); return; }
       if (err.code === 'P2025') { response.status(404).json({ error: { code: 'resource_not_found', message: 'Resource not found.', details: {} }); return; }
    }
    this.logger.error(`Unhandled error on ${request.method} ${request.url}`, (exception as Error)?.stack);
    response.status(500).json({ error: { code: 'internal_error', message: 'An unexpected error occurred.', details: {} } });
  }
}
function statusToCode(status: number): string { if (status === 400) return 'validation_error'; if (status === 401) return 'unauthorized'; if (status === 403) return 'forbidden'; if (status === 404) return 'resource_not_found'; if (status === 409) return 'conflict'; if (status === 422) return 'unprocessable_entity'; if (status >= 500) return 'internal_error'; return 'http_error'; }
```
Need `details` never null. For P2002 target may be undefined; use `err.meta?.target ?? {}`. Good.

But for `HttpException` from Nest validation pipe? Not using. OK.

### src/tenant/tenant-context.service.ts
```
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { ResolvedTenant } from './tenant.types.js';
import { ApiError } from '../common/api-error.js';

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<ResolvedTenant>();
  run<T>(tenant: ResolvedTenant, fn: () => T | Promise<T>): T | Promise<T> {
    return this.storage.run(tenant, fn);
  }
  getTenant(): ResolvedTenant {
    const tenant = this.storage.getStore();
    if (!tenant) throw new ApiError(500, 'internal_error', 'Tenant context is missing.', {});
    return tenant;
  }
  getTenantId(): string { return this.getTenant().id; }
}
```
Could throwing ApiError in service okay. Filter handles 500. Maybe code `tenant_context_missing`. But 500. Could use 401? Missing context indicates bug. Use `internal_error`.

### src/tenant/global-prisma.service.ts
```
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class GlobalPrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  async onModuleInit() { await this.client.$connect(); }
  async onModuleDestroy() { await this.client.$disconnect(); }
  get prisma() { return this.client; }
}
```
But repository expects `GlobalPrismaService` with `tenant` property. If we expose `prisma`, repository uses `this.prisma.prisma.tenant`. Could instead extend PrismaClient:
```
@Injectable() export class GlobalPrismaService extends PrismaClient implements OnModuleInit... { constructor() { super({ datasources... }); } async onModuleInit() { await this.$connect(); } ... }
```
Then repository `this.prisma.tenant`. Good. Need constructor? Can call super with options. In TS, `constructor() { super({ datasources: { db: { url: process.env.DATABASE_URL } } }); }`. OK.

### src/tenant/tenant-prisma.service.ts
Need createTenantAwareClient in separate file `tenant-prisma.middleware.ts`? Could be `src/tenant/tenant-prisma-client.ts`. Naming `kebab-case.role.ts`? It's not role. Could be `tenant-prisma.middleware.ts`? The proxy is middleware. Let's name `src/tenant/tenant-prisma.middleware.ts` exporting `createTenantAwareClient`. Then service `tenant-prisma.service.ts`.
File `tenant-prisma.middleware.ts`:
```
import { TenantContextService } from './tenant-context.service.js';

const TENANT_SCOPED_MODELS = ['customer', 'plan', 'order'] as const;
type TenantScopedModel = typeof TENANT_SCOPED_MODELS[number];
const READ_OPERATIONS = new Set(['findUnique','findFirst','findMany','findUniqueOrThrow','findFirstOrThrow','count','aggregate','groupBy']);

export type ModelDelegate = Record<string, unknown>;
export type BasePrismaClient = Record<string, ModelDelegate>;
export type TenantAwarePrismaClient = Record<TenantScopedModel, ModelDelegate>;

type QueryArgs = { where?: Record<string, unknown>; data?: unknown; create?: unknown; update?: unknown; [key: string]: unknown };

export function createTenantAwareClient(base: BasePrismaClient, context: TenantContextService): TenantAwarePrismaClient {
  const scoped: TenantAwarePrismaClient = {} as TenantAwarePrismaClient;
  for (const model of TENANT_SCOPED_MODELS) {
    const target = base[model] as ModelDelegate;
    scoped[model] = new Proxy(target, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        const operation = String(property);
        return wrapOperation(operation, target, value as (...args: unknown[]) => unknown);
      }
    });
  }
  return scoped;
}

function withTenantWhere(where: unknown, tenantId: string): Record<string, unknown> {
  const existing = where && typeof where === 'object' ? { ...(where as Record<string, unknown>) } : {};
  return { ...existing, tenantId };
}
function withTenantData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) return data.map((item) => withTenantData(item, tenantId));
  if (data && typeof data === 'object') return { ...(data as Record<string, unknown>), tenantId };
  return { tenantId };
}
function wrapOperation(operation: string, target: ModelDelegate, method: (...args: unknown[]) => unknown) {
  const context = ??? Need access context. In create function, wrap uses context closure.
}
```
Need pass context to wrapper. Implement inside loop:
```
const delegate = new Proxy(target, {
 get(target, prop, receiver) {
   const value = Reflect.get(target, prop, receiver);
   if (typeof value !== 'function') return value;
   const op = String(prop);
   if (READ_OPERATIONS.has(op)) {
     return async (args: QueryArgs = {}) => {
       const tenantId = context.getTenantId();
       return (target[op] as (a: QueryArgs) => unknown)({ ...args, where: withTenantWhere(args.where, tenantId) });
     };
   }
   switch(op) { ... }
   return (method as (...args: unknown[]) => unknown).apply(target, args);
 }
});
```
Need handle no args for findMany. `args` default.
For `create`:
```
return async (args: QueryArgs = {}) => { const tenantId = context.getTenantId(); return target[op]({ ...args, data: withTenantData(args.data, tenantId) }); }
```
For `createMany`: data array.
For `update`, `updateMany`, `delete`, `deleteMany`, `upsert`.
For unknown, return method.apply.

Need type `target[op]` index. ModelDelegate Record<string, unknown>. Cast:
```
const call = target[op] as (input: QueryArgs) => unknown;
```
For createMany input data can be array. `QueryArgs` has data unknown.
Potential issue: For read operations, if operation `findUnique` and `args.where` undefined, we set. OK.

Need if context missing, `context.getTenantId()` throws ApiError. Good.

Need ensure no tenant stamping for `tenant` model. We don't expose.

But production base PrismaClient has model properties `customer`, `plan`, `order`. Type BasePrismaClient structural. OK.

Potential issue with `Reflect.get` and Proxy target being Prisma model delegate object. It may have getter. OK.

Need `TenantPrismaService`:
```
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from './tenant-context.service.js';
import { createTenantAwareClient, TenantAwarePrismaClient, BasePrismaClient } from './tenant-prisma.middleware.js';

@Injectable()
export class TenantPrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: TenantAwarePrismaClient;
  private readonly base: PrismaClient;
  constructor(context: TenantContextService) {
    this.base = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    this.client = createTenantAwareClient(this.base as unknown as BasePrismaClient, context);
  }
  async onModuleInit() { await this.base.$connect(); }
  async onModuleDestroy() { await this.base.$disconnect(); }
}
```
Need strict: PrismaClient as BasePrismaClient? PrismaClient has methods and model delegates. Cast.

### src/tenant/tenant.repository.ts
```
import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from './global-prisma.service.js';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: GlobalPrismaService) {}
  findByHost(host: string) { return this.prisma.tenant.findUnique({ where: { host } }); }
  findById(id: string) { return this.prisma.tenant.findUnique({ where: { id } }); }
}
```
Need return type from Prisma. OK.

### src/tenant/tenant.service.ts
```
import { Injectable } from '@nestjs/common';
import { TenantRepository } from './tenant.repository.js';
import { ResolvedTenant, TenantConfigDto } from './tenant.types.js';
import { ApiError } from '../common/api-error.js';

@Injectable()
export class TenantService {
  constructor(private readonly repository: TenantRepository) {}
  async findTenantByHost(host: string): Promise<ResolvedTenant | null> {
    const tenant = await this.repository.findByHost(host);
    if (!tenant) return null;
    return this.toResolved(tenant);
  }
  async getConfig(tenantId: string): Promise<TenantConfigDto> {
    const tenant = await this.repository.findById(tenantId);
    if (!tenant) throw new ApiError(404, 'resource_not_found', 'Tenant not found.', { tenantId });
    return { id: tenant.id, name: tenant.name, primaryColor: tenant.primaryColor, logoUrl: tenant.logoUrl, featureFlags: normalizeFeatureFlags(tenant.featureFlags) };
  }
  private toResolved(tenant: any): ResolvedTenant { return { id: tenant.id, slug: tenant.slug, host: tenant.host, name: tenant.name, primaryColor: tenant.primaryColor, logoUrl: tenant.logoUrl, featureFlags: normalizeFeatureFlags(tenant.featureFlags) }; }
}
function normalizeFeatureFlags(value: unknown): Record<string, boolean> { if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, boolean>; return {}; }
```
Need type tenant from Prisma. Could import `Tenant` from @prisma/client. Use `Tenant` type. But generated client not available? In code, yes. Use:
```
import { Tenant } from '@prisma/client';
private toResolved(tenant: Tenant): ResolvedTenant
```
OK.

### src/tenant/tenant-resolution.middleware.ts
Need import jwt, Request/Response/NextFunction, NestMiddleware. Use `ApiError`. Need `TenantService`, `TenantContextService`.
```
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { TenantContextService } from './tenant-context.service.js';
import { TenantService } from './tenant.service.js';
import { ApiError } from '../common/api-error.js';
import { ResolvedTenant } from './tenant.types.js';

export interface TenantRequest extends Request { tenant?: ResolvedTenant; }

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService, private readonly tenantService: TenantService) {}
  async use(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const host = normalizeHost(req.headers.host);
      if (!host) throw new ApiError(400, 'invalid_host', 'Host header is required.', {});
      const token = extractBearerToken(req.headers.authorization);
      if (!token) throw new ApiError(401, 'invalid_token', 'Authorization bearer token is required.', {});
      const org = verifyOrgToken(token);
      const tenant = await this.tenantService.findTenantByHost(host);
      if (!tenant) throw new ApiError(400, 'unknown_host', 'Host does not map to a known tenant.', { host });
      if (org !== tenant.slug) throw new ApiError(403, 'tenant_mismatch', 'Token org claim does not match the tenant host.', { org, host, tenant: tenant.slug });
      req.tenant = tenant;
      await this.tenantContext.run(tenant, async () => {
        await next();
      });
    } catch (error) {
      next(error);
    }
  }
}
```
Need `next()` returns any. If `next` already called? OK.

But if `next` throws synchronous, `await next()` catches. If `next` calls `next(err)` internally? It might. Fine.

Potential issue: If an error occurs after next started (controller throws), `next(error)` may be called by Nest already? Middleware wrapping controller: If controller throws, Nest's exception handling calls next? Actually middleware's `next()` returns after route handler? In Express, next() calls downstream; if route handler throws, it may pass to error handler after next returns? Our `await next()` will wait for downstream? In Express, next() does not return a promise of downstream completion. In Nest Express adapter, `next()` may return a promise? Need verify. Nest's middleware `next()` returns `void`? Actually in Express, `next()` calls next handler and returns. It does not wait for route handler. If we wrap ALS with `await next()`, context may not persist if next doesn't return promise. But Nest's Express adapter may make next return Promise? I think NestJS middleware next returns void. For AsyncLocalStorage, we need ensure context is active during route handler. If we do `this.storage.run(tenant, () => next())`, the downstream handlers are invoked synchronously within the run callback? In Express, `next()` synchronously calls the next middleware/route handler? For route handler, it may call controller asynchronously? The async context should propagate from the call to next() if the handler starts within the same tick. But if the controller is async and returns a promise, ALS context is captured at the time the promise chain is initiated? AsyncLocalStorage propagates through async functions called within run. If `next()` invokes controller function synchronously and controller returns a promise, the promise continuation should carry ALS context. Even if `next()` returns void, the `run` callback returns after next() synchronously completes initial call, but the async work started inside should retain context because it was started within run. However if downstream scheduling is not synchronous? Usually OK. To be safe, in tests we can control next and call it within run. For production, maybe OK. But `await next()` if next returns undefined just resolves. OK.

But if route handler is scheduled after `next()` returns? In Express, `next()` synchronously calls route handler? It may. OK.

Need `verifyOrgToken`:
```
function verifyOrgToken(token: string): string {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret) throw new ApiError(500, 'internal_error', 'AUTH_TOKEN_SECRET is not configured.', {});
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    throw new ApiError(401, 'invalid_token', 'Bearer token is invalid.', {});
  }
  if (typeof payload === 'string' || typeof payload.org !== 'string' || payload.org.length === 0) throw new ApiError(401, 'invalid_token', 'Token org claim is invalid.', {});
  return payload.org;
}
```
Need `jwt.JwtPayload` type. With `esModuleInterop`, default import. OK.

`extractBearerToken`:
```
function extractBearerToken(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  const [scheme, token] = value.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
```

### src/tenant/tenant.module.ts
```
import { Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { GlobalPrismaService } from './global-prisma.service.js';
import { TenantPrismaService } from './tenant-prisma.service.js';
import { TenantRepository } from './tenant.repository.js';
import { TenantService } from './tenant.service.js';

@Module({
  providers: [TenantContextService, GlobalPrismaService, TenantPrismaService, TenantRepository, TenantService],
  exports: [TenantContextService, GlobalPrismaService, TenantPrismaService, TenantService],
})
export class TenantModule {}
```
Need maybe `TenantResolutionMiddleware` not provider? It's used in AppModule configure. It needs constructor deps. Middleware instance created by Nest? In `consumer.apply(TenantResolutionMiddleware)`, Nest instantiates it from current module? It should resolve providers from module where apply is called (AppModule). Since AppModule imports TenantModule, it can resolve TenantContextService and TenantService because exported. Good. But middleware class not declared in providers? Nest can instantiate if dependencies resolvable. It doesn't need to be provider? I think `apply` with class uses module context and resolves. OK.

### src/tenant-config/tenant-config.controller.ts
```
import { Controller, Get } from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service.js';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfigDto } from '../tenant/tenant.types.js';

@Controller()
export class TenantConfigController {
  constructor(private readonly tenantContext: TenantContextService, private readonly service: TenantConfigService) {}
  @Get('tenant-config')
  async getConfig(): Promise<TenantConfigDto> {
    const tenantId = this.tenantContext.getTenantId();
    return this.service.getConfig(tenantId);
  }
}
```
Zero business logic? Getting tenantId from context is input. OK.

### src/tenant-config/tenant-config.service.ts
```
import { Injectable } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service.js';
import { TenantConfigDto } from '../tenant/tenant.types.js';

@Injectable()
export class TenantConfigService {
  constructor(private readonly tenantService: TenantService) {}
  async getConfig(tenantId: string): Promise<TenantConfigDto> { return this.tenantService.getConfig(tenantId); }
}
```
Maybe redundant. But layering. OK.

### src/tenant-config/tenant-config.module.ts
```
import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantConfigService } from './tenant-config.service.js';

@Module({ imports: [TenantModule], controllers: [TenantConfigController], providers: [TenantConfigService] })
export class TenantConfigModule {}
```

### src/customer/customer.controller.ts
Need validation helpers. Could define in same file. Need route `customers` plural.
```
import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { ApiError } from '../common/api-error.js';

interface CreateCustomerBody { email?: unknown; name?: unknown; }
interface UpdateCustomerBody { name?: unknown; email?: unknown; }

@Controller('customers')
export class CustomerController {
  constructor(private readonly service: CustomerService) {}
  @Get()
  list() { return this.service.list(); }
  @Post()
  create(@Body() body: CreateCustomerBody) {
    const email = requireString(body?.email, 'email');
    validateEmail(email);
    const name = requireString(body?.name, 'name');
    return this.service.create({ email, name });
  }
  @Get(':id')
  get(@Param('id') id: string) { return this.service.getById(id); }
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateCustomerBody) {
    const changes: { email?: string; name?: string } = {};
    if (body?.email !== undefined) { const email = requireString(body.email, 'email'); validateEmail(email); changes.email = email; }
    if (body?.name !== undefined) { changes.name = requireString(body.name, 'name'); }
    if (Object.keys(changes).length === 0) throw new ApiError(400, 'validation_error', 'At least one field must be provided.', { fields: ['email', 'name'] });
    return this.service.update(id, changes);
  }
  @Delete(':id')
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
function requireString(value: unknown, field: string): string { if (typeof value !== 'string' || value.trim().length === 0) throw new ApiError(400, 'validation_error', `${field} must be a non-empty string.`, { field }); return value.trim(); }
function validateEmail(email: string) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'validation_error', 'email is not a valid email.', { email }); }
```
Need `details` object. Good.
Potential controller calling `this.service.create` with lowercased email? Could normalize to lower. In `requireString`, trim. In validate email, maybe lower. Return email.toLowerCase(). But helper can't. In controller: `const email = requireString(...).toLowerCase();`. Good.

Need `@Req()` not used. Remove.

### src/customer/customer.service.ts
```
import { Injectable } from '@nestjs/common';
import { CustomerRepository } from './customer.repository.js';
import { ApiError } from '../common/api-error.js';
import type { Customer } from '@prisma/client';

export interface CustomerInput { email: string; name: string; }
export interface CustomerUpdateInput { email?: string; name?: string; }

@Injectable()
export class CustomerService {
  constructor(private readonly repository: CustomerRepository) {}
  list(): Promise<Customer[]> { return this.repository.findMany(); }
  create(input: CustomerInput): Promise<Customer> { return this.repository.create(input); }
  async getById(id: string): Promise<Customer> {
    const customer = await this.repository.findById(id);
    if (!customer) throw new ApiError(404, 'resource_not_found', 'Customer not found.', { id });
    return customer;
  }
  async update(id: string, input: CustomerUpdateInput): Promise<Customer> {
    const customer = await this.repository.update(id, input);
    if (!customer) throw new ApiError(404, 'resource_not_found', 'Customer not found.', { id });
    return customer;
  }
  async remove(id: string): Promise<{ id: string }> {
    const deleted = await this.repository.delete(id);
    if (!deleted) throw new ApiError(404, 'resource_not_found', 'Customer not found.', { id });
    return deleted;
  }
}
```
Need `Customer` type generated. OK.

### src/customer/customer.repository.ts
```
import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import type { Customer } from '@prisma/client';
import type { CustomerInput, CustomerUpdateInput } from './customer.service.js';

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: TenantPrismaService) {}
  findMany(): Promise<Customer[]> { return this.prisma.client.customer.findMany({ orderBy: { createdAt: 'asc' } }) as Promise<Customer[]>; }
  findById(id: string): Promise<Customer | null> { return this.prisma.client.customer.findFirst({ where: { id } }) as Promise<Customer | null>; }
  create(input: CustomerInput): Promise<Customer> { return this.prisma.client.customer.create({ data: input }) as Promise<Customer>; }
  async update(id: string, input: CustomerUpdateInput): Promise<Customer | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    return this.prisma.client.customer.update({ where: { id }, data: input }) as Promise<Customer>;
  }
  async delete(id: string): Promise<{ id: string } | null> {
    const result = await this.prisma.client.customer.deleteMany({ where: { id } }) as { count: number };
    if (result.count === 0) return null;
    return { id };
  }
}
```
Need `findMany` args type? Proxy returns unknown. Cast. OK.
Potential issue: `deleteMany` with where `{ id }`, proxy adds tenantId. If row exists, count 1. Good.

But `CustomerInput` exported from service; repository imports from service (circular? Service imports repository, repository imports type from service. Type-only circular OK? Could avoid by defining types in `customer.types.ts`. Better to avoid circular import. Create `src/customer/customer.types.ts`.
```
export interface CustomerInput { email: string; name: string; }
export interface CustomerUpdateInput { email?: string; name?: string; }
```
Service and repository import.

### src/customer/customer.module.ts
```
import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module.js';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { CustomerRepository } from './customer.repository.js';

@Module({ imports: [TenantModule], controllers: [CustomerController], providers: [CustomerService, CustomerRepository] })
export class CustomerModule {}
```

Need maybe plan/order modules? If not, no.

But tests for isolation might use Customer only. Good.

Need app.module:
```
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantModule } from './tenant/tenant.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware.js';

@Module({ imports: [TenantModule, TenantConfigModule, CustomerModule] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
```
Need if `forRoutes('*')` works. Could use:
```
consumer.apply(TenantResolutionMiddleware).forRoutes((req) => true);
```
Nest supports `RouteMatch`? I think `forRoutes(...routes: RouteMatch[])` can be string. Use `'*'` OK. Or `forRoutes({ path: '(.*)', method: RequestMethod.ALL })`. To be safe:
```
import { RequestMethod } from '@nestjs/common';
consumer.apply(TenantResolutionMiddleware).forRoutes({ path: '(.*)', method: RequestMethod.ALL });
```
This applies to all. Use that.

Need main.ts with exception filter. Need import filter path.
```
import 'reflect-metadata';? NestFactory imports? In Nest, reflect-metadata imported by @nestjs/core? Maybe not. Add `import 'reflect-metadata';` in main. With ESM, side-effect import OK.

### src/app/api-exception.filter.ts or common. If main imports from './app/api-exception.filter.js'? Let's choose `src/app/api-exception.filter.ts` because app feature. But it uses ApiError from common. OK.

Need file paths relative:
- `src/app/api-exception.filter.ts`
- `src/app/app.module.ts`? Conventions: `src/app.module.ts` at root. So app.module at src root. Filter can be `src/app/api-exception.filter.ts` but no app module. OK.
- `src/common/api-error.ts`

Need maybe `src/common/` not in layout but OK.

Need tests.

Test files:
- `test/customer-isolation.spec.ts`
- `test/tenant-resolution.spec.ts`
- `test/tenant-config.spec.ts`
Maybe one file `test/multi-tenant.spec.ts`? Conventions test/<feature>.spec.ts. Could have multiple.

Need tests use vitest imports: `import { describe, expect, it, beforeEach } from 'vitest';`

Need create fake base helper in test file. Could create `test/helpers/fake-prisma.ts`? Conventions? Could. But "Do not create a file it does not call for"? Tests need helper. OK. But format can include. Maybe keep helper inside spec to reduce files.

Need test customer isolation with real `TenantContextService`, `createTenantAwareClient`, `CustomerRepository`, `CustomerService`. Need fake base. Need no Nest TestingModule. This tests behavior.

Fake base detailed:
```
type FakeRow = Record<string, unknown>;
class FakePrismaError extends Error { constructor(readonly code: string, message: string, readonly meta?: Record<string, unknown>) { super(message); } }

function createFakePrismaBase(rows: FakeRow[] = []) {
  const db: FakeRow[] = rows.map(row => ({ ...row }));
  const matches = (where: Record<string, unknown> = {}) => db.filter(row => Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      return Object.entries(value as Record<string, unknown>).every(([subKey, subValue]) => row[key] === subValue);
    }
    return row[key] === value;
  }));
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)); // but Date becomes string. Use spread for row.
```
Need avoid JSON for Dates. Use shallow clone: `{ ...row }`. For nested? OK.

Methods:
```
customer: {
  findMany: async (args: { where?: Record<string, unknown>; orderBy?: unknown } = {}) => {
    const found = matches(args.where ?? {});
    // If orderBy createdAt asc, sort
    return found.map(row => ({ ...row }));
  },
  findFirst: async (args: { where?: Record<string, unknown> } = {}) => {
    const found = matches(args.where ?? {});
    return found.length ? { ...found[0] } : null;
  },
  create: async (args: { data: Record<string, unknown> } = { data: {} }) => {
    const data = { ...args.data };
    if (typeof data.id !== 'string') data.id = crypto.randomUUID();
    const now = new Date();
    const row = { createdAt: now, updatedAt: now, ...data };
    if (row.tenantId === undefined) throw new FakePrismaError('P2003', 'Missing tenantId');
    if (row.tenantId && row.email) {
      const duplicate = db.some(r => r.tenantId === row.tenantId && r.email === row.email);
      if (duplicate) throw new FakePrismaError('P2002', 'Unique constraint', { target: ['tenant_id', 'email'] });
    }
    db.push(row);
    return { ...row };
  },
  update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> } = { where: {}, data: {} }) => {
    const found = matches(args.where ?? {});
    if (found.length === 0) throw new FakePrismaError('P2025', 'Record not found');
    const row = found[0];
    Object.assign(row, args.data, { updatedAt: new Date() });
    return { ...row };
  },
  deleteMany: async (args: { where?: Record<string, unknown> } = {}) => {
    const found = matches(args.where ?? {});
    for (const row of found) { const index = db.indexOf(row); if (index >= 0) db.splice(index, 1); }
    return { count: found.length };
  },
}
```
Need if `where` includes `tenantId: undefined`? Proxy always sets string. OK.

But if proxy fails to add tenantId, `matches({ id })` will match all tenants, causing cross. Good.

Need ensure fake base doesn't automatically scope by tenant. It only filters where provided. If where has tenantId, filters. Good.

Need test setup:
```
const tenantA: ResolvedTenant = { id: 'a', slug: 'operator-a', host: 'app.operator-a.com', name: 'A', primaryColor: '#111', logoUrl: null, featureFlags: { beta: true } };
const tenantB: ResolvedTenant = { id: 'b', slug: 'operator-b', host: 'app.operator-b.com', ... };
function makeService() {
  const context = new TenantContextService();
  const base = createFakePrismaBase([...]);
  const prisma = { client: createTenantAwareClient(base as unknown as BasePrismaClient, context) } as unknown as TenantPrismaService;
  const repository = new CustomerRepository(prisma);
  const service = new CustomerService(repository);
  return { context, service, db };
}
```
Need seed rows with `tenantId: 'a'/'b'`, `id: 'customer-a-1'`, etc.
Rows include `email`, `name`, `createdAt`, `updatedAt`.

Test list:
```
await context.run(tenantB, async () => {
  const rows = await service.list();
  expect(rows.every(row => row.tenantId === 'b')).toBe(true);
  expect(rows.map(row => row.id)).toEqual(['customer-b-1']);
});
```
Need `Customer` type has tenantId. OK.

Fetch by id:
```
await expect(context.run(tenantB, async () => service.getById('customer-a-1'))).rejects.toMatchObject({ code: 'resource_not_found', status: 404 });
```
ApiError has code, getStatus. `toMatchObject` works? It checks own enumerable? `code` property, `message` maybe. Status method not. Could assert `rejects.toThrow` then catch. Better:
```
let error: unknown;
await context.run(tenantB, async () => { try { await service.getById('customer-a-1'); } catch (e) { error = e; } });
expect(error).toBeInstanceOf(ApiError);
const apiError = error as ApiError;
expect(apiError.getStatus()).toBe(404);
expect(apiError.code).toBe('resource_not_found');
```
Need import ApiError.

Update/delete similar.

Same email registers in both tenants:
```
const createdA = await context.run(tenantA, () => service.create({ email: 'shared@example.com', name: 'A Shared' }));
const createdB = await context.run(tenantB, () => service.create({ email: 'shared@example.com', name: 'B Shared' }));
expect(createdA.tenantId).toBe('a');
expect(createdB.tenantId).toBe('b');
const aList = await context.run(tenantA, () => service.list());
const bList = await context.run(tenantB, () => service.list());
expect(aList.filter(c => c.email === 'shared@example.com').map(c => c.name)).toEqual(['A Shared']);
expect(bList.filter(c => c.email === 'shared@example.com').map(c => c.name)).toEqual(['B Shared']);
```
Need same email in different tenants. Good.

Concurrent requests:
```
await Promise.all([
  context.run(tenantA, async () => {
    await service.create({ email: 'a-concurrent@example.com', name: 'A' });
    const rows = await service.list();
    expect(rows.every(r => r.tenantId === 'a')).toBe(true);
    expect(rows.some(r => r.email === 'b-concurrent@example.com')).toBe(false);
  }),
  context.run(tenantB, async () => {
    await service.create({ email: 'b-concurrent@example.com', name: 'B' });
    const rows = await service.list();
    expect(rows.every(r => r.tenantId === 'b')).toBe(true);
    expect(rows.some(r => r.email === 'a-concurrent@example.com')).toBe(false);
  }),
]);
```
Need concurrency: add small delay? Not necessary but to interleave:
```
const results = await Promise.all([ ... ]);
```
Each run separate context. Good.

Need also test that handler never passes tenantId? Not possible. But repository methods don't.

Need test `createTenantAwareClient` stamps create: fake base row has tenantId. If no context, operation throws. Could add test:
```
await expect(service.create(...)).rejects.toThrow(ApiError) // if no context
```
But not required.

Need tenant resolution spec.

Implement stub tenant service:
```
function makeMiddleware(tenantService: { findTenantByHost: (host: string) => Promise<ResolvedTenant | null> }) {
  const context = new TenantContextService();
  return { context, middleware: new TenantResolutionMiddleware(context, tenantService as unknown as TenantService) };
}
const token = jwt.sign({ org: 'operator-a' }, 'test-secret', { algorithm: 'HS256' });
```
Need set `process.env.AUTH_TOKEN_SECRET = 'test-secret'` before. In test file `beforeEach`.

Tests:
- success: host app.operator-a.com, token org operator-a. next spy captures context:
```
const next = vi.fn(async () => { observedTenantId = context.getTenantId(); });
await middleware.use({ headers: { host: 'app.operator-a.com', authorization: `Bearer ${token}` } } as unknown as TenantRequest, {} as Response, next as NextFunction);
expect(next).toHaveBeenCalledTimes(1);
expect(observedTenantId).toBe('a');
```
But `next` is called inside context.run. Since `next` is async, `await next()` within run, observed. Good.

- mismatch: host A, token org B. next called with ApiError 403 tenant_mismatch.
```
const next = vi.fn();
await middleware.use(req, res, next);
expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'tenant_mismatch' }));
```
ApiError instance has code. `toHaveBeenCalledWith(expect.any(ApiError))` and inspect. Need ensure not called with undefined. Good.

- unknown host: next called with ApiError code unknown_host. Maybe status 400.
- invalid token: bad token -> invalid_token.
- missing authorization -> invalid_token.
- host missing -> invalid_host.

Need `Response` stub empty. `next` can be `vi.fn()`. For success, if next returns undefined, `await next()` OK.

Need `jwt.sign` in tests. Import jsonwebtoken.

Need tenant config spec. Could test `TenantConfigService` with TenantService stub? Or with fake GlobalPrisma? Simpler:
```
const tenantService = { getConfig: vi.fn(async (id) => ({ id, name: 'A', primaryColor: '#000', logoUrl: null, featureFlags: { beta: true } })) };
const service = new TenantConfigService(tenantService as any);
const result = await service.getConfig('a'); expect...
```
But that's not much. Could test `TenantService` with fake TenantRepository? Need test returns branding + flags. Could use fake repository:
```
const repository = { findById: async (id) => id === 'a' ? { id: 'a', slug: 'operator-a', host: 'app.operator-a.com', name: 'A', primaryColor: '#123', logoUrl: 'logo.png', featureFlags: { beta: true } } : null };
const service = new TenantService(repository as any);
const config = await service.getConfig('a'); expect...
await expect(service.getConfig('missing')).rejects...
```
This tests behavior. Good. Could include in `test/tenant-config.spec.ts`.

Need maybe test `TenantService.findTenantByHost` maps. But resolution spec covers.

Need ensure no DB needed in tests. However importing `Customer` type from `@prisma/client` may require generated client. In test, type-only import is erased. OK. But `TenantPrismaService` import in test may import `@prisma/client` for PrismaClient. If we import `TenantPrismaService` just for type, we can use `import type { TenantPrismaService }`. That erases. But `createTenantAwareClient` imports only context. `CustomerRepository` imports `TenantPrismaService` type only? In repository file, `import { TenantPrismaService }` used as type in constructor. If not value, could use `import type`. Let's use `import type { TenantPrismaService }` in repository to avoid loading PrismaClient in tests? But in production, Nest injects class, type import sufficient? For DI, provider is class in module, not repository. Repository constructor parameter type is used for DI metadata. With `import type`, TypeScript may not emit design:paramtypes for class? Nest DI relies on `design:paramtypes` metadata. If we use `import type`, the type is erased and metadata may become `Object`? Nest can't resolve. Important! For DI, constructor parameter type must be a value import (class) to emit metadata. So repository must `import { TenantPrismaService }` (not type) to emit design:paramtypes. That will load `@prisma/client`? It imports service file which imports PrismaClient. In tests, importing CustomerRepository will load TenantPrismaService and PrismaClient. PrismaClient constructor not called. But `@prisma/client` must be generated. OK.

Similarly controller/service imports classes. Tests can avoid Nest DI by direct instantiation but import graph loads PrismaClient. Acceptable.

Need fake base type `BasePrismaClient` exported from tenant-prisma.middleware. It doesn't import Prisma. Good.

Potential problem: `createTenantAwareClient` uses `context.getTenantId()` which throws ApiError if no context. In concurrent tests, context present.

Potential problem: `withTenantData` for `update` adds `tenantId` to data. In fake update, Object.assign(row, data) will set tenantId to current tenant. If tenant B attempts update A row, repository first findById returns null due to proxy read scoping, so returns null. If read scoping failed, updateMany data would change tenant? But update where includes tenant, so no.

Potential problem: `withTenantWhere` for `update` adds tenantId, but if `where` includes nested AND? Not.

Potential problem: `withTenantWhere` overrides any user-supplied tenantId. Good.

Potential problem: `findMany` read proxy sets `where: { tenantId }`, but if args.where has `id`? It merges. Good.

Potential problem: `findUniqueOrThrow` not used.

Need ensure `TenantPrismaService.client` only exposes scoped models. `CustomerRepository` uses `this.prisma.client.customer`. Good.

Need plan/order isolation? The proxy scopes them. No endpoints. Tests not. OK.

Could there be requirement "handlers never pass tenantId manually". Our controller/service/repo don't. Middleware stores tenant in context. Data layer gets tenantId from context. Good.

Need migration SQL with indexes and FKs. Need ensure Prisma schema and SQL match. Let's define schema:
```
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id           String   @id @default(uuid()) @map("id")
  slug         String   @unique
  host         String   @unique
  name         String
  primaryColor String   @map("primary_color")
  logoUrl      String?  @map("logo_url")
  featureFlags Json     @map("feature_flags")
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
  id         String  @id @default(uuid())
  tenantId   String  @map("tenant_id")
  name       String
  priceCents Int     @map("price_cents")
  isDefault  Boolean @default(false) @map("is_default")
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
  status     String
  totalCents Int      @map("total_cents")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@index([tenantId])
  @@index([customerId])
  @@index([planId])
  @@map("orders")
}
```
Need relations? If no relations, no FK. But structural isolation could be without FK. Maybe add relations to Tenant? If add relation, schema requires back-relation in Tenant. Could be:
```
model Tenant { customers Customer[]; plans Plan[]; orders Order[]; }
model Customer { tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade) }
...
```
But then if using Prisma `deleteMany` and FK, OK. Migration includes FKs. Should we add relations? It improves schema. But if repository uses `findMany` without include, no issue. Need ensure `Tenant` model includes back-relations. Let's add. But then `Tenant` type includes arrays. `TenantService` maps fields. OK.

Schema with relations:
```
model Tenant {
  ...
  customers Customer[]
  plans Plan[]
  orders Order[]
}
model Customer {
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ...
}
model Plan { tenant Tenant @relation(...) }
model Order { tenant Tenant @relation(...); customer Customer @relation(...); plan Plan @relation(...) }
```
Need back-relations in Customer: `orders Order[]`? If Order relation to Customer, Customer needs `orders Order[]`. Plan needs `orders Order[]`. Add.
```
model Customer { orders Order[]; }
model Plan { orders Order[]; }
model Order { customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade); plan Plan @relation(...); }
```
Migration FKs. Good.

But if using `deleteMany` on customer, orders cascade? If FK orders.customer_id ON DELETE CASCADE. OK.

Need `featureFlags Json` in migration JSONB. Good.

Need Prisma `@default(uuid())` generates client-side UUID? In Postgres, id TEXT. OK.

Need migration SQL for updated_at no default. For `@updatedAt`, Prisma updates in app. No default. OK.

Need indexes for unique composite: Prisma creates `customers_tenant_id_email_key`. Good.

Need migration timestamp: `20260101000000_init/migration.sql`. Path: `prisma/migrations/20260101000000_init/migration.sql`.

Need maybe `prisma/migrations/migration_lock.toml`? Prisma migration lock file: `provider = "postgresql"`. Every migration? Could include. It's part of migration setup. Should include `prisma/migrations/migration_lock.toml`.
```
provider = "postgresql"
```
Good.

Need package.json scripts. Since using Prisma, need `postinstall`: `prisma generate` maybe. Could include. But not required. Add:
```
"postinstall": "prisma generate"
```
Need env DATABASE_URL for generate? Prisma generate doesn't need DB. OK.

Need `vitest.config.ts` at root.

Need `.env.example`? Could include `DATABASE_URL=postgres://user:password@localhost:5432/db?schema=public` and `AUTH_TOKEN_SECRET=change-me`, `PORT=3000`. No secrets. But task says no secrets in repo; example placeholders OK. Is file called for? Maybe not. But configuration from env only; example helpful. Could include. But "Do not create a file it does not call for" might argue no. However solution needs env names; `.env.example` not necessary. Maybe skip to minimize.

Need README? No.

Potential issue with NestJS and ESM: `main.ts` import `reflect-metadata`. With NodeNext, relative imports `.js`. Need package `@nestjs/core` exports. OK.

Potential issue with `forRoutes({ path: '(.*)', method: RequestMethod.ALL })`: In Nest, route match path can be regex string? It uses path-to-regexp? `'(.*)'` may match. Simpler use `forRoutes('*')`. I think `*` works. Use `forRoutes('*')` to avoid. But if route with slash? Express wildcard `*` works. Use:
```
consumer.apply(TenantResolutionMiddleware).forRoutes('*');
```

Potential issue: Middleware applies to static? No.

Potential issue: `TenantResolutionMiddleware` uses `TenantService.findTenantByHost`, which queries global tenant table. If tenant not found before context, OK. But if host maps to tenant and token org matches, context set. If token invalid, no context.

Potential issue: `AUTH_TOKEN_SECRET` missing in tests? Set. In production, missing -> 500 internal. OK.

Potential issue: JWT `org` claim could be tenant id not slug. We assume slug. Could mark ASSUMPTION in middleware: `// ASSUMPTION: The token org claim is the tenant slug, not the tenant id.` at point it matters. Good.

Potential issue: Host could include port. We strip. Good.

Potential issue: `details` in errors always object. For `ApiError` default `{}`. For HttpException fallback, details `{}`. Good.

Potential issue: Error code for validation: `validation_error`. Good.

Potential issue: `tenant_mismatch` details includes org, host, tenant. OK.

Potential issue: `unknown_host` status 400. Could be 404? It's fine. Need code contract snake_case. Good.

Potential issue: Test `next` called with ApiError; `next` type NextFunction expects `(err?: any) => void`. Our middleware catches and `next(error)`. In test, `vi.fn()` accepts.

Potential issue: In success test, `next` spy is async and sets observedTenantId. But `next` called with no args. Need `next` as NextFunction. `vi.fn(async () => { ... })`. Type ok.

Potential issue: In resolution test, `middleware.use` is async and catches errors. If success and next returns undefined, OK.

Potential issue: `TenantContextService.run` returns `Promise<void>` from async next. In middleware `await this.tenantContext.run(tenant, async () => { await next(); });` Good.

Potential issue: AsyncLocalStorage in Node ESM: `node:async_hooks` import. OK.

Potential issue: Fake base `matches` with `where` includes `tenantId` and `id`. Works.

Potential issue: Fake base `findMany` ignores orderBy. OK.

Potential issue: Fake base `create` uses `crypto.randomUUID()`. Node 20 global crypto. OK.

Potential issue: Fake base row type: `Record<string, unknown>`. Service expects `Customer`. Cast. OK.

Potential issue: In customer isolation test, seed rows need `id`, `tenantId`, `email`, `name`, `createdAt`, `updatedAt`. Use `new Date()`.

Potential issue: `expect(rows.map(row => row.id)).toEqual(['customer-b-1'])`; if orderBy not, only one. Good.

Potential issue: For list, if proxy read adds tenant where, fake base filters. If no tenant where, would return all. Good.

Potential issue: For fetch by id A as B, repository `findById` uses `findFirst({ where: { id } })`. Proxy adds tenant B. Fake base where `{ id: 'customer-a-1', tenantId: 'b' }` no match. Service 404. Good.

Potential issue: For update A as B, repository `update` first `findById` null, returns null, service 404. Good.

Potential issue: For delete A as B, repository `deleteMany({ where: { id } })`; proxy adds tenant B. Fake base count 0, service 404. Good.

Potential issue: For concurrent, both create and list. Need ensure contexts don't cross. Since each `context.run` separate, yes.

Potential issue: In same email registers in both tenants, after create in A, create in B. Fake base enforces duplicate only same tenant. Good.

Potential issue: Need test that tenant B cannot update/delete tenant A's rows but can update own? Could include own update/delete to ensure behavior. Not required but good. Could add tests for B update B row succeeds. But task says tenant B cannot ...; testing positive not necessary but behavior. Add maybe.

Potential issue: Test coverage: Need not only happy path. We have negative.

Need maybe test `tenant-config` returns flags for resolved tenant. Could use `TenantService` with fake repository. Good.

Need maybe test `TenantConfigService` not much. Could combine in tenant-config spec.

Potential issue: `TenantService` uses `Tenant` type from @prisma/client. In test, we can pass fake object as any. OK.

Potential issue: `TenantConfigService` uses `TenantService` class. In test, instantiate with stub. Need import TenantService class? Type only? For direct new, need value? We can use `new TenantConfigService(stub as unknown as TenantService)`. Need import TenantService type or value? If only type, use `import type`. But to cast, type enough. `import { TenantConfigService } from '../src/tenant-config/tenant-config.service.js'; import type { TenantService } from '../src/tenant/tenant.service.js';` OK.

Potential issue: `TenantService` test needs instantiate `new TenantService(repository as unknown as TenantRepository)`. Need import TenantRepository type. Could use value? Type enough for cast. But `TenantService` constructor expects TenantRepository; type import. OK.

Potential issue: In test files, relative imports with `.js` from test to src? ESM NodeNext? Vitest can handle. Use `../src/...js`. Good.

Need ensure no missing imports.

Let's outline all files:
1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/migration_lock.toml
6. prisma/migrations/20260101000000_init/migration.sql
7. src/main.ts
8. src/app.module.ts
9. src/app/api-exception.filter.ts (or src/common/api-exception.filter.ts). Let's place `src/app/api-exception.filter.ts`.
10. src/common/api-error.ts
11. src/tenant/tenant.types.ts
12. src/tenant/tenant-context.service.ts
13. src/tenant/global-prisma.service.ts
14. src/tenant/tenant-prisma.middleware.ts
15. src/tenant/tenant-prisma.service.ts
16. src/tenant/tenant.repository.ts
17. src/tenant/tenant.service.ts
18. src/tenant/tenant-resolution.middleware.ts
19. src/tenant/tenant.module.ts
20. src/tenant-config/tenant-config.controller.ts
21. src/tenant-config/tenant-config.service.ts
22. src/tenant-config/tenant-config.module.ts
23. src/customer/customer.types.ts
24. src/customer/customer.controller.ts
25. src/customer/customer.service.ts
26. src/customer/customer.repository.ts
27. src/customer/customer.module.ts
28. test/customer-isolation.spec.ts
29. test/tenant-resolution.spec.ts
30. test/tenant-config.spec.ts

Need maybe `src/customer/customer.repository.ts` imports `TenantPrismaService` value for DI. Good.

Need maybe `src/tenant-config/tenant-config.controller.ts` imports TenantContextService value for DI. Good.

Need maybe `src/tenant/tenant-resolution.middleware.ts` imports TenantContextService/TenantService value for DI. Good.

Potential issue: `TenantPrismaService` is provided in TenantModule and exported. CustomerRepository constructor param type `TenantPrismaService`. Since CustomerModule imports TenantModule, resolves. Good.

Potential issue: `TenantConfigService` depends on `TenantService` exported. Good.

Potential issue: `TenantConfigController` depends on `TenantContextService` exported and `TenantConfigService`. Good.

Potential issue: `AppModule` middleware uses `TenantContextService` and `TenantService`. Since AppModule imports TenantModule, resolves. Good.

Potential issue: `GlobalPrismaService` extends PrismaClient. In tests, not instantiated. In production, onModuleInit connects. OK.

Potential issue: `TenantPrismaService` instantiates second PrismaClient. Could use same base? But OK. Two connections. Could be inefficient but acceptable. Could instead pass GlobalPrismaService to TenantPrismaService to avoid two clients. But then constructor depends on GlobalPrismaService. Could be better. Let's consider: `TenantPrismaService` constructor `(context: TenantContextService, base: GlobalPrismaService)` and uses `base` as BasePrismaClient. Then only one PrismaClient. But `GlobalPrismaService` extends PrismaClient, so proxy over it. However global prisma also has `$connect`. If TenantPrismaService also implements lifecycle maybe not. Could avoid. But if proxy wraps GlobalPrismaService model delegates, OK. But GlobalPrismaService also exposes tenant model. TenantPrismaService.client only scoped models. Good.

Let's modify:
```
@Injectable() export class TenantPrismaService {
  readonly client: TenantAwarePrismaClient;
  constructor(context: TenantContextService, base: GlobalPrismaService) {
    this.client = createTenantAwareClient(base as unknown as BasePrismaClient, context);
  }
}
```
No lifecycle. Module providers order: GlobalPrismaService before. This uses one client. But in tests, we can still direct create fake service. Good. DI metadata requires both types imported. Good.

Need `GlobalPrismaService` as class extends PrismaClient. `createTenantAwareClient` expects BasePrismaClient. Casting class instance OK. It will proxy `customer`, etc. Good.

Potential issue: Proxy target is a PrismaClient model delegate, which may be getter returning object each time? PrismaClient model properties are getters? If `Reflect.get` returns delegate object. OK.

Potential issue: If base is GlobalPrismaService, `base['customer']` returns delegate. Good.

Let's use single client.

`TenantPrismaService` no onModuleInit. OK.

`TenantModule` providers: [TenantContextService, GlobalPrismaService, TenantPrismaService, TenantRepository, TenantService]. Nest resolves dependencies. Good.

Need `TenantPrismaService` file:
```
import { Injectable } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { GlobalPrismaService } from './global-prisma.service.js';
import { createTenantAwareClient, TenantAwarePrismaClient, BasePrismaClient } from './tenant-prisma.middleware.js';

@Injectable()
export class TenantPrismaService {
  readonly client: TenantAwarePrismaClient;
  constructor(context: TenantContextService, base: GlobalPrismaService) {
    this.client = createTenantAwareClient(base as unknown as BasePrismaClient, context);
  }
}
```
Good.

Potential issue: In tests, `CustomerRepository` imports TenantPrismaService value, which imports GlobalPrismaService value, which imports PrismaClient. OK.

Need `BasePrismaClient` type in middleware maybe `Record<string, unknown>`. But `createTenantAwareClient` uses `base[model]`. If base is GlobalPrismaService, model properties are not in type but cast.

Need `TenantAwarePrismaClient` type: Could be `{ customer: ModelDelegate; plan: ModelDelegate; order: ModelDelegate; }` instead of Record. Good.
```
export interface TenantAwarePrismaClient {
  customer: ModelDelegate;
  plan: ModelDelegate;
  order: ModelDelegate;
}
```
But `ModelDelegate = Record<string, any>`? Use `Record<string, unknown>`. However calling methods as functions from unknown requires casts. OK.

In repository, `this.prisma.client.customer.findMany` returns unknown. Need cast. `ModelDelegate` record string unknown, property access `findMany` is unknown, can't call. In repository, `this.prisma.client.customer.findMany` TypeScript: `customer` is `ModelDelegate` = Record<string, unknown>. `findMany` is `unknown`, cannot call. Need better type for model delegate with method signatures or `any`. To keep simple, define `export type ModelDelegate = any;`? Strict allows explicit any. It may be acceptable. But code quality? Could use `Record<string, any>`. Then property is any, callable. Let's use `export type ModelDelegate = Record<string, any>;` and `TenantAwarePrismaClient = { customer: ModelDelegate; plan: ModelDelegate; order: ModelDelegate; }`. This avoids casts in repository. But repository still casts return to Promise<Customer>. OK.

In middleware, `base: BasePrismaClient = Record<string, any>`. Then `const target = base[model] as ModelDelegate;`. Good.

Need `any` in strict? Explicit any okay.

Potential issue: `TenantAwarePrismaClient` only typed models. In repository, `this.prisma.client.customer.findMany` any. OK.

Need `withTenantData` return any. OK.

Let's write middleware carefully:
```
const READ_OPERATIONS = new Set<string>([...]);
const TENANT_SCOPED_MODELS = ['customer', 'plan', 'order'] as const;
type ScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

export function createTenantAwareClient(base: BasePrismaClient, context: TenantContextService): TenantAwarePrismaClient {
  const client = {} as TenantAwarePrismaClient;
  for (const model of TENANT_SCOPED_MODELS) {
    const target = base[model] as ModelDelegate;
    client[model] = new Proxy(target, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        const operation = String(property);
        if (READ_OPERATIONS.has(operation)) {
          return async (args: Record<string, any> = {}) => {
            const tenantId = context.getTenantId();
            const call = target[operation] as (input: Record<string, any>) => any;
            return call({ ...args, where: withTenantWhere(args.where, tenantId) });
          };
        }
        if (operation === 'create') {
          return async (args: Record<string, any> = {}) => {
            const tenantId = context.getTenantId();
            const call = target[operation] as (input: Record<string, any>) => any;
            return call({ ...args, data: withTenantData(args.data, tenantId) });
          };
        }
        if (operation === 'createMany') { ... }
        if (operation === 'update') { ... where and data }
        if (operation === 'updateMany') { ... }
        if (operation === 'delete') { ... where }
        if (operation === 'deleteMany') { ... where }
        if (operation === 'upsert') { ... where, create, update }
        const fn = value as (...callArgs: any[]) => any;
        return fn.apply(target, callArgs); // Need get callArgs from proxy get? We don't have. Actually get returns a function wrapper. For unknown operations, we can return (...callArgs: any[]) => fn.apply(target, callArgs);
      }
    });
  }
  return client;
}
```
For unknown:
```
return (...callArgs: any[]) => (value as (...a: any[]) => any).apply(target, callArgs);
```
Good.

Need `withTenantWhere` if where is not object but e.g. string? Prisma where always object. But if string, maybe set `{ where: 'string'? }` no. Use object.
```
function withTenantWhere(where: any, tenantId: string): Record<string, any> {
  const existing = where && typeof where === 'object' && !Array.isArray(where) ? { ...where } : {};
  return { ...existing, tenantId };
}
```
For `delete` where may be `{ id }`. OK.

`withTenantData`:
```
function withTenantData(data: any, tenantId: string): any {
  if (Array.isArray(data)) return data.map(item => withTenantData(item, tenantId));
  if (data && typeof data === 'object') return { ...data, tenantId };
  return { tenantId };
}
```
This will override nested? Only top-level. Good.

Need for `upsert`: `create` and `update` may be undefined. `withTenantData(undefined)` returns `{ tenantId }`, which could be bad if create undefined? Upsert requires create and update? In Prisma upsert, both required. OK. If not, adding empty object maybe. Fine.

Need for `createMany`: `args.data` may be object or array. Prisma createMany data can be object or array? It accepts `data: T[] | T`. We can use withTenantData handles both. Good.

Potential issue: For `update`, `data` may be `undefined`? update requires data. withTenantData(undefined) -> `{ tenantId }`. OK.

Need for read `count`: args where maybe. Good.

Potential issue: `findUnique` args.where required; we add tenantId. If Prisma validation rejects extra field? Need ensure. Let's verify Prisma findUnique where can include extra non-unique fields. I think in Prisma, `findUnique` where only accepts unique fields, but you can use `findFirst` for non-unique. If adding `tenantId` to `findUnique({ where: { id } })` might be invalid because `tenantId` is not unique by itself. However if the model has composite unique `[tenantId, email]`, not id+tenant. The unique field is `id`. Does findUnique allow `where: { id: ..., tenantId: ... }`? I recall Prisma's `findUnique` where type is intersection of unique constraints? It may allow any field in where? Let's think. Prisma client types: `CustomerFindUniqueArgs['where'] = CustomerWhereUniqueInput`. `CustomerWhereUniqueInput` is union of `{ id?: string; email?: ...? }`? Actually for non-composite unique, it's `{ id?: string } & { email? }`? It might not include non-unique `tenantId`. If so, our proxy adding `tenantId` to `findUnique` could cause type/runtime error. We don't use `findUnique` in tenant-scoped repositories. We use `findFirst`, `update`, `deleteMany`. But proxy wraps `findUnique` if called. Could be problematic if someone calls. Requirement scopes every read. To be safe, for `findUnique`, we should not add tenantId directly to where if it would violate unique input? Alternative: For `findUnique`, convert to `findFirst` with same where + tenantId. That ensures tenant scoping and valid input. Similarly `findUniqueOrThrow` convert to `findFirstOrThrow`. Good idea.

Modify read operations: For `findUnique` and `findUniqueOrThrow`, use target[`findFirst`] or `findFirstOrThrow` with merged where. Because findFirst accepts non-unique where. This also avoids unique type issue. But if operation is findUnique and target findFirst exists. Prisma model delegate has findFirst. Good.
```
if (operation === 'findUnique') { return async args => { const tenantId = context.getTenantId(); const call = target['findFirst'] as ...; return call({ ...args, where: withTenantWhere(args.where, tenantId) }); } }
if (operation === 'findUniqueOrThrow') { ... target['findFirstOrThrow'] }
```
For other read ops, use same operation.

Need `findUniqueOrThrow` may not exist in older Prisma? It exists. If not, fallback findFirst? But OK.

Need for `findUnique` if args.where contains `tenantId`? We override.

This is robust.

Potential issue: For `findUnique` with `select`/`include`, we pass to findFirst, OK.

Need adjust READ_OPERATIONS: include findUnique? We can handle before generic.
```
if (operation === 'findUnique' || operation === 'findUniqueOrThrow') { ... }
else if (READ_OPERATIONS.has(operation)) { ... }
```
But READ_OPERATIONS includes findUnique. OK.

Need for `findFirstOrThrow` if not found throws Prisma P2025? Filter maps. Good.

Potential issue: For `update` where using `id` non-unique? `update` where type is unique input. Adding tenantId to where with id may have same problem. Prisma `update` where requires unique input. If `id` is unique, can it include tenantId? Same concern. To be safe, for `update`, `delete`, `upsert`, we can convert to `updateMany`/`deleteMany`? But `update` single needs return updated. Could use `updateMany` then `findFirst`? Or use `findFirst` to get id then `updateMany`. But repository already checks existing. For `update` where, if adding tenantId invalid, problem. We can instead for `update` use `updateMany` with where id+tenantId and then fetch? But method is `update` expected return row. Could implement proxy `update` as:
- tenantId = context
- first `const result = await target['updateMany']({ where: withTenantWhere(args.where, tenantId), data: withTenantData(args.data, tenantId) })`;
- if result.count === 0 return null? But Prisma `update` throws if not found. Changing behavior might break. But our repository uses `update` after existence check. Could use `updateMany` in repository instead to avoid where unique issue. But proxy `update` still could be called. Requirement structural. Better make proxy operations use `*Many` or `findFirst` for tenant scoping.

Let's design proxy to use safe methods:
- `findUnique` -> `findFirst`
- `findUniqueOrThrow` -> `findFirstOrThrow`
- `update` -> use `updateMany` and then `findFirst`? Need return row. Could:
```
return async (args = {}) => {
  const tenantId = context.getTenantId();
  const where = withTenantWhere(args.where, tenantId);
  const data = withTenantData(args.data, tenantId);
  const updated = await target['updateMany']({ where, data });
  if (updated.count === 0) {
    // mimic Prisma update not found error? Throw P2025? Could throw new Error? But repository checks existing. To maintain behavior, throw ApiError? Data layer shouldn't throw API? Could throw Fake? In production, Prisma update throws P2025. We can throw an Error with code P2025? Filter expects Prisma known error maybe. Simpler: return target['findFirst']({ where }) (null) and let repository handle? But caller of `update` expects row or null? Prisma doesn't return null. But our repository could use `updateMany` directly. To avoid inconsistent, we can define repository uses `updateMany` and not `update`. Then proxy `update` can be simple but maybe invalid. Yet if not used, OK. But structural isolation for any handler? Handlers only our repositories. We can choose repository methods to use safe operations.
```
Maybe better: In repository, use only `findFirst`, `findMany`, `create`, `createMany`, `updateMany`, `deleteMany`. Avoid `update`/`delete`/`findUnique`. Then proxy needs support `updateMany`/`deleteMany` safely. For update service, repository can do:
```
const result = await this.prisma.client.customer.updateMany({ where: { id }, data });
if (result.count === 0) return null;
return this.findById(id);
```
This avoids `update` where unique issue. Proxy for `updateMany` adds tenant to where (findFirst style where can include any fields? `updateMany` where type is `CustomerWhereInput`, accepts any fields, so id+tenant OK). Good. `deleteMany` where accepts any. `create` data. `findFirst`. Great.

So repository should use `updateMany`, not `update`. Let's adjust.

CustomerRepository:
```
async update(id, input) {
  const result = await this.prisma.client.customer.updateMany({ where: { id }, data: input }) as { count: number };
  if (result.count === 0) return null;
  return this.findById(id);
}
```
No need existing check. But if no existing, updateMany count 0. Good. If existing, update and fetch. Race conditions? OK.

`delete`: `deleteMany` as before.

This avoids `update`/`delete` proxy unique issue. But proxy still implements update/delete for completeness. Could implement them using updateMany/deleteMany? For `update`, we can implement as updateMany + findFirst, but return type maybe null. However if called, it's safe. But Prisma `update` expected throw. We can instead implement `update` using `target['update']` but where unique issue. Maybe skip? But if someone calls `update`, could fail. To be safe, implement `update` as:
```
return async (args = {}) => {
  const tenantId = context.getTenantId();
  const where = withTenantWhere(args.where, tenantId);
  const data = withTenantData(args.data, tenantId);
  const result = await target['updateMany']({ where, data });
  if (result.count === 0) {
    throw new Error('Record to update not found.'); // Could be P2025? 
  }
  const row = await target['findFirst']({ where });
  return row;
};
```
But thrown Error not Prisma. Filter generic 500. But repository not using. OK.
`delete` implement using deleteMany and return `{ count }`? Prisma delete returns row. Could:
```
const result = await target['deleteMany']({ where }); if (result.count === 0) throw Error; return target['findFirst']({ where })? But after delete row gone. Need return original? Could fetch before. Not used.
```
Simpler: implement update/delete as direct but with tenant where; if Prisma rejects, not our use. But structural? Hmm.

Maybe use Prisma's `update` with `where` containing only id and rely on extension adding tenant via `AND`? Not. Could use composite unique? If id is global unique, update by id already structurally isolates? If id unique globally, updating by id alone won't cross-tenant. But requirement says scope every read and stamp writes; update by id alone is safe for read? It would update tenant A row from B if B knows id, because id global. Need tenant in where. To avoid unique input issue, could add composite unique `[tenantId, id]`? But id already global unique. If we make `@@unique([tenantId, id])` and `@@id([tenantId, id])`? Then tenant-scoped composite primary key. But id generated globally, tenant+id unique. Then `update` where could use `{ id, tenantId }` as composite unique? If primary key is composite, where unique input accepts `{ tenantId, id }`. But model id as global UUID plus tenantId composite PK. Then fetch by id with tenant in where valid as unique? Yes if PK is [tenantId, id]. But then same UUID across tenants? UUID globally unique anyway. Could make composite id. But migration more complex. Not necessary if using updateMany.

Let's keep repository using Many operations. Proxy `update`/`delete` can be less robust but not used. However "scopes every read and stamps every write" implies all operations. We can implement `update`/`delete` using Many + safe, but behavior differs. Could throw custom `TenantIsolationError`? Hmm.

Maybe implement `update` as direct but transform where to `AND`? Prisma where for update unique may accept `AND`? If `CustomerWhereUniqueInput` might allow `AND: CustomerWhereInput[]`? I think unique inputs allow `AND` with where inputs? Not sure. Could do `where: { AND: [{ id }, { tenantId }] }`? But type maybe. Simpler not.

Given our codebase controls calls, OK.

Need fake base support `updateMany` and `deleteMany`, not `update`/`delete` if repository uses Many. But proxy might call `target['updateMany']` for `update` if implemented. Fake base can implement updateMany, deleteMany. Need also `findFirst`, `findMany`, `create`. Good.

Fake base can skip `update`/`delete` or implement. Implement update for completeness maybe.

Need adjust customer repository:
```
async update(id, input) {
  const result = await this.prisma.client.customer.updateMany({ where: { id }, data: input }) as { count: number };
  if (result.count === 0) return null;
  return this.findById(id);
}
```
But if input includes tenantId? Controller/service doesn't. Proxy adds. Good.

Need if update changes email to existing in tenant, Prisma P2002. Fake base updateMany doesn't enforce unique. Could ignore. Or filter maps in production. OK.

Need `delete` uses deleteMany.

Potential issue: `updateMany` returns `{ count }`. If row not found, count 0. Good.

Potential issue: `updateMany` with `where: { id }` and proxy adds `tenantId`. If no row, count 0.

Potential issue: In concurrent tests, update not.

Need fake base `updateMany` implementation. Good.

Need fake base `findFirst` and `findMany` with where. Good.

Need fake base `create` with tenantId. Good.

Need fake base maybe `update` not used but implement.

Now, tenant-aware proxy for read generic: For `findFirst`, `findMany`, `count`, etc, use same op. For `findUnique`, convert to `findFirst`. For `findUniqueOrThrow`, convert to `findFirstOrThrow`. Need target may not have `findFirstOrThrow` in fake? Could implement fake? Not used. In production, Prisma has. For safety, if target[alt] undefined, fallback to findFirst and throw? Not needed.

Proxy code detailed:
```
if (operation === 'findUnique') {
  return async (args: Record<string, any> = {}) => {
    const tenantId = context.getTenantId();
    const call = target['findFirst'] as (input: Record<string, any>) => any;
    return call({ ...args, where: withTenantWhere(args.where, tenantId) });
  };
}
if (operation === 'findUniqueOrThrow') {
  return async (args = {}) => {
    const tenantId = context.getTenantId();
    const call = target['findFirstOrThrow'] as (input: Record<string, any>) => any;
    return call({ ...args, where: withTenantWhere(args.where, tenantId) });
  };
}
if (READ_OPERATIONS.has(operation)) { ... }
```
But `READ_OPERATIONS` includes findUnique? We can leave but handled before.

For `update`:
```
if (operation === 'update') {
  return async (args = {}) => {
    const tenantId = context.getTenantId();
    const where = withTenantWhere(args.where, tenantId);
    const data = withTenantData(args.data, tenantId);
    const updated = await (target['updateMany'] as (input: any) => any)({ where, data });
    if (!updated || updated.count === 0) {
      throw new Error('Record to update not found.');
    }
    return (target['findFirst'] as (input: any) => any)({ where });
  };
}
```
But if update changes fields in where (e.g., update id?), where uses original id. OK. If where includes non-id, fetch after update with same where. OK.
Need error maybe should be Prisma-like. Could create a small class in middleware? Not. Could throw `new Error('P2025')`? Filter checks `err.code` starts P2. If we throw Error with code property? Could:
```
const error = new Error('Record to update not found.') as Error & { code: string };
error.code = 'P2025';
throw error;
```
Filter maps to 404. Good. Do that.
For `delete`:
```
const existing = await target['findFirst']({ where });
if (!existing) { throw P2025; }
const deleted = await target['deleteMany']({ where });
return existing; // Prisma delete returns deleted row
```
But if deleteMany count 0 due to race, return existing? Could check. Not used. OK.
For `upsert`:
Prisma upsert where unique issue. Could implement using `findFirst`, then `create` or `updateMany`? But upsert requires where unique. We can implement safe:
```
const tenantId = context.getTenantId();
const where = withTenantWhere(args.where, tenantId);
const existing = await target['findFirst']({ where });
if (existing) {
  await target['updateMany']({ where, data: withTenantData(args.update, tenantId) });
  return target['findFirst']({ where });
} else {
  return target['create']({ data: withTenantData(args.create, tenantId) });
}
```
But if where includes fields changed? OK. Not used.
This makes proxy safe.

For `update`, if where includes `id` and tenant, fetch after update. Good.

For `delete`, fetch before, deleteMany, return before. Good.

Need ensure these proxy methods use `target['findFirst']` which may itself not tenant scoped (raw). But we pass where with tenant. Good.

Now fake base needs `updateMany`, `deleteMany`, `findFirst`, `create`. Good.

Need if proxy `update` uses `target['updateMany']` and fake base updateMany filters where. Good.

Need if fake base `updateMany` with where `{ id, tenantId }` updates. Good.

Potential issue: Proxy `update` data adds tenantId. If fake base updateMany Object.assign, sets tenantId. OK.

Need if proxy `delete` uses `findFirst` then `deleteMany`. Fake base deleteMany removes. Good.

Now, repository uses `updateMany` directly, not proxy `update`. OK.

Need customer service update: repository returns null if count 0. Good.

Need customer service remove: repository deleteMany count. Good.

Potential issue: `CustomerRepository.update` calls `this.findById(id)` after updateMany. `findById` uses findFirst where `{ id }`, proxy adds tenant. Good.

Potential issue: If updateMany changed `id`? Controller doesn't allow id. OK.

Need maybe `CustomerInput` email/name. `CustomerUpdateInput` can include email/name. Proxy data adds tenant. OK.

Now, `TenantPrismaService.client` type with ModelDelegate any. In repository, `this.prisma.client.customer.updateMany` returns any. We cast.

Need `tenant-prisma.middleware.ts` error for P2025:
```
function prismaNotFound(): Error { const error = new Error('Record to update or delete not found.') as Error & { code: string }; error.code = 'P2025'; return error; }
```
Filter maps. Good.

Need filter mapping for errors with `code` starts P2 but not necessarily Prisma. It checks `err.code.startsWith('P2')`. Good. For P2025, details {}. For P2002, details target. Our proxy doesn't throw P2002. Fake base does. Filter not used in unit tests (we assert service ApiError). OK.

Need maybe `ApiError` details object. Good.

Now, `TenantConfigService` maybe should use `TenantContextService` directly? Controller gets tenantId. OK.

Need `tenant-config` endpoint path: `@Get('tenant-config')` at controller root. Since controller no prefix, route `/tenant-config`. Good.

Need customers controller prefix `customers`. Endpoints `/customers`, `/customers/:id`. Good.

Potential issue: Middleware for all routes including 404? If request path not matched, Nest may return 404 before controller but after middleware? It will still require tenant? Maybe OK. Not relevant.

Potential issue: `GET /tenant-config` requires host and token. Tests for tenant-config service don't test HTTP. OK.

Need maybe add `@UseGuards`? No.

Now, test details with imports.

`test/customer-isolation.spec.ts`:
```
import { describe, expect, it, beforeEach } from 'vitest';
import { TenantContextService } from '../src/tenant/tenant-context.service.js';
import { createTenantAwareClient } from '../src/tenant/tenant-prisma.middleware.js';
import type { BasePrismaClient, TenantAwarePrismaClient } from '../src/tenant/tenant-prisma.middleware.js';
import type { TenantPrismaService } from '../src/tenant/tenant-prisma.service.js';
import { CustomerRepository } from '../src/customer/customer.repository.js';
import { CustomerService } from '../src/customer/customer.service.js';
import { ApiError } from '../src/common/api-error.js';
import type { ResolvedTenant } from '../src/tenant/tenant.types.js';
```
Need `BasePrismaClient` type exported. Good.
Need `Customer` type? Not necessary.

Define tenants:
```
const tenantA: ResolvedTenant = { id: 'tenant-a', slug: 'operator-a', host: 'app.operator-a.com', name: 'Operator A', primaryColor: '#111111', logoUrl: null, featureFlags: { billing: true } };
const tenantB: ResolvedTenant = { id: 'tenant-b', slug: 'operator-b', host: 'app.operator-b.com', ... };
```

Fake base function inside. Need type `FakeRow = Record<string, any>`.
```
function createFakePrismaBase(rows: FakeRow[]): BasePrismaClient {
  const db: FakeRow[] = rows.map(row => ({ ...row }));
  const matches = (where: Record<string, any> = {}) => db.filter(row => Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      return Object.entries(value).every(([subKey, subValue]) => row[key] === subValue);
    }
    return row[key] === value;
  }));
  return {
    customer: {
      findMany: async (args: { where?: Record<string, any> } = {}) => matches(args.where ?? {}).map(row => ({ ...row })),
      findFirst: async (args: { where?: Record<string, any> } = {}) => { const found = matches(args.where ?? {}); return found.length > 0 ? { ...found[0] } : null; },
      create: async (args: { data: Record<string, any> } = { data: {} }) => { ... },
      updateMany: async (args: { where?: Record<string, any>; data?: Record<string, any> } = {}) => { ... },
      deleteMany: async (args: { where?: Record<string, any> } = {}) => { ... },
      update: async ... optional,
      delete: async ... optional
    }
  };
}
```
Need `BasePrismaClient` type is Record<string, any>. Returning object with customer OK.

Fake create:
```
create: async ({ data }) => {
  const row: FakeRow = {
    id: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  };
  if (row.tenantId === undefined) throw Object.assign(new Error('tenantId required'), { code: 'P2003' });
  if (typeof row.tenantId === 'string' && typeof row.email === 'string') {
    if (db.some(existing => existing.tenantId === row.tenantId && existing.email === row.email)) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['tenant_id', 'email'] } });
    }
  }
  db.push(row);
  return { ...row };
},
```
Need if data includes id? If seed uses existing ids. For create, if data.id present, use. Good: `id: data.id ?? crypto.randomUUID()`. But `data.id` maybe undefined. OK.

Fake updateMany:
```
const found = matches(args.where ?? {});
for (const row of found) Object.assign(row, args.data ?? {}, { updatedAt: new Date() });
return { count: found.length };
```
Fake deleteMany similar.

Need `Object.assign(row, args.data)` if args.data includes tenantId. OK.

Setup helper:
```
function buildService() {
  const context = new TenantContextService();
  const base = createFakePrismaBase([
    { id: 'customer-a-1', tenantId: 'tenant-a', email: 'a@example.com', name: 'A One', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
    { id: 'customer-b-1', tenantId: 'tenant-b', email: 'b@example.com', name: 'B One', createdAt: new Date('2026-01-02'), updatedAt: new Date('2026-01-02') },
  ]);
  const client = createTenantAwareClient(base, context);
  const repository = new CustomerRepository({ client } as unknown as TenantPrismaService);
  const service = new CustomerService(repository);
  return { context, service };
}
```
Need `createTenantAwareClient` expects BasePrismaClient; base typed. Good.

Tests:
```
describe('customer multi-tenant isolation', () => {
  it('tenant B lists only its own customers', async () => {
    const { context, service } = buildService();
    const rows = await context.run(tenantB, async () => service.list());
    expect(rows.map((row) => row.id)).toEqual(['customer-b-1']);
    expect(rows.every((row) => row.tenantId === tenantB.id)).toBe(true);
  });

  it('tenant B cannot fetch tenant A customer by id', async () => {
    const { context, service } = buildService();
    let caught: unknown;
    await context.run(tenantB, async () => {
      try { await service.getById('customer-a-1'); } catch (error) { caught = error; }
    });
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(404);
    expect((caught as ApiError).code).toBe('resource_not_found');
  });
  ...
});
```
Need `row.tenantId` type? Customer type includes. OK.

Update test:
```
const { context, service } = buildService();
let caught;
await context.run(tenantB, async () => { try { await service.update('customer-a-1', { name: 'Hacked' }); } catch (e) { caught = e; } });
expect 404.
// ensure A unchanged? Could use context.run(tenantA, list) and expect name.
const aRows = await context.run(tenantA, () => service.list());
expect(aRows.find(c => c.id === 'customer-a-1')?.name).toBe('A One');
```
Good.

Delete test similar.

Same email:
```
const { context, service } = buildService();
const createdA = await context.run(tenantA, () => service.create({ email: 'shared@example.com', name: 'A Shared' }));
const createdB = await context.run(tenantB, () => service.create({ email: 'shared@example.com', name: 'B Shared' }));
expect(createdA.tenantId).toBe(tenantA.id);
expect(createdB.tenantId).toBe(tenantB.id);
const aList = await context.run(tenantA, () => service.list());
const bList = await context.run(tenantB, () => service.list());
expect(aList.filter(c => c.email === 'shared@example.com').map(c => c.id)).toEqual([createdA.id]);
expect(bList.filter(c => c.email === 'shared@example.com').map(c => c.id)).toEqual([createdB.id]);
```
Need if `createdA` type Customer with id. Good.

Concurrent:
```
const { context, service } = buildService();
await Promise.all([
  context.run(tenantA, async () => {
    await service.create({ email: 'a-concurrent@example.com', name: 'A Concurrent' });
    const rows = await service.list();
    expect(rows.every(r => r.tenantId === tenantA.id)).toBe(true);
    expect(rows.some(r => r.email === 'b-concurrent@example.com')).toBe(false);
  }),
  context.run(tenantB, async () => {
    await service.create({ email: 'b-concurrent@example.com', name: 'B Concurrent' });
    const rows = await service.list();
    expect(rows.every(r => r.tenantId === tenantB.id)).toBe(true);
    expect(rows.some(r => r.email === 'a-concurrent@example.com')).toBe(false);
  }),
]);
```
Need if expectations inside concurrent fail, Promise.all rejects. Good.

Could add test for own update success:
```
const updated = await context.run(tenantB, () => service.update('customer-b-1', { name: 'B Updated' }));
expect(updated.id).toBe('customer-b-1'); expect(updated.name).toBe('B Updated');
```
OK.

Need if `context.run` returns Promise. In tests, `await context.run(tenantB, async () => {...})`. Good.

Potential issue: `context.run` type returns T | Promise<T>. If fn async, Promise. OK.

Potential issue: In fetch by id test, `context.run` catches error? We catch inside. Good.

Potential issue: In `expect(caught).toBeInstanceOf(ApiError)`, ApiError class imported. Good.

`test/tenant-resolution.spec.ts`:
```
import { describe, expect, it, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { TenantResolutionMiddleware } from '../src/tenant/tenant-resolution.middleware.js';
import { TenantContextService } from '../src/tenant/tenant-context.service.js';
import type { TenantService } from '../src/tenant/tenant.service.js';
import type { ResolvedTenant } from '../src/tenant/tenant.types.js';
import { ApiError } from '../src/common/api-error.js';
import type { Request, Response, NextFunction } from 'express';
import type { TenantRequest } from '../src/tenant/tenant-resolution.middleware.js';
```
Need set env in beforeAll or beforeEach:
```
beforeEach(() => { process.env.AUTH_TOKEN_SECRET = 'test-secret'; });
```
Token:
```
const operatorAToken = jwt.sign({ org: 'operator-a' }, 'test-secret', { algorithm: 'HS256' });
const operatorBToken = jwt.sign({ org: 'operator-b' }, 'test-secret', { algorithm: 'HS256' });
```
Tenants same.
Stub service:
```
function makeMiddleware() {
  const context = new TenantContextService();
  const tenantService = {
    findTenantByHost: async (host: string) => {
      if (host === 'app.operator-a.com') return tenantA;
      if (host === 'app.operator-b.com') return tenantB;
      return null;
    },
  };
  const middleware = new TenantResolutionMiddleware(context, tenantService as unknown as TenantService);
  return { context, middleware };
}
```
Request helper:
```
function makeRequest(host?: string, token?: string): TenantRequest {
  return {
    headers: {
      ...(host ? { host } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  } as unknown as TenantRequest;
}
```
Tests:
```
it('resolves tenant when host and org claim agree', async () => {
  const { context, middleware } = makeMiddleware();
  let observedId: string | null = null;
  const next = vi.fn(async () => { observedId = context.getTenantId(); });
  await middleware.use(makeRequest('app.operator-a.com', operatorAToken), {} as Response, next as NextFunction);
  expect(next).toHaveBeenCalledTimes(1);
  expect(observedId).toBe(tenantA.id);
});
```
Need `next` called with no error. `next.mock.calls[0][0]` undefined. Could expect `next.mock.calls[0]?.[0]` undefined. But if NextFunction called with no args, call length 0. OK.

Mismatch:
```
const next = vi.fn();
await middleware.use(makeRequest('app.operator-a.com', operatorBToken), {} as Response, next as NextFunction);
const error = next.mock.calls[0]?.[0];
expect(error).toBeInstanceOf(ApiError);
expect((error as ApiError).code).toBe('tenant_mismatch');
expect((error as ApiError).getStatus()).toBe(403);
```
Need ensure `next` called once. Good.

Unknown host:
```
host 'app.unknown.com', token A -> error unknown_host, status 400.
```
Invalid token:
```
token 'garbage' -> invalid_token 401.
```
Missing auth:
```
token undefined -> invalid_token.
```
Missing host:
```
host undefined, token A -> invalid_host 400.
```
Need order: middleware checks host first, then token. If missing host, invalid_host even if token valid. OK.

Potential issue: In success, `next` is async and sets observedId. But `middleware.use` catches errors. If `context.getTenantId()` throws, next would reject and catch? It won't. OK.

Potential issue: `vi.fn(async () => { ... })` returns Promise. `next` type expects void; OK.

Potential issue: `jwt.sign` algorithm option type: `algorithm: 'HS256'` accepted. Good.

`test/tenant-config.spec.ts`:
```
import { describe, expect, it } from 'vitest';
import { TenantService } from '../src/tenant/tenant.service.js';
import { TenantConfigService } from '../src/tenant-config/tenant-config.service.js';
import { ApiError } from '../src/common/api-error.js';
import type { TenantRepository } from '../src/tenant/tenant.repository.js';

const tenantRow = { id: 'tenant-a', slug: 'operator-a', host: 'app.operator-a.com', name: 'Operator A', primaryColor: '#0f766e', logoUrl: 'https://cdn.example.com/logo.png', featureFlags: { billing: true, beta: false } };

function makeTenantService() {
  const repository = {
    findById: async (id: string) => id === tenantRow.id ? tenantRow : null,
    findByHost: async (host: string) => host === tenantRow.host ? tenantRow : null,
  };
  return new TenantService(repository as unknown as TenantRepository);
}
```
Need `TenantService` also has `findTenantByHost`. Test config:
```
it('returns branding and feature flags for the tenant', async () => {
  const service = new TenantConfigService(makeTenantService());
  const config = await service.getConfig(tenantRow.id);
  expect(config).toEqual({ id: tenantRow.id, name: tenantRow.name, primaryColor: tenantRow.primaryColor, logoUrl: tenantRow.logoUrl, featureFlags: tenantRow.featureFlags });
});
it('throws resource_not_found for unknown tenant', async () => {
  const service = new TenantConfigService(makeTenantService());
  let caught;
  try { await service.getConfig('missing'); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(ApiError);
  expect((caught as ApiError).code).toBe('resource_not_found');
});
```
Could test `findTenantByHost`:
```
const host = await makeTenantService().findTenantByHost('app.operator-a.com'); expect(host?.slug).toBe('operator-a');
```
OK.

Potential issue: `TenantService.getConfig` uses `tenant.logoUrl` (string | null). Good.

Need if `featureFlags` JSON in Prisma is `Json` type; in fake object it's plain. OK.

Now, check imports and types for strict.

`src/tenant/tenant-prisma.middleware.ts` uses `TenantContextService` value. It imports from './tenant-context.service.js'. That file imports `ApiError`. OK.

`src/tenant/tenant-context.service.ts` throws ApiError. It imports `ResolvedTenant` type. OK.

`src/common/api-error.ts` extends HttpException. Need ensure constructor `super({ error: ... }, status);` works. HttpException constructor: `constructor(response: string | Record<string, any>, status?: number)`. If response object and status number. OK.

`ApiError` stores `errorMessage`. `getResponse` returns object. `getStatus` inherited returns status. But if we override `getStatus`? Not necessary. However `HttpException` may store response and status in private. `getStatus` works. Good.

Potential issue: `ApiError` as `HttpException` with object response. Nest filter can use. Good.

`src/app/api-exception.filter.ts` uses `Request`, `Response` from express. Need type import. With ESM, `import type { Request, Response } from 'express';`. Good.

Filter code:
```
import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../common/api-error.js';
import { HttpException } from '@nestjs/common';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'error' in body) {
        response.status(status).json(body);
        return;
      }
      response.status(status).json({ error: { code: statusCodeToCode(status), message: exception.message, details: {} } });
      return;
    }
    const prisma = exception as { code?: unknown; meta?: { target?: unknown } } | null;
    if (prisma && typeof prisma === 'object' && typeof prisma.code === 'string' && prisma.code.startsWith('P2')) {
      if (prisma.code === 'P2002') {
        response.status(409).json({ error: { code: 'duplicate_resource', message: 'A resource with these unique values already exists.', details: { target: (prisma.meta?.target as Record<string, unknown>) ?? {} } });
        return;
      }
      if (prisma.code === 'P2025') {
        response.status(404).json({ error: { code: 'resource_not_found', message: 'Resource not found.', details: {} });
        return;
      }
    }
    this.logger.error(`Unhandled error on ${request.method} ${request.url}`, (exception as Error)?.stack);
    response.status(500).json({ error: { code: 'internal_error', message: 'An unexpected error occurred.', details: {} } });
  }
}
function statusCodeToCode(status: number): string { ... }
```
Need `exception.message` for HttpException could be object? HttpException message string. OK.

Potential issue: If body is object with `error` but not our envelope? We pass. OK.

`statusCodeToCode` details. Good.

`src/main.ts`:
```
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './app/api-exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```
Good.

`src/app.module.ts`:
```
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TenantModule } from './tenant/tenant.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware.js';

@Module({ imports: [TenantModule, TenantConfigModule, CustomerModule] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes({ path: '(.*)', method: RequestMethod.ALL });
  }
}
```
Need if `path: '(.*)'` with method ALL. OK. Could use `'*'` simpler. Which is more reliable? Nest docs: `forRoutes({ path: '(.*)', method: RequestMethod.ALL })` common. Use that.

`src/tenant/tenant.types.ts` no imports.

`src/tenant/tenant-context.service.ts` as above. Need if `ApiError` thrown inside context for missing. OK.

`src/tenant/global-prisma.service.ts`:
```
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class GlobalPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });
  }
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
```
Need if `process.env.DATABASE_URL` undefined? Prisma may throw. Config from env. OK.

`src/tenant/tenant-prisma.middleware.ts` complete:
```
import { TenantContextService } from './tenant-context.service.js';

const TENANT_SCOPED_MODELS = ['customer', 'plan', 'order'] as const;
type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

export type ModelDelegate = Record<string, any>;
export type BasePrismaClient = Record<string, any>;
export interface TenantAwarePrismaClient {
  customer: ModelDelegate;
  plan: ModelDelegate;
  order: ModelDelegate;
}

const READ_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

export function createTenantAwareClient(base: BasePrismaClient, context: TenantContextService): TenantAwarePrismaClient {
  const client = {} as TenantAwarePrismaClient;
  for (const model of TENANT_SCOPED_MODELS) {
    const target = base[model] as ModelDelegate;
    client[model] = new Proxy(target, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        const operation = String(property);
        return wrapOperation(operation, target, context);
      },
    });
  }
  return client;
}

function wrapOperation(operation: string, target: ModelDelegate, context: TenantContextService) {
  if (operation === 'findUnique') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'findFirst', { ...args, where: withTenantWhere(args.where, tenantId) });
    };
  }
  if (operation === 'findUniqueOrThrow') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'findFirstOrThrow', { ...args, where: withTenantWhere(args.where, tenantId) });
    };
  }
  if (READ_OPERATIONS.has(operation)) {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, operation, { ...args, where: withTenantWhere(args.where, tenantId) });
    };
  }
  if (operation === 'create') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'create', { ...args, data: withTenantData(args.data, tenantId) });
    };
  }
  if (operation === 'createMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'createMany', { ...args, data: withTenantData(args.data, tenantId) });
    };
  }
  if (operation === 'update') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);
      const data = withTenantData(args.data, tenantId);
      const updated = await invoke(target, 'updateMany', { where, data }) as { count: number };
      if (!updated || updated.count === 0) throw prismaNotFound();
      return invoke(target, 'findFirst', { where });
    };
  }
  if (operation === 'updateMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'updateMany', { ...args, where: withTenantWhere(args.where, tenantId), data: withTenantData(args.data, tenantId) });
    };
  }
  if (operation === 'delete') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);
      const existing = await invoke(target, 'findFirst', { where });
      if (!existing) throw prismaNotFound();
      const deleted = await invoke(target, 'deleteMany', { where }) as { count: number };
      if (!deleted || deleted.count === 0) throw prismaNotFound();
      return existing;
    };
  }
  if (operation === 'deleteMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'deleteMany', { ...args, where: withTenantWhere(args.where, tenantId) });
    };
  }
  if (operation === 'upsert') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);
      const existing = await invoke(target, 'findFirst', { where });
      if (existing) {
        await invoke(target, 'updateMany', { where, data: withTenantData(args.update, tenantId) });
        return invoke(target, 'findFirst', { where });
      }
      return invoke(target, 'create', { data: withTenantData(args.create, tenantId) });
    };
  }
  return (...callArgs: any[]) => {
    const fn = (target[operation] ?? value?) // Need value not available. We can use target[operation] as any.
  };
}
```
In `wrapOperation`, for fallback we need original value. We have `target[operation]`. Use:
```
const fn = target[operation] as (...callArgs: any[]) => any;
return (...callArgs: any[]) => fn.apply(target, callArgs);
```
Good.

Need `invoke`:
```
function invoke(target: ModelDelegate, operation: string, args: Record<string, any>): Promise<any> {
  const fn = target[operation] as ((input: Record<string, any>) => any) | undefined;
  if (typeof fn !== 'function') throw new Error(`Prisma operation ${operation} is not available.`);
  return fn.call(target, args);
}
```
But some Prisma methods may be not async? They return promise. OK.

Need `prismaNotFound`:
```
function prismaNotFound(): Error {
  const error = new Error('Record to update or delete not found.') as Error & { code: string };
  error.code = 'P2025';
  return error;
}
```
Good.

Need `withTenantWhere` and `withTenantData` as above.

Potential issue: `wrapOperation` returns a new function for each property access. OK.

Potential issue: For `update`, if `target['updateMany']` not in fake? We implement.

Potential issue: For `upsert`, `args.update` may be undefined; withTenantData returns `{ tenantId }`, OK.

Potential issue: For `createMany`, `args.data` may be object; withTenantData returns object with tenantId if not array. Good.

Potential issue: `invoke` returns Promise<any>. If target method is sync (fake maybe async), OK.

Need type `TenantScopedModel` used? In loop, `model` is string union. `client[model] = ...` works because client interface keys. Good.

`src/tenant/tenant-prisma.service.ts` as above.

`src/tenant/tenant.repository.ts`:
```
import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from './global-prisma.service.js';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: GlobalPrismaService) {}
  findByHost(host: string) {
    return this.prisma.tenant.findUnique({ where: { host } });
  }
  findById(id: string) {
    return this.prisma.tenant.findUnique({ where: { id } });
  }
}
```
Since `GlobalPrismaService` extends PrismaClient, `tenant` property. OK.

`src/tenant/tenant.service.ts`:
```
import { Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { TenantRepository } from './tenant.repository.js';
import { ResolvedTenant, TenantConfigDto } from './tenant.types.js';
import { ApiError } from '../common/api-error.js';

@Injectable()
export class TenantService {
  constructor(private readonly repository: TenantRepository) {}
  async findTenantByHost(host: string): Promise<ResolvedTenant | null> {
    const tenant = await this.repository.findByHost(host);
    return tenant ? this.toResolved(tenant) : null;
  }
  async getConfig(tenantId: string): Promise<TenantConfigDto> {
    const tenant = await this.repository.findById(tenantId);
    if (!tenant) throw new ApiError(404, 'resource_not_found', 'Tenant not found.', { tenantId });
    return {
      id: tenant.id,
      name: tenant.name,
      primaryColor: tenant.primaryColor,
      logoUrl: tenant.logoUrl,
      featureFlags: toFeatureFlags(tenant.featureFlags),
    };
  }
  private toResolved(tenant: Tenant): ResolvedTenant { ... }
}
function toFeatureFlags(value: unknown): Record<string, boolean> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, boolean>;
  return {};
}
```
Need `Tenant` type import. If generated client not available in type check? In solution, yes. But in tests, type import erased? Actually `import { Tenant } from '@prisma/client'` is value? Tenant is type, but imported as value? In TS, if only used as type, with `importsNotUsedAsValues` default, it may be elided. OK. But `@prisma/client` may export type only. Fine.

`src/tenant/tenant-resolution.middleware.ts` as above. Need import `jwt` default. With ESM, `jsonwebtoken` has CJS; `import jwt from 'jsonwebtoken'` with esModuleInterop. OK.

Need `TenantRequest` extends Request. In middleware, `req: TenantRequest`. In tests cast.

Potential issue: `req.headers.host` type `string | string[] | undefined`. normalize handles.

`normalizeHost`:
```
function normalizeHost(value: string | string[] | undefined): string {
  if (!value) return '';
  const raw = Array.isArray(value) ? value[0] : value;
  const host = raw.trim().toLowerCase();
  const portIndex = host.indexOf(':');
  return portIndex === -1 ? host : host.slice(0, portIndex);
}
```
Good.

`verifyOrgToken` assumption comment:
```
// ASSUMPTION: The token org claim is the tenant slug, not the tenant id.
```
Place before compare or in function. Good.

Need if `jwt.verify` options `algorithms: ['HS256']`. OK.

`src/tenant/tenant.module.ts` as above.

`src/tenant-config/tenant-config.controller.ts`: Need route path. Since endpoint explicit singular, use `@Get('tenant-config')`. Controller no prefix. Good.
```
@Controller()
export class TenantConfigController {
  constructor(private readonly tenantContext: TenantContextService, private readonly service: TenantConfigService) {}
  @Get('tenant-config')
  async getTenantConfig(): Promise<TenantConfigDto> {
    const tenantId = this.tenantContext.getTenantId();
    return this.service.getConfig(tenantId);
  }
}
```
Need import TenantConfigDto type. Good.

`src/tenant-config/tenant-config.service.ts` as above.

`src/tenant-config/tenant-config.module.ts` as above.

`src/customer/customer.types.ts`:
```
export interface CustomerInput { email: string; name: string; }
export interface CustomerUpdateInput { email?: string; name?: string; }
```

`src/customer/customer.controller.ts` as above. Need import `CustomerInput`? It constructs. OK.
Validation: For update, if body.email provided but empty, requireString throws. If body.name provided empty, throws. If body has unknown fields, ignore. OK.
`requireString` returns trimmed. For email lower:
```
const email = requireString(body?.email, 'email').toLowerCase();
```
Validate email after lower. Good.
For update email, lower.
`details` for validation error: `{ field }` or `{ email }`. OK.

`src/customer/customer.service.ts`:
```
import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { CustomerRepository } from './customer.repository.js';
import { CustomerInput, CustomerUpdateInput } from './customer.types.js';
import { ApiError } from '../common/api-error.js';
```
Need `Customer` type only. Use `import type`. Good.
Methods as above. For `remove`, returns `{ id: string }`.

`src/customer/customer.repository.ts`:
```
import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import { CustomerInput, CustomerUpdateInput } from './customer.types.js';

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: TenantPrismaService) {}
  findMany(): Promise<Customer[]> {
    return this.prisma.client.customer.findMany({ orderBy: { createdAt: 'asc' } }) as Promise<Customer[]>;
  }
  findById(id: string): Promise<Customer | null> {
    return this.prisma.client.customer.findFirst({ where: { id } }) as Promise<Customer | null>;
  }
  create(input: CustomerInput): Promise<Customer> {
    return this.prisma.client.customer.create({ data: input }) as Promise<Customer>;
  }
  async update(id: string, input: CustomerUpdateInput): Promise<Customer | null> {
    const result = await this.prisma.client.customer.updateMany({ where: { id }, data: input }) as { count: number };
    if (result.count === 0) return null;
    return this.findById(id);
  }
  async delete(id: string): Promise<{ id: string } | null> {
    const result = await this.prisma.client.customer.deleteMany({ where: { id } }) as { count: number };
    if (result.count === 0) return null;
    return { id };
  }
}
```
Need `orderBy` maybe `createdAt: 'asc'`. OK.
Potential issue: `input` may contain `email` and `name`. Proxy adds tenantId. Good.

`src/customer/customer.module.ts` as above.

Now, check if any file missing for Nest DI: `TenantResolutionMiddleware` not in providers but used in configure. Nest can instantiate middleware class if dependencies are providers in AppModule or imported. It is not exported from TenantModule? It doesn't need. It depends on TenantContextService and TenantService, both exported. Good.

Potential issue: `TenantModule` exports `TenantService` but not `TenantRepository`. OK.

Potential issue: `TenantConfigModule` imports TenantModule, but `TenantConfigController` depends on `TenantContextService` which is exported. Good.

Potential issue: `CustomerModule` imports TenantModule, `CustomerRepository` depends on `TenantPrismaService` exported. Good.

Potential issue: `AppModule` imports TenantModule, but middleware dependencies resolved. Good.

Potential issue: `GlobalPrismaService` is exported but not used by feature? It is used by TenantRepository internally. Export not necessary but OK. `TenantPrismaService` depends on GlobalPrismaService; if TenantModule exports both, OK.

Potential issue: If `TenantModule` not @Global, `TenantConfigModule` and `CustomerModule` import. Good.

Potential issue: `AppModule` also imports TenantModule. OK.

Now, migration SQL. Need ensure matches schema with relations. Let's write full.
```
-- CreateEnum? no.
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primary_color" TEXT NOT NULL,
    "logo_url" TEXT,
    "feature_flags" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE UNIQUE INDEX "tenants_host_key" ON "tenants"("host");
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");
CREATE UNIQUE INDEX "plans_tenant_id_name_key" ON "plans"("tenant_id", "name");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");
CREATE INDEX "plans_tenant_id_idx" ON "plans"("tenant_id");
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");
CREATE INDEX "orders_plan_id_idx" ON "orders"("plan_id");

ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
Need if `orders` references customers which are tenant-scoped but FK doesn't enforce same tenant. Could add unique constraint? Not. Structural isolation via queries. OK.

Need `migration_lock.toml`:
```
provider = "postgresql"
```

Now, check schema with relations. Need back-relations names. If Order relation to Customer and Plan, and Customer/Plan have `orders Order[]`. Good.
```
model Tenant {
  ...
  customers Customer[]
  plans Plan[]
  orders Order[]
}

model Customer {
  ...
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orders Order[]
}

model Plan {
  ...
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orders Order[]
}

model Order {
  ...
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  plan Plan @relation(fields: [planId], references: [id], onDelete: Cascade)
}
```
Need relation names? Since multiple relations between Order and Tenant? Only one. Customer to Tenant one. OK.

Potential issue: Prisma requires field names for list relations? Not if one. OK.

Now, package.json details. Need versions. Use ^10 for Nest, ^5 for Prisma. But Prisma 5 requires Node 18. OK. Use `@prisma/client` version 5.22.0? Use caret. Need `prisma` dev same. Use `jsonwebtoken` ^9.0.2. `vitest` ^1.6.0. `typescript` ^5.5.4. `@types/node` ^20.14.0. `@nestjs/testing` ^10.3.0. `@types/express` ^4.17.21. `@types/jsonwebtoken` ^9.0.6. `tsx`? Not needed. But start script `node dist/src/main.js` after build. Build with tsc. Need ensure output works with ESM. `tsc` emits. OK.

Need package.json `engines`? optional.

Scripts:
```
"build": "tsc -p tsconfig.json",
"start": "node dist/src/main.js",
"test": "vitest run",
"test:watch": "vitest",
"prisma:generate": "prisma generate",
"prisma:migrate": "prisma migrate deploy",
"postinstall": "prisma generate"
```
Need if `postinstall` runs before prisma dev dependency? pnpm runs after deps. OK.

Potential issue: `prisma generate` requires schema and env? It may require `DATABASE_URL`? No. But Prisma 5 may require `DATABASE_URL` for generate? It doesn't. OK.

Potential issue: `postinstall` in tests may fail if no network? In solution, assumed.

Need `vitest.config.ts`:
```
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
```
Good.

Potential issue: Vitest with ESM and TS decorators? It uses esbuild, supports decorators? Need `esbuild` option? For NestJS tests, we don't use TestingModule but classes with decorators? We import services with decorators. Vitest/esbuild may need `experimentalDecorators`? esbuild supports? I think Vitest can handle TS decorators with `esbuild: { target: 'es2022' }`? Maybe not. NestJS unit tests often work with Vitest? Need configure? Could add in vitest.config:
```
export default defineConfig({
  esbuild: {
    target: 'es2022',
  },
  test: { ... },
});
```
But decorators? esbuild supports experimental decorators if tsconfig has? It reads tsconfig? I think esbuild honors `experimentalDecorators`. OK.

Potential issue: `emitDecoratorMetadata` is not supported by esbuild. Vitest/esbuild does not support `emitDecoratorMetadata`. This is a known issue: NestJS DI metadata may be missing in Vitest if using esbuild. But our tests instantiate directly, not relying on DI metadata. However imported classes with decorators may need metadata? Not for direct instantiation. But Nest decorators may not need metadata. However if esbuild doesn't emit decorator metadata, `@Injectable` still works? It may need design:paramtypes for Nest DI, but tests not use TestingModule. For production build with tsc, metadata emitted. For Vitest, direct new. OK. But importing Nest modules? We don't. Good.

But some files import `@nestjs/common` which uses decorators? OK.

Potential issue: `vitest` cannot resolve `.js` to `.ts` by default? Vite resolves TS paths? It should with plugin? In Vite, importing `./foo.js` when file is `foo.ts` works if `resolve.extensions`? I think Vite supports TypeScript ESM style: `.js` resolves to `.ts`? Vite has `resolve.extensions` and `resolve.alias`? In Vite, for TS files, importing `./foo.js` is supported because it tries `.ts` for `.js`? I believe yes (Vite handles ESM TS). If not, could use extensionless imports. But NodeNext TS requires `.js`. For Vitest, maybe OK. To be safe? The format parser doesn't run. Need defensible. Use `.js` due ESM.

Potential issue: `tsconfig` includes test files with NodeNext. `import { describe } from 'vitest'` OK.

Potential issue: In test, `import jwt from 'jsonwebtoken'` CJS default. Vitest handles.

Potential issue: In `tenant-resolution.middleware.ts`, `jwt.verify` can throw JsonWebTokenError. We catch all. Good.

Potential issue: `AUTH_TOKEN_SECRET` missing in production. Filter? Middleware throws ApiError 500 internal. OK.

Potential issue: `TenantContextService.run` if fn throws, error propagates. Middleware catches and next(err). Good.

Potential issue: If `next` throws synchronously, our `await next()` catches. Good.

Potential issue: If `next` is called with error by downstream, our middleware may also catch? In Express, if route handler error, it calls next(err) after our `await next()`? Since `next()` may not return promise, our await resolves before error. Then error propagates through Nest exception filter, not our catch. OK.

Potential issue: ALS context for controller: If `next()` returns void and run callback ends, will context still be present in controller? As discussed, likely yes if controller invoked within next. But to be more robust, could set context in AsyncLocalStorage and also attach to req. But data layer needs ALS. If concern, maybe use Express request property and a custom Prisma middleware that reads from req? But we use ALS. NestJS may preserve. In tests, we directly run.

Could also use `res.on('finish')`? No.

Potential issue: `AsyncLocalStorage.run` with `next` that doesn't return promise: `run` returns after `next()` returns, but async handlers started within retain context due ALS. OK.

Potential issue: `TenantPrismaService.client` proxy methods call `context.getTenantId()` at operation time, not at creation. Good.

Potential issue: Concurrent requests in production with Express and ALS: If two requests handled concurrently, each middleware `run` sets context. AsyncLocalStorage isolates. Good.

Potential issue: `GlobalPrismaService` is a singleton PrismaClient. Using proxy per request? The proxy methods read context at call. Good.

Potential issue: If a request handler calls `this.prisma.client.customer.findMany()` inside a promise that was created before context? It will read context when function executes. If promise chain started in context, OK. If not, missing. But middleware wraps.

Potential issue: Error envelope `details` for P2002 uses `meta.target` maybe array. It's object? `details` must be object, never null. We set `{ target: ... }`. If target undefined, `{}`. Good.

Potential issue: `ApiError` `details` could be non-object if passed. We default. OK.

Potential issue: In controller validation, details `{ field }` object. Good.

Potential issue: In tenant_mismatch details includes `org`, `host`, `tenant`. OK.

Potential issue: Code for `unknown_host` maybe should be 404 `resource_not_found`? But host unknown is input. 400. OK.

Potential issue: Code for `invalid_host` 400. OK.

Potential issue: Tests expect status via `getStatus`. ApiError extends HttpException; `getStatus` returns number. Good.

Potential issue: In `ApiError`, `getResponse` returns `{ error: { code, message, details } }`. `details` may be mutated? OK.

Potential issue: `HttpException` may serialize response differently? We override.

Potential issue: `ApiExceptionFilter` catches `HttpException` and if body has `error`, passes. For ApiError, body has error. But we handle before. OK.

Potential issue: For `ApiError` thrown in middleware, `next(error)` passes to Nest exception filter? In Express, if middleware calls next(err), Nest's exception filter catches? Yes.

Potential issue: `main.ts` uses `app.useGlobalFilters(new ApiExceptionFilter())`. Good.

Potential issue: `app.enableShutdownHooks()` not. OK.

Potential issue: `prisma/schema.prisma` `featureFlags Json` requires Postgres JSONB. Good.

Potential issue: `prisma/schema.prisma` `logoUrl String?` maps nullable. Good.

Potential issue: `updatedAt` in Prisma no default. Migration no default. OK.

Potential issue: `createdAt` default now. Migration default CURRENT_TIMESTAMP. OK.

Potential issue: `uuid()` default in Prisma client-side; DB id TEXT no default. OK.

Potential issue: In migration, if using `uuid()` default in Prisma, no DB default. OK.

Potential issue: In schema, `@@unique([tenantId, email])` with relation tenant. OK.

Potential issue: In schema, `@@unique([tenantId, name])` for plans. OK.

Potential issue: In schema, `Order` has no tenant-scoped uniqueness except id global. Task says schema for customers/plans/orders with tenant-scoped uniqueness. It might imply each model has tenant-scoped unique fields. Orders maybe `customerId`/`planId`? Could add a unique order number per tenant to satisfy. Let's consider adding `orderNumber String` to Order and `@@unique([tenantId, orderNumber])`. But then migration and schema. Do we need? "tenant-scoped uniqueness (same customer email may exist in two tenants)" example for customers. For plans, same name may exist. For orders, maybe no natural unique. But to be safe, add `orderNumber`? It adds field not requested. Could be overkill. But "schema for customers/plans/orders with tenant-scoped uniqueness" could mean uniqueness constraints are tenant-scoped where applicable. Orders can have tenant-scoped unique external id? Maybe not.

Could add `reference` string unique per tenant? Not necessary. But if they expect `@@unique([tenantId, ...])` for each, we have customers and plans. Orders no. Could add `orderNumber` as optional? Let's think. An order often has unique number per tenant. Adding it demonstrates. But API doesn't use. More schema complexity. The task doesn't ask endpoint for orders. It says fully isolated data (customers, plans, orders). Tenant-scoped uniqueness maybe only customer email example. I think OK.

If we add `orderNumber String` and `@@unique([tenantId, orderNumber])`, migration. But then order creation requires. No endpoints. Not harmful. But "Do exactly" maybe avoid. Keep no orderNumber.

Potential issue: `GlobalPrismaService` extends PrismaClient and has `tenant` property. In `TenantRepository`, return type of `findUnique` is `Tenant | null`. Good.

Potential issue: `TenantService.toResolved` uses `tenant.logoUrl` which is `string | null`. Good.

Potential issue: In `tenant-resolution.middleware.ts`, `TenantService.findTenantByHost` returns ResolvedTenant. It queries by host. If host not found but token valid, error. Good.

Potential issue: If token org claim matches tenant.id instead of slug, our middleware rejects. Assumption marked. Could alternatively accept both slug and id to be more flexible. Maybe better to accept if `org === tenant.slug || org === tenant.id`. The task says org claim, tenant could be identified by org id. If we accept both, fewer mismatches. But "both must agree" - if token org is id and host maps to tenant, they agree. We can define org claim can be slug or id. But then a token with org id of A and host B mismatch. Accepting both is safer. However tests use slug. Could implement:
```
const tokenOrgMatches = org === tenant.slug || org === tenant.id;
if (!tokenOrgMatches) throw mismatch.
```
Assumption comment: org claim may be tenant slug or id. This is more defensible. Let's do that. Then if token org is slug in tests, OK. If id, OK.

Need in details maybe `org`. Good.

Potential issue: If tenant.id is UUID and slug is operator-a. OK.

Potential issue: In `TenantService.findTenantByHost`, returns tenant.id. Good.

Now, need ensure no file duplicates path. We'll output each once.

Need final answer only headings and fenced blocks. No prose. Ensure each heading exactly path. Use level-3 `### path`. Fenced block language maybe `ts`, `prisma`, `sql`, `json`, `toml`. The format says one fenced block holding only file content. Language tag optional? It shows ```ts. Use language tags. OK.

Need ensure no trailing prose. Start with first heading.

Let's verify code for each file.

### package.json
```
{
  "name": "multi-tenant-white-label",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@prisma/client": "^5.14.0",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.0",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.0",
    "prisma": "^5.14.0",
    "typescript": "^5.5.4",
    "vitest": "^1.6.0"
  }
}
```
Need `@types/node` version. OK.

### tsconfig.json
```
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true,
    "declaration": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```
Need include vitest.config? It imports vitest/config. OK. But `types: ["node"]` may exclude vitest types? Test imports explicit. OK.

Potential issue: `rootDir: "."` includes `vitest.config.ts` and test, output dist. OK.

### vitest.config.ts
```
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
```
OK.

### prisma/schema.prisma
Need no comments? OK.
```
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
  host         String   @unique
  name         String
  primaryColor String   @map("primary_color")
  logoUrl      String?  @map("logo_url")
  featureFlags Json     @map("feature_flags")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  customers Customer[]
  plans     Plan[]
  orders    Order[]

  @@map("tenants")
}

model Customer {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  email     String
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orders Order[]

  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("customers")
}

model Plan {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  name       String
  priceCents Int      @map("price_cents")
  isDefault  Boolean  @default(false) @map("is_default")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  tenant Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orders Order[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("plans")
}

model Order {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  customerId String   @map("customer_id")
  planId     String   @map("plan_id")
  status     String
  totalCents Int      @map("total_cents")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  plan     Plan     @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([customerId])
  @@index([planId])
  @@map("orders")
}
```
Need `Order` relation to Tenant and Customer/Plan. OK.

### prisma/migrations/migration_lock.toml
```
provider = "postgresql"
```

### prisma/migrations/20260101000000_init/migration.sql
As above. Need maybe order tables before FKs. OK.

### src/main.ts
OK.

### src/app.module.ts
OK.

### src/app/api-exception.filter.ts
Need import `HttpException` from @nestjs/common along with others. Code:
```
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../common/api-error.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (body !== null && typeof body === 'object' && 'error' in body) {
        response.status(status).json(body);
        return;
      }
      response.status(status).json({
        error: { code: statusCodeToCode(status), message: exception.message, details: {} },
      });
      return;
    }

    const known = exception as { code?: unknown; meta?: { target?: unknown } } | null;
    if (known && typeof known === 'object' && typeof known.code === 'string' && known.code.startsWith('P2')) {
      if (known.code === 'P2002') {
        response.status(409).json({
          error: {
            code: 'duplicate_resource',
            message: 'A resource with these unique values already exists.',
            details: { target: (known.meta?.target as Record<string, unknown>) ?? {} },
          },
        });
        return;
      }
      if (known.code === 'P2025') {
        response.status(404).json({
          error: { code: 'resource_not_found', message: 'Resource not found.', details: {} },
        });
        return;
      }
    }

    this.logger.error(`Unhandled error on ${request.method} ${request.url}`, (exception as Error)?.stack);
    response.status(500).json({
      error: { code: 'internal_error', message: 'An unexpected error occurred.', details: {} },
    });
  }
}

function statusCodeToCode(status: number): string {
  if (status === 400) return 'validation_error';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'resource_not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'unprocessable_entity';
  if (status >= 500) return 'internal_error';
  return 'http_error';
}
```
Need if body is object but error details null? Not. OK.

### src/common/api-error.ts
```
import { HttpException } from '@nestjs/common';

export class ApiError extends HttpException {
  readonly code: string;
  readonly details: Record<string, unknown>;
  private readonly errorMessage: string;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.errorMessage = message;
    this.details = details;
  }

  getResponse(): { error: { code: string; message: string; details: Record<string, unknown> } } {
    return { error: { code: this.code, message: this.errorMessage, details: this.details } };
  }
}
```
Need `details` never null. OK.

Potential issue: `HttpException` constructor may set `message` from response object? Not. We store.

### src/tenant/tenant.types.ts
OK.

### src/tenant/tenant-context.service.ts
```
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError } from '../common/api-error.js';
import { ResolvedTenant } from './tenant.types.js';

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<ResolvedTenant>();

  run<T>(tenant: ResolvedTenant, fn: () => T | Promise<T>): T | Promise<T> {
    return this.storage.run(tenant, fn);
  }

  getTenant(): ResolvedTenant {
    const tenant = this.storage.getStore();
    if (!tenant) {
      throw new ApiError(500, 'internal_error', 'Tenant context is missing.', {});
    }
    return tenant;
  }

  getTenantId(): string {
    return this.getTenant().id;
  }
}
```
OK.

### src/tenant/global-prisma.service.ts
OK.

### src/tenant/tenant-prisma.middleware.ts
Let's write complete carefully.
```
import { TenantContextService } from './tenant-context.service.js';

const TENANT_SCOPED_MODELS = ['customer', 'plan', 'order'] as const;
type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

export type ModelDelegate = Record<string, any>;
export type BasePrismaClient = Record<string, any>;

export interface TenantAwarePrismaClient {
  customer: ModelDelegate;
  plan: ModelDelegate;
  order: ModelDelegate;
}

const READ_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

export function createTenantAwareClient(base: BasePrismaClient, context: TenantContextService): TenantAwarePrismaClient {
  const client = {} as TenantAwarePrismaClient;

  for (const model of TENANT_SCOPED_MODELS) {
    const target = base[model] as ModelDelegate;
    client[model] = new Proxy(target, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') {
          return value;
        }
        return wrapOperation(String(property), target, context);
      },
    });
  }

  return client;
}

function wrapOperation(operation: string, target: ModelDelegate, context: TenantContextService) {
  if (operation === 'findUnique') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'findFirst', { ...args, where: withTenantWhere(args.where, tenantId) });
    };
  }

  if (operation === 'findUniqueOrThrow') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'findFirstOrThrow', { ...args, where: withTenantWhere(args.where, tenantId) });
    };
  }

  if (READ_OPERATIONS.has(operation)) {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, operation, { ...args, where: withTenantWhere(args.where, tenantId) });
    };
  }

  if (operation === 'create') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'create', { ...args, data: withTenantData(args.data, tenantId) });
    };
  }

  if (operation === 'createMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'createMany', { ...args, data: withTenantData(args.data, tenantId) });
    };
  }

  if (operation === 'update') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);
      const data = withTenantData(args.data, tenantId);
      const updated = await invoke(target, 'updateMany', { where, data }) as { count: number };
      if (!updated || updated.count === 0) {
        throw prismaNotFound();
      }
      return invoke(target, 'findFirst', { where });
    };
  }

  if (operation === 'updateMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'updateMany', {
        ...args,
        where: withTenantWhere(args.where, tenantId),
        data: withTenantData(args.data, tenantId),
      });
    };
  }

  if (operation === 'delete') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);
      const existing = await invoke(target, 'findFirst', { where });
      if (!existing) {
        throw prismaNotFound();
      }
      const deleted = await invoke(target, 'deleteMany', { where }) as { count: number };
      if (!deleted || deleted.count === 0) {
        throw prismaNotFound();
      }
      return existing;
    };
  }

  if (operation === 'deleteMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'deleteMany', {
        ...args,
        where: withTenantWhere(args.where, tenantId),
      });
    };
  }

  if (operation === 'upsert') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);
      const existing = await invoke(target, 'findFirst', { where });
      if (existing) {
        await invoke(target, 'updateMany', { where, data: withTenantData(args.update, tenantId) });
        return invoke(target, 'findFirst', { where });
      }
      return invoke(target, 'create', { data: withTenantData(args.create, tenantId) });
    };
  }

  const fn = target[operation] as ((...callArgs: any[]) => any) | undefined;
  if (typeof fn !== 'function') {
    return value; // but value not in scope. Need return original? In wrapOperation we don't have original value except target[operation]. For fallback, return (...callArgs) => fn... If fn undefined, return value? But value not. Could return undefined.
  }
  return (...callArgs: any[]) => fn.apply(target, callArgs);
}
```
In fallback, if fn undefined, `target[operation]` is value (function) by condition in get, so fn should be function. But TypeScript. We can do:
```
const fn = target[operation] as (...callArgs: any[]) => any;
return (...callArgs: any[]) => fn.apply(target, callArgs);
```
No undefined. Good.

Need `invoke`:
```
function invoke(target: ModelDelegate, operation: string, args: Record<string, any>): Promise<any> {
  const fn = target[operation] as ((input: Record<string, any>) => any) | undefined;
  if (typeof fn !== 'function') {
    throw new Error(`Prisma operation "${operation}" is not available on the base client.`);
  }
  return Promise.resolve(fn.call(target, args));
}
```
Good.

`withTenantWhere` and `withTenantData` as above.

`prismaNotFound`.

Potential issue: In `wrapOperation` for `update`, if `target['updateMany']` not available, invoke throws. OK.

Potential issue: For `upsert`, if existing, `updateMany` with data possibly `{ tenantId }` if args.update undefined. OK.

Potential issue: `withTenantData` for `updateMany` data can be undefined; returns `{ tenantId }`, which may cause update to set tenantId only. OK.

Potential issue: `withTenantWhere` if `where` is `undefined`, returns `{ tenantId }`. Good.

Potential issue: For read `count`, args may not have where. Good.

Potential issue: `Reflect.get` may invoke getters. OK.

Need `TenantScopedModel` type used? Not directly except maybe `for (const model of TENANT_SCOPED_MODELS)`. It's string union. `client[model]` OK. The type `TenantScopedModel` not used; could remove to avoid unused? TS strict doesn't error unused type? It may noUnusedLocals not set. OK. Could remove. But fine.

Need `value` variable in get used? We check typeof value, then wrapOperation. Not use value. OK.

### src/tenant/tenant-prisma.service.ts
OK.

### src/tenant/tenant.repository.ts
OK.

### src/tenant/tenant.service.ts
OK.

### src/tenant/tenant-resolution.middleware.ts
Need import `Request, Response, NextFunction` types. `TenantRequest` extends Request. Code:
```
import { Injectable, NestMiddleware } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../common/api-error.js';
import { TenantContextService } from './tenant-context.service.js';
import { TenantService } from './tenant.service.js';
import { ResolvedTenant } from './tenant.types.js';

export interface TenantRequest extends Request {
  tenant?: ResolvedTenant;
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly tenantService: TenantService,
  ) {}

  async use(req: TenantRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      const host = normalizeHost(req.headers.host);
      if (!host) {
        throw new ApiError(400, 'invalid_host', 'Host header is required.', {});
      }

      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        throw new ApiError(401, 'invalid_token', 'Authorization bearer token is required.', {});
      }

      const org = verifyOrgToken(token);
      const tenant = await this.tenantService.findTenantByHost(host);
      if (!tenant) {
        throw new ApiError(400, 'unknown_host', 'Host does not map to a known tenant.', { host });
      }

      // ASSUMPTION: The token org claim is the tenant slug, or the tenant id.
      if (org !== tenant.slug && org !== tenant.id) {
        throw new ApiError(403, 'tenant_mismatch', 'Token org claim does not match the tenant host.', {
          org,
          host,
          tenant: tenant.slug,
        });
      }

      req.tenant = tenant;
      await this.tenantContext.run(tenant, async () => {
        await next();
      });
    } catch (error) {
      next(error);
    }
  }
}

function normalizeHost(value: string | string[] | undefined): string { ... }
function extractBearerToken(header: string | string[] | undefined): string | null { ... }
function verifyOrgToken(token: string): string { ... }
```
Need `_res` unused. OK.

`verifyOrgToken`:
```
function verifyOrgToken(token: string): string {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret) {
    throw new ApiError(500, 'internal_error', 'AUTH_TOKEN_SECRET is not configured.', {});
  }

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    throw new ApiError(401, 'invalid_token', 'Bearer token is invalid.', {});
  }

  if (typeof payload === 'string' || typeof payload.org !== 'string' || payload.org.trim().length === 0) {
    throw new ApiError(401, 'invalid_token', 'Token org claim is invalid.', {});
  }
  return payload.org;
}
```
Need `jwt.JwtPayload` type. With `import jwt from 'jsonwebtoken'`, namespace? The type is `jwt.JwtPayload` if default import has namespace? With @types/jsonwebtoken, `import jwt from 'jsonwebtoken'` gives function and also namespace? I think yes: `import * as jwt from 'jsonwebtoken'` safer for types. Use `import * as jwt from 'jsonwebtoken';` Then `jwt.verify`, `jwt.JwtPayload`. With ESM, CJS namespace import works? TypeScript esModuleInterop. In Node ESM, `import * as jwt from 'jsonwebtoken'` creates namespace. Good. Use that.

`extractBearerToken`:
```
function extractBearerToken(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  const parts = value.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || parts[1].length === 0) return null;
  return parts[1];
}
```
Good.

Potential issue: If Authorization header has extra spaces, split may length >2. Could use `match`. Simpler:
```
const match = value.match(/^Bearer\s+(.+)$/i);
return match ? match[1].trim() : null;
```
Use regex. Good.

### src/tenant/tenant.module.ts
OK.

### src/tenant-config/tenant-config.controller.ts
OK.

### src/tenant-config/tenant-config.service.ts
OK.

### src/tenant-config/tenant-config.module.ts
OK.

### src/customer/customer.types.ts
OK.

### src/customer/customer.controller.ts
Need import `Body, Controller, Delete, Get, Param, Patch, Post` from @nestjs/common. No `Req`.
Code:
```
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { CustomerService } from './customer.service.js';
import { CustomerInput, CustomerUpdateInput } from './customer.types.js';

@Controller('customers')
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: { email?: unknown; name?: unknown }) {
    const email = requireString(body?.email, 'email').toLowerCase();
    validateEmail(email);
    const name = requireString(body?.name, 'name');
    const input: CustomerInput = { email, name };
    return this.service.create(input);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { email?: unknown; name?: unknown }) {
    const input: CustomerUpdateInput = {};
    if (body?.email !== undefined) {
      const email = requireString(body.email, 'email').toLowerCase();
      validateEmail(email);
      input.email = email;
    }
    if (body?.name !== undefined) {
      input.name = requireString(body.name, 'name');
    }
    if (Object.keys(input).length === 0) {
      throw new ApiError(400, 'validation_error', 'At least one updatable field must be provided.', { fields: ['email', 'name'] });
    }
    return this.service.update(id, input);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'validation_error', `${field} must be a non-empty string.`, { field });
  }
  return value.trim();
}

function validateEmail(email: string): void {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!pattern.test(email)) {
    throw new ApiError(400, 'validation_error', 'email must be a valid email address.', { email });
  }
}
```
OK.

### src/customer/customer.service.ts
OK.

### src/customer/customer.repository.ts
OK.

### src/customer/customer.module.ts
OK.

Now tests. Need ensure imports use `.js`.

`test/customer-isolation.spec.ts` code. Let's write fully.
```
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/api-error.js';
import { CustomerRepository } from '../src/customer/customer.repository.js';
import { CustomerService } from '../src/customer/customer.service.js';
import { createTenantAwareClient } from '../src/tenant/tenant-prisma.middleware.js';
import type { BasePrismaClient } from '../src/tenant/tenant-prisma.middleware.js';
import type { TenantPrismaService } from '../src/tenant/tenant-prisma.service.js';
import { TenantContextService } from '../src/tenant/tenant-context.service.js';
import type { ResolvedTenant } from '../src/tenant/tenant.types.js';

const tenantA: ResolvedTenant = { ... };
const tenantB: ResolvedTenant = { ... };

type FakeRow = Record<string, any>;

function createFakePrismaBase(rows: FakeRow[]): BasePrismaClient {
  const db: FakeRow[] = rows.map((row) => ({ ...row }));

  const matches = (where: Record<string, any> = {}) =>
    db.filter((row) =>
      Object.entries(where).every(([key, value]) => {
        if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
          return Object.entries(value as Record<string, any>).every(([subKey, subValue]) => row[key] === subValue);
        }
        return row[key] === value;
      }),
    );

  return {
    customer: {
      findMany: async (args: { where?: Record<string, any> } = {}) => matches(args.where ?? {}).map((row) => ({ ...row })),
      findFirst: async (args: { where?: Record<string, any> } = {}) => {
        const found = matches(args.where ?? {});
        return found.length > 0 ? { ...found[0] } : null;
      },
      create: async (args: { data: Record<string, any> } = { data: {} }) => {
        const now = new Date();
        const row: FakeRow = {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...args.data,
        };
        if (row.tenantId === undefined) {
          throw Object.assign(new Error('tenantId is required'), { code: 'P2003' });
        }
        if (typeof row.tenantId === 'string' && typeof row.email === 'string') {
          const duplicate = db.some((existing) => existing.tenantId === row.tenantId && existing.email === row.email);
          if (duplicate) {
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['tenant_id', 'email'] } });
          }
        }
        db.push(row);
        return { ...row };
      },
      updateMany: async (args: { where?: Record<string, any>; data?: Record<string, any> } = {}) => {
        const found = matches(args.where ?? {});
        for (const row of found) {
          Object.assign(row, args.data ?? {}, { updatedAt: new Date() });
        }
        return { count: found.length };
      },
      deleteMany: async (args: { where?: Record<string, any> } = {}) => {
        const found = matches(args.where ?? {});
        for (const row of found) {
          const index = db.indexOf(row);
          if (index >= 0) db.splice(index, 1);
        }
        return { count: found.length };
      },
    },
  };
}

function buildService() {
  const context = new TenantContextService();
  const base = createFakePrismaBase([
    { id: 'customer-a-1', tenantId: tenantA.id, email: 'a@example.com', name: 'A One', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
    { id: 'customer-b-1', tenantId: tenantB.id, email: 'b@example.com', name: 'B One', createdAt: new Date('2026-01-02T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z') },
  ]);
  const client = createTenantAwareClient(base, context);
  const repository = new CustomerRepository({ client } as unknown as TenantPrismaService);
  const service = new CustomerService(repository);
  return { context, service };
}

describe('customer multi-tenant isolation', () => {
  it('lists only the current tenant customers', async () => { ... });
  it('returns 404 when another tenant fetches a row by id', async () => { ... });
  it('returns 404 when another tenant updates a row', async () => { ... });
  it('returns 404 when another tenant deletes a row', async () => { ... });
  it('allows the same email to be registered in two tenants', async () => { ... });
  it('keeps concurrent tenant contexts isolated', async () => { ... });
});
```
Need in list test, `rows.map((row) => row.id)` row type Customer. OK.
Potential issue: `crypto` global in Node 20. In Vitest environment node, available. OK.

Test update own row maybe add.
```
it('lets a tenant update its own row', async () => {
  const { context, service } = buildService();
  const updated = await context.run(tenantB, async () => service.update('customer-b-1', { name: 'B Updated' }));
  expect(updated.id).toBe('customer-b-1');
  expect(updated.name).toBe('B Updated');
});
```
Good.

In update another tenant test, after attempt, verify A unchanged:
```
const aRows = await context.run(tenantA, async () => service.list());
expect(aRows.find((row) => row.id === 'customer-a-1')?.name).toBe('A One');
```
Good.

In delete another tenant, verify A still exists:
```
const aRows = await context.run(tenantA, async () => service.list());
expect(aRows.some((row) => row.id === 'customer-a-1')).toBe(true);
```
Good.

Potential issue: In `service.update` returns `Customer | null`? Our service returns Promise<Customer>, throws if null. In own update, returns. Good.

Potential issue: In `service.remove` returns `{ id }` or throws. For own delete maybe test? Not required. Could add:
```
const deleted = await context.run(tenantB, () => service.remove('customer-b-1'));
expect(deleted.id).toBe('customer-b-1');
```
OK.

Need if `context.run` with fn returning void? OK.

`test/tenant-resolution.spec.ts` full.
```
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import { ApiError } from '../src/common/api-error.js';
import { TenantContextService } from '../src/tenant/tenant-context.service.js';
import { TenantResolutionMiddleware } from '../src/tenant/tenant-resolution.middleware.js';
import type { TenantRequest } from '../src/tenant/tenant-resolution.middleware.js';
import type { TenantService } from '../src/tenant/tenant.service.js';
import type { ResolvedTenant } from '../src/tenant/tenant.types.js';

const tenantA: ResolvedTenant = { ... };
const tenantB: ResolvedTenant = { ... };
const secret = 'test-secret';

beforeEach(() => { process.env.AUTH_TOKEN_SECRET = secret; });

const tokenA = jwt.sign({ org: 'operator-a' }, secret, { algorithm: 'HS256' });
const tokenB = jwt.sign({ org: 'operator-b' }, secret, { algorithm: 'HS256' });

function makeMiddleware() { ... }
function makeRequest(host?: string, token?: string): TenantRequest { ... }

describe('tenant resolution middleware', () => {
  it('resolves tenant when host and org claim agree', async () => { ... });
  it('rejects when token org does not match host', async () => { ... });
  it('rejects unknown host', async () => { ... });
  it('rejects invalid token', async () => { ... });
  it('rejects missing authorization', async () => { ... });
  it('rejects missing host', async () => { ... });
});
```
Need `tokenA` and `tokenB` at module scope use `secret` defined. OK. But if `jwt.sign` before env? It doesn't need env. OK.

In success test:
```
const next = vi.fn(async () => { observedTenantId = context.getTenantId(); });
await middleware.use(makeRequest(tenantA.host, tokenA), {} as Response, next as NextFunction);
expect(next).toHaveBeenCalledTimes(1);
expect(observedTenantId).toBe(tenantA.id);
```
Potential issue: `next` called with no args, but `vi.fn(async () => ...)` returns Promise. `next.mock.calls[0]` maybe `[]`. OK.

In error tests:
```
const next = vi.fn();
await middleware.use(...);
expect(next).toHaveBeenCalledTimes(1);
const error = next.mock.calls[0]?.[0];
expect(error).toBeInstanceOf(ApiError);
expect((error as ApiError).getStatus()).toBe(403);
expect((error as ApiError).code).toBe('tenant_mismatch');
```
Good.

Need if `next` is `vi.fn()` returns undefined. `await next()` in middleware: if next returns undefined, OK. But `next` type `NextFunction` expects return void; `vi.fn()` returns `Mock`, cast. OK.

Potential issue: In missing host test, middleware checks host before token. If token valid, error invalid_host. Good.

`test/tenant-config.spec.ts` full.
```
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/api-error.js';
import { TenantService } from '../src/tenant/tenant.service.js';
import type { TenantRepository } from '../src/tenant/tenant.repository.js';
import { TenantConfigService } from '../src/tenant-config/tenant-config.service.js';

const tenantRow = { ... };

function makeTenantService() { ... }

describe('tenant config', () => {
  it('returns branding and feature flags for the resolved tenant', async () => { ... });
  it('throws resource_not_found for an unknown tenant', async () => { ... });
  it('resolves a tenant by host', async () => { ... });
});
```
Need `TenantConfigService` constructor expects `TenantService`. We pass `makeTenantService()` returns TenantService. Good.

Potential issue: `tenantRow` includes `featureFlags` object. `TenantService.getConfig` returns `logoUrl` string. OK.

Need if `findById` returns `tenantRow` object not Prisma Tenant. Cast via repository stub. OK.

Now, verify no import cycles causing issues:
- customer.repository imports TenantPrismaService (value) -> tenant-prisma.service imports GlobalPrismaService (value) -> @prisma/client. customer.service imports customer.repository. controller imports service. module imports controller/service/repo/TenantModule. OK.
- tenant-resolution.middleware imports TenantService -> tenant.repository -> GlobalPrismaService. OK.
- app.module imports middleware and modules. OK.
- tests import services. OK.

Potential issue: `TenantService` in tenant-resolution middleware is value import, and test uses type import. OK.

Potential issue: `TenantPrismaService` class has no `@Inject` decorators. DI uses constructor param types. It imports `TenantContextService`, `GlobalPrismaService`. In TenantModule, both providers. OK.

Potential issue: `CustomerRepository` constructor param `TenantPrismaService`. Since TenantPrismaService is exported from TenantModule and imported. OK.

Potential issue: `TenantConfigController` constructor param `TenantContextService` and `TenantConfigService`. Both providers/exported. OK.

Potential issue: `TenantConfigService` constructor param `TenantService`. Exported. OK.

Potential issue: `TenantResolutionMiddleware` not exported; instantiated by Nest in AppModule. It depends on `TenantContextService`, `TenantService`. Since AppModule imports TenantModule, resolvable. OK.

Potential issue: `GlobalPrismaService` extends PrismaClient. It has many properties. Nest DI may treat it as class. OK.

Potential issue: `GlobalPrismaService` constructor calls super with `datasources` url undefined. If DATABASE_URL missing, PrismaClient constructor may not throw until connect? It may. In production, env required. OK.

Potential issue: In tests, `GlobalPrismaService` not instantiated, so no env. OK.

Potential issue: `TenantPrismaService` in tests not instantiated, but import loads class. OK.

Potential issue: `createTenantAwareClient` uses `context.getTenantId()` which throws ApiError with status 500. In concurrent test, context set. OK.

Potential issue: In fake base, `matches` uses `Object.entries(where)`. If `where` includes `undefined` values? Proxy sets tenantId string, id string. OK. If repository `findMany` no where, proxy sets where `{ tenantId }`. OK.

Potential issue: In fake base `create`, if `args.data` includes nested objects? Not. OK.

Potential issue: In fake base `updateMany`, if `args.data` includes `tenantId`, Object.assign. OK.

Potential issue: In fake base `deleteMany`, `db.indexOf(row)` uses reference. `matches` returns references to db rows. Good.

Potential issue: In same email test, `createdA.id` is random. `aList` includes seed A plus created. Filter by email. OK.

Potential issue: In concurrent test, both create and list. If one context crosses, list may include other tenant row and fail. Good.

Potential issue: In tenant resolution success, `next` async sets observedTenantId. But `middleware.use` catches errors; if `context.getTenantId()` throws, `next` rejects and catch calls next(error) again? Actually `await this.tenantContext.run(tenant, async () => { await next(); });` If next async throws, catch outside catches and calls `next(error)`, resulting second call. In success no throw. OK.

Potential issue: In error tests, if `next` is vi.fn() and middleware catches before calling next, OK. If error occurs after next called? Not.

Potential issue: In unknown host test, token valid. `tenantService.findTenantByHost` returns null. Error. OK.

Potential issue: In invalid token test, host valid but token garbage. verify throws. OK.

Potential issue: In missing authorization, token null. OK.

Potential issue: In missing host, host undefined. OK.

Potential issue: `normalizeHost` lowercases. Tests use lower. OK.

Potential issue: `extractBearerToken` regex `^Bearer\s+(.+)$` case-insensitive? Use `i` flag. Good.

Now, consider if `forRoutes({ path: '(.*)', method: RequestMethod.ALL })` applies to routes with prefix. Yes.

Potential issue: NestJS middleware with `path: '(.*)'` may need `use` method returns void not Promise? It can be async. OK.

Potential issue: `main.ts` doesn't call `app.enableCors`. Not needed.

Potential issue: Error filter catches errors from middleware? Yes.

Potential issue: `ApiExceptionFilter` for `ApiError` uses `exception.getResponse()`. Our `getResponse` returns envelope. Good.

Potential issue: In `ApiError`, `details` object may be mutated? OK.

Potential issue: `details` in P2002 if `meta.target` is array, it's inside object. OK.

Potential issue: `statusCodeToCode` for 403 returns `forbidden`. But our `ApiError` for mismatch has code `tenant_mismatch`, handled. OK.

Potential issue: `HttpException` from Nest (e.g., 404 no route) body may be `{ message: 'Cannot GET...', error: 'Not Found', statusCode: 404 }`. It has no `error` key? It has `error: 'Not Found'` string, so `'error' in body` true. Our filter would pass body, not envelope. That violates one envelope for 404 route. Need handle. Nest default HttpException response often `{ statusCode, message, error }` where `error` is string. We should not pass arbitrary body just because has `error` key. We should only pass if body.error is object with code/message/details. Modify:
```
if (isApiEnvelope(body)) response.status(status).json(body); else envelope.
```
Implement helper:
```
function isApiEnvelope(value: unknown): value is { error: { code: string; message: string; details: Record<string, unknown> } } {
  if (!value || typeof value !== 'object') return false;
  const error = (value as any).error;
  return error && typeof error === 'object' && typeof error.code === 'string' && typeof error.message === 'string' && typeof error.details === 'object' && error.details !== null;
}
```
Then for HttpException, if not envelope, produce. Good. For ApiError handled before. Update filter.

Need `details` object never null. OK.

Modify filter code accordingly.

Potential issue: For `HttpException` from `ApiError` not reached. OK.

Potential issue: For `ApiError` response body is envelope. Good.

Update `src/app/api-exception.filter.ts` with helper.

Now, check `ApiError` `getResponse` type. OK.

Potential issue: `exception.message` for HttpException may be object? It's string. OK.

Potential issue: In filter, `known.meta?.target` maybe not object. We set details target to cast or {}. If target array, object? It's array but value not details. OK.

Now, consider if tests assert only behaviour? Yes.

Need maybe test `tenant-config` HTTP? Not.

Potential issue: The task says "Tests: tenant B cannot list, fetch-by-id (expect 404), update, or delete tenant A's rows; same email registers in both tenants; concurrent requests from different tenants don't cross contexts." Our customer isolation tests do exactly. Good.

Potential issue: It says "GET /tenant-config — branding + feature flags for the resolved tenant." We implement endpoint and service test. No HTTP test. OK.

Potential issue: It says "Tenant resolution middleware: derive tenant from host + token org claim (both must agree); reject mismatches. Tenant lives in request-scoped context." We implement and test. Good.

Potential issue: It says "Structural isolation at the data layer: a tenant-aware Prisma client (extension/middleware) that scopes every read and stamps every write; handlers never pass tenantId manually." We implement proxy middleware. Good.

Potential issue: "Schema for customers/plans/orders with tenant-scoped uniqueness (same customer email may exist in two tenants)." We implement. Good.

Potential issue: "Auth tokens carry an org claim; requests also arrive with the tenant's host." We verify JWT. Good.

Need maybe include `AUTH_TOKEN_SECRET` in env example? Not. Could be in code comment. OK.

Potential issue: No `prisma seed`. Not needed.

Potential issue: `package.json` postinstall may run prisma generate before schema? Schema in repo. OK.

Potential issue: `tsconfig` `types: ["node"]` may prevent Vitest globals? We import explicitly. OK.

Potential issue: `vitest.config.ts` included in tsconfig, but `vitest/config` type maybe not resolved if types node? It imports explicit. OK.

Potential issue: `module: NodeNext` with `emitDecoratorMetadata` and ESM. NestJS docs: For ESM, use `module: nodenext`, `emitDecoratorMetadata: true`. OK.

Potential issue: `import 'reflect-metadata';` in main. In Node ESM, side-effect import from CJS. OK.

Potential issue: `@nestjs/platform-express` requires `express`. It bundles? It depends on express. OK.

Potential issue: `@types/express` for Request/Response. OK.

Potential issue: In `api-exception.filter.ts`, `Response` type from express. `response.status().json()` returns Response. OK.

Potential issue: In `tenant-resolution.middleware.ts`, `NextFunction` from express. `await next()` where next returns void. TypeScript may complain because `next()` returns `void`, cannot await? In TS, awaiting non-Promise is allowed? It is allowed (await void yields undefined). OK.

Potential issue: `NextFunction` type is `(err?: any) => void`. `await next()` OK.

Potential issue: In `TenantResolutionMiddleware.use`, `_res` unused. TS noUnusedParameters? Not set. OK.

Potential issue: In `customer.controller.ts`, `body?.email` where body typed `{ email?: unknown; name?: unknown }`. If body undefined, `body?.email`. OK.

Potential issue: In `requireString`, message `${field}...` developer-facing. OK.

Potential issue: In `validateEmail`, details `{ email }` includes user input. OK.

Potential issue: In `CustomerService.remove`, returns `{ id }`. Controller returns. OK.

Potential issue: In `CustomerRepository.delete`, using `deleteMany` may delete multiple if where matches multiple. Where `{ id }` unique. OK.

Potential issue: In `CustomerRepository.update`, using `updateMany` and then `findById`. If update fails due to unique constraint, Prisma P2002 thrown. Filter maps. Good.

Potential issue: In `CustomerRepository.update`, if `input` empty? Controller prevents. OK.

Potential issue: In `CustomerRepository.findMany`, `orderBy` not supported by fake base. It ignores args.orderBy. OK.

Potential issue: In fake base, `findMany` args type doesn't include orderBy, but repository passes. TypeScript in test? `createFakePrismaBase` returns BasePrismaClient (Record<string, any>), so no type check for args. OK.

Potential issue: In `createTenantAwareClient`, `invoke` returns `Promise.resolve(fn.call(target, args))`. If fn returns value (not Promise), OK.

Potential issue: In `wrapOperation` fallback, `const fn = target[operation] as (...callArgs: any[]) => any; return (...callArgs: any[]) => fn.apply(target, callArgs);` If operation symbol? `String(property)` for symbol becomes 'Symbol(...)' but target[operation] undefined? But get only for functions; if property symbol function? Not. OK.

Potential issue: `Reflect.get(target, property, receiver)` for Prisma delegate methods. OK.

Potential issue: `BasePrismaClient` type Record<string, any>. In `createTenantAwareClient`, `base[model]` may be undefined if fake missing plan/order. It will create proxy for undefined target? If `base['plan']` undefined, `new Proxy(undefined)` throws. In tests, fake base only has customer. We call `createTenantAwareClient(base, context)` and base lacks plan/order! That will throw because target undefined. Need handle missing models. In production Prisma has all. In tests fake base only customer. We can make fake base include plan/order empty delegates, or handle missing in create. Better: In `createTenantAwareClient`, if `base[model]` is undefined, create an empty object target? But proxy on empty object, operations unavailable. That's fine. Do:
```
const target = (base[model] ?? {}) as ModelDelegate;
```
Then tests with only customer OK. Good. Modify middleware.

Potential issue: If target empty, invoking operation throws `Prisma operation ... not available`. OK.

Update `createTenantAwareClient`: `const target = (base[model] ?? {}) as ModelDelegate;`

Potential issue: In tests, `client.plan` exists. OK.

Potential issue: In `TenantPrismaService` production, base has all. OK.

Potential issue: In fake base, if `updateMany` not defined? We define.

Potential issue: In fake base, `create` uses `crypto.randomUUID()`. If `args.data.id` provided, use. OK.

Potential issue: In same email test, after create A, create B. Fake base duplicate check uses `db.some`. Good.

Potential issue: In concurrent test, if both create same email in different tenants, OK.

Potential issue: In tenant resolution test, `TenantService` stub `findTenantByHost` returns ResolvedTenant. It doesn't use repository. OK.

Potential issue: In tenant-config test, `TenantService` stub repository `findById` returns tenantRow. It doesn't have `findByHost`? It does. OK.

Potential issue: `TenantService` constructor type `TenantRepository`; stub cast. OK.

Potential issue: In `tenant-config.spec.ts`, `makeTenantService()` returns `TenantService`. `TenantConfigService` expects `TenantService`. OK.

Potential issue: In `tenant-config.spec.ts`, `tenantRow.logoUrl` is string. `TenantConfigDto.logoUrl` string | null. OK.

Potential issue: In `TenantService.getConfig`, if `tenant.featureFlags` is object, returns. OK.

Potential issue: In `TenantService.findTenantByHost`, uses `this.repository.findByHost(host)`. In tenant-resolution middleware, host normalized. In test stub, host exact. OK.

Potential issue: In production, `TenantService.findTenantByHost` lowercases? Middleware normalizes. Repository query host lower. Tenant host stored lower? Assume. Could normalize in service? Not necessary.

Potential issue: In migration, `tenants.host` unique. Should host stored lower. Application normalizes. OK.

Potential issue: In `prisma/schema.prisma`, no `@map` for id. It defaults to id. OK.

Potential issue: In migration, table names snake_case. Good.

Potential issue: In code, table/column snake_case via @map. Good.

Potential issue: Endpoint `tenant-config` singular not plural. Task explicit. OK.

Potential issue: TS file names: `tenant-prisma.middleware.ts` role? It's middleware. OK. `global-prisma.service.ts`. OK. `tenant.types.ts` not role? Conventions example but types ok. `customer.types.ts`. OK.

Potential issue: "Do not create a file it does not call for" but we include package.json, tsconfig, vitest config, migration lock. Necessary for solution. OK.

Potential issue: The final answer must be parsed mechanically: For each file, level-3 heading holding only path, immediately followed by one fenced block holding only content. No prose. Need ensure no blank lines? Blank lines between blocks maybe ignored. But keep no prose. It says Nothing outside that pattern is read. We can have headings and blocks. Good.

Need ensure paths repository-relative. Use no leading slash.

Need ensure no duplicate paths. OK.

Let's now write final files in order. Need be careful with code syntax.

Review `src/app/api-exception.filter.ts` with helper:
```
function isApiEnvelope(value: unknown): value is { error: { code: string; message: string; details: Record<string, unknown> } } {
  if (value === null || typeof value !== 'object') return false;
  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  return typeof candidate.code === 'string' && typeof candidate.message === 'string' && candidate.details !== null && typeof candidate.details === 'object';
}
```
Use in filter.

Potential issue: `details` could be array? It must be object, never null. Our details object. If array, typeof 'object' true. OK.

Now, check `tenant-prisma.middleware.ts` fallback:
```
const fn = target[operation] as (...callArgs: any[]) => any;
return (...callArgs: any[]) => fn.apply(target, callArgs);
```
If `target[operation]` is undefined (should not), fn not function, apply error. OK.

Need `invoke` uses `Promise.resolve`. If fn throws synchronously, `Promise.resolve(fn.call(...))` will reject? If fn.call throws before Promise.resolve, it throws in async function, rejected. OK.

Potential issue: In `invoke`, if operation is `findUnique` not available, but we only call available. OK.

Potential issue: In `wrapOperation` for `findUniqueOrThrow`, if target doesn't have `findFirstOrThrow` (fake), invoke throws. Not used. OK.

Potential issue: In `TenantContextService.getTenant`, throwing ApiError in data layer may be caught by filter as 500. OK.

Potential issue: In `TenantPrismaService`, no `@Inject` but constructor params two. Nest DI with metadata. Since we build with tsc, design:paramtypes includes TenantContextService and GlobalPrismaService. OK. In Vitest, no DI. OK.

Potential issue: In `TenantModule`, `TenantPrismaService` provider class. Nest will instantiate after GlobalPrismaService? DI resolves. OK.

Potential issue: `GlobalPrismaService` extends PrismaClient, which may have constructor with `options` param. We call super. OK.

Potential issue: In Prisma 5, `PrismaClient` constructor options `datasources` is valid. OK.

Potential issue: `prisma/schema.prisma` `featureFlags Json` in TS is `Prisma.JsonValue`. Our `toFeatureFlags` accepts unknown. OK.

Potential issue: In `TenantService.toResolved`, `tenant.logoUrl` type `string | null`. OK.

Potential issue: In `tenant-config.controller.ts`, if tenant context missing, `getTenantId` throws 500. Middleware ensures. OK.

Potential issue: In `main.ts`, `port` NaN if PORT invalid. Could default. Not critical. Could `Number(process.env.PORT ?? 3000) || 3000`. Use:
```
const port = Number(process.env.PORT ?? 3000);
await app.listen(Number.isFinite(port) ? port : 3000);
```
OK.

Potential issue: In `app.module.ts`, `forRoutes({ path: '(.*)', method: RequestMethod.ALL })`. Need import RequestMethod. OK.

Potential issue: In `package.json`, `postinstall` may fail in test harness if prisma not installed? But devDependency. OK.

Potential issue: In `tsconfig.json`, `"types": ["node"]` may exclude `@types/jsonwebtoken`? It still resolves via import. OK.

Potential issue: In `vitest.config.ts`, `esbuild` option top-level? In Vitest config, `esbuild` is Vite config. OK.

Potential issue: In tests, `import * as jwt from 'jsonwebtoken'`; with `esModuleInterop`, namespace import from CJS. OK.

Potential issue: In `tenant-resolution.middleware.ts`, `import * as jwt from 'jsonwebtoken';` and use `jwt.JwtPayload`. OK.

Potential issue: In `verifyOrgToken`, `jwt.verify` can return `string | JwtPayload`. If `payload.org` access on JwtPayload (Record<string, unknown>), OK. `typeof payload.org !== 'string'`. Good.

Potential issue: In `extractBearerToken`, regex captures token with trailing spaces? `match[1].trim()`. OK.

Potential issue: In `normalizeHost`, if host includes port, strip. If IPv6? Not.

Potential issue: In migration, `updated_at` no default. Prisma `@updatedAt` requires not null. OK.

Potential issue: In migration, if applying after existing DB, OK.

Potential issue: In `prisma/migrations/.../migration.sql`, need semicolons. OK.

Potential issue: In `package.json`, `@nestjs/testing` not used. Could remove. But OK.

Potential issue: The final answer may be long. OK.

Double-check no missing file: `src/app/api-exception.filter.ts` uses `@Catch()`; main instantiates. OK.

Could `src/app/api-exception.filter.ts` path conflicts with layout? OK.

Now, consider if using `GlobalPrismaService` as base for tenant proxy and also tenant repository. The proxy wraps model delegates. But `GlobalPrismaService` also has `$connect` etc. Proxy only for customer/plan/order. OK.

Potential issue: `createTenantAwareClient` uses `base[model]` where base is `GlobalPrismaService`. In PrismaClient, model properties may be getters that return new object each time? If `base['customer']` getter returns delegate. `const target = base[model] ?? {}` invokes getter. OK. Proxy over that delegate. If delegate is recreated on each access? The property access happens once in create, proxy over that instance. Prisma model delegates are stable? I think yes. If not, still OK? PrismaClient's model property returns a delegate object maybe singleton. OK.

Potential issue: If PrismaClient uses `$extends` internally and model delegates are proxy, our proxy over proxy OK.

Potential issue: In tests, fake base `customer` object stable. OK.

Potential issue: In `TenantPrismaService`, `client` is created in constructor. If Nest lazy instantiation, OK.

Potential issue: In `CustomerRepository`, `this.prisma.client.customer.findMany` property access each call. `client.customer` is proxied delegate. OK.

Potential issue: In `withTenantWhere`, if `where` has nested `AND`, we only spread top-level and add tenantId. If where is `{ AND: [{ id }] }`, adding tenantId top-level may not combine correctly. Not used. Could be more robust by using `AND: [existing, { tenantId }]`. But for simple where OK. To be safer, we can implement:
```
function withTenantWhere(where, tenantId) {
  if (where && typeof where === 'object' && !Array.isArray(where)) {
    return { ...where, AND: [ ...(Array.isArray(where.AND) ? where.AND : []), { tenantId } ] };
  }
  return { tenantId };
}
```
But this changes simple where to include AND, which Prisma accepts. For fake base, `matches` doesn't handle `AND`, so tests would fail if where has AND. Our simple where has no AND, but this would add AND always, and fake base doesn't handle. So keep simple spread. OK.

Potential issue: In `withTenantData`, for update data with nested `set`? Not.

Potential issue: In `CustomerController`, input validation zero business logic? It's input validation. OK.

Potential issue: In `CustomerService`, throwing not found is business logic. OK.

Potential issue: In `TenantConfigService`, just delegates. OK.

Potential issue: In `TenantService`, mapping tenant to DTO. Business logic. OK.

Potential issue: In `TenantRepository`, only DB. OK.

Potential issue: In `CustomerRepository`, using `findById` after update. DB. OK.

Potential issue: In `TenantPrismaService`, no logic except create client. OK.

Potential issue: In `tenant-prisma.middleware.ts`, data layer isolation. OK.

Now, maybe need to include `prisma/seed.ts`? No.

Potential issue: The task says "Configuration comes from environment variables only. DATABASE_URL for Postgres. No secrets in the repository, no hardcoded connection strings." We use process.env.DATABASE_URL and AUTH_TOKEN_SECRET. Good. No hardcoded.

Potential issue: `package.json` postinstall may require `prisma` binary. OK.

Potential issue: If no `DATABASE_URL` in test environment, importing `GlobalPrismaService` class doesn't instantiate. OK.

Potential issue: `@prisma/client` generated client may not exist in test harness. But solution assumes `prisma generate`. OK.

Potential issue: The final output should not include analysis. Only headings/blocks.

Let's ensure code compiles mentally.

`src/tenant/tenant-prisma.middleware.ts` full code:
```
import { TenantContextService } from './tenant-context.service.js';

const TENANT_SCOPED_MODELS = ['customer', 'plan', 'order'] as const;

export type ModelDelegate = Record<string, any>;
export type BasePrismaClient = Record<string, any>;

export interface TenantAwarePrismaClient {
  customer: ModelDelegate;
  plan: ModelDelegate;
  order: ModelDelegate;
}

const READ_OPERATIONS = new Set<string>([...]);

export function createTenantAwareClient(base: BasePrismaClient, context: TenantContextService): TenantAwarePrismaClient {
  const client = {} as TenantAwarePrismaClient;
  for (const model of TENANT_SCOPED_MODELS) {
    const target = (base[model] ?? {}) as ModelDelegate;
    client[model] = new Proxy(target, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        return wrapOperation(String(property), target, context);
      },
    });
  }
  return client;
}

function wrapOperation(operation: string, target: ModelDelegate, context: TenantContextService) {
 ...
 const fn = target[operation] as (...callArgs: any[]) => any;
 return (...callArgs: any[]) => fn.apply(target, callArgs);
}

function invoke(target: ModelDelegate, operation: string, args: Record<string, any>): Promise<any> {
  const fn = target[operation] as ((input: Record<string, any>) => any) | undefined;
  if (typeof fn !== 'function') throw new Error(...);
  return Promise.resolve(fn.call(target, args));
}

function withTenantWhere(where: any, tenantId: string): Record<string, any> {
  const existing = where && typeof where === 'object' && !Array.isArray(where) ? { ...where } : {};
  return { ...existing, tenantId };
}

function withTenantData(data: any, tenantId: string): any {
  if (Array.isArray(data)) return data.map((item) => withTenantData(item, tenantId));
  if (data && typeof data === 'object') return { ...data, tenantId };
  return { tenantId };
}

function prismaNotFound(): Error {
  const error = new Error('Record to update or delete not found.') as Error & { code: string };
  error.code = 'P2025';
  return error;
}
```
Need `Reflect.get` with target parameter name shadows outer `target`? In get handler, `get(target, property, receiver)` uses parameter `target`, OK. Outer `target` not needed. Good.

Potential issue: In `wrapOperation`, for fallback, if `operation` is e.g. `count` but not in READ? It is. OK.

Potential issue: For `findUnique`, if `args` undefined, default. OK.

Potential issue: For `create`, if `args.data` undefined, withTenantData returns `{ tenantId }`, which would create invalid. But create requires data. OK.

Potential issue: For `upsert`, if existing, `updateMany` data maybe `{ tenantId }`. OK.

Now, `test/customer-isolation.spec.ts` fake base returns object with only customer. `createTenantAwareClient` handles missing plan/order with empty target. OK.

Potential issue: In fake base, `matches` if `where` includes `tenantId` and row has `tenantId`. OK.

Potential issue: In `create`, row spread `...args.data` after defaults, so if data includes `createdAt`, overrides. OK.

Potential issue: In `updateMany`, if `args.data` undefined, uses `{}`. OK.

Potential issue: In `deleteMany`, `found` references; if updating array during iteration? We iterate found, splice by index. If multiple found, splicing changes indices, but `indexOf` each time works. OK.

Potential issue: In concurrent test, `db` array modified. OK.

Potential issue: In `buildService`, `base` type BasePrismaClient. `createTenantAwareClient(base, context)`. OK.

Potential issue: In test, `service.list()` returns `Promise<Customer[]>`. In fake, rows are any. OK.

Potential issue: In `expect(rows.map((row) => row.id)).toEqual(['customer-b-1'])`, if list order seed only one. OK.

Potential issue: In update test, after failed update as B, `aRows.find` optional. OK.

Potential issue: In delete test, after failed delete, `aRows.some`. OK.

Potential issue: In own delete test, if we add, after delete B, list B no b-1. Could include.

Let's include own update and own delete? It adds coverage. But not necessary. Keep maybe own update.

`test/tenant-resolution.spec.ts` potential issue: `tokenA` and `tokenB` created at module load using `secret`. If `secret` const after? Define secret before tokens. OK.

`makeMiddleware` uses `tenantService` stub. `findTenantByHost` returns `Promise<ResolvedTenant | null>`. Good.

`makeRequest`:
```
function makeRequest(host?: string, token?: string): TenantRequest {
  const headers: Record<string, string> = {};
  if (host) headers.host = host;
  if (token) headers.authorization = `Bearer ${token}`;
  return { headers } as unknown as TenantRequest;
}
```
OK.

In error tests, `next` is `vi.fn()`. But `NextFunction` expects possibly err. Cast. OK.

Potential issue: `vi.fn()` returns `Mock<(...args) => void>`. `next as NextFunction` OK.

Potential issue: In success, `observedTenantId` type `string | null`. After `await`, should be set. OK.

`test/tenant-config.spec.ts` potential issue: `makeTenantService` repository stub `findById` and `findByHost` return `tenantRow` or null. But `TenantRepository` methods return Prisma promises. Stub OK.

Potential issue: `TenantService.findTenantByHost` returns `toResolved(tenant)`, which expects `Tenant`. `tenantRow` has `logoUrl` string. OK.

Potential issue: In `tenant-config` test, `config.logoUrl` equals `tenantRow.logoUrl`. OK.

Now, ensure no missing exports: `BasePrismaClient` exported. `TenantAwarePrismaClient` exported. `ModelDelegate` exported maybe not used. OK.

Potential issue: In `customer.repository.ts`, `import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';` is value import. In test, importing repository loads service, which loads global-prisma, which imports `@prisma/client`. If `@prisma/client` not generated, error. Assumed.

Potential issue: In `tenant-prisma.service.ts`, `GlobalPrismaService` class extends PrismaClient. If `@prisma/client` generated, OK.

Potential issue: In `global-prisma.service.ts`, `process.env.DATABASE_URL` could be undefined. PrismaClient options type `url?: string`. OK.

Potential issue: In `prisma/schema.prisma`, `url = env("DATABASE_URL")`. OK.

Potential issue: In `app.module.ts`, `TenantResolutionMiddleware` is not in `providers` or `exports`. Does Nest instantiate middleware class with dependencies from module? According to Nest docs, `consumer.apply(Middleware)` requires middleware class to be resolvable from module. It doesn't need to be provider? I think it resolves via Nest container. If dependencies are providers. OK. If not, could add `providers: [TenantResolutionMiddleware]` in AppModule? Not necessary but could. To be safe, add `providers: [TenantResolutionMiddleware]` in AppModule? A middleware can be provider. But if declared as provider and also apply, OK. Add to be safe? Wiring: A controller declared by module; middleware not mentioned. Could add.
```
@Module({ imports: [...], providers: [TenantResolutionMiddleware] })
```
Then Nest can instantiate. Does it matter? It may. Add.

Need if `TenantResolutionMiddleware` as provider in AppModule, dependencies resolvable. Good.

Update app.module:
```
@Module({ imports: [...], providers: [TenantResolutionMiddleware] })
```
OK.

Potential issue: If middleware provider in AppModule, it is instantiated maybe. OK.

Potential issue: `TenantResolutionMiddleware` uses `TenantService` which is exported from TenantModule. AppModule imports TenantModule. OK.

Now, maybe need `TenantConfigModule` controller route path. Since controller no prefix, `@Get('tenant-config')`. Good.

Potential issue: Conventions endpoint plural. But task explicit. OK.

Potential issue: `customers` endpoints plural. Good.

Potential issue: In `CustomerController`, `@Get()` and `@Post()` within `@Controller('customers')` yield `/customers`. OK.

Potential issue: In `main.ts`, `app.useGlobalFilters` after create. OK.

Potential issue: In `api-exception.filter.ts`, `isApiEnvelope` helper uses `candidate.details !== null && typeof candidate.details === 'object'`. If details is array, true. OK.

Potential issue: For `ApiError`, `details` is object. OK.

Potential issue: For `HttpException` with body envelope, pass. For Nest default 404, body.error is string, not envelope, so produce envelope. Good.

Potential issue: For `HttpException` from `NotFoundException` with message, code `resource_not_found` if status 404. Good.

Potential issue: For validation pipe not used. OK.

Potential issue: In `tenant-resolution.middleware.ts`, if `next` throws after calling next(error) maybe double. Not.

Potential issue: In `tenant-resolution.middleware.ts`, if `tenantContext.run` throws due to next error, catch calls next(error). If next already handled error? OK.

Potential issue: In `TenantContextService.run`, if fn returns non-promise, run returns. OK.

Potential issue: In `createTenantAwareClient`, `context.getTenantId()` throws ApiError. If error thrown inside async proxy method, returns rejected promise. OK.

Potential issue: In `CustomerService`, `remove` returns `{ id }`. If deleteMany count >0 but row not found? OK.

Potential issue: In `CustomerRepository.delete`, using `deleteMany` could delete orders cascade. OK.

Potential issue: In migration, FK orders.customer_id cascade. OK.

Potential issue: In schema, `Customer` has `orders Order[]`, `Order` has `customer`. OK.

Potential issue: In schema, `Plan` has `orders Order[]`. OK.

Potential issue: In schema, `Tenant` has `orders Order[]`. OK.

Potential issue: In schema, multiple relations from Order to Tenant? Only one. OK.

Potential issue: In schema, `onDelete: Cascade` for tenant relation means deleting tenant cascades. OK.

Potential issue: In `TenantService.getConfig`, if tenant.featureFlags is `null`? Schema not null. But `toFeatureFlags` handles. OK.

Potential issue: In `tenant.types.ts`, `featureFlags` Record<string, boolean>. If JSON has other types, cast. OK.

Potential issue: In `tenant-resolution.middleware.ts`, `org` may have spaces? We don't trim? `verifyOrgToken` returns `payload.org` not trimmed. Could trim. Use `payload.org.trim()`? But if org has spaces invalid. In check, compare. Let's return `payload.org.trim()` and ensure non-empty.
```
const org = (payload.org as string).trim();
if (org.length === 0) throw ...;
return org;
```
Good.

Update verifyOrgToken:
```
if (typeof payload === 'string' || typeof payload.org !== 'string') throw ...;
const org = payload.org.trim();
if (org.length === 0) throw ...;
return org;
```
OK.

Potential issue: In `extractBearerToken`, token trimmed. OK.

Potential issue: In `normalizeHost`, trim. OK.

Potential issue: In `CustomerController`, email lower. Good.

Potential issue: In `tenant-config` endpoint, no body. OK.

Potential issue: In tests, `tenantA.slug` operator-a, `tenantB.slug` operator-b. Tokens. OK.

Potential issue: In `tenant-resolution.middleware.ts`, accepts org id too. If token org is `tenantA.id`, success. Tests use slug. OK.

Potential issue: In `tenant_mismatch` details, `tenant: tenant.slug`. OK.

Potential issue: In `unknown_host` details `{ host }`. OK.

Potential issue: In `invalid_host` details `{}`. OK.

Potential issue: In `invalid_token` details `{}`. OK.

Potential issue: In `internal_error` for missing secret, details `{}`. OK.

Now, final answer. Need ensure code blocks language. For `migration_lock.toml`, use `toml`. For `schema.prisma`, `prisma`. For SQL, `sql`. For JSON, `json`. For TS, `ts`.

Double-check file `src/app/api-exception.filter.ts` import `HttpException` from @nestjs/common. OK.

Let's write final. Ensure no accidental commentary. final only headings/blocks. Need start with first heading. Use `### package.json` etc.

One more thought: `tsconfig.json` `rootDir: "."` and include `vitest.config.ts`, `test`, `src`. Output `dist/src/main.js`, `dist/test/...`, `dist/vitest.config.js`. OK. Start script `node dist/src/main.js`. Good.

One more thought: `vitest.config.ts` uses `defineConfig` from 'vitest/config'. With `types: ["node"]`, maybe TS doesn't know module. It will resolve. OK.

One more thought: `@prisma/client` type `Customer` may not be generated until generate. OK.

One more thought: In `customer.service.ts`, `import type { Customer } from '@prisma/client';` If generated client not available, type error. Assumed.

One more thought: In `tenant.service.ts`, `import { Tenant } from '@prisma/client';` It's a type, but imported as value. TS may keep import? Since `Tenant` is a type, if not used as value, with `isolatedModules` maybe need `import type`. We didn't set isolatedModules. But to be safe, use `import type { Tenant } from '@prisma/client';`. In `customer.service` and repository use `import type`. In `global-prisma.service`, `PrismaClient` is value. In `tenant.service`, `Tenant` only type. Use `import type`. Good.

Update `tenant.service.ts`:
```
import type { Tenant } from '@prisma/client';
```
OK.

`customer.repository.ts` uses `import type { Customer }`. Good.

Potential issue: `@prisma/client` exports `PrismaClient` value and types. OK.

One more thought: `TenantPrismaService` uses `GlobalPrismaService` as base. `GlobalPrismaService` is a class extending PrismaClient. But `createTenantAwareClient` expects `BasePrismaClient` Record<string, any>. `base[model]` works. OK.

One more thought: In `TenantModule`, `GlobalPrismaService` is exported. `TenantPrismaService` depends on it. If another module imports TenantModule, it can use GlobalPrismaService. OK.

One more thought: In `AppModule`, providers `TenantResolutionMiddleware` may be instantiated as provider and also middleware. OK.

One more thought: In `main.ts`, no `app.setGlobalPrefix`. OK.

One more thought: In `api-exception.filter.ts`, `request.method` and `request.url` exist. OK.

One more thought: In `package.json`, `postinstall` runs `prisma generate` which may require `prisma` schema and Node. OK.

One more thought: In `test/customer-isolation.spec.ts`, `crypto.randomUUID()` available in Node 20. In Vitest, global crypto? Yes.

One more thought: In fake base, `row.tenantId === undefined` check. Proxy always adds. If missing, throw P2003. OK.

One more thought: In fake base, duplicate check only if email string. OK.

One more thought: In `buildService`, seed rows have `createdAt` Date. `findMany` orderBy ignored. OK.

One more thought: In `list only current tenant customers`, if proxy read failed to add tenant, list would include A and B and fail. Good.

One more thought: In `concurrent contexts`, if ALS failed, one context might see other's context depending on race. Promise.all may not guarantee interleaving, but at least each run separate. To more strongly test, add `await new Promise((resolve) => setTimeout(resolve, 0));` inside each before list. Could. Let's add small delay to allow interleaving:
```
await new Promise((resolve) => setTimeout(resolve, 0));
```
Need `setTimeout` in node. OK. This improves. Add in concurrent test.

Potential issue: In Vitest, real timers. OK.

Concurrent test code:
```
await Promise.all([
  context.run(tenantA, async () => {
    await service.create(...);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const rows = await service.list();
    ...
  }),
  context.run(tenantB, async () => { ... });
]);
```
Good.

One more thought: In `tenant-resolution` success, `next` is async and sets observed. But `middleware.use` uses `await next()`. If `next` returns Promise, waits. OK.

One more thought: In `tenant-resolution` error tests, `next` called with error. `vi.fn()` returns undefined. OK.

One more thought: In `tenant-resolution` missing host, if host undefined, middleware throws before token. OK.

One more thought: In `tenant-resolution` unknown host, token valid. OK.

One more thought: In `tenant-config` test, `makeTenantService()` repository stub `findById` returns `tenantRow` for id. `TenantService.getConfig` uses `findById`. OK.

One more thought: In `tenant-config` test, `findTenantByHost` returns resolved with featureFlags. OK.

Now final. Ensure no path repeated. Let's list paths final:
package.json
tsconfig.json
vitest.config.ts
prisma/schema.prisma
prisma/migrations/migration_lock.toml
prisma/migrations/20260101000000_init/migration.sql
src/main.ts
src/app.module.ts
src/app/api-exception.filter.ts
src/common/api-error.ts
src/tenant/tenant.types.ts
src/tenant/tenant-context.service.ts
src/tenant/global-prisma.service.ts
src/tenant/tenant-prisma.middleware.ts
src/tenant/tenant-prisma.service.ts
src/tenant/tenant.repository.ts
src/tenant/tenant.service.ts
src/tenant/tenant-resolution.middleware.ts
src/tenant/tenant.module.ts
src/tenant-config/tenant-config.controller.ts
src/tenant-config/tenant-config.service.ts
src/tenant-config/tenant-config.module.ts
src/customer/customer.types.ts
src/customer/customer.controller.ts
src/customer/customer.service.ts
src/customer/customer.repository.ts
src/customer/customer.module.ts
test/customer-isolation.spec.ts
test/tenant-resolution.spec.ts
test/tenant-config.spec.ts

All unique.

Need maybe `src/app/api-exception.filter.ts` and `src/app.module.ts` both under src. OK.

Let's produce final.
```

## reply

### package.json
```json
{
  "name": "multi-tenant-white-label",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@prisma/client": "^5.14.0",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.0",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.0",
    "prisma": "^5.14.0",
    "typescript": "^5.5.4",
    "vitest": "^1.6.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true,
    "declaration": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
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
  host         String   @unique
  name         String
  primaryColor String   @map("primary_color")
  logoUrl      String?  @map("logo_url")
  featureFlags Json     @map("feature_flags")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  customers Customer[]
  plans     Plan[]
  orders    Order[]

  @@map("tenants")
}

model Customer {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  email     String
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orders Order[]

  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("customers")
}

model Plan {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  name       String
  priceCents Int      @map("price_cents")
  isDefault  Boolean  @default(false) @map("is_default")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  tenant Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orders Order[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("plans")
}

model Order {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  customerId String   @map("customer_id")
  planId     String   @map("plan_id")
  status     String
  totalCents Int      @map("total_cents")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  plan     Plan     @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([customerId])
  @@index([planId])
  @@map("orders")
}
```

### prisma/migrations/migration_lock.toml
```toml
provider = "postgresql"
```

### prisma/migrations/20260101000000_init/migration.sql
```sql
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primary_color" TEXT NOT NULL,
    "logo_url" TEXT,
    "feature_flags" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE UNIQUE INDEX "tenants_host_key" ON "tenants"("host");
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");
CREATE UNIQUE INDEX "plans_tenant_id_name_key" ON "plans"("tenant_id", "name");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");
CREATE INDEX "plans_tenant_id_idx" ON "plans"("tenant_id");
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");
CREATE INDEX "orders_plan_id_idx" ON "orders"("plan_id");

ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './app/api-exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(Number.isFinite(port) ? port : 3000);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TenantModule } from './tenant/tenant.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware.js';

@Module({
  imports: [TenantModule, TenantConfigModule, CustomerModule],
  providers: [TenantResolutionMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantResolutionMiddleware)
      .forRoutes({ path: '(.*)', method: RequestMethod.ALL });
  }
}
```

### src/app/api-exception.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../common/api-error.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (isApiEnvelope(body)) {
        response.status(status).json(body);
        return;
      }

      response.status(status).json({
        error: {
          code: statusCodeToCode(status),
          message: exception.message,
          details: {},
        },
      });
      return;
    }

    const known = exception as { code?: unknown; meta?: { target?: unknown } } | null;
    if (
      known &&
      typeof known === 'object' &&
      typeof known.code === 'string' &&
      known.code.startsWith('P2')
    ) {
      if (known.code === 'P2002') {
        response.status(409).json({
          error: {
            code: 'duplicate_resource',
            message: 'A resource with these unique values already exists.',
            details: { target: (known.meta?.target as Record<string, unknown>) ?? {} },
          },
        });
        return;
      }

      if (known.code === 'P2025') {
        response.status(404).json({
          error: {
            code: 'resource_not_found',
            message: 'Resource not found.',
            details: {},
          },
        });
        return;
      }
    }

    this.logger.error(`Unhandled error on ${request.method} ${request.url}`, (exception as Error)?.stack);
    response.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        details: {},
      },
    });
  }
}

function statusCodeToCode(status: number): string {
  if (status === 400) return 'validation_error';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'resource_not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'unprocessable_entity';
  if (status >= 500) return 'internal_error';
  return 'http_error';
}

function isApiEnvelope(
  value: unknown,
): value is { error: { code: string; message: string; details: Record<string, unknown> } } {
  if (value === null || typeof value !== 'object') return false;

  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return false;

  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    candidate.details !== null &&
    typeof candidate.details === 'object'
  );
}
```

### src/common/api-error.ts
```ts
import { HttpException } from '@nestjs/common';

export class ApiError extends HttpException {
  readonly code: string;
  readonly details: Record<string, unknown>;
  private readonly errorMessage: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.errorMessage = message;
    this.details = details;
  }

  getResponse(): {
    error: { code: string; message: string; details: Record<string, unknown> };
  } {
    return {
      error: {
        code: this.code,
        message: this.errorMessage,
        details: this.details,
      },
    };
  }
}
```

### src/tenant/tenant.types.ts
```ts
export interface ResolvedTenant {
  id: string;
  slug: string;
  host: string;
  name: string;
  primaryColor: string;
  logoUrl: string | null;
  featureFlags: Record<string, boolean>;
}

export interface TenantConfigDto {
  id: string;
  name: string;
  primaryColor: string;
  logoUrl: string | null;
  featureFlags: Record<string, boolean>;
}
```

### src/tenant/tenant-context.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError } from '../common/api-error.js';
import { ResolvedTenant } from './tenant.types.js';

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<ResolvedTenant>();

  run<T>(tenant: ResolvedTenant, fn: () => T | Promise<T>): T | Promise<T> {
    return this.storage.run(tenant, fn);
  }

  getTenant(): ResolvedTenant {
    const tenant = this.storage.getStore();
    if (!tenant) {
      throw new ApiError(500, 'internal_error', 'Tenant context is missing.', {});
    }
    return tenant;
  }

  getTenantId(): string {
    return this.getTenant().id;
  }
}
```

### src/tenant/global-prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class GlobalPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

### src/tenant/tenant-prisma.middleware.ts
```ts
import { TenantContextService } from './tenant-context.service.js';

const TENANT_SCOPED_MODELS = ['customer', 'plan', 'order'] as const;

export type ModelDelegate = Record<string, any>;
export type BasePrismaClient = Record<string, any>;

export interface TenantAwarePrismaClient {
  customer: ModelDelegate;
  plan: ModelDelegate;
  order: ModelDelegate;
}

const READ_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

export function createTenantAwareClient(
  base: BasePrismaClient,
  context: TenantContextService,
): TenantAwarePrismaClient {
  const client = {} as TenantAwarePrismaClient;

  for (const model of TENANT_SCOPED_MODELS) {
    const target = (base[model] ?? {}) as ModelDelegate;

    client[model] = new Proxy(target, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') {
          return value;
        }
        return wrapOperation(String(property), target, context);
      },
    });
  }

  return client;
}

function wrapOperation(operation: string, target: ModelDelegate, context: TenantContextService) {
  if (operation === 'findUnique') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'findFirst', {
        ...args,
        where: withTenantWhere(args.where, tenantId),
      });
    };
  }

  if (operation === 'findUniqueOrThrow') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'findFirstOrThrow', {
        ...args,
        where: withTenantWhere(args.where, tenantId),
      });
    };
  }

  if (READ_OPERATIONS.has(operation)) {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, operation, {
        ...args,
        where: withTenantWhere(args.where, tenantId),
      });
    };
  }

  if (operation === 'create') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'create', {
        ...args,
        data: withTenantData(args.data, tenantId),
      });
    };
  }

  if (operation === 'createMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'createMany', {
        ...args,
        data: withTenantData(args.data, tenantId),
      });
    };
  }

  if (operation === 'update') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);
      const data = withTenantData(args.data, tenantId);

      const updated = await invoke(target, 'updateMany', { where, data }) as { count: number };
      if (!updated || updated.count === 0) {
        throw prismaNotFound();
      }

      return invoke(target, 'findFirst', { where });
    };
  }

  if (operation === 'updateMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'updateMany', {
        ...args,
        where: withTenantWhere(args.where, tenantId),
        data: withTenantData(args.data, tenantId),
      });
    };
  }

  if (operation === 'delete') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);

      const existing = await invoke(target, 'findFirst', { where });
      if (!existing) {
        throw prismaNotFound();
      }

      const deleted = await invoke(target, 'deleteMany', { where }) as { count: number };
      if (!deleted || deleted.count === 0) {
        throw prismaNotFound();
      }

      return existing;
    };
  }

  if (operation === 'deleteMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'deleteMany', {
        ...args,
        where: withTenantWhere(args.where, tenantId),
      });
    };
  }

  if (operation === 'upsert') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);
      const existing = await invoke(target, 'findFirst', { where });

      if (existing) {
        await invoke(target, 'updateMany', {
          where,
          data: withTenantData(args.update, tenantId),
        });
        return invoke(target, 'findFirst', { where });
      }

      return invoke(target, 'create', {
        data: withTenantData(args.create, tenantId),
      });
    };
  }

  const fn = target[operation] as (...callArgs: any[]) => any;
  return (...callArgs: any[]) => fn.apply(target, callArgs);
}

function invoke(target: ModelDelegate, operation: string, args: Record<string, any>): Promise<any> {
  const fn = target[operation] as ((input: Record<string, any>) => any) | undefined;
  if (typeof fn !== 'function') {
    throw new Error(`Prisma operation "${operation}" is not available on the base client.`);
  }
  return Promise.resolve(fn.call(target, args));
}

function withTenantWhere(where: any, tenantId: string): Record<string, any> {
  const existing =
    where && typeof where === 'object' && !Array.isArray(where) ? { ...where } : {};
  return { ...existing, tenantId };
}

function withTenantData(data: any, tenantId: string): any {
  if (Array.isArray(data)) {
    return data.map((item) => withTenantData(item, tenantId));
  }
  if (data && typeof data === 'object') {
    return { ...data, tenantId };
  }
  return { tenantId };
}

function prismaNotFound(): Error {
  const error = new Error('Record to update or delete not found.') as Error & { code: string };
  error.code = 'P2025';
  return error;
}
```

### src/tenant/tenant-prisma.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { GlobalPrismaService } from './global-prisma.service.js';
import {
  BasePrismaClient,
  TenantAwarePrismaClient,
  createTenantAwareClient,
} from './tenant-prisma.middleware.js';

@Injectable()
export class TenantPrismaService {
  readonly client: TenantAwarePrismaClient;

  constructor(
    context: TenantContextService,
    base: GlobalPrismaService,
  ) {
    this.client = createTenantAwareClient(base as unknown as BasePrismaClient, context);
  }
}
```

### src/tenant/tenant.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from './global-prisma.service.js';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: GlobalPrismaService) {}

  findByHost(host: string) {
    return this.prisma.tenant.findUnique({ where: { host } });
  }

  findById(id: string) {
    return this.prisma.tenant.findUnique({ where: { id } });
  }
}
```

### src/tenant/tenant.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { TenantRepository } from './tenant.repository.js';
import { ResolvedTenant, TenantConfigDto } from './tenant.types.js';
import { ApiError } from '../common/api-error.js';

@Injectable()
export class TenantService {
  constructor(private readonly repository: TenantRepository) {}

  async findTenantByHost(host: string): Promise<ResolvedTenant | null> {
    const tenant = await this.repository.findByHost(host);
    return tenant ? this.toResolved(tenant) : null;
  }

  async getConfig(tenantId: string): Promise<TenantConfigDto> {
    const tenant = await this.repository.findById(tenantId);
    if (!tenant) {
      throw new ApiError(404, 'resource_not_found', 'Tenant not found.', { tenantId });
    }

    return {
      id: tenant.id,
      name: tenant.name,
      primaryColor: tenant.primaryColor,
      logoUrl: tenant.logoUrl,
      featureFlags: toFeatureFlags(tenant.featureFlags),
    };
  }

  private toResolved(tenant: Tenant): ResolvedTenant {
    return {
      id: tenant.id,
      slug: tenant.slug,
      host: tenant.host,
      name: tenant.name,
      primaryColor: tenant.primaryColor,
      logoUrl: tenant.logoUrl,
      featureFlags: toFeatureFlags(tenant.featureFlags),
    };
  }
}

function toFeatureFlags(value: unknown): Record<string, boolean> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, boolean>;
  }
  return {};
}
```

### src/tenant/tenant-resolution.middleware.ts
```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../common/api-error.js';
import { TenantContextService } from './tenant-context.service.js';
import { TenantService } from './tenant.service.js';
import { ResolvedTenant } from './tenant.types.js';

export interface TenantRequest extends Request {
  tenant?: ResolvedTenant;
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly tenantService: TenantService,
  ) {}

  async use(req: TenantRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      const host = normalizeHost(req.headers.host);
      if (!host) {
        throw new ApiError(400, 'invalid_host', 'Host header is required.', {});
      }

      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        throw new ApiError(401, 'invalid_token', 'Authorization bearer token is required.', {});
      }

      const org = verifyOrgToken(token);
      const tenant = await this.tenantService.findTenantByHost(host);
      if (!tenant) {
        throw new ApiError(400, 'unknown_host', 'Host does not map to a known tenant.', {
          host,
        });
      }

      // ASSUMPTION: The token org claim is the tenant slug, or the tenant id.
      if (org !== tenant.slug && org !== tenant.id) {
        throw new ApiError(403, 'tenant_mismatch', 'Token org claim does not match the tenant host.', {
          org,
          host,
          tenant: tenant.slug,
        });
      }

      req.tenant = tenant;
      await this.tenantContext.run(tenant, async () => {
        await next();
      });
    } catch (error) {
      next(error);
    }
  }
}

function normalizeHost(value: string | string[] | undefined): string {
  if (!value) return '';

  const raw = Array.isArray(value) ? value[0] : value;
  const host = raw.trim().toLowerCase();
  const portIndex = host.indexOf(':');
  return portIndex === -1 ? host : host.slice(0, portIndex);
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  if (!header) return null;

  const value = Array.isArray(header) ? header[0] : header;
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function verifyOrgToken(token: string): string {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret) {
    throw new ApiError(500, 'internal_error', 'AUTH_TOKEN_SECRET is not configured.', {});
  }

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    throw new ApiError(401, 'invalid_token', 'Bearer token is invalid.', {});
  }

  if (typeof payload === 'string' || typeof payload.org !== 'string') {
    throw new ApiError(401, 'invalid_token', 'Token org claim is invalid.', {});
  }

  const org = payload.org.trim();
  if (org.length === 0) {
    throw new ApiError(401, 'invalid_token', 'Token org claim is invalid.', {});
  }

  return org;
}
```

### src/tenant/tenant.module.ts
```ts
import { Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { GlobalPrismaService } from './global-prisma.service.js';
import { TenantPrismaService } from './tenant-prisma.service.js';
import { TenantRepository } from './tenant.repository.js';
import { TenantService } from './tenant.service.js';

@Module({
  providers: [
    TenantContextService,
    GlobalPrismaService,
    TenantPrismaService,
    TenantRepository,
    TenantService,
  ],
  exports: [
    TenantContextService,
    GlobalPrismaService,
    TenantPrismaService,
    TenantService,
  ],
})
export class TenantModule {}
```

### src/tenant-config/tenant-config.controller.ts
```ts
import { Controller, Get } from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service.js';
import { TenantConfigDto } from '../tenant/tenant.types.js';
import { TenantConfigService } from './tenant-config.service.js';

@Controller()
export class TenantConfigController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly service: TenantConfigService,
  ) {}

  @Get('tenant-config')
  async getTenantConfig(): Promise<TenantConfigDto> {
    const tenantId = this.tenantContext.getTenantId();
    return this.service.getConfig(tenantId);
  }
}
```

### src/tenant-config/tenant-config.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service.js';
import { TenantConfigDto } from '../tenant/tenant.types.js';

@Injectable()
export class TenantConfigService {
  constructor(private readonly tenantService: TenantService) {}

  async getConfig(tenantId: string): Promise<TenantConfigDto> {
    return this.tenantService.getConfig(tenantId);
  }
}
```

### src/tenant-config/tenant-config.module.ts
```ts
import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantConfigService } from './tenant-config.service.js';

@Module({
  imports: [TenantModule],
  controllers: [TenantConfigController],
  providers: [TenantConfigService],
})
export class TenantConfigModule {}
```

### src/customer/customer.types.ts
```ts
export interface CustomerInput {
  email: string;
  name: string;
}

export interface CustomerUpdateInput {
  email?: string;
  name?: string;
}
```

### src/customer/customer.controller.ts
```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { CustomerService } from './customer.service.js';
import { CustomerInput, CustomerUpdateInput } from './customer.types.js';

@Controller('customers')
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: { email?: unknown; name?: unknown }) {
    const email = requireString(body?.email, 'email').toLowerCase();
    validateEmail(email);
    const name = requireString(body?.name, 'name');

    const input: CustomerInput = { email, name };
    return this.service.create(input);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { email?: unknown; name?: unknown }) {
    const input: CustomerUpdateInput = {};

    if (body?.email !== undefined) {
      const email = requireString(body.email, 'email').toLowerCase();
      validateEmail(email);
      input.email = email;
    }

    if (body?.name !== undefined) {
      input.name = requireString(body.name, 'name');
    }

    if (Object.keys(input).length === 0) {
      throw new ApiError(400, 'validation_error', 'At least one updatable field must be provided.', {
        fields: ['email', 'name'],
      });
    }

    return this.service.update(id, input);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'validation_error', `${field} must be a non-empty string.`, {
      field,
    });
  }
  return value.trim();
}

function validateEmail(email: string): void {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!pattern.test(email)) {
    throw new ApiError(400, 'validation_error', 'email must be a valid email address.', {
      email,
    });
  }
}
```

### src/customer/customer.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { CustomerRepository } from './customer.repository.js';
import { CustomerInput, CustomerUpdateInput } from './customer.types.js';

@Injectable()
export class CustomerService {
  constructor(private readonly repository: CustomerRepository) {}

  list(): Promise<Customer[]> {
    return this.repository.findMany();
  }

  create(input: CustomerInput): Promise<Customer> {
    return this.repository.create(input);
  }

  async getById(id: string): Promise<Customer> {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw new ApiError(404, 'resource_not_found', 'Customer not found.', { id });
    }
    return customer;
  }

  async update(id: string, input: CustomerUpdateInput): Promise<Customer> {
    const customer = await this.repository.update(id, input);
    if (!customer) {
      throw new ApiError(404, 'resource_not_found', 'Customer not found.', { id });
    }
    return customer;
  }

  async remove(id: string): Promise<{ id: string }> {
    const deleted = await this.repository.delete(id);
    if (!deleted) {
      throw new ApiError(404, 'resource_not_found', 'Customer not found.', { id });
    }
    return deleted;
  }
}
```

### src/customer/customer.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import { CustomerInput, CustomerUpdateInput } from './customer.types.js';

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: TenantPrismaService) {}

  findMany(): Promise<Customer[]> {
    return this.prisma.client.customer.findMany({
      orderBy: { createdAt: 'asc' },
    }) as Promise<Customer[]>;
  }

  findById(id: string): Promise<Customer | null> {
    return this.prisma.client.customer.findFirst({ where: { id } }) as Promise<Customer | null>;
  }

  create(input: CustomerInput): Promise<Customer> {
    return this.prisma.client.customer.create({ data: input }) as Promise<Customer>;
  }

  async update(id: string, input: CustomerUpdateInput): Promise<Customer | null> {
    const result = await this.prisma.client.customer.updateMany({
      where: { id },
      data: input,
    }) as { count: number };

    if (result.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  async delete(id: string): Promise<{ id: string } | null> {
    const result = await this.prisma.client.customer.deleteMany({ where: { id } }) as {
      count: number;
    };

    if (result.count === 0) {
      return null;
    }

    return { id };
  }
}
```

### src/customer/customer.module.ts
```ts
import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module.js';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { CustomerRepository } from './customer.repository.js';

@Module({
  imports: [TenantModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerRepository],
})
export class CustomerModule {}
```

### test/customer-isolation.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/api-error.js';
import { CustomerRepository } from '../src/customer/customer.repository.js';
import { CustomerService } from '../src/customer/customer.service.js';
import { TenantContextService } from '../src/tenant/tenant-context.service.js';
import { createTenantAwareClient } from '../src/tenant/tenant-prisma.middleware.js';
import type { BasePrismaClient } from '../src/tenant/tenant-prisma.middleware.js';
import type { TenantPrismaService } from '../src/tenant/tenant-prisma.service.js';
import type { ResolvedTenant } from '../src/tenant/tenant.types.js';

const tenantA: ResolvedTenant = {
  id: 'tenant-a',
  slug: 'operator-a',
  host: 'app.operator-a.com',
  name: 'Operator A',
  primaryColor: '#111111',
  logoUrl: null,
  featureFlags: { billing: true },
};

const tenantB: ResolvedTenant = {
  id: 'tenant-b',
  slug: 'operator-b',
  host: 'app.operator-b.com',
  name: 'Operator B',
  primaryColor: '#222222',
  logoUrl: null,
  featureFlags: { billing: false },
};

type FakeRow = Record<string, any>;

function createFakePrismaBase(rows: FakeRow[]): BasePrismaClient {
  const db: FakeRow[] = rows.map((row) => ({ ...row }));

  const matches = (where: Record<string, any> = {}) =>
    db.filter((row) =>
      Object.entries(where).every(([key, value]) => {
        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          !(value instanceof Date)
        ) {
          return Object.entries(value as Record<string, any>).every(
            ([subKey, subValue]) => row[key] === subValue,
          );
        }
        return row[key] === value;
      }),
    );

  return {
    customer: {
      findMany: async (args: { where?: Record<string, any> } = {}) =>
        matches(args.where ?? {}).map((row) => ({ ...row })),

      findFirst: async (args: { where?: Record<string, any> } = {}) => {
        const found = matches(args.where ?? {});
        return found.length > 0 ? { ...found[0] } : null;
      },

      create: async (args: { data: Record<string, any> } = { data: {} }) => {
        const now = new Date();
        const row: FakeRow = {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...args.data,
        };

        if (row.tenantId === undefined) {
          throw Object.assign(new Error('tenantId is required'), { code: 'P2003' });
        }

        if (typeof row.tenantId === 'string' && typeof row.email === 'string') {
          const duplicate = db.some(
            (existing) => existing.tenantId === row.tenantId && existing.email === row.email,
          );
          if (duplicate) {
            throw Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
              meta: { target: ['tenant_id', 'email'] },
            });
          }
        }

        db.push(row);
        return { ...row };
      },

      updateMany: async (args: { where?: Record<string, any>; data?: Record<string, any> } = {}) => {
        const found = matches(args.where ?? {});
        for (const row of found) {
          Object.assign(row, args.data ?? {}, { updatedAt: new Date() });
        }
        return { count: found.length };
      },

      deleteMany: async (args: { where?: Record<string, any> } = {}) => {
        const found = matches(args.where ?? {});
        for (const row of found) {
          const index = db.indexOf(row);
          if (index >= 0) {
            db.splice(index, 1);
          }
        }
        return { count: found.length };
      },
    },
  };
}

function buildService() {
  const context = new TenantContextService();
  const base = createFakePrismaBase([
    {
      id: 'customer-a-1',
      tenantId: tenantA.id,
      email: 'a@example.com',
      name: 'A One',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'customer-b-1',
      tenantId: tenantB.id,
      email: 'b@example.com',
      name: 'B One',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    },
  ]);

  const client = createTenantAwareClient(base, context);
  const repository = new CustomerRepository({ client } as unknown as TenantPrismaService);
  const service = new CustomerService(repository);

  return { context, service };
}

describe('customer multi-tenant isolation', () => {
  it('lists only the current tenant customers', async () => {
    const { context, service } = buildService();

    const rows = await context.run(tenantB, async () => service.list());

    expect(rows.map((row) => row.id)).toEqual(['customer-b-1']);
    expect(rows.every((row) => row.tenantId === tenantB.id)).toBe(true);
  });

  it('returns 404 when another tenant fetches a row by id', async () => {
    const { context, service } = buildService();
    let caught: unknown;

    await context.run(tenantB, async () => {
      try {
        await service.getById('customer-a-1');
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(404);
    expect((caught as ApiError).code).toBe('resource_not_found');
  });

  it('returns 404 when another tenant updates a row', async () => {
    const { context, service } = buildService();
    let caught: unknown;

    await context.run(tenantB, async () => {
      try {
        await service.update('customer-a-1', { name: 'Hacked' });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(404);
    expect((caught as ApiError).code).toBe('resource_not_found');

    const aRows = await context.run(tenantA, async () => service.list());
    expect(aRows.find((row) => row.id === 'customer-a-1')?.name).toBe('A One');
  });

  it('returns 404 when another tenant deletes a row', async () => {
    const { context, service } = buildService();
    let caught: unknown;

    await context.run(tenantB, async () => {
      try {
        await service.remove('customer-a-1');
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(404);
    expect((caught as ApiError).code).toBe('resource_not_found');

    const aRows = await context.run(tenantA, async () => service.list());
    expect(aRows.some((row) => row.id === 'customer-a-1')).toBe(true);
  });

  it('lets a tenant update its own row', async () => {
    const { context, service } = buildService();

    const updated = await context.run(
      tenantB,
      async () => service.update('customer-b-1', { name: 'B Updated' }),
    );

    expect(updated.id).toBe('customer-b-1');
    expect(updated.name).toBe('B Updated');
  });

  it('allows the same email to be registered in two tenants', async () => {
    const { context, service } = buildService();

    const createdA = await context.run(
      tenantA,
      async () => service.create({ email: 'shared@example.com', name: 'A Shared' }),
    );
    const createdB = await context.run(
      tenantB,
      async () => service.create({ email: 'shared@example.com', name: 'B Shared' }),
    );

    expect(createdA.tenantId).toBe(tenantA.id);
    expect(createdB.tenantId).toBe(tenantB.id);

    const aRows = await context.run(tenantA, async () => service.list());
    const bRows = await context.run(tenantB, async () => service.list());

    expect(aRows.filter((row) => row.email === 'shared@example.com').map((row) => row.id)).toEqual([
      createdA.id,
    ]);
    expect(bRows.filter((row) => row.email === 'shared@example.com').map((row) => row.id)).toEqual([
      createdB.id,
    ]);
  });

  it('keeps concurrent tenant contexts isolated', async () => {
    const { context, service } = buildService();

    await Promise.all([
      context.run(tenantA, async () => {
        await service.create({ email: 'a-concurrent@example.com', name: 'A Concurrent' });
        await new Promise((resolve) => setTimeout(resolve, 5));

        const rows = await service.list();
        expect(rows.every((row) => row.tenantId === tenantA.id)).toBe(true);
        expect(rows.some((row) => row.email === 'b-concurrent@example.com')).toBe(false);
      }),
      context.run(tenantB, async () => {
        await service.create({ email: 'b-concurrent@example.com', name: 'B Concurrent' });
        await new Promise((resolve) => setTimeout(resolve, 5));

        const rows = await service.list();
        expect(rows.every((row) => row.tenantId === tenantB.id)).toBe(true);
        expect(rows.some((row) => row.email === 'a-concurrent@example.com')).toBe(false);
      }),
    ]);
  });
});
```

### test/tenant-resolution.spec.ts
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import { ApiError } from '../src/common/api-error.js';
import { TenantContextService } from '../src/tenant/tenant-context.service.js';
import { TenantResolutionMiddleware } from '../src/tenant/tenant-resolution.middleware.js';
import type { TenantRequest } from '../src/tenant/tenant-resolution.middleware.js';
import type { TenantService } from '../src/tenant/tenant.service.js';
import type { ResolvedTenant } from '../src/tenant/tenant.types.js';

const tenantA: ResolvedTenant = {
  id: 'tenant-a',
  slug: 'operator-a',
  host: 'app.operator-a.com',
  name: 'Operator A',
  primaryColor: '#111111',
  logoUrl: null,
  featureFlags: {},
};

const tenantB: ResolvedTenant = {
  id: 'tenant-b',
  slug: 'operator-b',
  host: 'app.operator-b.com',
  name: 'Operator B',
  primaryColor: '#222222',
  logoUrl: null,
  featureFlags: {},
};

const secret = 'test-secret';

beforeEach(() => {
  process.env.AUTH_TOKEN_SECRET = secret;
});

const tokenA = jwt.sign({ org: 'operator-a' }, secret, { algorithm: 'HS256' });
const tokenB = jwt.sign({ org: 'operator-b' }, secret, { algorithm: 'HS256' });

function makeMiddleware() {
  const context = new TenantContextService();
  const tenantService = {
    findTenantByHost: async (host: string): Promise<ResolvedTenant | null> => {
      if (host === tenantA.host) return tenantA;
      if (host === tenantB.host) return tenantB;
      return null;
    },
  };

  const middleware = new TenantResolutionMiddleware(
    context,
    tenantService as unknown as TenantService,
  );

  return { context, middleware };
}

function makeRequest(host?: string, token?: string): TenantRequest {
  const headers: Record<string, string> = {};
  if (host) headers.host = host;
  if (token) headers.authorization = `Bearer ${token}`;

  return { headers } as unknown as TenantRequest;
}

describe('tenant resolution middleware', () => {
  it('resolves tenant when host and org claim agree', async () => {
    const { context, middleware } = makeMiddleware();
    let observedTenantId: string | null = null;

    const next = vi.fn(async () => {
      observedTenantId = context.getTenantId();
    });

    await middleware.use(makeRequest(tenantA.host, tokenA), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(observedTenantId).toBe(tenantA.id);
  });

  it('rejects when token org does not match host', async () => {
    const { middleware } = makeMiddleware();
    const next = vi.fn();

    await middleware.use(makeRequest(tenantA.host, tokenB), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(403);
    expect((error as ApiError).code).toBe('tenant_mismatch');
  });

  it('rejects unknown host', async () => {
    const { middleware } = makeMiddleware();
    const next = vi.fn();

    await middleware.use(
      makeRequest('app.unknown.com', tokenA),
      {} as Response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(400);
    expect((error as ApiError).code).toBe('unknown_host');
  });

  it('rejects invalid token', async () => {
    const { middleware } = makeMiddleware();
    const next = vi.fn();

    await middleware.use(makeRequest(tenantA.host, 'garbage'), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(401);
    expect((error as ApiError).code).toBe('invalid_token');
  });

  it('rejects missing authorization', async () => {
    const { middleware } = makeMiddleware();
    const next = vi.fn();

    await middleware.use(makeRequest(tenantA.host), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(401);
    expect((error as ApiError).code).toBe('invalid_token');
  });

  it('rejects missing host', async () => {
    const { middleware } = makeMiddleware();
    const next = vi.fn();

    await middleware.use(makeRequest(undefined, tokenA), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(400);
    expect((error as ApiError).code).toBe('invalid_host');
  });
});
```

### test/tenant-config.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/api-error.js';
import { TenantService } from '../src/tenant/tenant.service.js';
import type { TenantRepository } from '../src/tenant/tenant.repository.js';
import { TenantConfigService } from '../src/tenant-config/tenant-config.service.js';

const tenantRow = {
  id: 'tenant-a',
  slug: 'operator-a',
  host: 'app.operator-a.com',
  name: 'Operator A',
  primaryColor: '#0f766e',
  logoUrl: 'https://cdn.example.com/logo.png',
  featureFlags: { billing: true, beta: false },
};

function makeTenantService() {
  const repository = {
    findById: async (id: string) => (id === tenantRow.id ? tenantRow : null),
    findByHost: async (host: string) => (host === tenantRow.host ? tenantRow : null),
  };

  return new TenantService(repository as unknown as TenantRepository);
}

describe('tenant config', () => {
  it('returns branding and feature flags for the resolved tenant', async () => {
    const service = new TenantConfigService(makeTenantService());

    const config = await service.getConfig(tenantRow.id);

    expect(config).toEqual({
      id: tenantRow.id,
      name: tenantRow.name,
      primaryColor: tenantRow.primaryColor,
      logoUrl: tenantRow.logoUrl,
      featureFlags: tenantRow.featureFlags,
    });
  });

  it('throws resource_not_found for an unknown tenant', async () => {
    const service = new TenantConfigService(makeTenantService());
    let caught: unknown;

    try {
      await service.getConfig('missing');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(404);
    expect((caught as ApiError).code).toBe('resource_not_found');
  });

  it('resolves a tenant by host', async () => {
    const tenantService = makeTenantService();

    const tenant = await tenantService.findTenantByHost(tenantRow.host);

    expect(tenant?.id).toBe(tenantRow.id);
    expect(tenant?.slug).toBe(tenantRow.slug);
  });
});
```


---
