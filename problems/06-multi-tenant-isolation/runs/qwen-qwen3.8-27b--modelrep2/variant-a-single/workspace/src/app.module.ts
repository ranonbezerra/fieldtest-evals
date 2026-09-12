import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { CustomerModule } from './customer/customer.module.js';
import { OrderModule } from './order/order.module.js';
import { PlanModule } from './plan/plan.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';

@Module({
  imports: [PrismaModule, TenantModule, CustomerModule, PlanModule, OrderModule],
  providers: [
    // Single error envelope for the whole API, including the test app.
    { provide: APP_FILTER, useValue: new AllExceptionsFilter() },
  ],
})
export class AppModule {}
