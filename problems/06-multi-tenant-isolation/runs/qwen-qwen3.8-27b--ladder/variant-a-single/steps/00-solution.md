# solution

## reasoning

```
We need answer user's request: produce entire solution in one reply, format mechanical with file headings and fenced blocks only, no prose. Need build multi-tenant NestJS+Prisma+Postgres per references. Need likely produce all files needed: prisma schema, main, app module, tenant module, customer module, plan? order? tenant-config, auth? tests. Need reason carefully.

We need infer file layout from conventions:
- prisma/schema.prisma
- src/main.ts
- src/app.module.ts
- src/<feature>/<feature>.module.ts
- src/<feature>/<feature>.controller.ts
- src/<feature>/<feature>.service.ts
- src/<feature>/<feature>.repository.ts
- test/<feature>.spec.ts
- pnpm, ESM, strict.
Layers: controller validates input calls service, zero business logic. service holds logic zero raw SQL zero Prisma client calls. repository only touches DB.
Errors envelope: { error: { code, message, details: {} } }.
Wiring: providers etc.
Migrations: Every schema change ships with a migration. We likely need include migration SQL? They say deliver files solution needs. Include prisma/migrations/...sql? But without generated timestamps? Need include. Since no tools, we can create migration SQL manually.
Tests Vitest. Need test behaviour. Need maybe use supertest? Not given dependencies. Need decide. Since NestJS, typical testing with NestTestingModule and supertest. But we cannot know package.json. We should include minimal package.json? The task says build whole solution; maybe include package.json, tsconfig, vitest config, .env? But conventions say layout doesn't include package.json. But to build need package.json? Maybe they expect source files only. The parser only reads file blocks. Could include package.json if needed. But "Do not create a file it does not call for". Task deliverables: tenant resolution middleware, tenant-aware Prisma client, schema, GET /tenant-config, tests. Could need main.ts/app.module etc. To run tests need config. But maybe eval expects complete codebase files. Need decide.

We must not reproduce references. Need final only headings and blocks.

We need design architecture.

Core: Tenant resolution middleware: derive tenant from host + token org claim; both agree; reject mismatches. Tenant in request-scoped context.

Need auth token org claim. We can implement simple JWT verification? Configuration env JWT_SECRET? Token header Authorization Bearer. Host header. Need tenants table with domain? To resolve tenant from host: find by domain. Token org claim: maybe org id or domain? Spec says token `org` claim. Could be tenant id? "org claim" likely tenant id. But both must point to same tenant. We can use token.org as tenant id (uuid). Host maps domain to tenant. Need verify domain exists. If token org missing invalid.

Need request-scoped context. Use AsyncLocalStorage (ALS) for tenant context. Nest middleware can set AsyncLocalStorage. Need tenant-aware Prisma client extension reads context. When no tenant in context fail. Override tenantId supplied by caller. For every read: add where tenantId. For every write: set tenantId in data.

Prisma client extension: $extends({ query: { $allModels: { async $allOperations({ args, operation, model, query }) ... } } }). Need handle operations: findUnique, findFirst, findMany, count, aggregate, groupBy, update, updateMany, upsert, create, createMany, delete, deleteMany? For reads: model operations, add tenantId. For create: data.tenantId = tenant. For update/delete: add where.tenantId. For createMany: data may be object or array, stamp. For upsert: where.tenantId, create.tenantId, update.tenantId? Update should not include tenantId? It's okay but if update data includes tenantId? Need overwrite caller-supplied tenantId by context. For update, data.tenantId = tenant (harmless) but if caller passes different, overwritten. For where, set where.tenantId = tenant, overwriting. For findUnique: args.where could be composite unique? Need tenant-aware. But if findUnique by id, we need scope. Prisma findUnique where only unique fields. To add tenantId, need if where has id: transform to findFirst? Extension query $allOperations can't change operation easily. But we can for findUnique convert to findFirst? In Prisma client extensions, can intercept query and call `query(args)` after modifying args, but operation remains findUnique; if we add non-unique tenantId to where, Prisma will error "Unknown arg tenantId" for findUnique? Let's recall. In Prisma, $extends query middleware: for findUnique, args.where must be unique. Adding non-unique field is invalid. To scope unique finds, common approach: replace findUnique with findFirst by calling `prisma[model][operation]`? In extension query handler, `query` is original query? There is `Prisma.QueryMiddleware`? For client extensions, in query.$allOperations, you can modify args and call query(args). If operation is findUnique, can't add tenantId. Need convert to findFirst maybe by calling `prisma[model] as any`? But extension receives model, operation. Could for findUnique: if model has tenantId and where.id, return prisma[model].findFirst({ where: { ...where, tenantId } }). But inside extension we don't have prisma client reference? We can capture client variable from factory.

Need tenant-aware Prisma client that scopes every read and stamps every write. Maybe implement custom factory that wraps PrismaClient and uses $use middleware? Prisma middleware can inspect parameters. For findUnique, cannot add tenantId. Could use `Prisma.defineExtension` and in $allOperations, for findUnique, call `prisma[model].findFirst`? Need access to unextended client to avoid infinite recursion. We can create base client, then extension uses base client? But we want all repositories use extended client. Factory:
```
let base: PrismaClient;
const tenantClient = base.$extends({
 query: {
  $allModels: {
   async $allOperations({ args, model, operation, query }) {
     const tenant = getTenantFromContext();
     ...
     if (operation === 'findUnique') {
       return (base as any)[model].findFirst({ where: { ...args.where, tenantId }, ...args });
     }
     return query(args);
   }
  }
 }
});
```
But base doesn't have tenant extension, so no recursion. Need ensure base is not used directly. But repositories get tenantClient. Could create `createTenantPrismaClient()` returns extended. But if findUnique calls base.findFirst, base won't enforce tenant for subsequent? It will just findFirst with tenantId where. Good. But for count/aggregate? Need add where. For create stamp. For update etc.

But if repository uses tenantClient.findUnique, we call base.findFirst. However `base.findFirst` is not tenant-aware but where includes tenantId. Good. For unique by composite? Customer email uniqueness is tenant+email. If findUnique by email? But email not globally unique; findUnique by email invalid due to composite? If using @unique([tenantId,email]), findUnique by email alone not allowed; only by id or composite? Prisma findUnique can use composite unique by passing both? For @@unique([tenantId,email]), you can't findUnique by email alone; repository should use findFirst. For id, findUnique. Need scope id.

What about `updateUnique`, `deleteUnique`? Also where unique; need add tenantId or convert to updateFirst/deleteFirst? For updateUnique: can't add non-unique tenantId. Convert to updateFirst? Need count. For deleteUnique: convert to deleteFirst? But deleteFirst returns count, not object. Acceptance: delete A's row → 404 and still exists. Could use updateFirst/deleteFirst? For delete, if count 0 throw not found. But repository may want delete object? Could return void. Better: in extension for `updateUnique` and `deleteUnique`, convert to `updateFirst`/`deleteFirst` with where+tenant. But service may expect returned object for update/delete. If delete returns { count }, service can treat count 0 as not found. Or we can for deleteUnique call base.deleteMany? But to return deleted? Not needed.

Could avoid repositories using findUnique/updateUnique/deleteUnique by using findFirst/updateFirst/deleteFirst. But spec says fetch-by-id loads by PK; we can in repository use findFirst. Yet extension should handle all. Simpler to make repositories use findFirst/updateFirst/deleteFirst/count/create, and extension only needs to scope where and stamp data. But "structural isolation" should cover every read; if a developer writes findUnique, extension should fail/scope. Need robust.

Alternative: Use Prisma `extensions` with `query` that for unique operations changes to first operations by calling `prisma[model]`. Need include operations list.

Need no tenant in context fails rather than returning everything. In extension, if no tenant, throw new TenantContextMissingError. This error should map to 400? For API requests, middleware sets tenant, so won't happen. Acceptance: a query issued with no tenant in context fails rather than returning everything. Could unit test repository with no context? Need service? We can test tenant client directly? But service zero Prisma; repository touches DB. Test could use test prisma? But maybe integration test. We can include a test for `TenantContextService`? Need no context failure. Could write unit test for `tenant-aware prisma client` with mock? But "never assert only that a call happens". We can test extension function? We can create `prisma/tenant-context.ts` with AsyncLocalStorage, getTenantId, runWithTenant. Test: run query via createTenantPrismaClient? Without DB? Could use PrismaClient with mocked adapter? Too much. Maybe test service/repository behavior with no tenant by calling repository outside context. But repository uses prisma, if no context extension throws. In integration test we can call repository directly (not via HTTP) without context and expect reject. That's acceptable? It tests behavior.

Need tests: authenticated as tenant B against tenant A's data:
- list excludes A rows
- fetch A customer by id -> 404
- update A row -> 404, unchanged
- delete A row -> 404, still exists
- same email registers in both tenants
- concurrent requests from two tenants do not cross contexts
- no tenant context query fails
Need integration tests using supertest + real Postgres? No tools. Could use Prisma in-memory? Prisma supports SQLite but Postgres specific? Need migrations. Tests in eval likely run with DATABASE_URL? Maybe they expect Vitest tests with Nest testing and supertest, using Postgres. Need include test files. Could make tests use `@prisma/client` and real DB via DATABASE_URL. We need ensure schema migration.

But maybe they don't execute? Need produce plausible complete code.

Let's design modules/features.

Features:
- tenant: Tenant resolution middleware, tenant service? tenant-config controller? GET /tenant-config.
- customer: customer resource CRUD? Need list, fetch-by-id, update, delete, create/register. Tests need customers.
- plan? order? Schema only? Deliverable schema for customers/plans/orders. Could include modules for plans/orders? Task says schema for customers/plans/orders; endpoints only tenant-config? But tests for customers. Could include minimal controllers for customer only? But structural isolation should apply to all. But to not create unnecessary files? The task asks build system with customers/plans/orders schema. Maybe include customer feature only. But if schema has Plan/Order but no modules okay. But maybe need no unused code. However tests might require register customer. Need Customer endpoints.

Tenant resolution:
- Tenant table: id (uuid), domain (unique), name, branding (Json), featureFlags (Json). Maybe `org` claim is tenant id. Domain unique.
- Middleware: for all routes? Maybe exclude /health. It reads `req.headers.host` (or x-forwarded-host?) and Authorization Bearer. Extract org from JWT payload. Need verify JWT. Configuration env `JWT_SECRET`. Could use `jsonwebtoken`? But package? Maybe we can implement simple HMAC? Better assume `@nestjs/jwt`? NestJS common. But no dependency list. We can create `JwtService` from `@nestjs/jwt`? That's standard. But to reduce deps, implement token verification with Node crypto. Yet tokens in tests need create. We can implement own `signToken` using HS256 in `src/auth/token.service.ts`. Use `jsonwebtoken` simpler. But unknown dependencies. Conventions: NestJS, Prisma, Vitest. Could include package.json with deps: @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/testing, @prisma/client, prisma, @nestjs/jwt, class-validator? But if include package.json, maybe okay. Need choose.

Maybe use `@nestjs/jwt` because standard. But if not in package.json, not runnable. Include package.json. But "Do not create file it does not call for"? For build whole solution, package.json needed. But layout doesn't include, maybe eval harness has existing package.json? The prompt: "If files are given above the task, they are the existing codebase and they are real." No files given except references. So we need create all. Include config files? It says decide file layout yourself. Need deliver every file solution needs. So include package.json, tsconfig, vitest.config.ts, .env? But no secrets, env only. We can include `.env.example`? Not secret. But maybe not needed.

Need ESM. Prisma with ESM can be tricky. Use `import { PrismaClient } from '@prisma/client';`. Need Prisma client generated. Include package.json scripts: prisma generate, prisma migrate deploy, test. Use Vitest with `globalSetup`? For Prisma migrate? Could use `vitest.config.ts` with setup that runs `prisma migrate deploy`? In test we can call `prisma.$connect`, `prisma.migrate`? Not easy. Maybe tests assume migration applied. Could include global setup that uses `execSync('pnpm prisma migrate deploy')` if DATABASE_URL. But eval may not run? We can include robust.

However final format only files. Need no prose. Need ensure TypeScript strict passes.

Let's think code details.

AsyncLocalStorage context:
```
// src/tenant/tenant-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export const tenantContextStorage = storage;
export function runWithTenantContext<T>(tenant: TenantContext, fn: () => T): T {
  return storage.run(tenant, fn);
}
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}
export function requireTenantContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) throw new TenantContextMissingError();
  return ctx;
}
export class TenantContextMissingError extends Error { ... }
```
Need maybe tenantId type.

Middleware:
- Need Nest Middleware `Use`. Use `app.useGlobalMiddleware(TenantResolutionMiddleware)` in main. Or in AppModule apply. Since all controllers protected. Need exclude /health maybe. Use `Exclude('/health')`.
- It must be async and use AsyncLocalStorage.run? In Nest middleware, if we want downstream handlers and Prisma extension to see context, we can call `next()` inside `storage.run`. Example:
```
async use(req, res, next) {
  try {
    const host = extractHost(req);
    const token = extractToken(req);
    const orgClaim = await this.tokenService.extractOrgClaim(token);
    const tenant = await this.tenantService.resolve({ host, orgId: orgClaim });
    return tenantContextStorage.run({ tenantId: tenant.id }, () => next());
  } catch (err) { this.exceptionHandler.handle(err); }
}
```
But `next()` in Nest returns Promise; inside storage.run should be fine.
- Need tenant service to find by domain and by id? It uses repository. But repository only touches DB. TenantService logic: resolve from host + org. Both must agree. Steps: find tenant by domain (host). If not found 400/404? Maybe 400 invalid host. Then verify org claim equals tenant.id. If mismatch reject 403? Need error envelope codes. Use `invalid_tenant`? `tenant_mismatch`. Let's define codes:
  - `unauthenticated` for missing/invalid token.
  - `tenant_not_found` for host not recognized.
  - `tenant_mismatch` for host and token org disagree.
  - `resource_not_found` for cross-tenant 404.
  - `validation_error` for bad input.
  - `tenant_context_missing` for no context? For internal maybe 500.
- HTTP status: mismatch 403? "rejected". Host unknown maybe 400. Invalid token 401. Need error envelope via exception filter.

Need error envelope. Implement global exception filter mapping exceptions to codes/statuses. Could use custom exceptions. Simpler: define `AppException extends Error { code; status; details }`. Filter catches AppException and unknown -> 500. Controllers/services throw `NotFoundException`? But need envelope. We can define `class TenantMismatchException extends AppException`. But Nest built-in exceptions not envelope. Better use AppException for all.

Exception filter:
```
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
 catch(exception, host) {
  const ctx = host.switchToHttp();
  const res = ctx.getResponse<Response>();
  const status = exception instanceof AppException ? exception.status : 500;
  const code = exception instanceof AppException ? exception.code : 'internal_error';
  res.status(status).json({ error: { code, message: exception.message, details: exception.details ?? {} } });
 }
}
```
Need import Express types? Use `Response` from 'express'. But if using Nest HTTP adapter, type maybe. Can use `http.ServerResponse`? Simpler:
```
const res = ctx.getResponse();
res.status(...).json(...);
```
TS strict may complain no types. We can import { Response } from 'express'. Need @types/express. Include package.json. Or use `any`? Avoid? Could do:
```
const res = ctx.getResponse<express.Response>();
```
Need `import type { Response } from 'express';`.

Controllers:
TenantConfigController:
- `@Controller()`? Endpoint `/tenant-config`. Use `@Get('tenant-config')`. Returns tenant config. Needs tenant from context? Service can require context. But layer: service holds logic. `TenantConfigService.getConfig()` uses `requireTenantContext().tenantId`, then repository.findConfigByTenantId? But repository should never manually pass tenant? Wait repositories use tenant-aware Prisma client that scopes reads/stamps writes. If repository calls `prisma.tenant.findFirst()`? Tenant table itself? Tenant is tenant? For tenant config, we need fetch current tenant row by tenantId. But tenant table rows are tenants, not tenant-scoped data. The tenant-aware extension should only apply to models with tenantId? If it applies $allModels, Tenant model has no tenantId? It would fail. Need handle models without tenantId. We can maintain a set of tenant-scoped models: Customer, Plan, Order. Tenant model is not tenant-scoped. For tenant config, repository can use base client? But repository is only layer touches DB; could use `TenantRepository` with base PrismaClient? But structural isolation only for tenant-scoped models. Tenant service needs look up tenant by domain/id. That's authentication. Could use a non-tenant-aware client for Tenant model. But if we use extended client for all, extension should ignore models not in TENANT_SCOPED_MODELS. Good.

`TenantConfigService.getConfig()` should fetch tenant row by context tenantId. It can call `tenantConfigRepository.findCurrentConfig(tenantId)`. But service knows tenantId from context? Is that "handlers never pass tenantId manually"? For tenant-scoped data, handlers/repositories never mention tenantId. But for tenant config, the tenant itself is the context; passing tenantId to fetch tenant row is okay? The spec says handlers/repositories never mention tenantId for tenant-aware client. Maybe even repository should not pass tenantId; extension can scope? But Tenant model not scoped. We can make repository method `findCurrent()` no tenantId; it uses `prisma.tenant.findFirst()`? But extension won't know which tenant. Could special-case Tenant model: scope to context tenantId? For `Tenant` model, add where.id = tenantId? But Tenant table has id, not tenantId. We can treat `id` as tenant identifier. Extension could for Tenant model on reads add `id: tenantId`? For writes stamp id? Not good. But maybe only reads. For tenant config, can have repository use context and query `prisma.tenant.findFirst({ where: { id: context.tenantId } })`. That mentions tenantId in repository. But it's the tenant resource. Maybe acceptable? "Handlers and repositories never mention tenantId" is for tenant-aware client; but if repository for tenant uses tenantId, violates? Could instead tenant-aware client extension for Tenant model automatically scopes to current tenant id. But Tenant model's identifying field is `id`, not `tenantId`. We can make extension special-case model === 'Tenant': for findUnique by id, if args.where.id != context.tenantId? overwrite with context? But then `tenantService.findDomainByHost` during auth needs base client. For tenant-config, use extended client: `tenantRepository.findCurrent()` calls `prisma.tenant.findFirst()`; extension adds `where.id = tenantId`? Then repository doesn't mention tenantId. But if service wants fetch by domain during auth, use base client or unscoped repository. Could create `TenantService` uses `PrismaService` base for auth. Hmm.

Simpler: Use `PrismaService` that provides `client` extended and `unscoped` base. But layer: repositories only touch database; can inject `PrismaService` and choose. But to keep no manual tenant, tenant-scoped repositories use `prisma.client` only.

For tenant config: `TenantConfigRepository.findCurrent()` uses `this.prisma.tenant.findFirst({ select: branding fields })`. Extension for Tenant model should add `where.id = requireTenantContext().tenantId` for findFirst? But extension currently adds `where.tenantId`; for Tenant model, add `where.id`. Need not stamp writes for Tenant because not used after bootstrap.

But during tenant resolution, we need find by domain and by id before context set. Use `TenantRepository.findDomainByHost(domain)` with unscoped prisma. But if it uses extended client, no context -> extension fails. So use unscoped. Could have `TenantRepository` methods: `findByDomain` (unscoped) and `findCurrent` (scoped). But repository touches DB. That's okay.

Alternatively resolve tenant by domain in middleware using a dedicated `TenantLookupService` with raw base client. But layering? Service can call repository.

Need tenant-aware Prisma client extension details.

Models with tenantId: Customer, Plan, Order. Need know fields.
Schema:
```
model Tenant {
  id String @id @default(uuid())
  domain String @unique
  name String
  branding Json
  featureFlags Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Customer {
  id String @id @default(uuid())
  tenantId String
  email String
  name String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("customers")
}

model Plan {
  id String @id @default(uuid())
  tenantId String
  name String
  priceCents Int
  currency String @default("usd")
  createdAt ...
  updatedAt ...
  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("plans")
}

model Order {
  id String @id @default(uuid())
  tenantId String
  customerId String
  planId String
  status String @default("pending")
  totalCents Int
  createdAt ...
  updatedAt ...
  customer Customer @relation(...)
  plan Plan @relation(...)
  @@index([tenantId])
  @@index([tenantId, customerId])
  @@index([tenantId, planId])
  @@map("orders")
}
```
Need maybe orders uniqueness? Not specified. "equivalently wherever uniqueness applies" Could add @@unique([tenantId, orderNumber])? Maybe add orderNumber string? Not necessary. But maybe order has externalOrderRef unique per tenant. To demonstrate, add `reference String` and @@unique([tenantId, reference])? Could be overkill. But schema for orders should include tenant-scoped uniqueness where applies. Add `reference String @unique`? Global? Use tenant+reference. But if tests don't use, okay.

But relations: customer/plan need inverse fields. Need tenant on relations? Relations between tenant-scoped models should also be tenant-scoped. But Prisma doesn't enforce relation across tenant except FK. If create order with customerId from another tenant, extension doesn't validate. Spec doesn't ask. Could keep simple.

Customer fields for registration: email, name. Uniqueness tenant+email. Need create duplicate email within same tenant => conflict? Need error code `duplicate_email`? Tests maybe same email registers in both tenants, not same tenant duplicate. Could handle unique constraint. Prisma unique constraint error P2002. Map to 409 `duplicate_resource`? For customer email maybe `email_taken`. Need error envelope.

Customer endpoints:
- `POST /customers` register/create. Controller validates body: email string, name string. Service create: uses repository.create(data) (no tenantId). Repository uses extended prisma customer.create({ data }). Extension stamps tenantId. If P2002, service maps? Service holds logic can catch Prisma unique error. But service zero Prisma calls; can still catch errors from repository? Repository rethrows? Could map in service. Need know Prisma error code. Could repository catch and throw AppException? Repository only touches DB but can throw domain exceptions? Maybe repository can translate DB errors to AppException. That's okay? It's data layer. Or service catches unknown error with `code`? Better repository catches Prisma.PrismaClientKnownRequestError P2002 and throws `AppException(409, 'duplicate_resource', '...', { fields: target })`. But then service doesn't need logic? It just call repo. But service holds logic; mapping DB error can be in service if it catches. However service must not import Prisma? It can import error class? Maybe okay but service zero Prisma client calls, not zero knowledge? To keep layers, repository maps persistence errors to AppException. Then service doesn't need catch.

- `GET /customers` list. Service calls repository.findMany.
- `GET /customers/:id` fetch. Repository uses `prisma.customer.findUnique({ where: { id } })` or findFirst. Extension scopes. If not found returns null. Service throws resource_not_found.
- `PATCH /customers/:id` update. Need controller validates body (email?, name?). Service update: repository.updateById(id, data). If not found 404 and row unchanged. Use `updateFirst` returns object. Extension scopes where id+tenant. If none, null. Service throws.
- `DELETE /customers/:id` delete. Repository deleteById returns count or id. If none 404.

Need "handlers never pass tenantId manually". Controllers don't. Services call repo with id/data. Repository queries don't include tenantId. Good.

But update with email: if update email to existing in same tenant, P2002. Repository maps.

TenantConfig endpoint:
`GET /tenant-config` returns { tenant: { id, name, domain }, branding, featureFlags }. Maybe no sensitive. Controller just calls service.

Auth token:
Need middleware extracts `org` claim. Implement `AuthService` or `TokenService`. Could use `@nestjs/jwt` to verify. Need generate tokens in tests. We can create utility `createTestToken(tenantId)` using same service. But if using @nestjs/jwt, tests can import JwtService and sign. Need include dependency.

Maybe implement custom `TokenService` with HS256 using Node's crypto to avoid external JWT package. But need parse/verify. Could be robust.

Custom token:
```
import { createHmac, timingSafeEqual } from 'node:crypto';
const SECRET = process.env.JWT_SECRET ?? 'test-secret' // no hardcoded? config only. For tests set env.
function base64url(buffer) ...
export class TokenService {
  verify(token: string) {
    parts...
    signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    if !timingSafeEqual(sig, signature) throw unauthenticated
    payload = JSON.parse(decode base64url)
    if payload.exp && Date.now() >= exp*1000 throw
    return payload;
  }
  sign(payload) { ... }
}
```
Need config secret from env. Use `process.env.TOKEN_SECRET`. If missing, throw? For dev maybe. In tests set.

But "Configuration comes from environment variables only. DATABASE_URL for Postgres. No secrets in repository, no hardcoded connection strings." So no default secret. TokenService should require `TOKEN_SECRET` env. In tests set `process.env.TOKEN_SECRET = 'test-secret'` before import. That's test setup.

Host extraction: `req.headers.host` maybe includes port. Domain in tenant table should be `app.operator-a.com` without port. Strip port. Use lowercased. If `x-forwarded-host`? Could prefer host. Attacker-controllable but validated against token. Use `const host = (req.headers['x-forwarded-host'] ?? req.headers.host)`. But x-forwarded can be attacker-controllable. Spec says host. Use `req.headers.host`.

Need middleware only for tenant routes. It will reject all without token. For health, exclude.

Nest setup ESM:
- main.ts:
```
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
async function bootstrap() {
 const app = await NestFactory.create(AppModule);
 app.useGlobalFilters(new AllExceptionsFilter());
 const port = Number(process.env.PORT ?? 3000); // default okay? Config from env, default maybe fine.
 await app.listen(port);
}
bootstrap();
```
ESM: import with `.js` extensions.

Modules:
- `AppModule` imports TenantModule, CustomerModule, maybe CommonModule? Provides PrismaService, TenantContext? TokenService? Need wiring.

Maybe create `src/prisma/prisma.service.ts` feature? Convention feature: src/prisma? Could be `src/prisma/prisma.service.ts` and `prisma.module.ts`. Or `src/common/prisma.service.ts`. Layout expects `<feature>`. Use `src/prisma/prisma.module.ts`, `src/prisma/prisma.service.ts`. It provides extended client and unscoped base. But extension uses tenant context. Need instantiate per app, not per request. PrismaClient extends returns client. But if use AsyncLocalStorage, single client works.

PrismaService:
```
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly unscoped: PrismaClient;
  readonly scoped: TenantScopedPrismaClient;
  constructor() {
    const base = new PrismaClient();
    this.unscoped = base;
    this.scoped = createTenantAwareClient(base);
  }
}
```
But PrismaClient constructor maybe no args. If extend, `this` not base. Could implement plain service:
```
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly base: PrismaClient;
  readonly client: TenantAwarePrismaClient;
  readonly unscoped: PrismaClient;
  constructor() { this.base = new PrismaClient(); this.client = createTenantAwareClient(this.base); this.unscoped = this.base; }
  async onModuleInit() { await this.base.$connect(); }
  async onModuleDestroy() { await this.base.$disconnect(); }
}
```
But `createTenantAwareClient` returns typed extended client. Need type.

Prisma extensions: Need ensure no tenant in context fails. For models without tenantId, ignore. For Tenant model special-case? Let's design `createTenantAwareClient(base: PrismaClient): TenantAwarePrismaClient`.

```
const TENANT_MODELS = new Set(['Customer', 'Plan', 'Order']);
const TENANT_ID_FIELD = 'tenantId';

export function createTenantAwareClient(base: PrismaClient): TenantAwarePrismaClient {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, model, operation, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const tenantId = requireTenantContext().tenantId;
          const nextArgs: any = { ...args, select: args.select, include: args.include };
          // For operations with where
          if (['findUnique','findFirst','findMany','count','aggregate','groupBy','updateUnique','updateFirst','deleteUnique','deleteFirst'].includes(operation)) { ... }
          // But findUnique etc cannot add tenantId if where unique? We'll convert unique operations to first operations.
```

Need know all operations. Could implement per operation:

Read operations:
- `findUnique`: if model has `id` and args.where.id, convert to `base[model].findFirst({ where: { ...where, tenantId }, ...rest })`. But if findUnique by composite? For customer maybe id only. Plan maybe id. Order id. Use where as is + tenantId. For `count` with where unique? count can add tenantId to where. For `findFirst`, add where.tenantId.
- `updateUnique`/`deleteUnique`: convert to `updateFirst`/`deleteFirst` with where+tenant. But `deleteFirst` returns { count }. Service may expect? We'll design repository uses `deleteFirst` directly, not unique.
- `upsert`: where unique; can't add tenantId? Upsert where must unique; can add tenantId if part of unique? For customer, id unique global, adding tenantId invalid. Could convert upsert to transaction with findFirst then create/update. But not necessary if repositories don't use upsert. But extension should maybe handle. For robust, for `upsert`, we can transform to transaction:
   - findFirst existing by where+tenant. If found, updateFirst by id+tenant with update data; else create with where data + tenantId? But where may include unique fields. Need create data from args.where. For customer where email? But email not unique global; if where id, create data needs id? Hard. Since not used, maybe leave: if no context fail, and for upsert: if where has id, we can call transaction: findFirst; updateFirst or create. But overkill. Could throw `UnsupportedOperationError`? Spec says scopes every read/stamps every write; if upsert unsupported maybe fail. But tests not use.
- `create`: data.tenantId = tenantId (overwrite). If data is array? create single.
- `createMany`: data may be object or array, stamp each.
- `updateFirst`: where.tenantId = tenantId; data.tenantId = tenantId (overwrite). But updateFirst data can be object with nested? We'll shallow set.
- `updateMany`: where.tenantId; data.tenantId.
- `deleteFirst`: where.tenantId.
- `deleteMany`: where.tensor.
- `count`: where.tenantId if args.where else { tenantId }.
- `aggregate`: groupBy? For aggregate, where. For groupBy, args.where? groupBy has `by`, `where`, `having`, `orderBy`, `_sum` etc. Add where.
- `findMany`: where.
- `findFirst`: where.
- `findRaw`? Not used.
- `executeRaw`? zero raw SQL in service; repositories only Prisma. Extension can't scope raw. We can disallow raw by throwing for `executeRaw`, `findRaw`? Not necessary.

Need type of extended client. Could type as `ReturnType<typeof createTenantAwareClient>`? But function returns base.$extends(...). We can define `export type TenantAwarePrismaClient = ReturnType<typeof createTenantAwareClient>;` But function uses base parameter; can't ReturnType directly with generic? We can define:
```
export function createTenantAwareClient(base: PrismaClient) {
  return base.$extends({...});
}
export type TenantAwarePrismaClient = ReturnType<typeof createTenantAwareClient>;
```
Works.

But inside extension, calling `base[model].findFirst` needs typing. Use `const anyBase = base as any;` to avoid TS.

Need ensure `query(args)` not called after modifying args for operations where we can modify. For findUnique conversion, call base. For operations where we modify and call `query(args)`, note `query` is the original model operation? In extension, `query` is the query function that calls through extensions? It should call the actual query with modified args. Good.

Potential issue: For `findFirst`, adding `where.tenantId` may override caller-supplied tenantId. Good. If caller supplies where: { tenantId: 'other' }, we set to context.
For `create`, if data has nested connect? We only stamp top-level data.tenantId. Good.
For `updateFirst`, if data includes nested update? top-level.

Need no tenant context: `requireTenantContext()` throws. But for `Tenant` model? We choose not to scope Tenant in extension. Then tenant config repo if uses extended client `tenant.findFirst()` won't be scoped. Could special-case Tenant model:
```
if (model === 'Tenant') {
  const tenantId = requireTenantContext().tenantId;
  if (operation === 'findFirst' || operation === 'findMany') {
     args = { ...args, where: { ...(args.where ?? {}), id: tenantId } };
  }
  return query(args);
}
```
But if `findUnique` by id, convert? For tenant config, use findFirst. Good.
But during auth, no context; if accidentally use extended client for Tenant, it fails. We'll use unscoped for lookup.

However if extension special-cases Tenant for findFirst, then `TenantConfigRepository.findCurrent()` using scoped client `prisma.tenant.findFirst({ select: ... })` returns current tenant only. If not found? But context tenant should exist; if missing, throw resource_not_found? Could be 500. Use `tenant_not_found`? Maybe `resource_not_found`.

Need tenant-aware client fail when no tenant in context for scoped models. Good.

But "a tenantId supplied by a caller is overwritten by the context, not trusted" for reads/writes. In our extension, for reads where tenantId overwritten; for create data overwritten; update data overwritten. Good.

Need concurrent requests from different tenants don't cross contexts. AsyncLocalStorage handles. Test can use Promise.all with supertest requests? Each request middleware sets context and runs next inside storage.run. Prisma extension reads context within same async context. Good.

Need tests. We can write one integration spec `test/multi-tenant.spec.ts`? Layout says `test/<feature>.spec.ts`. Could have `test/tenant-isolation.spec.ts`. Need test deliverables. Maybe `test/customer.spec.ts` and `test/tenant-config.spec.ts`? The acceptance tests are tenant isolation. Could one file.

Testing approach:
- Use Nest testing module with supertest.
- Create app with AppModule? Need override PrismaService? Use real Prisma. Need ensure test database. Could use `prisma migrate deploy` in beforeAll. But if eval has no DB? Hmm. Could use `sqlite`? But spec says PostgreSQL. Could use `PrismaClient` with `datasource url` env. Tests should rely on `DATABASE_URL`. Need no secrets; test can set if not present? But no hardcoded connection? In tests, we can assume environment provides. But for standalone, maybe use `postgresql://postgres:postgres@localhost:5432/fieldtest?schema=public`? That is hardcoded connection string, not allowed? "No secrets in repository, no hardcoded connection strings." So don't.
- In test setup, before importing, set `process.env.TOKEN_SECRET ??= 'test-secret'`? Is that secret hardcoded? It's test-only. But "No secrets in repository" maybe avoid. Could set if missing? Maybe not. But to run tests, need. Could use `process.env.TOKEN_SECRET = process.env.TOKEN_SECRET ?? 'test-only-secret'`. Is that a secret? It's test fixture. But convention says no secrets in repo. Could be okay? Maybe avoid by requiring env. But tests then fail without env. Usually tests set dummy env. "No secrets" means production secrets. Dummy test secret is not secret. But to be safe, set only if absent with `'test-secret'`. It's in repo. Hmm.

Need migration file. We can include `prisma/migrations/0001_init/migration.sql`. But Prisma expects `migration_lock.toml` too. Could include. But if we include manual migration with table names, maybe enough. However "Every schema change ships with a migration." Need include SQL.

Manual migration SQL for schema:
```
-- CreateEnum? Not needed.
CREATE TABLE "tenants" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "domain" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "branding" JSONB NOT NULL,
  "featureFlags" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");
...
```
Need column mapping. Use `@map`? Schema table snake_case via @@map. Columns default same name? Need `tenant_id` etc via @map. In schema, use `tenantId String @map("tenant_id")`. Table `@@map("customers")`. Migration must reflect snake_case columns.
Prisma default uuid function: For Postgres, `@default(uuid())` generates `gen_random_uuid()`. Need ensure Postgres 13+.

SQL:
```
CREATE TABLE "tenants" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "domain" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "branding" JSONB NOT NULL,
  "feature_flags" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

CREATE TABLE "customers" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

CREATE TABLE "plans" ... "price_cents" INT, "currency" TEXT
CREATE UNIQUE INDEX "plans_tenant_id_name_key" ...

CREATE TABLE "orders" (
  "id" TEXT ...,
  "tenant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "total_cents" INT NOT NULL,
  "reference" TEXT NOT NULL,
  created_at, updated_at,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "orders_tenant_id_reference_key" ON "orders"("tenant_id", "reference");
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");
CREATE INDEX "orders_tenant_id_customer_id_idx" ON "orders"("tenant_id", "customer_id");
CREATE INDEX "orders_tenant_id_plan_id_idx" ON "orders"("tenant_id", "plan_id");
```
But if no references? Need order reference maybe optional? Use NOT NULL. Tests not create orders. Fine.

But Prisma schema with `reference String` and @@unique. Need relation fields:
```
model Order {
  ...
  customer Customer @relation(fields: [customerId], references: [id], onDelete: Restrict)
  plan Plan @relation(fields: [planId], references: [id], onDelete: Restrict)
}
model Customer { ... orders Order[] }
model Plan { ... orders Order[] }
```
Need tenant on relation? Not enforced.

Need JSON default? For Tenant branding and featureFlags, can use `Json @default("{}")`. But create tenant in seed/tests needs provide. Maybe default empty object.

Seed/bootstrap tenants? Tests need two tenants. Could create in test using unscoped Prisma. No need seed. But app startup maybe no tenants. Tests create A and B.

Testing details:
Need create Nest app. We can import `AppModule` and `overrideProvider(PrismaService)`? If use real Prisma, okay. But need ensure PrismaClient connects. Could use `Test.createTestingModule({ imports: [AppModule] })`. Need set `process.env.DATABASE_URL` before importing Prisma? In Vitest, imports evaluated. We can set at top of test file before dynamic import? Use `process.env.TOKEN_SECRET = 'test-secret';` at top. DATABASE_URL assumed.

Need cleanup between tests: truncate tables. Use `prisma.$executeRawUnsafe('TRUNCATE ... CASCADE')`? Zero raw SQL in service, but test can use raw? It's test. Could use Prisma deleteMany. But test file can use unscoped prisma. Need avoid raw? No rule for tests? Better use prisma deleteMany. But need delete order before customer due FK. Use unscoped:
```
await prisma.unscoped.order.deleteMany();
await prisma.unscoped.customer.deleteMany();
await prisma.unscoped.plan.deleteMany();
await prisma.unscoped.tenant.deleteMany();
```
But `unscoped` property on PrismaService. Inject in test.

Need create tenants in test. Use `prisma.unscoped.tenant.create({ data: { domain: 'app.operator-a.com', name: 'Operator A', branding: {...}, featureFlags: {...} } })`. Need token for each: `tokenService.sign({ org: tenant.id, sub: 'user' })`. If using custom TokenService, inject from app. But TokenService may require TOKEN_SECRET env. We can sign in tests.

Need middleware uses `TokenService`. Need module providers.

Potential issue: `AsyncLocalStorage.run` and Nest exception handling. If next throws, storage context ends. Exception filter runs after? In middleware, if `next()` rejects, catch and handle. But Nest's global exception filter may already handle if exception propagates from controller? If we catch inside middleware and call filter, okay. But if we call `this.exceptionHandler.handle(error)`, need not also `next`. Good.

Middleware code:
```
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantResolutionMiddleware.name);
  constructor(
    private readonly tenantService: TenantService,
    private readonly tokenService: TokenService,
    private readonly exceptionHandler: ExceptionHandler,
  ) {}
  async use(req: Request, res: Response, next: () => Promise<void>): Promise<void> {
    const host = extractHost(req);
    if (!host) { this.reject(new AppException(400, 'missing_host', ...), res); return; }
    const token = extractBearerToken(req);
    if (!token) { this.reject(new AppException(401, 'unauthenticated', ...), res); return; }
    let payload;
    try { payload = this.tokenService.verify(token); } catch { reject 401 }
    const orgClaim = typeof payload.org === 'string' ? payload.org : undefined;
    if (!orgClaim) reject 401? or 400 invalid_token.
    let tenant: Tenant;
    try { tenant = await this.tenantService.resolve({ host, orgId: orgClaim }); } catch (e) { reject e }
    try { await tenantContextStorage.run({ tenantId: tenant.id }, () => next()); } catch (e) { this.reject(e, res); }
  }
  private reject(error: unknown, res: Response) {
    if (!res.headersSent) { const appException = toAppException(error); res.status(...).json(...); } else { next? } 
  }
}
```
But if use exceptionHandler.handle, it may send. Need res type. Simpler create helper `sendError(res, error)` with same envelope.

But if middleware uses `ExceptionFilter`? Could use `ExceptionHandler` from @nestjs/core. But `ExceptionHandler.handle` returns Promise<void>. Good.

Need exclude health: in `main.ts`:
```
app.useGlobalMiddleware(createTenantMiddlewareExcludeHealth());
```
Or in AppModule use `CONSUMER`? Simpler in main:
```
app.useGlobalMiddleware({
  exclude: { path: 'health', method: RequestMethod.GET },
  type: 'all',
  middleware: [TenantResolutionMiddleware],
});
```
But then health controller unauthenticated. Add `AppController` with `GET /health` returns ok. Is that extra? Maybe needed for middleware exclude. Could skip health. But all endpoints require tenant. Maybe no health. But Nest default no. We can omit health to avoid extra. But if middleware applies to all, no exclude. Tests only tenant routes. Fine.

But `GET /tenant-config` and `/customers` require auth. Good.

TenantService resolve:
```
@Injectable()
export class TenantService {
  constructor(private readonly tenantRepository: TenantRepository) {}
  async resolve(input: { host: string; orgId: string }): Promise<Tenant> {
    const tenant = await this.tenantRepository.findByDomain(input.host);
    if (!tenant) throw new AppException(400, '
```

## reply

(empty)
