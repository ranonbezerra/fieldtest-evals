import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { TenantResolverMiddleware } from './tenant-resolver.middleware.js';
import { TenantRepository } from './tenant.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantConfigController } from '../tenant-config/tenant-config.controller.js';
import { TenantConfigService } from '../tenant-config/tenant-config.service.js';

@Module({
  controllers: [TenantConfigController],
  providers: [TenantResolverMiddleware, TenantRepository, PrismaService, TenantConfigService],
  exports: [TenantRepository],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolverMiddleware).forRoutes('*');
  }
}
