import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service.js';
import { TenantContext } from './common/tenant-context.js';
import { TenantResolutionMiddleware } from './common/tenant-resolution.middleware.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';

@Module({
  imports: [TenantModule, CustomerModule, TenantConfigModule],
  providers: [PrismaService, TenantContext, TenantResolutionMiddleware],
  exports: [PrismaService, TenantContext],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
