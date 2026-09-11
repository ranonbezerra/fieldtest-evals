import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signJwt } from '../src/auth/jwt.util.js';
import {
  bearer,
  bootstrapApp,
  raw,
  seedTenants,
  TENANT_A,
  TENANT_B,
  wipeTenantData,
} from './helpers.js';

describe('tenant resolution and /tenant-config', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    await seedTenants();
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

  it('returns the resolved tenant branding and feature flags', async () => {
    const res = await request(server)
      .get('/tenant-config')
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: TENANT_A.slug,
      name: 'Operator A',
      domain: TENANT_A.domain,
      branding: {
        brandName: 'Brand Alpha',
        primaryColor: '#112233',
        logoUrl: 'https://cdn.example.com/a/logo.png',
      },
      featureFlags: ['dark-mode', 'beta-checkout'],
    });
  });

  it('rejects a host and token that resolve to different tenants (403)', async () => {
    const pairs: Array<{ host: string; slug: string }> = [
      { host: TENANT_A.domain, slug: TENANT_B.slug },
      { host: TENANT_B.domain, slug: TENANT_A.slug },
    ];
    for (const { host, slug } of pairs) {
      const res = await request(server)
        .get('/tenant-config')
        .set('Host', host)
        .set('Authorization', bearer(slug));
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: 'tenant_mismatch' });
      expect(res.body.error.details).toEqual(expect.objectContaining({ host }));
    }
  });

  it('rejects a missing or malformed token (401)', async () => {
    const missing = await request(server).get('/tenant-config').set('Host', TENANT_A.domain);
    expect(missing.status).toBe(401);
    expect(missing.body.error).toMatchObject({ code: 'unauthorized' });

    const garbage = await request(server)
      .get('/tenant-config')
      .set('Host', TENANT_A.domain)
      .set('Authorization', 'Bearer not.a.jwt');
    expect(garbage.status).toBe(401);
    expect(garbage.body.error).toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a token signed with a different secret (401)', async () => {
    const forged = signJwt({ org: TENANT_A.slug }, 'some-other-secret', 3600);
    const res = await request(server)
      .get('/tenant-config')
      .set('Host', TENANT_A.domain)
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a host with no registered tenant (404)', async () => {
    const res = await request(server)
      .get('/tenant-config')
      .set('Host', 'app.operator-c.example.com')
      .set('Authorization', bearer(TENANT_A.slug));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'tenant_not_found' });
  });

  it('answers every error with the one envelope', async () => {
    const res = await request(server).get('/tenant-config').set('Host', TENANT_A.domain);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatchObject({
      code: expect.any(String),
      message: expect.any(String),
    });
    expect(typeof res.body.error.details).toBe('object');
    expect(res.body.error.details).not.toBeNull();
    expect(Array.isArray(res.body.error.details)).toBe(false);
  });
});
