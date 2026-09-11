import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { runWithTenant, TenantContextError } from '../src/tenant/tenant-context.util.js';
import {
  bearer,
  bootstrapApp,
  raw,
  seedTenants,
  SeededTenants,
  TENANT_A,
  TENANT_B,
  wipeTenantData,
} from './helpers.js';

type TestTenant = { slug: string; domain: string };

describe('customer isolation across tenants', () => {
  let app: INestApplication;
  let server: Server;
  let tenants: SeededTenants;

  beforeAll(async () => {
    tenants = await seedTenants();
    app = await bootstrapApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
    await raw.$disconnect();
  });

  beforeEach(async () => {
    await wipeTenantData();
  });

  const createAs = (tenant: TestTenant, body: object): request.Test =>
    request(server)
      .post('/customers')
      .set('Host', tenant.domain)
      .set('Authorization', bearer(tenant.slug))
      .send(body);

  const listAs = (tenant: TestTenant): request.Test =>
    request(server)
      .get('/customers')
      .set('Host', tenant.domain)
      .set('Authorization', bearer(tenant.slug));

  it('fetches its own customer by id and hides tenantId', async () => {
    const created = await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('tenantId');

    const res = await request(server)
      .get(`/customers/${created.body.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, email: 'alice@a.example', name: 'Alice' });
    expect(res.body).not.toHaveProperty('tenantId');
  });

  it('tenant B cannot list tenant A rows', async () => {
    const alice = await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' });
    expect(alice.status).toBe(201);
    const carol = await createAs(TENANT_B, { email: 'carol@b.example', name: 'Carol' });
    expect(carol.status).toBe(201);

    const asB = await listAs(TENANT_B);
    expect(asB.status).toBe(200);
    expect(Array.isArray(asB.body)).toBe(true);
    const bEmails = asB.body.map((c: { email: string }) => c.email);
    const bIds = asB.body.map((c: { id: string }) => c.id);
    expect(bEmails).toContain('carol@b.example');
    expect(bEmails).not.toContain('alice@a.example');
    expect(bIds).not.toContain(alice.body.id);

    const asA = await listAs(TENANT_A);
    const aEmails = asA.body.map((c: { email: string }) => c.email);
    expect(aEmails).toContain('alice@a.example');
    expect(aEmails).not.toContain('carol@b.example');
  });

  it("returns 404 with an identical body for another tenant's id and for a nonexistent id", async () => {
    const alice = (await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' })).body;

    const foreign = await request(server)
      .get(`/customers/${alice.id}`)
      .set('Host', TENANT_B.domain)
      .set('Authorization', bearer(TENANT_B.slug));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toMatchObject({ code: 'resource_not_found' });

    const missing = await request(server)
      .get(`/customers/${randomUUID()}`)
      .set('Host', TENANT_B.domain)
      .set('Authorization', bearer(TENANT_B.slug));
    expect(missing.status).toBe(404);

    // "Not yours" and "not there" are indistinguishable: same status, code,
    // message and shape. A 403 would leak that the row exists.
    expect(foreign.body.error).toEqual(missing.body.error);
  });

  it("cannot update another tenant's row; the row stays unchanged, and its own update works", async () => {
    const alice = (await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' })).body;

    const res = await request(server)
      .patch(`/customers/${alice.id}`)
      .set('Host', TENANT_B.domain)
      .set('Authorization', bearer(TENANT_B.slug))
      .send({ name: 'Hacked', email: 'hacker@b.example' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'resource_not_found' });

    const after = await request(server)
      .get(`/customers/${alice.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ email: 'alice@a.example', name: 'Alice' });

    const own = await request(server)
      .patch(`/customers/${alice.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug))
      .send({ name: 'Alice Updated' });
    expect(own.status).toBe(200);
    expect(own.body.name).toBe('Alice Updated');
  });

  it("cannot delete another tenant's row; the row still exists, and its own delete works", async () => {
    const alice = (await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' })).body;

    const res = await request(server)
      .delete(`/customers/${alice.id}`)
      .set('Host', TENANT_B.domain)
      .set('Authorization', bearer(TENANT_B.slug));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'resource_not_found' });

    const after = await request(server)
      .get(`/customers/${alice.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));
    expect(after.status).toBe(200);
    expect(after.body.email).toBe('alice@a.example');

    const own = await request(server)
      .delete(`/customers/${alice.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));
    expect(own.status).toBe(204);
    const gone = await request(server)
      .get(`/customers/${alice.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));
    expect(gone.status).toBe(404);
  });

  it('registers the same email in both tenants, and still rejects a duplicate within one tenant', async () => {
    const inA = await createAs(TENANT_A, { email: 'shared@both.example', name: 'Shared A' });
    expect(inA.status).toBe(201);
    const inB = await createAs(TENANT_B, { email: 'shared@both.example', name: 'Shared B' });
    expect(inB.status).toBe(201);
    expect(inA.body.id).not.toBe(inB.body.id);

    const duplicate = await createAs(TENANT_A, { email: 'shared@both.example' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatchObject({ code: 'conflict' });

    const listA = await listAs(TENANT_A);
    const listB = await listAs(TENANT_B);
    expect(listA.body.filter((c: { email: string }) => c.email === 'shared@both.example')).toHaveLength(1);
    expect(listB.body.filter((c: { email: string }) => c.email === 'shared@both.example')).toHaveLength(1);
  });

  it('rejects an invalid create body with the error envelope', async () => {
    const res = await createAs(TENANT_A, { email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'validation_failed' });
    expect(res.body.error.details).toMatchObject({ email: expect.any(String) });
  });

  it('concurrent requests from two tenants do not cross contexts', async () => {
    const N = 10;
    const requests: Array<request.Test> = [];
    for (let i = 0; i < N; i += 1) {
      requests.push(createAs(TENANT_A, { email: `conc-a-${i}@load.example` }));
      requests.push(createAs(TENANT_B, { email: `conc-b-${i}@load.example` }));
    }
    const results = await Promise.all(requests);
    expect(results.every((r) => r.status === 201)).toBe(true);

    const asA = await listAs(TENANT_A);
    const asB = await listAs(TENANT_B);
    const aEmails = asA.body.map((c: { email: string }) => c.email).sort();
    const bEmails = asB.body.map((c: { email: string }) => c.email).sort();
    const expectedA = Array.from({ length: N }, (_, i) => `conc-a-${i}@load.example`).sort();
    const expectedB = Array.from({ length: N }, (_, i) => `conc-b-${i}@load.example`).sort();
    expect(aEmails).toEqual(expectedA);
    expect(bEmails).toEqual(expectedB);

    // Ground truth at the database level: exactly N rows per tenant, none crossed.
    expect(await raw.customer.count({ where: { tenantId: tenants.a.id } })).toBe(N);
    expect(await raw.customer.count({ where: { tenantId: tenants.b.id } })).toBe(N);
    expect(
      await raw.customer.count({ where: { tenantId: tenants.a.id, email: { startsWith: 'conc-b-' } } }),
    ).toBe(0);
    expect(
      await raw.customer.count({ where: { tenantId: tenants.b.id, email: { startsWith: 'conc-a-' } } }),
    ).toBe(0);
  });

  it('a query issued with no tenant in context fails rather than returning everything', async () => {
    await createAs(TENANT_A, { email: 'alice@a.example' });
    await createAs(TENANT_B, { email: 'carol@b.example' });

    const prisma = app.get(PrismaService);
    await expect(prisma.customer.findMany()).rejects.toBeInstanceOf(TenantContextError);
    await expect(prisma.customer.findUnique({ where: { id: randomUUID() } })).rejects.toBeInstanceOf(
      TenantContextError,
    );
    await expect(prisma.customer.count()).rejects.toBeInstanceOf(TenantContextError);
    await expect(
      prisma.customer.create({ data: { email: 'no-context@example.com' } as any }),
    ).rejects.toBeInstanceOf(TenantContextError);

    // The refused create added nothing; nothing was readable.
    expect(await raw.customer.count({ where: { email: 'no-context@example.com' } })).toBe(0);
    expect(await raw.customer.count()).toBe(2);
  });

  it('a caller-supplied tenantId is overwritten by the context tenant, never trusted', async () => {
    const alice = (await createAs(TENANT_A, { email: 'alice@a.example' })).body;
    const carol = (await createAs(TENANT_B, { email: 'carol@b.example' })).body;

    const prisma = app.get(PrismaService);
    const ctxA = { tenantId: tenants.a.id, slug: TENANT_A.slug, domain: TENANT_A.domain };
    const ctxB = { tenantId: tenants.b.id, slug: TENANT_B.slug, domain: TENANT_B.domain };

    // Read: a where tenantId aimed at the other tenant is replaced, not obeyed.
    const smuggled = await runWithTenant(ctxA, async () =>
      prisma.customer.findMany({ where: { tenantId: tenants.b.id } }),
    );
    expect(smuggled).toHaveLength(1);
    expect(smuggled[0].tenantId).toBe(tenants.a.id);
    expect(smuggled[0].id).toBe(alice.id);

    // A tenantId buried in AND cannot cancel the context scope either.
    const crossUnique = await runWithTenant(ctxA, async () =>
      prisma.customer.findUnique({ where: { id: alice.id, AND: [{ tenantId: tenants.b.id }] } }),
    );
    expect(crossUnique?.id).toBe(alice.id);

    // ...and cannot reach across: B's id under A's context is a miss.
    const crossTenant = await runWithTenant(ctxA, async () =>
      prisma.customer.findUnique({ where: { id: carol.id } }),
    );
    expect(crossTenant).toBeNull();

    // Write: a supplied tenantId is stamped over by the context tenant.
    const stamped = await runWithTenant(ctxB, async () =>
      prisma.customer.create({ data: { email: 'stamped@b.example', tenantId: tenants.a.id } }),
    );
    expect(stamped.tenantId).toBe(tenants.b.id);
    expect(await raw.customer.count({ where: { tenantId: tenants.a.id, email: 'stamped@b.example' } })).toBe(0);
  });
});
