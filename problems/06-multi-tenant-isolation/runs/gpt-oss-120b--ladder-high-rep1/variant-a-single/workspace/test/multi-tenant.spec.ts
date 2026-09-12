import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '@prisma/client';

describe('Multi-tenant isolation', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  const tenantA = { org: 'org-a', host: 'tenant-a.com', name: 'Tenant A' };
  const tenantB = { org: 'org-b', host: 'tenant-b.com', name: 'Tenant B' };

  let customerAId: number;
  let customerBId: number;

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    await prisma.order.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    await prisma.tenant.deleteMany();

    const tenantARecord = await prisma.tenant.create({
      data: {
        org: tenantA.org,
        host: tenantA.host,
        name: tenantA.name,
        branding: { logo: 'logo-a.png' },
        feature_flags: { featureX: true },
      },
    });

    const tenantBRecord = await prisma.tenant.create({
      data: {
        org: tenantB.org,
        host: tenantB.host,
        name: tenantB.name,
        branding: { logo: 'logo-b.png' },
        feature_flags: { featureX: false },
      },
    });

    const custA = await prisma.customer.create({
      data: {
        tenantId: tenantARecord.id,
        email: 'alice@example.com',
        name: 'Alice',
      },
    });
    const custB = await prisma.customer.create({
      data: {
        tenantId: tenantBRecord.id,
        email: 'bob@example.com',
        name: 'Bob',
      },
    });

    customerAId = custA.id;
    customerBId = custB.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('Tenant B cannot see Tenant A rows', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers')
      .set('host', tenantB.host)
      .set('x-org', tenantB.org)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].email).toBe('bob@example.com');
  });

  it('Tenant B cannot fetch Tenant A customer by id (404)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set('host', tenantB.host)
      .set('x-org', tenantB.org)
      .expect(404);

    expect(res.body).toEqual({
      error: {
        code: 'resource_not_found',
        message: `Customer with id ${customerAId} not found`,
        details: {},
      },
    });
  });

  it('Tenant B cannot update Tenant A customer (404)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/customers/${customerAId}`)
      .send({ name: 'Eve' })
      .set('host', tenantB.host)
      .set('x-org', tenantB.org)
      .expect(404);

    expect(res.body.error.code).toBe('resource_not_found');

    const check = await request(app.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set('host', tenantA.host)
      .set('x-org', tenantA.org)
      .expect(200);

    expect(check.body.name).toBe('Alice');
  });

  it('Tenant B cannot delete Tenant A customer (404)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/customers/${customerAId}`)
      .set('host', tenantB.host)
      .set('x-org', tenantB.org)
      .expect(404);

    expect(res.body.error.code).toBe('resource_not_found');

    const check = await request(app.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set('host', tenantA.host)
      .set('x-org', tenantA.org)
      .expect(200);
    expect(check.body.email).toBe('alice@example.com');
  });

  it('Same email can register in both tenants', async () => {
    const email = 'shared@example.com';

    const resA = await request(app.getHttpServer())
      .post('/customers')
      .send({ email, name: 'Shared A' })
      .set('host', tenantA.host)
      .set('x-org', tenantA.org)
      .expect(201);
    expect(resA.body.email).toBe(email);
    expect(resA.body.name).toBe('Shared A');

    const resB = await request(app.getHttpServer())
      .post('/customers')
      .send({ email, name: 'Shared B' })
      .set('host', tenantB.host)
      .set('x-org', tenantB.org)
      .expect(201);
    expect(resB.body.email).toBe(email);
    expect(resB.body.name).toBe('Shared B');
  });

  it('Concurrent requests from different tenants do not cross contexts', async () => {
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .get('/customers')
        .set('host', tenantA.host)
        .set('x-org', tenantA.org),
      request(app.getHttpServer())
        .get('/customers')
        .set('host', tenantB.host)
        .set('x-org', tenantB.org),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const emailsA = resA.body.map((c: any) => c.email);
    const emailsB = resB.body.map((c: any) => c.email);

    expect(emailsA).toContain('alice@example.com');
    expect(emailsA).toContain('shared@example.com');
    expect(emailsA).not.toContain('bob@example.com');

    expect(emailsB).toContain('bob@example.com');
    expect(emailsB).toContain('shared@example.com');
    expect(emailsB).not.toContain('alice@example.com');
  });

  it('Request without tenant context fails', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers')
      .set('host', tenantA.host)
      .expect(401);
    expect(res.body.error.code).toBe('unauthorized');
  });
});
