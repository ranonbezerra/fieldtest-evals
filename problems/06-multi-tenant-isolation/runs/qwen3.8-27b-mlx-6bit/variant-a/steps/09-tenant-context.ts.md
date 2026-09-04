# 09-tenant-context.ts

## reasoning

```
Let me analyze what's needed for `src/tenant/tenant-context.ts` based on the plan:

```ts
`src/tenant/tenant-context.ts`
```ts
export interface TenantContext { tenantId: string; slug: string; domain: string; }
export const tenantStorage: AsyncLocalStorage<TenantContext>;
export function currentTenant(): TenantContext | undefined;
export function requireTenant(): TenantContext;   // throws AppException.tenantContextMissing() if absent
```

So I need:
1. An interface `TenantContext` with `tenantId`, `slug`, `domain` (all strings)
2. A constant `tenantStorage` which is an `AsyncLocalStorage<TenantContext>`
3. A function `currentTenant()` that returns `TenantContext | undefined`
4. A function `requireTenant()` that returns `TenantContext`, throwing `AppException.tenantContextMissing()` if absent

The file reads `src/errors/app-exception.ts` (for `AppException.tenantContextMissing()`).

Let me write this:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppException } from '../errors/app-exception';

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
```

That's clean and complete. The `AsyncLocalStorage` comes from `node:async_hooks` which is standard in Node 20+. The import path for `AppException` is relative: `../errors/app-exception`.

Let me verify against the plan:
- Interface with three string fields ✓
- `tenantStorage` exported as const, typed as `AsyncLocalStorage<TenantContext>` ✓
- `currentTenant()` returns `TenantContext | undefined` ✓
- `requireTenant()` throws `AppException.tenantContextMissing()` if absent ✓

This is exactly what's specified. No extra exports, no extra features.
```

## reply

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppException } from '../errors/app-exception';

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
```
