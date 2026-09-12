import { AsyncLocalStorage } from 'async_hooks';

export interface TenantInfo {
  id: string;
}

export class TenantContext {
  private static readonly storage = new AsyncLocalStorage<TenantInfo>();

  static run<T>(tenant: TenantInfo, fn: () => T): T {
    return this.storage.run(tenant, fn);
  }

  static getTenant(): TenantInfo | undefined {
    return this.storage.getStore();
  }
}
