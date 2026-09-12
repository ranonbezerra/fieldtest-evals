import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import { ApiError } from '../src/common/api-error.js';
import { TenantContextService } from '../src/tenant/tenant-context.service.js';
import { TenantResolutionMiddleware } from '../src/tenant/tenant-resolution.middleware.js';
import type { TenantRequest } from '../src/tenant/tenant-resolution.middleware.js';
import type { TenantService } from '../src/tenant/tenant.service.js';
import type { ResolvedTenant } from '../src/tenant/tenant.types.js';

const tenantA: ResolvedTenant = {
  id: 'tenant-a',
  slug: 'operator-a',
  host: 'app.operator-a.com',
  name: 'Operator A',
  primaryColor: '#111111',
  logoUrl: null,
  featureFlags: {},
};

const tenantB: ResolvedTenant = {
  id: 'tenant-b',
  slug: 'operator-b',
  host: 'app.operator-b.com',
  name: 'Operator B',
  primaryColor: '#222222',
  logoUrl: null,
  featureFlags: {},
};

const secret = 'test-secret';

beforeEach(() => {
  process.env.AUTH_TOKEN_SECRET = secret;
});

const tokenA = jwt.sign({ org: 'operator-a' }, secret, { algorithm: 'HS256' });
const tokenB = jwt.sign({ org: 'operator-b' }, secret, { algorithm: 'HS256' });

function makeMiddleware() {
  const context = new TenantContextService();
  const tenantService = {
    findTenantByHost: async (host: string): Promise<ResolvedTenant | null> => {
      if (host === tenantA.host) return tenantA;
      if (host === tenantB.host) return tenantB;
      return null;
    },
  };

  const middleware = new TenantResolutionMiddleware(
    context,
    tenantService as unknown as TenantService,
  );

  return { context, middleware };
}

function makeRequest(host?: string, token?: string): TenantRequest {
  const headers: Record<string, string> = {};
  if (host) headers.host = host;
  if (token) headers.authorization = `Bearer ${token}`;

  return { headers } as unknown as TenantRequest;
}

describe('tenant resolution middleware', () => {
  it('resolves tenant when host and org claim agree', async () => {
    const { context, middleware } = makeMiddleware();
    let observedTenantId: string | null = null;

    const next = vi.fn(async () => {
      observedTenantId = context.getTenantId();
    });

    await middleware.use(makeRequest(tenantA.host, tokenA), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(observedTenantId).toBe(tenantA.id);
  });

  it('rejects when token org does not match host', async () => {
    const { middleware } = makeMiddleware();
    const next = vi.fn();

    await middleware.use(makeRequest(tenantA.host, tokenB), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(403);
    expect((error as ApiError).code).toBe('tenant_mismatch');
  });

  it('rejects unknown host', async () => {
    const { middleware } = makeMiddleware();
    const next = vi.fn();

    await middleware.use(
      makeRequest('app.unknown.com', tokenA),
      {} as Response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(400);
    expect((error as ApiError).code).toBe('unknown_host');
  });

  it('rejects invalid token', async () => {
    const { middleware } = makeMiddleware();
    const next = vi.fn();

    await middleware.use(makeRequest(tenantA.host, 'garbage'), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(401);
    expect((error as ApiError).code).toBe('invalid_token');
  });

  it('rejects missing authorization', async () => {
    const { middleware } = makeMiddleware();
    const next = vi.fn();

    await middleware.use(makeRequest(tenantA.host), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(401);
    expect((error as ApiError).code).toBe('invalid_token');
  });

  it('rejects missing host', async () => {
    const { middleware } = makeMiddleware();
    const next = vi.fn();

    await middleware.use(makeRequest(undefined, tokenA), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(400);
    expect((error as ApiError).code).toBe('invalid_host');
  });
});
