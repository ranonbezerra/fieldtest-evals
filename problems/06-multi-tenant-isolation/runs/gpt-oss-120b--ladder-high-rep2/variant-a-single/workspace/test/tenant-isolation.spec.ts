import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { Prisma } from '@prisma/client';

describe('Tenant Isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tenantA = {
    domain: 'a.operator.com',
    branding: 'Tenant A Branding',
    featureFlags: { featureX: true },
  };

  const tenantB = {
    domain: 'b.operator.com',
    branding: 'Tenant B Branding',
    featureFlags: { featureX: false },
  };

  let tenantAId: string;
  let tenantBId: string;

  let tenantACustomerId: string;
  let tenantBCustomerId: string;

  let tenantAPlanId: string;
  let tenantBPlanId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Clean DB
    await prisma.order.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    await prisma.tenant.deleteMany();

    // Create tenants
    const tenantARecord = await prisma.tenant.create({
      data: {
        domain: tenantA.domain,
        branding: tenantA.branding,
        featureFlags: tenantA.featureFlags,
      },
    });
    tenantAId = tenantARecord.id;

    const tenantBRecord = await prisma.tenant.create({
      data: {
        domain: tenantB.domain,
        branding: tenantB.branding,
        featureFlags: tenantB.featureFlags,
      },
    });
    tenantBId = tenantBRecord.id;

    // Create customers
    const custA = await prisma.customer.create({
      data: {
        email: 'john@example.com',
        name: 'John A',
        tenantId: tenantAId,
      },
    });
    tenantACustomerId = custA.id;

    const custB = await prisma.customer.create({
      data: {
        email: 'jane@example.com',
        name: 'Jane B',
        tenantId: tenantBId,
      },
    });
    tenantBCustomerId = custB.id;

    // Create plans
    const planA = await prisma.plan.create({
      data: {
        name: 'Basic A',
        price: new Prisma.Decimal(9.99),
        tenantId: tenantAId,
      },
    });
    tenantAPlanId = planA.id;

    const planB = await prisma.plan.create({
      data: {
        name: 'Basic B',
        price: new Prisma.Decimal(19.99),
        tenantId: tenantBId,
      },
    });
    tenantBPlanId = planB.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Tenant B cannot list Tenant A customers', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers')
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const emails = res.body.map((c: any) => c.email);
    expect(emails).not.toContain('john@example.com');
    expect(emails).toContain('jane@example.com');
  });

  it('Tenant B cannot fetch Tenant A customer by id (404)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${tenantACustomerId}`)
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId)
      .expect(404);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'resource_not_found');
  });

  it('Tenant B cannot update Tenant A customer (404)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/customers/${tenantACustomerId}`)
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId)
      .send({ name: 'Hacked Name' })
      .expect(404);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'resource_not_found');

    const original = await prisma.customer.findUnique({ where: { id: tenantACustomerId } });
    expect(original?.name).toBe('John A');
  });

  it('Tenant B cannot delete Tenant A customer (404)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/customers/${tenantACustomerId}`)
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId)
      .expect(404);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'resource_not_found');

    const still = await prisma.customer.findUnique({ where: { id: tenantACustomerId } });
    expect(still).not.toBeNull();
  });

  it('Same email can register in both tenants', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId)
      .send({ email: 'john@example.com', name: 'John B' })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    const newCustomerId = res.body.id;

    const cust = await prisma.customer.findUnique({ where: { id: newCustomerId } });
    expect(cust?.email).toBe('john@example.com');
    expect(cust?.tenantId).toBe(tenantBId);
  });

  it('Concurrent requests from different tenants do not cross contexts', async () => {
    const reqA = request(app.getHttpServer())
      .get('/customers')
      .set('host', tenantA.domain)
      .set('x-org-id', tenantAId);

    const reqB = request(app.getHttpServer())
      .get('/customers')
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId);

    const [resA, resB] = await Promise.all([reqA.expect(200), reqB.expect(200)]);

    const emailsA = resA.body.map((c: any) => c.email);
    const emailsB = resB.body.map((c: any) => c.email);

    expect(emailsA).toContain('john@example.com');
    expect(emailsA).not.toContain('jane@example.com');

    expect(emailsB).toContain('jane@example.com');
    expect(emailsB).not.toContain('john@example.com');
  });

  it('Query without tenant context fails', async () => {
    let errorCaught = false;
    try {
      await prisma.customer.findMany();
    } catch (err: any) {
      errorCaught = true;
      expect(err.message).toMatch(/Tenant not set/);
    }
    expect(errorCaught).toBe(true);
  });
});
