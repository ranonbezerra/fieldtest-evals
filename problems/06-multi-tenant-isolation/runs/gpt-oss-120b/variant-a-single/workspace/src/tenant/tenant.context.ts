import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<Map<string, unknown>>();

  run<T>(tenantId: string, fn: () => T): T {
    const store = new Map<string, unknown>();
    store.set('tenantId', tenantId);
    return this.storage.run(store, fn);
  }

  getTenantId(): string | undefined {
    return this.storage.getStore()?.get('tenantId') as string | undefined;
  }
}
