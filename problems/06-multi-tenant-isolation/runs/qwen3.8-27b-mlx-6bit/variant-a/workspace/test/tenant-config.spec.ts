import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/db/prisma.service.js';

describe('GET /tenant-config', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const JWT_SECRET = 'test-secret';
  const BASE_DOMAIN = 'platform.com';

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.TENANT_BASE_DOMAIN = BASE_DOMAIN;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);

    await prisma.tenant.create({
      data: {
        slug: 'operator-x',
        domain: 'operator-x.com',
        name: 'Operator X',
        branding: { logo: '/logo-x.png' },
        featureFlags: { beta: true },
      },
    });
    await prisma.tenant.create({
      data: {
        slug: 'operator-y',
        domain: 'operator-y.com',
        name: 'Operator Y',
        branding: { logo: '/logo-y.png' },
        featureFlags: { beta: false },
      },
    });
  });

  afterEach(async () => {
    await prisma.customer.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.tenant.deleteMany({});
    await app.close();
  });

  it('returns branding and feature flags for the resolved tenant', async () => {
    const token = jwtService.sign({ org: 'operator-x' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', `operator-x.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.slug).toBe('operator-x');
    expect(res.body.name).toBe('Operator X');
    expect(res.body.branding).toEqual({ logo: '/logo-x.png' });
    expect(res.body.featureFlags).toEqual({ beta: true });
  });

  it('returns 403 tenant_mismatch when token org differs from host', async () => {
    const token = jwtService.sign({ org: 'operator-y' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', `operator-x.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('returns 403 unknown_tenant when host maps to no tenant', async () => {
    const token = jwtService.sign({ org: 'ghost' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', `ghost.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('unknown_tenant');
  });
});
