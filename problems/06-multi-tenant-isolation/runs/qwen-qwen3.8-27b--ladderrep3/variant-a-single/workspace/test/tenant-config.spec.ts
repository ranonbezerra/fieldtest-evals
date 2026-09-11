import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, api, type TestContext } from './support';

describe('GET /tenant-config', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.stop();
  }, 60_000);

  it('returns the branding and feature flags of the resolved tenant (A)', async () => {
    const t = ctx.tenants.a;
    const res = await api(ctx.base, '/tenant-config', { host: t.domain, org: t.id });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: t.id,
      name: t.name,
      branding: t.branding,
      featureFlags: t.featureFlags,
    });
  });

  it('returns the other tenant branding for tenant B', async () => {
    const t = ctx.tenants.b;
    const res = await api(ctx.base, '/tenant-config', { host: t.domain, org: t.id });
    expect(res.status).toBe(200);
    expect(res.json.id).toBe(t.id);
    expect(res.json.branding).toEqual(t.branding);
    expect(res.json.featureFlags).not.toEqual(ctx.tenants.a.featureFlags);
  });

  it('rejects a request whose host and token disagree', async () => {
    const res = await api(ctx.base, '/tenant-config', {
      host: ctx.tenants.a.domain,
      org: ctx.tenants.b.id,
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('tenant_mismatch');
  });
});
