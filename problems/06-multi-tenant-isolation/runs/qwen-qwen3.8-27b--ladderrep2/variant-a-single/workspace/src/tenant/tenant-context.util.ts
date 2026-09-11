import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  slug: string;
  domain: string;
}

/**
 * Request-scoped tenant context. The resolution middleware wraps each request
 * in runWithTenant(); everything downstream (controllers, services,
 * repositories, the tenant-aware Prisma client) reads the tenant from here.
 * AsyncLocalStorage keeps concurrent requests in separate contexts.
 */
const storage = new AsyncLocalStorage<TenantContext>();

export class TenantContextError extends Error {
  constructor() {
    super('A query was issued outside a tenant context and was refused');
    this.name = 'TenantContextError';
  }
}

export function runWithTenant<T>(context: TenantContext, work: () => T): T {
  return storage.run(context, work);
}

export function getTenantContext(): TenantContext {
  const context = storage.getStore();
  if (!context) throw new TenantContextError();
  return context;
}
