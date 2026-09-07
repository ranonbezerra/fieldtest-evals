import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    OrdersModule,
    OperationsModule,
  ],
})
export class AppModule {}
