import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  org: string;
  host: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function getCurrentTenant(): TenantContext | undefined {
  return storage.getStore();
}

export function runInTenantContext<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}
