import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module.js';
import { CompanyTotalsModule } from './company-totals/company-totals.module.js';
import { EventsModule } from './events/events.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module.js';
import { ProjectionModule } from './projection/projection.module.js';
import { WorkersModule } from './workers/workers.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CommonModule,
    PaymentOrdersModule,
    EventsModule,
    WorkersModule,
    OperationsModule,
    CompanyTotalsModule,
    ProjectionModule,
  ],
})
export class AppModule {}
