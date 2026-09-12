// @ts-ignore: testing library types are not available in this environment
import { beforeAll, afterAll, expect, test } from 'vitest';
// @ts-ignore: testing library types are not available in this environment
import { Test, TestingModule } from '@nestjs/testing';
// @ts-ignore: testing library types are not available in this environment
import { INestApplication } from '@nestjs/common';
// @ts-ignore: supertest types are not available in this environment
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Prisma, Customer, Tenant } from '@prisma/client';

let app: INestApplication;
let prisma: PrismaService;
let tenantAId: number;
let tenantBId: number;
let customerAId: number;
let customerBId: number;

beforeAll(async () => {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  prisma = moduleRef.get<PrismaService>(PrismaService);

  // Clean up any existing data
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.tenant.deleteMany();

  // Create tenants
  const tenantA = await prisma.tenant.create({
    data: {
      org: 'tenantA',
      domain: 'app.tenant-a.com',
      name: 'Tenant A',
      branding: { logo: 'logo-a' },
      featureFlags: { featureX: true },
    },
  });
  const tenantB = await prisma.tenant.create({
    data: {
      org: 'tenantB',
      domain: 'app.tenant-b.com',
      name: 'Tenant B',
      branding: { logo: 'logo-b' },
      featureFlags: { featureX: false },
    },
  });

  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  // Create customers
  const custA = await prisma.customer.create({
    data: {
      email: 'alice@example.com',
      name: 'Alice A',
      tenantId: tenantAId,
    },
  });
  const custB = await prisma.customer.create({
    data: {
      email: 'bob@example.com',
      name: 'Bob B',
      tenantId: tenantBId,
    },
  });

  customerAId = custA.id;
  customerBId = custB.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

test('Tenant B cannot list Tenant A rows', async () => {
  const res = await request(app.getHttpServer())
    .get('/customers')
    .set('Host', 'app.tenant-b.com')
    .set('Authorization', 'Bearer tenantB')
    .expect(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBe(1);
  expect(res.body[0].email).toBe('bob@example.com');
});

test('Tenant B fetches Tenant A customer -> 404', async () => {
  await request(app.getHttpServer())
    .get(`/customers/${customerAId}`)
    .set('Host', 'app.tenant-b.com')
    .set('Authorization', 'Bearer tenantB')
    .expect(404)
    .expect((res: any) => {
      expect(res.body).toMatchObject({
        error: {
          code: 'resource_not_found',
          message: expect.any(String),
          details: {}
        }
      });
    });
});

test('Tenant B cannot update Tenant A customer', async () => {
  await request(app.getHttpServer())
    .patch(`/customers/${customerAId}`)
    .set('Host', 'app.tenant-b.com')
    .set('Authorization', 'Bearer tenantB')
    .send({ name: 'Hacked' })
    .expect(404);
  const cust = await prisma.customer.findUnique({ where: { id: customerAId } });
  expect(cust!.name).toBe('Alice A');
});

test('Tenant B cannot delete Tenant A customer', async () => {
  await request(app.getHttpServer())
    .delete(`/customers/${customerAId}`)
    .set('Host', 'app.tenant-b.com')
    .set('Authorization', 'Bearer tenantB')
    .expect(404);
  const cust = await prisma.customer.findUnique({ where: { id: customerAId } });
  expect(cust).not.toBeNull();
});

test('Same email can register in both tenants', async () => {
  const res = await request(app.getHttpServer())
    .post('/customers')
    .set('Host', 'app.tenant-b.com')
    .set('Authorization', 'Bearer tenantB')
    .send({ email: 'alice@example.com', name: 'Alice B' })
    .expect(201);
  expect(res.body.email).toBe('alice@example.com');

  const aliceB = await prisma.customer.findFirst({
    where: { email: 'alice@example.com', tenantId: tenantBId },
  });
  expect(aliceB).not.toBeNull();
});

test('Concurrent requests from different tenants do not cross contexts', async () => {
  const [resA, resB] = await Promise.all([
    request(app.getHttpServer())
      .get('/customers')
      .set('Host', 'app.tenant-a.com')
      .set('Authorization', 'Bearer tenantA')
      .expect(200),
    request(app.getHttpServer())
      .get('/customers')
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer tenantB')
      .expect(200),
  ]);

  // Tenant A should see only its own customer
  expect(resA.body.length).toBe(1);
  expect(resA.body[0].email).toBe('alice@example.com');

  // Tenant B should see its own customers (bob and the newly added alice)
  const emailsB = resB.body.map((c: any) => c.email);
  expect(emailsB).toContain('bob@example.com');
  expect(emailsB).toContain('alice@example.com');
});

test('Request without tenant info fails', async () => {
  await request(app.getHttpServer())
    .get('/customers')
    .set('Host', 'app.tenant-a.com')
    // No Authorization header
    .expect(401)
    .expect((res: any) => {
      expect(res.body).toMatchObject({
        error: {
          code: 'tenant_resolution_failed',
          message: expect.any(String),
          details: {}
        }
      });
    });
});

test('GET /tenant-config returns branding and feature flags', async () => {
  const res = await request(app.getHttpServer())
    .get('/tenant-config')
    .set('Host', 'app.tenant-a.com')
    .set('Authorization', 'Bearer tenantA')
    .expect(200);
  expect(res.body).toMatchObject({
    branding: { logo: 'logo-a' },
    featureFlags: { featureX: true },
  });
});
