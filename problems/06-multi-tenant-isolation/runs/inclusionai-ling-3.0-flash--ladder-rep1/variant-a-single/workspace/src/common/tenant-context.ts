import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantContextStore {
  tenantId: string;
}

export const tenantAsyncLocalStorage = new AsyncLocalStorage<TenantContextStore>();

export function setTenantContext(tenantId: string): void {
  tenantAsyncLocalStorage.enterWith({ tenantId });
}

export function getTenantId(): string | undefined {
  const store = tenantAsyncLocalStorage.getStore();
  return store?.tenantId;
}
