import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tenant } from '@prisma/client';

export interface TenantScope {
  tenant: Tenant;
}

const storage = new AsyncLocalStorage<TenantScope>();

/**
 * Runs fn (and everything it triggers) with the given tenant bound to the
 * current async execution context - i.e. for the duration of one request.
 */
export function runWithTenant<T>(tenant: Tenant, fn: () => T): T {
  return storage.run({ tenant }, fn);
}

/**
 * Returns the tenant bound to the current request context.
 * Throws when called outside a tenant-resolved request.
 */
export function currentTenant(): Tenant {
  const scope = storage.getStore();
  if (!scope) {
    throw new Error('currentTenant() called outside of a tenant request context');
  }
  return scope.tenant;
}
