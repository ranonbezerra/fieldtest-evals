import 'reflect-metadata';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeSeedClient,
  createTestApp,
  issueToken,
  makeTenantSeeds,
  resetTenants,
  seedTenants,
} from './helpers.js';

const [seedA, seedB] = makeTenantSeeds('tenant');

describe('tenant resolution', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetTenants([seedA, seedB]);
    await seedTenants([seedA, seedB]);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeSeedClient();
  });

  const asTenant = (slug: string, domain: string) =>
    request(app.getHttpServer())
      .set('Host', domain)
      .set('Authorization', `Bearer ${issueToken(slug)}`);

  it('rejects a request without a bearer token with 401 and the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/tenant-config').set('Host', seedA.domain);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.details).not.toBeNull();
    expect(res.body.error.details).toBeTypeOf('object');
  });

  it('rejects a token signed with the wrong key with 401', async () => {
    const forged = jwt.sign({ org: seedA.slug }, 'not-the-configured-secret', { algorithm: 'HS256' });
    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', seedA.domain)
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a token without an org claim with 401', async () => {
    const token = jwt.sign({ sub: 'anonymous' }, process.env.JWT_SECRET as string, { algorithm: 'HS256' });
    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', seedA.domain)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a host that no tenant is served on with 404', async () => {
    const res = await asTenant(seedA.slug, 'app.unknown-operator.com');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('tenant_not_found');
    expect(res.body.error.details.host).toBe('app.unknown-operator.com');
  });

  it('rejects a token whose org claim points at a different tenant with 403', async () => {
    const res = await asTenant(seedB.slug, seedA.domain);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
    expect(res.body.error.details).toMatchObject({ host: seedA.domain, org: seedB.slug });
  });

  it('rejects an org claim of a tenant that does not exist with 403', async () => {
    const res = await asTenant('ghost-operator', seedA.domain);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('resolves the tenant from the host even when a port is present', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', `${seedA.domain}:8443`)
      .set('Authorization', `Bearer ${issueToken(seedA.slug)}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant.slug).toBe(seedA.slug);
  });

  it('returns the branding and feature flags of the resolved tenant', async () => {
    const res = await asTenant(seedA.slug, seedA.domain);
    expect(res.status).toBe(200);
    expect(res.body.tenant).toMatchObject({ slug: seedA.slug, name: seedA.name, domain: seedA.domain });
    expect(res.body.branding).toEqual(seedA.branding);
    expect(res.body.featureFlags).toEqual(seedA.featureFlags);
  });

  it('serves tenant B a different config on its own host', async () => {
    const res = await asTenant(seedB.slug, seedB.domain);
    expect(res.status).toBe(200);
    expect(res.body.tenant.slug).toBe(seedB.slug);
    expect(res.body.branding).toEqual(seedB.branding);
    expect(res.body.featureFlags).toEqual(seedB.featureFlags);
    expect(res.body.featureFlags).not.toEqual(seedA.featureFlags);
  });
});
