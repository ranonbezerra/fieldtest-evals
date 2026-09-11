import { AsyncLocalStorage } from 'node:async_hooks';
import { assertTenantId } from './tenant-id.js';

export class TenantContextError extends Error {
  constructor() {
    super('No tenant in the current request context; refusing to run an unscoped operation.');
  }
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage, so
 * concurrent requests on the same process each keep their own tenant.
 */
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<string>();

  current(): string {
    const tenantId = this.storage.getStore();
    if (tenantId === undefined) {
      throw new TenantContextError();
    }
    return tenantId;
  }

  tryCurrent(): string | null {
    return this.storage.getStore() ?? null;
  }

  runWithTenant<T>(tenantId: string, fn: () => T): T {
    return this.storage.run(assertTenantId(tenantId), fn);
  }
}
