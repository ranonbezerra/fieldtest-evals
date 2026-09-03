# plan

## reasoning

```
Let me analyze the task carefully:

1. Multi-tenant isolation system with:
   - Tenant resolution middleware (host + token org claim must agree)
   - Structural isolation at data layer (tenant-aware Prisma client)
   - Schema for customers/plans/orders with tenant-scoped uniqueness
   - GET /tenant-config endpoint
   - Tests for isolation

Let me plan the architecture:

**Stack:** TypeScript, NestJS, Prisma, PostgreSQL, Vitest, pnpm, ESM

**Key decisions:**
- Tenant resolution: middleware extracts from `Host` header and JWT `org` claim. Both must match.
- Data isolation: Prisma `$extends` to automatically scope reads with `where: { tenantId }` and stamp writes with `data: { tenantId }`.
- Request-scoped context: use a `REQUEST` scoped provider that holds the resolved tenant.
- Schema: `tenants`, `customers`, `plans`, `orders` tables, all with `tenant_id`.

Let me think about the file layout:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/multi-tenant/multi-tenant.module.ts
src/multi-tenant/tenant-context.provider.ts (request-scoped)
src/multi-tenant/tenant-resolution.middleware.ts
src/multi-tenant/tenant-prisma.service.ts (extended prisma client)
src/customer/customer.module.ts
src/customer/customer.controller.ts
src/customer/customer.service.ts
src/customer/customer.repository.ts
src/plan/plan.module.ts
src/plan/plan.controller.ts
src/plan/plan.service.ts
src/plan/plan.repository.ts
src/order/order.module.ts
src/order/order.controller.ts
src/order/order.service.ts
src/order/order.repository.ts
src/tenant-config/tenant-config.module.ts
src/tenant-config/tenant-config.controller.ts
src/tenant-config/tenant-config.service.ts
src/tenant-config/tenant-config.repository.ts
test/multi-tenant.spec.ts
test/customer.spec.ts
test/plan.spec.ts
test/order.spec.ts
test/tenant-config.spec.ts
```

Wait, let me reconsider. The task says:
- `GET /tenant-config` — branding + feature flags for the resolved tenant.

So I need a `tenants` table with branding and feature flags.

Let me think about the tenant-aware Prisma client more carefully. The approach:
- Create a `TenantPrismaService` that wraps Prisma with `$extends`.
- The extension reads the current tenant from request-scoped context.
- Every query is automatically scoped.

Actually, in NestJS with Prisma, the typical approach is:
1. Create a `PrismaService` (singleton) that wraps the base client.
2. Create a `TenantContextService` (REQUEST scoped) that holds the current tenant ID.
3. The repository injects `TenantContextService` and passes `tenantId` to the extended client.

Wait, but the task says "handlers never pass tenantId manually." So the isolation must be transparent.

Approach: Use Prisma's `$extends` with a middleware that automatically adds `where: { tenantId }` to reads and `data: { tenantId }` to writes. The tenant ID comes from the request-scoped context.

Let me think about how to make this work in NestJS:
- `TenantContextService` is REQUEST-scoped, holds `tenantId: string`.
- The middleware resolves the tenant and sets it on this service.
- `TenantPrismaService` is also REQUEST-scoped (or the repository injects both the base Prisma and the TenantContextService, and creates an extended client per request).

Actually, a cleaner approach: 
- `PrismaService` (singleton) - base Prisma client
- `TenantPrismaService` (REQUEST scoped) - extends PrismaService with tenant scoping, injects `TenantContextService`
- Repositories inject `TenantPrismaService`

The extension:
```typescript
prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // For reads: add tenantId to where
        // For writes: add tenantId to data
      }
    }
  }
})
```

Now for the schema:

**tenants:**
- id: String (uuid, PK)
- name: String
- domain: String (unique) - e.g., "app.operator-x.com"
- branding: Json (color, logo_url, etc.)
- feature_flags: Json
- created_at: DateTime
- updated_at: DateTime

**customers:**
- id: String (uuid, PK)
- tenant_id: String (FK -> tenants.id)
- email: String
- name: String
- created_at: DateTime
- updated_at: DateTime
- Unique: [tenant_id, email]

**plans:**
- id: String (uuid, PK)
- tenant_id: String (FK -> tenants.id)
- name: String
- price_cents: Int
- created_at: DateTime
- updated_at: DateTime

**orders:**
- id: String (uuid, PK)
- tenant_id: String (FK -> tenants.id)
- customer_id: String (FK -> customers.id)
- plan_id: String (FK -> plans.id)
- status: String
- total_cents: Int
- created_at: DateTime
- updated_at: DateTime

Now for the JWT: The task says "Auth tokens carry an `org` claim." I'll assume a simple JWT verification (not building a full auth system, just verifying the token and extracting `org`).

Let me think about what endpoints we need:
- `GET /tenant-config` - returns branding + feature flags
- CRUD for customers, plans, orders (implied by the tests mentioning list, fetch-by-id, update, delete)

The task says tests should verify:
- Tenant B cannot list tenant A's rows
- Tenant B cannot fetch-by-id (expect 404) tenant A's rows
- Tenant B cannot update tenant A's rows
- Tenant B cannot delete tenant A's rows
- Same email registers in both tenants
- Concurrent requests from different tenants don't cross contexts

Let me now write the PLAN.md. I need to be concise and complete.

For the manifest, I need to list files in order where each file can only read files listed above it.

Let me structure the manifest:
1. prisma/schema.prisma | reads: -
2. src/multi-tenant/tenant-context.ts | reads: - (type/interface)
3. src/multi-tenant/tenant-prisma.service.ts | reads: src/multi-tenant/tenant-context.ts
4. src/multi-tenant/tenant-resolution.middleware.ts | reads: src/multi-tenant/tenant-context.ts
5. src/multi-tenant/multi-tenant.module.ts | reads: all above
6. src/tenant-config/tenant-config.repository.ts | reads: src/multi-tenant/tenant-prisma.service.ts, prisma/schema.prisma
7. src/tenant-config/tenant-config.service.ts | reads: src/tenant-config/tenant-config.repository.ts
8. src/tenant-config/tenant-config.controller.ts | reads: src/tenant-config/tenant-config.service.ts
9. src/tenant-config/tenant-config.module.ts | reads: all above
10. src/customer/customer.repository.ts | reads: src/multi-tenant/tenant-prisma.service.ts
11. src/customer/customer.service.ts | reads: src/customer/customer.repository.ts
12. src/customer/customer.controller.ts | reads: src/customer/customer.service.ts
13. src/customer/customer.module.ts | reads: all above
14. ... same pattern for plan and order
15. src/app.module.ts | reads: all modules
16. src/main.ts | reads: src/app.module.ts
17. test/... files

Wait, I need to think about what "reads" means in the manifest. It says "A file may name under `reads:` only files listed above it." So I need to order them so dependencies come first.

Let me reconsider the file structure. The conventions say:
- `src/<feature>/<feature>.module.ts`
- `src/<feature>/<feature>.controller.ts`
- `src/<feature>/<feature>.service.ts`
- `src/<feature>/<feature>.repository.ts`

So for multi-tenant, it's a cross-cutting concern. I'll put it in `src/multi-tenant/`.

Let me think about what the "feature" modules are:
- `src/multi-tenant/` - the tenant resolution + data isolation layer
- `src/tenant-config/` - the GET /tenant-config endpoint
- `src/customer/` - customer CRUD
- `src/plan/` - plan CRUD
- `src/order/` - order CRUD

Now let me write the plan. I need to be very precise about types and signatures.

Actually, wait. Let me reconsider whether I need separate CRUD controllers for all three entities. The task says:
- "Tests: tenant B cannot list, fetch-by-id (expect 404), update, or delete tenant A's rows"

This implies CRUD operations exist. The task doesn't explicitly list all endpoints, but the tests require them. I'll include basic CRUD for customers, plans, and orders.

Actually, re-reading: the task says "Build in TypeScript + NestJS + Prisma + Postgres:" and lists 5 items. Item 4 is specifically `GET /tenant-config`. Items 1-3 are infrastructure. The tests in item 5 reference "list, fetch-by-id, update, delete" which implies CRUD endpoints exist.

I'll include full CRUD for customers (since the email uniqueness test is about customers), and at least list/fetch/update/delete for plans and orders to support the isolation tests.

Let me be practical: I'll include CRUD endpoints for all three entities to support the tests.

Endpoints:
- `GET /tenant-config`
- `POST /customers`
- `GET /customers`
- `GET /customers/:id`
- `PATCH /customers/:id`
- `DELETE /customers/:id`
- `POST /plans`
- `GET /plans`
- `GET /plans/:id`
- `PATCH /plans/:id`
- `DELETE /plans/:id`
- `POST /orders`
- `GET /orders`
- `GET /orders/:id`
- `PATCH /orders/:id`
- `DELETE /orders/:id`

Now let me write the plan concisely.

For the JWT, I'll assume we use `jsonwebtoken` to verify and extract the `org` claim. The secret comes from env `JWT_SECRET`.

Let me finalize my structure and write it out.
```

## reply

## 1. Assumptions

- **JWT verification**: Use `jsonwebtoken` with `JWT_SECRET` env var; the token carries an `org` (string UUID) claim. No user-subject validation beyond expiry/signature.
- **Branding/flags shape**: Stored as JSONB columns; no fixed sub-schema enforced at the DB level (application reads them as `Record<string, unknown>`).
- **CRUD scope**: Full CRUD (POST, GET list, GET by id, PATCH, DELETE) for customers, plans, and orders to support the isolation tests. Endpoints follow `kebab-case` plural convention: `/customers`, `/plans`, `/orders`.
- **Request-scoped tenant context**: A NestJS `REQUEST`-scoped provider (`TenantContextService`) carries the resolved tenant ID for the lifetime of a single HTTP request. No header re-validation after middleware.
- **Prisma extension strategy**: `$extends` query-level interceptor (not a custom middleware) that injects `tenantId` into every read `where` and write `data`. The extended client is REQUEST-scoped so each request sees only its own tenant.
- **IDs**: All primary keys are UUID v4 generated at the Prisma level (`@default(uuid())`).
- **No authentication endpoints**: Token is provided by the caller (test harness); no `/login`, `/register` in scope.
- **Concurrent-request test**: Uses a Promise.all of two supertest calls with different hosts/tokens; verifies each sees only its own rows.

## 2. Data model

**tenants** (`@@map("tenants")`)

| Column | Type | Notes |
|---|---|---|
| id | String (uuid) | PK, `@default(uuid())` |
| name | String | |
| domain | String | unique, e.g. `app.operator-x.com` |
| branding | Json (JsonB) | `{ primary_color: string, logo_url: string, ... }` |
| feature_flags | Json (JsonB) | `{ plan_management: boolean, ... }` |
| created_at | DateTime | `@default(now())` |
| updated_at | DateTime | `@updatedAt` |

**customers** (`@@map("customers")`)

| Column | Type | Notes |
|---|---|---|
| id | String (uuid) | PK |
| tenant_id | String | FK → tenants.id, `@map("tenant_id")` |
| email | String | `@map("email")` |
| name | String | |
| created_at | DateTime | |
| updated_at | DateTime | |

Unique: `[tenant_id, email]` (`@@unique([tenantId, email], name: "customer_tenant_email_unique")`)

**plans** (`@@map("plans")`)

| Column | Type | Notes |
|---|---|---|
| id | String (uuid) | PK |
| tenant_id | String | FK → tenants.id |
| name | String | |
| price_cents | Int | `@map("price_cents")` |
| created_at | DateTime | |
| updated_at | DateTime | |

**orders** (`@@map("orders")`)

| Column | Type | Notes |
|---|---|---|
| id | String (uuid) | PK |
| tenant_id | String | FK → tenants.id |
| customer_id | String | FK → customers.id, `@map("customer_id")` |
| plan_id | String | FK → plans.id, `@map("plan_id")` |
| status | String | default `"pending"` |
| total_cents | Int | `@map("total_cents")` |
| created_at | DateTime | |
| updated_at | DateTime | |

## 3. Types and signatures

### `src/multi-tenant/tenant-context.service.ts`

```ts
export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

export interface TenantContext {
  readonly tenantId: string;
  readonly domain: string;
}

export declare class TenantContextService {
  constructor();
  resolve(ctx: TenantContext): void;
  get tenantId(): string;
  get domain(): string;
}
```

- `resolve` throws `TenantNotResolvedError` if called more than once per request (defensive).
- Accessing `tenantId` before `resolve` throws `TenantNotResolvedError`.

### `src/multi-tenant/tenant-resolution.middleware.ts`

```ts
export declare class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly prisma: PrismaService,
  );
  use(req: Request, res: Response, next: NextFunction): void;
}
```

- Reads `req.headers.host` and verifies the Bearer JWT → extracts `org` claim.
- Looks up tenant by `domain` in the `tenants` table (via base Prisma, no scoping).
- If tenant not found → 401 `{ error: { code: "unknown_tenant", ... } }`.
- If `org` claim ≠ resolved `tenant.id` → 403 `{ error: { code: "tenant_mismatch", ... } }`.
- On success calls `tenantCtx.resolve({ tenantId, domain })`.

### `src/multi-tenant/tenant-prisma.service.ts`

```ts
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

export interface TenantScopedModel<T> {
  // Every method present on the original delegate, with tenantId injected.
  findMany(args?: Record<string, unknown>): Promise<unknown[]>;
  findUnique(args: Record<string, unknown>): Promise<unknown | null>;
  findFirst(args?: Record<string, unknown>): Promise<unknown | null>;
  count(args?: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<unknown>;
  update(args: Record<string, unknown>): Promise<unknown>;
  delete(args: Record<string, unknown>): Promise<unknown>;
  // …(same surface as Prisma delegate)
}
```

- Internally wraps `base.$extends({ query: { $allModels: … } })`.
- Read ops (`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`): merge `{ tenantId }` into `args.where`.
- Write ops (`create`, `createMany`): merge `{ tenantId }` into `args.data`.
- Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`.

### `src/multi-tenant/prisma.service.ts`

```ts
export declare class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor();
  onModuleInit(): Promise<void>;
  onModuleDestroy(): Promise<void>;
}
```

Standard NestJS Prisma lifecycle wrapper (singleton). No tenant logic.

### `src/multi-tenant/errors.ts`

```ts
export declare class TenantMismatchError extends HttpException {
  constructor();
}
// 403 { error: { code: "tenant_mismatch", message, details } }

export declare class UnknownTenantError extends HttpException {
  constructor();
}
// 401 { error: { code: "unknown_tenant", message, details } }

export declare class ResourceNotFoundError extends HttpException {
  constructor(resource: string);
}
// 404 { error: { code: "resource_not_found", message, details } }

export declare class TenantNotResolvedError extends Error {
  constructor();
}
// Internal invariant violation (500 if it leaks)
```

### `src/multi-tenant/multi-tenant.module.ts`

```ts
@Module({
  providers: [PrismaService, TenantContextService, TenantResolutionMiddleware],
  exports: [PrismaService, TenantContextService],
})
export declare class MultiTenantModule {}
```

`TenantContextService` is `@Scope(REQUEST)`. `PrismaService` is singleton. `TenantResolutionMiddleware` is `@Scope(REQUEST)`.

### Repository pattern (applied to customer, plan, order)

```ts
// src/customer/customer.repository.ts
export declare class CustomerRepository {
  constructor(private readonly db: TenantPrismaService);
  list(): Promise<Customer[]>;
  findById(id: string): Promise<Customer | null>;
  create(input: CreateCustomerInput): Promise<Customer>;
  update(id: string, input: UpdateCustomerInput): Promise<Customer>;
  delete(id: string): Promise<void>;
}
```

Identical shape for `PlanRepository`, `OrderRepository`. Repositories never reference `tenantId` in their parameters or bodies.

### DTO / Input types (per feature, e.g. `src/customer/dto.ts`)

```ts
export interface CreateCustomerInput {
  email: string;
  name: string;
}
export interface UpdateCustomerInput {
  email?: string;
  name?: string;
}
export interface Customer {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Analogous `CreatePlanInput`, `UpdatePlanInput`, `Plan`, `CreateOrderInput`, `UpdateOrderInput`, `Order`.

### `GET /tenant-config` — `src/tenant-config/tenant-config.controller.ts`

```ts
export declare class TenantConfigController {
  constructor(private readonly svc: TenantConfigService);
  @Get('tenant-config')
  getConfig(): Promise<TenantConfigDto>;
}

export interface TenantConfigDto {
  name: string;
  domain: string;
  branding: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
}
```

### Ordering rules

- **Tenant resolution** must complete before any repository call in the same request. Enforced by NestJS middleware pipeline (middleware runs before controller).
- **TenantPrismaService** must not be instantiated as a singleton; it is REQUEST-scoped and reads `TenantContextService` (also REQUEST) at call time, not construction time.
- **Unique constraint violations** (e.g., same email twice in one tenant): the repository lets Prisma throw `P2002`; the service catches it and rethrows a `ConflictError` → 409 `{ error: { code: "conflict", ... } }`.

## 4. Control flow

### Request lifecycle (single HTTP request)

1. **Middleware** (`TenantResolutionMiddleware`): extract host + JWT `org`; query `tenants` table by domain (base Prisma, unscoped); verify match; call `TenantContextService.resolve`. On failure → immediate 401/403, short-circuit.
2. **Controller**: validate request body params (class-validator or manual); delegate to service.
3. **Service**: call repository method(s); map domain errors (not-found → 404, conflict → 409). No Prisma imports.
4. **Repository**: call `TenantPrismaService` model methods. The extension transparently injects `tenantId`. If a write affects 0 rows → throw `ResourceNotFoundError`.
5. **Response**: JSON envelope (success or error).

### Transaction boundaries

- No multi-step transactions in this scope. Each endpoint is a single atomic DB operation (one create, one update, one delete, or one read).
- If a future endpoint requires multi-row consistency, the service wraps in `db.$transaction([…])` — but the tenant scoping extension applies inside `$transaction` as well (it intercepts at the query level, not the client level).

### What must NOT be in a transaction / cross-cutting concern

- The tenant resolution lookup uses the **base** Prisma client (singleton, unscoped). It must never go through `TenantPrismaService` (chicken-and-egg: context not yet set).
- No service or repository may call `this.db.$transaction` with a callback that opens a nested query on a different tenant. The extension makes this impossible by scoping every inner query.

## 5. Tests

| Test file | Test name (abbreviated) | What it proves |
|---|---|---|
| `test/multi-tenant.spec.ts` | rejects when host and org claim disagree (403) | Mismatched tenant identity is blocked. |
| `test/multi-tenant.spec.ts` | rejects unknown domain (401) | Unregistered host yields no access. |
| `test/customer.spec.ts` | tenant B GET /customers returns only B's rows | List is scoped. |
| `test/customer.spec.ts` | tenant B GET /customers/:id-of-A → 404 | Read-by-id cannot cross tenants. |
| `test/customer.spec.ts` | tenant B PATCH /customers/:id-of-A → 404 | Update cannot cross tenants. |
| `test/customer.spec.ts` | tenant B DELETE /customers/:id-of-A → 404 | Delete cannot cross tenants. |
| `test/customer.spec.ts` | same email POST to both tenants succeeds in each | Tenant-scoped uniqueness allows duplicate emails across tenants. |
| `test/customer.spec.ts` | same email POST twice to same tenant → 409 | Uniqueness enforced within a tenant. |
| `test/plan.spec.ts` | tenant B cannot fetch/update/delete tenant A's plan (404) | Isolation extends to plans. |
| `test/order.spec.ts` | tenant B cannot fetch/update/delete tenant A's order (404) | Isolation extends to orders. |
| `test/tenant-config.spec.ts` | GET /tenant-config returns correct branding for the host | Endpoint resolves via middleware context. |
| `test/concurrency.spec.ts` | two parallel requests (different tenants) each see only own data | No cross-context leakage under concurrency. |

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Prisma schema for tenants, customers, plans, orders
src/multi-tenant/errors.ts | reads: - | TenantMismatchError, UnknownTenantError, ResourceNotFoundError, TenantNotResolvedError, ConflictError
src/multi-tenant/tenant-context.service.ts | reads: - | TenantContext interface, TenantContextService (REQUEST-scoped)
src/multi-tenant/prisma.service.ts | reads: - | PrismaService extending PrismaClient (singleton)
src/multi-tenant/tenant-resolution.middleware.ts | reads: src/multi-tenant/errors.ts, src/multi-tenant/tenant-context.service.ts, src/multi-tenant/prisma.service.ts | TenantResolutionMiddleware
src/multi-tenant/tenant-prisma.service.ts | reads: src/multi-tenant/prisma.service.ts, src/multi-tenant/tenant-context.service.ts, src/multi-tenant/errors.ts | TenantPrismaService with $extends scoping
src/multi-tenant/multi-tenant.module.ts | reads: src/multi-tenant/prisma.service.ts, src/multi-tenant/tenant-context.service.ts, src/multi-tenant/tenant-resolution.middleware.ts, src/multi-tenant/tenant-prisma.service.ts | MultiTenantModule wiring
src/customer/dto.ts | reads: - | CreateCustomerInput, UpdateCustomerInput, Customer
src/customer/customer.repository.ts | reads: src/multi-tenant/tenant-prisma.service.ts, src/customer/dto.ts | CustomerRepository
src/customer/customer.service.ts | reads: src/customer/customer.repository.ts, src/customer/dto.ts, src/multi-tenant/errors.ts | CustomerService
src/customer/customer.controller.ts | reads: src/customer/customer.service.ts, src/customer/dto.ts | CustomerController (CRUD endpoints)
src/customer/customer.module.ts | reads: src/customer/customer.controller.ts, src/customer/customer.service.ts, src/customer/customer.repository.ts, src/multi-tenant/multi-tenant.module.ts | CustomerModule
src/plan/dto.ts | reads: - | CreatePlanInput, UpdatePlanInput, Plan
src/plan/plan.repository.ts | reads: src/multi-tenant/tenant-prisma.service.ts, src/plan/dto.ts | PlanRepository
src/plan/plan.service.ts | reads: src/plan/plan.repository.ts, src/plan/dto.ts, src/multi-tenant/errors.ts | PlanService
src/plan/plan.controller.ts | reads: src/plan/plan.service.ts, src/plan/dto.ts | PlanController
src/plan/plan.module.ts | reads: src/plan/plan.controller.ts, src/plan/plan.service.ts, src/plan/plan.repository.ts, src/multi-tenant/multi-tenant.module.ts | PlanModule
src/order/dto.ts | reads: - | CreateOrderInput, UpdateOrderInput, Order
src/order/order.repository.ts | reads: src/multi-tenant/tenant-prisma.service.ts, src/order/dto.ts | OrderRepository
src/order/order.service.ts | reads: src/order/order.repository.ts, src/order/dto.ts, src/multi-tenant/errors.ts | OrderService
src/order/order.controller.ts | reads: src/order/order.service.ts, src/order/dto.ts | OrderController
src/order/order.module.ts | reads: src/order/order.controller.ts, src/order/order.service.ts, src/order/order.repository.ts, src/multi-tenant/multi-tenant.module.ts | OrderModule
src/tenant-config/dto.ts | reads: - | TenantConfigDto
src/tenant-config/tenant-config.repository.ts | reads: src/multi-tenant/tenant-prisma.service.ts | TenantConfigRepository
src/tenant-config/tenant-config.service.ts | reads: src/tenant-config/tenant-config.repository.ts, src/tenant-config/dto.ts | TenantConfigService
src/tenant-config/tenant-config.controller.ts | reads: src/tenant-config/tenant-config.service.ts, src/tenant-config/dto.ts | TenantConfigController (GET /tenant-config)
src/tenant-config/tenant-config.module.ts | reads: src/tenant-config/tenant-config.controller.ts, src/tenant-config/tenant-config.service.ts, src/tenant-config/tenant-config.repository.ts, src/multi-tenant/multi-tenant.module.ts | TenantConfigModule
src/app.module.ts | reads: src/multi-tenant/multi-tenant.module.ts, src/customer/customer.module.ts, src/plan/plan.module.ts, src/order/order.module.ts, src/tenant-config/tenant-config.module.ts | Root AppModule
src/main.ts | reads: src/app.module.ts | Bootstrap (CORS, middleware binding, listen)
test/multi-tenant.spec.ts | reads: src/main.ts | Auth/mismatch rejection tests
test/customer.spec.ts | reads: src/main.ts, test/multi-tenant.spec.ts | Customer CRUD isolation + uniqueness tests
test/plan.spec.ts | reads: src/main.ts, test/multi-tenant.spec.ts | Plan isolation tests
test/order.spec.ts | reads: src/main.ts, test/multi-tenant.spec.ts | Order isolation tests
test/tenant-config.spec.ts | reads: src/main.ts, test/multi-tenant.spec.ts | GET /tenant-config correctness
test/concurrency.spec.ts | reads: src/main.ts, test/multi-tenant.spec.ts | Parallel cross-tenant requests do not leak
-->
