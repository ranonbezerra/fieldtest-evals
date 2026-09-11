import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, api, registerCustomer, type ApiResponse, type TestContext } from './support';
import { CustomersRepository } from '../src/customers/customers.repository';
import { TenantContextMissingError } from '../src/prisma/tenant-context';

describe('tenant resolution and context isolation', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startApp();
    for (const which of ['a', 'b'] as const) {
      const r = await registerCustomer(ctx.base, ctx.tenants[which], {
        email: `seed-${which}@x.test`,
        name: `Seed ${which}`,
      });
      if (r.status !== 201) throw new Error(`seed failed: ${r.status}`);
    }
  }, 60_000);

  afterAll(async () => {
    await ctx.stop();
  }, 60_000);

  it('rejects a request when host and token org point at different tenants', async () => {
    const res = await api(ctx.base, '/customers', { host: ctx.tenants.a.domain, org: ctx.tenants.b.id });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('tenant_mismatch');
  });

  it('rejects a request with no token even for a valid host', async () => {
    const res = await api(ctx.base, '/customers', { host: ctx.tenants.a.domain });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('unauthorized');
  });

  it('rejects a valid token when the host is not a tenant domain', async () => {
    const res = await api(ctx.base, '/customers', {
      host: `unknown-${ctx.tenants.a.id}.example.test`,
      org: ctx.tenants.a.id,
    });
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('unknown_host');
  });

  it('concurrent requests from two tenants do not cross contexts', async () => {
    const a = ctx.tenants.a;
    const b = ctx.tenants.b;
    interface Job {
      tag: 'a' | 'b';
      kind: 'list' | 'create';
      run: () => Promise<ApiResponse>;
    }
    const jobs: Job[] = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      jobs.push({ tag: 'a', kind: 'list', run: () => api(ctx.base, '/customers', { host: a.domain, org: a.id }) });
      jobs.push({ tag: 'b', kind: 'list', run: () => api(ctx.base, '/customers', { host: b.domain, org: b.id }) });
      jobs.push({
        tag: 'a',
        kind: 'create',
        run: () =>
          api(ctx.base, '/customers', {
            method: 'POST',
            host: a.domain,
            org: a.id,
            body: { email: `load-a${i}@load.test`, name: 'Load A' },
          }),
      });
      jobs.push({
        tag: 'b',
        kind: 'create',
        run: () =>
          api(ctx.base, '/customers', {
            method: 'POST',
            host: b.domain,
            org: b.id,
            body: { email: `load-b${i}@load.test`, name: 'Load B' },
          }),
      });
    }

    const results = await Promise.all(jobs.map((j) => j.run()));
    // No request failed while the two tenants were hitting the API together.
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);

    // Every list response contained only rows of the tenant that issued it.
    jobs.forEach((job, i) => {
      if (job.kind !== 'list') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const emails = (results[i].json as any[]).map((c) => c.email);
      for (const email of emails) {
        const ownPattern = job.tag === 'a' ? /^seed-a@x\.test$|^load-a\d+@load\.test$/ : /^seed-b@x\.test$|^load-b\d+@load\.test$/;
        expect(ownPattern.test(email)).toBe(true);
      }
    });

    // Final state: each created email landed only in its own tenant.
    const finalA = await api(ctx.base, '/customers', { host: a.domain, org: a.id });
    const finalB = await api(ctx.base, '/customers', { host: b.domain, org: b.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emailsA = new Set((finalA.json as any[]).map((c) => c.email));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emailsB = new Set((finalB.json as any[]).map((c) => c.email));
    for (let i = 0; i < N; i++) {
      expect(emailsA.has(`load-a${i}@load.test`)).toBe(true);
      expect(emailsA.has(`load-b${i}@load.test`)).toBe(false);
      expect(emailsB.has(`load-b${i}@load.test`)).toBe(true);
      expect(emailsB.has(`load-a${i}@load.test`)).toBe(false);
    }
  });

  it('a query issued with no tenant in context fails rather than returning everything', async () => {
    const repo = ctx.moduleRef.get(CustomersRepository);
    await expect(repo.list()).rejects.toThrow(TenantContextMissingError);
  });
});
