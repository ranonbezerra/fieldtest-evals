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
