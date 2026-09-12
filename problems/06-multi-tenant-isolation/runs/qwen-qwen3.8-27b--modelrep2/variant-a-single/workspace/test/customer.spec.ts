import 'reflect-metadata';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantContext } from '../src/common/tenant-context.js';
import { CustomerService } from '../src/customer/customer.service.js';
import {
  closeSeedClient,
  createTestApp,
  issueToken,
  makeTenantSeeds,
  resetTenants,
  seedTenants,
} from './helpers.js';

const [seedA, seedB] = makeTenantSeeds('customer');

describe('customer isolation across tenants', () => {
  let app: INestApplication;
  let tenantAId: string;
  let tenantBId: string;
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    await resetTenants([seedA, seedB]);
    [tenantAId, tenantBId] = await seedTenants([seedA, seedB]);
    app = await createTestApp();
  });

  beforeAll(async () => {
    const a = await asTenant(seedA.slug, seedA.domain)
      .post('/customers')
      .send({ email: 'alice@example.com', name: 'Alice' });
    expect(a.status).toBe(201);
    aliceId = a.body.id as string;

    const b = await asTenant(seedB.slug, seedB.domain)
      .post('/customers')
      .send({ email: 'bob@example.com', name: 'Bob' });
    expect(b.status).toBe(201);
    bobId = b.body.id as string;
  });

  afterAll(async () => {
    await app.close();
    await closeSeedClient();
  });

  const asTenant = (slug: string, domain: string) =>
    request(app.getHttpServer())
      .set('Host', domain)
      .set('Authorization', `Bearer ${issueToken(slug)}`);

  it('a tenant only lists its own customers', async () => {
    const res = await asTenant(seedA.slug, seedA.domain).get('/customers');
    expect(res.status).toBe(200);
    const emails = res.body.map((c: { email: string }) => c.email);
    expect(emails).toContain('alice@example.com');
    expect(emails).not.toContain('bob@example.com');
  });

  it('tenant B cannot fetch tenant A customer by id (404)', async () => {
    const res = await asTenant(seedB.slug, seedB.domain).get(`/customers/${aliceId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('tenant B cannot update tenant A customer (404, row unchanged)', async () => {
    const res = await asTenant(seedB.slug, seedB.domain)
      .patch(`/customers/${aliceId}`)
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');

    const still = await asTenant(seedA.slug, seedA.domain).get(`/customers/${aliceId}`);
    expect(still.status).toBe(200);
    expect(still.body.name).toBe('Alice');
  });

  it('tenant B cannot delete tenant A customer (404, row survives)', async () => {
    const res = await asTenant(seedB.slug, seedB.domain).delete(`/customers/${aliceId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');

    const still = await asTenant(seedA.slug, seedA.domain).get(`/customers/${aliceId}`);
    expect(still.status).toBe(200);
  });

  it('the same email can register in both tenants', async () => {
    const a = await asTenant(seedA.slug, seedA.domain)
      .post('/customers')
      .send({ email: 'shared@example.com', name: 'Shared (A)' });
    const b = await asTenant(seedB.slug, seedB.domain)
      .post('/customers')
      .send({ email: 'shared@example.com', name: 'Shared (B)' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.email).toBe('shared@example.com');
    expect(b.body.email).toBe('shared@example.com');
  });

  it('the same email cannot register twice in one tenant (409)', async () => {
    const res = await asTenant(seedA.slug, seedA.domain)
      .post('/customers')
      .send({ email: 'alice@example.com', name: 'Alice Twice' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_exists');
  });

  it('a tenant can create, update and delete its own rows', async () => {
    const created = await asTenant(seedB.slug, seedB.domain)
      .post('/customers')
      .send({ email: 'carol@example.com', name: 'Carol' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const updated = await asTenant(seedB.slug, seedB.domain)
      .patch(`/customers/${id}`)
      .send({ name: 'Carol Updated' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Carol Updated');

    const deleted = await asTenant(seedB.slug, seedB.domain).delete(`/customers/${id}`);
    expect(deleted.status).toBe(204);

    const gone = await asTenant(seedB.slug, seedB.domain).get(`/customers/${id}`);
    expect(gone.status).toBe(404);
  });

  it('rejects an invalid create body with 400 and the envelope', async () => {
    const res = await asTenant(seedA.slug, seedA.domain)
      .post('/customers')
      .send({ name: 'No Email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Array.isArray(res.body.error.details.errors)).toBe(true);
  });

  it('keeps concurrent requests from different tenants in separate contexts', async () => {
    const [listA, listB, createA, createB] = await Promise.all([
      asTenant(seedA.slug, seedA.domain).get('/customers'),
      asTenant(seedB.slug, seedB.domain).get('/customers'),
      asTenant(seedA.slug, seedA.domain).post('/customers').send({ email: 'dave-a@example.com', name: 'Dave A' }),
      asTenant(seedB.slug, seedB.domain).post('/customers').send({ email: 'dave-b@example.com', name: 'Dave B' }),
    ]);

    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);
    expect(createA.status).toBe(201);
    expect(createB.status).toBe(201);

    const emailsA = listA.body.map((c: { email: string }) => c.email);
    const emailsB = listB.body.map((c: { email: string }) => c.email);
    // No matter how the requests interleave, each list must never show the
    // other tenant's rows.
    expect(emailsA).not.toContain('bob@example.com');
    expect(emailsA).not.toContain('dave-b@example.com');
    expect(emailsB).not.toContain('alice@example.com');
    expect(emailsB).not.toContain('dave-a@example.com');

    const afterA = await asTenant(seedA.slug, seedA.domain).get('/customers');
    const afterB = await asTenant(seedB.slug, seedB.domain).get('/customers');
    expect(afterA.body.map((c: { email: string }) => c.email).sort()).toEqual([
      'alice@example.com',
      'dave-a@example.com',
      'shared@example.com',
    ]);
    expect(afterB.body.map((c: { email: string }) => c.email).sort()).toEqual([
      'bob@example.com',
      'dave-b@example.com',
      'shared@example.com',
    ]);
  });

  it('keeps interleaved in-process tenant contexts separate', async () => {
    const service = app.get(CustomerService);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const [rowsA, rowsB] = await Promise.all([
      tenantContext.run(tenantAId, async () => {
        await sleep(20);
        return service.list();
      }),
      tenantContext.run(tenantBId, async () => {
        await sleep(5);
        return service.list();
      }),
    ]);

    const emailsA = rowsA.map((c) => c.email);
    const emailsB = rowsB.map((c) => c.email);
    expect(emailsA).toContain('alice@example.com');
    expect(emailsA).not.toContain('bob@example.com');
    expect(emailsB).toContain('bob@example.com');
    expect(emailsB).not.toContain('alice@example.com');
  });
});
