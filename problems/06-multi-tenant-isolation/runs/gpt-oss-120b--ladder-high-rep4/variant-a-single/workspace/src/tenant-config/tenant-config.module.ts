import { Module } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantConfigRepository } from './tenant-config.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  providers: [TenantConfigService, TenantConfigRepository, PrismaService],
  controllers: [TenantConfigController],
})
export class TenantConfigModule {}
