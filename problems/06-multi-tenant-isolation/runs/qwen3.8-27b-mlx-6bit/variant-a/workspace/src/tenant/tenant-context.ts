import { AsyncLocalStorage } from 'node:async_hooks';
import { AppException } from '../errors/app-exception.js';

export interface TenantContext {
  tenantId: string;
  slug: string;
  domain: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function currentTenant(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function requireTenant(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw AppException.tenantContextMissing();
  }
  return ctx;
}
