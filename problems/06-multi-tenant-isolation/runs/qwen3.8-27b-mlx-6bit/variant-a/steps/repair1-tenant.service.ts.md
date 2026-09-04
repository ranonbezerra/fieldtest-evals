# repair1-tenant.service.ts

## reasoning

```
The compiler errors for `src/tenant/tenant.service.ts` are:

1. `src/tenant/tenant.service.ts(2,30): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?`
2. `src/tenant/tenant.service.ts(3,31): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './tenant-context.js'?`
3. `src/tenant/tenant.service.ts(4,34): error TS2307: Cannot find module './tenant.repository' or its corresponding type declarations.`

So the file has three imports on lines 2, 3, and 4:
- Line 2: `../errors/app-exception` → needs `.js` extension
- Line 3: `./tenant-context` → needs `.js` extension
- Line 4: `./tenant.repository` → Cannot find module — this likely also needs the `.js` extension (since the module resolution is node16/nodenext and ESM, `./tenant.repository` won't resolve without the `.js` extension)

Now I need to write `src/tenant/tenant.service.ts` per the plan:

From PLAN.md §3:
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

The service:
- Uses `requireTenant()` from `./tenant-context` to get the current tenant
- Uses `TenantRepository.findBySlug(slug)` to load the tenant
- If not found, throws `AppException.resourceNotFound(slug)`
- Returns `TenantConfigDto`

The imports need:
1. `@nestjs/common` for `@Injectable()` — wait, that's not in the errors. Let me check what the file likely imports.

Looking at the errors:
- Line 2 (col 30): `../errors/app-exception` — so line 1 is probably the NestJS import
- Line 3 (col 31): `./tenant-context`
- Line 4 (col 34): `./tenant.repository`

So line 1 is likely `import { Injectable } from '@nestjs/common';` which doesn't have an error (it's a package import, not relative).

Wait, let me recount. The error says:
- `tenant.service.ts(2,30)` — line 2, column 30
- `tenant.service.ts(3,31)` — line 3, column 31
- `tenant.service.ts(4,34)` — line 4, column 34

So the file has at least 4 lines of imports (or line 1 is something else). Given the plan, the imports would be:

```
Line 1: import { Injectable } from '@nestjs/common';
Line 2: import { AppException } from '../errors/app-exception';
Line 3: import { requireTenant } from './tenant-context';
Line 4: import { TenantRepository } from './tenant.repository';
```

That matches the column positions roughly. The fix is to add `.js` extensions to the relative imports:

```
Line 2: import { AppException } from '../errors/app-exception.js';
Line 3: import { requireTenant } from './tenant-context.js';
Line 4: import { TenantRepository } from './tenant.repository.js';
```

Now let me write the complete file. The `Tenant` model from Prisma has fields: `slug`, `name`, `branding`, `feature_flags`. The DTO maps `feature_flags` → `featureFlags`.

```ts
import { Injectable } from '@nestjs/common';
import { AppException } from '../errors/app-exception.js';
import { requireTenant } from './tenant-context.js';
import { TenantRepository } from './tenant.repository.js';

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
      featureFlags: tenant.feature_flags as Record<string, boolean>,
    };
  }
}
```

This should be correct. The `Tenant` model from Prisma will have `branding` as `JsonValue` and `feature_flags` as `JsonValue`, so casting to the DTO types is appropriate.

Wait — I need to think about whether `branding` and `feature_flags` on the Prisma model would be typed as `JsonValue`. In Prisma, `Json` fields are typed as `JsonValue` from `@prisma/client`. So the cast is fine.

Let me also double-check: the plan says `AppException.resourceNotFound(slug)` — looking at the signature: `static resourceNotFound(id: string): AppException`. Good.

This should resolve all three errors in `tenant.service.ts` without touching anything else.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { AppException } from '../errors/app-exception.js';
import { requireTenant } from './tenant-context.js';
import { TenantRepository } from './tenant.repository.js';

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
      featureFlags: tenant.feature_flags as Record<string, boolean>,
    };
  }
}
```
