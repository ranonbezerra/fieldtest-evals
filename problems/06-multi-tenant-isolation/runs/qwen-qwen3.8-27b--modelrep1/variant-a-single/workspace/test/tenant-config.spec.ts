import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
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

const SLUG_A = 'config-alpha';
const SLUG_B = 'config-beta';

describe('tenant resolution + GET /tenant-config', () => {
  let app: INestApplication;
  let server: Server;
  let tenantA: Tenant;
  let tenantB: Tenant;

  const asTenant = (slug: string) =>
    request(server)
      .set('Host', hostFor(slug))
      .set('Authorization', `Bearer ${tokenFor(slug)}`);

  beforeAll(async () => {
    [tenantA, tenantB] = await Promise.all([
      ensureTenant({
        slug: SLUG_A,
        name: 'Alpha Corp',
        primaryColor: '#112233',
        featureFlags: { selfCheckout: true, betaDashboard: false },
      }),
      ensureTenant({
        slug: SLUG_B,
        name: 'Beta Corp',
        primaryColor: '#aabbcc',
        featureFlags: { selfCheckout: false, betaDashboard: true },
      }),
    ]);
    await cleanTenantData([tenantA, tenantB]);
    ({ app, server } = await startApp());
  });

  afterAll(async () => {
    await stopApp(app);
    await fixturePrisma.$disconnect();
  });

  it('returns branding and feature flags for the tenant resolved from host + token', async () => {
    const res = await asTenant(SLUG_A).get('/tenant-config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      tenant: { id: tenantA.id, slug: tenantA.slug, name: tenantA.name },
      branding: {
        brandName: tenantA.brandName,
        primaryColor: tenantA.primaryColor,
        logoUrl: tenantA.logoUrl,
      },
      featureFlags: { selfCheckout: true, betaDashboard: false },
    });
  });

  it('serves the second tenant its own branding, not the first tenant', async () => {
    const res = await asTenant(SLUG_B).get('/tenant-config');

    expect(res.status).toBe(200);
    expect(res.body.tenant.slug).toBe(SLUG_B);
    expect(res.body.tenant.id).toBe(tenantB.id);
    expect(res.body.branding.primaryColor).toBe('#aabbcc');
    expect(res.body.branding.primaryColor).not.toBe(tenantA.primaryColor);
    expect(res.body.featureFlags).toEqual({ selfCheckout: false, betaDashboard: true });
  });

  it('rejects a token whose org claim does not match the host (403, single envelope)', async () => {
    const res = await request(server)
      .get('/tenant-config')
      .set('Host', hostFor(SLUG_A))
      .set('Authorization', `Bearer ${tokenFor(SLUG_B)}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: 'tenant_mismatch',
        message: expect.any(String),
        details: { hostTenant: SLUG_A, tokenTenant: SLUG_B },
      },
    });
  });

  it('rejects requests without a token (401, envelope with object details)', async () => {
    const res = await request(server).get('/tenant-config').set('Host', hostFor(SLUG_A));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect(res.body.error.details).toEqual({});
  });

  it('rejects a token that fails verification (401)', async () => {
    const res = await request(server)
      .get('/tenant-config')
      .set('Host', hostFor(SLUG_A))
      .set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_token');
  });

  it('rejects a host that is not an operator domain (400)', async () => {
    const res = await request(server)
      .get('/tenant-config')
      .set('Host', 'example.com')
      .set('Authorization', `Bearer ${tokenFor(SLUG_A)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_host');
  });

  it('rejects a host for which no tenant is registered (404)', async () => {
    const res = await request(server)
      .get('/tenant-config')
      .set('Host', hostFor('ghost-corp'))
      .set('Authorization', `Bearer ${tokenFor('ghost-corp')}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('tenant_not_found');
  });
});
