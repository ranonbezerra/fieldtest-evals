import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectionModule } from '../projection/projection.module';
import { OrdersController } from './order.controller';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Module({
  imports: [PrismaModule, ProjectionModule],
  controllers: [OrdersController],
  providers: [OrderService, OrderRepository],
})
export class OrdersModule {}
