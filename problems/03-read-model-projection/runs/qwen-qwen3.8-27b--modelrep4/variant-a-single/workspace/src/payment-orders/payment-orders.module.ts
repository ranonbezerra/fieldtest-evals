import { Module } from '@nestjs/common';
import { PaymentOrdersController } from './payment-orders.controller.js';
import { PaymentOrderService } from './payment-orders.service.js';
import { PaymentOrderRepository } from './payment-orders.repository.js';

@Module({
  controllers: [PaymentOrdersController],
  providers: [PaymentOrderService, PaymentOrderRepository],
})
export class PaymentOrdersModule {}
