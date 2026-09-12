import { Module } from '@nestjs/common';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfigRepository } from './tenant-config.repository.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantConfigController],
  providers: [TenantConfigService, TenantConfigRepository],
})
export class TenantConfigModule {}
