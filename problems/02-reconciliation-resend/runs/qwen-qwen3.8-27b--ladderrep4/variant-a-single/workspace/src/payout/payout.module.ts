import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BankGateway } from './bank-gateway.js';
import { PayoutConfig } from './payout-config.js';
import { PayoutController } from './payout.controller.js';
import { PayoutProcessor } from './payout.processor.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PAYOUT_ORDER_STORE } from './payout.types.js';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    BankGateway,
    PayoutConfig,
    PayoutProcessor,
    { provide: PAYOUT_ORDER_STORE, useClass: PayoutRepository },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
