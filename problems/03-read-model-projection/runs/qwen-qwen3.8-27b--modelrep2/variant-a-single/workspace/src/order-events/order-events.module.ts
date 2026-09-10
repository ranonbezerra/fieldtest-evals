import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { OrderEventsController } from './order-events.controller.js';
import { OrderEventsRepository } from './order-events.repository.js';
import { OrderEventsService } from './order-events.service.js';

@Module({
  imports: [PrismaModule, OperationsModule],
  controllers: [OrderEventsController],
  providers: [OrderEventsService, OrderEventsRepository],
  exports: [OrderEventsRepository],
})
export class OrderEventsModule {}
