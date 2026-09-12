import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantRepository } from './tenant.repository.js';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';
import { TenantService } from './tenant.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantConfigController],
  providers: [TenantService, TenantRepository, TenantResolutionMiddleware],
  configure(consumer: MiddlewareConsumer) {
    // Every route is tenant-gated.
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  },
})
export class TenantModule implements NestModule {}
