import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { PlansModule } from './plans/plans.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';
import { TenantResolutionMiddleware } from './tenant/tenant.middleware.js';
import { AuthMiddleware } from './auth/auth.middleware.js';

@Module({
  imports: [
    PrismaModule,
    CustomersModule,
    PlansModule,
    OrdersModule,
    TenantConfigModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .forRoutes('*')
      .apply(TenantResolutionMiddleware)
      .forRoutes('*');
  }
}
