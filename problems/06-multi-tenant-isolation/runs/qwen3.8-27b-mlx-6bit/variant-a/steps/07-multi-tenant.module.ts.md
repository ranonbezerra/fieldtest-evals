# 07-multi-tenant.module.ts

## reasoning

```
Let me analyze what the plan specifies for `src/multi-tenant/multi-tenant.module.ts`:

From the plan:
```ts
@Module({
  providers: [PrismaService, TenantContextService, TenantResolutionMiddleware],
  exports: [PrismaService, TenantContextService],
})
export declare class MultiTenantModule {}
```

But wait, the plan also says:
- `TenantContextService` is `@Scope(REQUEST)`.
- `PrismaService` is singleton.
- `TenantResolutionMiddleware` is `@Scope(REQUEST)`.

And looking at the manifest, this file reads:
- `src/multi-tenant/prisma.service.ts`
- `src/multi-tenant/tenant-context.service.ts`
- `src/multi-tenant/tenant-resolution.middleware.ts`
- `src/multi-tenant/tenant-prisma.service.ts`

So the module should also include `TenantPrismaService` in providers. Let me re-read the plan more carefully.

The plan section 3 shows:
```ts
@Module({
  providers: [PrismaService, TenantContextService, TenantResolutionMiddleware],
  exports: [PrismaService, TenantContextService],
})
export declare class MultiTenantModule {}
```

But the manifest lists `src/multi-tenant/tenant-prisma.service.ts` as a read dependency of the module file. This makes sense because `TenantPrismaService` needs to be a provider in the module (it's REQUEST-scoped, used by repositories in other modules).

Looking at the reference file for `tenant-prisma.service.ts`, it's `@Injectable({ scope: Scope.REQUEST })` and needs to be provided by this module so that other modules (customer, plan, order) can inject it.

But the plan's code block only shows three providers and two exports. However, the manifest says this file reads `tenant-prisma.service.ts`. The plan text says:

"**TenantPrismaService** must not be instantiated as a singleton; it is REQUEST-scoped and reads `TenantContextService` (also REQUEST) at call time, not construction time."

And the repositories use `TenantPrismaService`. For other modules to inject it, it must be exported from MultiTenantModule.

Wait, let me re-read the plan's module section more carefully:

```
### `src/multi-tenant/multi-tenant.module.ts`

```ts
@Module({
  providers: [PrismaService, TenantContextService, TenantResolutionMiddleware],
  exports: [PrismaService, TenantContextService],
})
export declare class MultiTenantModule {}
```

`TenantContextService` is `@Scope(REQUEST)`. `PrismaService` is singleton. `TenantResolutionMiddleware` is `@Scope(REQUEST)`.
```

The plan explicitly shows only three providers and two exports. But the manifest says this file reads `tenant-prisma.service.ts`. 

Hmm, but looking at the convention: "A service, repository or processor is listed in its module's `providers`. A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other."

Since repositories in customer/plan/order modules use `TenantPrismaService`, and those modules import `MultiTenantModule`, the `TenantPrismaService` must be both a provider and an export of `MultiTenantModule`.

The plan's code block might be incomplete (it uses `declare class` which is a declaration, not the full implementation). The manifest clearly states this file reads `tenant-prisma.service.ts`, meaning it imports it. The only reason to import it in a module file is to list it in providers/exports.

So the correct implementation should include `TenantPrismaService` in both providers and exports. Let me also check if `TenantResolutionMiddleware` should be a provider - it's listed in the plan's providers. But middleware in NestJS is typically applied via `configure()` in a module that implements `NestModule`. However, the plan lists it as a provider. Let me just follow the plan exactly.

Actually wait - the plan says `TenantResolutionMiddleware` is in providers. But looking at how NestJS middleware works, you typically apply middleware in a module's `configure()` method via `forRoutes()`. The middleware itself doesn't need to be in providers unless it's being used as a dependency injection target. But the plan explicitly lists it in providers, so I'll follow that.

Actually, looking more carefully at the plan, it says the module has:
- providers: [PrismaService, TenantContextService, TenantResolutionMiddleware]
- exports: [PrismaService, TenantContextService]

But the manifest says this file reads `tenant-prisma.service.ts`. So I need to include `TenantPrismaService` as well. The plan's code block is a specification outline (using `declare class`), and the manifest gives the definitive list of dependencies. I'll include `TenantPrismaService` in providers and exports since it's needed by other modules.

Let me write the file:

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantContextService } from './tenant-context.service.js';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';
import { TenantPrismaService } from './tenant-prisma.service.js';

@Module({
  providers: [PrismaService, TenantContextService, TenantResolutionMiddleware, TenantPrismaService],
  exports: [PrismaService, TenantContextService, TenantPrismaService],
})
export class MultiTenantModule {}
```

Wait, should I include a `configure()` method for the middleware? The plan doesn't mention one in this file. The manifest says this file's reads are the four services. No mention of a configure method or NestModule implementation. Let me just stick with what the plan says - no configure method.

Actually, looking at `src/main.ts` in the manifest: "Bootstrap (CORS, middleware binding, listen)". So middleware binding happens in main.ts, not in the module. That makes sense - the plan doesn't show a configure method.

Let me finalize. The plan's code block shows three providers and two exports, but the manifest clearly adds `TenantPrismaService` as a dependency. I'll include it in both providers and exports since it's needed by other feature modules.

One more consideration: the ESM convention means imports use `.js` extension, as seen in the reference files.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantContextService } from './tenant-context.service.js';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';
import { TenantPrismaService } from './tenant-prisma.service.js';

@Module({
  providers: [
    PrismaService,
    TenantContextService,
    TenantResolutionMiddleware,
    TenantPrismaService,
  ],
  exports: [PrismaService, TenantContextService, TenantPrismaService],
})
export class MultiTenantModule {}
```
