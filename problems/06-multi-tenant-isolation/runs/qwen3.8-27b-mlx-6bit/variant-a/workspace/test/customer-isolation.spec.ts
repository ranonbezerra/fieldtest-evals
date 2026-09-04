import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
// @ts-expect-error Missing type declarations for @nestjs/testing
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
// @ts-expect-error Missing type declarations for supertest
import * as request from 'supertest';
// @ts-expect-error Missing type declarations for jsonwebtoken
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../src/db/prisma.service';

const JWT_SECRET = 'test-secret-key';
const BASE_DOMAIN = 'example.com';

function makeToken(org: string): string {
  return jwt.sign({ org }, JWT_SECRET, { expiresIn: '1h' });
}

describe('Customer tenant isolation', () => {
  let app: TestingModule;
  let prisma: PrismaService;

  const tokenA = makeToken('tenant-a');
  const tokenB = makeToken('tenant-b');

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.TENANT_BASE_DOMAIN = BASE_DOMAIN;

    app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await app.init();
    prisma = app.get(PrismaService);

    // Seed tenants directly (Tenant model is exempt from the tenant guard)
    await prisma.tenant.create({
      data: {
        slug: 'tenant-a',
        domain: `tenant-a.${BASE_DOMAIN}`,
        name: 'Tenant A',
        branding: { logo: 'a.png' },
        featureFlags: { beta: true },
      },
    });
    await prisma.tenant.create({
      data: {
        slug: 'tenant-b',
        domain: `tenant-b.${BASE_DOMAIN}`,
        name: 'Tenant B',
        branding: { logo: 'b.png' },
        featureFlags: { beta: false },
      },
    });
  });

  beforeEach(async () => {
    await prisma.customer.deleteMany({});
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({});
    await prisma.tenant.deleteMany({});
    await app.close();
  });

  it('tenant B cannot list tenant A rows', async () => {
    const resA = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', `tenant-a.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'user-a@example.com', name: 'User A' });
    expect(resA.status).toBe(201);

    const resB = await request(app.getHttpServer())
      .get('/customers')
      .set('Host', `tenant-b.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    expect(resB.body).toHaveLength(0);
  });

  it('tenant B fetch-by-id on tenant A customer returns 404', async () => {
    const resA = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', `tenant-a.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'user-a@example.com' });
    expect(resA.status).toBe(201);
    const customerA = resA.body;

    const resB = await request(app.getHttpServer())
      .get(`/customers/${customerA.id}`)
      .set('Host', `tenant-b.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(404);
    expect(resB.body.error.code).toBe('resource_not_found');
  });

  it('tenant B cannot update tenant A customer (404, row unchanged)', async () => {
    const resA = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', `tenant-a.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'user-a@example.com', name: 'Original' });
    expect(resA.status).toBe(201);
    const customerA = resA.body;

    const resB = await request(app.getHttpServer())
      .patch(`/customers/${customerA.id}`)
      .set('Host', `tenant-b.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Hacked' });
    expect(resB.status).toBe(404);
    expect(resB.body.error.code).toBe('resource_not_found');

    const verify = await request(app.getHttpServer())
      .get(`/customers/${customerA.id}`)
      .set('Host', `tenant-a.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(verify.status).toBe(200);
    expect(verify.body.name).toBe('Original');
  });

  it('tenant B cannot delete tenant A customer (404, row persists)', async () => {
    const resA = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', `tenant-a.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'user-a@example.com' });
    expect(resA.status).toBe(201);
    const customerA = resA.body;

    const resB = await request(app.getHttpServer())
      .delete(`/customers/${customerA.id}`)
      .set('Host', `tenant-b.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(404);
    expect(resB.body.error.code).toBe('resource_not_found');

    const verify = await request(app.getHttpServer())
      .get(`/customers/${customerA.id}`)
      .set('Host', `tenant-a.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(verify.status).toBe(200);
  });

  it('same email can register in both tenants (distinct rows)', async () => {
    const resA = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', `tenant-a.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'shared@example.com' });
    expect(resA.status).toBe(201);

    const resB = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', `tenant-b.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ email: 'shared@example.com' });
    expect(resB.status).toBe(201);

    expect(resA.body.id).not.toBe(resB.body.id);
  });

  it('same email twice under one tenant returns 409 conflict', async () => {
    const resA = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', `tenant-a.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'dup@example.com' });
    expect(resA.status).toBe(201);

    const resB = await request(app.getHttpServer())
      .post('/customers')
      .set('Host', `tenant-a.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'dup@example.com' });
    expect(resB.status).toBe(409);
    expect(resB.body.error.code).toBe('conflict');
  });

  it('concurrent requests from different tenants do not cross contexts', async () => {
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/customers')
        .set('Host', `tenant-a.${BASE_DOMAIN}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ email: 'concurrent-a@example.com' }),
      request(app.getHttpServer())
        .post('/customers')
        .set('Host', `tenant-b.${BASE_DOMAIN}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ email: 'concurrent-b@example.com' }),
    ]);
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const listA = await request(app.getHttpServer())
      .get('/customers')
      .set('Host', `tenant-a.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`);
    const listB = await request(app.getHttpServer())
      .get('/customers')
      .set('Host', `tenant-b.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenB}`);

    const emailsA: string[] = listA.body.map((c: { email: string }) => c.email);
    const emailsB: string[] = listB.body.map((c: { email: string }) => c.email);

    expect(emailsA).toContain('concurrent-a@example.com');
    expect(emailsA).not.toContain('concurrent-b@example.com');
    expect(emailsB).toContain('concurrent-b@example.com');
    expect(emailsB).not.toContain('concurrent-a@example.com');
  });
});
