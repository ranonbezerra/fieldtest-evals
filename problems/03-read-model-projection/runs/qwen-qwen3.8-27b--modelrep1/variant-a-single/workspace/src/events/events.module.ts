import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { PaymentOrdersModule } from '../payment-orders/payment-orders.module.js';
import { ProjectionModule } from '../projection/projection.module.js';
import { EventsController } from './events.controller.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';

@Module({
  controllers: [EventsController],
  providers: [EventsService, EventsRepository],
  imports: [CommonModule, PaymentOrdersModule, ProjectionModule],
})
export class EventsModule {}
