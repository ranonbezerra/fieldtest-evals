import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module.js';
import { PaymentOrderModule } from './payment-order/payment-order.module.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    PaymentOrderModule,
    OperationsModule,
  ],
})
export class AppModule {}
