import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  controllers: [OrdersController],
  providers: [
    {
      provide: OrdersRepository,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new OrdersRepository(prisma),
    },
    OrdersService,
  ],
})
export class OrdersModule {}
