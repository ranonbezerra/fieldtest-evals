import { Global, Module } from '@nestjs/common';
import { TenantPrismaProvider } from './tenant-prisma.provider.js';

@Global()
@Module({
  providers: [TenantPrismaProvider],
  exports: [TenantPrismaProvider],
})
export class TenantModule {}
