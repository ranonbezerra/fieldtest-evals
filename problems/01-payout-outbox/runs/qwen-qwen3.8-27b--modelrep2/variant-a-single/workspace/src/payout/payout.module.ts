import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { PayoutConfigService } from './payout.config.service.js';
import { PayoutController } from './payout.controller.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PayoutTransferProvider } from './payout-transfer.provider.js';
import { PayoutWorker } from './payout.worker.js';

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [PayoutController],
  providers: [PayoutConfigService, PayoutRepository, PayoutTransferProvider, PayoutService, PayoutWorker],
  exports: [PayoutRepository, PayoutConfigService],
})
export class PayoutModule {}
