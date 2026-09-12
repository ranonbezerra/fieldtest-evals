import { Module } from '@nestjs/common';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfigRepository } from './tenant-config.repository.js';

@Module({
  controllers: [TenantConfigController],
  providers: [TenantConfigService, TenantConfigRepository],
})
export class TenantConfigModule {}
