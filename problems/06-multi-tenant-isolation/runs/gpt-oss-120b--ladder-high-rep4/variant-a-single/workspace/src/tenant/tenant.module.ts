import { Module } from '@nestjs/common';
import { TenantRepository } from './tenant.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  providers: [TenantRepository, PrismaService],
  exports: [TenantRepository],
})
export class TenantModule {}
