import { Module } from '@nestjs/common';
import { PaymentOrderService } from './payment-order.service.js';
import { PaymentOrderRepository } from './payment-order.repository.js';
import { PrismaModule } from '../prisma.module.js';
import { OperationsRepository } from '../operations/operations.repository.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';

@Module({
  imports: [PrismaModule],
  providers: [
    PaymentOrderService,
    PaymentOrderRepository,
    OperationsRepository,
    CompanyTotalsRepository,
  ],
  exports: [PaymentOrderService],
})
export class PaymentOrderModule {}
