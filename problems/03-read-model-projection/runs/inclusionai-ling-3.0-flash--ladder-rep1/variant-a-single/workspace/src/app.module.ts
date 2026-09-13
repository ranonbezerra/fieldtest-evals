import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { OrderModule } from './order/order.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ProjectionModule } from './projection/projection.module';
import { RederiveModule } from './rederive/rederive.module';
import { DriftModule } from './drift/drift.module';

@Module({
  imports: [
    PrismaModule,
    OrderModule,
    DashboardModule,
    ProjectionModule,
    RederiveModule,
    DriftModule,
  ],
})
export class AppModule {}
