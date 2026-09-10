import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module.js';
import { FinancialTotalsModule } from './financial-totals/financial-totals.module.js';
import { ReDerivationModule } from './re-derivation/re-derivation.module.js';
import { DriftRepairModule } from './drift-repair/drift-repair.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OperationsModule,
    PaymentOrdersModule,
    FinancialTotalsModule,
    ReDerivationModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
