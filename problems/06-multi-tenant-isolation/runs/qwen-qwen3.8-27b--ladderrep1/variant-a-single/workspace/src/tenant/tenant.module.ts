import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantMiddleware } from './tenant.middleware.js';
import { TenantRepository } from './tenant.repository.js';
import { TenantService } from './tenant.service.js';

@Module({
  controllers: [TenantConfigController],
  providers: [TenantMiddleware, TenantService, TenantRepository],
  exports: [TenantService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
