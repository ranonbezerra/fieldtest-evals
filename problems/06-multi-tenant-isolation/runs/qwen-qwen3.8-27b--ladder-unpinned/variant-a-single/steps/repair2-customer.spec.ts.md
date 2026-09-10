# repair2-customer.spec.ts

## reasoning

```
Let me analyze the compiler errors. They're all in `test/tenant.spec.ts`, not in `test/customer.spec.ts`. But the task says "Rewrite `test/customer.spec.ts` complete, fixing what these messages require of this file."

Wait, let me re-read. The task says:

"`test/customer.spec.ts` does not compile. These are the compiler's exact messages for the whole workspace — not a summary of them:"

But the errors are all in `test/tenant.spec.ts`. The first error line is:

```
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
```

This one doesn't have a file prefix shown (it's cut off), but the rest are all in `test/tenant.spec.ts`.

Wait, looking more carefully at the error output:

```
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(90,17): error TS2559: ...
```

The first error line is missing its file prefix - it's likely from `test/customer.spec.ts` since the task says that file doesn't compile. The other errors are all in `test/tenant.spec.ts`.

So the error in `test/customer.spec.ts` is:
- `Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ... }' has no call signatures.`

This is a classic issue with importing `supertest`. In ESM projects (`"type": "module"`), when you do `import request from 'supertest'`, the default import might not work correctly because supertest is a CJS module. The fix is typically:

```typescript
import { request } from 'supertest';
```

or 

```typescript
import request from 'supertest';
```

Wait, but the error says the type has "no call signatures" and it's `SuperTestStatic`. This suggests the import is getting the module namespace object instead of the callable function.

In ESM with TypeScript strict mode, if `supertest` is a CJS module, `import request from 'supertest'` should work if `esModuleInterop` is enabled. But if it's not, or if the types are being resolved differently...

Actually, looking at this more carefully - the type shown is `{ default: SuperTestStatic; Test: typeof Test; agent: ... }`. This is the shape of the supertest module when you import it as a namespace or when the default export isn't properly resolved.

The fix is to use a named import or to properly import the default. In ESM contexts with CJS modules, the common fix is:

```typescript
import request from 'supertest';
```

This should work with `esModuleInterop: true`. But if the types are resolving to the module namespace...

Actually, another common approach in ESM is:

```typescript
import { request } from 'supertest';
```

Wait no, supertest doesn't export `request` as a named export in its types.

Let me think about this differently. The type `{ default: SuperTestStatic; Test: typeof Test; agent: ... }` is what you get when you do `import * as request from 'supertest'` or when the module resolution gives you the namespace object.

The fix would be to import it correctly. In an ESM project with TypeScript, the proper way to import a CJS module's default export is:

```typescript
import request from 'supertest';
```

This requires `esModuleInterop: true` in tsconfig, which is standard.

But wait - if the project is ESM (`"type": "module"`), and supertest is CJS, there might be an issue. In that case, you might need:

```typescript
import request from 'supertest';
```

And ensure the tsconfig has `"esModuleInterop": true` and `"module": "ESNext"` or similar.

Actually, I think the issue might be that in the current code, it's doing something like:

```typescript
import * as request from 'supertest';
```

or the import is resolving to the module namespace.

Since I need to rewrite `test/customer.spec.ts` and the only error from that file is the supertest import issue, I need to write a complete test file that:
1. Uses the correct supertest import
2. Tests the customer CRUD operations with tenant isolation

Looking at the reference code for `customer.service.ts`, the service has:
- `create(input: CustomerInput)` - takes email and optional name
- `findAll()` - returns all customers
- `findById(id: string)` - returns one or throws NotFoundException
- `update(id: string, input: CustomerInput)` - updates
- `remove(id: string)` - deletes

The tenant-prisma service uses a request-scoped context.

For the test, I need to:
1. Set up the NestJS testing module with the customer module
2. Mock or use the tenant context
3. Test that tenant B cannot access tenant A's data
4. Test that the same email can exist in both tenants

Let me think about what the test file should look like. Given the architecture:
- Tenant resolution middleware sets the tenant in request context
- The tenant-prisma service scopes all queries by tenant
- The customer repository uses the tenant-prisma service

For testing, I'll need to:
- Create a test app
- Set up the tenant context (mock it or use the middleware)
- Test CRUD operations
- Test isolation between tenants

Let me write the test file. The key fix is the supertest import. I'll use:

```typescript
import request from 'supertest';
```

Now let me think about what the full test should contain based on the variant requirements:
- Tenant B cannot list tenant A's rows
- Tenant B cannot fetch-by-id tenant A's rows (expect 404)
- Tenant B cannot update tenant A's rows
- Tenant B cannot delete tenant A's rows
- Same email registers in both tenants

I'll need to mock the TenantContextService to switch between tenants, or use the middleware with different hosts.

Actually, looking at the architecture more carefully - the tenant is resolved from the request (host + token). So in tests, I'd need to simulate different requests with different tenant identities.

Let me write a comprehensive test file. I'll mock the TenantContextService since it's request-scoped and the test needs to control which tenant is active.

Actually, let me reconsider. The test should test behavior through the HTTP interface (using supertest), so I should use the actual middleware or set up the request context properly.

But the simplest approach that tests behavior:
1. Create the test module with real services but mocked tenant context
2. Or use the actual app with different request headers/hosts

Given that the tenant-prisma service is request-scoped and reads from TenantContextService, and the middleware sets it based on the request, I think the cleanest test approach is:

1. Create the full app (or test module)
2. Send requests with appropriate headers that the middleware will use to resolve the tenant
3. Verify isolation

But I don't know the exact middleware implementation or what headers it reads. Let me look at what I can infer...

From the variant description: "derive the tenant from host + token org claim (both must agree)"

So the middleware looks at:
- The `Host` header (e.g., `app.operator-x.com`)
- The `Authorization` Bearer token, which contains an `org` claim

For tests, I'll need to:
- Create tenants in the database
- Send requests with the correct host and token

But this gets complex. A simpler approach for unit/integration tests is to mock the TenantContextService and TenantPrismaService.

Actually, let me think about this differently. The task says to fix the compilation errors. The only error in `test/customer.spec.ts` is the supertest import. So I need to:

1. Fix the supertest import
2. Keep the rest of the test file as reasonable

But I don't have the current content of `test/customer.spec.ts`. The task says "Rewrite `test/customer.spec.ts` complete" - so I need to write it from scratch.

Let me write a proper test file that:
- Uses `import request from 'supertest'` (the fix)
- Tests customer CRUD with tenant isolation
- Follows the testing conventions (test behavior, not implementation)

I'll structure it as an integration test that creates the NestJS test module, sets up tenants, and tests isolation through the HTTP layer.

Let me think about what modules/services I need:
- `CustomerModule` (which provides `CustomerController`, `CustomerService`, `CustomerRepository`)
- The Prisma service and tenant context

For the test to work with tenant isolation, I'll need to either:
a) Use the full app with middleware, or
b) Mock the tenant context

Option (b) is more practical for a test file. I'll mock `TenantContextService` to return different tenant IDs, and use a real or in-memory database.

Actually, for a proper integration test with Prisma, I'd need a real database. But for a unit test, I can mock the repository.

Wait - the conventions say "Test the behaviour, not the implementation. Never assert only that a call happened." So I should test through the service or HTTP layer, not by mocking the repository and asserting calls.

But without a real database, I can't do full integration tests. Let me think...

The most practical approach for a test file that compiles and tests behavior:
- Use NestJS testing module
- Provide the real service
- Mock the repository at the boundary (since we can't have a real DB in tests easily)
- But wait, "Never assert only that a call happened" - so I need to assert on return values and thrown errors

Actually, I think the best approach is:
- Test through the HTTP layer with supertest
- Use the full app setup (or a test module)
- Mock at the Prisma level or use a test database

But this is getting complex without knowing the exact module structure. Let me write a test that:
1. Creates a test module with the customer controller, service, and a mocked repository
2. Tests the service behavior (returns data, throws 404 for not found)
3. Tests that tenant isolation works (the repository is called, and when it returns null for a cross-tenant lookup, the service throws 404)

Wait, but if I mock the repository, I'm testing that the service calls the repository and handles the response - that's testing behavior at the service level.

Let me write a clean test file:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { CustomerController } from '../src/customer/customer.controller';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerRepository } from '../src/customer/customer.repository';
import { TenantContextService } from '../src/prisma/tenant-context.service';
import request from 'supertest';
```

Hmm, but I don't know the exact exports from these files. Let me infer from the references:

From `customer.service.ts`:
- Exports `CustomerService` (Injectable)
- Exports `CustomerInput` interface
- Depends on `CustomerRepository`

From `tenant-prisma.service.ts`:
- Exports `TenantPrismaService` (Injectable, request-scoped)
- Depends on `PrismaClient` and `TenantContextService`

I'll need to mock at the repository level since that's the boundary between service logic and database.

Let me write the test:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerRepository } from '../src/customer/customer.repository';
import request from 'supertest';
```

Actually, I realize I'm overcomplicating this. Let me just write a test that:
1. Fixes the supertest import (the actual bug)
2. Tests the customer service behavior
3. Is reasonable and compiles

The key constraint is: the only error in `test/customer.spec.ts` is the supertest import. So the rest of the file was presumably fine (or at least, the errors are only about the import). I just need to fix the import and keep reasonable test content.

Let me write a complete test file that tests customer CRUD behavior with tenant isolation:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerRepository } from '../src/customer/customer.repository';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { CustomerController } from '../src/customer/customer.controller';
```

Wait, I don't know if there's a controller file. Let me look at the layout convention:

```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

So yes, there should be a `customer.controller.ts`.

Let me write a test that goes through the HTTP layer using supertest, which is what the original error suggests (the file uses supertest). I'll set up a test module with the controller, service, and a mocked repository.

Here's my plan:
1. Import `request` from `'supertest'` (the fix)
2. Set up a test module with CustomerController, CustomerService, and a mock CustomerRepository
3. Test:
   - Create customer
   - Find all customers
   - Find by ID (found and not found)
   - Update customer
   - Delete customer
   - Tenant isolation: repository returns null for cross-tenant → service throws 404
   - Same email in different tenants (repository level - both succeed)

Let me write this out:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { CustomerController } from '../src/customer/customer.controller';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerRepository } from '../src/customer/customer.repository';
import request from 'supertest';
```

Actually, I realize I should keep it simpler. The test file should test behavior. Let me focus on what makes sense:

For a test that uses supertest (HTTP-level testing), I need:
- The controller
- The service (real)
- The repository (mocked, since we don't have a DB)

The mock repository simulates tenant isolation by only returning data for the "current" tenant.

Let me write the complete file:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { CustomerController } from '../src/customer/customer.controller';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerRepository } from '../src/customer/customer.repository';
import request from 'supertest';

// In-memory tenant-scoped data store
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function createMockRepository(tenantId: string) {
  const store = new Map<string, { id: string; email: string; name: string | null; tenantId: string }>();
  let idCounter = 0;

  return {
    create(data: { email: string; name: string | null }) {
      idCounter++;
      const customer = { id: String(idCounter), email: data.email, name: data.name, tenantId };
      store.set(customer.id, customer);
      return Promise.resolve(customer);
    },
    findMany() {
      return Promise.resolve([...store.values()]);
    },
    findById(id: string) {
      const customer = store.get(id);
      if (!customer || customer.tenantId !== tenantId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(customer);
    },
    update(id: string, data: { email: string; name: string | null }) {
      const customer = store.get(id);
      if (!customer || customer.tenantId !== tenantId) {
        return Promise.resolve(null);
      }
      const updated = { ...customer, ...data };
      store.set(id, updated);
      return Promise.resolve(updated);
    },
    delete(id: string) {
      const customer = store.get(id);
      if (!customer || customer.tenantId !== tenantId) {
        return Promise.reject(new Error('Not found'));
      }
      store.delete(id);
      return Promise.resolve();
    },
  };
}
```

Hmm, but this is getting complex and I'm making assumptions about the repository interface. Let me look at what I know from the service:

```typescript
async create(input: CustomerInput) {
  return this.customerRepository.create({ email: input.email, name: input.name ?? null });
}
async findAll() {
  return this.customerRepository.findMany();
}
async findById(id: string) {
  const customer = await this.customerRepository.findById(id);
  if (!customer) { throw new NotFoundException(); }
  return customer;
}
async update(id: string, input: CustomerInput) {
  const existing = await this.customerRepository.findById(id);
  if (!existing) { throw new NotFoundException(); }
  return this.customerRepository.update(id, { email: input.email, name: input.name ?? null });
}
async remove(id: string) {
  const existing = await this.customerRepository.findById(id);
  if (!existing) { throw new NotFoundException(); }
  await this.customerRepository.delete(id);
}
```

So the repository interface is:
- `create(data: { email: string; name: string | null })` → Promise<Customer>
- `findMany()` → Promise<Customer[]>
- `findById(id: string)` → Promise<Customer | null>
- `update(id: string, data: { email: string; name: string | null })` → Promise<Customer>
- `delete(id: string)` → Promise<void>

Now, for the test, I have two approaches:
1. HTTP-level test with supertest
```

## reply

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import * as request from 'supertest';
import { App } from 'supertest';
import { CustomerModule } from '../src/customer/customer.module';
import { CustomerController } from '../src/customer/customer.controller';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerRepository } from '../src/customer/customer.repository';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { TenantConfigModule } from '../src/tenant-config/tenant-config.module';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function makePrismaForTenant(prisma: PrismaClient, tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const typedArgs = args as Record<string, unknown>;
          if (
            operation === 'findMany' ||
            operation === 'findFirst' ||
            operation === 'findUnique' ||
            operation === 'count' ||
            operation === 'aggregate' ||
            operation === 'groupBy'
          ) {
            typedArgs.where = {
              ...((typedArgs.where as object) ?? {}),
              tenantId,
            };
          }
          if (operation === 'create') {
            typedArgs.data = { ...(typedArgs.data as object), tenantId };
          }
          if (operation === 'createMany') {
            if (Array.isArray(typedArgs.data)) {
              typedArgs.data = (typedArgs.data as Record<string, unknown>[]).map(
                (d) => ({ ...d, tenantId }),
              );
            } else {
              typedArgs.data = { ...(typedArgs.data as object), tenantId };
            }
          }
          if (
            operation === 'update' ||
            operation === 'updateMany' ||
            operation === 'delete' ||
            operation === 'deleteMany' ||
            operation === 'upsert'
          ) {
            typedArgs.where = {
              ...((typedArgs.where as object) ?? {}),
              tenantId,
            };
          }
          return query(typedArgs as never);
        },
      },
    },
  }) as unknown as PrismaClient;
}

describe('CustomerService (tenant isolation)', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let serviceA: CustomerService;
  let serviceB: CustomerService;
  let prismaA: ReturnType<typeof makePrismaForTenant>;
  let prismaB: ReturnType<typeof makePrismaForTenant>;
  const basePrisma = new PrismaClient();

  function makeModule() {
    return {
      providers: [
        CustomerController,
        CustomerService,
        CustomerRepository,
        { provide: TenantContextService, useValue: { getTenantId: () => TENANT_A } },
        { provide: TenantPrismaService, useValue: prismaA },
      ],
      controllers: [CustomerController],
    };
  }

  beforeAll(async () => {
    await basePrisma.$connect();
    await seedTenant(TENANT_A);
    await seedTenant(TENANT_B);
    prismaA = makePrismaForTenant(basePrisma, TENANT_A);
    prismaB = makePrismaForTenant(basePrisma, TENANT_B);
    appA = await createApp(prismaA, TENANT_A);
    appB = await createApp(prismaB, TENANT_B);
  });

  afterAll(async () => {
    if (appA) await appA.close();
    if (appB) await appB.close();
    await basePrisma.$disconnect();
  });

  beforeEach(async () => {
    await basePrisma.customer.deleteMany({ where: { tenantId: TENANT_A } });
    await basePrisma.customer.deleteMany({ where: { tenantId: TENANT_B } });
  });

  async function seedTenant(id: string) {
    try {
      await basePrisma.tenant.create({ data: { id } });
    } catch {
      // already exists
    }
  }

  async function createApp(prisma: ReturnType<typeof makePrismaForTenant>, tenantId: string) {
    const moduleRef = await Test.createTestingModule({
      imports: [CustomerModule, TenantConfigModule],
      controllers: [CustomerController],
      providers: [
        CustomerService,
        CustomerRepository,
        { provide: TenantContextService, useValue: { getTenantId: () => tenantId } },
        { provide: TenantPrismaService, useValue: prisma },
      ],
    })
      .overrideProvider(TenantPrismaService)
      .useValue(prisma)
      .overrideProvider(TenantContextService)
      .useValue({ getTenantId: () => tenantId })
      .compile();

    const application = moduleRef.createNestApplication();
    await application.init();
    serviceA = moduleRef.get(CustomerService);
    serviceB = moduleRef.get(CustomerService);
    return application;
  }

  it('tenant B cannot list tenant A customers', async () => {
    const created = await serviceA.create({ email: 'alice@operator-x.com' });
    expect(created.tenantId).toBe(TENANT_A);

    const b = await (serviceB as CustomerService).findAll();
    expect(b).toEqual([]);
  });

  it('tenant B cannot fetch-by-id a tenant A customer (404)', async () => {
    const created = await serviceA.create({ email: 'alice@operator-x.com' });
    expect(created.id).toBeDefined();
    await expect(serviceB.findById(created.id)).rejects.toThrow();
  });

  it('tenant B cannot update a tenant A customer', async () => {
    const created = await serviceA.create({ email: 'alice@operator-x.com' });
    await expect(
      serviceB.update(created.id, { email: 'alice@operator-x.com', name: 'Hacked' }),
    ).rejects.toThrow();
  });

  it('tenant B cannot delete a tenant A customer', async () => {
    const created = await serviceA.create({ email: 'alice@operator-x.com' });
    await expect(serviceB.remove(created.id)).rejects.toThrow();
    const stillThere = await prismaA.customer.findUnique({ where: { id: created.id } });
    expect(stillThere).not.toBeNull();
  });

  it('same email registers in both tenants', async () => {
    const a = await serviceA.create({ email: 'shared@operator-x.com' });
    const b = await serviceB.create({ email: 'shared@operator-x.com' });
    expect(a.tenantId).toBe(TENANT_A);
    expect(b.tenantId).toBe(TENANT_B);
    expect(a.id).not.toBe(b.id);
  });

  it('concurrent requests from different tenants do not cross contexts', async () => {
    const [a, b] = await Promise.all([
      serviceA.create({ email: 'concurrent@operator-x.com' }),
      serviceB.create({ email: 'concurrent@operator-x.com' }),
    ]);
    expect(a.tenantId).toBe(TENANT_A);
    expect(b.tenantId).toBe(TENANT_B);
  });
});
```
