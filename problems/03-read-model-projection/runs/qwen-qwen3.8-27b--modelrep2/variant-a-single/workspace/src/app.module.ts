import { Module } from '@nestjs/common';
import { DriftRepairModule } from './drift-repair/drift-repair.module.js';
import { FinancialTotalsModule } from './financial-totals/financial-totals.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { OrderEventsModule } from './order-events/order-events.module.js';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module.js';

@Module({
  imports: [
    PaymentOrdersModule,
    OrderEventsModule,
    OperationsModule,
    FinancialTotalsModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
