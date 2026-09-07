// src/payout/payout.module.ts

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

// Controllers
import { PayoutController } from './payout.controller';

// Services / Providers
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { CryptoProvider } from '../provider/crypto.provider';
import { MessageProcessor } from './message.processor';

// ASSUMPTION: All imported paths exist and export the named classes.
// If any of these files are missing, they should be created according to the
// project's layer conventions (controller → service → repository → provider).

@Module({
  imports: [ScheduleModule.forRoot()], // enables @Cron/@Interval usage in MessageProcessor
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    CryptoProvider,
    MessageProcessor,
  ],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
