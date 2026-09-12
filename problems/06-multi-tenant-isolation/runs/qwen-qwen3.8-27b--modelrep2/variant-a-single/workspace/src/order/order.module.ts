import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PlanModule } from '../plan/plan.module.js';
import { OrderRepository } from './order.repository.js';
import { OrderService } from './order.service.js';

@Module({
  imports: [PrismaModule, CustomerModule, PlanModule],
  providers: [OrderService, OrderRepository],
  exports: [OrderService],
})
export class OrderModule {}
