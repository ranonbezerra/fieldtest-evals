# repair2-tenant.service.ts

## reasoning

```
The compiler error for `src/tenant/tenant.service.ts` is:

```
src/tenant/tenant.service.ts(27,28): error TS2551: Property 'feature_flags' does not exist on type '{ id: string; name: string; createdAt: Date; updatedAt: Date; slug: string; domain: string; branding: JsonValue; featureFlags: JsonValue; }'. Did you mean 'featureFlags'?
```

This tells me that the Prisma-generated type for `Tenant` has `featureFlags` (camelCase, as the Prisma model field name) and `branding` (also camelCase). The code on line 27 is trying to access `feature_flags` (snake_case) instead of `featureFlags`.

So the fix is to change `feature_flags` to `featureFlags` in `src/tenant/tenant.service.ts`.

Now let me reconstruct what `src/tenant/tenant.service.ts` likely looks like based on the PLAN:

```ts
export interface TenantConfigDto {
  slug: string; name: string;
  branding: Record<string, unknown>; featureFlags: Record<string, boolean>;
}

export class TenantService {
  constructor(repo: TenantRepository);
  getConfig(): Promise<TenantConfigDto>;   // tenant from requireTenant(); throws resourceNotFound(slug) if missing
}
```

The service uses `requireTenant()` to get the current tenant context, then looks up the tenant by slug from the repository, and returns the config DTO.

The error is on line 27, column 28, saying `feature_flags` doesn't exist but `featureFlags` does. So the code is doing something like `tenant.feature_flags` when it should be `tenant.featureFlags`.

Let me write the complete file:

```ts
import { Injectable } from '@nestjs/common';
import { TenantRepository } from './tenant.repository';
import { requireTenant } from './tenant-context';
import { AppException } from '../errors/app-exception';

export interface TenantConfigDto {
  slug: string;
  name: string;
  branding: Record<string, unknown>;
  featureFlags: Record<string, boolean>;
}

@Injectable()
export class TenantService {
  constructor(private readonly repo: TenantRepository) {}

  async getConfig(): Promise<TenantConfigDto> {
    const ctx = requireTenant();
    const tenant = await this.repo.findBySlug(ctx.slug);
    if (!tenant) {
      throw AppException.resourceNotFound(ctx.slug);
    }
    return {
      slug: tenant.slug,
      name: tenant.name,
      branding: tenant.branding as Record<string, unknown>,
      featureFlags: tenant.featureFlags as Record<string, boolean>,
    };
  }
}
```

The fix is simply changing `feature_flags` to `featureFlags`. Let me count lines to make sure line 27 aligns... Actually, I just need to fix the property name. The rest of the file should be as the plan specifies.

Let me make sure I'm not changing anything the messages don't name. The only message for this file is the `feature_flags` → `featureFlags` fix. So I just need to write the file with `featureFlags` instead of `feature_flags`.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { TenantRepository } from './tenant.repository';
import { requireTenant } from './tenant-context';
import { AppException } from '../errors/app-exception';

export interface TenantConfigDto {
  slug: string;
  name: string;
  branding: Record<string, unknown>;
  featureFlags: Record<string, boolean>;
}

@Injectable()
export class TenantService {
  constructor(private readonly repo: TenantRepository) {}

  async getConfig(): Promise<TenantConfigDto> {
    const ctx = requireTenant();
    const tenant = await this.repo.findBySlug(ctx.slug);
    if (!tenant) {
      throw AppException.resourceNotFound(ctx.slug);
    }
    return {
      slug: tenant.slug,
      name: tenant.name,
      branding: tenant.branding as Record<string, unknown>,
      featureFlags: tenant.featureFlags as Record<string, boolean>,
    };
  }
}
```
