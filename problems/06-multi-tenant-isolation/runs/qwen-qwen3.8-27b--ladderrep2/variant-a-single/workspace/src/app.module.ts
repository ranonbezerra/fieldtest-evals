import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/exception-filter.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { TenantResolutionMiddleware } from './tenant/tenant.middleware.js';

@Module({
  imports: [TenantModule, CustomerModule],
  providers: [
    TenantResolutionMiddleware,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route runs behind tenant resolution; there is no unauthenticated
    // or untenanted surface in this application.
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
