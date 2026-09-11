import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomersModule } from './customers/customers.module.js';

@Module({
  imports: [PrismaModule, TenantModule, CustomersModule],
})
export class AppModule {}
