import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { jwtSecret } from './common/env.js';
import { CustomerModule } from './customer/customer.module.js';
import { OrderModule } from './order/order.module.js';
import { PlanModule } from './plan/plan.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware.js';

@Module({
  imports: [
    // Resolved lazily so JWT_SECRET is read from the environment at app init.
    JwtModule.registerAsync({
      useFactory: () => ({ secret: jwtSecret() }),
    }),
    PrismaModule,
    TenantModule,
    CustomerModule,
    PlanModule,
    OrderModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
