import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { TenantConfigController } from './tenant-config.controller';

@Module({
  imports: [TenantModule],
  controllers: [TenantConfigController],
})
export class TenantConfigModule {}
