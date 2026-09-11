import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/**
 * Thrown whenever a query is attempted with no tenant in the current request
 * context. Failing here — instead of falling back to an unscoped query — is
 * the core guarantee of the tenant-aware data layer.
 */
export class TenantContextMissingError extends Error {
  constructor() {
    super('no tenant in request context; refusing to run an unscoped query');
    this.name = 'TenantContextMissingError';
  }
}

export interface TenantContext {
  readonly tenantId: string;
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage. The middleware
 * starts the request inside `run`, and the tenant then follows the async work
 * (route handler -> service -> repository -> Prisma) without being passed
 * through any signature.
 */
@Injectable()
export class TenantContextStorage {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(tenant: TenantContext, fn: () => T): T {
    return this.storage.run(tenant, fn);
  }

  /** The tenant id for the current request; throws when none is in context. */
  get tenantId(): string {
    const ctx = this.storage.getStore();
    if (!ctx) {
      throw new TenantContextMissingError();
    }
    return ctx.tenantId;
  }
}
