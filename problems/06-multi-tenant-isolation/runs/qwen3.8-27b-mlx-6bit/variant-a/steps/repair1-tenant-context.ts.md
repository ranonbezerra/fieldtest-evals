# repair1-tenant-context.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/tenant/tenant-context.ts`.

Looking at the error messages, I need to find which ones specifically reference `src/tenant/tenant-context.ts`:

1. `src/tenant/tenant-resolution.middleware.ts(5,31): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './tenant-context.js'?`
2. `src/tenant/tenant-resolution.middleware.ts(6,36): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './tenant-context.js'?`
3. `src/tenant/tenant.service.ts(3,31): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './tenant-context.js'?`

These are errors in OTHER files that import FROM `./tenant-context` without the `.js` extension. The task says "Change nothing the messages do not name." — these errors are in other files, not in `tenant-context.ts` itself.

Wait, let me re-read the task: "Rewrite `src/tenant/tenant-context.ts` complete, fixing what these messages require of this file."

So I need to fix `src/tenant/tenant-context.ts` based on what the compiler errors require of THIS file. The errors that reference `tenant-context.ts` are in other files importing from it — they need `.js` extensions on their import paths, but that's a fix for those other files, not for `tenant-context.ts` itself.

Let me look at what errors are actually IN `src/tenant/tenant-context.ts`. Looking through the list... I don't see any error that starts with `src/tenant/tenant-context.ts`. The first line is cut off:

```
tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?
```

This looks like the tail end of a message. Given the context, this is likely:
`src/tenant/tenant-context.ts(some_line,some_col): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?`

So the error in `tenant-context.ts` is that it imports from `../errors/app-exception` without the `.js` extension. It needs to be `../errors/app-exception.js`.

Now, the other errors about `./tenant-context` vs `./tenant-context.js` are in OTHER files (tenant-resolution.middleware.ts and tenant.service.ts). The task says "Change nothing the messages do not name." So I should NOT fix those other files. But I should fix `tenant-context.ts` itself.

So the fix for `src/tenant/tenant-context.ts` is:
- Change the import of `../errors/app-exception` to `../errors/app-exception.js`

Now let me write the complete file based on the PLAN.md specification:

```ts
export interface TenantContext { tenantId: string; slug: string; domain: string; }
export const tenantStorage: AsyncLocalStorage<TenantContext>;
export function currentTenant(): TenantContext | undefined;
export function requireTenant(): TenantContext;   // throws AppException.tenantContextMissing() if absent
```

The file imports `AsyncLocalStorage` from `node:async_hooks` and `AppException` from `../errors/app-exception`.

Let me write it:

```ts
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
```

This is the only change needed — adding `.js` to the import path. Everything else stays the same per the plan.

Wait, I should double-check: is `node:async_hooks` a package import or a built-in? With `moduleResolution: node16`, built-in modules with the `node:` prefix should work fine. No extension needed for those.

Let me also verify: the plan says `src/tenant/tenant-context.ts | reads: src/errors/app-exception.ts`. So it reads from app-exception. The import needs `.js` extension due to `moduleResolution: node16/nodenext`.

This looks correct. The only fix needed in this file is the `.js` extension on the import path.
```

## reply

```ts
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
```
