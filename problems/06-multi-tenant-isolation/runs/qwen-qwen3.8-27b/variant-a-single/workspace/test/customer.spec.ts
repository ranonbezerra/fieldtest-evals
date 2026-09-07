import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { CustomerModule } from '../src/customer/customer.module';
import { TenantModule } from '../src/tenant/tenant.module';
import { PrismaService } from '../src/prisma/prisma.service';
// ASSUMPTION: middleware class name and export shape are not visible from the error messages; assumed to follow the feature-scoped naming convention.
import { TenantResolutionMiddleware } from '../src/tenant/tenant-resolution.middleware';

// ASSUMPTION: token format and host-to-tenant mapping are not visible from the error messages; assumed JWT with an `org` claim matching tenant id, and host derived from tenant.
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const HOST_A = 'app.operator-a.com';
const HOST_B = 'app.operator-b.com';
const TOKEN_A = 'jwt-org-tenant-a';
const TOKEN_B = 'jwt-org-tenant-b';

describe('Customer tenant isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CustomerModule, TenantModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(TenantResolutionMiddleware);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE "customers", "plans", "orders", "tenants" RESTART IDENTITY CASCADE`,
    );
  });

  describe('cross-tenant isolation', () => {
    let customerIdA: string;
    let customerIdB: string;

    beforeEach(async () => {
      // ASSUMPTION: Tenant model has at minimum `id` and `name` fields; Customer has `id`, `tenantId`, `email`, `name`.
      await prisma.tenant.create({ data: { id: TENANT_A, name: 'Operator A' } });
      await prisma.tenant.create({ data: { id: TENANT_B, name: 'Operator B' } });

      const custA = await prisma.customer.create({
        data: { tenantId: TENANT_A, email: 'shared@example.com', name: 'Alice' },
      });
      const custB = await prisma.customer.create({
        data: { tenantId: TENANT_B, email: 'shared@example.com', name: 'Bob' },
      });

      customerIdA = custA.id;
      customerIdB = custB.id;
    });

    it('tenant B cannot list tenant A customers', async () => {
      const res = await request(app.getHttpServer())
        .get('/customers')
        .set('Host', HOST_B)
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(200);

      const ids: string[] = res.body.map((c: { id: string }) => c.id);
      expect(ids).not.toContain(customerIdA);
      expect(ids).toContain(customerIdB);
    });

    it('tenant B cannot fetch tenant A customer by id (404)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/customers/${customerIdA}`)
        .set('Host', HOST_B)
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(404);

      expect(res.body.error.code).toBe('resource_not_found');
    });

    it('tenant B cannot update tenant A customer', async () => {
      await request(app.getHttpServer())
        .patch(`/customers/${customerIdA}`)
        .set('Host', HOST_B)
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .send({ name: 'Hacked' })
        .expect(404);

      const db = await prisma.customer.findUnique({ where: { id: customerIdA } });
      expect(db?.name).toBe('Alice');
    });

    it('tenant B cannot delete tenant A customer', async () => {
      await request(app.getHttpServer())
        .delete(`/customers/${customerIdA}`)
        .set('Host', HOST_B)
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(404);

      const db = await prisma.customer.findUnique({ where: { id: customerIdA } });
      expect(db).not.toBeNull();
      expect(db?.id).toBe(customerIdA);
    });
  });

  describe('same email in both tenants', () => {
    it('allows registering the same email in both tenants', async () => {
      const resA = await request(app.getHttpServer())
        .post('/customers')
        .set('Host', HOST_A)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ email: 'dup@example.com', name: 'Dup A' })
        .expect(201);

      const resB = await request(app.getHttpServer())
        .post('/customers')
        .set('Host', HOST_B)
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .send({ email: 'dup@example.com', name: 'Dup B' })
        .expect(201);

      expect(resA.body.id).not.toBe(resB.body.id);

      // Verify both rows exist in the database under their respective tenants
      const rowsA = await prisma.customer.findMany({
        where: { email: 'dup@example.com', tenantId: TENANT_A },
      });
      const rowsB = await prisma.customer.findMany({
        where: { email: 'dup@example.com', tenantId: TENANT_B },
      });
      expect(rowsA).toHaveLength(1);
      expect(rowsB).toHaveLength(1);
      expect(rowsA[0].id).toBe(resA.body.id);
      expect(rowsB[0].id).toBe(resB.body.id);
    });
  });

  describe('concurrent requests do not cross contexts', () => {
    it('concurrent requests from different tenants return only their own data', async () => {
      await prisma.tenant.create({ data: { id: TENANT_A, name: 'Operator A' } });
      await prisma.tenant.create({ data: { id: TENANT_B, name: 'Operator B' } });
      const custA = await prisma.customer.create({
        data: { tenantId: TENANT_A, email: 'conc-a@example.com', name: 'Conc A' },
      });
      const custB = await prisma.customer.create({
        data: { tenantId: TENANT_B, email: 'conc-b@example.com', name: 'Conc B' },
      });

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .get('/customers')
          .set('Host', HOST_A)
          .set('Authorization', `Bearer ${TOKEN_A}`),
        request(app.getHttpServer())
          .get('/customers')
          .set('Host', HOST_B)
          .set('Authorization', `Bearer ${TOKEN_B}`),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const idsA: string[] = resA.body.map((c: { id: string }) => c.id);
      const idsB: string[] = resB.body.map((c: { id: string }) => c.id);

      expect(idsA).toContain(custA.id);
      expect(idsA).not.toContain(custB.id);
      expect(idsB).toContain(custB.id);
      expect(idsB).not.toContain(custA.id);
    });
  });
});
