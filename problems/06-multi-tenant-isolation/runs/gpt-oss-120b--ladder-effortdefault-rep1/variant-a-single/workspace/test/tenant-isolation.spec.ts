import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';

describe('Multi‑Tenant Isolation (L2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let customerAId: string;
  let customerBId: string;

  const jwtPayload = (org: string) => ({
    sub: 'user-' + org,
    org,
  });

  const mockJwtGuard = (org: string) => ({
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.user = jwtPayload(org);
      return true;
    },
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = jwtPayload('org-a');
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);

    await prisma.order.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.tenant.deleteMany({});

    const tenantA = await prisma.tenant.create({
      data: {
        org: 'org-a',
        domain: 'app.tenant-a.com',
        branding: { logo: 'A' },
        featureFlags: { beta: true },
      },
    });
    const tenantB = await prisma.tenant.create({
      data: {
        org: 'org-b',
        domain: 'app.tenant-b.com',
        branding: { logo: 'B' },
        featureFlags: { beta: false },
      },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

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
    await app.close();
  });

  it('Tenant B cannot list Tenant A customers', async () => {
    await request(app.getHttpServer())
      .get('/customers')
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.OK)
      .expect((res: any) => {
        const ids = res.body.map((c: any) => c.id);
        if (ids.includes(customerAId)) {
          throw new Error('Tenant B received Tenant A customer');
        }
        if (!ids.includes(customerBId)) {
          throw new Error('Tenant B did not receive its own customer');
        }
      });
  });

  it('Fetching Tenant A customer by ID from Tenant B returns 404', async () => {
    await request(app.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.NOT_FOUND)
      .expect((res: any) => {
        if (res.body.error?.code !== 'resource_not_found') {
          throw new Error('Incorrect error format');
        }
      });
  });

  it('Updating Tenant A customer from Tenant B returns 404 and does not modify', async () => {
    await request(app.getHttpServer())
      .patch(`/customers/${customerAId}`)
      .send({ name: 'Hacked' })
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.NOT_FOUND);

    const fresh = await prisma.customer.findUnique({ where: { id: customerAId } });
    if (fresh?.name !== 'Alice A') {
      throw new Error('Tenant A customer was mutated by Tenant B');
    }
  });

  it('Deleting Tenant A customer from Tenant B returns 404 and stays', async () => {
    await request(app.getHttpServer())
      .delete(`/customers/${customerAId}`)
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.NOT_FOUND);

    const exists = await prisma.customer.findUnique({ where: { id: customerAId } });
    if (!exists) {
      throw new Error('Tenant A customer was deleted by Tenant B');
    }
  });

  it('Same email can be registered in both tenants', async () => {
    const resA = await request(app.getHttpServer())
      .post('/customers')
      .send({ email: 'shared@example.com', name: 'Shared A' })
      .set('Host', 'app.tenant-a.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.CREATED);

    const resB = await request(app.getHttpServer())
      .post('/customers')
      .send({ email: 'shared@example.com', name: 'Shared B' })
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.CREATED);

    const aRec = await prisma.customer.findUnique({
      where: { id: resA.body.id },
    });
    const bRec = await prisma.customer.findUnique({
      where: { id: resB.body.id },
    });
    if (aRec?.tenantId !== tenantAId || bRec?.tenantId !== tenantBId) {
      throw new Error('Tenant assignment incorrect for shared email');
    }
  });

  it('Concurrent requests from different tenants stay isolated', async () => {
    const [respA, respB] = await Promise.all([
      request(app.getHttpServer())
        .get('/customers')
        .set('Host', 'app.tenant-a.com')
        .set('Authorization', 'Bearer dummy')
        .expect(HttpStatus.OK),
      request(app.getHttpServer())
        .get('/customers')
        .set('Host', 'app.tenant-b.com')
        .set('Authorization', 'Bearer dummy')
        .expect(HttpStatus.OK),
    ]);

    const idsA = respA.body.map((c: any) => c.id);
    const idsB = respB.body.map((c: any) => c.id);

    if (idsA.includes(customerBId) || idsB.includes(customerAId)) {
      throw new Error('Cross‑tenant data leaked in concurrent requests');
    }
  });

  it('Request without tenant resolution fails', async () => {
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.BAD_REQUEST)
      .expect((res: any) => {
        if (res.body.error?.code !== 'tenant_not_resolved') {
          throw new Error('Incorrect error when tenant missing');
        }
      });
  });
});
