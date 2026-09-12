import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma.service.js';
import { OrdersModule } from './orders/orders.module.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), OrdersModule, OperationsModule],
  providers: [PrismaService],
})
export class AppModule {}
