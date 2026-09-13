import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from './database/database.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { PlansModule } from './plans/plans.module.js';
import { AllExceptionsFilter } from './common/exceptions.filter.js';

@Module({
  imports: [
    DatabaseModule,
    TenantModule,
    TenantConfigModule,
    CustomersModule,
    PlansModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
