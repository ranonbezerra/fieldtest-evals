import { Injectable, Scope } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface TenantStore {
  tenantId: string;
}

@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  private readonly asyncLocalStorage = new AsyncLocalStorage<TenantStore>();

  run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.asyncLocalStorage.run({ tenantId }, fn);
  }

  setTenantId(tenantId: string) {
    const store = this.asyncLocalStorage.getStore();
    if (store) {
      store.tenantId = tenantId;
    }
  }

  getTenantId(): string | undefined {
    return this.asyncLocalStorage.getStore()?.tenantId;
  }
}
