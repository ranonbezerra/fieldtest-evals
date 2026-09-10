import { Module } from '@nestjs/common';
import { FinancialTotalsModule } from '../financial-totals/financial-totals.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { OrderEventsModule } from '../order-events/order-events.module.js';
import { PaymentOrdersController } from './payment-orders.controller.js';
import { PaymentOrdersRepository } from './payment-orders.repository.js';
import { PaymentOrdersService } from './payment-orders.service.js';

@Module({
  imports: [PrismaModule, OrderEventsModule, OperationsModule, FinancialTotalsModule],
  controllers: [PaymentOrdersController],
  providers: [PaymentOrdersService, PaymentOrdersRepository],
  exports: [PaymentOrdersRepository],
})
export class PaymentOrdersModule {}
