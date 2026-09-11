import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { CustomersModule } from './customers/customers.module';
import { TenantConfigModule } from './tenant-config/tenant-config.module';

@Module({
  imports: [PrismaModule, TenantModule, CustomersModule, TenantConfigModule],
})
export class AppModule {}
