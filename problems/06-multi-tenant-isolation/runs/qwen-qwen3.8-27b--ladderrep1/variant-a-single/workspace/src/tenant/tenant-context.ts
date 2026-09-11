import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

export const tenantContext = {
  run<R>(tenantId: string, fn: () => R): R {
    return storage.run(tenantId, fn);
  },
  getTenantId(): string | undefined {
    return storage.getStore();
  },
};
