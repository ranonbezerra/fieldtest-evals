import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantContext } from '../tenant/tenant.context.js';

@Global()
@Module({
  providers: [PrismaService, TenantContext],
  exports: [PrismaService],
})
export class PrismaModule {}
