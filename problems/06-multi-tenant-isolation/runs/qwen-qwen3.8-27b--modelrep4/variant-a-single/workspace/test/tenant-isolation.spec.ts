import 'reflect-metadata';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Postgres is a hard requirement of this suite. The connection string comes
// from the environment only — never from the repository.
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to a Postgres connection string to run the tests');
}
const JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;

const HOST_A = 'app.operator-a.test';
const HOST_B = 'app.operator-b.test';
const UNKNOWN_HOST = 'app.operator-unknown.test';

describe('multi-tenant white label isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);

    // Wipe any previous state; tenant rows cascade to customers/plans/orders.
    await prisma.client.tenant.deleteMany({});

    const tenantA = await prisma.client.tenant.create({
      data: {
        slug: 'operator-a',
        host: HOST_A,
        name: 'Operator A',
        branding: { primaryColor: '#0f766e', logoText: 'Operator A' },
        featureFlags: { advancedBilling: true, selfService: false },
      },
    });
    const tenantB = await prisma.client.tenant.create({
      data: {
        slug: 'operator-b',
        host: HOST_B,
        name: 'Operator B',
        branding: { primaryColor: '#b91c1c', logoText: 'Operator B' },
        featureFlags: { advancedBilling: false, selfService: true },
      },
    });

    tokenA = jwt.sign({ org: tenantA.id }, JWT_SECRET, { algorithm: 'HS256' });
    tokenB = jwt.sign({ org: tenantB.id }, JWT_SECRET, { algorithm: 'HS256' });
  }, 60_000);

  afterAll(async () => {
    await app.close();
  }, 60_000);

  function api(host: string, token?: string) {
    const session = request(app.getHttpServer());
    session.set('Host', host);
    if (token) {
      session.set('Authorization', `Bearer ${token}`);
    }
    return session;
  }

  describe('tenant resolution', () => {
    it('serves the branding and feature flags of the tenant selected by host + org', async () => {
      const resA = await api(HOST_A, tokenA).get('/tenant-config').expect(200);
      expect(resA.body).toEqual({
        name: 'Operator A',
        slug: 'operator-a',
        branding: { primaryColor: '#0f766e', logoText: 'Operator A' },
        featureFlags: { advancedBilling: true, selfService: false },
      });

      const resB = await api(HOST_B, tokenB).get('/tenant-config').expect(200);
      expect(resB.body.name).toBe('Operator B');
      expect(resB.body.branding).toEqual({ primaryColor: '#b91c1c', logoText: 'Operator B' });
      expect(resB.body.featureFlags).toEqual({ advancedBilling: false, selfService: true });
      expect(resB.body.branding).not.toEqual(resA.body.branding);
    });

    it('rejects a token whose org claim does not match the host tenant', async () => {
      const res = await api(HOST_A, tokenB).get('/tenant-config');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: { code: 'tenant_mismatch', message: expect.any(String), details: {} },
      });
    });

    it('rejects a request without a bearer token', async () => {
      const res = await api(HOST_A).get('/tenant-config');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    it('rejects a token that cannot be verified', async () => {
      const res = await api(HOST_A, 'garbage.token.here').get('/tenant-config');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_token');
    });

    it('rejects a verified token without an org claim', async () => {
      const noOrg = jwt.sign({ sub: 'anonymous' }, JWT_SECRET, { algorithm: 'HS256' });
      const res = await api(HOST_A, noOrg).get('/tenant-config');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('missing_org_claim');
    });

    it('rejects an unknown host even when the token is valid', async () => {
      const res = await api(UNKNOWN_HOST, tokenA).get('/tenant-config');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('tenant_not_found');
    });
  });

  describe('customer isolation', () => {
    let alice: { id: string; email: string };
    let bob: { id: string; email: string };

    beforeAll(async () => {
      const createdAlice = await api(HOST_A, tokenA)
        .post('/customers')
        .send({ email: 'alice@operator-a.test', name: 'Alice' })
        .expect(201);
      alice = { id: createdAlice.body.id, email: createdAlice.body.email };

      const createdBob = await api(HOST_B, tokenB)
        .post('/customers')
        .send({ email: 'bob@operator-b.test', name: 'Bob' })
        .expect(201);
      bob = { id: createdBob.body.id, email: createdBob.body.email };
    });

    it('lets a tenant list only its own customers', async () => {
      const listA = (await api(HOST_A, tokenA).get('/customers').expect(200)).body;
      const listB = (await api(HOST_B, tokenB).get('/customers').expect(200)).body;

      const emailsA = listA.map((c: { email: string }) => c.email);
      const emailsB = listB.map((c: { email: string }) => c.email);
      const idsB = listB.map((c: { id: string }) => c.id);

      expect(emailsA).toContain(alice.email);
      expect(emailsA).not.toContain(bob.email);
      expect(emailsB).toContain(bob.email);
      expect(emailsB).not.toContain(alice.email);
      expect(idsB).not.toContain(alice.id);
    });

    it('returns 404 when tenant B fetches tenant A customer by id', async () => {
      const cross = await api(HOST_B, tokenB).get(`/customers/${alice.id}`);
      expect(cross.status).toBe(404);
      expect(cross.body.error.code).toBe('resource_not_found');

      const owner = await api(HOST_A, tokenA).get(`/customers/${alice.id}`).expect(200);
      expect(owner.body.email).toBe(alice.email);
    });

    it('blocks tenant B from updating tenant A customer (404, row untouched)', async () => {
      const cross = await api(HOST_B, tokenB)
        .patch(`/customers/${alice.id}`)
        .send({ name: 'Hijacked' });
      expect(cross.status).toBe(404);
      expect(cross.body.error.code).toBe('resource_not_found');

      const owner = await api(HOST_A, tokenA).get(`/customers/${alice.id}`).expect(200);
      expect(owner.body.name).toBe('Alice');
    });

    it('blocks tenant B from deleting tenant A customer (404, row intact)', async () => {
      const cross = await api(HOST_B, tokenB).delete(`/customers/${alice.id}`);
      expect(cross.status).toBe(404);
      expect(cross.body.error.code).toBe('resource_not_found');

      const owner = await api(HOST_A, tokenA).get(`/customers/${alice.id}`).expect(200);
      expect(owner.body.email).toBe(alice.email);
    });

    it('registers the same email in both tenants, but not twice in one', async () => {
      const email = `shared-${crypto.randomUUID()}@both.test`;
      const inA = await api(HOST_A, tokenA).post('/customers').send({ email, name: 'Shared A' }).expect(201);
      const inB = await api(HOST_B, tokenB).post('/customers').send({ email, name: 'Shared B' }).expect(201);
      expect(inA.body.id).not.toBe(inB.body.id);
      expect(inA.body.email).toBe(email);
      expect(inB.body.email).toBe(email);

      const duplicate = await api(HOST_A, tokenA).post('/customers').send({ email, name: 'Duplicate' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('email_already_exists');
    });

    it('rejects an update that collides with an existing email in the same tenant', async () => {
      const run = crypto.randomUUID();
      const e1 = `collide-a-${run}@test.io`;
      const e2 = `collide-b-${run}@test.io`;
      const first = (await api(HOST_A, tokenA)
        .post('/customers')
        .send({ email: e1, name: 'First' })
        .expect(201)).body;
      await api(HOST_A, tokenA).post('/customers').send({ email: e2, name: 'Second' }).expect(201);

      const res = await api(HOST_A, tokenA).patch(`/customers/${first.id}`).send({ email: e2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('email_already_exists');
    });

    it('lets a tenant update and delete its own customers', async () => {
      const created = (await api(HOST_A, tokenA)
        .post('/customers')
        .send({ email: `own-${crypto.randomUUID()}@test.io`, name: 'Original' })
        .expect(201)).body;

      const updated = await api(HOST_A, tokenA)
        .patch(`/customers/${created.id}`)
        .send({ name: 'Renamed' })
        .expect(200);
      expect(updated.body.name).toBe('Renamed');

      await api(HOST_A, tokenA).delete(`/customers/${created.id}`).expect(200);
      const gone = await api(HOST_A, tokenA).get(`/customers/${created.id}`);
      expect(gone.status).toBe(404);
      expect(gone.body.error.code).toBe('resource_not_found');
    });
  });

  describe('plan and order isolation', () => {
    it('allows the same plan name in two tenants and hides it across the boundary', async () => {
      const name = `Starter-${crypto.randomUUID()}`;
      const planA = (await api(HOST_A, tokenA).post('/plans').send({ name, priceCents: 1000 }).expect(201)).body;
      const planB = (await api(HOST_B, tokenB).post('/plans').send({ name, priceCents: 500 }).expect(201)).body;
      expect(planA.id).not.toBe(planB.id);

      const listB = (await api(HOST_B, tokenB).get('/plans').expect(200)).body;
      const idsB = listB.map((p: { id: string }) => p.id);
      expect(idsB).toContain(planB.id);
      expect(idsB).not.toContain(planA.id);

      const cross = await api(HOST_B, tokenB).get(`/plans/${planA.id}`);
      expect(cross.status).toBe(404);
      expect(cross.body.error.code).toBe('resource_not_found');
    });

    it('allows the same order reference in two tenants and hides it across the boundary', async () => {
      const run = crypto.randomUUID();
      const customerA = (await api(HOST_A, tokenA)
        .post('/customers')
        .send({ email: `order-a-${run}@test.io`, name: 'Order A' })
        .expect(201)).body;
      const customerB = (await api(HOST_B, tokenB)
        .post('/customers')
        .send({ email: `order-b-${run}@test.io`, name: 'Order B' })
        .expect(201)).body;
      const reference = `INV-${run.slice(0, 8)}`;

      const orderA = (await api(HOST_A, tokenA)
        .post('/orders')
        .send({ reference, customerId: customerA.id, amountCents: 2500 })
        .expect(201)).body;
      const orderB = (await api(HOST_B, tokenB)
        .post('/orders')
        .send({ reference, customerId: customerB.id, amountCents: 750 })
        .expect(201)).body;
      expect(orderA.id).not.toBe(orderB.id);

      const listB = (await api(HOST_B, tokenB).get('/orders').expect(200)).body;
      const idsB = listB.map((o: { id: string }) => o.id);
      expect(idsB).toContain(orderB.id);
      expect(idsB).not.toContain(orderA.id);

      const cross = await api(HOST_B, tokenB).get(`/orders/${orderA.id}`);
      expect(cross.status).toBe(404);
      expect(cross.body.error.code).toBe('resource_not_found');
    });

    it('rejects an order that references a customer from another tenant', async () => {
      const run = crypto.randomUUID();
      const customerA = (await api(HOST_A, tokenA)
        .post('/customers')
        .send({ email: `xref-${run}@test.io`, name: 'XRef' })
        .expect(201)).body;

      const res = await api(HOST_B, tokenB)
        .post('/orders')
        .send({ reference: `XREF-${run.slice(0, 8)}`, customerId: customerA.id, amountCents: 1 });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('resource_not_found');
    });
  });

  describe('concurrent requests across tenants', () => {
    it('never lets interleaved requests from different tenants cross contexts', async () => {
      const run = crypto.randomUUID();
      const emailA = `conc-a-${run}@test.io`;
      const emailB = `conc-b-${run}@test.io`;
      // Same plan name in both tenants: legal only because uniqueness is tenant-scoped.
      const planName = `ConcPlan-${run}`;

      const results = await Promise.all([
        api(HOST_A, tokenA).post('/customers').send({ email: emailA, name: 'Conc A' }),
        api(HOST_B, tokenB).post('/customers').send({ email: emailB, name: 'Conc B' }),
        api(HOST_A, tokenA).get('/customers'),
        api(HOST_B, tokenB).get('/customers'),
        api(HOST_A, tokenA).post('/plans').send({ name: planName, priceCents: 100 }),
        api(HOST_B, tokenB).post('/plans').send({ name: planName, priceCents: 900 }),
        api(HOST_A, tokenA).get('/tenant-config'),
        api(HOST_B, tokenB).get('/tenant-config'),
      ]);

      expect(results[0].status).toBe(201);
      expect(results[1].status).toBe(201);
      expect(results[2].status).toBe(200);
      expect(results[3].status).toBe(200);
      expect(results[4].status).toBe(201);
      expect(results[5].status).toBe(201);
      expect(results[6].status).toBe(200);
      expect(results[7].status).toBe(200);

      // Mid-flight snapshots: each tenant only ever saw its own rows.
      const emailsA = results[2].body.map((c: { email: string }) => c.email);
      const emailsB = results[3].body.map((c: { email: string }) => c.email);
      expect(emailsA).not.toContain(emailB);
      expect(emailsB).not.toContain(emailA);

      // Config requests resolved to the right tenant.
      expect(results[6].body.name).toBe('Operator A');
      expect(results[7].body.name).toBe('Operator B');

      // Final state: every write landed exactly in its own tenant.
      const afterA = (await api(HOST_A, tokenA).get('/customers').expect(200)).body;
      const afterB = (await api(HOST_B, tokenB).get('/customers').expect(200)).body;
      const finalA = afterA.map((c: { email: string }) => c.email);
      const finalB = afterB.map((c: { email: string }) => c.email);
      expect(finalA).toContain(emailA);
      expect(finalA).not.toContain(emailB);
      expect(finalB).toContain(emailB);
      expect(finalB).not.toContain(emailA);
      expect(afterA.find((c: { email: string }) => c.email === emailA).name).toBe('Conc A');
      expect(afterB.find((c: { email: string }) => c.email === emailB).name).toBe('Conc B');

      // Same plan name, two tenants: no leakage either way.
      const plansA = (await api(HOST_A, tokenA).get('/plans').expect(200)).body;
      const plansB = (await api(HOST_B, tokenB).get('/plans').expect(200)).body;
      const planIdsA = plansA.map((p: { id: string }) => p.id);
      const planIdsB = plansB.map((p: { id: string }) => p.id);
      expect(planIdsA).toContain(results[4].body.id);
      expect(planIdsB).toContain(results[5].body.id);
      expect(planIdsA).not.toContain(results[5].body.id);
      expect(planIdsB).not.toContain(results[4].body.id);
    });
  });
});
