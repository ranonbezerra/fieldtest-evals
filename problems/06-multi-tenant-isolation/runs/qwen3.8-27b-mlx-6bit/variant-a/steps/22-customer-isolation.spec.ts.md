# 22-customer-isolation.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. The file is `test/customer-isolation.spec.ts`
2. It tests cross-tenant isolation, duplicate email, and concurrency
3. I need to look at the cases listed in `22-customer-isolation.spec.ts-cases.txt` and implement all of them

From the plan:
- Tests use Vitest
- The test file reads from `src/app.module.ts` and `src/db/prisma.service.ts`
- Tests exercise: list/get/update/delete isolation, same email in both tenants, concurrency

Let me think about the test setup:
- I need to create a NestJS testing module with the app
- I need two tenants (A and B) in the database
- I need to make HTTP requests with different hosts and JWT tokens
- Each request needs: a `Host` header (e.g., `app.tenant-a.com`) and an `Authorization: Bearer <jwt>` header where the JWT has an `org` claim matching the tenant slug

From the plan:
- Tenant identity = slug (subdomain label)
- Base domain from env: `TENANT_BASE_DOMAIN`
- JWT with `org` claim, verified with `JWT_SECRET`
- Host → slug parsing: `app.operator-x.com` → `operator-x` (the subdomain label before the base domain)

Wait, let me re-read: "The tenant slug is the subdomain label of the host (e.g. `app.operator-x.com` → `operator-x`)"

Actually wait - looking more carefully at the plan: "host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`"

So if base domain is `example.com`, then:
- `operator-a.example.com` → slug `operator-a`
- `operator-b.example.com` → slug `operator-b`

The host format is `<slug>.<baseDomain>`.

For the test setup, I need:
1. Set up environment variables: `JWT_SECRET`, `TENANT_BASE_DOMAIN`, `DATABASE_URL`
2. Create the NestJS app with test module
3. Seed two tenants in the database
4. Generate JWTs with `org` claims for each tenant
5. Make requests with appropriate `Host` headers

Let me think about how to structure this:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import * as jwt from 'jsonwebtoken'; // or use @nestjs/jwt

// Actually, I should use the same JWT mechanism. Let me think...
// The middleware uses @nestjs/jwt's JwtService to verify tokens.
// For creating test tokens, I can use jsonwebtoken directly or sign with the same secret.
```

Wait, I need to be careful. The plan says the middleware uses `JwtService` from `@nestjs/jwt`. For creating test tokens, I can use the `jsonwebtoken` package directly (which is a dependency of `@nestjs/jwt`).

Actually, let me think about what's available. The plan mentions `@nestjs/jwt` for verification. For signing in tests, I can use `jsonwebtoken` (which `@nestjs/jwt` wraps) or I can create a JwtService instance.

Let me use `jsonwebtoken` directly for signing in tests since it's simpler and it's a transitive dependency.

Now, for the test structure:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import * as jwt from 'jsonwebtoken';

// Setup
const JWT_SECRET = 'test-secret';
const BASE_DOMAIN = 'example.com';
const TENANT_A_SLUG = 'operator-a';
const TENANT_B_SLUG = 'operator-b';

describe('customer isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.TENANT_BASE_DOMAIN = BASE_DOMAIN;
    
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    
    app = moduleRef.createNestApplication();
    await app.init();
    
    prisma = moduleRef.get(PrismaService);
    
    // Seed tenants
    const tenantA = await prisma.tenant.create({ data: { slug: TENANT_A_SLUG, domain: `${TENANT_A_SLUG}.${BASE_DOMAIN}`, name: 'Tenant A', branding: {...}, featureFlags: {} } });
    const tenantB = await prisma.tenant.create({ data: { slug: TENANT_B_SLUG, domain: `${TENANT_B_SLUG}.${BASE_DOMAIN}`, name: 'Tenant B', branding: {...}, featureFlags: {} } });
    
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up customers between tests
    await prisma.customer.deleteMany({});
  });

  function makeToken(slug: string): string {
    return jwt.sign({ org: slug }, JWT_SECRET, { expiresIn: '1h' });
  }

  function makeRequest(slug: string) {
    const host = `${slug}.${BASE_DOMAIN}`;
    const token = makeToken(slug);
    return request(app.getHttpServer())
      .set('Host', host)
      .set('Authorization', `Bearer ${token}`);
  }
  
  // ... tests
});
```

Now let me think about each test case from the cases file:

1. **Tenant B lists customers and sees only its own rows**
   - Create a customer as tenant A
   - List customers as tenant B → should be empty
   - List customers as tenant A → should have the one customer

2. **Tenant B fetches tenant A's customer id and receives 404**
   - Create a customer as tenant A
   - GET /customers/:id as tenant B → 404

3. **Tenant B patches tenant A's customer — 404, and tenant A re-fetches to confirm unchanged**
   - Create a customer as tenant A with specific data
   - PATCH /customers/:id as tenant B → 404
   - GET /customers/:id as tenant A → still has original data

4. **Tenant B deletes tenant A's customer — 404, and tenant A re-fetches to confirm still exists**
   - Create a customer as tenant A
   - DELETE /customers/:id as tenant B → 404
   - GET /customers/:id as tenant A → still exists

5. **Same email registers under tenant A and tenant B — both succeed with distinct ids**
   - POST /customers with email "shared@test.com" as tenant A → 201
   - POST /customers with email "shared@test.com" as tenant B → 201
   - Both have different ids
   - Tenant A lists → sees only its own
   - Tenant B lists → sees only its own

6. **Same email registered twice under one tenant — second returns 409**
   - POST /customers with email "dup@test.com" as tenant A → 201
   - POST /customers with email "dup@test.com" as tenant A → 409

7. **Tenant A creates a customer; tenant B immediately lists — does not see A's new row**
   - This is similar to case 1 but more specific about timing
   - Create as A, list as B → empty

8. **Concurrent interleaved GET /customers from tenant A and B — each sees only its own rows**
   - Create customers in both tenants
   - Fire concurrent GET requests from both
   - Each response has only its own rows

9. **Concurrent interleaved POST /customers from tenant A and B with the same email — both succeed**
   - Fire concurrent POST requests with same email from both tenants
   - Both succeed
   - Each row belongs to correct tenant

10. **Tenant A's customer is still fully functional after all of tenant B's cross-tenant attempts**
    - Create as A
    - Attempt list, get, patch, delete as B (all should fail/be empty for B's perspective)
    - Then verify A can still list, get, patch, delete successfully

Let me now write the complete test file. I need to be careful about:
- The `beforeEach` cleanup should use the raw prisma (not scoped) to clean up
- Actually, since the middleware requires a valid tenant context, I should use `prisma` directly (the base client) for cleanup, or use `prisma.tenant` (which is exempt from the guard) and then... hmm.

Wait, the `PrismaService` extends `PrismaClient` and has a `scoped` property. The base `prisma` client (without `.scoped`) would not have the guard. So for cleanup I can use `prisma.customer.deleteMany({})` directly on the base client.

Actually wait - let me re-read the prisma service:
```typescript
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly scoped: TenantAwarePrisma;
  constructor() {
    super();
    this.scoped = createTenantAwareClient(this);
  }
}
```

So `prisma.customer` is the raw PrismaClient model delegate (no guard), and `prisma.scoped.customer` is the guarded one. For test cleanup, I should use `prisma.customer.deleteMany({})` (the raw one).

Now let me think about the concurrency tests. For concurrent requests, I can use `Promise.all` with supertest calls.

Let me also think about the response shapes:
- `GET /customers` → 200 with array of CustomerDto `{ id, email, name }`
- `POST /customers` → 201 with CustomerDto
- `GET /customers/:id` → 200 with CustomerDto, or 404 with error envelope
- `PATCH /customers/:id` → 200 with CustomerDto, or 404
- `DELETE /customers/:id` → 200 with `{ deleted: true }`, or 404

The error envelope is:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

Let me write the full file now.

One thing I need to be careful about: the `beforeEach` cleanup. Since we're using a real database, I need to make sure cleanup works. Using the raw prisma client (not scoped) for `deleteMany` should work fine since it bypasses the tenant guard.

Actually, I realize I should think about whether `prisma.customer.deleteMany({})` would work without a tenant context. The guard only applies to `prisma.scoped.*`, not to the base `prisma.*`. So yes, using the base client for cleanup is fine.

Let me also consider: do I need to handle the case where the test database might have leftover data from previous runs? The `beforeEach` cleanup should handle that for customers. For tenants, I'll use `beforeAll` to create them and maybe check if they already exist (or just let it fail on re-run, but that's not ideal). Actually, for a test file, I'll just create them in `beforeAll` and clean up in `afterAll`.

Wait, but if the tests are run multiple times, creating tenants with unique slugs would fail. Let me use `upsert` or check first. Actually, for a test spec, I'll just do a `deleteMany` on tenants too in `beforeAll` (or use the raw client). Let me think...

Actually, the simplest approach: in `beforeAll`, delete all data (using raw prisma), then create the two tenants. In `afterAll`, close the app. The `beforeEach` cleans up customers between tests.

Let me also think about whether I need `afterEach` for cleanup or just `beforeEach`. I'll use `beforeEach` to clean customers before each test to ensure isolation between tests.

Now let me write it:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-key';
const BASE_DOMAIN = 'example.com';
const TENANT_A = 'operator-a';
const TENANT_B = 'operator-b';

function signToken(org: string): string {
  return jwt.sign({ org }, JWT_SECRET, { expiresIn: '1h' });
}

function tenantRequest(app: INestApplication, slug: string) {
  return request(app.getHttpServer())
    .set('Host', `${slug}.${BASE_DOMAIN}`)
    .set('Authorization', `Bearer ${signToken(slug)}`);
}

describe('customer isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.TENANT_BASE_DOMAIN = BASE_DOMAIN;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);

    // Clean slate
    await prisma.order.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.tenant.deleteMany({});

    // Seed tenants
    const tenantA = await prisma.tenant.create({
      data: {
        slug: TENANT_A,
        domain: `${TENANT_A}.${BASE_DOMAIN}`,
        name: 'Tenant A',
        branding: { logoUrl: 'https://a.example.com/logo.png', theme: 'dark' },
        featureFlags: { beta: true },
      },
    });
    const tenantB = await prisma.tenant.create({
      data: {
        slug: TENANT_B,
        domain: `${TENANT_B}.${BASE_DOMAIN}`,
        name: 'Tenant B',
        branding: { logoUrl: 'https://b.example.com/logo.png', theme: 'light' },
        featureFlags: { beta: false },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.customer.deleteMany({});
  });

  // --- Isolation: list ---

  it('tenant B lists customers and sees only its own rows', async () => {
    // Create a customer as tenant A
    const createA = await tenantRequest(app, TENANT_A)
      .post('/customers')
      .send({ email: 'a-only@test.com', name: 'Alice' });
    expect(createA.status).toBe(201);

    // Create a customer as tenant B
    const createB = await tenantRequest(app, TENANT_B)
      .post('/customers')
      .send({ email: 'b-only@test.com', name: 'Bob' });
    expect(createB.status).toBe(201);

    // Tenant B lists — should only see its own
    const listB = await tenantRequest(app, TENANT_B).get('/customers');
    expect(listB.status).toBe(200);
    expect(listB.body).toHaveLength(1);
    expect(listB.body[0].email).toBe('b-only@test.com');

    // Tenant A lists — should only see its own
    const listA = await tenantRequest(app, TENANT_A).get('/customers');
    expect(listA.status).toBe(200);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].email).toBe('a-only@test.com');
  });

  // --- Isolation: get by id ---

  it("tenant B fetches tenant A's customer id and receives 404 resource_not_found", async () => {
    const createA = await tenantRequest(app, TENANT_A)
      .post('/customers')
      .send({ email: 'secret@test.com', name: 'Secret' });
    expect(createA.status).toBe(201);
    const customerId = createA.body.id;

    const res = await tenantRequest(app, TENANT_B).get(`/customers/${customerId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');
  });

  // --- Isolation: update ---

  it("tenant B patches tenant A's customer — 404, and tenant A re-fetches to confirm unchanged", async () => {
    const createA = await tenantRequest(app, TENANT_A)
      .post('/customers')
      .send({ email: 'patch@test.com', name: 'Original' });
    expect(createA.status).toBe(201);
    const customerId = createA.body.id;

    // Tenant B attempts patch
    const patchB = await tenantRequest(app, TENANT_B)
      .patch(`/customers/${customerId}`)
      .send({ name: 'Hacked' });
    expect(patchB.status).toBe(404);
    expect(patchB.body.error.code).toBe('resource_not_found');

    // Tenant A confirms row is unchanged
    const getA = await tenantRequest(app, TENANT_A).get(`/customers/${customerId}`);
    expect(getA.status).toBe(200);
    expect(getA.body.name).toBe('Original');
  });

  // --- Isolation: delete ---

  it("tenant B deletes tenant A's customer — 404, and tenant A re-fetches to confirm still exists", async () => {
    const createA = await tenantRequest(app, TENANT_A)
      .post('/customers')
      .send({ email: 'delete@test.com', name: 'ToDelete' });
    expect(createA.status).toBe(201);
    const customerId = createA.body.id;

    // Tenant B attempts delete
    const delB = await tenantRequest(app, TENANT_B).delete(`/customers/${customerId}`);
    expect(delB.status).toBe(404);
    expect(delB.body.error.code).toBe('resource_not_found');

    // Tenant A confirms row still exists
    const getA = await tenantRequest(app, TENANT_A).get(`/customers/${customerId}`);
    expect(getA.status).toBe(200);
    expect(getA.body.email).toBe('delete@test.com');
  });

  // --- Same email across tenants ---

  it('same email registers under tenant A and tenant B — both succeed with distinct ids', async () => {
    const createA = await tenantRequest(app, TENANT_A)
      .post('/customers')
      .send({ email: 'shared@test.com', name: 'Alice A' });
    expect(createA.status).toBe(201);

    const createB = await tenantRequest(app, TENANT_B)
      .post('/customers')
      .send({ email: 'shared@test.com', name: 'Alice B' });
    expect(createB.status).toBe(201);

    expect(createA.body.id).not.toBe(createB.body.id);

    // Each tenant sees only its own copy
    const listA = await tenantRequest(app, TENANT_A).get('/customers');
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].name).toBe('Alice A');

    const listB = await tenantRequest(app, TENANT_B).get('/customers');
    expect(listB.body).toHaveLength(1);
    expect(listB.body[0].name).toBe('Alice B');
  });

  // --- Duplicate email within one tenant ---

  it('same email registered twice under one tenant — second returns 409 conflict', async () => {
    const first = await tenantRequest(app, TENANT_A)
      .post('/customers')
      .send({ email: 'dup@test.com', name: 'First' });
    expect(first.status).toBe(201);

    const second = await tenantRequest(app, TENANT_A)
      .post('/customers')
      .send({ email: 'dup@test.com', name: 'Second' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('conflict');
  });

  // --- Create-then-list isolation (timing) ---

  it('tenant A creates a customer; tenant B immediately lists — does not see A\'s new row', async () => {
    const createA = await tenantRequest(app, TENANT_A)
      .post('/customers')
      .send({ email: 'fresh@test.com', name: 'Fresh' });
    expect(createA.status).toBe(201);

    const listB = await tenantRequest(app, TENANT_B).get('/customers');
    expect(listB.status).toBe(200);
    const emails = listB.body.map((c: { email: string }) => c.email);
    expect(emails).not.toContain('fresh@test.com');
  });

  // --- Concurrency: reads ---

  it('concurrent interleaved GET /customers from tenant A and B — each sees only its own rows', async () => {
    // Seed both tenants
    await tenantRequest(app, TENANT_A)
      .post('/customers')
      .send({ email: 'conc-a@test.com', name: 'ConcA' });
    await tenantRequest(app, TENANT_B)
      .post('/customers')
      .send({ email: 'conc-b@test.com', name: 'ConcB' });

    // Fire concurrent reads
    const [listA, listB] = await Promise.all([
      tenantRequest(app, TENANT_A).get('/customers'),
      tenantRequest(app, TENANT_B).get('/customers'),
    ]);

    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);

    const emailsA = listA.body.map((c: { email: string }) => c.email);
    const emailsB = listB.body.map((c: { email: string }) => c.email);

    expect(emailsA).toContain('conc-a@test.com');
    expect(emailsA).not.toContain('conc-b@test.com');

    expect(emailsB).toContain('conc-b@test.com');
    expect(emailsB).not.toContain('conc-a@test.com');
  });

  // --- Concurrency: writes with same email ---

  it('concurrent interleaved POST /customers from tenant A and B with the same email — both succeed, each row belongs to correct tenant', async () => {
    const [resA, resB] = await Promise.all([
      tenantRequest(app, TENANT_A)
        .post('/customers')
        .send({ email: 'race@test.com', name: 'RaceA' }),
      tenantRequest(app, TENANT_B)
        .post('/customers')
        .send({ email: 'race@test.com', name: 'RaceB' }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body.id).not.toBe(resB.body.id);

    // Verify each tenant sees its own
    const listA = await tenantRequest(app, TENANT_A).get('/customers');
    const aEmails = listA.body.map((c: { email: string }) => c.email);
    expect(aEmails).toContain('race@test.com');
    const aRow = listA.body.find((c: { id: string }) => c.id === resA.body.id);
    expect(aRow).toBeDefined();
    expect(aRow.name).toBe('RaceA');

    const listB = await tenantRequest(app, TENANT_B).get('/customers');
    const bEmails = listB.body.map((c: { email: string }) => c.email);
    expect(bEmails).toContain('race@test.com');
    const bRow = listB.body.find((c: { id: string }) => c.id === resB.body.id);
    expect(bRow).toBeDefined();
    expect(bRow.name).toBe('RaceB');
  });

  // --- Full functionality after cross-tenant attempts ---

  it("tenant A's customer is still fully functional after all of tenant B's cross-tenant attempts", async () => {
    const createA = await tenantRequest(app, TENANT_A)
      .post('/customers')
      .send({ email: 'resilient@test.com', name: 'Resilient' });
    expect(createA.status).toBe(201);
    const customerId = createA.body.id;

    // Tenant B attempts all operations — all should fail with 404 or empty
    const listB = await tenantRequest(app, TENANT_B).get('/customers');
    expect(listB.status).toBe(200);
    expect(listB.body.map((c: { id: string }) => c.id)).not.toContain(customerId);

    const getB = await tenantRequest(app, TENANT_B).get(`/customers/${customerId}`);
    expect(getB.status).toBe(404);

    const patchB = await tenantRequest(app, TENANT_B)
      .patch(`/customers/${customerId}`)
      .send({ name: 'Tampered' });
    expect(patchB.status).toBe(404);

    const delB = await tenantRequest(app, TENANT_B).delete(`/customers/${customerId}`);
    expect(delB.status).toBe(404);

    // Tenant A: all operations still work
    const listA = await tenantRequest(app, TENANT_A).get('/customers');
    expect(listA.body.map((c: { id: string }) => c.id)).toContain(customerId);

    const getA = await tenantRequest(app, TENANT_A).get(`/customers/${customerId}`);
    expect(getA.status).toBe(200);
    expect(getA.body.name).toBe('Resilient');

    const patchA = await tenantRequest(app, TENANT_A)
      .patch(`/customers/${customerId}`)
      .send({ name: 'Updated' });
    expect(patchA.status).toBe(200);
    expect(patchA.body.name).toBe('Updated');

    const delA = await tenantRequest(app, TENANT_A).delete(`/customers/${customerId}`);
    expect(delA.status).toBe(200);
    expect(delA.body.deleted).toBe(true);

    const getAfter = await tenantRequest(app, TENANT_A).get(`/customers/${customerId}`);
    expect(getAfter.status).toBe(404);
  });
});
```

Wait, I need to double-check a few things:

1. The `prisma.order`, `prisma.plan`, `prisma.customer`, `prisma.tenant` - these are the raw PrismaClient delegates. Since `PrismaService extends PrismaClient`, yes, they're available directly.

2. For the `beforeAll` cleanup, I'm using the raw prisma client which doesn't go through the guard. That's correct.

3. The `jwt.sign` - I need to make sure the token format matches what the middleware expects. The plan says "the verified payload's `org` field is the only claim we read." So signing with `{ org: slug }` should work.

4. I'm using `jsonwebtoken` directly. This should be available as a dependency of `@nestjs/jwt`. Let me check if I need to import it differently.

Actually, looking at the NestJS JWT module, `@nestjs/jwt` depends on `jsonwebtoken`. So importing `* as jwt from 'jsonwebtoken'` should work.

5. One concern: the `beforeEach` uses `prisma.customer.deleteMany({})` which is on the raw client (no guard). This should work fine for cleanup.

6. For the concurrency tests, I'm using `Promise.all` with supertest calls. This should create truly concurrent requests that the server handles in parallel, exercising the ALS isolation.

Let me also think about whether I need to handle the case where `prisma` (the raw client) might not have `$connect` called. Since I'm getting it from the module ref and the app is initialized, `onModuleInit` should have been called which calls `$connect()`. So it should be connected.

Actually wait - `moduleRef.get(PrismaService)` gives me the same instance that the app is using. Since `app.init()` was called, `onModuleInit` ran and `$connect()` was called. So the raw client is connected. Good.

Let me also reconsider: in the `beforeAll`, I do `await prisma.order.deleteMany({})` etc. These are on the raw PrismaClient (inherited by PrismaService), so they bypass the tenant guard. Perfect for cleanup.

I think the test file is complete and correct. Let me finalize it.

One more thought: should I use `expect` from vitest? Yes, in Vitest, `expect` is globally available (or I can import it). Let me import it to be explicit:

Actually, in Vitest, `describe`, `it`, `expect`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach` are all global. No import needed. But it's good practice to not rely on globals if the tsconfig doesn't include vitest types. However, since the convention says "Vitest for tests" and this is a test file, I'll assume globals are available (which is the default Vitest setup).

Let me finalize the file.
```

## reply

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-key';
const BASE_DOMAIN = 'example.com';
const TENANT_A = 'operator-a';
const TENANT_B = 'operator-b';

function signToken(org: string): string {
  return jwt.sign({ org }, JWT_SECRET, { expiresIn: '1h' });
}

function tenantReq(app: INestApplication, slug: string) {
  return request(app.getHttpServer())
    .set('Host', `${slug}.${BASE_DOMAIN}`)
    .set('Authorization', `Bearer ${signToken(slug)}`);
}

describe('customer isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.TENANT_BASE_DOMAIN = BASE_DOMAIN;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);

    // Clean slate
    await prisma.order.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.tenant.deleteMany({});

    // Seed two tenants
    await prisma.tenant.create({
      data: {
        slug: TENANT_A,
        domain: `${TENANT_A}.${BASE_DOMAIN}`,
        name: 'Tenant A',
        branding: { logoUrl: 'https://a.example.com/logo.png', theme: 'dark' },
        featureFlags: { beta: true },
      },
    });
    await prisma.tenant.create({
      data: {
        slug: TENANT_B,
        domain: `${TENANT_B}.${BASE_DOMAIN}`,
        name: 'Tenant B',
        branding: { logoUrl: 'https://b.example.com/logo.png', theme: 'light' },
        featureFlags: { beta: false },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.customer.deleteMany({});
  });

  it('tenant B lists customers and sees only its own rows', async () => {
    const createA = await tenantReq(app, TENANT_A)
      .post('/customers')
      .send({ email: 'a-only@test.com', name: 'Alice' });
    expect(createA.status).toBe(201);

    const createB = await tenantReq(app, TENANT_B)
      .post('/customers')
      .send({ email: 'b-only@test.com', name: 'Bob' });
    expect(createB.status).toBe(201);

    const listB = await tenantReq(app, TENANT_B).get('/customers');
    expect(listB.status).toBe(200);
    expect(listB.body).toHaveLength(1);
    expect(listB.body[0].email).toBe('b-only@test.com');

    const listA = await tenantReq(app, TENANT_A).get('/customers');
    expect(listA.status).toBe(200);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].email).toBe('a-only@test.com');
  });

  it("tenant B fetches tenant A's customer id and receives 404 resource_not_found", async () => {
    const createA = await tenantReq(app, TENANT_A)
      .post('/customers')
      .send({ email: 'secret@test.com', name: 'Secret' });
    expect(createA.status).toBe(201);
    const customerId = createA.body.id;

    const res = await tenantReq(app, TENANT_B).get(`/customers/${customerId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');
  });

  it("tenant B patches tenant A's customer — 404, and tenant A re-fetches to confirm unchanged", async () => {
    const createA = await tenantReq(app, TENANT_A)
      .post('/customers')
      .send({ email: 'patch@test.com', name: 'Original' });
    expect(createA.status).toBe(201);
    const customerId = createA.body.id;

    const patchB = await tenantReq(app, TENANT_B)
      .patch(`/customers/${customerId}`)
      .send({ name: 'Hacked' });
    expect(patchB.status).toBe(404);
    expect(patchB.body.error.code).toBe('resource_not_found');

    const getA = await tenantReq(app, TENANT_A).get(`/customers/${customerId}`);
    expect(getA.status).toBe(200);
    expect(getA.body.name).toBe('Original');
  });

  it("tenant B deletes tenant A's customer — 404, and tenant A re-fetches to confirm still exists", async () => {
    const createA = await tenantReq(app, TENANT_A)
      .post('/customers')
      .send({ email: 'delete@test.com', name: 'ToDelete' });
    expect(createA.status).toBe(201);
    const customerId = createA.body.id;

    const delB = await tenantReq(app, TENANT_B).delete(`/customers/${customerId}`);
    expect(delB.status).toBe(404);
    expect(delB.body.error.code).toBe('resource_not_found');

    const getA = await tenantReq(app, TENANT_A).get(`/customers/${customerId}`);
    expect(getA.status).toBe(200);
    expect(getA.body.email).toBe('delete@test.com');
  });

  it('same email registers under tenant A and tenant B — both succeed with distinct ids', async () => {
    const createA = await tenantReq(app, TENANT_A)
      .post('/customers')
      .send({ email: 'shared@test.com', name: 'Alice A' });
    expect(createA.status).toBe(201);

    const createB = await tenantReq(app, TENANT_B)
      .post('/customers')
      .send({ email: 'shared@test.com', name: 'Alice B' });
    expect(createB.status).toBe(201);

    expect(createA.body.id).not.toBe(createB.body.id);

    const listA = await tenantReq(app, TENANT_A).get('/customers');
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].name).toBe('Alice A');

    const listB = await tenantReq(app, TENANT_B).get('/customers');
    expect(listB.body).toHaveLength(1);
    expect(listB.body[0].name).toBe('Alice B');
  });

  it('same email registered twice under one tenant — second returns 409 conflict', async () => {
    const first = await tenantReq(app, TENANT_A)
      .post('/customers')
      .send({ email: 'dup@test.com', name: 'First' });
    expect(first.status).toBe(201);

    const second = await tenantReq(app, TENANT_A)
      .post('/customers')
      .send({ email: 'dup@test.com', name: 'Second' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('conflict');
  });

  it("tenant A creates a customer; tenant B immediately lists — does not see A's new row", async () => {
    const createA = await tenantReq(app, TENANT_A)
      .post('/customers')
      .send({ email: 'fresh@test.com', name: 'Fresh' });
    expect(createA.status).toBe(201);

    const listB = await tenantReq(app, TENANT_B).get('/customers');
    expect(listB.status).toBe(200);
    const emails = listB.body.map((c: { email: string }) => c.email);
    expect(emails).not.toContain('fresh@test.com');
  });

  it('concurrent interleaved GET /customers from tenant A and B — each sees only its own rows', async () => {
    await tenantReq(app, TENANT_A)
      .post('/customers')
      .send({ email: 'conc-a@test.com', name: 'ConcA' });
    await tenantReq(app, TENANT_B)
      .post('/customers')
      .send({ email: 'conc-b@test.com', name: 'ConcB' });

    const [listA, listB] = await Promise.all([
      tenantReq(app, TENANT_A).get('/customers'),
      tenantReq(app, TENANT_B).get('/customers'),
    ]);

    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);

    const emailsA = listA.body.map((c: { email: string }) => c.email);
    const emailsB = listB.body.map((c: { email: string }) => c.email);

    expect(emailsA).toContain('conc-a@test.com');
    expect(emailsA).not.toContain('conc-b@test.com');

    expect(emailsB).toContain('conc-b@test.com');
    expect(emailsB).not.toContain('conc-a@test.com');
  });

  it('concurrent interleaved POST /customers from tenant A and B with the same email — both succeed, each row belongs to correct tenant', async () => {
    const [resA, resB] = await Promise.all([
      tenantReq(app, TENANT_A)
        .post('/customers')
        .send({ email: 'race@test.com', name: 'RaceA' }),
      tenantReq(app, TENANT_B)
        .post('/customers')
        .send({ email: 'race@test.com', name: 'RaceB' }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body.id).not.toBe(resB.body.id);

    const listA = await tenantReq(app, TENANT_A).get('/customers');
    const aRow = listA.body.find((c: { id: string }) => c.id === resA.body.id);
    expect(aRow).toBeDefined();
    expect(aRow.name).toBe('RaceA');

    const listB = await tenantReq(app, TENANT_B).get('/customers');
    const bRow = listB.body.find((c: { id: string }) => c.id === resB.body.id);
    expect(bRow).toBeDefined();
    expect(bRow.name).toBe('RaceB');
  });

  it("tenant A's customer is still fully functional after all of tenant B's cross-tenant attempts", async () => {
    const createA = await tenantReq(app, TENANT_A)
      .post('/customers')
      .send({ email: 'resilient@test.com', name: 'Resilient' });
    expect(createA.status).toBe(201);
    const customerId = createA.body.id;

    // Tenant B: all cross-tenant attempts fail
    const listB = await tenantReq(app, TENANT_B).get('/customers');
    expect(listB.status).toBe(200);
    expect(listB.body.map((c: { id: string }) => c.id)).not.toContain(customerId);

    const getB = await tenantReq(app, TENANT_B).get(`/customers/${customerId}`);
    expect(getB.status).toBe(404);

    const patchB = await tenantReq(app, TENANT_B)
      .patch(`/customers/${customerId}`)
      .send({ name: 'Tampered' });
    expect(patchB.status).toBe(404);

    const delB = await tenantReq(app, TENANT_B).delete(`/customers/${customerId}`);
    expect(delB.status).toBe(404);

    // Tenant A: all operations still work
    const listA = await tenantReq(app, TENANT_A).get('/customers');
    expect(listA.body.map((c: { id: string }) => c.id)).toContain(customerId);

    const getA = await tenantReq(app, TENANT_A).get(`/customers/${customerId}`);
    expect(getA.status).toBe(200);
    expect(getA.body.name).toBe('Resilient');

    const patchA = await tenantReq(app, TENANT_A)
      .patch(`/customers/${customerId}`)
      .send({ name: 'Updated' });
    expect(patchA.status).toBe(200);
    expect(patchA.body.name).toBe('Updated');

    const delA = await tenantReq(app, TENANT_A).delete(`/customers/${customerId}`);
    expect(delA.status).toBe(200);
    expect(delA.body.deleted).toBe(true);

    const getAfter = await tenantReq(app, TENANT_A).get(`/customers/${customerId}`);
    expect(getAfter.status).toBe(404);
  });
});
```
