import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    CustomerModule,
    TenantConfigModule,
  ],
})
export class AppModule {}
