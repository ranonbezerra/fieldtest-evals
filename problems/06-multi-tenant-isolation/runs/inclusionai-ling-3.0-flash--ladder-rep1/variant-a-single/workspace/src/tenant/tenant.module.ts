import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { TenantMiddleware } from './tenant.middleware.js';
import { DatabaseModule } from '../database/database.module.js';

@Module({
  imports: [DatabaseModule],
  providers: [TenantService, TenantMiddleware],
  exports: [TenantService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
