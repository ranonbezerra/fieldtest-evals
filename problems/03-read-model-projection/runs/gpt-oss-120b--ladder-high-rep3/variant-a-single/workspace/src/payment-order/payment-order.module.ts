import { Module } from '@nestjs/common';
import { PaymentOrderService } from './payment-order.service.js';
import { PaymentOrderRepository } from './payment-order.repository.js';
import { OperationsModule } from '../operations/operations.module.js';

@Module({
  imports: [OperationsModule],
  providers: [PaymentOrderService, PaymentOrderRepository],
  exports: [PaymentOrderService],
})
export class PaymentOrderModule {}
