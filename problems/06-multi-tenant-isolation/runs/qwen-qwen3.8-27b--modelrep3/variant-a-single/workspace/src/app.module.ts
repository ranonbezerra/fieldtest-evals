import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TenantModule } from './tenant/tenant.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware.js';

@Module({
  imports: [TenantModule, TenantConfigModule, CustomerModule],
  providers: [TenantResolutionMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantResolutionMiddleware)
      .forRoutes({ path: '(.*)', method: RequestMethod.ALL });
  }
}
