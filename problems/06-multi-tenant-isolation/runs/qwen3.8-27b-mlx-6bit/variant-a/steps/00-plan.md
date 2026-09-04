# plan

## reasoning

```
Let me plan a PLAN.md for the multi-tenant isolation variant A task.

Let me think through the design carefully.

**Stack:** TypeScript, NestJS, Prisma, Postgres, Vitest, pnpm, ESM.

**Task requirements:**
1. Tenant resolution middleware: derive tenant from host + token org claim (both must agree); reject mismatches. Tenant lives in request-scoped context.
2. Structural isolation at data layer: tenant-aware Prisma client (extension/middleware) that scopes every read and stamps every write; handlers never pass tenantId manually.
3. Schema for customers/plans/orders with tenant-scoped uniqueness (same customer email may exist in two tenants).
4. `GET /tenant-config` — branding + feature flags for resolved tenant.
5. Tests: tenant B cannot list, fetch-by-id (expect 404), update, or delete tenant A's rows; same email registers in both tenants; concurrent requests from different tenants don't cross contexts.

Let me think about the pieces.

**Tenant resolution middleware:**
- Reads host from request (e.g. `app.operator-x.com`).
- Reads `org` claim from token. Token — how is it validated? Probably a JWT in Authorization header, or just an `org` claim. Let me assume: a bearer token that carries an `org` claim. We need to extract both host and org, resolve the tenant from host (mapping host -> tenant), verify org claim matches, set request-scoped context.

Actually "derive the tenant from host + token org claim (both must agree); reject mismatches." So the tenant is identified by some tenant id or slug. The host maps to a tenant (e.g., `operator-x`), and the token's org claim must equal that tenant. Both must agree.

Request-scoped context: NestJS — use AsyncLocalStorage or request property. I'll pick a `TenantContext` using AsyncLocalStorage so handlers never pass tenantId. Actually the data layer needs access to it. Using AsyncLocalStorage is cleanest — a module-level ALS instance, set in middleware, read by Prisma extension.

Let me decide: use `AsyncLocalStorage<TenantContext>` exported from a context module. Middleware sets it via `als.run(...)`. The Prisma extension reads current tenant from ALS.

**Data layer — tenant-aware Prisma client:**
Use `prisma.$extends` with a query extension that:
- On `$allModels`, for operations `findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, etc.: add `where.tenantId = currentTenant`.
- For writes (`create`/`createMany`): stamp `data.tenantId = currentTenant`.
- For `update`/`delete`: scope where by tenantId.

The problem: Prisma `$allModels` query extensions can modify `args`. For reads, we inject into `args.where`. For create, we inject into `args.data`. This is the standard pattern.

Let me write the extension function signature:
`createTenantScopedClient<T extends PrismaClient>(client: T): T` or a factory.

Actually simpler: `buildTenantAwarePrisma(base: PrismaClient): ExtendedPrismaClient`.

**Schema:**
Tenants table: id, slug (unique, from host), domain (unique), name, branding (jsonb), featureFlags (jsonb).
Customers: id, tenantId, email, name; unique on (tenantId, email).
Plans: id, tenantId, name, price; unique on (tenantId, name)? Not required but I'll add tenant-scoped uniqueness on name.
Orders: id, tenantId, customerId, planId, status, total.

Let me keep it reasonable. The task says customers/plans/orders with tenant-scoped uniqueness, and specifically customer email. I'll add:
- Customer: `@@unique([tenantId, email])`.
- Plan: `@@unique([tenantId, name])`.
- Order: no tenant-scoped unique required, just tenantId + relations.

`GET /tenant-config` returns branding + feature flags for resolved tenant — from Tenants table.

**Endpoints:** The task only explicitly requires `GET /tenant-config`. But tests reference list/fetch-by-id/update/delete for customers. So we need customer CRUD endpoints. Let me include a Customers controller with list, get-by-id, update, delete. And registration (create) to test same-email-in-both-tenants.

Let me think about the "handlers never pass tenantId manually" — controllers/services don't receive or set tenantId. The repository uses the tenant-aware client. But wait, if the service calls the repository with a customer id to fetch, and the Prisma extension scopes by tenant automatically from ALS. So `repo.findById(id)` -> `prisma.customer.findUnique({ where: { id } })` but the extension adds `tenantId`. But findUnique with a compound... Actually Prisma's `$allModels` query extension for `findUnique` — you can't add extra where constraints to findUnique in older Prisma. Hmm.

Actually the standard approach: intercept `findUnique` too by converting... No, Prisma extensions allow modifying args for findUnique but the where must match the unique fields. Adding tenantId to a findUnique by id would fail because findUnique where must be exactly the unique key.

Common workaround: In the extension, for `findUnique`, rewrite to use `findFirst`? That's hacky. Alternatively, add tenantId to the unique constraint so findUnique by `id` is per-tenant if id is globally unique — but id (uuid) is globally unique, so findUnique by id already returns the right row; we just need to verify tenant. 

Better approach: Make each row's primary key globally unique (uuid). For fetch-by-id cross-tenant, we must return 404. If we do `findUnique({where:{id}})` we'd return the row regardless of tenant — a leak. So we must scope.

Solution: In the extension, intercept `findUnique` and convert to a guarded query: do `findFirst` semantics. Actually Prisma extension `$allModels` can intercept any operation including findUnique and replace `args`. But you cannot change the operation type inside a query extension for `$allModels` (the operation is fixed). 

Alternative: Don't rely on findUnique by scalar id in repository for the isolated models. Instead use `findFirst({ where: { id } })` which accepts arbitrary where and lets us add tenantId. That's a clean choice. So the convention: repositories use `findFirst` for single-row lookups, never `findUnique` by id, so the tenant scope can be injected. I'll state this in assumptions.

Actually even simpler and robust: intercept all find* operations. For `findUnique`, we can still add tenantId to where only if... no. Let me just mandate `findFirst`. Fine.

For the extension, let me handle:
- reads (`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `groupBy`): inject `where.tenantId`.
- For `findUnique`, I'll convert... Actually I'll just say repositories use findFirst/findMany/count; the extension still defensively handles findUnique by merging into where (works if tenantId not part of unique constraint — but Prisma will reject non-unique fields in findUnique where). So mandate no findUnique.

Hmm, but `count`/`aggregate` with no args — extension creates `{ where: { tenantId } }`.

For writes:
- `create`: inject `data.tenantId` (stamp). If data.tenantId already set and differs — we just stamp ours; handlers never set it so fine.
- `createMany`: inject into each data item.
- `update`/`updateMany`/`upsert`: inject `where.tenantId`.
- `delete`/`deleteMany`: inject `where.tenantId`.

For upsert, both where and create need stamping.

Good. I'll describe this in control flow section 4 as the extension's behavior table.

Now, one nuance: the extension reads current tenant from ALS. If no tenant in context (e.g., the middleware didn't set), reject — throw an error so we fail closed. State that: if no tenant in ALS, the extension throws `TenantContextMissingError`.

**Ordering rules:** "Every ordering rule between two operations that could be written in either order." E.g., middleware must set ALS before the Prisma extension reads it (request-scoped). Tenant resolution: validate host mapping exists, then check org claim match, in that order (host first to resolve tenant slug, then compare to claim). Also create tenant-scoped uniqueness vs. the stamping.

Let me think about error envelope codes:
- `tenant_resolution_failed` or specific: host unknown -> `unknown_tenant`; mismatch -> `tenant_mismatch`. The task says "reject mismatches". I'll use `tenant_mismatch` and `unknown_tenant`. Both 403/404.
- `resource_not_found` for cross-tenant fetch (extension scoped returns undefined -> 404).
- `validation_error` for input.

**Now the files/manifest.**

Let me define layout per conventions:
- `prisma/schema.prisma`
- `src/main.ts`
- `src/app.module.ts`
- `src/tenant/tenant.module.ts`
- `src/tenant/tenant-context.ts` (ALS holder)
- `src/tenant/tenant-resolution.middleware.ts`
- `src/tenant/tenant.repository.ts`
- `src/tenant/tenant.service.ts`
- `src/tenant/tenant.controller.ts` (GET /tenant-config)
- `src/db/prisma.service.ts` (NestJS provider wrapping PrismaClient + extension)
- `src/db/tenant-aware-prisma.ts` (the extension factory)
- `src/customer/customer.module.ts`
- `src/customer/customer.controller.ts`
- `src/customer/customer.service.ts`
- `src/customer/customer.repository.ts`
- maybe plan/order repositories? The task lists customers/plans/orders in schema. Tests focus on customers. To keep scope tight but complete, I'll include plan and order models in schema but only build customer endpoints (that's what tests exercise plus tenant-config). Actually the task says "Schema for customers/plans/orders" — schema only. Tests only reference customers list/fetch/update/delete + tenant-config. So I'll build customer CRUD + tenant-config endpoints, and define plan/order in schema but not necessarily full controllers. But "Do exactly what the task asks" — task asks for schema of all three, tenant-config endpoint, and tests on customers. I'll include plan and order in schema only.

Hmm but should I build controllers for plan/order? The task doesn't require endpoints for them. Keep to customer + tenant-config. Good, minimal.

Let me reconsider: middleware registration. In main.ts, use `app.useGlobalMiddleware(TenantResolutionMiddleware)`? But NestJS middleware works at Express level before routing; ALS run must wrap the handler. Using `als.run(ctx, () => next())` inside an Express middleware is cleanest, set in main.ts via `app.use((req,res,next)=>...)`. Actually I'll register the NestJS global middleware that does `return alsStore.run(ctx, () => next())`. That wraps downstream including the controller and the Prisma calls (same async context). Good.

But wait — GET /tenant-config also needs tenant resolution (it returns resolved tenant's config). So all routes go through the middleware. Fine.

Auth token: how validated? I'll assume a JWT bearer token; we only need the `org` claim. Rather than add full JWT verification, I'll assume a lightweight approach: read `Authorization: Bearer <token>`, decode (base64) the JWT payload to get `org`. But decoding without verifying is insecure. For scope, I'll assume a `JwtService` from `@nestjs/jwt` to verify and extract `org`. Keep it simple: middleware uses JwtService.verify to get `org` claim. Host from `req.headers.host`.

Actually the task says "Auth tokens carry an org claim; requests also arrive with the tenant's host." So we have both. Let me define: token is a JWT, verified by middleware, yielding `{ org: string }` where org == tenant slug. Host like `app.operator-x.com` -> strip subdomain prefix? Or full host maps to tenant.domain. I'll map: the last two labels (e.g., `operator-x.com`) map to tenant via a lookup. Simplest: tenant has `domain` field (e.g., `operator-x.com`) and we compare the host's registrable domain. To keep it simple: derive tenant slug from host by taking the second-to-last label (`operator-x`), and match against tenant.slug. Then org claim must equal slug. 

Let me define convention: `hostToTenantSlug(host)` strips everything before and the domain suffix, returning the subdomain label. e.g. `app.operator-x.com` -> `operator-x`. I'll state this in assumptions and provide the function signature.

Hmm, but that requires knowing the base domain. I'll assume a single base domain `operator-x.com` style where slug is `<slug>.<base>`. Provide config `BASE_DOMAIN` from env. Then `hostToTenantSlug(host, baseDomain)` returns the label if host ends with `.${baseDomain}` else null.

Let me finalize.

Now types and signatures section. Let me enumerate everything.

**src/tenant/tenant-context.ts**
```ts
export interface TenantContext {
  tenantId: string;   // internal uuid
  slug: string;       // e.g. "operator-x"
  domain: string;     // e.g. "operator-x.com"
}
export const tenantStorage: AsyncLocalStorage<TenantContext>;  // from node:async_hooks
export function currentTenant(): TenantContext | undefined;
export function requireTenant(): TenantContext;  // throws TenantContextMissingError
```

**src/tenant/tenant-resolution.middleware.ts**
```ts
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(jwt: JwtService);
  use(req: Request, res: Response, next: NextFunction): Promise<void>;
}
```
Errors raised: on missing token -> 401 `unauthorized`; on bad token -> 401; on unknown host slug -> 403 `unknown_tenant`; on mismatch (org claim != slug from host) -> 403 `tenant_mismatch`.

Order: resolve host->slug first (must exist), then verify token, then compare. Actually need org from token to compare; so: extract host slug; look up tenant by slug (repository) — if not found, 403 unknown_tenant. Verify JWT -> org. If org !== slug (or org !== tenant.slug) -> 403 mismatch. Then set ALS with {tenantId, slug, domain}. 

Wait do we even need to hit DB in middleware to get tenantId? The data layer scopes by tenantId. But our extension could scope by slug instead if we store slug on rows. Hmm. Better to scope by an actual column. If rows store `tenantId` (uuid), middleware must resolve slug->uuid via DB. That's a query in middleware — fine, but then the extension reads ALS which already has tenantId. Good.

Alternatively scope by `slug` string stored on each row (denormalized) to avoid middleware DB hit. But tenant-scoped uniqueness references tenantId. I'll store `tenantId` (uuid FK) and middleware resolves it.

Actually, to keep the middleware cheap and pure, I could store slug on rows and scope by slug. But FK is cleaner and the tenant table holds branding. I'll resolve tenantId in middleware via TenantRepository.findBySlug. Acceptable.

**src/tenant/tenant.repository.ts**
```ts
export class TenantRepository {
  constructor(prisma: PrismaService);
  findBySlug(slug: string): Promise<Tenant | undefined>;
}
```
Note: this repository reads the Tenants table, which is NOT tenant-scoped (it's the registry). So it uses a plain (non-extended) prisma client, or the extension must skip scoping for the Tenant model. Important: the tenant-aware extension should only apply to tenant-scoped models (Customer, Plan, Order), not Tenant. So `$allModels` would wrongly scope Tenant reads and stamp Tenant writes. 

Decision: build the extension with an explicit model list (`$allModels` but guard by model name) OR separate clients. Cleanest: create two Prisma clients — a base `PrismaClient` (unscoped, for Tenant) and a scoped extension applied via `$extends({ query: { $allModels: ... } })` but filter out `Tenant`. In a `$allModels` query handler you get `model` param; if `model === 'Tenant'`, return without modification (and don't stamp). That works and keeps one client. I'll go with that: extension checks model name, skips `Tenant`.

So `PrismaService` exposes `.client` (the extended client). Repository for Tenant uses the same client but extension no-ops on Tenant. Good — simpler, one client.

**src/tenant/tenant.service.ts**
```ts
export class TenantService {
  constructor(repo: TenantRepository);
  getConfig(slug: string): Promise<TenantConfigDto>; // from ALS currentTenant slug
}
```
Wait, service should read tenant from ALS (requireTenant) not be passed slug, to keep "handlers never pass tenantId". So:
```ts
getConfig(): Promise<TenantConfigDto>;
```
Internally `const t = requireTenant(); return repo.findBySlug(t.slug)` then map.

**src/tenant/tenant.controller.ts**
```ts
export class TenantController {
  constructor(service: TenantService);
  @Get('tenant-config')
  getConfig(): Promise<TenantConfigDto>;
}
```

**DTO / TenantConfigDto:**
```ts
export interface TenantConfigDto {
  slug: string;
  name: string;
  branding: Record<string, unknown>;
  featureFlags: Record<string, boolean>;
}
```

**src/db/prisma.service.ts**
```ts
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly scoped: ScopedPrismaClient;
  async onModuleInit(): Promise<void>;
  async onModuleDestroy(): Promise<void>;
}
```
Hmm. PrismaClient as base NestJS provider. Then `scoped = this.$extends(...)`. Repositories inject PrismaService and use `.scoped`. But the extension must run in request ALS context at query time — the `$extends` returns a new client; calling queries on it at request time reads ALS. Good.

Let me define ScopedPrismaClient type = `Omit<ReturnType<typeof createTenantAwareClient>, ...>`? Simpler: 
```ts
export type ScopedPrismaClient = ReturnType<typeof createTenantAwareClient>;
```

**src/db/tenant-aware-prisma.ts**
```ts
export type TenantScopedModel = 'Customer' | 'Plan' | 'Order';
export function createTenantAwareClient(base: PrismaClient): ReturnType<typeof build>; 
```
Actually let me just:
```ts
export function createTenantAwareClient(base: PrismaClient) {
  return base.$extends({ query: { $allModels: tenantGuard } });
}
```
Type is inferred. I'll export the function signature as `(base: PrismaClient) => ExtendedPrismaClient` where ExtendedPrismaClient = `ReturnType<...>`. To keep resolvable, define:
```ts
import { PrismaClient } from '@prisma/client';
export function createTenantAwareClient(base: PrismaClient): ReturnType<PrismaClient['$extends'] extends (c: infer A) => infer R ? (a: A) => R : never>;
```
Too clever. I'll just say the return type is the extended client and repositories type it as that; provide a named type alias:
```ts
export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```
Circular but fine since it's a type.

Guard function:
```ts
interface GuardArgs { [key: string]: unknown }
function tenantGuard<T>(
  action: string,
  args: GuardArgs & { where?: unknown; data?: unknown },
  query: (args: any) => Promise<T>,
  model: { modelName: string },
): Promise<T>;
```
I'll describe behavior in control flow, and give signature:
```ts
export function tenantQueryGuard<T>(
  action: string,
  args: TenantQueryArgs,
  query: (args: TenantQueryArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T>;
```
where
```ts
export interface TenantQueryArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Array<Record<string, unknown>>;
}
```

Behavior table in section 4.

**Customer endpoints** (customer module):
controller:
```ts
export class CustomerController {
  constructor(service: CustomerService);
  @Get('customers') list(): Promise<CustomerDto[]>;
  @Post('customers') create(body: CreateCustomerDto): Promise<CustomerDto>;
  @Get('customers/:id') get(id: string): Promise<CustomerDto>;
  @Patch('customers/:id') update(id: string, body: UpdateCustomerDto): Promise<CustomerDto>;
  @Delete('customers/:id') remove(id: string): Promise<DeleteResult>;
}
```
Routes plural kebab-case -> `customers` (single word, fine).

service:
```ts
export class CustomerService {
  constructor(repo: CustomerRepository);
  list(): Promise<CustomerDto[]>;
  create(input: CreateCustomerDto): Promise<CustomerDto>;
  getById(id: string): Promise<CustomerDto>; // throws ResourceNotFoundError
  update(id: string, input: UpdateCustomerDto): Promise<CustomerDto>; // throws ResourceNotFoundError / ConflictError
  remove(id: string): Promise<DeleteResult>; // throws ResourceNotFoundError
}
```

repository:
```ts
export class CustomerRepository {
  constructor(prisma: PrismaService);
  list(): Promise<PrismaCustomer[]>;
  create(data: NewCustomerData): Promise<PrismaCustomer>;
  findById(id: string): Promise<PrismaCustomer | undefined>; // findFirst, tenant-scoped
  update(id: string, data: UpdateCustomerData): Promise<PrismaCustomer | undefined>;
  delete(id: string): Promise<number>; // count deleted
}
```

DTOs:
```ts
export interface CreateCustomerDto { email: string; name?: string; }
export interface UpdateCustomerDto { email?: string; name?: string; }
export interface CustomerDto { id: string; email: string; name: string | null; }
export interface NewCustomerData { email: string; name: string | null; }
export interface UpdateCustomerData { email?: string; name?: string | null; }
```

Errors: a global exception filter produces the envelope. Codes:
- `resource_not_found` (404) — raised by service when repo returns undefined/0 for get/update/delete.
- `conflict` (409) — unique constraint violation on (tenantId, email).
- `validation_error` (400).
- `unauthorized` (401), `unknown_tenant` (403), `tenant_mismatch` (403).
- `tenant_context_missing` (500) — fail closed in extension.

I'll define an error codes type:
```ts
export type ErrorCode = 'resource_not_found' | 'conflict' | 'validation_error' | 'unauthorized' | 'unknown_tenant' | 'tenant_mismatch' | 'tenant_context_missing';
```
And a filter. But do I need a global filter file? The convention says one error envelope. I'll add `src/errors/exception-filter.ts` and `src/errors/error-codes.ts`. Keep minimal.

Actually to keep the plan focused, I'll fold the filter into app.module / a small file. Let me include `src/errors/http-exception.filter.ts` and `src/errors/error-codes.ts`.

Let me reconsider manifest reads ordering. Each file can only read files listed above it. So order matters: dependencies first.

Order:
1. prisma/schema.prisma (no reads)
2. src/db/tenant-aware-prisma.ts (reads: schema? It imports @prisma/client generated from schema. But manifest "reads" is about listed files. The generated client isn't a listed file. I'll say reads: - for the db file since it depends on generated client, not a plan file. Actually it logically depends on schema types. But manifest only lists files I write; the generated client isn't one. I'll keep reads: -.)

Hmm, "A file may name under reads: only files listed above it." It's about which plan files it depends on. Let me order so that things read earlier-defined types.

Let me define a reasonable topological order:
1. `prisma/schema.prisma` | reads: -
2. `src/errors/error-codes.ts` | reads: -  (defines ErrorCode, envelope type)
3. `src/tenant/tenant-context.ts` | reads: -  (ALS; depends on node, not plan files). It may reference error-codes for TenantContextMissingError? I'll define that error in error-codes or a small errors file. Let me put exception classes in `src/errors/app-exception.ts`.

Let me consolidate errors:
`src/errors/error-codes.ts`: `ErrorCode`, `ErrorEnvelope` type.
`src/errors/app-exception.ts`: base `AppException` class with code, message, details, status; subclasses or named constructors. reads: src/errors/error-codes.ts.
`src/errors/http-exception.filter.ts`: `HttpExceptionFilter`. reads: src/errors/app-exception.ts.

Then:
- `src/db/tenant-aware-prisma.ts` reads: src/errors/app-exception.ts (throws TenantContextMissingError) + schema (not listed). I'll list reads: src/errors/app-exception.ts.
- `src/db/prisma.service.ts` reads: src/db/tenant-aware-prisma.ts.
- `src/tenant/tenant-context.ts` reads: - (self-contained; requireTenant throws app-exception -> reads src/errors/app-exception.ts).
- `src/tenant/tenant.repository.ts` reads: src/db/prisma.service.ts.
- `src/tenant/tenant-resolution.middleware.ts` reads: src/tenant/tenant-context.ts, src/tenant/tenant.repository.ts, src/errors/app-exception.ts.
- `src/tenant/tenant.service.ts` reads: src/tenant/tenant.repository.ts, src/tenant/tenant-context.ts.
- `src/tenant/tenant.controller.ts` reads: src/tenant/tenant.service.ts.
- `src/customer/*` reads prisma.service, context, etc.

Let me lay out final file list and order:

1. prisma/schema.prisma | -
2. src/errors/error-codes.ts | -
3. src/errors/app-exception.ts | error-codes.ts
4. src/errors/http-exception.filter.ts | app-exception.ts
5. src/db/tenant-aware-prisma.ts | app-exception.ts
6. src/db/prisma.service.ts | tenant-aware-prisma.ts
7. src/tenant/tenant-context.ts | app-exception.ts
8. src/tenant/tenant.repository.ts | prisma.service.ts
9. src/tenant/tenant-resolution.middleware.ts | tenant-context.ts, tenant.repository.ts, app-exception.ts
10. src/customer/customer.dto.ts | - (pure data types). Actually DTOs maybe inline in service/controller. To reduce files, I'll put DTO types in the controller or service file. But manifest wants clear. Let me keep DTOs inside their feature files to reduce count. Hmm but reads rule... I'll inline DTO interfaces in service files. Simpler: define Customer DTOs in `src/customer/customer.service.ts`.

Let me reduce file count. Combine:
- customer module: `src/customer/customer.module.ts`, `customer.controller.ts`, `customer.service.ts`, `customer.repository.ts`.
- DTOs inline in service.

- tenant module: `src/tenant/tenant.module.ts`, tenant.controller, tenant.service, tenant.repository, tenant-context, tenant-resolution.middleware.

11. src/customer/customer.repository.ts | prisma.service.ts
12. src/customer/customer.service.ts | customer.repository.ts, tenant-context.ts (maybe not needed if repo scopes automatically — service doesn't touch tenant), app-exception.ts. Reads: customer.repository.ts, app-exception.ts.
13. src/customer/customer.controller.ts | customer.service.ts
14. src/customer/customer.module.ts | reads the feature files? A module file lists providers/imports. It references controller, service, repository, PrismaModule, TenantModule. Reads: customer.controller.ts, customer.service.ts, customer.repository.ts, src/app? PrismaModule.
15. src/tenant/tenant.module.ts | tenant.controller, tenant.service, tenant.repository
16. src/app.module.ts | tenant.module, customer.module, http-exception.filter? filter is global via main or APP_FILTER. I'll register via app.module? The convention uses controller declared by module; filter global. I'll set it in main.ts via app.useGlobalFilters, or APP_FILTER provider in app.module. Let me use main.ts `app.useGlobalFilters(new HttpExceptionFilter())`. So app.module imports features.
17. src/main.ts | reads app? It bootstraps AppModule, uses global middleware + filter. Reads: src/app.module.ts, tenant-resolution.middleware.ts, http-exception.filter.ts.

Where does PrismaModule live? I'll create `src/db/prisma.module.ts` exporting PrismaService. reads: prisma.service.ts. And customer/tenant modules import it.

Let me also add PrismaModule. Reorder so prisma.module before feature modules.

Now, the middleware in main.ts: `app.useGlobalMiddleware(new TenantResolutionMiddleware(...))` — but it needs JwtService. Hmm, NestJS global middleware via app.useGlobalMiddleware can't easily get DI. Better: use a dedicated module with `forRoutes` and middleware that has constructor injection. Create `src/tenant/tenant-resolution.middleware.ts` and register it in a module with `configure(consumer){ consumer.apply(TenantResolutionMiddleware).forRoutes('*') }` in app.module. That gives DI (JwtService). 

So app.module has a `configure` method applying the middleware to all routes. Then main.ts just bootstrap + global filter. Good, cleaner. So:
- app.module imports JwtModule (global), TenantModule, CustomerModule, PrismaModule; applies middleware for all routes.

Add JwtModule config: secret from env `JWT_SECRET`. Add to assumptions.

Let me restructure reads accordingly. Middleware injected via app.module configure, so app.module reads middleware.

Final file order:
1. prisma/schema.prisma | -
2. src/errors/error-codes.ts | -
3. src/errors/app-exception.ts | error-codes.ts
4. src/errors/http-exception.filter.ts | app-exception.ts
5. src/db/tenant-aware-prisma.ts | app-exception.ts
6. src/db/prisma.service.ts | tenant-aware-prisma.ts
7. src/db/prisma.module.ts | prisma.service.ts
8. src/tenant/tenant-context.ts | app-exception.ts
9. src/tenant/tenant.repository.ts | prisma.service.ts
10. src/customer/customer.repository.ts | prisma.service.ts
11. src/customer/customer.service.ts | customer.repository.ts, app-exception.ts
12. src/customer/customer.controller.ts | customer.service.ts
13. src/tenant/tenant-resolution.middleware.ts | tenant-context.ts, tenant.repository.ts, app-exception.ts
14. src/tenant/tenant.service.ts | tenant.repository.ts, tenant-context.ts
15. src/tenant/tenant.controller.ts | tenant.service.ts
16. src/tenant/tenant.module.ts | tenant.controller, tenant.service, tenant.repository
17. src/customer/customer.module.ts | customer.controller, customer.service, customer.repository, prisma.module? (import). reads: customer.controller.ts, customer.service.ts, customer.repository.ts, src/db/prisma.module.ts
18. src/app.module.ts | tenant.module, customer.module, prisma.module, tenant-resolution.middleware.ts
19. src/main.ts | app.module.ts, http-exception.filter.ts
20. test files:
   - test/tenant-isolation.spec.ts | reads? Tests read endpoints. Manifest "reads" is plan files; tests import from src. I'll list reads: the src controllers/services they import. But tests typically hit HTTP via supertest on AppModule. Reads: src/app.module.ts, src/tenant/tenant-context.ts (to forge tokens?) Actually tests need to create JWTs and set host headers. They'd import a helper. Keep reads: src/app.module.ts.

Let me define test files:
- test/tenant-config.spec.ts | src/app.module.ts
- test/customer-isolation.spec.ts | src/app.module.ts

Two spec files. The task's test list maps to these.

Now the manifest reads for tests: they import app.module and prisma.service (to set up db / seed). I'll list reads: src/app.module.ts.

Let me make sure reads only reference files above. test files are last, so all src listed above — fine.

Now let me also double check: does customer.repository need tenant-context? No — the Prisma extension auto-scopes from ALS. Repository just calls `prisma.scoped.customer...`. Good, so customer.repository reads only prisma.service. 

Does tenant.repository use scoped or base client? Tenant model is exempted from extension, so it can use `prisma.scoped.tenant` too (extension no-ops on Tenant). Fine. It reads prisma.service.

Does middleware need to set ALS and the extension uses it — ordering: middleware sets context before controller/repo run (same async chain). State in section 4.

Now let me also handle create stamping: repository `create` passes data without tenantId; extension stamps `tenantId`. But Prisma create `data` may be nested (include). We only stamp top-level data.tenantId. Fine for simple create.

Unique constraint (tenantId,email): when extension stamps tenantId into data, the unique works per-tenant.

For update: extension adds where.tenantId; if row not in tenant, no match -> undefined -> service throws resource_not_found. Cross-tenant update blocked. 

For delete: where.tenantId; count 0 -> not found.

Now control flow section: transaction boundaries. Create a customer — single write, no explicit transaction needed. The extension is per-query. I'll say: each repository method is a single query; no multi-write transactions required for this scope. Tenant resolution: middleware does 1 read (findBySlug) then sets ALS — outside any tenant scope (ALS not yet set), using exempted Tenant model. Good.

Ordering rules to state:
- host->slug resolution and DB lookup happen before org-claim comparison? Actually we need both: look up tenant by slug from host (must exist => unknown_tenant if not). Then verify token org. Compare org === slug. Order: (1) parse host to slug, (2) load tenant by slug (unknown_tenant if missing), (3) verify JWT (unauthorized), (4) compare org to tenant.slug (tenant_mismatch). Then set ALS. I'll state this order.
- The Prisma extension must read ALS at query-execution time (not client-construction time) — so ALS set in middleware before any repository call.
- fail-closed: if ALS empty during a scoped query, throw tenant_context_missing rather than returning unscoped.

Now let me write it concisely. This is a lot; keep each section tight.

Let me now consider the schema columns precisely.

schema.prisma:
```
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model Tenant {
  id           String   @id @default(uuid()) @db.Uuid
  slug         String   @unique
  domain       String   @unique
  name         String
  branding     Json
  featureFlags Json     @default("{}")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  customers    Customer[]
  plans        Plan[]
  orders       Order[]
  @@map("tenants")
}

model Customer {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  email     String
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  orders    Order[]
  @@unique([tenantId, email])
  @@map("customers")
}

model Plan {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  name      String
  price     Int
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, name])
  @@map("plans")
}

model Order {
  id         String   @id @default(uuid()) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  customerId String   @map("customer_id") @db.Uuid
  planId     String   @map("plan_id") @db.Uuid
  status     String   @default("pending")
  total      Int
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  tenant     Tenant   @relation(fields: [tenantId], references: [id])
  customer   Customer @relation(fields: [customerId], references: [id])
  plan       Plan     @relation(fields: [planId], references: [id])
  @@map("orders")
}
```

Note: Order.customer relation to Customer means a cross-tenant FK could be an issue but we always set same tenant via stamping; tests don't create orders so fine. I'll keep it simple. Actually to reduce coupling risk in tests (which only touch customers), orders/plan relations to customer are fine since we never create them in tests.

Migration: conventions say every schema change ships with a migration. I'll note migration file `prisma/migrations/0001_init/migration.sql` — but that's a file I'd write? The plan says "list only files you will write." Migrations are auto-generated; I'll reference in assumptions that a migration is required, and optionally include the file. I'll add `prisma/migrations/0001_init/migration.sql` to manifest as a file. reads: prisma/schema.prisma.

Let me include it. Reorder to be after schema.

Now let me write PLAN.md. Keep signatures complete, bodies out.

Let me write types carefully for the guard. I'll present:

```ts
export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}
export const TENANT_SCOPED_MODELS: ReadonlySet<string>; // 'Customer'|'Plan'|'Order'
export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T>;
export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma;
export type TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>;
```

Wait, TenantAwarePrisma referencing its own creator — fine as type.

The guard actions: reads set = ['findMany','findFirst','findUnique','count','aggregate','groupBy']; writes scope where = ['update','updateMany','upsert','delete','deleteMany']; create stamp = ['create','createMany'].

Now PrismaService:
```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly scoped: TenantAwarePrisma;
  constructor(); // sets Datasource override from DATABASE_URL (already in schema env)
  async onModuleInit(): Promise<void>;
  async onModuleDestroy(): Promise<void>;
}
```
Actually if I extend PrismaClient and call this.$extends in constructor, that's fine. `this.scoped = createTenantAwareClient(this)`.

But note: `createTenantAwareClient(this)` calls `base.$extends` which returns new client sharing connection. Good.

Now app.module configure:
```ts
export class AppModule implements NestModule {
  constructor();
  configure(consumer: MiddlewareConsumer): void; // applies TenantResolutionMiddleware forRoutes('*')
}
```

main.ts:
```ts
export async function bootstrap(): Promise<void>;
```
It sets global prefix? The endpoint is `GET /tenant-config` (no prefix). So no global prefix. Good. It does `NestFactory.create(AppModule)`, `app.useGlobalFilters(new HttpExceptionFilter())`, listen.

Now the middleware signature for NestMiddleware with async run:
```ts
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantRepository, private readonly jwt: JwtService);
  use(req: Request, res: Response, next: NextFunction): Promise<void>;
}
```

hostToTenantSlug: I'll put as exported function in middleware file or a util. Put in middleware file:
```ts
export function hostToTenantSlug(host: string, baseDomain: string): string | undefined;
```
baseDomain from `process.env.TENANT_BASE_DOMAIN`.

Now the JWT: org claim. `jwt.verify(token)` returns payload with `org`. 

Now tests section, one line each:
- Tenant config: GET /tenant-config with matching host+org returns that tenant's branding/flags; wrong org claim -> 403 tenant_mismatch; unknown host -> 403 unknown_tenant.
- Customer isolation: tenant B cannot list tenant A's rows (list returns only own); fetch-by-id of A's customer under B -> 404; update A's under B -> 404; delete A's under B -> 404 (row persists).
- Same email registers in both tenants successfully.
- Concurrent requests from two tenants don't cross contexts (e.g., create+list interleaved; each sees only own).
- Cross-tenant duplicate email -> no conflict (conflict only within same tenant).

Let me write the manifest reads for tests: they use app.module and prisma.service (for DB setup/seed) and tenant-context? They need to forge tokens — a local helper, not a plan file. reads: src/app.module.ts, src/db/prisma.service.ts.

Now let me ensure the "reads:" only lists files above in manifest. Tests are at the bottom; all src above. Good.

Let me also double check ordering rule "tenant.repository reads prisma.service" — prisma.service listed above tenant.repository (item 6 vs 8). Yes.

Let me now also reconsider: do I need `customer.module` to import PrismaModule? Yes for PrismaService injection into repository. And TenantModule imports PrismaModule too. app.module imports both + prisma module (or modules export it). Convention: a provider used by another module is exported by its own module and imported. So PrismaModule exports PrismaService; feature modules import PrismaModule. Good.

Similarly does CustomerService need tenant-context? No. Does it need anything from TenantModule? No.

Does app.module need JwtModule global for middleware injection? Middleware is provided by... the module that registers it (AppModule.configure) — the middleware must be a provider in AppModule so DI gives JwtService. Actually `consumer.apply(Class)` instantiates with the root injector, requiring the middleware's deps to be available in AppModule's context. JwtModule must be imported (global) by AppModule, and TenantRepository must be available — but TenantRepository is exported from TenantModule. So AppModule imports TenantModule (for the repository) and JwtModule. The middleware class itself can be provided by AppModule or referenced directly; Nest instantiates via DI using imported modules' providers. So importing TenantModule (which provides TenantRepository) and JwtModule (global) suffices; the middleware gets both injected. Good.

So app.module reads: tenant.module.ts, customer.module.ts, prisma.module.ts, tenant-resolution.middleware.ts.

Wait app.module imports CustomerModule which internally imports PrismaModule; fine. Does app.module need prisma.module import directly? Not necessarily, but no harm; I'll include it (it's above). Actually to be minimal, app.module imports TenantModule + CustomerModule + JwtModule + applies middleware. I'll drop prisma from app.module reads to be minimal? The convention says import what you use. app.module uses JwtModule and the feature modules and middleware. So reads: tenant.module.ts, customer.module.ts, tenant-resolution.middleware.ts. I'll keep it that.

Now write it all. Keep tight. Let me draft.

I need to be mindful of output length. I'll be concise but complete.

Let me write section 3 comprehensively with signatures.

For error classes, define:
```ts
export interface ErrorEnvelope { error: { code: ErrorCode; message: string; details: Record<string, unknown> }; }
export type ErrorCode = 'resource_not_found'|'conflict'|'validation_error'|'unauthorized'|'unknown_tenant'|'tenant_mismatch'|'tenant_context_missing';

export abstract class AppException extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>);
  static resourceNotFound(id: string): AppException;        // 404
  static conflict(field: string): AppException;             // 409
  static validationError(message: string): AppException;    // 400
  static unauthorized(): AppException;                      // 401
  static unknownTenant(host: string): AppException;         // 403
  static tenantMismatch(expected: string, actual: string): AppException; // 403
  static tenantContextMissing(): AppException;              // 500
}
```

Filter:
```ts
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void; // writes ErrorEnvelope JSON with matching status
}
```

TenantContext:
```ts
export interface TenantContext { tenantId: string; slug: string; domain: string; }
export const tenantStorage: AsyncLocalStorage<TenantContext>;
export function currentTenant(): TenantContext | undefined;
export function requireTenant(): TenantContext; // throws AppException.tenantContextMissing() when absent
```

Now customer DTOs in service file:
```ts
export interface CreateCustomerDto { email: string; name?: string; }
export interface UpdateCustomerDto { email?: string; name?: string | null; }
export interface CustomerDto { id: string; email: string; name: string | null; }
```
Repository data types:
```ts
export interface NewCustomerRow { email: string; name: string | null; }
export interface UpdateCustomerRow { email?: string; name?: string | null; }
```

TenantConfigDto in tenant.service:
```ts
export interface TenantConfigDto { slug: string; name: string; branding: Record<string, unknown>; featureFlags: Record<string, boolean>; }
```

Repository returns Prisma types `PrismaCustomer` = `import { Customer } from '@prisma/client'`.

Good.

Let me finalize and write. I'll keep control flow as a table for the guard plus prose for middleware and transactions.

Time to write the output.
```

## reply

## 1. Assumptions

- **Tenant identity = `slug`.** The tenant slug is the subdomain label of the host (e.g. `app.operator-x.com` → `operator-x`) and is also the value of the token's `org` claim; both must equal the same slug. Chosen so host and token compare against one canonical key without a naming split.
- **Base domain from env.** `TENANT_BASE_DOMAIN` (e.g. `operator-x.com`) configures host→slug parsing; host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`. Keeps host parsing testable and env-driven.
- **Auth token is a JWT.** Verified with `@nestjs/jwt` (`JWT_SECRET` from env) inside the middleware; the verified payload's `org` field is the only claim we read. Single mechanism for both "token carries org" and trust.
- **Single shared DB, row-level isolation.** All tenants share the tables; isolation is enforced by `tenant_id` on every scoped row. Chosen over schema-per-tenant because the task demands a Prisma extension that scopes/stamps at query time.
- **Scoped models only.** The `tenant_id` guard applies to `Customer`, `Plan`, `Order`; the `Tenant` registry model is exempt (never stamped/scoped) so middleware can look it up before a tenant context exists. One Prisma client, guard no-ops on `Tenant`.
- **Lookups use `findFirst`, not `findUnique`, by scalar id.** The guard must inject `where.tenantId`; Prisma forbids non-unique fields in a `findUnique` where, so repositories fetch single rows via `findFirst({ where: { id } })`. Guarantees cross-tenant reads return "not found" rather than leaking.
- **Handlers never pass tenantId.** Controllers and services carry no tenant parameter; the guard reads it from request-scoped `AsyncLocalStorage`.
- **Endpoints in scope:** `GET /tenant-config` plus customer CRUD (`/customers`, `/customers/:id`) because the tests exercise list/get/update/delete and same-email registration. Plans/orders are schema-only (no endpoints).
- **Middleware registered in `AppModule.configure` for all routes** (via DI, needs `JwtService`), not in `main.ts`.
- **Error envelope is global** via `app.useGlobalFilters(new HttpExceptionFilter())` in `main.ts`.
- **Single init migration** ships with the schema.
- **No cross-row transactions required:** every repository method is one query; no multi-write units in scope.

## 2. Data model

**`tenants`** (registry, exempt from guard)
| column | type | notes |
|---|---|---|
| id | uuid PK | default uuid() |
| slug | text unique | e.g. `operator-x` |
| domain | text unique | e.g. `operator-x.com` |
| name | text | display name |
| branding | jsonb | arbitrary branding payload |
| feature_flags | jsonb | map of flag→bool, default `{}` |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | auto |

**`customers`** (scoped)
| column | type | notes |
|---|---|---|
| id | uuid PK | default uuid() |
| tenant_id | uuid FK→tenants.id | not null |
| email | text | not null |
| name | text | nullable |
| created_at / updated_at | timestamptz | |

Constraint: `@@unique([tenant_id, email])`.

**`plans`** (scoped)
| column | type | notes |
|---|---|---|
| id | uuid PK | default uuid() |
| tenant_id | uuid FK→tenants.id | not null |
| name | text | not null |
| price | int | not null |

Constraint: `@@unique([tenant_id, name])`.

**`orders`** (scoped)
| column | type | notes |
|---|---|---|
| id | uuid PK | default uuid() |
| tenant_id | uuid FK→tenants.id | not null |
| customer_id | uuid FK→customers.id | |
| plan_id | uuid FK→plans.id | |
| status | text | default `'pending'` |
| total | int | not null |
| created_at / updated_at | timestamptz | |

## 3. Types and signatures

`src/errors/error-codes.ts`
```ts
export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details: Record<string, unknown> };
}
export type ErrorCode =
  | 'resource_not_found'
  | 'conflict'
  | 'validation_error'
  | 'unauthorized'
  | 'unknown_tenant'
  | 'tenant_mismatch'
  | 'tenant_context_missing';
```

`src/errors/app-exception.ts`
```ts
export abstract class AppException extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>);
  static resourceNotFound(id: string): AppException;          // 404 resource_not_found
  static conflict(field: string): AppException;               // 409 conflict
  static validationError(message: string): AppException;      // 400 validation_error
  static unauthorized(): AppException;                        // 401 unauthorized
  static unknownTenant(host: string): AppException;           // 403 unknown_tenant
  static tenantMismatch(expected: string, actual: string): AppException; // 403
  static tenantContextMissing(): AppException;                // 500 fail-closed
}
```

`src/errors/http-exception.filter.ts`
```ts
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void;
}
```
Writes an `ErrorEnvelope` with the matching HTTP status. `AppException` → its status/code/details; Prisma unique-violation (P2002) → `conflict` 409; unknown/other → 500 with code derived from a safe default. `details` is always an object (possibly `{}`).

`src/db/tenant-aware-prisma.ts`
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
Guard behavior (see §4). Non-scoped models: returns `query(args)` unchanged. Scoped model with no tenant in ALS: throws `AppException.tenantContextMissing()`.

`src/db/prisma.service.ts`
```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly scoped: TenantAwarePrisma;
  constructor();                     // this.scoped = createTenantAwareClient(this)
  async onModuleInit(): Promise<void>;
  async onModuleDestroy(): Promise<void>;
}
```

`src/db/prisma.module.ts` — provides + exports `PrismaService`.

`src/tenant/tenant-context.ts`
```ts
export interface TenantContext { tenantId: string; slug: string; domain: string; }
export const tenantStorage: AsyncLocalStorage<TenantContext>;
export function currentTenant(): TenantContext | undefined;
export function requireTenant(): TenantContext;   // throws AppException.tenantContextMissing() if absent
```

`src/tenant/tenant.repository.ts`
```ts
export class TenantRepository {
  constructor(prisma: PrismaService);
  findBySlug(slug: string): Promise<Tenant | undefined>;
}
```

`src/customer/customer.repository.ts`
```ts
export interface NewCustomerRow { email: string; name: string | null; }
export interface UpdateCustomerRow { email?: string; name?: string | null; }

export class CustomerRepository {
  constructor(prisma: PrismaService);   // uses prisma.scoped.customer
  list(): Promise<Customer[]>;
  create(data: NewCustomerRow): Promise<Customer>;          // tenantId omitted; guard stamps it
  findById(id: string): Promise<Customer | undefined>;      // findFirst { where:{ id } }
  update(id: string, data: UpdateCustomerRow): Promise<Customer | undefined>;
  delete(id: string): Promise<number>;                       // rows deleted, 0 if none in tenant
}
```

`src/customer/customer.service.ts`
```ts
export interface CreateCustomerDto { email: string; name?: string; }
export interface UpdateCustomerDto { email?: string; name?: string | null; }
export interface CustomerDto { id: string; email: string; name: string | null; }

export class CustomerService {
  constructor(repo: CustomerRepository);
  list(): Promise<CustomerDto[]>;
  create(input: CreateCustomerDto): Promise<CustomerDto>;
  getById(id: string): Promise<CustomerDto>;   // throws AppException.resourceNotFound(id)
  update(id: string, input: UpdateCustomerDto): Promise<CustomerDto>; // throws resourceNotFound
  remove(id: string): Promise<{ deleted: boolean }>; // throws resourceNotFound
}
```
`AppException.conflict(...)` is surfaced by the filter from Prisma P2002 on `create`/`update`, not thrown here directly.

`src/customer/customer.controller.ts`
```ts
export class CustomerController {
  constructor(service: CustomerService);
  @Get('customers') list(): Promise<CustomerDto[]>;
  @Post('customers') create(@Body() body: CreateCustomerDto): Promise<CustomerDto>;
  @Get('customers/:id') get(@Param('id') id: string): Promise<CustomerDto>;
  @Patch('customers/:id') update(@Param('id') id: string, @Body() body: UpdateCustomerDto): Promise<CustomerDto>;
  @Delete('customers/:id') remove(@Param('id') id: string): Promise<{ deleted: boolean }>;
}
```

`src/tenant/tenant-resolution.middleware.ts`
```ts
export function hostToTenantSlug(host: string, baseDomain: string): string | undefined;

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(tenants: TenantRepository, jwt: JwtService);
  use(req: Request, res: Response, next: NextFunction): Promise<void>;
}
```
Raises (via `AppException`, so the filter formats them): no bearer token or invalid signature → `unauthorized` (401); host has no tenant slug → `unknown_tenant` (403); token `org` ≠ resolved slug → `tenant_mismatch` (403). On success, runs the downstream chain inside `tenantStorage.run(ctx, …)`.

`src/tenant/tenant.service.ts`
```ts
export interface TenantConfigDto {
  slug: string; name: string;
  branding: Record<string, unknown>; featureFlags: Record<string, boolean>;
}

export class TenantService {
  constructor(repo: TenantRepository);
  getConfig(): Promise<TenantConfigDto>;   // tenant from requireTenant(); throws resourceNotFound(slug) if missing
}
```

`src/tenant/tenant.controller.ts`
```ts
export class TenantController {
  constructor(service: TenantService);
  @Get('tenant-config') getConfig(): Promise<TenantConfigDto>;
}
```

`src/tenant/tenant.module.ts` — providers: `TenantRepository`, `TenantService`; controller: `TenantController`; imports `PrismaModule`.
`src/customer/customer.module.ts` — providers: `CustomerRepository`, `CustomerService`; controller: `CustomerController`; imports `PrismaModule`.
`src/app.module.ts`
```ts
export class AppModule implements NestModule {
  constructor();
  configure(consumer: MiddlewareConsumer): void; // apply(TenantResolutionMiddleware).forRoutes('*')
}
```
Imports `JwtModule` (global, `JWT_SECRET`), `TenantModule`, `CustomerModule`.
`src/main.ts`
```ts
export async function bootstrap(): Promise<void>;
```

**Ordering rules**
- Host→slug parse → load tenant by slug (`unknown_tenant` if absent) → verify JWT (`unauthorized`) → compare `org` to slug (`tenant_mismatch`) → set ALS. Comparison only after a tenant row and a valid token exist.
- `tenantStorage.run` must wrap the entire downstream handler so the Prisma guard reads a live context at query-execution time (never read from a value captured at client-construction).
- The guard evaluates per-query and is fail-closed: no tenant in ALS ⇒ throw, never run an unscoped query.

## 4. Control flow

**Request pipeline.** `main.ts` registers the global error filter; `AppModule.configure` applies `TenantResolutionMiddleware` to every route. For each request the middleware resolves and validates the tenant (see ordering above) and, on success, invokes `next()` inside `tenantStorage.run(ctx, …)`. Controllers/services run in that context and touch the DB through `PrismaService.scoped`, whose guard consults ALS at execution time.

**Prisma tenant guard (per query).** For each operation on a model in `TENANT_SCOPED_MODELS`:

| action group | actions | mutation before `query(args)` |
|---|---|---|
| reads | `findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `groupBy` | `args.where = { ...args.where, tenantId: ctx.tenantId }` |
| scope-by-id writes | `update`, `updateMany`, `upsert`, `delete`, `deleteMany` | `args.where = { ...args.where, tenantId: ctx.tenantId }`; for `upsert` also stamp `create.tenantId` |
| create writes | `create`, `createMany` | stamp `data.tenantId = ctx.tenantId` (each item for `createMany`) |

Non-scoped models (`Tenant`): pass through unchanged. No tenant in ALS: throw `tenant_context_missing`. Stamping overwrites any client-supplied `tenantId` (which never occurs — handlers omit it).

**Transaction boundaries.** None span multiple queries in scope: `CustomerRepository` methods each issue a single query, and the tenant lookup in the middleware is a single unscoped read on the exempt `Tenant` model. Nothing else is wrapped in `prisma.$transaction`.

**What must not be in the guard.** No business rules, no error mapping beyond `tenant_context_missing`, no mutation of `Tenant` rows.
**What must not be in controllers/services.** Any explicit `tenantId`, any direct Prisma call, any read of the request host/token (only the middleware does that).

## 5. Tests

- `GET /tenant-config` with a matching host and token `org` returns that tenant's branding and feature flags.
- Same host with a token whose `org` claim differs returns 403 `tenant_mismatch`.
- Host that maps to no tenant returns 403 `unknown_tenant`.
- Tenant B's `GET /customers` returns none of tenant A's rows.
- Tenant B fetches one of tenant A's customer ids via `GET /customers/:id` and receives 404 `resource_not_found`.
- Tenant B's `PATCH /customers/:id` on tenant A's row returns 404 and leaves the row unchanged.
- Tenant B's `DELETE /customers/:id` on tenant A's row returns 404 and the row still exists for tenant A.
- The same customer email registers successfully under both tenant A and tenant B (distinct rows).
- Registering the same email twice under one tenant returns 409 `conflict`.
- Interleaved concurrent requests from two tenants each see only their own tenant's rows (no context crossover in the shared Prisma client).

## 6. Manifest

    <!-- manifest
    prisma/schema.prisma | reads: - | tenants, customers, plans, orders with tenant-scoped uniqueness
    prisma/migrations/0001_init/migration.sql | reads: prisma/schema.prisma | initial table + constraint DDL
    src/errors/error-codes.ts | reads: - | ErrorEnvelope and ErrorCode contract
    src/errors/app-exception.ts | reads: src/errors/error-codes.ts | AppException with status/code/details and static factories
    src/errors/http-exception.filter.ts | reads: src/errors/app-exception.ts | global filter emitting the error envelope
    src/db/tenant-aware-prisma.ts | reads: src/errors/app-exception.ts | tenant guard + extended client factory
    src/db/prisma.service.ts | reads: src/db/tenant-aware-prisma.ts | NestJS PrismaService exposing the scoped client
    src/db/prisma.module.ts | reads: src/db/prisma.service.ts | provides/exports PrismaService
    src/tenant/tenant-context.ts | reads: src/errors/app-exception.ts | request-scoped AsyncLocalStorage and accessors
    src/tenant/tenant.repository.ts | reads: src/db/prisma.service.ts | registry lookups by slug
    src/customer/customer.repository.ts | reads: src/db/prisma.service.ts | tenant-scoped customer data access
    src/customer/customer.service.ts | reads: src/customer/customer.repository.ts, src/errors/app-exception.ts | customer business logic + DTOs
    src/customer/customer.controller.ts | reads: src/customer/customer.service.ts | /customers endpoints
    src/tenant/tenant-resolution.middleware.ts | reads: src/tenant/tenant-context.ts, src/tenant/tenant.repository.ts, src/errors/app-exception.ts | host+org resolution, mismatch rejection, ALS setup
    src/tenant/tenant.service.ts | reads: src/tenant/tenant.repository.ts, src/tenant/tenant-context.ts | resolves tenant config from context
    src/tenant/tenant.controller.ts | reads: src/tenant/tenant.service.ts | GET /tenant-config
    src/tenant/tenant.module.ts | reads: src/tenant/tenant.controller.ts, src/tenant/tenant.service.ts, src/tenant/tenant.repository.ts | wires tenant feature
    src/customer/customer.module.ts | reads: src/customer/customer.controller.ts, src/customer/customer.service.ts, src/customer/customer.repository.ts, src/db/prisma.module.ts | wires customer feature
    src/app.module.ts | reads: src/tenant/tenant.module.ts, src/customer/customer.module.ts, src/tenant/tenant-resolution.middleware.ts | root module + global middleware
    src/main.ts | reads: src/app.module.ts, src/errors/http-exception.filter.ts | bootstrap + global error filter
    test/tenant-config.spec.ts | reads: src/app.module.ts, src/db/prisma.service.ts | tenant-config success and rejection cases
    test/customer-isolation.spec.ts | reads: src/app.module.ts, src/db/prisma.service.ts | cross-tenant isolation, duplicate email, concurrency
    -->
