import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tenant } from '@prisma/client';
import { ApiError } from '../common/api-error.js';

export interface TenantContextStore {
  tenantId: string;
  tenant: Tenant;
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage. Bound once by
 * the tenant middleware and inherited by every async operation of the
 * request, so concurrent requests from different tenants never share it.
 */
const storage = new AsyncLocalStorage<TenantContextStore>();

export class TenantContext {
  private constructor() {}

  static run<R>(store: TenantContextStore, callback: () => R): R {
    return storage.run(store, callback);
  }

  static getStore(): TenantContextStore | undefined {
    return storage.getStore();
  }

  static getTenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  }

  static requireTenant(): Tenant {
    const store = storage.getStore();
    if (!store) {
      throw new ApiError(500, 'tenant_context_missing', 'No tenant is bound to the current request');
    }
    return store.tenant;
  }
}
