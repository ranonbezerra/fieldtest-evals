import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { tenantContext } from '../src/tenant/tenant-context.js';
import { signAuthToken } from '../src/tenant/token.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const HOST_A = 'app.operator-a.com';
const HOST_B = 'app.operator-b.com';

let app: INestApplication | undefined;
let prisma: PrismaService | undefined;

const headersFor = (tenant: string, host: string): Record<string, string> => ({
  Host: host,
  Authorization: `Bearer ${signAuthToken({ org: tenant })}`,
});

async function seedTenant(
  id: string,
  host: string,
  name: string,
  branding: Prisma.InputJsonValue,
  featureFlags: Prisma.InputJsonValue,
): Promise<void> {
  await prisma!.client.tenant.upsert({
    where: { id },
    update: { host, name, branding, featureFlags },
    create: { id, host, name, branding, featureFlags },
  });
}

async function cleanTenantData(): Promise<void> {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await tenantContext.run(tenantId, async () => {
      await prisma!.client.customer.deleteMany({});
      await prisma!.client.plan.deleteMany({});
      await prisma!.client.order.deleteMany({});
    });
  }
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  prisma = moduleRef.get(PrismaService);

  await seedTenant(TENANT_A, HOST_A, 'Operator A', { theme: 'red' }, { orders: true });
  await seedTenant(TENANT_B, HOST_B, 'Operator B', { theme: 'blue' }, { orders: false });
});

beforeEach(async () => {
  await cleanTenantData();
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

test('GET /tenant-config returns branding and feature flags for the resolved tenant', async () => {
  const res = await request(app!.getHttpServer())
    .get('/tenant-config')
    .set(headersFor(TENANT_B, HOST_B));

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    id: TENANT_B,
    name: 'Operator B',
    branding: { theme: 'blue' },
    featureFlags: { orders: false },
  });
});

test('tenant B list excludes tenant A rows entirely', async () => {
  await tenantContext.run(TENANT_A, async () => {
    await prisma!.client.customer.create({ data: { email: 'a-list@example.com', name: 'A' } as Prisma.CustomerCreateInput });
  });
  await tenantContext.run(TENANT_B, async () => {
    await prisma!.client.customer.create({ data: { email: 'b-list@example.com', name: 'B' } as Prisma.CustomerCreateInput });
  });

  const res = await request(app!.getHttpServer())
    .get('/customers')
    .set(headersFor(TENANT_B, HOST_B));

  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].email).toBe('b-list@example.com');
});

test('tenant B fetch tenant A customer by id returns 404 with the same body as a missing id', async () => {
  const aCustomer = await tenantContext.run(TENANT_A, async () =>
    prisma!.client.customer.create({ data: { email: 'a-fetch@example.com', name: 'A' } as Prisma.CustomerCreateInput }),
  );

  const crossTenant = await request(app!.getHttpServer())
    .get(`/customers/${aCustomer.id}`)
    .set(headersFor(TENANT_B, HOST_B));
  const missing = await request(app!.getHttpServer())
    .get('/customers/definitely-missing-id')
    .set(headersFor(TENANT_B, HOST_B));

  expect(crossTenant.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(crossTenant.body).toEqual(missing.body);
  expect(crossTenant.body.error.code).toBe('resource_not_found');
});

test('tenant B update tenant A row returns 404 and A row remains unchanged', async () => {
  const aCustomer = await tenantContext.run(TENANT_A, async () =>
    prisma!.client.customer.create({ data: { email: 'a-update@example.com', name: 'A before' } as Prisma.CustomerCreateInput }),
  );

  const update = await request(app!.getHttpServer())
    .patch(`/customers/${aCustomer.id}`)
    .set(headersFor(TENANT_B, HOST_B))
    .send({ name: 'B changed' });

  expect(update.status).toBe(404);
  expect(update.body.error.code).toBe('resource_not_found');

  const after = await request(app!.getHttpServer())
    .get(`/customers/${aCustomer.id}`)
    .set(headersFor(TENANT_A, HOST_A));

  expect(after.status).toBe(200);
  expect(after.body.name).toBe('A before');
});

test('tenant B delete tenant A row returns 404 and A row still exists', async () => {
  const aCustomer = await tenantContext.run(TENANT_A, async () =>
    prisma!.client.customer.create({ data: { email: 'a-delete@example.com', name: 'A' } as Prisma.CustomerCreateInput }),
  );

  const del = await request(app!.getHttpServer())
    .delete(`/customers/${aCustomer.id}`)
    .set(headersFor(TENANT_B, HOST_B));

  expect(del.status).toBe(404);
  expect(del.body.error.code).toBe('resource_not_found');

  const after = await request(app!.getHttpServer())
    .get(`/customers/${aCustomer.id}`)
    .set(headersFor(TENANT_A, HOST_A));

  expect(after.status).toBe(200);
});

test('the same email registers independently in both tenants', async () => {
  const aRes = await request(app!.getHttpServer())
    .post('/customers')
    .set(headersFor(TENANT_A, HOST_A))
    .send({ email: 'shared@example.com', name: 'A Shared' });
  const bRes = await request(app!.getHttpServer())
    .post('/customers')
    .set(headersFor(TENANT_B, HOST_B))
    .send({ email: 'shared@example.com', name: 'B Shared' });

  expect(aRes.status).toBe(201);
  expect(bRes.status).toBe(201);

  const [aList, bList] = await Promise.all([
    request(app!.getHttpServer()).get('/customers').set(headersFor(TENANT_A, HOST_A)),
    request(app!.getHttpServer()).get('/customers').set(headersFor(TENANT_B, HOST_B)),
  ]);

  expect(aList.body.some((customer: { email: string }) => customer.email === 'shared@example.com')).toBe(true);
  expect(bList.body.some((customer: { email: string }) => customer.email === 'shared@example.com')).toBe(true);
});

test('concurrent requests from two tenants do not cross contexts', async () => {
  const [aCreate, bCreate] = await Promise.all([
    request(app!.getHttpServer())
      .post('/customers')
      .set(headersFor(TENANT_A, HOST_A))
      .send({ email: 'a-concurrent@example.com', name: 'A' }),
    request(app!.getHttpServer())
      .post('/customers')
      .set(headersFor(TENANT_B, HOST_B))
      .send({ email: 'b-concurrent@example.com', name: 'B' }),
  ]);

  expect(aCreate.status).toBe(201);
  expect(bCreate.status).toBe(201);

  const [aList, bList] = await Promise.all([
    request(app!.getHttpServer()).get('/customers').set(headersFor(TENANT_A, HOST_A)),
    request(app!.getHttpServer()).get('/customers').set(headersFor(TENANT_B, HOST_B)),
  ]);

  const aEmails = aList.body.map((customer: { email: string }) => customer.email);
  const bEmails = bList.body.map((customer: { email: string }) => customer.email);

  expect(aEmails).toContain('a-concurrent@example.com');
  expect(aEmails).not.toContain('b-concurrent@example.com');
  expect(bEmails).toContain('b-concurrent@example.com');
  expect(bEmails).not.toContain('a-concurrent@example.com');
});

test('a query issued with no tenant in context fails rather than returning everything', async () => {
  await tenantContext.run(TENANT_A, async () => {
    await prisma!.client.customer.create({ data: { email: 'a-no-context@example.com', name: 'A' } as Prisma.CustomerCreateInput });
  });

  await expect(prisma!.client.customer.findMany()).rejects.toMatchObject({
    code: 'tenant_context_missing',
  });
});
