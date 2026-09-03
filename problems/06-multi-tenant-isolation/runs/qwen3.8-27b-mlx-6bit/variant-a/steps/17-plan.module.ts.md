# 17-plan.module.ts

## reasoning

```
The task is to write `src/plan/plan.module.ts` — the PlanModule file.

From the plan:
- `src/plan/plan.module.ts | reads: src/plan/plan.controller.ts, src/plan/plan.service.ts, src/plan/plan.repository.ts, src/multi-tenant/multi-tenant.module.ts | PlanModule`

So the module:
- Declares `PlanController` (controllers)
- Providers: `PlanService`, `PlanRepository`
- Imports: `MultiTenantModule` (because the repository needs `TenantPrismaService`, which is exported by MultiTenantModule)

Looking at the pattern from the references:
- `PlanRepository` depends on `TenantPrismaService` (from multi-tenant)
- `PlanService` depends on `PlanRepository`
- `PlanController` depends on `PlanService`

The MultiTenantModule exports: `[PrismaService, TenantContextService, TenantPrismaService]`

So PlanModule needs to:
- Import MultiTenantModule (to get TenantPrismaService)
- Provide PlanService and PlanRepository
- Declare PlanController

The file uses ESM imports (`.js` extensions) as seen in the references.

Let me write it:

```ts
import { Module } from '@nestjs/common';
import { MultiTenantModule } from '../multi-tenant/multi-tenant.module.js';
import { PlanController } from './plan.controller.js';
import { PlanService } from './plan.service.js';
import { PlanRepository } from './plan.repository.js';

@Module({
  imports: [MultiTenantModule],
  controllers: [PlanController],
  providers: [PlanService, PlanRepository],
})
export class PlanModule {}
```

This is clean and follows the conventions. The plan says the module reads those four files, which aligns with importing them. No exports needed since nothing external needs PlanService or PlanRepository directly (the controller handles the HTTP layer).

Wait, let me check — does any other module need to import PlanService or PlanRepository? Looking at the plan, no other module references them. The AppModule just imports the feature modules. So no exports needed.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { MultiTenantModule } from '../multi-tenant/multi-tenant.module.js';
import { PlanController } from './plan.controller.js';
import { PlanService } from './plan.service.js';
import { PlanRepository } from './plan.repository.js';

@Module({
  imports: [MultiTenantModule],
  controllers: [PlanController],
  providers: [PlanService, PlanRepository],
})
export class PlanModule {}
```
