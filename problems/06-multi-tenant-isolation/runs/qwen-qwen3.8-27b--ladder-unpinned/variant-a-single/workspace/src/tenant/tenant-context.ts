import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError } from '../common/api-error';

export interface TenantContext {
  id: string;
  slug: string;
}

/**
 * The request-scoped tenant. The middleware stores the resolved tenant here;
 * the tenant-aware Prisma client reads it on every operation.
 */
export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function requireTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new ApiError(
      500,
      'tenant_context_missing',
      'A data access was attempted with no resolved tenant in the request context. Failing closed instead of returning unscoped data.',
    );
  }
  return ctx;
}
