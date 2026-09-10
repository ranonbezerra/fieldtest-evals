import { Module } from '@nestjs/common';
import { EventsModule } from './events/events.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { ProjectionModule } from './projection/projection.module.js';

@Module({
  imports: [OrdersModule, EventsModule, OperationsModule, ProjectionModule],
})
export class AppModule {}
