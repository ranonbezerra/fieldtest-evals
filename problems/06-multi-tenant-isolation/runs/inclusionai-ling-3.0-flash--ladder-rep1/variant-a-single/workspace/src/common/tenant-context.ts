import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

export function setTenantContext(ctx: TenantContext): void {
  tenantContext.enterWith(ctx);
}

export function getTenantId(): string | undefined {
  const store = tenantContext.getStore();
  return store?.tenantId;
}
