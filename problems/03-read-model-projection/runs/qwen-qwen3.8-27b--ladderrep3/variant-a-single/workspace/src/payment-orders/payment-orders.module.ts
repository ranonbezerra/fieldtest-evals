import { Module } from '@nestjs/common';
import { ProjectionModule } from '../projection/projection.module.js';
import { PaymentOrdersController } from './payment-orders.controller.js';
import { PaymentOrderService } from './payment-orders.service.js';
import { PaymentOrderRepository } from './payment-orders.repository.js';

@Module({
  imports: [ProjectionModule],
  controllers: [PaymentOrdersController],
  providers: [PaymentOrderService, PaymentOrderRepository],
})
export class PaymentOrdersModule {}
