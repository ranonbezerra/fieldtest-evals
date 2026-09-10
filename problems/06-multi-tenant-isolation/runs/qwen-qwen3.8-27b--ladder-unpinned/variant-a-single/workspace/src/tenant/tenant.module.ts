import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantController } from './tenant.controller';
import { TenantRepository } from './tenant.repository';
import { TenantService } from './tenant.service';

@Module({
  imports: [PrismaModule],
  controllers: [TenantController],
  providers: [TenantService, TenantRepository],
  exports: [TenantService],
})
export class TenantModule {}
