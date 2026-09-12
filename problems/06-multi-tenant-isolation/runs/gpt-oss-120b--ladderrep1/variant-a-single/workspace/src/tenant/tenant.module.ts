import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { TenantRepository } from './tenant.repository.js';
import { TenantResolutionMiddleware } from './tenant.middleware.js';
import { TenantContext } from './tenant.context.js';

@Module({
  providers: [TenantService, TenantRepository, TenantContext],
  exports: [TenantService, TenantRepository, TenantContext],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
