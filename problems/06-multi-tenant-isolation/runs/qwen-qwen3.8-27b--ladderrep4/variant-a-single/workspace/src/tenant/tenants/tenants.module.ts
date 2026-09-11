import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant.module.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantService } from './tenant.service.js';

@Module({
  imports: [TenantModule],
  controllers: [TenantConfigController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantsModule {}
