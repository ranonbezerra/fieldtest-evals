import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { CustomerModule } from './customer/customer.module';
import { PlanModule } from './plan/plan.module';
import { OrderModule } from './order/order.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantResolutionMiddleware } from './middleware/tenant-resolution.middleware';

@Module({
  imports: [
    PrismaModule,
    CustomerModule,
    PlanModule,
    OrderModule,
    TenantModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
