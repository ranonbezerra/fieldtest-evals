// src/app.module.ts

import { Module } from '@nestjs/common';

/**
 * ASSUMPTION: The following feature modules exist at the indicated paths.
 * The project’s folder layout follows the conventional NestJS structure,
 * therefore each module file (e.g. `plan.module.ts`) resides in the same
 * directory as its controller, service and repository.
 *
 * If any of these modules are missing, the application will not compile.
 * The current task only requires fixing `AppModule`; implementation of the
 * referenced modules is outside the scope of this change.
 */
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantConfigModule } from './tenant-config/tenant-config.module';
import { PlanModule } from './plan/plan.module';
import { OrderModule } from './order/order.module';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    TenantConfigModule,
    PlanModule,
    OrderModule,
  ],
})
export class AppModule {}
