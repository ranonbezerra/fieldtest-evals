import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Customer, Tenant } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cleanTenantData,
  ensureTenant,
  fixturePrisma,
  hostFor,
  startApp,
  stopApp,
  tokenFor,
} from './test-helpers.js';

const SLUG_A = 'customer-alpha';
const SLUG_B = 'customer-beta';

const SHARED_EMAIL = 'shared@example.com';
const A_ONLY_EMAIL = 'a-only@example.com';
const B_ONLY_EMAIL = 'b-only@example.com';
const DUP_EMAIL = 'duplicate@example.com';
const CONCURRENT_A = 'concurrent-a@example.com';
const CONCURRENT_B = 'concurrent-b@example.com';

describe('customers: tenant isolation (list / fetch / update / delete)', () => {
  let app: INestApplication;
  let server: Server;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let aShared: Customer;
  let aOnly: Customer;
  let bShared: Customer;
  let bOnly: Customer;

  const asTenant = (slug: string) =>
    request(server)
      .set('Host', hostFor(slug))
      .set('Authorization', `Bearer ${tokenFor(slug)}`);

  beforeAll(async () => {
    [tenantA, tenantB] = await Promise.all([
      ensureTenant({ slug: SLUG_A, name: 'Customer Alpha', primaryColor: '#101010', featureFlags: {} }),
      ensureTenant({ slug: SLUG_B, name: 'Customer Beta', primaryColor: '#202020', featureFlags: {} }),
    ]);
    await cleanTenantData([tenantA, tenantB]);
    ({ app, server } = await startApp());

    // Fixtures are registered through the public API so the write-stamping
    // path is exercised as well.
    const aSharedRes = await asTenant(SLUG_A).post('/customers').send({ email: SHARED_EMAIL, name: 'Alice (A)' });
    expect(aSharedRes.status).toBe(201);
    aShared = aSharedRes.body as Customer;

    const aOnlyRes = await asTenant(SLUG_A).post('/customers').send({ email: A_ONLY_EMAIL, name: 'Bob (A)' });
    expect(aOnlyRes.status).toBe(201);
    aOnly = aOnlyRes.body as Customer;

    const bSharedRes = await asTenant(SLUG_B).post('/customers').send({ email: SHARED_EMAIL, name: 'Alice (B)' });
    expect(bSharedRes.status).toBe(201);
    bShared = bSharedRes.body as Customer;

    const bOnlyRes = await asTenant(SLUG_B).post('/customers').send({ email: B_ONLY_EMAIL, name: 'Bob (B)' });
    expect(bOnlyRes.status).toBe(201);
    bOnly = bOnlyRes.body as Customer;

    const concurA = await asTenant(SLUG_A).post('/customers').send({ email: CONCURRENT_A, name: 'Concurrent (A)' });
    expect(concurA.status).toBe(201);
    const concurB = await asTenant(SLUG_B).post('/customers').send({ email: CONCURRENT_B, name: 'Concurrent (B)' });
    expect(concurB.status).toBe(201);

    // Writes were stamped with the correct tenant id.
    expect(aShared.tenantId).toBe(tenantA.id);
    expect(bShared.tenantId).toBe(tenantB.id);
  });

  afterAll(async () => {
    await stopApp(app);
    await fixturePrisma.$disconnect();
  });

  it('tenant A lists exactly its own customers, all stamped with its id', async () => {
    const res = await asTenant(SLUG_A).get('/customers');

    expect(res.status).toBe(200);
    const rows = res.body as Customer[];
    expect(rows.map((c) => c.email).sort()).toEqual([A_ONLY_EMAIL, CONCURRENT_A, SHARED_EMAIL].sort());
    expect(rows.every((c) => c.tenantId === tenantA.id)).toBe(true);
  });

  it('tenant B list never contains tenant A rows (even for the shared email)', async () => {
    const res = await asTenant(SLUG_B).get('/customers');

    expect(res.status).toBe(200);
    const rows = res.body as Customer[];
    const emails = rows.map((c) => c.email);
    expect(emails).toContain(SHARED_EMAIL);
    expect(emails).toContain(B_ONLY_EMAIL);
    expect(emails).not.toContain(A_ONLY_EMAIL);
    expect(emails).not.toContain(CONCURRENT_A);
    // The shared-email row visible to B is B's own row, not A's.
    const shared = rows.find((c) => c.email === SHARED_EMAIL);
    expect(shared?.name).toBe('Alice (B)');
    expect(shared?.tenantId).toBe(tenantB.id);
  });

  it('tenant B fetching tenant A customer by id gets 404, row untouched', async () => {
    const res = await asTenant(SLUG_B).get(`/customers/${aShared.id}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');
    expect(res.body.error.details).toEqual({});

    const owner = await asTenant(SLUG_A).get(`/customers/${aShared.id}`);
    expect(owner.status).toBe(200);
    expect(owner.body.name).toBe('Alice (A)');
  });

  it('tenant B cannot update tenant A customer (404, row unchanged)', async () => {
    const res = await asTenant(SLUG_B).patch(`/customers/${aShared.id}`).send({ name: 'Hijacked' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');

    const owner = await asTenant(SLUG_A).get(`/customers/${aShared.id}`);
    expect(owner.status).toBe(200);
    expect(owner.body.name).toBe('Alice (A)');
  });

  it('tenant B cannot delete tenant A customer (404, row remains)', async () => {
    const res = await asTenant(SLUG_B).delete(`/customers/${aOnly.id}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');

    const owner = await asTenant(SLUG_A).get(`/customers/${aOnly.id}`);
    expect(owner.status).toBe(200);
  });

  it('the same email registers in both tenants with distinct ids', async () => {
    const inA = await asTenant(SLUG_A).post('/customers').send({ email: DUP_EMAIL, name: 'Dup (A)' });
    const inB = await asTenant(SLUG_B).post('/customers').send({ email: DUP_EMAIL, name: 'Dup (B)' });

    expect(inA.status).toBe(201);
    expect(inB.status).toBe(201);
    expect(inA.body.email).toBe(DUP_EMAIL);
    expect(inB.body.email).toBe(DUP_EMAIL);
    expect(inA.body.id).not.toBe(inB.body.id);
    expect(inA.body.tenantId).toBe(tenantA.id);
    expect(inB.body.tenantId).toBe(tenantB.id);
  });

  it('the same email is still unique within one tenant (409 conflict)', async () => {
    const res = await asTenant(SLUG_A).post('/customers').send({ email: DUP_EMAIL, name: 'Dup again (A)' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('rejects an invalid registration payload (400, envelope with issues)', async () => {
    const res = await asTenant(SLUG_A).post('/customers').send({ email: 'not-an-email', name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Array.isArray(res.body.error.details.issues)).toBe(true);
  });

  it('the owner tenant can update its own customer', async () => {
    const res = await asTenant(SLUG_B).patch(`/customers/${bShared.id}`).send({ name: 'Alice (B) v2' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice (B) v2');
    expect(res.body.email).toBe(SHARED_EMAIL);
  });

  it('the owner tenant can delete its own customer', async () => {
    const del = await asTenant(SLUG_B).delete(`/customers/${bOnly.id}`);
    expect(del.status).toBe(204);

    const after = await asTenant(SLUG_B).get(`/customers/${bOnly.id}`);
    expect(after.status).toBe(404);
  });

  it('interleaved concurrent requests never cross tenant contexts', async () => {
    const calls = [];
    for (let i = 0; i < 10; i += 1) {
      calls.push(asTenant(SLUG_A).get('/customers'));
      calls.push(asTenant(SLUG_B).get('/customers'));
    }
    const settled = await Promise.all(calls);

    for (let i = 0; i < 10; i += 1) {
      const a = settled[i * 2];
      const b = settled[i * 2 + 1];
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const aEmails = (a.body as Customer[]).map((c) => c.email).sort();
      const bEmails = (b.body as Customer[]).map((c) => c.email).sort();
      // Every interleaved response carries exactly that tenant's rows.
      expect(aEmails).toEqual([A_ONLY_EMAIL, CONCURRENT_A, DUP_EMAIL, SHARED_EMAIL].sort());
      expect(bEmails).toEqual([CONCURRENT_B, DUP_EMAIL, SHARED_EMAIL].sort());
    }
  });
});
