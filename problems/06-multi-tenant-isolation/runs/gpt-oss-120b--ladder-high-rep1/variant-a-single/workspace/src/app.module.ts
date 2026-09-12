import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { MockAuthMiddleware } from './auth/auth.middleware.js';
import { TenantResolverMiddleware } from './tenant/tenant.middleware.js';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

@Module({
  imports: [PrismaModule, TenantModule, CustomersModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(MockAuthMiddleware)
      .forRoutes('*')
      .apply(TenantResolverMiddleware)
      .forRoutes('*');
  }
}
