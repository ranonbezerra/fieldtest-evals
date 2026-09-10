# repair2-tenant.spec.ts

## reasoning

```
Let me analyze the compiler errors to understand what needs to be fixed:

1. **`superTest` not callable** - The import of `supertest` is wrong. With ESM and TypeScript strict mode, `import request from 'supertest'` or `import * as request from 'supertest'` doesn't work as a callable. The fix is to use `import { default as request } from 'supertest'` or more likely the issue is how it's imported. Actually, looking at the error: `Type '{ default: SuperTestStatic; Test: typeof Test; agent: ... }' has no call signatures.` - this means `request` is being imported as a namespace/module object, not as a callable. The fix is to use `import request from 'supertest'` with proper ESM interop, or `import { default as request } from 'supertest'`.

Wait, actually in ESM with `"type": "module"`, the correct way to import supertest (which is CJS) is:
```typescript
import request from 'supertest';
```
But if the `esModuleInterop` is not set, or if the type definitions expose it as a module namespace, this won't work.

Looking at the error more carefully: `Type '{ default: SuperTestStatic; Test: typeof Test; agent: ... }' has no call signatures.` - This means `request` is the module namespace object itself, not the default export. So the current code likely has `import * as request from 'supertest'` or the types are resolving to the module namespace.

The fix would be: `import request from 'supertest'` - but wait, if that's already what's there and it's still failing, maybe it's `import { default as request } from 'supertest'` or we need to destructure.

Actually, looking at supertest's type definitions, the package exports:
- A default export (the callable function)
- Named exports: `Test`, `agent`, `agentFn`, `methods`, etc.

In ESM mode with TypeScript, if you do `import request from 'supertest'`, TypeScript might resolve it to the module namespace if the types are defined as a module with named exports. The proper fix depends on how the types are set up.

Given the error says the type is `{ default: SuperTestStatic; Test: typeof Test; agent: ... }`, this looks like the module namespace. So the current import is likely `import * as request from 'supertest'` or `import request from 'supertest'` where TypeScript is treating it as the namespace.

The fix: `import { default as request } from 'supertest'` or simply `import request from 'supertest'` if `esModuleInterop` is true. But since we're in ESM mode, the safest is probably:

```typescript
import request from 'supertest';
```

Wait, but that might already be what's there. Let me think about this differently. In ESM mode (`"type": "module"`), when you import a CJS module, Node wraps it so `default` is the module.exports. So `import request from 'supertest'` should give you the callable. But TypeScript's type resolution might differ.

Looking at the error type: `{ default: SuperTestStatic; Test: typeof Test; agent: ... }` - this is the shape of `module.exports` of supertest. So TypeScript is seeing the entire module.exports object, not just the default. This happens when you do `import * as request from 'supertest'` in ESM mode, or when the types are defined in a way that the module namespace is what you get.

The fix should be to destructure the default:
```typescript
import { default as request } from 'supertest';
```

Or if `esModuleInterop` is enabled, just `import request from 'supertest'` should work. But given the error, it seems like it's not working that way.

Actually, I think the most reliable fix for ESM + TypeScript is:
```typescript
import request from 'supertest';
```
And if that doesn't work due to type issues, we might need:
```typescript
import supertest from 'supertest';
const request = supertest.default ?? supertest;
```

But that's ugly. Let me reconsider. The cleanest approach that should work in ESM with TypeScript strict:

```typescript
import { default as request } from 'supertest';
```

This explicitly grabs the default export from the module namespace.

2. **`TenantCreateNestedOneWithoutCustomersInput` errors** - Lines 90, 93, 96, 208, 211. The code is passing a `string` where Prisma expects a nested create input object for the `tenant` relation. This means in the `create` call for customer/plan/order, the `tenant` field is being set to a string ID directly, but the Prisma type expects either:
   - A `TenantCreateNestedOneWithoutCustomersInput` (which is `{ connect: { id: string } }` or `{ create: { ... } }`)
   - Or the field should be `tenantId` (the scalar FK)

Looking at the schema, if `Customer` has a `tenantId` field (scalar FK) and a `tenant` relation, then in create input you can use either:
- `tenantId: 'some-string'` (the scalar)
- `tenant: { connect: { id: 'some-string' } }` (the relation)

The error says `Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'` - so the code is doing `tenant: 'some-string'` but it should be either `tenantId: 'some-string'` or `tenant: { connect: { id: 'some-string' } }`.

Since the tenant-prisma service stamps `tenant: tenantId` in the data, and the schema likely has both `tenantId` (mapped to `tenant_id` column) and `tenant` relation, the test code is probably doing something like:
```typescript
prisma.customer.create({ data: { email: '...', tenant: 'tenant-a' } })
```

This should be:
```typescript
prisma.customer.create({ data: { email: '...', tenantId: 'tenant-a' } })
```

3. **`Type 'string' is not assignable to type '(Without<TenantRelationFilter, TenantWhereInput> & TenantWhereInput) | ...'`** - Lines 114, 128, 149. This is in `where` clauses. The code is doing something like:
```typescript
prisma.customer.findMany({ where: { tenant: 'tenant-a' } })
```
But it should be:
```typescript
prisma.customer.findMany({ where: { tenantId: 'tenant-a' } })
```

Now let me reconstruct what the test file likely looks like based on the errors and the requirements:

The test needs to:
1. Set up the app
2. Create tenants
3. Test that tenant B cannot list tenant A's customers
4. Test that tenant B cannot fetch-by-id tenant A's customer (expect 404)
5. Test that tenant B cannot update tenant A's customer
6. Test that tenant B cannot delete tenant A's customer
7. Test that same email can register in both tenants
8. Test concurrent requests from different tenants don't cross contexts

Let me write the complete test file. I need to figure out the exact structure. Based on the errors:

- Lines with `request(` - the supertest call issue
- Lines 90, 93, 96 - creating customers with `tenant: 'string'` 
- Lines 114, 128, 149 - querying with `where: { tenant: 'string' }`
- Lines 208, 211 - more creating with `tenant: 'string'`

Let me think about what the test file structure would be. It's a full integration test using `@nestjs/testing` and supertest.

Given the codebase conventions:
- `test/tenant.spec.ts`
- Uses NestJS testing module
- Uses supertest for HTTP calls
- Uses Prisma directly for seeding

Let me write the test:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

describe('Multi-tenant isolation', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.customer.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.tenant.deleteMany({});
  });

  // Helper to create a tenant directly in DB
  async function createTenant(id: string, name: string) {
    return prisma.tenant.create({
      data: { id, name },
    });
  }
  ...
```

Wait, I need to think about this more carefully. The tests need to:
1. Send HTTP requests with the tenant's host header and a token with the org claim
2. The middleware resolves the tenant from these

So the requests would look like:
```typescript
await request(app.getHttpServer())
  .get('/customers')
  .set('Host', 'app.operator-a.com')
  .set('Authorization', `Bearer ${tokenA}`);
```

But I don't know the exact token format or how the middleware extracts the org claim. Let me make reasonable assumptions.

Actually, looking at the problem statement more carefully:
- "Auth tokens carry an `org` claim; requests also arrive with the tenant's host."
- "Tenant resolution middleware: derive the tenant from host + token org claim (both must agree)"

So the middleware:
1. Extracts the host from the request
2. Extracts the org claim from the JWT token
3. Both must agree (or at least map to the same tenant)
4. Sets the tenant in request-scoped context

For the test, I'll need to create tokens with an `org` claim. The org claim likely maps to a tenant (by ID or by domain).

Let me think about what shapes I need to assume:
- The tenant model has: `id`, `name`, `domain` (or `slug`), and branding/feature flags
- The token has an `org` claim that matches the tenant's domain or ID
- The host header gives the domain

I'll assume:
- Tenant has `id`, `domain` (like `app.operator-a.com`), `branding` (JSON), `featureFlags` (JSON)
- The `org` claim in the token matches the tenant's `domain` or `id`

Actually, let me reconsider. The problem says "derive the tenant from host + token org claim (both must agree)". This suggests:
- From the host, you can derive a tenant (e.g., by looking up the tenant by domain)
- From the token's org claim, you can derive a tenant (e.g., the org claim IS the tenant ID or domain)
- Both must resolve to the same tenant

For the test, I'll create tenants with specific domains and create JWTs with matching org claims.

Let me also think about what the `TenantCreateNestedOneWithoutCustomersInput` error tells us about the schema. The relation from Customer to Tenant is named `tenant` and the input type is `TenantCreateNestedOneWithoutCustomersInput`. This means:
- The relation field on Customer is `tenant` (the relation)
- The scalar FK is likely `tenantId` (or `tenant_id` mapped)

So in the test, when creating a customer directly via Prisma for seeding, I should use `tenantId: '...'` not `tenant: '...'`.

Similarly for `where` clauses, I should use `tenantId: '...'` not `tenant: '...'`.

Now, for the supertest import issue. In ESM mode with TypeScript, the correct import that should work is:

```typescript
import request from 'supertest';
```

But the error shows it's being treated as a namespace. This could happen if:
1. The tsconfig doesn't have `esModuleInterop: true`
2. Or the types are resolving differently

Since I can't change the tsconfig (the task says "Change nothing the messages do not name"), I need to find an import that works.

The error type is `{ default: SuperTestStatic; Test: typeof Test; agent: ... }` - this is the module namespace. So `import * as request from 'supertest'` or `import request from 'supertest'` (without esModuleInterop) gives you the namespace.

The fix: `import { default as request } from 'supertest'`

Wait, but if `esModuleInterop` is not set, then `import request from 'supertest'` would give you the `default` property... hmm, actually no. Without `esModuleInterop`, `import request from 'supertest'` would fail at runtime for CJS modules, but in TypeScript it depends on the types.

Let me just use `import { default as request } from 'supertest'` which should explicitly grab the default export from the namespace.

Actually wait - I just realized. If the code currently has `import request from 'supertest'` and the error is that `request` has type `{ default: SuperTestStatic; ... }`, then TypeScript is treating the module as having a namespace shape. This happens when `esModuleInterop` is false and `allowSyntheticDefaultImports` is also false.

The safest fix that works regardless of tsconfig settings:
```typescript
import { default as request } from 'supertest';
```

This explicitly destructures the `default` property from the module namespace, which we can see from the error type exists.

Now let me write the complete test file. I need to be careful about:
1. Using `tenantId` (scalar) not `tenant` (relation) in Prisma create/where
2. Using the correct supertest import
3. Testing all the isolation requirements
4. Not dropping any requirement

Let me also think about what endpoints exist. Based on the problem:
- `GET /tenant-config` — branding + feature flags
- Customer CRUD: `GET /customers`, `GET /customers/:id`, `PATCH /customers/:id`, `DELETE /customers/:id`, `POST /customers`

The tests need to verify:
1. Tenant B cannot list tenant A's rows
2. Tenant B cannot fetch-by-id tenant A's row (expect 404)
3. Tenant B cannot update tenant A's row
4. Tenant B cannot delete tenant A's row
5. Same email registers in both tenants
6. Concurrent requests from different tenants don't cross contexts

For the "same email registers in both tenants" test, I need to POST to `/customers` with the same email but different tenant contexts.

For concurrent requests, I'll send multiple requests in parallel from different tenants and verify they don't interfere.

Let me also think about how to create the tenants. I'll use Prisma directly to create tenants in the database, then make HTTP requests with the appropriate headers.

For the JWT token, I need to know what the expected format is. The problem says "Auth tokens carry an `org` claim". I'll assume it's a JWT with an `org` claim. The middleware likely verifies the token and extracts the `org` claim.

I'll need to either:
- Create actual JWTs (using jsonwebtoken or similar)
- Or mock the auth

Since this is an integration test and the middleware is part of the app, I should create real tokens. But I don't know the secret. Let me assume the app has a way to create tokens, or I'll create JWTs with a known secret.

Actually, for a test, the simplest approach is to create JWTs directly. I'll assume the secret is available from environment or I'll use a test secret.

Hmm, but I don't know the exact auth mechanism. Let me make an assumption: the app uses JWT with a secret from environment variable `JWT_SECRET`, and the token has an `org` claim.

Actually, I think the cleaner approach for the test is to:
1. Create tenants in the DB
2. Create JWTs with the appropriate `org` claim
3. Make requests with both the Host header and Authorization header

Let me write this out:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { default as request } from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';

const TENANT_A_ID = 'tenant-a';
const TENANT_B_ID = 'tenant-b';
const TENANT_A_DOMAIN = 'app.operator-a.com';
const TENANT_B_DOMAIN = 'app.operator-b.com';
const JWT_SECRET = 'test-secret';

function createToken(org: string): string {
  return jwt.sign({ org }, JWT_SECRET, { expiresIn: '1h' });
}

describe('Multi-tenant isolation', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaClient);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.customer.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.tenant.deleteMany({});
  });

  async function seedTenant(id: string, domain: string, name: string) {
    return prisma.tenant.create({
      data: { id, domain, name },
    });
  }

  // ... tests
});
```

Wait, I'm making too many assumptions about the schema. Let me reconsider.

The error `TenantCreateNestedOneWithoutCustomersInput` tells us:
- There's a `Tenant` model
- `Customer` has a relation to `Tenant` (the "WithoutCustomers" part of the input name confirms the relation is from Tenant to Customer, named `customers`)
- The relation field on Customer pointing to Tenant is likely `tenant` (relation) with `tenantId` (scalar FK)

For the tenant model, I'll assume it has at minimum: `id`, `domain`, `name`, and fields for branding/feature flags.

Actually, I realize I'm overthinking this. The task says "Rewrite `test/tenant.spec.ts` complete, fixing what these messages require of this file." So I need to:
1. Fix the supertest import
2. Fix the Prisma create inputs (use `tenantId` instead of `tenant`)
3. Fix the Prisma where clauses (use `tenantId` instead of `tenant`)
4. Keep all the test logic intact

Since I don't have the original file, I need to reconstruct it based on:
- The error line numbers (which tell me the structure)
- The requirements from the problem statement
- The conventions

Let me map the errors to likely code:

- Line 90, 93, 96: `tenant: 'string'` in create data → should be `tenantId: 'string'`
- Line 101: `request(...)` call → supertest import issue
- Line 114: `where: { tenant: 'string' }` → should be `where: { tenantId: 'string' }`
- Line 117: `request(...)` call
- Line 128: `where: { tenant: 'string' }` → should be `where: { tenantId: 'string' }`
- Line 131: `request(...)` call
- Line 149: `where: { tenant: 'string' }` → should be `where: { tenantId: 'string' }`
- Line 152: `request(...)` call
- Line 167: `request(...)` call
- Line 176: `request(...)` call
- Line 187: `request(...)` call
- Line 208, 211: `tenant: 'string'` in create data → should be `tenantId: 'string'`
- Line 217, 222: `request(...)` calls

So the file is about 222 lines long. Let me reconstruct it.

Given the line numbers, the structure is roughly:
- Lines 1-~30: imports, constants, setup
- Lines ~30-90: beforeAll/beforeEach, helper functions, seed tenant A's data
- Lines 90-96: creating customers for tenant A (with the `tenant: string` bug)
- Lines 101: first request call
- Lines 114: where clause (with `tenant: string` bug)
- Lines 117: request
- Lines 128: where clause
- Lines 131: request
- Lines 149: where clause
- Lines 152: request
- Lines 167, 176, 187: more requests
- Lines 208-211: creating more data (with `tenant: string` bug)
- Lines 217, 222: final requests

Let me write a complete, coherent test file that:
1. Has the correct supertest import
2. Uses `tenantId` for Prisma scalar operations
3. Tests all required isolation scenarios
4. Is approximately the right length

Here's my plan for the test file:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { default as request } from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';

// Constants
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const DOMAIN_A = 'app.operator-a.com';
const DOMAIN_B = 'app.operator-b.com';
const SECRET = 'test-secret';

function token(org: string): string {
  return jwt.sign({ org }, SECRET, { expiresIn: '1h' });
}

describe('Multi-tenant isolation', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaClient);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.customer.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.tenant.deleteMany({});
  });

  async function seedTenants() {
    await prisma.tenant.create({ data: { id: TENANT_A, domain: DOMAIN_A, name: 'Operator A' } });
    await prisma.tenant.create({ data: { id: TENANT_B, domain: DOMAIN_B, name: 'Operator B' } });
  }

  // Test: Tenant B cannot list tenant A's customers
  it('tenant B cannot list tenant A customers', async () => {
    await seedTenants();
    const custA = await prisma.customer.create({
      data: { email: 'a@op-a.com', name: 'Alice', tenantId: TENANT_A },
    });
    // ...
  });
  
  // ... more tests
});
```

Hmm wait, I need to be more careful. Let me think about what `app.get(PrismaClient)` would give us. The app might not directly provide `PrismaClient` - it might provide the `TenantPrismaService` or a `PrismaService`. 

Looking at the reference code, there's a `TenantPrismaService` that's request-scoped. For testing purposes, I probably need a plain `PrismaClient` to seed data directly. I'll just instantiate one.

Actually, for seeding in tests, it's common to just create a new `PrismaClient` instance. Let me do that.

But wait - if the app uses a tenant-aware Prisma client that auto-stamps `tenantId`, then creating data through the app's Prisma would auto-add the tenant. But for seeding in tests, I want to create data directly without going through the tenant middleware. So I should use a plain `PrismaClient`.

Let me also reconsider the `tenantId` vs `tenant` issue. The error messages reference `TenantCreateNestedOneWithoutCustomersInput` which is the Prisma input type for the relation. The scalar FK would be `tenantId`. So:
- In `create` data: use `tenantId: TENANT_A` (not `tenant: TENANT_A`)
- In `where` clauses: use `tenantId: TENANT_A` (not `tenant: TENANT_A`)

This makes sense because `tenant` is the relation field (expects a nested input object) and `tenantId` is the scalar foreign key.

Now, one more consideration: the `TenantPrismaService` in the reference code stamps `tenant: tenantId` in the data. But wait, that would be setting the relation field to a string, which would also be a type error! Unless the schema uses `tenantId` as the field name for the scalar...

Looking at the reference `TenantPrismaService`:
```typescript
args.data = { ...args.data, tenant: tenantId };
```

This sets `tenant` to a string. But the Prisma type for `tenant` in create input is `TenantCreateNestedOneWithoutCustomersInput` (a relation input). So this would also be a type error in the service...

Unless the schema defines the field as `tenantId` and the Prisma client accepts it. Wait, let me re-read the reference code:

```typescript
args.where = { ...args.where, tenant: tenantId };
```

This sets `where.tenant` to a string. But the where input for the `tenant` relation would be `TenantWhereInput` or `TenantScalarRelationFilter`, not a string.

Hmm, this is confusing. Let me look at this differently. Maybe the schema actually uses `tenantId` as the field name for the scalar, and the Prisma extension is supposed to use `tenantId` not `tenant`. The reference code might have a bug (which is why the task is to fix things).

Actually wait - the task says "Rewrite `test/tenant.spec.ts` complete, fixing what these messages require of this file." So I only need to fix the test file. The service file's issues are not my concern.

For the test file, the errors clearly tell me:
- Where I'm passing `tenant: 'string'` in create data, I should use `tenantId: 'string'`
- Where I'm using `where: { tenant: 'string' }`, I should use `where: { tenantId: 'string' }`

Let me now write the complete test file. I'll aim for a structure that matches the line numbers approximately.

Actually, I realize I should just focus on writing a correct, complete test file that satisfies all the requirements. The line numbers in the errors are from the broken file - my new file will have different line numbers. What matters is:
1. Correct supertest import
2. Correct Prisma field names (`tenantId` not `tenant`)
3. All required test cases present
4. Tests assert behavior, not just that calls happen

Let me write the final version:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { default as request } from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const DOMAIN_A = 'app.operator-a.com';
const DOMAIN_B = 'app.operator-b.com';
const SECRET = 'test-secret';

function createToken(org: string): string {
  return jwt.sign({ org }, SECRET, { expiresIn: '1h' });
}

describe('Multi-tenant isolation', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.customer.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.tenant.deleteMany({});
  });

  async function seedTenant(id: string, domain: string, name: string) {
    return prisma.tenant.create({
      data: { id, domain, name },
    });
  }

  async function seedTenants() {
    await seedTenant(TENANT_A, DOMAIN_A, 'Operator A');
    await seedTenant(TENANT_B, DOMAIN_B, 'Operator B');
  }

  it('tenant B cannot list tenant A customers', async () => {
    await seedTenants();
    await prisma.customer.create({
      data: { email: 'alice@op-a.com', name: 'Alice', tenantId: TENANT_A },
    });

    const res = await request(app.getHttpServer())
      .get('/customers')
      .set('Host', DOMAIN_B)
      .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('tenant B cannot fetch tenant A customer by id (404)', async () => {
    await seedTenants();
    const custA = await prisma.customer.create({
      data: { email: 'alice@op-a.com', name: 'Alice', tenantId: TENANT_A },
    });

    const res = await request(app.getHttpServer())
      .get(`/customers/${custA.id}`)
      .set('Host', DOMAIN_B)
      .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`);

    expect(res.status).toBe(404);
  });

  it('tenant B cannot update tenant A customer', async () => {
    await seedTenants();
    const custA = await prisma.customer.create({
      data: { email: 'alice@op-a.com', name: 'Alice', tenantId: TENANT_A },
    });

    const res = await request(app.getHttpServer())
      .patch(`/customers/${custA.id}`)
      .set('Host', DOMAIN_B)
      .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`)
      .send({ name: 'Hacked' });

    expect(res.status).toBe(404);

    const updated = await prisma.customer.findFirst({ where: { tenantId: TENANT_A } });
    expect(updated?.name).toBe('Alice');
  });

  it('tenant B cannot delete tenant A customer', async () => {
    await seedTenants();
    const custA = await prisma.customer.create({
      data: { email: 'alice@op-a.com', name: 'Alice', tenantId: TENANT_A },
    });

    const res = await request(app.getHttpServer())
      .delete(`/customers/${custA.id}`)
      .set('Host', DOMAIN_B)
      .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`);

    expect(res.status).toBe(404);

    const stillExists = await prisma.customer.findFirst({ where: { tenantId: TENANT_A } });
    expect(stillExists).not.toBeNull();
  });

  it('same email can register in both tenants', async () => {
    await seedTenants();

    const resA = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', DOMAIN_A)
      .set('Authorization', `Bearer ${createToken(DOMAIN_A)}`)
      .send({ email: 'shared@both.com', name: 'Shared' });

    expect(resA.status).toBe(201);

    const resB = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', DOMAIN_B)
      .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`)
      .send({ email: 'shared@both.com', name: 'Shared' });

    expect(resB.status).toBe(201);

    const count = await prisma.customer.count({ where: { email: 'shared@both.com' } });
    expect(count).toBe(2);
  });

  it('concurrent requests from different tenants do not cross contexts', async () => {
    await seedTenants();

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/customers')
        .set('Host', DOMAIN_A)
        .set('Authorization', `Bearer ${createToken(DOMAIN_A)}`)
        .send({ email: 'concurrent@a.com', name: 'Concurrent A' }),
      request(app.getHttpServer())
        .post('/customers')
        .set('Host', DOMAIN_B)
        .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`)
        .send({ email: 'concurrent@b.com', name: 'Concurrent B' }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const aCustomer = await prisma.customer.findFirst({
      where: { email: 'concurrent@a.com', tenantId: TENANT_A },
    });
    const bCustomer = await prisma.customer.findFirst({
      where: { email: 'concurrent@b.com', tenantId: TENANT_B },
    });

    expect(aCustomer).not.toBeNull();
    expect(bCustomer).not.toBeNull();

    // Cross-contamination check: A's customer should NOT be in tenant B
    const crossCheckA = await prisma.customer.findFirst({
      where: { email: 'concurrent@a.com', tenantId: TENANT_B },
    });
    expect(crossCheckA).toBeNull();

    const crossCheckB = await prisma.customer.findFirst({
      where: { email: 'concurrent@b.com', tenantId: TENANT_A },
    });
    expect(crossCheckB).toBeNull();
  });
});
```

Wait, I need to reconsider. The problem says the `org` claim in the token and the host must agree. So the `org` claim should match the domain (or the tenant ID). Let me think about what "agree" means:
- Host is `app.operator-a.com`
- Token org claim could be `app.operator-a.com` or `tenant-a`

The middleware likely:
1. Looks up the tenant by domain (from host)
2. Checks that the token's org claim matches (either the domain or the tenant ID)

I'll assume the `org` claim matches the domain, since that's the most natural interpretation of "both must agree" - both point to the same tenant.

Actually, re-reading: "derive the tenant from host + token org claim (both must agree)". This could mean:
- Derive tenant from host → get tenant X
- Derive tenant from org claim → get tenant Y
- X must equal Y

The org claim could be the tenant ID or the domain. I'll go with the domain since it's more natural for a white-label system (the org IS the domain).

Hmm, but actually in many multi-tenant systems, the `org` claim is an org ID. Let me just use the domain as the org claim value since that's what makes the "both must agree" check most straightforward (host gives domain, token gives domain, they must match).

Let me also consider: what if the tenant lookup is by domain? Then the tenant model needs a `domain` field. I'll assume it does.

One more thing: I'm using `process.env.JWT_SECRET = SECRET` in `beforeAll`. This might not be how the app reads the secret. But since I'm setting it before the module is created, it should work if the app reads env vars at construction time.

Actually, I realize there might be an issue with how the app module reads configuration. If it uses `@nestjs/config` with `ConfigService`, the env var needs to be set before the module is instantiated. Since I set it in `beforeAll` before `createTestingModule`, it should be fine.

Let me also think about whether I need to handle the case where the app might not have a `PrismaClient` provider. Since I'm creating my own `new PrismaClient()` for seeding, this shouldn't be an issue.

Let me finalize the test. I think my version above is solid. Let me just double-check all the requirements:

1. ✅ Tenant B cannot list tenant A's rows
2. ✅ Tenant B cannot fetch-by-id tenant A's row (expect 404)
3. ✅ Tenant B cannot update tenant A's row
4. ✅ Tenant B cannot delete tenant A's row
5. ✅ Same email registers in both tenants
6. ✅ Concurrent requests from different tenants don't cross contexts

And the fixes:
1. ✅ `import { default as request } from 'supertest'` - fixes the callable error
2. ✅ Using `tenantId` instead of `tenant` in Prisma create data - fixes `TenantCreateNestedOneWithoutCustomersInput` error
3. ✅ Using `tenantId` instead of `tenant` in Prisma where clauses - fixes the `TenantWhereInput` type error

I think this is good. Let me write the final version.

Wait, one more thought: should I use `expect` from vitest? The project uses Vitest. In Vitest, `expect` is globally available, so I don't need to import it. Good.

Also, I should make sure the test file doesn't import anything it doesn't use. Let me check:
- `Test, TestingModule` from `@nestjs/testing` - used ✅
- `INestApplication` from `@nestjs/common` - used ✅
- `default as request` from `supertest` - used ✅
- `PrismaClient` from `@prisma/client` - used ✅
- `jwt` from `jsonwebtoken` - used ✅
- `AppModule` from `../src/app.module` - used ✅

All good. Let me write the final answer.
```

## reply

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { default as request } from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';

// ASSUMPTION: The tenant model has a `domain` column and the JWT `org` claim
// carries that domain value; the middleware matches host to domain and checks
// the token's `org` claim equals the same domain. The scalar FK on child rows
// is `tenantId` (mapped to `tenant_id`).

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const DOMAIN_A = 'app.operator-a.com';
const DOMAIN_B = 'app.operator-b.com';
const SECRET = 'test-secret';

function createToken(org: string): string {
  return jwt.sign({ org }, SECRET, { expiresIn: '1h' });
}

describe('Multi-tenant isolation', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.customer.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.tenant.deleteMany({});
  });

  async function seedTenant(id: string, domain: string, name: string) {
    return prisma.tenant.create({
      data: { id, domain, name },
    });
  }

  async function seedTenants() {
    await seedTenant(TENANT_A, DOMAIN_A, 'Operator A');
    await seedTenant(TENANT_B, DOMAIN_B, 'Operator B');
  }

  it('tenant B cannot list tenant A customers', async () => {
    await seedTenants();
    await prisma.customer.create({
      data: { email: 'alice@op-a.com', name: 'Alice', tenantId: TENANT_A },
    });

    const res = await request(app.getHttpServer())
      .get('/customers')
      .set('Host', DOMAIN_B)
      .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('tenant B cannot fetch tenant A customer by id (404)', async () => {
    await seedTenants();
    const custA = await prisma.customer.create({
      data: { email: 'alice@op-a.com', name: 'Alice', tenantId: TENANT_A },
    });

    const res = await request(app.getHttpServer())
      .get(`/customers/${custA.id}`)
      .set('Host', DOMAIN_B)
      .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`);

    expect(res.status).toBe(404);
  });

  it('tenant B cannot update tenant A customer', async () => {
    await seedTenants();
    const custA = await prisma.customer.create({
      data: { email: 'alice@op-a.com', name: 'Alice', tenantId: TENANT_A },
    });

    const res = await request(app.getHttpServer())
      .patch(`/customers/${custA.id}`)
      .set('Host', DOMAIN_B)
      .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`)
      .send({ name: 'Hacked' });

    expect(res.status).toBe(404);

    const updated = await prisma.customer.findFirst({
      where: { tenantId: TENANT_A },
    });
    expect(updated?.name).toBe('Alice');
  });

  it('tenant B cannot delete tenant A customer', async () => {
    await seedTenants();
    const custA = await prisma.customer.create({
      data: { email: 'alice@op-a.com', name: 'Alice', tenantId: TENANT_A },
    });

    const res = await request(app.getHttpServer())
      .delete(`/customers/${custA.id}`)
      .set('Host', DOMAIN_B)
      .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`);

    expect(res.status).toBe(404);

    const stillExists = await prisma.customer.findFirst({
      where: { tenantId: TENANT_A },
    });
    expect(stillExists).not.toBeNull();
  });

  it('same email can register in both tenants', async () => {
    await seedTenants();

    const resA = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', DOMAIN_A)
      .set('Authorization', `Bearer ${createToken(DOMAIN_A)}`)
      .send({ email: 'shared@both.com', name: 'Shared' });

    expect(resA.status).toBe(201);

    const resB = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', DOMAIN_B)
      .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`)
      .send({ email: 'shared@both.com', name: 'Shared' });

    expect(resB.status).toBe(201);

    const count = await prisma.customer.count({
      where: { email: 'shared@both.com' },
    });
    expect(count).toBe(2);
  });

  it('concurrent requests from different tenants do not cross contexts', async () => {
    await seedTenants();

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/customers')
        .set('Host', DOMAIN_A)
        .set('Authorization', `Bearer ${createToken(DOMAIN_A)}`)
        .send({ email: 'concurrent@a.com', name: 'Concurrent A' }),
      request(app.getHttpServer())
        .post('/customers')
        .set('Host', DOMAIN_B)
        .set('Authorization', `Bearer ${createToken(DOMAIN_B)}`)
        .send({ email: 'concurrent@b.com', name: 'Concurrent B' }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const aCustomer = await prisma.customer.findFirst({
      where: { email: 'concurrent@a.com', tenantId: TENANT_A },
    });
    const bCustomer = await prisma.customer.findFirst({
      where: { email: 'concurrent@b.com', tenantId: TENANT_B },
    });

    expect(aCustomer).not.toBeNull();
    expect(bCustomer).not.toBeNull();

    const crossCheckA = await prisma.customer.findFirst({
      where: { email: 'concurrent@a.com', tenantId: TENANT_B },
    });
    expect(crossCheckA).toBeNull();

    const crossCheckB = await prisma.customer.findFirst({
      where: { email: 'concurrent@b.com', tenantId: TENANT_A },
    });
    expect(crossCheckB).toBeNull();
  });
});
```
