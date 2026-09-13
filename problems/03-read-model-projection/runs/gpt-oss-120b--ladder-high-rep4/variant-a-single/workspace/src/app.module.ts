import { Module } from '@nestjs/common';
import { ScheduleModule } from '../nestjs-schedule.js';
import { PrismaModule } from './prisma.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { PaymentOrderModule } from './payment-order/payment-order.module.js';
import { CompanyTotalsModule } from './company-totals/company-totals.module.js';
import { RepairScheduler } from './scheduler/repair.scheduler.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OperationsModule,
    PaymentOrderModule,
    CompanyTotalsModule,
  ],
  providers: [RepairScheduler],
})
export class AppModule {}
