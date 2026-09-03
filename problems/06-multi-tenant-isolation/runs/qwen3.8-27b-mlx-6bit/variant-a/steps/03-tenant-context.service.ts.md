# 03-tenant-context.service.ts

## reasoning

```
Let me analyze the plan for `src/multi-tenant/tenant-context.service.ts`:

From the plan:
```ts
export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

export interface TenantContext {
  readonly tenantId: string;
  readonly domain: string;
}

export declare class TenantContextService {
  constructor();
  resolve(ctx: TenantContext): void;
  get tenantId(): string;
  get domain(): string;
}
```

- `resolve` throws `TenantNotResolvedError` if called more than once per request (defensive).
- Accessing `tenantId` before `resolve` throws `TenantNotResolvedError`.

The service is `@Scope(REQUEST)`.

Now, the plan says:
- `resolve` throws `TenantNotResolvedError` if called more than once per request (defensive).
- Accessing `tenantId` before `resolve` throws `TenantNotResolvedError`.

Wait, that's a bit contradictory. Let me re-read: "resolve throws TenantNotResolvedError if called more than once per request". Actually that should probably be a different error - like "already resolved". But the plan explicitly says `TenantNotResolvedError`. Let me re-read...

"resolve throws `TenantNotResolvedError` if called more than once per request (defensive)."

Hmm, that's what the plan says. But logically, if resolve is called more than once, it's already resolved, not "not resolved". However, the plan is my specification and I must follow it exactly. Let me re-read one more time...

Actually, wait. Let me re-read the errors section:

```
export declare class TenantNotResolvedError extends Error {
  constructor();
}
// Internal invariant violation (500 if it leaks)
```

So `TenantNotResolvedError` is for "internal invariant violation". The plan says:
- Accessing `tenantId` before `resolve` throws `TenantNotResolvedError`.
- `resolve` throws `TenantNotResolvedError` if called more than once per request (defensive).

I'll follow the plan exactly. Both cases throw `TenantNotResolvedError`.

Wait, actually re-reading more carefully: "resolve throws TenantNotResolvedError if called more than once per request (defensive)." This is a bit odd but I'll implement it as stated. Actually, maybe it's a typo in the plan and they meant a different error, but the plan only defines `TenantNotResolvedError` as an internal invariant error. I'll follow the plan literally.

Hmm, actually let me reconsider. The plan says "resolve throws TenantNotResolvedError if called more than once". Maybe the intent is that calling resolve a second time is an invariant violation (you shouldn't re-resolve), and the error name is just what's available. I'll implement it as stated.

Now, the plan references `TenantNotResolvedError` from `src/multi-tenant/errors.ts`. I need to import it.

Let me also check: the plan says `TENANT_CONTEXT` is exported as a Symbol. This is likely for use with NestJS DI token for REQUEST-scoped providers.

Let me write the complete file:

```ts
import { Scope, Injectable } from '@nestjs/common';
import { TenantNotResolvedError } from './errors.js';

export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

export interface TenantContext {
  readonly tenantId: string;
  readonly domain: string;
}

@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private resolved: TenantContext | null = null;

  resolve(ctx: TenantContext): void {
    if (this.resolved !== null) {
      throw new TenantNotResolvedError();
    }
    this.resolved = ctx;
  }

  get tenantId(): string {
    if (this.resolved === null) {
      throw new TenantNotResolvedError();
    }
    return this.resolved.tenantId;
  }

  get domain(): string {
    if (this.resolved === null) {
      throw new TenantNotResolvedError();
    }
    return this.resolved.domain;
  }
}
```

Wait, the plan says the file uses `.js` extension for imports? Let me check the conventions. The stack says ESM with `"type": "module"`. In NestJS with ESM, you typically use `.js` extensions in imports. But actually, many NestJS projects use no extension or `.js`. Since the plan doesn't specify import extensions explicitly, and the project is ESM, I'll use `.js` extension for the local import.

Actually, looking at the plan's "reads" field for this file: `src/multi-tenant/tenant-context.service.ts | reads: -`. It says it reads nothing! So maybe `TenantNotResolvedError` is defined in the same file? No, that can't be right because the plan explicitly lists it under `src/multi-tenant/errors.ts`.

Wait, let me re-read the manifest:
```
src/multi-tenant/tenant-context.service.ts | reads: - | TenantContext interface, TenantContextService (REQUEST-scoped)
```

It says "reads: -" meaning it doesn't read any other files. But the plan clearly states that `resolve` throws `TenantNotResolvedError` and accessing `tenantId` before `resolve` throws `TenantNotResolvedError`. The `TenantNotResolvedError` is defined in `errors.ts`.

This is a contradiction. The manifest says no reads, but the behavior requires importing `TenantNotResolvedError` from `errors.ts`. 

I think the manifest is just slightly wrong/incomplete here, or perhaps the intent is that `TenantNotResolvedError` is simple enough that it could be defined inline. But the plan explicitly defines it in `errors.ts`. 

I'll go with importing from `./errors.js` since the plan clearly defines `TenantNotResolvedError` there and this file needs to throw it. The "reads: -" in the manifest is likely an oversight since the behavioral spec clearly requires the error.

Actually wait - let me reconsider. Maybe the plan intends for `TenantNotResolvedError` to be a simple Error subclass that could be defined right here. But no, the plan explicitly puts it in `errors.ts` with a specific signature. I'll import it.

Let me finalize my implementation.
```

## reply

```ts
import { Injectable, Scope } from '@nestjs/common';
import { TenantNotResolvedError } from './errors.js';

export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

export interface TenantContext {
  readonly tenantId: string;
  readonly domain: string;
}

@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private resolved: TenantContext | null = null;

  resolve(ctx: TenantContext): void {
    if (this.resolved !== null) {
      throw new TenantNotResolvedError();
    }
    this.resolved = ctx;
  }

  get tenantId(): string {
    if (this.resolved === null) {
      throw new TenantNotResolvedError();
    }
    return this.resolved.tenantId;
  }

  get domain(): string {
    if (this.resolved === null) {
      throw new TenantNotResolvedError();
    }
    return this.resolved.domain;
  }
}
```
