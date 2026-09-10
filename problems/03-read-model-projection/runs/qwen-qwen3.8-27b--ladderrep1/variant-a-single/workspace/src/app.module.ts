import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsModule } from './events/events.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { OrdersModule } from './orders/orders.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), OperationsModule, OrdersModule, EventsModule],
})
export class AppModule {}
