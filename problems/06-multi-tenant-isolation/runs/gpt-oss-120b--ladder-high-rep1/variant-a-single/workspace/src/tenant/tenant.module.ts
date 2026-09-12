import { Module, Scope } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { TenantResolverMiddleware } from './tenant.middleware.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantConfigService } from './tenant-config.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantConfigController],
  providers: [
    TenantService,
    TenantResolverMiddleware,
    {
      provide: TenantConfigService,
      useClass: TenantConfigService,
      scope: Scope.REQUEST,
    },
  ],
  exports: [TenantService],
})
export class TenantModule {}
