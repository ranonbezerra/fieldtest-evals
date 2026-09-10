import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { ProjectionModule } from '../projection/projection.module.js';
import { WorkersModule } from '../workers/workers.module.js';
import { PaymentOrdersController } from './payment-orders.controller.js';
import { PaymentOrdersRepository } from './payment-orders.repository.js';
import { PaymentOrdersService } from './payment-orders.service.js';

@Module({
  controllers: [PaymentOrdersController],
  providers: [PaymentOrdersService, PaymentOrdersRepository],
  imports: [CommonModule, WorkersModule, ProjectionModule],
  exports: [PaymentOrdersRepository],
})
export class PaymentOrdersModule {}
