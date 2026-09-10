import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { OperationsModule } from './operations/operations.module';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module';
import { DriftRepairModule } from './drift-repair/drift-repair.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, OperationsModule, PaymentOrdersModule, DriftRepairModule],
})
export class AppModule {}
