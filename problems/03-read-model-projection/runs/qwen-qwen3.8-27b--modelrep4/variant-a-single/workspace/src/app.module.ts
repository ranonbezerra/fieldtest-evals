import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [PrismaModule, PaymentOrdersModule, OperationsModule],
})
export class AppModule {}
