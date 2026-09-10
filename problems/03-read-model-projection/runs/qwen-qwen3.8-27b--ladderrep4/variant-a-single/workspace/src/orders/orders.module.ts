import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module.js';
import { ProjectionModule } from '../projection/projection.module.js';
import { OrderRepository } from './orders.repository.js';
import { OrderService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';

@Module({
  imports: [PrismaModule, ProjectionModule],
  controllers: [OrdersController],
  providers: [OrderRepository, OrderService],
})
export class OrdersModule {}
