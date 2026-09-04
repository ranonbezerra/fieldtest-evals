# 15-tenant.service.ts

## reasoning

```
Let me analyze the plan for `src/tenant/tenant.service.ts`:

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

So the service:
1. Has a `TenantConfigDto` interface with `slug`, `name`, `branding`, `featureFlags`
2. `TenantService` class with constructor taking `TenantRepository`
3. `getConfig()` method that:
   - Gets tenant from `requireTenant()` (from `tenant-context.ts`)
   - Uses the slug to look up the tenant via the repository
   - If not found, throws `AppException.resourceNotFound(slug)`
   - Returns a `TenantConfigDto`

Looking at the references:
- `tenant-context.ts` exports `requireTenant()` which returns a `TenantContext` with `tenantId`, `slug`, `domain`
- `tenant.repository.ts` has `findBySlug(slug: string): Promise<Tenant | undefined>`
- The `Tenant` model from Prisma has fields: `id`, `slug`, `domain`, `name`, `branding` (jsonb), `featureFlags` (jsonb), `createdAt`, `updatedAt`

From the schema in the plan:
- `branding` is jsonb → will be `JsonValue` from Prisma, but the plan says `Record<string, unknown>`
- `feature_flags` is jsonb → will be `JsonValue` from Prisma, but the plan says `Record<string, boolean>`

The service needs to:
1. Call `requireTenant()` to get the current tenant context (gives us the slug)
2. Call `this.repo.findBySlug(slug)` to get the tenant record
3. If undefined, throw `AppException.resourceNotFound(slug)`
4. Map to `TenantConfigDto`

Let me write this:

```ts
import { Injectable } from '@nestjs/common';
import { requireTenant } from './tenant-context';
import { TenantRepository } from './tenant.repository';
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

Wait, looking at the Prisma schema columns: `feature_flags` is the column name (snake_case), but the Prisma model field would be `featureFlags` (camelCase by default). Let me check the plan again:

The plan says:
- `feature_flags` is jsonb | map of flag→bool, default `{}`

In Prisma, by default the field name in the model matches the column unless `@map` is used. The plan's convention says "Table and column: snake_case (via Prisma @map/@@map)". So the Prisma field would be `featureFlags` and mapped to `feature_flags` column.

Similarly, `branding` is already single word so it stays as `branding`.

The Prisma-generated `Tenant` type would have:
- `slug: string`
- `name: string`
- `branding: JsonValue` (since it's jsonb)
- `featureFlags: JsonValue`

So I need to cast them. Let me use `as` casts.

This looks correct. Let me finalize.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { AppException } from '../errors/app-exception';
import { requireTenant } from './tenant-context';
import { TenantRepository } from './tenant.repository';

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
