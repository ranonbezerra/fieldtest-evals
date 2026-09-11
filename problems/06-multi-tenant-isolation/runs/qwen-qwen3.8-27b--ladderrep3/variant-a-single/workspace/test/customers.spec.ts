import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startApp, api, registerCustomer, type TestContext } from './support';

describe('customers (white-label isolation)', () => {
  let ctx: TestContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aliceA: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bobB: any;

  beforeAll(async () => {
    ctx = await startApp();
    const a = await registerCustomer(ctx.base, ctx.tenants.a, { email: 'alice@operator-a.test', name: 'Alice' });
    if (a.status !== 201) throw new Error(`seed A failed: ${a.status} ${JSON.stringify(a.json)}`);
    aliceA = a.json;
    const b = await registerCustomer(ctx.base, ctx.tenants.b, { email: 'bob@operator-b.test', name: 'Bob' });
    if (b.status !== 201) throw new Error(`seed B failed: ${b.status} ${JSON.stringify(b.json)}`);
    bobB = b.json;
  }, 60_000);

  afterAll(async () => {
    await ctx.stop();
  }, 60_000);

  it('tenant B list excludes tenant A customers entirely', async () => {
    const res = await api(ctx.base, '/customers', { host: ctx.tenants.b.domain, org: ctx.tenants.b.id });
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emails = (res.json as any[]).map((c) => c.email);
    expect(emails).toContain(bobB.email);
    expect(emails).not.toContain(aliceA.email);
  });

  it('tenant B fetch of tenant A customer by id is a 404 with the same body as a nonexistent id', async () => {
    const crossTenant = await api(ctx.base, `/customers/${aliceA.id}`, {
      host: ctx.tenants.b.domain,
      org: ctx.tenants.b.id,
    });
    const ghost = await api(ctx.base, `/customers/${randomUUID()}`, {
      host: ctx.tenants.b.domain,
      org: ctx.tenants.b.id,
    });
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.json).toEqual(ghost.json);
    expect(crossTenant.json.error.code).toBe('resource_not_found');
  });

  it('tenant B update of tenant A customer is a 404 and leaves the row unchanged', async () => {
    const res = await api(ctx.base, `/customers/${aliceA.id}`, {
      method: 'PATCH',
      host: ctx.tenants.b.domain,
      org: ctx.tenants.b.id,
      body: { name: 'Compromised' },
    });
    expect(res.status).toBe(404);
    const after = await api(ctx.base, `/customers/${aliceA.id}`, {
      host: ctx.tenants.a.domain,
      org: ctx.tenants.a.id,
    });
    expect(after.status).toBe(200);
    expect(after.json.name).toBe('Alice');
  });

  it('tenant B delete of tenant A customer is a 404 and the row still exists', async () => {
    const res = await api(ctx.base, `/customers/${aliceA.id}`, {
      method: 'DELETE',
      host: ctx.tenants.b.domain,
      org: ctx.tenants.b.id,
    });
    expect(res.status).toBe(404);
    const after = await api(ctx.base, `/customers/${aliceA.id}`, {
      host: ctx.tenants.a.domain,
      org: ctx.tenants.a.id,
    });
    expect(after.status).toBe(200);
    expect(after.json.email).toBe(aliceA.email);
  });

  it('the same email registers independently in both tenants', async () => {
    const inA = await registerCustomer(ctx.base, ctx.tenants.a, { email: 'shared@both.test', name: 'Shared A' });
    const inB = await registerCustomer(ctx.base, ctx.tenants.b, { email: 'shared@both.test', name: 'Shared B' });
    expect(inA.status).toBe(201);
    expect(inB.status).toBe(201);
    expect(inA.json.email).toBe(inB.json.email);
    expect(inA.json.id).not.toBe(inB.json.id);
  });

  it('the same email twice in one tenant is a 409 conflict', async () => {
    const res = await registerCustomer(ctx.base, ctx.tenants.a, { email: 'alice@operator-a.test', name: 'Alice Again' });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('conflict');
  });
});
