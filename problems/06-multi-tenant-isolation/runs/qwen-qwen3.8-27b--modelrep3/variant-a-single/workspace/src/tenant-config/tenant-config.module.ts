import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantConfigService } from './tenant-config.service.js';

@Module({
  imports: [TenantModule],
  controllers: [TenantConfigController],
  providers: [TenantConfigService],
})
export class TenantConfigModule {}
