import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfigController } from './tenant-config.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [TenantConfigService],
  controllers: [TenantConfigController],
  exports: [TenantConfigService],
})
export class TenantConfigModule {}
