import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DriftRepairModule } from './drift-repair/drift-repair.module';
import { OperationsModule } from './operations/operations.module';
import { OrdersModule } from './order/order.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectionModule } from './projection/projection.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OrdersModule,
    OperationsModule,
    ProjectionModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
