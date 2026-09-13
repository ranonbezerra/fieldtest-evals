import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module.js';
import { TenantService } from './tenant.service.js';
import { TenantController } from './tenant.controller.js';

@Module({
  imports: [PrismaModule],
  providers: [TenantService],
  exports: [TenantService],
  controllers: [TenantController],
})
export class TenantModule {}
