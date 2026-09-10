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
