import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { PrismaModule } from './common/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { PlansModule } from './plans/plans.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { TenantResolutionMiddleware } from './common/tenant-resolution.middleware.js';
import { ErrorFormatFilter } from './common/error-format.filter.js';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    CustomersModule,
    PlansModule,
    OrdersModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
