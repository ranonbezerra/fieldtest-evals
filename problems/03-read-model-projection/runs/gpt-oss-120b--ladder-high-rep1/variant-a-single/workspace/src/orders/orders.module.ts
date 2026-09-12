import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrdersRepository } from './orders.repository.js';

@Module({
  providers: [OrdersService, OrdersRepository],
  exports: [OrdersService],
})
export class OrdersModule {}
