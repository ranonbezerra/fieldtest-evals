import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { PaymentOrdersController } from './payment-orders.controller';
import { PaymentOrdersService } from './payment-orders.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

@Module({
  imports: [OperationsModule],
  controllers: [PaymentOrdersController],
  providers: [PaymentOrdersService, PaymentOrdersRepository],
})
export class PaymentOrdersModule {}
