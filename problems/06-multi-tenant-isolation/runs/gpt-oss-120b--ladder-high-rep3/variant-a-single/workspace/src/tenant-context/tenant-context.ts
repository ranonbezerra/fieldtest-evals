import { AsyncLocalStorage } from 'async_hooks';

export class TenantContext {
  private static readonly storage = new AsyncLocalStorage<{ tenantId: number }>();

  static run<T>(tenantId: number, fn: () => T): T {
    return this.storage.run({ tenantId }, fn);
  }

  static getTenantId(): number | undefined {
    return this.storage.getStore()?.tenantId;
  }
}
